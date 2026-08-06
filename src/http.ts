import { setTimeout as sleep } from "node:timers/promises";

import type { z } from "zod";

import { VsError } from "./errors.js";

/**
 * The retry and boundary-validation policy every provider shares.
 *
 * Extracted so the two adapters cannot drift on the one thing that must never
 * differ: WHEN TO RETRY. Retrying a 4xx costs money on a generation endpoint,
 * and not retrying a 429 wastes a run that would have succeeded a second
 * later. That judgement belongs in one place; wire formats and error envelopes
 * belong in the adapters.
 */

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 4000, 16_000];

/**
 * Failures raised before any byte of the request reached the server, so a
 * replay cannot produce a second task. Anything else on a POST is AMBIGUOUS:
 * a reset mid-response, a read timeout, or a gateway 502 can all mean the
 * upstream accepted and started billing a generation whose id we never saw.
 *
 * `ECONNRESET`/`ETIMEDOUT` are deliberately absent. They are the common case
 * for a connection dropped after the request was written, which is exactly the
 * case that must not be replayed.
 */
const PRE_SEND_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** node:fetch wraps the real cause, so walk the chain rather than the top. */
function isPreSendError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === "string" && PRE_SEND_ERROR_CODES.has(code)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * A request that spends money and did not come back with an answer.
 *
 * The operator has to resolve this by hand, because we cannot: the provider
 * either created a task or did not, and we hold no id either way. Retrying is
 * the one thing that is certainly wrong, so this throws instead.
 */
function ambiguousRequestError(
  provider: string,
  what: string | undefined,
  cause: Error
): VsError {
  const operation = what ?? "a request";
  return new VsError(
    "task_uncertain",
    `${provider} did not answer ${operation}, which may still have been accepted and billed`,
    {
      cause,
      hint: "nothing was retried, because replaying a paid request bills twice; check the provider console for a task created just now, adopt it with `vs status <shots-file> --refresh`, and only then re-run `vs generate`",
    }
  );
}
/** Characters of the offending body echoed in a validation error. */
const BODY_EXCERPT_CHARS = 400;

function backoffMs(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 16_000;
  // Jitter, so concurrent shots that hit the same 429 do not all wake together
  // and reproduce the burst that caused it.
  return base + Math.floor(Math.random() * 500);
}

/**
 * An HTTP failure from a provider. `status` is the transport code.
 *
 * `name` is derived from the provider (`ArkApiError`, `GeminiApiError`, ...)
 * for two reasons: it keeps the class each provider used to own recognisable in
 * a stack trace, and `apiStatus` in src/errors.ts identifies a provider error
 * structurally, by `name.endsWith("ApiError")`, so that it can turn a 401 or a
 * 429 into a next step without knowing every client.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(provider: string, status: number, message: string) {
    super(`${provider} API ${status}: ${message}`);
    // Deliberately NOT the literal class name. `apiStatus` in src/errors.ts
    // recognises a provider error by `name.endsWith("ApiError")` so it can turn
    // a 401 or 429 into a next step without knowing every client, and keeping
    // the provider in the name is what makes a stack trace say which API failed.
    // oxlint-disable-next-line unicorn/custom-error-definition
    this.name = `${provider}ApiError`;
    this.status = status;
  }
}

/**
 * A 2xx response whose body is not the shape we depend on. Separate from
 * `ApiError` because the causes and the fixes differ: this one means the
 * provider changed its contract, or the base URL points at something else
 * entirely.
 */
export class ResponseShapeError extends Error {
  readonly issues: string[];

  constructor(provider: string, what: string, issues: string[], body: unknown) {
    let excerpt: string;
    try {
      excerpt = JSON.stringify(body) ?? String(body);
    } catch {
      excerpt = String(body);
    }
    if (excerpt.length > BODY_EXCERPT_CHARS) {
      excerpt = `${excerpt.slice(0, BODY_EXCERPT_CHARS)}…`;
    }
    super(
      `${provider} API returned an unexpected ${what} response: ${issues.join("; ")}. Body: ${excerpt}`
    );
    this.name = "ResponseShapeError";
    this.issues = issues;
  }
}

function parseOrThrow<T>(
  provider: string,
  what: string,
  schema: z.ZodType<T>,
  body: unknown
): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
  );
  throw new ResponseShapeError(provider, what, issues, body);
}

export interface RequestOptions {
  body?: unknown;
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  method: "GET" | "POST";
  /** Provider name, for error messages only. */
  provider: string;
  url: string;
  /** Operation name, for error messages only, e.g. "createTask". */
  what?: string;
}

export interface JsonRequestOptions<T> extends RequestOptions {
  schema: z.ZodType<T>;
  what: string;
}

/**
 * One request with the shared retry policy, returning the successful response.
 *
 * TRANSPORT ONLY, deliberately: the four provider clients disagree about what
 * comes back (validated JSON, unvalidated JSON, raw audio bytes) but must NOT
 * disagree about when to retry. Retrying a 4xx on a generation endpoint spends
 * money; not retrying a 429 throws away a run that would have succeeded a
 * second later. Splitting transport from parsing is what lets all four share
 * the second decision while keeping the first.
 *
 * Retries 429 and, on a GET, 5xx and network errors, with exponential backoff
 * honouring `Retry-After`. Every other 4xx fails immediately.
 *
 * A POST is never replayed after an ambiguous failure. Every POST this CLI
 * sends spends money — it creates a generation task, a score, or a narration
 * line — so a 502 from a gateway that already forwarded the request, or a
 * socket reset after the body was written, may mean a paid task exists whose id
 * we will never see. Replaying that pays twice and orphans the first task,
 * which no amount of `isInFlight` re-attaching can recover, because nothing was
 * ever written to the manifest. 429 is exempt: it means the request was
 * rejected at the gate, so nothing was accepted and a replay is free.
 */
export async function requestWithRetry(
  options: RequestOptions
): Promise<Response> {
  const { body, fetchImpl, headers, method, provider, url, what } = options;
  const init: RequestInit = { headers, method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const replayable = method === "GET";
  let lastError: Error = new Error("unreachable");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!(replayable || isPreSendError(lastError))) {
        throw ambiguousRequestError(provider, what, lastError);
      }
      await sleep(backoffMs(attempt));
      continue;
    }
    if (response.ok) {
      return response;
    }
    const text = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable) {
      lastError = new ApiError(provider, response.status, text);
      if (response.status !== 429 && !replayable) {
        throw ambiguousRequestError(provider, what, lastError);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt)
      );
      continue;
    }
    throw new ApiError(provider, response.status, text);
  }
  throw lastError;
}

/**
 * A JSON request, validated at the boundary. A body that fails validation is
 * not transient, so it throws rather than burning the retry budget on what is
 * really a contract change.
 */
export async function requestJson<T>(
  options: JsonRequestOptions<T>
): Promise<T> {
  const { provider, what } = options;
  const response = await requestWithRetry(options);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ResponseShapeError(
      provider,
      what,
      ["body is not valid JSON"],
      await response.text().catch(() => "<unreadable>")
    );
  }
  return parseOrThrow(provider, what, options.schema, json);
}
