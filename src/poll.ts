import { setTimeout as sleep } from "node:timers/promises";

import { VsError } from "./errors.js";
import type { ArkTask, TaskStatus } from "./types.js";

/**
 * The submit-then-poll loop every provider shares.
 *
 * All three adapters generate the same way: POST once, then read a task id
 * until it settles. That loop was written three times, and the copies had
 * already drifted — the Ark one formatted its timeout differently, and the
 * AI SDK bridge hand-rolled the terminal check as `!== "queued" && !==
 * "running"`, which silently treats `expired` as still-running and polls a dead
 * task until the deadline.
 *
 * The two things that genuinely vary between providers are parameters, not
 * reasons to duplicate: a minimum interval (MiniMax documents 5 RPM and asks
 * for a 10s floor) and the provider's name in the timeout message.
 */

const MAX_CONSECUTIVE_POLL_ERRORS = 5;

/**
 * `expired` is terminal like a failure: the task outlived
 * `execution_expires_after` (or the provider's record retention) and will never
 * produce a clip, so stop polling rather than waiting out the deadline.
 */
const TERMINAL_STATUSES = new Set<TaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

export interface PollOptions {
  intervalMs: number;
  onUpdate?: (task: ArkTask) => void | Promise<void>;
  timeoutMs: number;
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

export interface PollUntilTerminalOptions {
  /** Reads the task once. The adapter's own status mapping lives here. */
  read: (taskId: string) => Promise<ArkTask>;
  /**
   * Floor on the interval, where the provider documents one. MiniMax asks for
   * 10s at 5 RPM; Ark and the AI SDK bridge have no published floor.
   */
  minIntervalMs?: number;
  options: PollOptions;
  /** Named in the timeout message so the operator knows where to look. */
  provider: string;
  taskId: string;
}

/** Poll until the task reaches a terminal status, or the deadline passes. */
export async function pollUntilTerminal({
  minIntervalMs = 0,
  options,
  provider,
  read,
  taskId,
}: PollUntilTerminalOptions): Promise<ArkTask> {
  const intervalMs = Math.max(minIntervalMs, options.intervalMs);
  const deadline = Date.now() + options.timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    if (Date.now() > deadline) {
      const minutes = options.timeoutMs / 60_000;
      throw new VsError(
        "timeout",
        `task ${taskId} timed out after ${formatTimeout(options.timeoutMs)}`,
        {
          hint: `the task is still running at ${provider} and has already been billed, so re-running the same command re-attaches to it instead of paying twice; pass \`--timeout ${Math.max(2, Math.ceil(minutes * 2))}\` to wait longer`,
        }
      );
    }
    let task: ArkTask;
    try {
      task = await read(taskId);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw error;
      }
      await sleep(intervalMs);
      continue;
    }
    // Awaited and OUTSIDE the read try/catch: a failed manifest write surfaces
    // here (aborting this shot's poll) instead of becoming an unhandled
    // rejection or being miscounted as a transient API error. Callers isolate
    // per-shot failures via Promise.allSettled.
    await options.onUpdate?.(task);
    if (TERMINAL_STATUSES.has(task.status)) {
      return task;
    }
    await sleep(intervalMs);
  }
}
