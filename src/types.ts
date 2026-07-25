/**
 * CONFIRMED from the ModelArk docs. `adaptive` is the odd one out: instead of a
 * fixed frame it asks the model to derive the aspect from the reference image,
 * so it has no numeric value (see ASPECT_RATIO_VALUE).
 */
export const ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:1",
  "21:9",
  "adaptive",
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * Width/height for each fixed ratio. `adaptive` is deliberately undefined: the
 * delivered frame is only known after generation, so callers that need a number
 * (cost estimation) must pick an explicit fallback, and callers that check a
 * delivered clip (review) must skip the check.
 */
export const ASPECT_RATIO_VALUE: Record<AspectRatio, number | undefined> = {
  "16:9": 16 / 9,
  "1:1": 1,
  "21:9": 21 / 9,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "9:16": 9 / 16,
  adaptive: undefined,
};

/**
 * Seedance `resolution` enum (short side of the frame). The API default is
 * 1080p; we draft at 480p (~5x fewer tokens) and run finals at 720p/1080p.
 * CONFIRMED from the ModelArk docs: standard Seedance 2.0 supports 480p-4K,
 * the `fast` and `mini` variants only 480p/720p (per-model support lives in
 * src/models.ts, which is the authority; this list is just the wire enum).
 */
export const RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const DEFAULT_RESOLUTION: Resolution = "1080p";
export const DRAFT_RESOLUTION: Resolution = "480p";

/**
 * Short side (px) each resolution renders. CONFIRMED against the docs' worked
 * token examples at 16:9 (720p = 1280x720, 1080p = 1920x1080, 4K = 3840x2160).
 * Note 4K is named for its LONG side but, like the others, is pinned by its
 * short side here so one formula covers every aspect ratio.
 */
export const RESOLUTION_SHORT_SIDE: Record<Resolution, number> = {
  "1080p": 1080,
  "480p": 480,
  "4k": 2160,
  "720p": 720,
};

/** CONFIRMED: every Seedance model renders 24 fps. Token cost scales with it. */
export const DEFAULT_FPS = 24;

/**
 * Coarse duration bounds used for schema validation before a model is known.
 * CONFIRMED for Seedance 2.0 (4-15s, or -1 for auto). Per-model duration
 * support lives in src/models.ts: a future model with a wider range is a
 * registry entry, not an edit here, so keep these as the outer envelope.
 */
export const DURATION_MIN = 4;
/** 15s requires the Pro tier; the API is the authority. */
export const DURATION_MAX = 15;
/** Pass -1 to let the model choose the clip length. */
export const DURATION_AUTO = -1;
/** Fallback clip length when neither the shot nor the film sets one. */
export const DEFAULT_DURATION = 8;

/**
 * Legacy per-second token heuristic, kept only for callers that still import
 * it. DO NOT use it for new estimates: the official ModelArk formula is
 * `(input_seconds + output_seconds) × width × height × fps / 1024`, which puts
 * 1080p24 at 48,600 tokens/second, not 28,000. The 28k figure came from one
 * mixed calibration batch (22,446,900 tokens across 101 calls, most of them
 * image-conditioned and below 1080p) so it silently under-quoted. src/cost.ts
 * now derives tokens from real pixel dimensions instead.
 *
 * @deprecated Use `estimateTokens` from src/cost.ts.
 */
export const TOKENS_PER_SECOND_1080P = 28_000;
/**
 * Token cost of a resolution relative to 1080p. These are pure pixel-area
 * ratios (they fall straight out of the official formula), so they stay exact:
 * 4K really is ~4x 1080p. That is the 4K trap: its per-token RATE is lower
 * than 1080p's, which reads like a discount but is swamped by 4x the tokens.
 */
export const RESOLUTION_TOKEN_FACTOR: Record<Resolution, number> = {
  "1080p": 1,
  "480p": 0.2,
  "4k": 4,
  "720p": 0.44,
};
/**
 * USD per 1K output tokens (BytePlus ModelArk console, text-to-video rate).
 * Conditioned input (reference still / chained first_frame) is cheaper still
 * (~0.0047 standard / 0.0033 fast); we quote the t2v ceiling so estimates
 * never undersell. The `fast` model (Dreamina-Seedance-2.0-fast) is ~27%
 * cheaper — opt in per film via `film.draftModel`.
 */
export const VIDEO_USD_PER_KTOKEN: Record<"standard" | "fast", number> = {
  fast: 0.0056,
  standard: 0.0077,
};

/** The five roles this CLI knows how to build a payload for. */
export const REFERENCE_ROLES = [
  "reference_image",
  "reference_video",
  "reference_audio",
  "first_frame",
  "last_frame",
] as const;

export type KnownReferenceRole = (typeof REFERENCE_ROLES)[number];

/**
 * Open on purpose. The five known roles still autocomplete and typo-check
 * inside object literals, but the type does not close the set, because new
 * Seedance releases keep adding roles (2.5 announces 3D-blockout and
 * green-screen-plate inputs) that map to nothing in this codebase yet. The
 * wire is a string; the model, not us, is the authority on which roles exist.
 * Validation of what we accept in shots.json stays a zod enum in src/shots.ts.
 */
// `string & {}` is the open-enum idiom: it keeps the literal autocomplete that
// a bare `| string` would collapse. Deliberate, hence the suppression.
// oxlint-disable-next-line typescript/ban-types
export type ReferenceRole = KnownReferenceRole | (string & {});

/**
 * How many references of each role a model accepts. Known roles autocomplete;
 * unknown ones are permitted so a registry entry can describe a role this
 * codebase has no constant for.
 */
export type ReferenceSlots = Partial<Record<KnownReferenceRole, number>> &
  Partial<Record<string, number>>;

export interface ShotReference {
  type: "image" | "video" | "audio";
  /** https URL, or (images only) a local path relative to the shots file. */
  url: string;
  role: ReferenceRole;
}

export interface Shot {
  id: string;
  prompt: string;
  /**
   * Id of an EARLIER shot whose final frame becomes this shot's first_frame
   * (extracted locally with ffmpeg). Mutually exclusive with references —
   * Seedance's first/last-frame mode cannot mix with reference_* roles.
   */
  continueFrom?: string;
  duration?: number;
  ratio?: AspectRatio;
  /** Short-side resolution; defaults to the film default (1080p). A draft run forces 480p. */
  resolution?: Resolution;
  /**
   * Lock the camera (`camera_fixed: true`). Use on locked-camera shots (the
   * montage, talk-to-camera beats) — it kills the camera drift/flicker the
   * model otherwise improvises. Seedance has no negative prompt, so this is
   * the structural lever for a stable frame.
   */
  cameraFixed?: boolean;
  references?: ShotReference[];
  /** Output filename, defaults to `${id}.mp4`. */
  output?: string;
  seed?: number;
  /** Crossfade INTO this shot from the previous timeline item, in seconds (0.05 = hard cut). Overrides --xfade. */
  transition?: number;
}

export interface TitleCard {
  /** "start", "end", or a shot id this card follows in the stitched film. */
  after: string;
  text: string;
  /** Seconds, default 3. */
  duration?: number;
  /** Default 64. */
  fontSize?: number;
  /** Crossfade INTO this card, in seconds. Overrides --xfade. */
  transition?: number;
}

export interface FilmDefaults {
  ratio: AspectRatio;
  duration: number;
  /** Unset = let the API use its own default (1080p); set to force a resolution. */
  resolution?: Resolution;
  cameraFixed: boolean;
  generateAudio: boolean;
  watermark: boolean;
}

export interface FilmConfig {
  title: string;
  /**
   * Style/continuity block auto-prepended to every shot's prompt (a "color
   * script" the whole film inherits) — keep the look bible in one place instead
   * of re-typing it per shot. Joined to the shot prompt with a blank line.
   */
  promptPreamble?: string;
  model?: string;
  /**
   * Model id used by `vs generate --draft`. Set to the fast variant
   * (e.g. "dreamina-seedance-2-0-fast-260128", ~27% cheaper) once it is
   * activated in the BytePlus console. Unset = drafts use `model`.
   */
  draftModel?: string;
  outputDir?: string;
  defaults?: Partial<FilmDefaults>;
}

export interface ShotsFile {
  film: FilmConfig;
  shots: Shot[];
  /** Title cards rendered and inserted by `vs stitch` (composited in post). */
  cards?: TitleCard[];
}

export interface Still {
  id: string;
  prompt: string;
  /** Reference images for likeness/style: https URLs or local paths relative to the stills file. */
  references?: string[];
  /** e.g. "2560x1440"; passed through to Seedream (Nano Banana ignores it — use `ratio`). */
  size?: string;
  /** Output aspect ratio for Nano Banana (`gemini-*`); falls back to the file `ratio`. */
  ratio?: AspectRatio;
  seed?: number;
}

export interface StillsFile {
  model?: string;
  outputDir?: string;
  /** Default aspect ratio for Nano Banana stills; per-still `ratio` overrides it. */
  ratio?: AspectRatio;
  stills: Still[];
}

// --- Ark API wire types ---

export type ArkContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role?: ReferenceRole }
  | { type: "video_url"; video_url: { url: string }; role?: ReferenceRole }
  | { type: "audio_url"; audio_url: { url: string }; role?: ReferenceRole };

export interface CreateTaskRequest {
  model: string;
  content: ArkContentItem[];
  generate_audio: boolean;
  ratio: AspectRatio;
  /**
   * Short-side resolution. Optional and only emitted when explicitly set (a
   * draft override or a shot/film default) — the doc example omits it, so we
   * never send it for an unconfigured final and risk a reject on an unknown
   * field. Confirm acceptance via `vs doctor`/the first draft run.
   */
  resolution?: Resolution;
  duration: number;
  watermark: boolean;
  /** Only emitted when true — locks the camera position. */
  camera_fixed?: boolean;
  seed?: number;
  // --- Documented optional fields this CLI does not send yet ---
  // All CONFIRMED present in the create-task docs (page 1520757) and all
  // omitted from the payload unless a caller sets them, for the same reason
  // `resolution` is: an unsent field cannot be rejected, and the defaults
  // below are the ones we want anyway. Typed here so wiring one up later is a
  // payload change, not a types change.
  /** Also return the clip's last frame as `content.last_frame_url`. Default false. */
  return_last_frame?: boolean;
  /** Webhook target for task completion, instead of polling. */
  callback_url?: string;
  /** `flex` trades latency for cost/availability. Default `default`. */
  service_tier?: "default" | "flex";
  /** Queue priority 0-9. Default 0. */
  priority?: number;
  /** Seconds before an unstarted task expires. Default 172800, range 1-259200. */
  execution_expires_after?: number;
  /** Opaque end-user id for the provider's abuse tooling. */
  safety_identifier?: string;
  /** Frame count, where a model exposes it instead of `duration`. */
  frames?: number;
}

/**
 * CONFIRMED from the docs. `expired` is terminal like a failure: the task
 * record outlived `execution_expires_after` (or the 7-day retention window)
 * and will never produce a clip.
 */
export const TASK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Response shape of GET /contents/generations/tasks/{id}. Validated at the
 * client boundary (see `arkTaskSchema` in src/ark.ts), which parses only the
 * fields below: anything else the provider sends rides through untouched.
 *
 * Lifecycle, CONFIRMED: `content.video_url` is deleted 24h after success (so
 * `vs generate` downloads immediately) and the task record itself is only
 * queryable for 7 days.
 */
export interface ArkTask {
  id: string;
  model?: string;
  status: TaskStatus;
  content?: {
    video_url?: string;
    /** Present only when the request set `return_last_frame`. */
    last_frame_url?: string;
  };
  error?: { code?: string; message?: string };
  /**
   * Billed usage. For video, input tokens are always 0, so
   * `completion_tokens` is the whole bill and the figure to reconcile a cost
   * estimate against (see `reconcileTokens` in src/cost.ts).
   */
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface CreateImageRequest {
  /** Reference image inputs (https URLs or base64 data URLs). */
  image?: string[];
  model: string;
  prompt: string;
  response_format: "url" | "b64_json";
  seed?: number;
  sequential_image_generation?: "auto" | "disabled";
  /** e.g. "2048x1152" or named sizes like "2K". */
  size?: string;
  watermark?: boolean;
}

export interface CreateImageResponse {
  data: { url?: string; b64_json?: string }[];
}

// --- Manifest ---

export type ManifestStatus = TaskStatus | "submitted" | "downloaded";

/**
 * One paid generation attempt. Revisions are append-only: a retake gets the
 * next number and never replaces the task, bill, or file from an earlier take.
 */
export interface ManifestRevision {
  version: number;
  taskId: string;
  status: ManifestStatus;
  /** Relative to the manifest's directory, set once downloaded. */
  outputPath?: string;
  videoUrl?: string;
  error?: string;
  submittedAt: string;
  updatedAt: string;
  payloadHash?: string;
  tokensUsed?: number;
  params?: ManifestEntry["params"];
}

export interface ManifestEntry {
  shotId: string;
  /** Latest task, retained at the top level for readable status output. */
  taskId: string;
  status: ManifestStatus;
  /** The selected successful revision's path, relative to the manifest. */
  outputPath?: string;
  videoUrl?: string;
  error?: string;
  /** Total submissions, also the number assigned to the latest revision. */
  attempts: number;
  /** Revision used by stitch/review/chain. Failed retakes never change it. */
  selectedVersion?: number;
  /** Complete task history for this shot. */
  versions?: ManifestRevision[];
  submittedAt: string;
  updatedAt: string;
  /** sha256 of the submitted payload (data-URL bodies hashed, not embedded). */
  payloadHash?: string;
  /** Billed output tokens from the task's `usage.completion_tokens`. */
  tokensUsed?: number;
  /** Generation parameter snapshot for the audit trail. */
  params?: {
    model: string;
    duration: number;
    ratio: AspectRatio;
    /**
     * Optional because the request deliberately omits `resolution` when
     * nothing set one: recording a guess here would put a value in the audit
     * trail that was never sent. Undefined means "we let the API choose".
     */
    resolution?: Resolution;
    generateAudio: boolean;
    watermark: boolean;
    seed?: number;
  };
}

export interface Manifest {
  version: 2;
  shotsFile: string;
  entries: Record<string, ManifestEntry>;
}
