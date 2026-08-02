import {
  ASPECT_RATIOS,
  DEFAULT_FPS,
  DURATION_AUTO,
  RESOLUTIONS,
} from "./types.js";
import type {
  AspectRatio,
  ReferenceRole,
  ReferenceSlots,
  Resolution,
} from "./types.js";

/**
 * Model capabilities as DATA, so a new model (a Seedance release, 4K, another
 * provider entirely) is a registry entry rather than a code change. Nothing
 * here hardcodes a vendor prefix: the same three Seedance 2.0 models ship as
 * `dreamina-*` on BytePlus, `doubao-*` on Volcengine, and bare `seedance-*`
 * for the older releases, so ids are normalised to a family before lookup.
 *
 * The registry is advisory, never a gate. An id it has never seen resolves to
 * a permissive fallback and the API stays the authority (same philosophy as
 * the assumed limits in src/types.ts): a user configuring a model released
 * after this file was written should get a warning at worst, not a refusal.
 */

export type DurationSupport =
  | { kind: "range"; min: number; max: number; auto: boolean }
  | { kind: "enum"; values: readonly number[] };

export interface RateLimits {
  /** Requests per minute. Overage returns an error. */
  rpm: number;
  /** Simultaneous in-flight tasks. Overage queues rather than erroring. */
  concurrency: number;
}

export type Billing =
  | {
      kind: "tokens";
      /** USD per 1M output tokens. Missing entries fall back to the dearest listed rate. */
      usdPerMTokenByResolution: Partial<Record<Resolution, number>>;
    }
  | { kind: "perSecond"; usdPerSecond: number };

export interface ModelCapabilities {
  /** The id as supplied by the caller (registry entries are keyed by family). */
  id: string;
  /** Normalised family key, e.g. "seedance-2-0-fast". */
  family: string;
  /**
   * `documented` = taken from the provider's published docs. `inferred` = a
   * best guess, so `validateShotAgainstModel` downgrades everything it finds
   * to a warning rather than telling a user their shot is invalid on a hunch.
   */
  confidence: "documented" | "inferred";
  /** False for the fallback synthesised for an unrecognised id. */
  known: boolean;
  durations: DurationSupport;
  fps: number;
  resolutions: readonly Resolution[];
  aspectRatios: readonly AspectRatio[];
  /** `always` = audio regardless of generate_audio; `none` = silent output. */
  audio: "always" | "optional" | "none";
  /** Empty = no published per-role maximum, so references go unpoliced. */
  referenceSlots: ReferenceSlots;
  billing: Billing;
  limits: RateLimits & {
    /** Per-resolution overrides, e.g. 4K is throttled far harder than 1080p. */
    byResolution?: Partial<Record<Resolution, RateLimits>>;
  };
  notes?: string;
}

/** Model ids observed in the wild, for docs/scaffolding. Lookup does not need them. */
export const MODEL_IDS = {
  seedance10Pro: "seedance-1-0-pro-250528",
  seedance15Pro: "seedance-1-5-pro-251215",
  seedance20: "dreamina-seedance-2-0-260128",
  seedance20Fast: "dreamina-seedance-2-0-fast-260128",
  seedance20Mini: "dreamina-seedance-2-0-mini-260615",
  /** Published on ModelArk console; API/Playground still marked coming soon. */
  seedance25: "dreamina-seedance-2-5-260628",
} as const;

/** Seedance 2.5 console rate (USD / 1M tokens) without video input. */
const SEEDANCE_25_USD_PER_MTOKEN = 10.7;

/** CONFIRMED on the 2.5 console card: 4-30s. Auto (-1) is unconfirmed. */
const SEEDANCE_25_DURATIONS: DurationSupport = {
  auto: false,
  kind: "range",
  max: 30,
  min: 4,
};

/** Product/console ceiling for 2.5 multimodal refs. */
const SEEDANCE_25_REFERENCE_SLOTS: ReferenceSlots = {
  first_frame: 1,
  last_frame: 1,
  reference_audio: 10,
  reference_image: 30,
  reference_video: 10,
};

/** Console card: 1 concurrent task, 60 RPM. */
const SEEDANCE_25_LIMITS: RateLimits = { concurrency: 1, rpm: 60 };

/**
 * USD per 1M output tokens. The docs quote $3.5-$7.7 for Seedance 2.0 without
 * video input (and a cheaper $2.1-$4.7 WITH video input, which is why an
 * image/frame-anchored shot is both more consistent and cheaper), varying by
 * resolution. The per-resolution breakdown is not published, so every entry
 * quotes the ceiling: an estimate that over-quotes is a survivable surprise,
 * one that under-quotes is a bill. Replace these with the console's real rates
 * once a run has been reconciled (see `reconcileTokens` in src/cost.ts).
 *
 * Note the 4K trap: 4K's per-token rate is LOWER than 1080p's, which reads
 * like a discount and is not, because 4K burns ~4x the tokens.
 */
const STANDARD_USD_PER_MTOKEN = 7.7;
/** The `fast` variant is ~27% cheaper per token than standard. */
const FAST_USD_PER_MTOKEN = 5.6;

/** CONFIRMED for the individual account tier. Enterprise gets 600 rpm / 10 concurrent. */
const INDIVIDUAL_LIMITS: RateLimits = { concurrency: 3, rpm: 180 };
/** CONFIRMED: 4K is throttled to a single task at a time. Plan runs accordingly. */
const FOUR_K_LIMITS: RateLimits = { concurrency: 1, rpm: 15 };

/** CONFIRMED for Seedance 2.0: 4-15s, or -1 to let the model choose. */
const SEEDANCE_DURATIONS: DurationSupport = {
  auto: true,
  kind: "range",
  max: 15,
  min: 4,
};

/**
 * Seedance 2.0 platform ceilings per role (hard errors in validateShotAgainstModel).
 * Soft quality guidance (~5 total refs) lives in lintShotsFile, not here.
 * Frame roles: one opening / one closing; frame mode cannot mix with
 * reference_* (enforced in src/shots.ts).
 */
const SEEDANCE_REFERENCE_SLOTS: ReferenceSlots = {
  first_frame: 1,
  last_frame: 1,
  reference_audio: 3,
  reference_image: 9,
  reference_video: 3,
};

type RegistryEntry = Omit<ModelCapabilities, "family" | "id" | "known">;

/**
 * Keyed by normalised family id. Add a model by adding an entry: no lookup,
 * validation, or cost code needs to change.
 */
export const MODEL_REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  "seedance-1-0-pro": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      usdPerMTokenByResolution: {
        "1080p": STANDARD_USD_PER_MTOKEN,
        "480p": STANDARD_USD_PER_MTOKEN,
        "720p": STANDARD_USD_PER_MTOKEN,
      },
    },
    confidence: "inferred",
    durations: SEEDANCE_DURATIONS,
    fps: DEFAULT_FPS,
    limits: INDIVIDUAL_LIMITS,
    notes:
      "Pre-2.0 release. Capabilities carried over from the 2.0 envelope and NOT confirmed against 1.x docs, so problems are reported as warnings.",
    referenceSlots: {},
    resolutions: ["480p", "720p", "1080p"],
  },
  "seedance-1-5-pro": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      usdPerMTokenByResolution: {
        "1080p": STANDARD_USD_PER_MTOKEN,
        "480p": STANDARD_USD_PER_MTOKEN,
        "720p": STANDARD_USD_PER_MTOKEN,
      },
    },
    confidence: "inferred",
    durations: SEEDANCE_DURATIONS,
    fps: DEFAULT_FPS,
    limits: INDIVIDUAL_LIMITS,
    notes:
      "Pre-2.0 release. Capabilities carried over from the 2.0 envelope and NOT confirmed against 1.x docs, so problems are reported as warnings.",
    referenceSlots: {},
    resolutions: ["480p", "720p", "1080p"],
  },
  "seedance-2-0": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      usdPerMTokenByResolution: {
        "1080p": STANDARD_USD_PER_MTOKEN,
        "480p": STANDARD_USD_PER_MTOKEN,
        "4k": STANDARD_USD_PER_MTOKEN,
        "720p": STANDARD_USD_PER_MTOKEN,
      },
    },
    confidence: "documented",
    durations: SEEDANCE_DURATIONS,
    fps: DEFAULT_FPS,
    limits: { ...INDIVIDUAL_LIMITS, byResolution: { "4k": FOUR_K_LIMITS } },
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: RESOLUTIONS,
  },
  "seedance-2-0-fast": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      usdPerMTokenByResolution: {
        "480p": FAST_USD_PER_MTOKEN,
        "720p": FAST_USD_PER_MTOKEN,
      },
    },
    confidence: "documented",
    durations: SEEDANCE_DURATIONS,
    fps: DEFAULT_FPS,
    limits: INDIVIDUAL_LIMITS,
    notes: "480p/720p only, the draft-pass model. ~27% cheaper than standard.",
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
  "seedance-2-0-mini": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      // No published rate. Quotes the `fast` rate as a floor-ish ceiling;
      // mini should not cost MORE than fast, so this may over-quote.
      usdPerMTokenByResolution: {
        "480p": FAST_USD_PER_MTOKEN,
        "720p": FAST_USD_PER_MTOKEN,
      },
    },
    confidence: "documented",
    durations: SEEDANCE_DURATIONS,
    fps: DEFAULT_FPS,
    limits: INDIVIDUAL_LIMITS,
    notes: "480p/720p only. Pricing not published; quoted at the fast rate.",
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
  "seedance-2-5": {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      // Quote the without-video ceiling so estimates never undersell. With
      // video input the console lists 6.4 USD/M.
      usdPerMTokenByResolution: {
        "480p": SEEDANCE_25_USD_PER_MTOKEN,
        "720p": SEEDANCE_25_USD_PER_MTOKEN,
      },
    },
    confidence: "inferred",
    durations: SEEDANCE_25_DURATIONS,
    fps: DEFAULT_FPS,
    limits: SEEDANCE_25_LIMITS,
    notes:
      "Console id + rates published; API/Playground marked coming soon (docs 1520757). 480p/720p only. Do not set as film.model default until a live create-task succeeds.",
    referenceSlots: SEEDANCE_25_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
};

/**
 * Vendor prefixes seen on the same underlying models. Stripped before lookup
 * so one registry entry covers BytePlus, Volcengine, and bare ids.
 */
const VENDOR_PREFIXES = ["dreamina-", "doubao-", "dola-"] as const;
/** Trailing release stamp, e.g. `-260128`. */
const RELEASE_SUFFIX = /-\d{6,}$/u;

/** `Dreamina-Seedance-2.0-fast-260128` -> `seedance-2-0-fast`. */
export function normalizeModelId(modelId: string): string {
  let id = modelId.trim().toLowerCase().replaceAll(".", "-");
  for (const prefix of VENDOR_PREFIXES) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }
  return id.replace(RELEASE_SUFFIX, "");
}

/**
 * Permissive stand-in for an id the registry has never seen. Wide enough that
 * nothing it describes will reject a legitimate shot, and `known: false` makes
 * `validateShotAgainstModel` skip capability checks entirely.
 */
function fallbackCapabilities(modelId: string): ModelCapabilities {
  return {
    aspectRatios: ASPECT_RATIOS,
    audio: "optional",
    billing: {
      kind: "tokens",
      usdPerMTokenByResolution: {
        "1080p": STANDARD_USD_PER_MTOKEN,
        "480p": STANDARD_USD_PER_MTOKEN,
        "4k": STANDARD_USD_PER_MTOKEN,
        "720p": STANDARD_USD_PER_MTOKEN,
      },
    },
    confidence: "inferred",
    durations: {
      auto: true,
      kind: "range",
      max: Number.POSITIVE_INFINITY,
      min: 1,
    },
    family: normalizeModelId(modelId),
    fps: DEFAULT_FPS,
    id: modelId,
    known: false,
    limits: INDIVIDUAL_LIMITS,
    notes:
      "Unknown model id: capabilities are a permissive guess and the API is the authority. Cost is quoted at the dearest known rate.",
    referenceSlots: {},
    resolutions: RESOLUTIONS,
  };
}

/** Capabilities for a model id. Never throws: an unknown id gets the fallback. */
export function lookupModel(modelId?: string): ModelCapabilities {
  if (!modelId) {
    return fallbackCapabilities("");
  }
  const family = normalizeModelId(modelId);
  const entry = MODEL_REGISTRY[family];
  if (!entry) {
    return fallbackCapabilities(modelId);
  }
  return { ...entry, family, id: modelId, known: true };
}

export function isKnownModel(modelId: string): boolean {
  return normalizeModelId(modelId) in MODEL_REGISTRY;
}

/**
 * Rate limits for a model at a resolution. 4K's single-slot concurrency is the
 * one that bites: a `--concurrency 3` run of 4K shots just queues.
 */
export function modelRateLimits(
  modelId?: string,
  resolution?: Resolution
): RateLimits {
  const { limits } = lookupModel(modelId);
  const override = resolution ? limits.byResolution?.[resolution] : undefined;
  return override ?? { concurrency: limits.concurrency, rpm: limits.rpm };
}

/**
 * USD per 1M output tokens at a resolution. An unlisted resolution falls back
 * to the dearest listed rate rather than to zero, so an unpriced combination
 * over-quotes instead of silently costing nothing.
 */
export function usdPerMToken(
  capabilities: ModelCapabilities,
  resolution: Resolution
): number {
  if (capabilities.billing.kind !== "tokens") {
    return 0;
  }
  const table = capabilities.billing.usdPerMTokenByResolution;
  const listed = table[resolution];
  if (listed !== undefined) {
    return listed;
  }
  const rates = Object.values(table).filter(
    (rate): rate is number => rate !== undefined
  );
  return rates.length > 0 ? Math.max(...rates) : STANDARD_USD_PER_MTOKEN;
}

export interface CapabilityProblem {
  field: "duration" | "resolution" | "ratio" | "audio" | "references";
  message: string;
  /** `warning` where the capability itself is a guess: report, do not block. */
  severity: "error" | "warning";
}

/** The subset of a Shot that capability checks look at. A `Shot` satisfies it. */
export interface ShotCapabilityInput {
  duration?: number;
  ratio?: AspectRatio;
  resolution?: Resolution;
  generateAudio?: boolean;
  references?: readonly { role: ReferenceRole }[];
}

function describeDurations(support: DurationSupport): string {
  return support.kind === "range"
    ? `${support.min}-${support.max}s${support.auto ? " (or -1 for auto)" : ""}`
    : `${support.values.join("s, ")}s`;
}

function durationProblem(
  duration: number,
  support: DurationSupport
): string | undefined {
  if (duration === DURATION_AUTO) {
    const autoOk =
      support.kind === "range"
        ? support.auto
        : support.values.includes(DURATION_AUTO);
    return autoOk
      ? undefined
      : "auto duration (-1) is not supported; set an explicit duration";
  }
  if (support.kind === "enum") {
    return support.values.includes(duration)
      ? undefined
      : `duration ${duration}s is not one of ${describeDurations(support)}`;
  }
  if (duration < support.min || duration > support.max) {
    return `duration ${duration}s is outside ${describeDurations(support)}`;
  }
  return undefined;
}

function referenceProblems(
  references: readonly { role: ReferenceRole }[],
  slots: ReferenceSlots
): string[] {
  const counts = new Map<string, number>();
  for (const reference of references) {
    counts.set(reference.role, (counts.get(reference.role) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const [role, count] of counts) {
    const allowed = slots[role];
    if (allowed === undefined) {
      problems.push(`does not accept \`${role}\` references`);
    } else if (count > allowed) {
      problems.push(
        `${count} \`${role}\` references, but at most ${allowed} is supported`
      );
    }
  }
  return problems;
}

/**
 * Pure capability check of a shot against its model. Returns problems, never
 * throws, and returns NOTHING for an unrecognised model: the alternative is
 * refusing to generate because this file has not been updated yet. The
 * hardcoded 4-30s envelope in src/types.ts is a schema-level ceiling; per-model
 * caps (e.g. 2.0's 4-15s, 2.5's 4-30s) are enforced here.
 */
export function validateShotAgainstModel(
  modelId: string | undefined,
  shot: ShotCapabilityInput
): CapabilityProblem[] {
  const capabilities = lookupModel(modelId);
  if (!capabilities.known) {
    return [];
  }
  const severity =
    capabilities.confidence === "documented" ? "error" : "warning";
  const label = capabilities.id || capabilities.family;
  const problems: CapabilityProblem[] = [];

  if (shot.duration !== undefined) {
    const message = durationProblem(shot.duration, capabilities.durations);
    if (message) {
      problems.push({
        field: "duration",
        message: `${label}: ${message}`,
        severity,
      });
    }
  }
  if (
    shot.resolution !== undefined &&
    !capabilities.resolutions.includes(shot.resolution)
  ) {
    problems.push({
      field: "resolution",
      message: `${label}: ${shot.resolution} is not supported (supports ${capabilities.resolutions.join(", ")})`,
      severity,
    });
  }
  if (
    shot.ratio !== undefined &&
    !capabilities.aspectRatios.includes(shot.ratio)
  ) {
    problems.push({
      field: "ratio",
      message: `${label}: ratio ${shot.ratio} is not supported (supports ${capabilities.aspectRatios.join(", ")})`,
      severity,
    });
  }
  if (shot.generateAudio === true && capabilities.audio === "none") {
    problems.push({
      field: "audio",
      message: `${label}: generates silent video; score the cut at stitch time instead`,
      severity,
    });
  }
  if (shot.generateAudio === false && capabilities.audio === "always") {
    problems.push({
      field: "audio",
      message: `${label}: always generates audio, so generate_audio: false is ignored`,
      severity: "warning",
    });
  }
  const slots = capabilities.referenceSlots;
  if (shot.references?.length && Object.keys(slots).length > 0) {
    for (const message of referenceProblems(shot.references, slots)) {
      problems.push({
        field: "references",
        message: `${label}: ${message}`,
        severity,
      });
    }
  }
  return problems;
}
