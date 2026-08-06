import { z } from "zod";

import { requestJson } from "./http.js";
import { pollUntilTerminal } from "./poll.js";
import type { PollOptions } from "./poll.js";
import { TASK_STATUSES } from "./types.js";
import type { ArkTask, CreateTaskRequest } from "./types.js";

/**
 * CONFIRMED (ModelArk docs page 1520757/1521675): tasks live at
 * {base}/contents/generations/tasks: POST to create, GET /{id} to read,
 * GET to list, DELETE /{id} to cancel. The base URL already carries /api/v3.
 */
/** Name used in error messages, e.g. "Ark API 429: ...". */
const PROVIDER = "Ark";

const TASKS_PATH = "/contents/generations/tasks";

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

/**
 * Historical names for the shared provider errors. They are the SAME classes,
 * not subclasses: `ArkApiError` was this codebase's only provider error before
 * a second provider existed, and a lot of call sites and tests name it.
 */
export {
  ApiError as ArkApiError,
  ResponseShapeError as ArkResponseError,
} from "./http.js";

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

  pollTask(taskId: string, options: PollOptions): Promise<ArkTask> {
    return pollUntilTerminal({
      options,
      provider: "the provider",
      read: (id) => this.getTask(id),
      taskId,
    });
  }

  /**
   * Every Ark call goes through the SHARED request policy in src/http.ts.
   * Retry timing is the one thing two providers must never drift on: retrying
   * a 4xx on a generation endpoint spends money, and not retrying a 429 throws
   * away a run that would have succeeded a second later.
   */
  private request<T>(options: {
    body?: unknown;
    method: "GET" | "POST";
    path: string;
    schema: z.ZodType<T>;
    what: string;
  }): Promise<T> {
    return requestJson({
      ...options,
      fetchImpl: this.fetchImpl,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      provider: PROVIDER,
      url: `${this.base}${options.path}`,
    });
  }
}
