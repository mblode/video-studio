import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { VsError } from "./errors.js";
import { DEFAULT_VIDEO_MODEL } from "./models.js";
import { safeJoin } from "./paths.js";
import type { VideoModelV1CallOptions } from "./spec/video-model.js";
import { DEFAULT_DURATION, DEFAULT_RESOLUTION } from "./types.js";
import type {
  AspectRatio,
  FilmDefaults,
  Resolution,
  Shot,
  ShotReference,
  ShotsFile,
} from "./types.js";

/**
 * Re-exported so this module's public surface is unchanged; the constant itself
 * lives beside the registry in src/models.ts, where `lintShotsFile` can reach
 * it without importing this file.
 */
export { DEFAULT_VIDEO_MODEL } from "./models.js";
/** Confirmed fast variant (~27% cheaper). Opt in per film via `film.draftModel`. */
export const DRAFT_VIDEO_MODEL = "dreamina-seedance-2-0-fast-260128";

const BASE_DEFAULTS: FilmDefaults = {
  cameraFixed: false,
  duration: DEFAULT_DURATION,
  generateAudio: true,
  ratio: "16:9",
  watermark: false,
};

/**
 * Per-run overrides applied on top of the shot/film values, without mutating
 * shots.json. `vs generate --draft` uses this to force a cheap 480p, audio-off
 * pass (and optionally a faster/cheaper model) while leaving the authored
 * values intact for the final run.
 */
export interface PayloadOverrides {
  resolution?: Resolution;
  generateAudio?: boolean;
  model?: string;
}

/**
 * What a shot will actually be generated with, after the
 * `override ?? shot ?? film.defaults ?? BASE_DEFAULTS` ladder.
 */
export interface EffectiveShotParams {
  cameraFixed: boolean;
  duration: number;
  generateAudio: boolean;
  model: string;
  ratio: AspectRatio;
  /**
   * The resolution the model renders at, which is what a cost estimate has to
   * price. When `emitResolution` is false this is the API's own default rather
   * than anything the film asked for.
   */
  resolution: Resolution;
  /**
   * Whether `resolution` goes on the wire. False means nothing set one, and the
   * payload OMITS the field so the API applies its default — the doc example
   * omits it, so an unconfigured film never risks an unknown-field reject. The
   * estimate still prices `resolution`, so this flag is the whole of the
   * difference between what we send and what we quote.
   */
  emitResolution: boolean;
  watermark: boolean;
}

/**
 * Resolve every generation parameter for one shot, once.
 *
 * THE LADDER LIVES HERE ONLY. `buildTaskPayload` sends these values and
 * `vs generate` prices them, and a second copy of the ladder is a bill that
 * disagrees with the wire while every test still passes. Costs are a safety
 * property in this CLI (see SECURITY.md), so the estimate is only honest if it
 * is derived from the same resolution as the request.
 */
export function effectiveShotParams(
  shot: Shot,
  film: ShotsFile["film"],
  overrides: PayloadOverrides = {}
): EffectiveShotParams {
  const defaults = { ...BASE_DEFAULTS, ...film.defaults };
  const resolution =
    overrides.resolution ?? shot.resolution ?? defaults.resolution;
  return {
    cameraFixed: shot.cameraFixed ?? defaults.cameraFixed,
    duration: shot.duration ?? defaults.duration,
    emitResolution: resolution !== undefined,
    generateAudio: overrides.generateAudio ?? defaults.generateAudio,
    model: overrides.model ?? film.model ?? DEFAULT_VIDEO_MODEL,
    ratio: shot.ratio ?? defaults.ratio,
    resolution: resolution ?? DEFAULT_RESOLUTION,
    watermark: defaults.watermark,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  ".aac": "audio/aac",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

/**
 * Ceiling on an inlined non-image reference, measured on the FILE. The base64
 * body that goes on the wire is ~1.37x this, so 20 MB here permits ~27 MB of
 * request. A 30s 1080p clip runs to tens of megabytes, which is both a slow hash on
 * every submit and a plausible request-size rejection. Nobody has confirmed the
 * Ark `video_url` content type accepts data URLs at all (the image one is
 * documented, that is why images are inlined), so fail loudly and early with
 * the workaround rather than posting a body that may be silently truncated.
 */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

function isRemote(url: string): boolean {
  return url.startsWith("https://");
}

/**
 * Local reference paths are inlined as base64 data URLs. This is documented for
 * the Ark `image_url` content type; for video/audio it is only reachable on
 * Seedance 2.5 (the schema refuses it elsewhere) and is capped at
 * `MAX_INLINE_BYTES`. An https URL is always the supported path.
 */
export async function resolveReferenceUrl(
  url: string,
  shotsDir: string,
  skipInline: boolean
): Promise<string> {
  if (isRemote(url)) {
    return url;
  }
  const absolute = safeJoin(shotsDir, url);
  const mime = MIME_BY_EXT[extname(absolute).toLowerCase()];
  if (!mime) {
    throw new Error(
      `unsupported local extension for reference: ${url} (images png/jpg/webp; video mp4/mov/webm; audio mp3/wav/m4a/aac)`
    );
  }
  // Size FIRST, and before the skipInline return, for three reasons: reading a
  // 900 MB clip to reject it costs ~1 GB of RSS, a file over 2 GiB makes
  // readFile throw ERR_FS_FILE_TOO_LARGE (a plain Error with no code and no
  // hint, so the biggest file gets the least useful message), and `--dry-run`
  // is meant to be the "will this work before I spend" gate. `stat` costs
  // nothing and covers all three.
  if (!mime.startsWith("image/")) {
    const { size } = await stat(absolute);
    if (size > MAX_INLINE_BYTES) {
      const mb = (size / 1024 / 1024).toFixed(1);
      throw new VsError(
        "invalid_input",
        `local reference ${url} is ${mb} MB, over the ${MAX_INLINE_BYTES / 1024 / 1024} MB inline ceiling`,
        {
          hint: "upload it and reference the https URL instead (`vs share` will compress a clip first)",
        }
      );
    }
  }
  if (skipInline) {
    return `data:${mime};base64,<inlined from ${url} at submit time>`;
  }
  const bytes = await readFile(absolute);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * THE ORDINAL CONTRACT.
 *
 * Seedance 2.5 prompts bind references by ordinal, in the form
 * `"use (at)Image 1 for her face, (at)Image 2 for the room"` (written with a
 * literal at-sign in a real prompt). That ordinal is resolved against the
 * submitted `content` array, so what the author types has to match what the
 * model receives, or a $7 generation silently uses the wrong reference for the
 * wrong job. Two things make it easy to get wrong:
 *
 * 1. Ordinals count PER MEDIA TYPE, not per array index. In
 *    `[video, image, image]`, the first Image ordinal is the SECOND array entry.
 * 2. Frame roles are images on the wire, so a `first_frame` CONSUMES an image
 *    ordinal. A shot with a first_frame plus two reference_images has its
 *    keyframe at Image ordinal 1 and its packs at ordinals 2 and 3.
 *
 * `buildTaskPayload` emits the text item first, then references in authored
 * array order, so the mapping below is exactly what the model sees. The array
 * is deliberately never reordered: silently permuting it would break "what you
 * typed is what you send" and change `payloadHash` for every existing film.
 *
 * Returns the 1-based ordinal of each reference within its own media type,
 * POSITIONALLY: `ordinals[i]` belongs to `refs[i]`. Keying a Map by the
 * reference object instead would collapse an aliased array (`[ref, ref]`) to a
 * single entry and silently report ordinal 2 for the first reference, and
 * position is what the authored-order contract is actually about.
 */
export function referenceOrdinals(
  refs: readonly ShotReference[]
): readonly number[] {
  const seen: Record<ShotReference["type"], number> = {
    audio: 0,
    image: 0,
    video: 0,
  };
  return refs.map((ref) => {
    seen[ref.type] += 1;
    return seen[ref.type];
  });
}

/** How many references of each media type a shot carries, for ordinal lints. */
export function referenceCountsByType(
  refs: readonly ShotReference[]
): Record<ShotReference["type"], number> {
  const counts: Record<ShotReference["type"], number> = {
    audio: 0,
    image: 0,
    video: 0,
  };
  for (const ref of refs) {
    counts[ref.type] += 1;
  }
  return counts;
}

/** Prepend the film's locked style preamble (color script) to the shot prompt. */
function composePrompt(film: ShotsFile["film"], shot: Shot): string {
  return film.promptPreamble
    ? `${film.promptPreamble}\n\n${shot.prompt}`
    : shot.prompt;
}

/**
 * Resolve one shot into a provider-neutral generation request.
 *
 * This is where a Shot stops being an authoring concept and becomes a call.
 * It does the parameter ladder, composes the prompt, and resolves every
 * reference URL (inlining local files where the model permits it) — all things
 * that depend on the film and the filesystem, and none of which a provider
 * adapter should have to know about.
 *
 * What it deliberately does NOT do is decide the wire format. References come
 * out in AUTHORED ORDER because that order is the ordinal contract every
 * `@Image N` binding depends on (see `referenceOrdinals` above); the adapter
 * maps them to content items without reordering.
 */
export async function buildCallOptions(
  shot: Shot,
  film: ShotsFile["film"],
  shotsDir: string,
  options?: { skipInline?: boolean; overrides?: PayloadOverrides }
): Promise<VideoModelV1CallOptions> {
  const params = effectiveShotParams(shot, film, options?.overrides);
  const skipInline = options?.skipInline ?? false;

  const references: ShotReference[] = [];
  for (const ref of shot.references ?? []) {
    references.push({
      ...ref,
      url: await resolveReferenceUrl(ref.url, shotsDir, skipInline),
    });
  }

  return {
    aspectRatio: params.ratio,
    cameraFixed: params.cameraFixed,
    durationSeconds: params.duration,
    generateAudio: params.generateAudio,
    prompt: composePrompt(film, shot),
    references,
    // `emitResolution` is the whole of the difference between what we send and
    // what we quote: undefined here means nothing set one, so the field is
    // omitted and the provider applies its own default. The estimate still
    // prices a resolution, because the clip still renders at one.
    ...(params.emitResolution ? { resolution: params.resolution } : {}),
    ...(shot.seed === undefined ? {} : { seed: shot.seed }),
    watermark: params.watermark,
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Rewrite every data-URL string anywhere in a wire body via `transform`.
 *
 * Deliberately a generic walk rather than a per-content-type branch: the body
 * is now whatever a provider's `toRequestBody` returned, and this has to hold
 * for shapes this file has never seen. A data URL that leaked through
 * unhandled would be hashed in full on every submit and, worse, PRINTED in
 * full by `--dry-run` — tens of megabytes of base64 into a terminal.
 *
 * Key order is preserved (object spread over the original key order), which is
 * what keeps `hashPayload` byte-stable against the JSON this CLI has always
 * hashed.
 */
function mapDataUrls(
  value: unknown,
  transform: (url: string) => string
): unknown {
  if (typeof value === "string") {
    return value.startsWith("data:") ? transform(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapDataUrls(item, transform));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapDataUrls(item, transform),
      ])
    );
  }
  return value;
}

/**
 * Stable hash of a submitted payload for the manifest audit trail. Data-URL
 * bodies are replaced by their own sha256 first so the hash stays small to
 * compute and identical payloads always hash identically.
 */
export function hashPayload(payload: unknown): string {
  return sha256(
    JSON.stringify(mapDataUrls(payload, (url) => `sha256:${sha256(url)}`))
  );
}

/** Render a payload for --dry-run with data URLs truncated, never megabytes of base64. */
export function renderPayload(payload: unknown): string {
  return JSON.stringify(
    mapDataUrls(payload, (url) => `${url.slice(0, 64)}… (truncated)`),
    null,
    2
  );
}
