import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { VsError } from "./errors.js";
import { TASK_STATUSES } from "./types.js";
import type {
  ArkTask,
  CreateImageRequest,
  CreateImageResponse,
  CreateTaskRequest,
  TaskStatus,
} from "./types.js";

/**
 * CONFIRMED (ModelArk docs page 1520757/1521675): tasks live at
 * {base}/contents/generations/tasks: POST to create, GET /{id} to read,
 * GET to list, DELETE /{id} to cancel. The base URL already carries /api/v3.
 */
export const TASKS_PATH = "/contents/generations/tasks";
export const IMAGES_PATH = "/images/generations";

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 4000, 16_000];
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
/** Characters of the offending body echoed in a validation error. */
const BODY_EXCERPT_CHARS = 400;

const TERMINAL_STATUSES = new Set<TaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
  // Terminal like a failure: the task outlived execution_expires_after (or the
  // 7-day record retention) and will never produce a clip, so stop polling.
  "expired",
]);

const taskStatusSchema = z.enum(TASK_STATUSES);

// Providers spell "not set yet" as either an absent key or an explicit null
// (a queued task may well carry `content: { video_url: null }`), and treating
// the second spelling as a contract violation would break polling for nothing.
// Both mean undefined here.
const nullishString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const nullishCoercedString = z.coerce
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const nullishCoercedNumber = z.coerce
  .number()
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * Validates ONLY the fields this CLI actually reads. Everything else the
 * provider sends passes through untouched (`looseObject`), deliberately:
 * validating a field we ignore turns a harmless provider change into an
 * outage. The strictness here is narrow but real, because each of these does
 * drive behaviour: `status` gates the poll loop, `content.video_url` is what
 * gets downloaded, `usage.completion_tokens` is the bill.
 *
 * `error.code`/`error.message` are coerced rather than required to be strings:
 * they only ever end up in a human-readable message, so a numeric code should
 * not be the thing that fails a run.
 */
const arkTaskSchema = z.looseObject({
  content: z
    .looseObject({
      last_frame_url: nullishString,
      video_url: nullishString,
    })
    .optional(),
  error: z
    .looseObject({
      code: nullishCoercedString,
      message: nullishCoercedString,
    })
    .optional(),
  id: z.string().min(1),
  model: nullishString,
  status: taskStatusSchema,
  usage: z
    .looseObject({
      completion_tokens: nullishCoercedNumber,
      total_tokens: nullishCoercedNumber,
    })
    .optional(),
});

/**
 * The create response documents only `id`. A task the API has just accepted is
 * queued by definition, so default the status instead of rejecting a response
 * that is perfectly valid.
 */
const createTaskResponseSchema = arkTaskSchema.extend({
  status: taskStatusSchema.default("queued"),
});

const createImageResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      b64_json: z.string().optional(),
      url: z.string().optional(),
    })
  ),
});

/**
 * A 2xx response whose body is not the shape we depend on. Separate from
 * ArkApiError (an HTTP failure) because the causes and the fixes differ: this
 * one means the provider changed the contract, or the base URL points at
 * something that is not ModelArk.
 */
export class ArkResponseError extends Error {
  readonly issues: string[];

  constructor(what: string, issues: string[], body: unknown) {
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
      `Ark API returned an unexpected ${what} response: ${issues.join("; ")}. Body: ${excerpt}`
    );
    this.name = "ArkResponseError";
    this.issues = issues;
  }
}

function parseOrThrow<T>(what: string, schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
  );
  throw new ArkResponseError(what, issues, body);
}

/**
 * Poll timeouts are reported in the unit the operator typed (`--timeout` is in
 * minutes); "1200000ms" makes them do the arithmetic. Sub-minute waits still
 * read in seconds rather than rounding to a useless "0 minutes".
 */
function formatTimeout(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 1
    ? `${Math.round(minutes * 10) / 10} minute(s)`
    : `${Math.max(1, Math.round(ms / 1000))}s`;
}

function backoffMs(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 16_000;
  return base + Math.floor(Math.random() * 500);
}

export class ArkApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`Ark API ${status}: ${message}`);
    this.name = "ArkApiError";
    this.status = status;
  }
}

export interface PollOptions {
  intervalMs: number;
  onUpdate?: (task: ArkTask) => void | Promise<void>;
  timeoutMs: number;
}

export class ArkClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.base = options.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createImage(request: CreateImageRequest): Promise<CreateImageResponse> {
    return this.request({
      body: request,
      method: "POST",
      path: IMAGES_PATH,
      schema: createImageResponseSchema,
      what: "createImage",
    });
  }

  createTask(request: CreateTaskRequest): Promise<ArkTask> {
    return this.request({
      body: request,
      method: "POST",
      path: TASKS_PATH,
      schema: createTaskResponseSchema,
      what: "createTask",
    });
  }

  getTask(taskId: string): Promise<ArkTask> {
    return this.request({
      method: "GET",
      path: `${TASKS_PATH}/${encodeURIComponent(taskId)}`,
      schema: arkTaskSchema,
      what: "getTask",
    });
  }

  async pollTask(taskId: string, options: PollOptions): Promise<ArkTask> {
    const deadline = Date.now() + options.timeoutMs;
    let consecutiveErrors = 0;
    for (;;) {
      if (Date.now() > deadline) {
        const minutes = options.timeoutMs / 60_000;
        throw new VsError(
          "timeout",
          `task ${taskId} timed out after ${formatTimeout(options.timeoutMs)}`,
          {
            hint: `the task is still running at the provider and has already been billed, so re-running the same command re-attaches to it instead of paying twice; pass \`--timeout ${Math.max(2, Math.ceil(minutes * 2))}\` to wait longer`,
          }
        );
      }
      let task: ArkTask;
      try {
        task = await this.getTask(taskId);
        consecutiveErrors = 0;
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw error;
        }
        await sleep(options.intervalMs);
        continue;
      }
      // Awaited and OUTSIDE the getTask try/catch: a failed manifest write
      // surfaces here (aborting this shot's poll) instead of becoming an
      // unhandled rejection or being miscounted as a transient API error.
      // Callers isolate per-shot failures via Promise.allSettled.
      await options.onUpdate?.(task);
      if (TERMINAL_STATUSES.has(task.status)) {
        return task;
      }
      await sleep(options.intervalMs);
    }
  }

  /**
   * Retries 429/5xx/network errors with exponential backoff (honouring
   * Retry-After). Other 4xx fail immediately, because retrying costs money. A
   * body that fails validation is not transient either, so it throws rather
   * than burning the retry budget.
   */
  private async request<T>(options: {
    body?: unknown;
    method: "GET" | "POST";
    path: string;
    schema: z.ZodType<T>;
    what: string;
  }): Promise<T> {
    const { body, method, path } = options;
    const url = `${this.base}${path}`;
    const init: RequestInit = {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      method,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    let lastError: Error = new Error("unreachable");
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(backoffMs(attempt));
        continue;
      }
      if (response.ok) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          throw new ArkResponseError(
            options.what,
            ["body is not valid JSON"],
            await response.text().catch(() => "<unreadable>")
          );
        }
        return parseOrThrow(options.what, options.schema, json);
      }
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        lastError = new ArkApiError(response.status, text);
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt)
        );
        continue;
      }
      throw new ArkApiError(response.status, text);
    }
    throw lastError;
  }
}
