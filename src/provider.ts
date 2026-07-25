import pLimit from "p-limit";
import type { LimitFunction } from "p-limit";

import type { PollOptions } from "./ark.js";
import { modelRateLimits, normalizeModelId } from "./models.js";
import type { ArkTask, CreateTaskRequest, Resolution } from "./types.js";

/**
 * The port between the commands and whatever actually generates video.
 *
 * `ArkClient` already satisfies this structurally, so no adapter exists and
 * none should: the port is the three methods the commands call, named exactly
 * as the client already names them. Its job is to let a test, `vs doctor`, or
 * a second provider stand in for a paid API without any command knowing.
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
export class MockVideoProvider implements VideoProvider {
  /** Every payload submitted, in order. Assert against this in tests. */
  readonly requests: CreateTaskRequest[] = [];

  private readonly options: Required<MockProviderOptions>;
  private readonly reads = new Map<string, number>();

  constructor(options: MockProviderOptions = {}) {
    this.options = {
      completionTokens: options.completionTokens ?? 108_000,
      failTasks: options.failTasks ?? [],
      pollsUntilDone: options.pollsUntilDone ?? 1,
    };
  }

  createTask(request: CreateTaskRequest): Promise<ArkTask> {
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
