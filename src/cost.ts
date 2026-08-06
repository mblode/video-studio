import { lookupModel, usdPerMToken, usdPerSecond } from "./models.js";
import {
  ASPECT_RATIO_VALUE,
  DEFAULT_DURATION,
  DEFAULT_FPS,
  DEFAULT_RESOLUTION,
  DURATION_AUTO,
  RESOLUTION_SHORT_SIDE,
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
  // Anything else rounds up to the next macroblock boundary. This is a DERIVED
  // guess; where a real clip has been measured, `OBSERVED_FRAME_SIZE` overrides
  // it, because the guess is demonstrably wrong at 480p.
  return Number.isInteger(value)
    ? value
    : Math.ceil(value / MACROBLOCK) * MACROBLOCK;
}

/**
 * Frame sizes MEASURED off real generated clips, keyed `<resolution>|<ratio>`.
 *
 * A resolution tier is not a short-side pin. BytePlus targets a pixel budget
 * and fits the aspect ratio into it, so 480p at 16:9 renders 864x496 rather
 * than the 864x480 this file derived: the derivation under-counts frame area
 * by 3.2%, and the token formula multiplies by it.
 *
 * `adaptive` is the bigger correction, because it has no ratio to derive from
 * at all and fell through to a 16:9 guess. It is also the one entry here that
 * is genuinely input-dependent: the model reads the shape off the bound
 * keyframe, and 640x640 is what films/lighthouse's 2200x2000 stills produce.
 * A film whose keyframes are a different shape will land somewhere else, so
 * this is a calibrated default rather than a fact about `adaptive`.
 *
 * Every entry below reproduces its clip's billed `usage.completion_tokens`
 * EXACTLY via `duration x w x h x fps / 1024`, across all 18 draft clips of
 * films/lighthouse. The formula was never wrong; the geometry fed to it was.
 *
 * ADDING AN ENTRY is how you fix an estimate that drifts: generate one clip at
 * the pairing, `ffprobe` its width and height, and confirm the formula
 * reproduces the manifest's `tokensUsed` before writing it down. Unmeasured
 * pairings fall through to the derivation above, so treat those as provisional.
 * Notably absent: every 720p, 1080p and 4K pairing, and an explicit `1:1`.
 */
const OBSERVED_FRAME_SIZE: Readonly<Record<string, FrameSize>> = {
  // 6 draft clips, 80,770 billed tokens each at 8.041667s.
  "480p|16:9": { height: 496, width: 864 },
  // 12 draft clips, 77,200 billed tokens each at 8.041667s.
  "480p|adaptive": { height: 640, width: 640 },
};

/**
 * Pixel dimensions the model renders for a resolution/ratio pair. The short
 * side is pinned by the resolution and the long side follows the aspect.
 */
export function frameSize(
  resolution: Resolution = DEFAULT_RESOLUTION,
  ratio: AspectRatio = "16:9"
): FrameSize {
  const observed = OBSERVED_FRAME_SIZE[`${resolution}|${ratio}`];
  if (observed) {
    return observed;
  }
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
   * Seconds of INPUT video billed alongside the output. Both billing kinds sum
   * input and output duration, so a reference video is not free (a still image
   * is: it has no duration).
   *
   * Callers generally cannot know this: a reference video is usually a remote
   * URL with no probeable length. `vs generate` leaves it unset and warns
   * instead, because the alternative is quoting a model's whole documented
   * input ceiling and making `--max-cost` useless.
   */
  inputVideoSeconds?: number;
  /**
   * Reference IMAGES bound to the shot. Free on token billing (an image has no
   * duration, so it adds no tokens) but charged per image past a free
   * allowance on some per-second providers.
   */
  referenceImages?: number;
  /**
   * Reference VIDEOS bound to the shot, whose durations are unknown. Used only
   * to decide whether a clip needs a range rather than a point quote; the
   * length itself comes from the model's `maxInputVideoSeconds`.
   */
  referenceVideos?: number;
  modelId?: string;
}

export interface CostEstimate {
  clips: number;
  /** Billable output seconds, auto-duration resolved to the default length. */
  seconds: number;
  tokens: number;
  /** The low end: what the run costs if every reference video is negligible. */
  usd: number;
  /**
   * The high end, and the number `--max-cost` enforces. Equal to `usd` unless
   * a shot binds a reference video whose billed duration cannot be known
   * before submitting.
   */
  usdMax: number;
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
 * USD for a token count at a model's published per-resolution rate. Unknown
 * models and unpriced resolutions quote the dearest rate on record, so an
 * estimate over-quotes rather than under-quoting a bill.
 */
export function usdForTokens(
  tokens: number,
  modelId?: string,
  resolution: Resolution = DEFAULT_RESOLUTION,
  options?: { videoInput?: boolean }
): number {
  const rate = usdPerMToken(lookupModel(modelId), resolution, options);
  return (tokens / 1_000_000) * rate;
}

/**
 * USD for one clip under whichever scheme its model bills in.
 *
 * THE ONE PLACE THAT KNOWS BILLING VARIES. `usd` is the authoritative number
 * for `--max-cost` and the confirm prompt, and it has to be right for a model
 * that reports no tokens at all: `Billing.perSecond` sat declared and
 * unimplemented for a while, and every per-second quote came out as $0.00 and
 * walked straight through the cost ceiling. Adding a third billing shape is a
 * union member and one branch here, nothing else.
 */
export function usdForClip(spec: ClipSpec): number {
  const capabilities = lookupModel(spec.modelId);
  const resolution = spec.resolution ?? DEFAULT_RESOLUTION;
  if (capabilities.billing.kind !== "perSecond") {
    return usdForTokens(clipTokens(spec), spec.modelId, resolution);
  }
  const { billing } = capabilities;
  const rate = usdPerSecond(capabilities, resolution);
  // Input video bills at the output rate, same as the token formula sums the
  // two durations. Unset means the caller could not know it; see ClipSpec.
  const seconds =
    billableSeconds(spec.duration) + (spec.inputVideoSeconds ?? 0);
  const chargeableImages = Math.max(
    0,
    (spec.referenceImages ?? 0) - (billing.freeReferenceImages ?? 0)
  );
  const usd =
    seconds * rate +
    chargeableImages * (billing.usdPerExtraReferenceImage ?? 0);
  return Math.max(usd, billing.minimumTaskUsd ?? 0);
}

/**
 * The most this clip can cost, given that a bound reference video's duration
 * is not knowable before submitting.
 *
 * Both schemes bill input seconds alongside output, so a shot with a reference
 * video costs strictly more than its own length. `vs` used to exclude the
 * input entirely and print a warning, which meant `--max-cost` was enforcing a
 * number it knew was too low. Quoting the worst case instead keeps the ceiling
 * honest, and the low end still shows what a short reference would cost.
 *
 * Token billing gets a second correction: input-bound requests bill at the
 * CHEAPER with-video rate. Applying that discount to an under-counted token
 * base would have under-quoted twice, which is why it went unused until there
 * was a real input figure to apply it to.
 */
export function usdCeilingForClip(spec: ClipSpec): number {
  const capabilities = lookupModel(spec.modelId);
  const maxInput = capabilities.maxInputVideoSeconds;
  const unknownInput =
    (spec.referenceVideos ?? 0) > 0 && spec.inputVideoSeconds === undefined;
  if (!(unknownInput && maxInput)) {
    return usdForClip(spec);
  }
  const worstCase: ClipSpec = { ...spec, inputVideoSeconds: maxInput };
  if (capabilities.billing.kind === "perSecond") {
    return usdForClip(worstCase);
  }
  return usdForTokens(
    clipTokens(worstCase),
    spec.modelId,
    spec.resolution ?? DEFAULT_RESOLUTION,
    { videoInput: true }
  );
}

export function estimateClip(spec: ClipSpec): CostEstimate {
  // Tokens are meaningless for a per-second model, and reporting a made-up
  // figure would put a number in the audit trail nobody was ever billed for.
  // Zero reads as "not billed in tokens", and `formatEstimate` omits the clause.
  const tokens =
    lookupModel(spec.modelId).billing.kind === "tokens" ? clipTokens(spec) : 0;
  return {
    clips: 1,
    seconds: billableSeconds(spec.duration),
    tokens,
    usd: usdForClip(spec),
    usdMax: usdCeilingForClip(spec),
  };
}

/** Total for a batch of shots, e.g. everything a `vs generate` run would submit. */
export function estimateClips(specs: readonly ClipSpec[]): CostEstimate {
  const total: CostEstimate = {
    clips: 0,
    seconds: 0,
    tokens: 0,
    usd: 0,
    usdMax: 0,
  };
  for (const spec of specs) {
    const clip = estimateClip(spec);
    total.clips += 1;
    total.seconds += clip.seconds;
    total.tokens += clip.tokens;
    total.usd += clip.usd;
    total.usdMax += clip.usdMax;
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
  // The HIGH end, deliberately. A ceiling that lets a run through on its
  // best case and then bills the worst is not a ceiling.
  //
  // Falls back to `usd` because `usdMax` is newer than this function and this
  // is the one place that must never throw: an estimate built before the range
  // existed would otherwise crash with a bare TypeError out of the guard whose
  // entire job is refusing to overspend.
  const usd =
    typeof estimate === "number" ? estimate : (estimate.usdMax ?? estimate.usd);
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

/**
 * Compact human string, e.g. "4.4M tokens ≈ $25".
 *
 * A per-second model reports no tokens, and "0K tokens ≈ $9.60" reads as a
 * broken estimate rather than a different billing scheme. The dollars are the
 * number that matters in both cases, so they are the only one always shown.
 */
export function formatEstimate(
  tokens: number,
  usd: number,
  usdMax = usd
): string {
  // A range only when the two ends genuinely differ, so the common case reads
  // exactly as it always has. Rounding first, so "$1.20-$1.20" is impossible.
  const low = usd.toFixed(2);
  const high = usdMax.toFixed(2);
  const dollars = low === high ? `$${low}` : `$${low}-$${high}`;
  return tokens > 0 ? `${formatTokens(tokens)} tokens ≈ ${dollars}` : dollars;
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
