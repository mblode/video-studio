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
      /**
       * Cheaper rate when the request carries video input (region edit, extend).
       * Absent means the same rate applies either way. Deliberately NOT used by
       * the pre-flight estimate: the conditioned input seconds are unknowable
       * for a remote URL, so discounting an under-counted token base would
       * under-quote twice. An over-quote is a surprise; an under-quote is a bill.
       */
      usdPerMTokenWithVideoInput?: Partial<Record<Resolution, number>>;
    }
  | {
      kind: "perSecond";
      /**
       * USD per second of OUTPUT video, by resolution. Flat: unlike token
       * billing it does not scale with frame area, which is why a 2K
       * per-second model can undercut a 720p token-billed one.
       */
      usdPerSecondByResolution: Partial<Record<Resolution, number>>;
      /** Reference images past this many are charged. Absent = all free. */
      freeReferenceImages?: number;
      /** USD per reference image beyond `freeReferenceImages`. */
      usdPerExtraReferenceImage?: number;
      /**
       * Floor on a single task's charge, whatever was requested. Providers
       * that publish one bill the cheapest valid request as a minimum, so a
       * short cheap clip does not actually cost less than it.
       */
      minimumTaskUsd?: number;
    };

/**
 * Which backend a model id is generated on. This is registry DATA rather than a
 * branch in the commands, for the same reason everything else here is: a model
 * moving to a new backend, or a new backend arriving, should be an entry in this
 * file and nothing more.
 */
export type ProviderId = "ark" | "comfyui" | "minimax";

/**
 * What an authoring surface is allowed to do on a model.
 *
 * These describe CAPABILITIES, never models. The version this replaced was an
 * `isSeedance25()` family-string predicate driving four unrelated behaviours,
 * which meant every new model with any of those behaviours had to be added to
 * the same four `if`s. A flag that says what a model can do composes; a
 * predicate that says which model it is does not.
 */
export interface AuthoringLimits {
  /**
   * True when `first_frame`/`last_frame` and `reference_*` are mutually
   * exclusive modes. Seedance 2.0 and MiniMax H3 reject the mix; Seedance 2.5
   * combines them (its own reference-to-video demos bind a scene reference
   * alongside per-subject ones).
   */
  framesExcludeReferences: boolean;
  /**
   * True when a local video/audio reference may go on the wire as a base64 data
   * URL. False means those references must be https URLs. Images are inlinable
   * everywhere; this flag is only about the heavy media types.
   */
  inlineNonImageRefs: boolean;
  /**
   * True when prompts on this model are expected to bind each reference by
   * ordinal (`@Image 1`, `@Video 2`). Seedance 2.5 and MiniMax H3 both resolve
   * ordinals per media type in authored order; on 2.0-era models the idiom is
   * not used, so nagging about it would be noise on every existing film.
   */
  ordinalBindingIdiom: boolean;
  /** Soft quality warning threshold for total references. Not a platform cap. */
  softReferenceLimit: number;
  /** Soft prompt-length warning, in words. Longer clips legitimately need more. */
  promptWordLimit: number;
  /**
   * Hard platform ceiling on prompt length, in characters, where one is
   * published. Undefined means no documented cap, so nothing is enforced.
   */
  promptCharLimit?: number;
}

export interface ModelCapabilities extends AuthoringLimits {
  /** The id as supplied by the caller (registry entries are keyed by family). */
  id: string;
  provider: ProviderId;
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
  /** MiniMax H3, released 2026-07-31. Direct v2 API id, not a broker's. */
  minimaxH3: "MiniMax-H3",
  /** Open-weight H3 Base FL2VA served by a local ComfyUI instance. */
  minimaxH3Local: "MiniMax-H3-Local",
  seedance10Pro: "seedance-1-0-pro-250528",
  seedance15Pro: "seedance-1-5-pro-251215",
  seedance20: "dreamina-seedance-2-0-260128",
  seedance20Fast: "dreamina-seedance-2-0-fast-260128",
  seedance20Mini: "dreamina-seedance-2-0-mini-260615",
  /** Published on ModelArk console; API/Playground still marked coming soon. */
  seedance25: "dreamina-seedance-2-5-260628",
} as const;

/**
 * The model a film generates on when `film.model` is unset.
 *
 * It lives HERE, beside the registry, rather than in src/payload.ts, because
 * two unrelated places have to agree on it: `effectiveShotParams` decides what
 * goes on the wire, and `lintShotsFile` decides what to validate against. When
 * those disagree the linter checks a film against a model it will never be
 * generated on, which is the quietest possible way to waste a paid run. Same
 * reasoning as the single-ladder rule over `effectiveShotParams` itself.
 */
export const DEFAULT_VIDEO_MODEL: string = MODEL_IDS.seedance25;

/** Seedance 2.5 console rate (USD / 1M tokens) without video input. */
const SEEDANCE_25_USD_PER_MTOKEN = 10.7;
/**
 * Console rate WITH video input bound. Note this does not make a region edit
 * cheaper than a fresh pass: the formula bills (input + output) seconds, so a
 * 30s edit on a 30s source is 60s of tokens at the lower rate — about 20% MORE
 * than generating 30s fresh. Region edit buys quality, not savings.
 */
const SEEDANCE_25_USD_PER_MTOKEN_WITH_VIDEO = 6.4;

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
 * Seedance 2.0-era authoring envelope. Frame mode and omni-reference mode are
 * mutually exclusive, references must be https URLs unless they are images, and
 * quality degrades past ~5 references.
 */
const SEEDANCE_20_AUTHORING: AuthoringLimits = {
  framesExcludeReferences: true,
  inlineNonImageRefs: false,
  ordinalBindingIdiom: false,
  // Multi-beat timed-segment shots legitimately need more words than a
  // single-action shot; this warns on real bloat, not on density.
  promptWordLimit: 400,
  softReferenceLimit: 5,
};

/**
 * Seedance 2.5 authoring envelope. Both reference modes compose, local video
 * and audio may be inlined, and an 8-14 reference ordinal pack is the design
 * idiom rather than a smell — so both soft limits are much higher. A 30s act
 * carries roughly twice the beats of a 15s shot AND an ordinal binding block
 * naming each reference's single job; measured acts land at 380-430 words plus
 * preamble. Do NOT compress ordinal bindings to fit a cap.
 */
const SEEDANCE_25_AUTHORING: AuthoringLimits = {
  framesExcludeReferences: false,
  inlineNonImageRefs: true,
  ordinalBindingIdiom: true,
  promptWordLimit: 700,
  softReferenceLimit: 16,
};

/**
 * MiniMax H3 authoring envelope. It binds references by ordinal exactly as 2.5
 * does (`@Image N` counted per media type, in authored order), but its frame
 * and reference modes are mutually exclusive like 2.0's, and the docs recommend
 * URL input with a 64 MB body ceiling rather than inlined media. The 7000 is a
 * hard platform cap in CHARACTERS, unlike every other limit here.
 */
const MINIMAX_H3_AUTHORING: AuthoringLimits = {
  framesExcludeReferences: true,
  inlineNonImageRefs: false,
  ordinalBindingIdiom: true,
  promptCharLimit: 7000,
  promptWordLimit: 400,
  softReferenceLimit: 9,
};

/** CONFIRMED from the v2 docs: integer 4-15s. No auto. */
const MINIMAX_H3_DURATIONS: DurationSupport = {
  auto: false,
  kind: "range",
  max: 15,
  min: 4,
};

/**
 * CONFIRMED per-file caps from the v2 docs, with a documented 12-file total
 * across all types that this per-role table cannot express (see
 * `validateShotAgainstModel`, which checks roles independently).
 */
const MINIMAX_H3_REFERENCE_SLOTS: ReferenceSlots = {
  first_frame: 1,
  last_frame: 1,
  reference_audio: 3,
  reference_image: 9,
  reference_video: 3,
};

/**
 * Video generation is documented at 5 RPM. Concurrency is NOT published, and
 * "not specified" is not "unlimited", so this is a deliberately conservative
 * 3: at that width the initial burst cannot breach 5 RPM on the create route,
 * and multi-minute tasks then trickle well under it.
 */
const MINIMAX_H3_LIMITS: RateLimits = { concurrency: 3, rpm: 5 };

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
/**
 * Last-resort per-second rate for a per-second model whose registry entry
 * prices no resolution at all. That is a bug in this file, and the only safe
 * way to be wrong about it is expensively.
 */
const DEAREST_KNOWN_USD_PER_SECOND = 0.13;

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
  "minimax-h3": {
    ...MINIMAX_H3_AUTHORING,
    aspectRatios: ASPECT_RATIOS,
    // Native stereo audio (score, dialogue, foley) is generated jointly with
    // the picture and cannot be switched off, so `generate_audio: false` is
    // meaningless here and `validateShotAgainstModel` warns that it is ignored.
    audio: "always",
    billing: {
      // First 5 reference images free, then $0.04 each.
      freeReferenceImages: 5,
      // Flat per SECOND of output, not per token: unlike Seedance this does
      // not scale with frame area, which is how 2K here undercuts 720p there.
      kind: "perSecond",
      // The docs give the per-task minimum as "the cheapest valid request",
      // which is ambiguous: 768P x 4s is $0.32, but 768P is reportedly closed
      // beta, so on most accounts the cheapest REACHABLE request is 2K x 4s at
      // $0.52. Quote the higher one. Over-quoting a floor is survivable;
      // under-quoting it is a bill, and this is the guard `--max-cost` leans on.
      minimumTaskUsd: 0.52,
      usdPerExtraReferenceImage: 0.04,
      // Official paygo page. Several third-party trackers list 768P at $0.09;
      // if a bill ever disagrees, that discrepancy is the first thing to check.
      usdPerSecondByResolution: { "2k": 0.13, "768p": 0.08 },
    },
    confidence: "inferred",
    durations: MINIMAX_H3_DURATIONS,
    fps: DEFAULT_FPS,
    limits: MINIMAX_H3_LIMITS,
    notes:
      "Direct MiniMax v2 API. 768P is reportedly closed beta, so budget on 2K. H3 is unavailable in the UK, EU, US, and South Korea, and a wrong-region key fails as a confusing `1004 not authorized`. Confidence stays `inferred` until a live create-task succeeds.",
    provider: "minimax",
    referenceSlots: MINIMAX_H3_REFERENCE_SLOTS,
    resolutions: ["768p", "2k"],
  },
  "minimax-h3-local": {
    ...MINIMAX_H3_AUTHORING,
    aspectRatios: ASPECT_RATIOS,
    audio: "always",
    billing: {
      kind: "perSecond",
      usdPerSecondByResolution: { "480p": 0, "768p": 0 },
    },
    confidence: "documented",
    durations: MINIMAX_H3_DURATIONS,
    fps: DEFAULT_FPS,
    limits: { concurrency: 1, rpm: 1 },
    notes:
      "Local ComfyUI H3 Base FL2VA. Text-to-video only in this adapter; the CLI's 480p draft tier uses a tested ~0.2 MP low-VRAM canvas (608x352 at 16:9), while 768p is the unverified native canvas. Provider cost is zero, excluding electricity and hardware.",
    provider: "comfyui",
    referenceSlots: {},
    resolutions: ["480p", "768p"],
  },
  "seedance-1-0-pro": {
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
    referenceSlots: {},
    resolutions: ["480p", "720p", "1080p"],
  },
  "seedance-1-5-pro": {
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
    referenceSlots: {},
    resolutions: ["480p", "720p", "1080p"],
  },
  "seedance-2-0": {
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: RESOLUTIONS,
  },
  "seedance-2-0-fast": {
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
  "seedance-2-0-mini": {
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
    referenceSlots: SEEDANCE_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
  "seedance-2-5": {
    ...SEEDANCE_25_AUTHORING,
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
      usdPerMTokenWithVideoInput: {
        "480p": SEEDANCE_25_USD_PER_MTOKEN_WITH_VIDEO,
        "720p": SEEDANCE_25_USD_PER_MTOKEN_WITH_VIDEO,
      },
    },
    confidence: "inferred",
    durations: SEEDANCE_25_DURATIONS,
    fps: DEFAULT_FPS,
    limits: SEEDANCE_25_LIMITS,
    notes:
      "Console id + rates published; API/Playground marked coming soon (docs 1520757). Console card lists 480p/720p; launch marketing claims up to 4K/10-bit, which is unconfirmed and not modelled here. Confidence stays `inferred` until a live create-task succeeds, which also means a 1080p request warns rather than being refused.",
    provider: "ark",
    referenceSlots: SEEDANCE_25_REFERENCE_SLOTS,
    resolutions: ["480p", "720p"],
  },
};

/**
 * Vendor prefixes seen on the same underlying models. Stripped before lookup
 * so one registry entry covers BytePlus, Volcengine, and bare ids.
 */
/** Explicit `provider:` prefixes, stripped before anything else so that
 * `minimax:MiniMax-H3` and a bare `MiniMax-H3` resolve to the same registry
 * entry. Without this a prefixed id would miss the registry entirely and fall
 * through to the permissive fallback, which for a per-second model means a
 * $0.00 quote. */
const PROVIDER_PREFIX = /^(?:ark|comfyui|minimax):/u;
const VENDOR_PREFIXES = ["dreamina-", "doubao-", "dola-"] as const;
/** Trailing release stamp, e.g. `-260128`. */
const RELEASE_SUFFIX = /-\d{6,}$/u;

/** `Dreamina-Seedance-2.0-fast-260128` -> `seedance-2-0-fast`. */
export function normalizeModelId(modelId: string): string {
  let id = modelId
    .trim()
    .toLowerCase()
    .replace(PROVIDER_PREFIX, "")
    .replaceAll(".", "-");
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
    // The narrower authoring envelope of the two, deliberately. An unknown model
    // gets a PERMISSIVE capability envelope (`known: false` skips the checks
    // outright) but the CONSERVATIVE authoring one, because these two flags fail
    // in opposite directions: guessing `framesExcludeReferences: false` lets a
    // payload the API will reject go out and be billed, while guessing `true`
    // only produces a warning the author can read and ignore.
    ...SEEDANCE_20_AUTHORING,
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
    provider: "ark",
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
 * A rate for a resolution, falling back to the DEAREST listed rate rather than
 * to zero. Shared by both billing kinds, because both fail the same way: a
 * resolution nobody priced must over-quote, never silently cost nothing.
 */
function rateFor(
  table: Partial<Record<Resolution, number>>,
  resolution: Resolution,
  fallback: number
): number {
  const listed = table[resolution];
  if (listed !== undefined) {
    return listed;
  }
  const rates = Object.values(table).filter(
    (rate): rate is number => rate !== undefined
  );
  return rates.length > 0 ? Math.max(...rates) : fallback;
}

/**
 * USD per second of output for a per-second-billed model. Returns 0 for a
 * token-billed one, so callers must check `billing.kind` first — see
 * `usdForClip` in src/cost.ts, which is the only intended caller.
 */
export function usdPerSecond(
  capabilities: ModelCapabilities,
  resolution: Resolution
): number {
  if (capabilities.billing.kind !== "perSecond") {
    return 0;
  }
  return rateFor(
    capabilities.billing.usdPerSecondByResolution,
    resolution,
    // No published rate at any resolution is a registry bug, not a free clip.
    // Quote the dearest per-second rate this file knows about.
    DEAREST_KNOWN_USD_PER_SECOND
  );
}

/**
 * USD per 1M output tokens at a resolution. An unlisted resolution falls back
 * to the dearest listed rate rather than to zero, so an unpriced combination
 * over-quotes instead of silently costing nothing.
 */
export function usdPerMToken(
  capabilities: ModelCapabilities,
  resolution: Resolution,
  options?: { videoInput?: boolean }
): number {
  if (capabilities.billing.kind !== "tokens") {
    return 0;
  }
  const base = capabilities.billing.usdPerMTokenByResolution;
  const withVideo = options?.videoInput
    ? capabilities.billing.usdPerMTokenWithVideoInput
    : undefined;
  // Fall through PER RESOLUTION, not per table. Selecting the whole with-video
  // table first means a partial one (say 480p only) quotes the 480p rate for a
  // 1080p run, and an empty one `{}` survives `??` and collapses to the global
  // rate rather than this model's dearest. Both under-quote, in a function
  // whose whole job is to never do that.
  const listed = withVideo?.[resolution];
  if (listed !== undefined) {
    return listed;
  }
  return rateFor(base, resolution, STANDARD_USD_PER_MTOKEN);
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
