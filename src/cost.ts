import { lookupModel, usdPerMToken } from "./models.js";
import {
  ASPECT_RATIO_VALUE,
  DEFAULT_DURATION,
  DEFAULT_FPS,
  DEFAULT_RESOLUTION,
  DURATION_AUTO,
  RESOLUTION_SHORT_SIDE,
  VIDEO_USD_PER_KTOKEN,
} from "./types.js";
import type { AspectRatio, Resolution } from "./types.js";

/**
 * Cost model for the `vs generate` confirm prompt and the `--max-cost` ceiling.
 *
 * BytePlus bills per OUTPUT token, and the official formula (docs page
 * 1544106) is exact rather than empirical:
 *
 *     tokens = (input_video_seconds + output_video_seconds) × width × height × fps / 1024
 *
 * So the estimate is derived from the real pixel dimensions of the requested
 * resolution and aspect ratio, not from a per-second constant. That matters
 * most at the ends of the range: a flat $/sec figure is wrong by up to 5x
 * between 480p and 4K, and 4K is the trap: its per-token RATE is lower than
 * 1080p's, which reads like a discount but is swamped by ~4x the tokens.
 *
 * The dollar side is still an estimate: see the rate comments in src/models.ts.
 * Reconcile a real run with `reconcileTokens` against `usage.completion_tokens`.
 */

/** The literal /1024 in the official formula. */
const TOKEN_DIVISOR = 1024;
/** Generators render on a macroblock grid; a non-integer long side rounds up to this. */
const MACROBLOCK = 16;
/** `adaptive` has no fixed frame, so estimate on the commonest delivery frame. */
const FALLBACK_RATIO_VALUE = 16 / 9;
/** Estimate vs bill within this fraction is normal variance, not a broken model. */
const RECONCILE_TOLERANCE = 0.15;

export interface FrameSize {
  width: number;
  height: number;
}

function roundLongSide(value: number): number {
  // 720p/1080p/4K at 16:9 come out exact (1280, 1920, 3840) and are left alone.
  // 480p at 16:9 does not (853.33), and BytePlus renders 864x480, the next
  // macroblock boundary, which is also what the 0.2 token factor implies.
  // Confirm against a real 480p clip's ffprobe if a bill ever disagrees.
  return Number.isInteger(value)
    ? value
    : Math.ceil(value / MACROBLOCK) * MACROBLOCK;
}

/**
 * Pixel dimensions the model renders for a resolution/ratio pair. The short
 * side is pinned by the resolution and the long side follows the aspect.
 */
export function frameSize(
  resolution: Resolution = DEFAULT_RESOLUTION,
  ratio: AspectRatio = "16:9"
): FrameSize {
  const shortSide = RESOLUTION_SHORT_SIDE[resolution];
  const value = ASPECT_RATIO_VALUE[ratio] ?? FALLBACK_RATIO_VALUE;
  return value >= 1
    ? { height: shortSide, width: roundLongSide(shortSide * value) }
    : { height: roundLongSide(shortSide / value), width: shortSide };
}

/** The official formula, in one place. */
export function videoTokens(input: {
  seconds: number;
  width: number;
  height: number;
  fps?: number;
}): number {
  const fps = input.fps ?? DEFAULT_FPS;
  return Math.round(
    (input.seconds * input.width * input.height * fps) / TOKEN_DIVISOR
  );
}

function billableSeconds(duration: number): number {
  // Auto-duration is unknown up front; price it as a typical mid-length clip.
  return duration === DURATION_AUTO ? DEFAULT_DURATION : duration;
}

/** One generation, as much of it as the caller knows. */
export interface ClipSpec {
  duration: number;
  resolution?: Resolution;
  ratio?: AspectRatio;
  /** Defaults to the model's frame rate (24 for every Seedance model). */
  fps?: number;
  /**
   * Seconds of INPUT video billed alongside the output. The formula sums input
   * and output duration, so a reference video is not free (a still image is:
   * it has no duration).
   */
  inputVideoSeconds?: number;
  modelId?: string;
}

export interface CostEstimate {
  clips: number;
  /** Billable output seconds, auto-duration resolved to the default length. */
  seconds: number;
  tokens: number;
  usd: number;
}

export function clipTokens(spec: ClipSpec): number {
  const { height, width } = frameSize(spec.resolution, spec.ratio);
  const fps = spec.fps ?? lookupModel(spec.modelId).fps;
  return videoTokens({
    fps,
    height,
    seconds: billableSeconds(spec.duration) + (spec.inputVideoSeconds ?? 0),
    width,
  });
}

/**
 * Estimated output tokens for one clip.
 *
 * The two-argument form is the original signature and still works; pass
 * `ratio` whenever the shot is not 16:9, since the frame area (and therefore
 * the bill) changes with it.
 */
export function estimateTokens(
  duration: number,
  resolution: Resolution,
  options?: Omit<ClipSpec, "duration" | "resolution">
): number {
  return clipTokens({ ...options, duration, resolution });
}

/** USD for a token count at the given model tier. Prefer `usdForTokens`. */
export function estimateCostUsd(
  tokens: number,
  tier: "standard" | "fast"
): number {
  return (tokens / 1000) * VIDEO_USD_PER_KTOKEN[tier];
}

/**
 * USD for a token count at a model's published per-resolution rate. Unknown
 * models and unpriced resolutions quote the dearest rate on record, so an
 * estimate over-quotes rather than under-quoting a bill.
 */
export function usdForTokens(
  tokens: number,
  modelId?: string,
  resolution: Resolution = DEFAULT_RESOLUTION
): number {
  const rate = usdPerMToken(lookupModel(modelId), resolution);
  return (tokens / 1_000_000) * rate;
}

export function estimateClip(spec: ClipSpec): CostEstimate {
  const tokens = clipTokens(spec);
  return {
    clips: 1,
    seconds: billableSeconds(spec.duration),
    tokens,
    usd: usdForTokens(tokens, spec.modelId, spec.resolution),
  };
}

/** Total for a batch of shots, e.g. everything a `vs generate` run would submit. */
export function estimateClips(specs: readonly ClipSpec[]): CostEstimate {
  const total: CostEstimate = { clips: 0, seconds: 0, tokens: 0, usd: 0 };
  for (const spec of specs) {
    const clip = estimateClip(spec);
    total.clips += 1;
    total.seconds += clip.seconds;
    total.tokens += clip.tokens;
    total.usd += clip.usd;
  }
  return total;
}

export interface CostCeilingResult {
  allowed: boolean;
  /** Populated only when the ceiling blocks the run; ready to print. */
  reason?: string;
}

/**
 * Enforce a `--max-cost` ceiling against an estimate. Pure, so the caller
 * decides whether to abort, prompt, or just warn. An absent or non-positive
 * ceiling means no ceiling.
 */
export function checkCostCeiling(
  estimate: CostEstimate | number,
  maxUsd?: number
): CostCeilingResult {
  if (maxUsd === undefined || !Number.isFinite(maxUsd) || maxUsd <= 0) {
    return { allowed: true };
  }
  const usd = typeof estimate === "number" ? estimate : estimate.usd;
  if (usd <= maxUsd) {
    return { allowed: true };
  }
  const clips = typeof estimate === "number" ? undefined : estimate.clips;
  const scope = clips === undefined ? "run" : `${clips} shot(s)`;
  return {
    allowed: false,
    reason: `estimated $${usd.toFixed(2)} for ${scope} exceeds the --max-cost ceiling of $${maxUsd.toFixed(2)}. Generate fewer shots, drop to --draft, or raise the ceiling.`,
  };
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1000)}K`;
}

/** Compact human string, e.g. "4.4M tokens ≈ $25". */
export function formatEstimate(tokens: number, usd: number): string {
  return `${formatTokens(tokens)} tokens ≈ $${usd.toFixed(2)}`;
}

export interface Reconciliation {
  estimatedTokens: number;
  actualTokens: number;
  deltaTokens: number;
  /** actual / estimated. >1 means the estimate under-quoted the bill. */
  ratio: number;
  withinTolerance: boolean;
  /** Human-readable, ready to print after a run. */
  message: string;
}

/**
 * Compare an estimate against the real `usage.completion_tokens` off a
 * finished task. Drift beyond the tolerance means the rate table or the frame
 * assumptions in this file need updating from real usage, which is the whole
 * point of quoting an estimate that can be checked.
 */
export function reconcileTokens(
  estimatedTokens: number,
  actualTokens: number
): Reconciliation {
  const deltaTokens = actualTokens - estimatedTokens;
  const ratio = estimatedTokens > 0 ? actualTokens / estimatedTokens : 0;
  const withinTolerance =
    estimatedTokens > 0 && Math.abs(ratio - 1) <= RECONCILE_TOLERANCE;
  const direction = deltaTokens >= 0 ? "over" : "under";
  const percent = Math.abs(Math.round((ratio - 1) * 100));
  const summary = `billed ${formatTokens(actualTokens)} vs estimated ${formatTokens(estimatedTokens)} (${percent}% ${direction})`;
  return {
    actualTokens,
    deltaTokens,
    estimatedTokens,
    message: withinTolerance
      ? summary
      : `${summary}, outside the ±${Math.round(RECONCILE_TOLERANCE * 100)}% tolerance; recalibrate the rates in src/models.ts from the console's usage breakdown`,
    ratio,
    withinTolerance,
  };
}
