import { setTimeout as sleep } from "node:timers/promises";

import type { z } from "zod";

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

export function parseOrThrow<T>(
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
}

export interface JsonRequestOptions<T> extends RequestOptions {
  schema: z.ZodType<T>;
  /** Operation name, for error messages only, e.g. "createTask". */
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
 * Retries 429/5xx/network errors with exponential backoff, honouring
 * `Retry-After`. Every other 4xx fails immediately.
 */
export async function requestWithRetry(
  options: RequestOptions
): Promise<Response> {
  const { body, fetchImpl, headers, method, provider, url } = options;
  const init: RequestInit = { headers, method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  let lastError: Error = new Error("unreachable");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(backoffMs(attempt));
      continue;
    }
    if (response.ok) {
      return response;
    }
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      lastError = new ApiError(provider, response.status, text);
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
