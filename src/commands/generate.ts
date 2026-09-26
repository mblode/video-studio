import { relative } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import pLimit from "p-limit";

import {
  checkCostCeiling,
  estimateClips,
  formatEstimate,
  reconcileTokens,
  usdForTokens,
} from "../cost.js";
import type { ClipSpec, CostEstimate } from "../cost.js";
import { downloadFile, writeVideoFile } from "../download.js";
import { formatError, isVsError, VsError } from "../errors.js";
import {
  isComplete,
  latestRevision,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "../manifest.js";
import {
  DEFAULT_VIDEO_MODEL,
  lookupModel,
  modelRateLimits,
  validateShotAgainstModel,
} from "../models.js";
import type { Pass } from "../paths.js";
import {
  buildCallOptions,
  effectiveShotParams,
  hashPayload,
  renderPayload,
} from "../payload.js";
import type { PayloadOverrides } from "../payload.js";
import { lintShotsFile } from "../shots.js";
import type { VideoModelV4 } from "../spec/video-model.js";
import { DRAFT_RESOLUTION } from "../types.js";
import type {
  ArkTask,
  Manifest,
  ManifestEntry,
  ManifestRevision,
  Shot,
  ShotsFile,
} from "../types.js";
import { clipRevisionPath } from "../versions.js";
import {
  assertInteractive,
  assertVideoModelCredential,
  createVideoModel,
  resolveFilm,
} from "./context.js";
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

function latestOperation(
  entry: ManifestEntry | undefined
): ManifestRevision | undefined {
  const revision = latestRevision(entry);
  if (revision || !entry || (entry.versions?.length ?? 0) > 0) {
    return revision;
  }
  // A v1 unresolved submit has no task id, so manifest migration cannot build
  // a revision for it. Preserve that exact top-level state without borrowing
  // identity from an older/selected revision.
  return {
    error: entry.error,
    params: entry.params,
    payloadHash: entry.payloadHash,
    status: entry.status,
    submittedAt: entry.submittedAt,
    taskId: entry.taskId,
    updatedAt: entry.updatedAt,
    version: Math.max(entry.attempts, 1),
  };
}

function latestIsInFlight(entry: ManifestEntry | undefined): boolean {
  const latest = latestOperation(entry);
  return Boolean(
    latest?.taskId &&
    (latest.status === "submitted" ||
      latest.status === "queued" ||
      latest.status === "running")
  );
}

function latestIsUnresolved(entry: ManifestEntry | undefined): boolean {
  const latest = latestOperation(entry);
  return latest?.status === "submitted" && latest.taskId === "";
}

function selectPendingShots(
  shots: Shot[],
  manifest: Manifest,
  shotsDir: string,
  force: boolean
): Shot[] {
  return shots.filter((shot) => {
    const entry = manifest.entries[shot.id];
    if (force || latestIsUnresolved(entry) || latestIsInFlight(entry)) {
      return true;
    }
    if (isComplete(entry, shotsDir)) {
      note(`${shot.id} already complete, skipping`);
      return false;
    }
    return true;
  });
}

function submissionClient(
  modelId: string,
  injected: VideoModelV4 | undefined
): VideoModelV4 {
  if (!injected) {
    return createVideoModel(modelId);
  }
  const expectedProvider = lookupModel(modelId).provider;
  if (injected.modelId !== modelId || injected.provider !== expectedProvider) {
    throw new VsError(
      "invalid_input",
      `injected video model ${injected.provider}/${injected.modelId} does not match requested ${expectedProvider}/${modelId}`
    );
  }
  return injected;
}

function assertUnresolvedAttempts(
  shots: Shot[],
  manifest: Manifest,
  force: boolean
): void {
  const unresolved = shots.filter((shot) =>
    latestIsUnresolved(manifest.entries[shot.id])
  );
  if (unresolved.length === 0) {
    return;
  }
  const ids = unresolved.map((shot) => shot.id).join(", ");
  if (!force) {
    throw new VsError(
      "task_uncertain",
      `${unresolved.length} shot(s) were submitted but never returned a task id: ${ids}`,
      {
        hint: `a paid task may exist for each; check and reconcile it in the provider console before passing \`--force\` to submit again and accept paying twice`,
      }
    );
  }
  warn(
    `--force is resubmitting ${unresolved.length} shot(s) whose previous submit never returned a task id (${ids}); if the provider did create those tasks, they are already billed and this pays for them twice`
  );
}

function assertReattachIdentities(shots: Set<Shot>, manifest: Manifest): void {
  for (const shot of shots) {
    const latest = latestOperation(manifest.entries[shot.id]);
    const params = latest?.params;
    if (!params?.provider || !params.model) {
      throw new VsError(
        "task_uncertain",
        `cannot safely resume ${shot.id}: task ${latest?.taskId ?? "unknown"} has no recorded provider/model identity`,
        {
          hint: "check the original provider console; this legacy task cannot be assigned to a backend without guessing",
        }
      );
    }
  }
}

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
  return formatEstimate(estimate.tokens, estimate.usd, estimate.usdMax);
}

async function dryRun(
  shots: Shot[],
  file: ShotsFile,
  shotsDir: string,
  pass: Pass,
  overrides: PayloadOverrides | undefined,
  estimate: CostEstimate,
  model: VideoModelV4
): Promise<void> {
  // The PROVIDER'S body, not a canonical one: --dry-run is the "will this work
  // before I spend" gate, so it has to print what actually goes on the wire.
  const payloads: { payload: unknown; shotId: string }[] = [];
  for (const shot of shots) {
    payloads.push({
      payload: model.toRequestBody(
        await buildCallOptions(shot, file.film, shotsDir, {
          overrides,
          skipInline: true,
        })
      ),
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

/**
 * What a shot costs, in the terms `src/cost.ts` bills in.
 *
 * Every field comes from `effectiveShotParams`, the same call `buildTaskPayload`
 * makes, so the quote is priced off exactly what goes on the wire — including
 * the draft model, which bills at a different rate than `film.model`. The one
 * deliberate asymmetry is `resolution`: the payload omits it when nothing set
 * one, but the clip still renders at the API's default, so it is always priced
 * (`emitResolution` is a wire concern, never a pricing one).
 */
function clipSpec(
  shot: Shot,
  file: ShotsFile,
  overrides?: PayloadOverrides
): ClipSpec {
  const params = effectiveShotParams(shot, file.film, overrides);
  return {
    duration: params.duration,
    modelId: params.model,
    ratio: params.ratio,
    // Free on token billing; charged past a free allowance on some per-second
    // providers, so it has to reach the estimator either way.
    referenceImages: shot.references?.filter((ref) => ref.type === "image")
      .length,
    // Drives the RANGE, not the point estimate: a bound video's billed length
    // is unknowable up front, so the ceiling quotes the model's worst case.
    referenceVideos: shot.references?.filter((ref) => ref.type === "video")
      .length,
    resolution: params.resolution,
  };
}

/**
 * Say so when the quote is knowingly incomplete.
 *
 * Both billing schemes charge for the SECONDS of a bound reference video, and
 * a reference video is normally a remote URL with no length we can read before
 * submitting. The alternative to warning is quoting the model's whole
 * documented input ceiling on every such shot, which over-quotes by several
 * times and makes `--max-cost` useless. So the estimate excludes it and says
 * that out loud, which is the one thing a silent under-quote cannot do.
 */
function warnUnpricedInput(shots: Shot[]): void {
  const withVideo = shots.filter((shot) =>
    shot.references?.some((ref) => ref.type === "video")
  );
  if (withVideo.length === 0) {
    return;
  }
  warn(
    `${withVideo.length} shot(s) bind a reference video (${withVideo.map((shot) => shot.id).join(", ")}); the provider bills its duration too, and a remote clip's length is not knowable before submitting, so the estimate below is a range and \`--max-cost\` is checked against its top`
  );
}

function estimateRun(
  shots: Shot[],
  file: ShotsFile,
  overrides?: PayloadOverrides
): CostEstimate {
  return estimateClips(shots.map((shot) => clipSpec(shot, file, overrides)));
}

/**
 * Enforce per-model capability checks (duration, resolution, refs, …) that the
 * schema envelope cannot express. Errors refuse the run; warnings print.
 */
function assertShotsCapable(
  shots: Shot[],
  file: ShotsFile,
  overrides?: PayloadOverrides
): void {
  const errors: string[] = [];
  for (const shot of shots) {
    const params = effectiveShotParams(shot, file.film, overrides);
    const problems = validateShotAgainstModel(params.model, {
      duration: params.duration,
      generateAudio: params.generateAudio,
      ratio: params.ratio,
      references: shot.references,
      resolution: params.resolution,
    });
    for (const problem of problems) {
      const message = `${shot.id}: ${problem.message}`;
      if (problem.severity === "error") {
        errors.push(message);
      } else {
        warn(message);
      }
    }
  }
  if (errors.length > 0) {
    throw new VsError(
      "invalid_input",
      `shot capabilities do not match the model:\n  ${errors.join("\n  ")}`,
      {
        hint: "lower duration/resolution to what the model supports, or set film.model to a model that accepts these values",
      }
    );
  }
}

/** Cap run concurrency by the tightest model/resolution limit among the shots. */
function effectiveConcurrency(
  requested: number,
  shots: Shot[],
  file: ShotsFile,
  overrides?: PayloadOverrides
): number {
  let max = Math.max(1, requested);
  for (const shot of shots) {
    const params = effectiveShotParams(shot, file.film, overrides);
    const allowed = modelRateLimits(
      params.model,
      params.resolution
    ).concurrency;
    max = Math.min(max, allowed);
  }
  return max;
}

/**
 * Refuse a run that would cost more than `--max-cost`.
 *
 * Checked BEFORE the confirm prompt and independently of `--yes`, because
 * `--yes` is exactly how an agent or a CI job runs this: unattended, with
 * nobody to read the estimate. The ceiling is then the only thing between a
 * typo'd duration and a real bill, so it cannot be something `--yes` waives.
 */
/** The smallest `--max-cost` value, in whole cents, that lets this run through. */
function smallestCeiling(estimate: CostEstimate): number {
  return Math.ceil(estimate.usdMax * 100) / 100;
}

function assertCostCeiling(estimate: CostEstimate, maxCost?: number): void {
  const { allowed, reason } = checkCostCeiling(estimate, maxCost);
  if (allowed) {
    return;
  }
  throw new VsError("cost_ceiling", reason ?? "cost ceiling exceeded", {
    // The reason already lists the ways out, so the hint carries the one thing
    // it cannot: the exact ceiling that would let this run through.
    hint: `nothing was submitted and nothing was billed; \`--max-cost ${smallestCeiling(estimate)}\` is the smallest ceiling that allows this run`,
  });
}

/**
 * The confirm prompt is the last thing between an unattended caller and a real
 * bill, so the failure it raises has to name BOTH gates. `--yes` alone skips the
 * confirm and leaves no ceiling behind it (an absent `--max-cost` means no
 * ceiling at all), so a hint that named only `--yes` would be pointing the one
 * reader guaranteed to see it — an agent, in CI, with nobody watching — at
 * unbounded spend.
 */
function assertCostPromptAnswerable(estimate: CostEstimate): void {
  try {
    assertInteractive("--yes");
  } catch (error) {
    if (!(isVsError(error) && error.code === "not_interactive")) {
      throw error;
    }
    throw new VsError("not_interactive", error.message, {
      cause: error,
      hint: `re-run with \`--yes --max-cost ${smallestCeiling(estimate)}\` to accept unattended; this run is estimated at $${estimate.usd.toFixed(2)}, and \`--yes\` on its own removes every spend guard`,
    });
  }
}

async function confirmCost(
  shots: Shot[],
  file: ShotsFile,
  pass: Pass,
  estimate: CostEstimate
): Promise<boolean> {
  // `estimate.seconds` is already the billable length of exactly these shots,
  // auto-duration resolved; recounting it here is a third copy of the ladder.
  const { seconds } = estimate;
  // Show the counterfactual so the draft↔final saving is visible at spend time.
  const counterfactual =
    pass === "draft"
      ? ` (final ≈ ${describeEstimate(estimateRun(shots, file))})`
      : "";
  assertCostPromptAnswerable(estimate);
  const answer = await confirm({
    message: `Submit ${shots.length} ${pass} shot(s) / ${seconds}s ≈ ${describeEstimate(estimate)}${counterfactual}?`,
  });
  return !isCancel(answer) && answer === true;
}

interface BillingReport {
  actualTokens: number;
  actualUsd: number;
  estimatedTokens: number;
  estimatedUsd: number;
  /** Ready to print: "billed 1.4M vs estimated 1.3M (6% over)". */
  message: string;
  shots: number;
  withinTolerance: boolean;
  /**
   * False when the provider reports no usage, so `actual` is the quote rather
   * than a measurement and there is nothing to reconcile. Kept explicit so the
   * output can say which of the two it is showing.
   */
  reconcilable: boolean;
}

/**
 * What a per-second run cost.
 *
 * There is no reconciliation to do: the provider returns no usage block at
 * all, so the only honest report is the quote plus a statement that it was not
 * checked against anything. Inventing a fake reconciliation here would make
 * `reconcileTokens`'s tolerance warning meaningless for every model.
 */
function perSecondReport(
  shots: Shot[],
  file: ShotsFile,
  overrides: PayloadOverrides | undefined,
  manifest: Manifest
): BillingReport | undefined {
  const billed = shots.filter((shot) => {
    const status = manifest.entries[shot.id]?.status;
    return status === "succeeded" || status === "downloaded";
  });
  if (billed.length === 0) {
    return;
  }
  const estimate = estimateRun(billed, file, overrides);
  return {
    actualTokens: 0,
    actualUsd: estimate.usd,
    estimatedTokens: 0,
    estimatedUsd: estimate.usd,
    message: `billed per second at the quoted rate; this provider reports no usage to reconcile against`,
    reconcilable: false,
    shots: billed.length,
    withinTolerance: true,
  };
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
  // The SAME ladder as the run itself (see `runGenerate`). Dropping the
  // default here would resolve an unset `film.model` to the permissive
  // fallback and pick the wrong billing branch.
  const modelId = overrides?.model ?? file.film.model ?? DEFAULT_VIDEO_MODEL;
  if (lookupModel(modelId).billing.kind === "perSecond") {
    return perSecondReport(shots, file, overrides, manifest);
  }
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
    const spec = clipSpec(shot, file, overrides);
    actualTokens += tokens;
    // Reconciliation prices REAL completion_tokens, so the token base is known
    // and the cheaper with-video rate can be applied safely. The pre-flight
    // estimate deliberately does not: conditioned input seconds are unknowable
    // for a remote URL, and discounting an under-counted base under-quotes
    // twice. See `usdPerMTokenWithVideoInput` in src/models.ts.
    actualUsd += usdForTokens(tokens, spec.modelId, spec.resolution, {
      videoInput: shot.references?.some((ref) => ref.type === "video"),
    });
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
    reconcilable: true,
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
    report.reconcilable
      ? `$${report.actualUsd.toFixed(2)} actual vs $${report.estimatedUsd.toFixed(2)} estimated across ${report.shots} shot(s)`
      : `$${report.actualUsd.toFixed(2)} across ${report.shots} shot(s), unverified`
  );
}

async function settleTask(options: {
  client: VideoModelV4;
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
  const videoBytes = final.content?.videoBytes;
  if (options.download && (videoBytes || videoUrl)) {
    const version = manifest.entries[shot.id]?.attempts ?? 1;
    const outputPath = clipRevisionPath(
      options.outputDir,
      shot.id,
      version,
      shot.output
    );
    if (videoBytes) {
      await writeVideoFile(videoBytes, outputPath);
    } else if (videoUrl) {
      await downloadFile(videoUrl, outputPath);
    }
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

export async function runGenerate(
  shotsFilePath: string,
  options: GenerateOptions,
  injected: { client?: VideoModelV4 } = {}
): Promise<void> {
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    pass,
  });
  const overrides = draftOverrides(file, options.draft);
  const shots = selectShots(file, options.shot);
  // One model per run: shots cannot set `model`, so the only variation is the
  // draft override, and that applies to the whole run.
  const modelId = overrides?.model ?? file.film.model ?? DEFAULT_VIDEO_MODEL;

  for (const warning of lintShotsFile(file, { shotsDir })) {
    warn(warning);
  }

  if (options.dryRun) {
    assertShotsCapable(shots, file, overrides);
    // The ceiling is checked here too, so `--dry-run --max-cost` is a free
    // preflight: the exit code answers "would this run stay under budget?".
    warnUnpricedInput(shots);
    const estimate = estimateRun(shots, file, overrides);
    assertCostCeiling(estimate, options.maxCost);
    await dryRun(
      shots,
      file,
      shotsDir,
      pass,
      overrides,
      estimate,
      injected.client ?? createVideoModel(modelId)
    );
    return;
  }

  const manifest = await loadManifest(shotsFilePath, pass);
  const pending = selectPendingShots(shots, manifest, shotsDir, options.force);

  if (pending.length === 0) {
    emit({ pass, pending: 0, status: "up-to-date" }, () => {
      note("nothing to do, all shots complete");
    });
    return;
  }

  // Before anything is priced or sent: a shot whose last submit never came back
  // with an id may already have a paid task at the provider. Resubmitting is
  // the one move that is certainly wrong, so stop and make the operator resolve
  // it. `--force` is the acknowledgement that they have.
  assertUnresolvedAttempts(pending, manifest, options.force);

  const toSubmit = pending.filter(
    (shot) => !latestIsInFlight(manifest.entries[shot.id])
  );
  const toReattach = new Set(
    pending.filter((shot) => latestIsInFlight(manifest.entries[shot.id]))
  );

  assertReattachIdentities(toReattach, manifest);

  if (toSubmit.length > 0) {
    assertShotsCapable(toSubmit, file, overrides);
    warnUnpricedInput(toSubmit);
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

  const client =
    toSubmit.length > 0
      ? (() => {
          if (!injected.client) {
            assertVideoModelCredential(modelId);
          }
          return submissionClient(modelId, injected.client);
        })()
      : undefined;

  const concurrency = effectiveConcurrency(
    options.concurrency,
    toSubmit,
    file,
    overrides
  );
  if (concurrency < options.concurrency) {
    note(
      `capping concurrency at ${concurrency} for this model's rate limits (requested ${options.concurrency})`
    );
  }
  const limit = pLimit(concurrency);
  async function submitShot(shot: Shot): Promise<void> {
    if (!client) {
      throw new VsError("invalid_input", `no submission client for ${shot.id}`);
    }
    const callOptions = await buildCallOptions(shot, file.film, shotsDir, {
      overrides,
    });
    const payloadHash = hashPayload(client.toRequestBody(callOptions));
    const params = {
      duration: callOptions.duration,
      generateAudio: callOptions.generateAudio ?? true,
      model: client.modelId,
      provider: client.provider,
      ratio: callOptions.aspectRatio,
      // Undefined records that the provider chose its default resolution.
      resolution: callOptions.resolution,
      seed: callOptions.seed,
      watermark: callOptions.watermark ?? false,
    };
    // Record the intent to spend BEFORE spending. If the process dies between
    // here and the response, this entry (status "submitted", no task id) is
    // what stops the next run from silently submitting and paying a second
    // time. Without it a Ctrl-C in this window leaves no trace at all.
    upsertEntry(manifest, {
      newAttempt: true,
      params,
      payloadHash,
      shotId: shot.id,
      status: "submitted",
    });
    await saveManifest(shotsFilePath, manifest, pass);
    const task = await client.doStart(callOptions);
    upsertEntry(manifest, {
      params,
      // Hashed once, above, from the PROVIDER'S body, which is what was
      // actually submitted. For Ark that is byte-identical to what this CLI has
      // always hashed, so no existing film's audit trail churns.
      payloadHash,
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
    const latest = latestOperation(entry);
    const recorded = latest?.params;
    if (!latest || !recorded?.provider || !recorded.model) {
      throw new VsError(
        "task_uncertain",
        `cannot safely resume ${shot.id}: latest task has no recorded provider/model identity`
      );
    }
    const recoveryClient =
      injected.client?.modelId === recorded.model &&
      injected.client.provider === recorded.provider
        ? injected.client
        : createVideoModel(recorded.model);
    if (recoveryClient.provider !== recorded.provider) {
      throw new VsError(
        "task_uncertain",
        `cannot safely resume ${shot.id}: recorded provider ${recorded.provider} does not match model ${recorded.model}`,
        { hint: "check the original provider console and manifest identity" }
      );
    }
    const { taskId } = latest;
    note(`↻ ${shot.id} re-attaching to task ${taskId}`);
    if (options.wait) {
      await settleTask({
        client: recoveryClient,
        download: options.download,
        generateOptions: options,
        manifest,
        outputDir,
        pass,
        shot,
        shotsDir,
        shotsFile: shotsFilePath,
        task: { id: taskId, status: "running" },
      });
    }
  }

  const jobs = pending.map((shot) =>
    limit(() => (toReattach.has(shot) ? reattachShot(shot) : submitShot(shot)))
  );

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
