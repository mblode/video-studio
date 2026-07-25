import { join, relative } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import pLimit from "p-limit";

import type { ArkClient } from "../ark.js";
import { chainDependencies, resolveChainFrame } from "../chain.js";
import {
  checkCostCeiling,
  estimateClips,
  formatEstimate,
  reconcileTokens,
  usdForTokens,
} from "../cost.js";
import type { ClipSpec, CostEstimate } from "../cost.js";
import { downloadFile } from "../download.js";
import { formatError, VsError } from "../errors.js";
import { assertFfmpeg } from "../ffmpeg.js";
import {
  isComplete,
  isInFlight,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "../manifest.js";
import type { Pass } from "../paths.js";
import {
  buildTaskPayload,
  DEFAULT_VIDEO_MODEL,
  hashPayload,
  renderPayload,
} from "../payload.js";
import type { PayloadOverrides } from "../payload.js";
import { lintShotsFile } from "../shots.js";
import {
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  DRAFT_RESOLUTION,
  DURATION_AUTO,
} from "../types.js";
import type {
  ArkTask,
  CreateTaskRequest,
  Manifest,
  Resolution,
  Shot,
  ShotReference,
  ShotsFile,
} from "../types.js";
import { clipRevisionPath } from "../versions.js";
import { assertInteractive, createArkClient, resolveFilm } from "./context.js";
import {
  emit,
  fail,
  heading,
  isVerbose,
  line,
  note,
  ok,
  warn,
} from "./output.js";

export interface GenerateOptions {
  concurrency: number;
  download: boolean;
  draft: boolean;
  dryRun: boolean;
  force: boolean;
  /** USD ceiling for the run. Undefined = no ceiling. */
  maxCost?: number;
  pollInterval: number;
  shot?: string[];
  timeout: number;
  wait: boolean;
  yes: boolean;
}

/**
 * A draft run forces the cheap path — 480p, no per-clip audio (the score and
 * narration are mixed at stitch anyway) — and uses the fast model if the film
 * opts in via `film.draftModel`. Returns undefined for a final run.
 */
function draftOverrides(
  file: ShotsFile,
  draft: boolean
): PayloadOverrides | undefined {
  if (!draft) {
    return;
  }
  return {
    generateAudio: false,
    resolution: DRAFT_RESOLUTION,
    ...(file.film.draftModel ? { model: file.film.draftModel } : {}),
  };
}

function describeEstimate(estimate: CostEstimate): string {
  return formatEstimate(estimate.tokens, estimate.usd);
}

interface Deferred {
  promise: Promise<void>;
  reject: (reason: Error) => void;
  resolve: () => void;
}

function deferred(): Deferred {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- void is the resolved type, not a parameter
  const resolvers = Promise.withResolvers<void>();
  // oxlint-disable-next-line promise/prefer-await-to-then -- leaf shots have no dependents awaiting this; keep the rejection handled
  resolvers.promise.catch(() => {
    // intentionally empty
  });
  return {
    promise: resolvers.promise,
    reject: resolvers.reject,
    resolve: resolvers.resolve,
  };
}

function selectShots(file: ShotsFile, ids: string[] | undefined): Shot[] {
  if (!ids || ids.length === 0) {
    return file.shots;
  }
  const byId = new Map(file.shots.map((shot) => [shot.id, shot]));
  return ids.map((id) => {
    const shot = byId.get(id);
    if (!shot) {
      throw new VsError("unknown_id", `no shot with id "${id}" in this film`, {
        hint: `valid ids: ${file.shots.map((s) => s.id).join(", ")}`,
      });
    }
    return shot;
  });
}

function chainFrameRef(framePath: string): ShotReference {
  return { role: "first_frame", type: "image", url: framePath };
}

async function dryRun(
  shots: Shot[],
  file: ShotsFile,
  shotsDir: string,
  pass: Pass,
  overrides: PayloadOverrides | undefined,
  estimate: CostEstimate
): Promise<void> {
  const framesRel = pass === "draft" ? "frames-draft" : "frames";
  const payloads: { payload: CreateTaskRequest; shotId: string }[] = [];
  for (const shot of shots) {
    const effective: Shot = shot.continueFrom
      ? {
          ...shot,
          references: [
            chainFrameRef(join(framesRel, `${shot.continueFrom}-last.png`)),
          ],
        }
      : shot;
    // dry-run never extracts; the frame path may not exist yet, so always
    // render a placeholder instead of inlining
    payloads.push({
      payload: await buildTaskPayload(effective, file.film, shotsDir, {
        overrides,
        skipInline: true,
      }),
      shotId: shot.id,
    });
  }
  // The headers are stderr chatter so stdout stays a parseable stream of
  // payloads even in human mode.
  emit({ dryRun: true, estimate, pass, payloads }, () => {
    for (const { payload, shotId } of payloads) {
      heading(`# ${shotId}`);
      line(renderPayload(payload));
    }
    note(
      `${payloads.length} payload(s) ≈ ${describeEstimate(estimate)}; nothing submitted.`
    );
  });
}

/** Effective short-side resolution for cost math (the request may omit it → API default 1080p). */
function effectiveResolution(
  shot: Shot,
  file: ShotsFile,
  overrides?: PayloadOverrides
): Resolution {
  return (
    overrides?.resolution ??
    shot.resolution ??
    file.film.defaults?.resolution ??
    DEFAULT_RESOLUTION
  );
}

/** What a shot costs, in the terms `src/cost.ts` bills in. */
function clipSpec(
  shot: Shot,
  file: ShotsFile,
  overrides?: PayloadOverrides
): ClipSpec {
  return {
    duration: shot.duration ?? file.film.defaults?.duration ?? DEFAULT_DURATION,
    // Mirrors the model buildTaskPayload will actually send: the fast draft
    // model bills at a different rate, so quoting `film.model` would be wrong.
    modelId: overrides?.model ?? file.film.model ?? DEFAULT_VIDEO_MODEL,
    ratio: shot.ratio ?? file.film.defaults?.ratio,
    resolution: effectiveResolution(shot, file, overrides),
  };
}

function estimateRun(
  shots: Shot[],
  file: ShotsFile,
  overrides?: PayloadOverrides
): CostEstimate {
  return estimateClips(shots.map((shot) => clipSpec(shot, file, overrides)));
}

/**
 * Refuse a run that would cost more than `--max-cost`.
 *
 * Checked BEFORE the confirm prompt and independently of `--yes`, because
 * `--yes` is exactly how an agent or a CI job runs this: unattended, with
 * nobody to read the estimate. The ceiling is then the only thing between a
 * typo'd duration and a real bill, so it cannot be something `--yes` waives.
 */
function assertCostCeiling(estimate: CostEstimate, maxCost?: number): void {
  const { allowed, reason } = checkCostCeiling(estimate, maxCost);
  if (allowed) {
    return;
  }
  throw new VsError("cost_ceiling", reason ?? "cost ceiling exceeded", {
    // The reason already lists the ways out, so the hint carries the one thing
    // it cannot: the exact ceiling that would let this run through.
    hint: `nothing was submitted and nothing was billed; \`--max-cost ${Math.ceil(estimate.usd * 100) / 100}\` is the smallest ceiling that allows this run`,
  });
}

async function confirmCost(
  shots: Shot[],
  file: ShotsFile,
  pass: Pass,
  estimate: CostEstimate
): Promise<boolean> {
  let seconds = 0;
  for (const shot of shots) {
    const duration =
      shot.duration ?? file.film.defaults?.duration ?? DEFAULT_DURATION;
    seconds += duration === DURATION_AUTO ? DEFAULT_DURATION : duration;
  }
  // Show the counterfactual so the draft↔final saving is visible at spend time.
  const counterfactual =
    pass === "draft"
      ? ` (final ≈ ${describeEstimate(estimateRun(shots, file))})`
      : "";
  assertInteractive("--yes");
  const answer = await confirm({
    message: `Submit ${shots.length} ${pass} shot(s) / ${seconds}s ≈ ${describeEstimate(estimate)}${counterfactual}?`,
  });
  return !isCancel(answer) && answer === true;
}

export interface BillingReport {
  actualTokens: number;
  actualUsd: number;
  estimatedTokens: number;
  estimatedUsd: number;
  /** Ready to print: "billed 1.4M vs estimated 1.3M (6% over)". */
  message: string;
  shots: number;
  withinTolerance: boolean;
}

/**
 * What the run actually cost, against what it was quoted.
 *
 * Only shots that reported `usage` are counted: a re-attached or skipped shot
 * was not quoted in this run, so folding it in would corrupt the one comparison
 * that keeps the estimator honest.
 */
function billingReport(
  shots: Shot[],
  file: ShotsFile,
  overrides: PayloadOverrides | undefined,
  manifest: Manifest
): BillingReport | undefined {
  const billed = shots.filter(
    (shot) => manifest.entries[shot.id]?.tokensUsed !== undefined
  );
  if (billed.length === 0) {
    return;
  }
  let actualTokens = 0;
  let actualUsd = 0;
  for (const shot of billed) {
    const tokens = manifest.entries[shot.id]?.tokensUsed ?? 0;
    actualTokens += tokens;
    actualUsd += usdForTokens(
      tokens,
      clipSpec(shot, file, overrides).modelId,
      effectiveResolution(shot, file, overrides)
    );
  }
  const estimate = estimateRun(billed, file, overrides);
  const { message, withinTolerance } = reconcileTokens(
    estimate.tokens,
    actualTokens
  );
  return {
    actualTokens,
    actualUsd,
    estimatedTokens: estimate.tokens,
    estimatedUsd: estimate.usd,
    message,
    shots: billed.length,
    withinTolerance,
  };
}

function reportBilling(report: BillingReport): void {
  const headline = `cost: ${report.message}`;
  if (report.withinTolerance) {
    ok(headline);
  } else {
    warn(headline);
  }
  note(
    `$${report.actualUsd.toFixed(2)} actual vs $${report.estimatedUsd.toFixed(2)} estimated across ${report.shots} shot(s)`
  );
}

async function settleTask(options: {
  client: ArkClient;
  download: boolean;
  generateOptions: GenerateOptions;
  manifest: Manifest;
  outputDir: string;
  pass: Pass;
  shot: Shot;
  shotsDir: string;
  shotsFile: string;
  task: ArkTask;
}): Promise<void> {
  const { client, manifest, pass, shot, shotsFile, task } = options;
  const startedAt = Date.now();
  const final = await client.pollTask(task.id, {
    intervalMs: options.generateOptions.pollInterval * 1000,
    onUpdate: async (update) => {
      upsertEntry(manifest, {
        shotId: shot.id,
        status: update.status,
        taskId: task.id,
        videoUrl: update.content?.video_url,
      });
      await saveManifest(shotsFile, manifest, pass);
      // Generation runs for minutes. Without a heartbeat the operator (or the
      // agent driving this) stares at nothing between "submitted" and "done".
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      note(`${shot.id} ${update.status} (${elapsed}s elapsed)`);
    },
    timeoutMs: options.generateOptions.timeout * 60 * 1000,
  });

  if (final.status !== "succeeded") {
    upsertEntry(manifest, {
      error: final.error?.message ?? `task ended ${final.status}`,
      shotId: shot.id,
      status: final.status,
      taskId: task.id,
    });
    await saveManifest(shotsFile, manifest, pass);
    throw new VsError(
      "task_failed",
      `${shot.id}: ${final.error?.message ?? `task ended ${final.status}`}`,
      {
        hint: `inspect it with \`vs status ${task.id}\`, then retake with \`vs generate ${shotsFile} --shot ${shot.id} --force\``,
      }
    );
  }

  // The real bill, recorded once the task is terminal. This is what makes the
  // estimate in src/cost.ts checkable instead of permanently notional.
  const tokensUsed = final.usage?.completion_tokens;
  const videoUrl = final.content?.video_url;
  if (options.download && videoUrl) {
    const version = manifest.entries[shot.id]?.attempts ?? 1;
    const outputPath = clipRevisionPath(
      options.outputDir,
      shot.id,
      version,
      shot.output
    );
    await downloadFile(videoUrl, outputPath);
    upsertEntry(manifest, {
      outputPath: relative(options.shotsDir, outputPath),
      shotId: shot.id,
      status: "downloaded",
      taskId: task.id,
      tokensUsed,
      videoUrl,
    });
    ok(`${shot.id} → ${outputPath}`);
  } else {
    upsertEntry(manifest, {
      shotId: shot.id,
      status: "succeeded",
      taskId: task.id,
      tokensUsed,
      videoUrl,
    });
    ok(`${shot.id} succeeded (not downloaded)`);
  }
  await saveManifest(shotsFile, manifest, pass);
}

function validateChains(options: {
  manifest: Manifest;
  pendingIds: Set<string>;
  shots: Shot[];
  shotsDir: string;
  wait: boolean;
}): void {
  const chained = options.shots.filter(
    (shot) => shot.continueFrom !== undefined
  );
  for (const shot of chained) {
    const depId = shot.continueFrom as string;
    const depComplete = isComplete(
      options.manifest.entries[depId],
      options.shotsDir
    );
    if (!(depComplete || options.pendingIds.has(depId))) {
      throw new VsError(
        "chain_invalid",
        `${shot.id} continues from ${depId}, which is neither downloaded nor selected in this run`,
        {
          hint: `add \`--shot ${depId}\` to this run, or generate ${depId} first`,
        }
      );
    }
    if (!depComplete && !options.wait) {
      throw new VsError(
        "chain_invalid",
        `${shot.id} continues from ${depId}, which has not finished downloading`,
        {
          hint: "drop --no-wait so the dependency's last frame exists before the chained shot starts",
        }
      );
    }
  }
}

export async function runGenerate(
  shotsFilePath: string,
  options: GenerateOptions,
  injected: { client?: ArkClient } = {}
): Promise<void> {
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    pass,
  });
  const overrides = draftOverrides(file, options.draft);
  const shots = selectShots(file, options.shot);

  for (const warning of lintShotsFile(file)) {
    warn(warning);
  }

  if (options.dryRun) {
    // The ceiling is checked here too, so `--dry-run --max-cost` is a free
    // preflight: the exit code answers "would this run stay under budget?".
    const estimate = estimateRun(shots, file, overrides);
    assertCostCeiling(estimate, options.maxCost);
    await dryRun(shots, file, shotsDir, pass, overrides, estimate);
    return;
  }

  const client = injected.client ?? createArkClient();
  const manifest = await loadManifest(shotsFilePath, pass);

  const pending = shots.filter((shot) => {
    const entry = manifest.entries[shot.id];
    if (options.force) {
      return true;
    }
    if (isInFlight(entry)) {
      return true;
    }
    if (isComplete(entry, shotsDir)) {
      note(`${shot.id} already complete, skipping`);
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    emit({ pass, pending: 0, status: "up-to-date" }, () => {
      note("nothing to do, all shots complete");
    });
    return;
  }

  const pendingIds = new Set(pending.map((shot) => shot.id));
  validateChains({
    manifest,
    pendingIds,
    shots: pending,
    shotsDir,
    wait: options.wait,
  });
  if (pending.some((shot) => shot.continueFrom !== undefined)) {
    await assertFfmpeg();
  }

  const toSubmit = pending.filter(
    (shot) => !isInFlight(manifest.entries[shot.id])
  );
  const toReattach = new Set(
    pending.filter((shot) => isInFlight(manifest.entries[shot.id]))
  );

  if (toSubmit.length > 0) {
    const estimate = estimateRun(toSubmit, file, overrides);
    assertCostCeiling(estimate, options.maxCost);
    if (!options.yes && !(await confirmCost(toSubmit, file, pass, estimate))) {
      // Declining is a decision, not a success: the requested work did not
      // happen, so the exit code has to say so.
      fail("aborted at the cost prompt; nothing submitted");
      process.exitCode = 1;
      return;
    }
  }

  const limit = pLimit(options.concurrency);
  const deps = chainDependencies(pending);
  const doneSignals = new Map(pending.map((shot) => [shot.id, deferred()]));

  async function awaitDependency(shot: Shot): Promise<void> {
    const depId = deps.get(shot.id);
    if (depId === undefined) {
      return;
    }
    const signal = doneSignals.get(depId);
    if (signal) {
      // wait OUTSIDE the concurrency limit so a blocked shot never holds a slot
      await signal.promise.catch(() => {
        throw new VsError(
          "chain_invalid",
          `${shot.id} skipped because its dependency ${depId} failed`,
          {
            hint: `fix and regenerate ${depId} first, then re-run; this shot chains onto its last frame`,
          }
        );
      });
    }
  }

  async function submitShot(shot: Shot): Promise<void> {
    let effective = shot;
    if (shot.continueFrom !== undefined) {
      const framePath = await resolveChainFrame(shot, manifest, shotsDir, pass);
      effective = { ...shot, references: [chainFrameRef(framePath)] };
    }
    const payload: CreateTaskRequest = await buildTaskPayload(
      effective,
      file.film,
      shotsDir,
      { overrides }
    );
    const task = await client.createTask(payload);
    upsertEntry(manifest, {
      newAttempt: true,
      params: {
        duration: payload.duration,
        generateAudio: payload.generate_audio,
        model: payload.model,
        ratio: payload.ratio,
        // Exactly what went on the wire: undefined records "we sent no
        // resolution and let the API choose", which is a different fact from
        // "we asked for 1080p".
        resolution: payload.resolution,
        seed: payload.seed,
        watermark: payload.watermark,
      },
      payloadHash: hashPayload(payload),
      shotId: shot.id,
      status: "submitted",
      taskId: task.id,
    });
    await saveManifest(shotsFilePath, manifest, pass);
    note(`↑ ${shot.id} submitted (${task.id})`);
    if (options.wait) {
      await settleTask({
        client,
        download: options.download,
        generateOptions: options,
        manifest,
        outputDir,
        pass,
        shot,
        shotsDir,
        shotsFile: shotsFilePath,
        task,
      });
    }
  }

  async function reattachShot(shot: Shot): Promise<void> {
    const entry = manifest.entries[shot.id];
    if (!entry) {
      return;
    }
    note(`↻ ${shot.id} re-attaching to task ${entry.taskId}`);
    if (options.wait) {
      await settleTask({
        client,
        download: options.download,
        generateOptions: options,
        manifest,
        outputDir,
        pass,
        shot,
        shotsDir,
        shotsFile: shotsFilePath,
        task: { id: entry.taskId, status: "running" },
      });
    }
  }

  const jobs = pending.map(async (shot) => {
    const signal = doneSignals.get(shot.id);
    try {
      await awaitDependency(shot);
      await limit(() =>
        toReattach.has(shot) ? reattachShot(shot) : submitShot(shot)
      );
      signal?.resolve();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      signal?.reject(err);
      throw err;
    }
  });

  const results = await Promise.allSettled(jobs);
  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    const { hint, message } = formatError(failure.reason, isVerbose());
    fail(message);
    if (hint) {
      note(`  ${hint}`);
    }
  }
  const billing = billingReport(toSubmit, file, overrides, manifest);
  emit(
    {
      cost: billing,
      failed: failures.length,
      pass,
      submitted: pending.length - failures.length,
      waited: options.wait,
    },
    () => {
      if (billing) {
        reportBilling(billing);
      }
      if (!options.wait) {
        note(
          `submitted ${pending.length} shot(s); poll with \`vs status ${shotsFilePath} --refresh\``
        );
      }
    }
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
