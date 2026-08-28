import type { ProviderId } from "./models.js";

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
 * The subset a STILL can use.
 *
 * `adaptive` asks a video model to derive the frame from a reference clip. A
 * still has no such frame to adapt to, and the image backend wants a literal
 * `{w}:{h}`, so authoring `adaptive` here would send a string the API cannot
 * read. Refusing it at load time beats a confusing 400 mid-run.
 */
export const STILL_ASPECT_RATIOS = ASPECT_RATIOS.filter(
  (ratio): ratio is Exclude<AspectRatio, "adaptive"> => ratio !== "adaptive"
);

export type StillAspectRatio = (typeof STILL_ASPECT_RATIOS)[number];

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
export const RESOLUTIONS = [
  "480p",
  "720p",
  "768p",
  "1080p",
  "2k",
  "4k",
] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const DEFAULT_RESOLUTION: Resolution = "1080p";
export const DRAFT_RESOLUTION: Resolution = "480p";

/**
 * Short side (px) each resolution renders. CONFIRMED against the docs' worked
 * token examples at 16:9 (720p = 1280x720, 1080p = 1920x1080, 4K = 3840x2160).
 *
 * THE NAMING TRAP: `4k` and `2k` are named for their LONG sides (3840 and
 * 2560) while every `NNNp` name is its short side. Both are pinned by their
 * SHORT side here so one formula covers every aspect ratio, which is why `4k`
 * reads 2160 and `2k` reads 1440 rather than the numbers in their names. `2k`
 * is MiniMax H3's native output (2560x1440); `768p` is its cheaper tier.
 */
export const RESOLUTION_SHORT_SIDE: Record<Resolution, number> = {
  "1080p": 1080,
  "2k": 1440,
  "480p": 480,
  "4k": 2160,
  "720p": 720,
  "768p": 768,
};

/** CONFIRMED: every Seedance model renders 24 fps. Token cost scales with it. */
export const DEFAULT_FPS = 24;

/**
 * Coarse duration bounds used for schema validation before a model is known.
 * Outer envelope admits Seedance 2.5 (4-30s). Per-model duration support lives
 * in src/models.ts and is enforced by `validateShotAgainstModel` at generate
 * time (2.0 stays 4-15s).
 */
export const DURATION_MIN = 4;
/** Widest known Seedance max (2.5). Per-model caps are enforced at generate. */
export const DURATION_MAX = 30;
/** Pass -1 to let the model choose the clip length. */
export const DURATION_AUTO = -1;
/** Fallback clip length when neither the shot nor the film sets one. */
export const DEFAULT_DURATION = 8;

/** The five roles this CLI knows how to build a payload for. */
const REFERENCE_ROLES = [
  "reference_image",
  "reference_video",
  "reference_audio",
  "first_frame",
  "last_frame",
] as const;

type KnownReferenceRole = (typeof REFERENCE_ROLES)[number];

/**
 * Open on purpose for TypeScript call sites. Autocomplete covers the five
 * KnownReferenceRole values this CLI builds payloads for. shots.json still
 * validates against a closed zod enum in src/shots.ts — do not invent product
 * demo roles (clay, green-screen, etc.) as wire `role` strings until ModelArk
 * documents them.
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
  /**
   * https URL, or a local path relative to the shots file: images on any model,
   * video/audio on Seedance 2.5 only and under a 20 MB ceiling.
   */
  url: string;
  role: ReferenceRole;
  /**
   * The character (`id`, or `id:variant`) whose sheet this reference is, when
   * `vs cast sync` put it here. AUTHORING-ONLY: every adapter builds its content
   * item from `type`/`url`/`role` by name, so this never reaches the wire and a
   * synced reference hashes byte-identically to the same one typed by hand.
   *
   * It exists so sync can find and replace exactly what it wrote last run
   * without touching a hand-authored reference beside it.
   */
  cast?: string;
}

export interface Shot {
  id: string;
  prompt: string;
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
  /**
   * Characters in this shot, as `characters.json` ids (or `id:variant`).
   * Hand-authored INPUT to `vs cast sync`, which reads it and writes
   * `castPrompt` and the matching references. Nothing at generate time reads it.
   */
  cast?: string[];
  /**
   * The binding block: one sentence per `cast` member, naming the character and
   * the single job its reference does. GENERATED by `vs cast sync` — it is
   * rewritten wholesale on every run, so hand edits are lost. Edit
   * `characters.json` instead.
   *
   * Unlike `cast`, this IS prompt text: `composePrompt` puts it between
   * `film.promptPreamble` and the shot prompt, which is the documented order
   * (binding block, then plan, then invariants).
   */
  castPrompt?: string;
  /** Output filename, defaults to `${id}.mp4`. */
  output?: string;
  seed?: number;
  /**
   * Crossfade INTO this shot from the previous timeline item, in seconds
   * (schema min 0.05). Omit and use `vs stitch --xfade 0` for a true hard cut.
   * Overrides `--xfade` when set.
   */
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

interface FilmConfig {
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
  /**
   * Legacy pixel size from the Seedream era. Nano Banana takes a ratio, not
   * pixels, so this is IGNORED and `lintStillsFile` says so. Kept in the schema
   * only so an existing stills.json still loads instead of hard-failing on an
   * unknown key.
   */
  size?: string;
  /** Output aspect ratio; falls back to the file `ratio`. */
  ratio?: StillAspectRatio;
  seed?: number;
  /**
   * The character (`id`, or `id:variant`) this is the sheet for, when
   * `vs cast sync` generated it. The mirror of `ShotReference.cast`, and it
   * marks OWNERSHIP: sync rewrites and prunes the stills carrying it, and
   * refuses to clobber one without it. Hand-written keyframe prompts are real
   * work with no undo, so an id collision has to be an error rather than an
   * overwrite.
   */
  cast?: string;
}

export interface StillsFile {
  model?: string;
  outputDir?: string;
  /** Default aspect ratio for Nano Banana stills; per-still `ratio` overrides it. */
  ratio?: StillAspectRatio;
  stills: Still[];
}

/**
 * How to generate one character's sheet still.
 *
 * Omitting `sheet` entirely makes the character TEXT-ONLY: its block still goes
 * into every shot it appears in, but it gets no still, no reference and no
 * `@Image N`. That is the right shape for a character who only ever appears in
 * frame-mode shots — its likeness already lives in the keyframe, so a sheet
 * would burn an image call for nothing.
 */
export interface CharacterSheet {
  /**
   * Replaces the composition line only. The style block, the character block
   * and the no-text clause still wrap it — a wholesale override that dropped
   * the no-text clause would put lettering in the sheet, and Seedance renders
   * lettering it finds in a reference straight into the video.
   */
  prompt?: string;
  /** Defaults to 16:9: three panels side by side need a wide frame. */
  ratio?: StillAspectRatio;
  /** Likeness photos or style plates, as local paths relative to the stills file. */
  references?: string[];
  seed?: number;
}

/**
 * One age block or wardrobe change. Addressed from a shot as `id:variant`, and
 * generated as its own sheet, because a character who ages is two likenesses
 * that must not be averaged together.
 */
interface CharacterVariant {
  id: string;
  /** Overrides the character's block for shots that name this variant. */
  block: string;
  binding?: string;
  sheet?: CharacterSheet;
}

export interface Character {
  id: string;
  /** How the prompt names them, e.g. "THE KEEPER". */
  name: string;
  /**
   * The verbatim appearance sentence, with NO trailing punctuation: sync joins
   * it into `{name} is {block}; use @Image N for {binding}.`, and that is only
   * idempotent if the parts do not carry their own terminators.
   */
  block: string;
  /**
   * The single job this character's reference does, e.g. "his face, build and
   * wardrobe only". Required once the character has a `sheet` — naming one job
   * and nothing else is what stops the model averaging the references together.
   */
  binding?: string;
  sheet?: CharacterSheet;
  variants?: CharacterVariant[];
}

/**
 * The cast of one film. AUTHORING-TIME ONLY: nothing in the generate path reads
 * this file. `vs cast sync` expands it into literal content in shots.json and
 * stills.json, which stay the source of truth for what gets sent — which is
 * what keeps `payloadHash` an audit record of the body you can read.
 */
export interface CharactersFile {
  /**
   * The look every sheet inherits, prepended to each composed sheet prompt.
   * Without it the sheets lock a different visual language than the keyframes
   * they exist to anchor. Keep it short: a sheet prompt is capped like any
   * still, and the composed block is already most of the budget.
   */
  style?: string;
  characters: Character[];
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
    /**
     * Inline bytes from a bridged model (AI Gateway base64/binary). Runtime
     * only — never written to the manifest.
     */
    videoBytes?: Uint8Array;
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
    /**
     * Which backend answered. A fact about what went on the wire, same as
     * every other field here: a bare task id says nothing about who holds it,
     * so without this `vs status <taskId>` cannot know where to look.
     */
    provider?: ProviderId;
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
