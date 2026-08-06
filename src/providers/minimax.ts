import { z } from "zod";

import { VsError } from "../errors.js";
import { ApiError, requestJson } from "../http.js";
import { lookupModel } from "../models.js";
import type { ModelCapabilities } from "../models.js";
import { pollUntilTerminal } from "../poll.js";
import type { PollOptions } from "../poll.js";
import { resolveApiKey, SPEC_VERSION } from "../spec/video-model.js";
import type {
  ApiKeySource,
  GeneratedVideoTask,
  ProviderV4,
  VideoModelV4,
  VideoModelV4CallOptions,
} from "../spec/video-model.js";
import type { Resolution, ShotReference, TaskStatus } from "../types.js";

/**
 * MiniMax H3, as a `VideoModelV4`.
 *
 * EVERY H3 QUIRK LIVES IN THIS FILE. The content array happens to be shaped
 * almost exactly like Ark's — same `type` discriminants, same `{url}`
 * wrappers, same five role names, same per-media-type `@Image N` ordinals — so
 * the translation is small. What is NOT shared, and is the whole reason this
 * adapter exists:
 *
 * - The body has no `generate_audio`, `watermark`, `camera_fixed`, or `seed`.
 *   Sending an unknown field risks a 400 (`2013 invalid params`), so they are
 *   dropped rather than passed through.
 * - `resolution` is `"768P"`/`"2K"`, uppercase, against this codebase's
 *   lowercase vocabulary.
 * - Create returns `{task_id}`, not `{id}`, and carries no status.
 * - Query nests everything under `task`, and calls the result `content.url`
 *   rather than `content.video_url`.
 * - There is no `usage` block at all: H3 bills per second, so there is nothing
 *   to reconcile a token estimate against (see `perSecondReport`).
 */

const MIN_POLL_INTERVAL_MS = 10_000;
const PROVIDER = "MiniMax";
const CREATE_PATH = "/v2/video_generation";
const QUERY_PATH = "/v2/query/video_generation";

/**
 * Wire spelling of each resolution this model supports. Only the two H3
 * renders appear: anything else is a registry/authoring error that
 * `validateShotAgainstModel` has already reported, and guessing a wire value
 * for it would turn a clear local warning into an opaque 400.
 */
const WIRE_RESOLUTION: Partial<Record<Resolution, string>> = {
  "2k": "2K",
  "768p": "768P",
};

/**
 * Provider statuses mapped onto this codebase's vocabulary.
 *
 * Matched case-insensitively and defensively: MiniMax's older video endpoints
 * spell these `Queueing`/`Processing`/`Success`/`Fail`, the v2 docs use
 * `succeeded`/`failed`/`cancelled`, and a status this map does not know must
 * NOT look terminal — treating an unrecognised status as finished would
 * abandon a task that has already been billed.
 */
const STATUS_BY_WIRE: Record<string, TaskStatus> = {
  canceled: "cancelled",
  cancelled: "cancelled",
  expired: "expired",
  fail: "failed",
  failed: "failed",
  preparing: "queued",
  processing: "running",
  queued: "queued",
  queueing: "queued",
  running: "running",
  succeeded: "succeeded",
  success: "succeeded",
};

function toTaskStatus(wire: string): TaskStatus {
  return STATUS_BY_WIRE[wire.trim().toLowerCase()] ?? "running";
}

const nullish = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

/** Create returns only an id; a task the API just accepted is queued by definition. */
const createResponseSchema = z.looseObject({ task_id: z.string().min(1) });

const queryResponseSchema = z.looseObject({
  task: z.looseObject({
    content: z.looseObject({ url: nullish }).optional(),
    error: z.union([z.string(), z.looseObject({})]).nullish(),
    status: z.string().min(1),
  }),
});

/** One authored reference to one H3 content item. URLs are already resolved. */
function toContentItem(reference: ShotReference): Record<string, unknown> {
  const { role, url } = reference;
  if (reference.type === "image") {
    return { image_url: { url }, role, type: "image_url" };
  }
  if (reference.type === "video") {
    return { role, type: "video_url", video_url: { url } };
  }
  return { audio_url: { url }, role, type: "audio_url" };
}

function describeError(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.msg;
    if (typeof message === "string") {
      return message;
    }
    return JSON.stringify(error);
  }
  return undefined;
}

/**
 * MiniMax embeds its own error code in the message text (`"… (1002)"`) rather
 * than a field, and the two most common failures both read as something else:
 * `1004` says "not authorized" when the usual cause is a REGION mismatch, and
 * `2013` says "invalid params" when the usual cause is a field this adapter
 * should have stripped. Name both, because neither is guessable from the raw
 * message.
 */
function enrich(error: unknown): unknown {
  if (!(error instanceof ApiError)) {
    return error;
  }
  if (error.status === 401 || error.message.includes("(1004)")) {
    return new VsError("missing_credential", error.message, {
      cause: error,
      hint: "check MINIMAX_API_KEY, and check the region: H3 is unavailable in the UK, EU, US, and South Korea, and a key from the wrong region fails exactly like a bad one",
    });
  }
  if (error.status === 400 || error.message.includes("(2013)")) {
    return new VsError("invalid_input", error.message, {
      cause: error,
      hint: "run the same command with `--dry-run` and compare the printed body against the v2 docs; H3 rejects unknown fields, and frame roles cannot be mixed with reference_* roles",
    });
  }
  return error;
}

class MinimaxVideoModel implements VideoModelV4 {
  readonly specificationVersion = SPEC_VERSION;
  readonly provider = "minimax" as const;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;

  private readonly apiKey: ApiKeySource;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(modelId: string, config: Required<MinimaxProviderConfig>) {
    this.modelId = modelId;
    this.capabilities = lookupModel(modelId);
    this.apiKey = config.apiKey;
    this.base = config.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = config.fetchImpl;
  }

  toRequestBody(options: VideoModelV4CallOptions): Record<string, unknown> {
    const content: Record<string, unknown>[] = [
      { text: options.prompt, type: "text" },
    ];
    for (const reference of options.references) {
      content.push(toContentItem(reference));
    }
    // `duration` is REQUIRED here, unlike Ark where it has a server default, and
    // must be a whole number of seconds.
    return {
      content,
      duration: Math.round(options.duration),
      model: this.modelId,
      ratio: options.aspectRatio,
      ...(options.resolution
        ? { resolution: WIRE_RESOLUTION[options.resolution] }
        : {}),
      ...options.providerOptions?.minimax,
    };
  }

  async doStart(options: VideoModelV4CallOptions): Promise<GeneratedVideoTask> {
    const { task_id } = await this.request(
      "createTask",
      "POST",
      CREATE_PATH,
      createResponseSchema,
      this.toRequestBody(options)
    );
    return { id: task_id, model: this.modelId, status: "queued" };
  }

  async doStatus(taskId: string): Promise<GeneratedVideoTask> {
    const { task } = await this.request(
      "getTask",
      "GET",
      `${QUERY_PATH}/${encodeURIComponent(taskId)}`,
      queryResponseSchema
    );
    const message = describeError(task.error);
    return {
      id: taskId,
      status: toTaskStatus(task.status),
      ...(task.content?.url
        ? { content: { video_url: task.content.url } }
        : {}),
      ...(message ? { error: { message } } : {}),
      // No `usage`, deliberately: H3 reports none, and synthesising one would
      // put a token count in the manifest that nobody was ever billed for.
    };
  }

  /**
   * A 10s floor, because MiniMax documents video generation at 5 RPM and asks
   * for it. That floor is the only thing that differs from the other adapters'
   * polling, which is why it is a parameter rather than a second loop.
   */
  pollTask(
    taskId: string,
    pollOptions: PollOptions
  ): Promise<GeneratedVideoTask> {
    return pollUntilTerminal({
      minIntervalMs: MIN_POLL_INTERVAL_MS,
      options: pollOptions,
      provider: PROVIDER,
      read: (id) => this.doStatus(id),
      taskId,
    });
  }

  private async request<T>(
    what: string,
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown
  ): Promise<T> {
    try {
      return await requestJson({
        body,
        fetchImpl: this.fetchImpl,
        headers: {
          Authorization: `Bearer ${resolveApiKey(this.apiKey)}`,
          "Content-Type": "application/json",
        },
        method,
        provider: PROVIDER,
        schema,
        url: `${this.base}${path}`,
        what,
      });
    } catch (error) {
      throw enrich(error);
    }
  }
}

export interface MinimaxProviderConfig {
  apiKey: ApiKeySource;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Configure the MiniMax backend once; take models off it as needed. */
export function createMinimax(config: MinimaxProviderConfig): ProviderV4 {
  const resolved: Required<MinimaxProviderConfig> = {
    ...config,
    fetchImpl: config.fetchImpl ?? fetch,
  };
  return {
    providerId: "minimax",
    specificationVersion: SPEC_VERSION,
    videoModel: (modelId: string) => new MinimaxVideoModel(modelId, resolved),
  };
}
