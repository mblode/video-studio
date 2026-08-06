import { DEFAULT_DURATION } from "./types.js";
import type { ShotsFile } from "./types.js";

/** Lyria 3 Pro — full beds up to ~3 minutes. */
export const LYRIA_PRO_MODEL = "lyria-3-pro-preview";
/** Lyria 3 Clip — fixed 30s, cheaper prompt iteration. */
export const LYRIA_CLIP_MODEL = "lyria-3-clip-preview";

export interface ScorePlan {
  model: string;
  body: unknown;
  /** Human-readable note for dry-run / logs. */
  note: string;
}

/**
 * Rough program length from authored shot + card durations (no disk probe).
 * Crossfades are ignored so the score is slightly longer than a cut with
 * overlaps — better than undershooting the bed.
 */
export function estimateFilmRuntimeSeconds(file: ShotsFile): number {
  let total = 0;
  for (const shot of file.shots) {
    total += shot.duration ?? file.film.defaults?.duration ?? DEFAULT_DURATION;
  }
  for (const card of file.cards ?? []) {
    total += card.duration ?? 3;
  }
  return total;
}

/** Append the instrumental / duration constraints Lyria needs for a film bed. */
export function composeScorePrompt(
  userPrompt: string,
  durationSeconds?: number
): string {
  const parts = [userPrompt.trim()];
  if (durationSeconds !== undefined && durationSeconds > 0) {
    const minutes = Math.max(1, Math.round(durationSeconds / 60));
    const seconds = Math.round(durationSeconds);
    parts.push(
      `Create an approximately ${seconds}-second (${minutes}-minute) continuous instrumental underscore.`
    );
  }
  parts.push(
    "Cinematic film score bed, sparse enough to sit under narration, no lead melody that fights dialogue.",
    "Instrumental only, no vocals."
  );
  return parts.join(" ");
}

/** `generateContent` body for Lyria music generation. */
export function buildLyriaRequestBody(prompt: string): unknown {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO", "TEXT"],
    },
  };
}

export function buildScorePlan(options: {
  prompt: string;
  clip?: boolean;
  durationSeconds?: number;
}): ScorePlan {
  const model = options.clip ? LYRIA_CLIP_MODEL : LYRIA_PRO_MODEL;
  const prompt = composeScorePrompt(options.prompt, options.durationSeconds);
  return {
    body: buildLyriaRequestBody(prompt),
    model,
    note: options.clip
      ? "Lyria 3 Clip (~30s, $0.04) — iterate the prompt, then drop --clip for the full bed"
      : `Lyria 3 Pro (~$0.08/song)${options.durationSeconds ? ` targeting ~${Math.round(options.durationSeconds)}s` : ""}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Pull the first inline audio blob out of a Lyria generateContent response. */
export function extractInlineAudio(json: unknown): {
  data: string;
  mimeType: string;
} {
  const candidates = asRecord(json)?.candidates;
  const first = Array.isArray(candidates) ? asRecord(candidates[0]) : undefined;
  const parts = asRecord(first?.content)?.parts;
  if (!Array.isArray(parts)) {
    throw new TypeError("Lyria response had no candidates[0].content.parts");
  }
  const texts: string[] = [];
  for (const raw of parts) {
    const part = asRecord(raw);
    if (!part || part.thought === true) {
      continue;
    }
    if (typeof part.text === "string") {
      texts.push(part.text);
    }
    const inline = asRecord(part.inlineData) ?? asRecord(part.inline_data);
    const data = inline?.data;
    if (typeof data === "string" && data.length > 0) {
      const mime = inline?.mimeType ?? inline?.mime_type;
      return {
        data,
        mimeType: typeof mime === "string" ? mime : "audio/mpeg",
      };
    }
  }
  const text = texts.join(" ").trim();
  throw new Error(`Lyria returned no audio${text ? `: ${text}` : ""}`);
}

export function extensionForAudioMime(mimeType: string): string {
  if (mimeType.includes("wav")) {
    return ".wav";
  }
  if (mimeType.includes("ogg")) {
    return ".ogg";
  }
  return ".mp3";
}
