import pLimit from "p-limit";
import type { LimitFunction } from "p-limit";

import type { PollOptions } from "./ark.js";
import {
  DEFAULT_VIDEO_MODEL,
  lookupModel,
  modelRateLimits,
  normalizeModelId,
} from "./models.js";
import type { ModelCapabilities } from "./models.js";
import { createArk } from "./providers/ark.js";
import { SPEC_VERSION } from "./spec/video-model.js";
import type {
  VideoModelV1,
  VideoModelV1CallOptions,
} from "./spec/video-model.js";
import type { ArkTask, CreateTaskRequest, Resolution } from "./types.js";

/**
 * The port between the commands and whatever actually generates video.
 *
 * This used to be a hypothetical seam: `ArkClient` satisfied it structurally,
 * nothing else implemented it, and the commands typed themselves against the
 * concrete client anyway. MiniMax H3 is the second adapter, which is what makes
 * the seam real — one adapter is a guess about where variation will appear,
 * two is a measurement of where it did.
 *
 * The commands depend on this interface and never on a client class. What each
 * one has to know is the four methods below; what none of them may learn is
 * which vendor is behind it, what its wire body looks like, or how it bills.
 *
 * Stills are deliberately not part of this port. They already have two
 * backends (Ark Seedream and Gemini Nano Banana) routed by model id in
 * src/commands/stills.ts, and they are cents rather than dollars, so the
 * abstraction earns nothing there yet.
 */
export interface VideoProvider {
  createTask: (request: CreateTaskRequest) => Promise<ArkTask>;
  getTask: (taskId: string) => Promise<ArkTask>;
  pollTask: (taskId: string, options: PollOptions) => Promise<ArkTask>;
}

/**
 * Concurrency gate keyed by (model, resolution).
 *
 * One global `--concurrency` is wrong because the provider's limit is not
 * global: the individual tier allows 3 concurrent tasks but only ONE at 4K
 * (src/models.ts). Submitting 3 4K shots does not fail, it silently queues, so
 * the operator sees a stall with no explanation. This takes the lower of what
 * the operator asked for and what the model actually allows, per resolution,
 * so a mixed run keeps its parallelism at 720p and self-limits at 4K.
 */
export interface ModelLimiter {
  /** Run `task` once a slot is free for this model/resolution pair. */
  run: <T>(
    model: string | undefined,
    resolution: Resolution | undefined,
    task: () => Promise<T>
  ) => Promise<T>;
  /** The concurrency this pair resolved to. For messaging the operator. */
  concurrencyFor: (
    model: string | undefined,
    resolution: Resolution | undefined
  ) => number;
}

export function createModelLimiter(requested: number): ModelLimiter {
  const limiters = new Map<string, LimitFunction>();

  function concurrencyFor(
    model: string | undefined,
    resolution: Resolution | undefined
  ): number {
    const allowed = modelRateLimits(model, resolution).concurrency;
    return Math.max(1, Math.min(requested, allowed));
  }

  function limiterFor(
    model: string | undefined,
    resolution: Resolution | undefined
  ): LimitFunction {
    const key = `${normalizeModelId(model ?? "")}::${resolution ?? "default"}`;
    const existing = limiters.get(key);
    if (existing) {
      return existing;
    }
    const created = pLimit(concurrencyFor(model, resolution));
    limiters.set(key, created);
    return created;
  }

  return {
    concurrencyFor,
    run: (model, resolution, task) => limiterFor(model, resolution)(task),
  };
}

export interface MockProviderOptions {
  /**
   * getTask calls a task spends running before it succeeds. 0 = succeeded on
   * the first read.
   */
  pollsUntilDone?: number;
  /** Task ids (1-based submission order, `task-1`, `task-2`, ...) that end failed. */
  failTasks?: readonly string[];
  /** Billed tokens reported in `usage.completion_tokens`. */
  completionTokens?: number;
  /** Model the mock claims to be, for capability-dependent assertions. */
  modelId?: string;
}

/**
 * In-memory provider for CI and tests: no network, no key, no spend, and
 * deterministic. Task ids are assigned in submission order (`task-1`, ...) so
 * a test can name one to fail without depending on scheduling.
 *
 * It reproduces the two behaviours that actually break callers: a task is
 * running before it succeeds (so the poll loop is exercised, not skipped), and
 * a failed task carries an `error`, not a video url.
 */
export class MockVideoProvider implements VideoModelV1 {
  readonly specificationVersion = SPEC_VERSION;
  readonly provider = "ark" as const;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;

  /** Every wire body submitted, in order. Assert against this in tests. */
  readonly requests: CreateTaskRequest[] = [];

  private readonly options: Required<MockProviderOptions>;
  private readonly reads = new Map<string, number>();
  private readonly translate: VideoModelV1;

  constructor(options: MockProviderOptions = {}) {
    this.options = {
      completionTokens: options.completionTokens ?? 108_000,
      failTasks: options.failTasks ?? [],
      modelId: options.modelId ?? DEFAULT_VIDEO_MODEL,
      pollsUntilDone: options.pollsUntilDone ?? 1,
    };
    this.modelId = this.options.modelId;
    this.capabilities = lookupModel(this.modelId);
    // The REAL wire translation, so a test asserting on `requests` is asserting
    // on what would genuinely be submitted. Only the network is fake.
    this.translate = createArk({
      apiKey: "mock",
      baseUrl: "https://mock.invalid",
    }).videoModel(this.modelId);
  }

  toRequestBody(options: VideoModelV1CallOptions): CreateTaskRequest {
    return this.translate.toRequestBody(options) as CreateTaskRequest;
  }

  createTask(options: VideoModelV1CallOptions): Promise<ArkTask> {
    const request = this.toRequestBody(options);
    this.requests.push(request);
    const id = `task-${this.requests.length}`;
    this.reads.set(id, 0);
    return Promise.resolve({ id, model: request.model, status: "queued" });
  }

  getTask(taskId: string): Promise<ArkTask> {
    const seen = (this.reads.get(taskId) ?? 0) + 1;
    this.reads.set(taskId, seen);
    if (seen <= this.options.pollsUntilDone) {
      return Promise.resolve({ id: taskId, status: "running" });
    }
    if (this.options.failTasks.includes(taskId)) {
      return Promise.resolve({
        error: { code: "MockFailure", message: `mock failure for ${taskId}` },
        id: taskId,
        status: "failed",
      });
    }
    return Promise.resolve({
      content: { video_url: `https://mock.invalid/${taskId}.mp4` },
      id: taskId,
      status: "succeeded",
      usage: {
        completion_tokens: this.options.completionTokens,
        total_tokens: this.options.completionTokens,
      },
    });
  }

  /**
   * Polls with no timers at all: a fake clock would still make the suite wait
   * on the real one. `intervalMs`/`timeoutMs` are accepted and ignored.
   */
  async pollTask(taskId: string, options: PollOptions): Promise<ArkTask> {
    for (;;) {
      const task = await this.getTask(taskId);
      await options.onUpdate?.(task);
      if (task.status !== "queued" && task.status !== "running") {
        return task;
      }
    }
  }
}
