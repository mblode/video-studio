import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { safeJoin } from "./paths.js";
import { DEFAULT_DURATION } from "./types.js";
import type {
  ArkContentItem,
  CreateTaskRequest,
  FilmDefaults,
  Resolution,
  Shot,
  ShotsFile,
} from "./types.js";

export const DEFAULT_VIDEO_MODEL = "dreamina-seedance-2-0-260128";
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

const MIME_BY_EXT: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function isRemote(url: string): boolean {
  return url.startsWith("https://");
}

/**
 * Local image reference paths are inlined as base64 data URLs (the Ark
 * image_url content type accepts data URLs). Video/audio must be remote.
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
      `unsupported local image extension for reference: ${url} (use png/jpg/webp)`
    );
  }
  if (skipInline) {
    return `data:${mime};base64,<inlined from ${url} at submit time>`;
  }
  const bytes = await readFile(absolute);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Prepend the film's locked style preamble (color script) to the shot prompt. */
function composePrompt(film: ShotsFile["film"], shot: Shot): string {
  return film.promptPreamble
    ? `${film.promptPreamble}\n\n${shot.prompt}`
    : shot.prompt;
}

export async function buildTaskPayload(
  shot: Shot,
  film: ShotsFile["film"],
  shotsDir: string,
  options?: { skipInline?: boolean; overrides?: PayloadOverrides }
): Promise<CreateTaskRequest> {
  const defaults = { ...BASE_DEFAULTS, ...film.defaults };
  const overrides = options?.overrides ?? {};
  const content: ArkContentItem[] = [
    { text: composePrompt(film, shot), type: "text" },
  ];

  for (const ref of shot.references ?? []) {
    if (ref.type === "image") {
      content.push({
        image_url: {
          url: await resolveReferenceUrl(
            ref.url,
            shotsDir,
            options?.skipInline ?? false
          ),
        },
        role: ref.role,
        type: "image_url",
      });
    } else if (ref.type === "video") {
      content.push({
        role: ref.role,
        type: "video_url",
        video_url: { url: ref.url },
      });
    } else {
      content.push({
        audio_url: { url: ref.url },
        role: ref.role,
        type: "audio_url",
      });
    }
  }

  const cameraFixed = shot.cameraFixed ?? defaults.cameraFixed;
  const resolution =
    overrides.resolution ?? shot.resolution ?? defaults.resolution;
  return {
    content,
    duration: shot.duration ?? defaults.duration,
    generate_audio: overrides.generateAudio ?? defaults.generateAudio,
    model: overrides.model ?? film.model ?? DEFAULT_VIDEO_MODEL,
    ratio: shot.ratio ?? defaults.ratio,
    watermark: defaults.watermark,
    ...(resolution ? { resolution } : {}),
    ...(cameraFixed ? { camera_fixed: true } : {}),
    ...(shot.seed === undefined ? {} : { seed: shot.seed }),
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Stable hash of a submitted payload for the manifest audit trail. Data-URL
 * bodies are replaced by their own sha256 first so the hash stays small to
 * compute and identical payloads always hash identically.
 */
export function hashPayload(payload: CreateTaskRequest): string {
  const normalizedContent = payload.content.map((item) => {
    if (item.type === "image_url" && item.image_url.url.startsWith("data:")) {
      return {
        ...item,
        image_url: { url: `sha256:${sha256(item.image_url.url)}` },
      };
    }
    return item;
  });
  return sha256(JSON.stringify({ ...payload, content: normalizedContent }));
}

/** Render a payload for --dry-run with data URLs truncated, never megabytes of base64. */
export function renderPayload(payload: CreateTaskRequest): string {
  const safeContent = payload.content.map((item) => {
    if (item.type === "image_url" && item.image_url.url.startsWith("data:")) {
      return {
        ...item,
        image_url: { url: `${item.image_url.url.slice(0, 64)}… (truncated)` },
      };
    }
    return item;
  });
  return JSON.stringify({ ...payload, content: safeContent }, null, 2);
}
