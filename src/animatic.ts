import { extname } from "node:path";

import { safeJoin } from "./paths.js";
import type { AspectRatio, Shot } from "./types.js";

/** Default frame rate for animatic / fallback segments. */
export const ANIMATIC_FPS = 24;
/** Default short side (px) — a light 720-class preview, never full res. */
export const ANIMATIC_SHORT_SIDE = 720;

export interface Dimensions {
  height: number;
  width: number;
}

const IMAGE_EXTS = new Set([".jpeg", ".jpg", ".png", ".webp"]);

/**
 * The local image that stands in for a shot in a story reel / fallback cut: its
 * opening still (first_frame), else any image reference. Returns an absolute
 * path, or null for chained/text-only/remote-only shots (the caller holds the
 * previous still or draws a slate).
 */
export function pickShotStill(shot: Shot, shotsDir: string): string | null {
  const images = (shot.references ?? []).filter((ref) => ref.type === "image");
  const chosen = images.find((ref) => ref.role === "first_frame") ?? images[0];
  if (!chosen || chosen.url.startsWith("https://")) {
    return null;
  }
  if (!IMAGE_EXTS.has(extname(chosen.url).toLowerCase())) {
    return null;
  }
  return safeJoin(shotsDir, chosen.url);
}

/** Concrete clip length for a shot, resolving auto (-1) to the film default. */
export function shotDuration(shot: Shot, fallback: number): number {
  const d = shot.duration ?? fallback;
  return d === -1 ? fallback : d;
}

function even(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Uniform target frame for a ratio at a given short side. Every animatic /
 * fallback segment is scaled to this so they concat without a stream mismatch.
 * Landscape ratios pin the height to `shortSide`; portrait ratios pin the width.
 */
export function targetDimensions(
  ratio: AspectRatio,
  shortSide: number = ANIMATIC_SHORT_SIDE
): Dimensions {
  const [a, b] = ratio.split(":").map(Number);
  const wide = (a ?? 16) >= (b ?? 9);
  if (wide) {
    return {
      height: even(shortSide),
      width: even((shortSide * (a ?? 16)) / (b ?? 9)),
    };
  }
  return {
    height: even((shortSide * (b ?? 16)) / (a ?? 9)),
    width: even(shortSide),
  };
}

/**
 * scale-to-fit + centre-pad to an exact WxH, then force square pixels (setsar=1)
 * so segments concat even when a source still isn't exactly the target ratio
 * (e.g. Nano Banana's "16:9" is 1376x768, ~43:24), then yuv420p downstream.
 */
function scalePad(dim: Dimensions): string {
  return `scale=${dim.width}:${dim.height}:force_original_aspect_ratio=decrease,pad=${dim.width}:${dim.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

/**
 * Turn a still image into a held video segment of `duration` seconds at exactly
 * `dim`, with a gentle dip-to-black in/out and a silent stereo track (so it
 * concats uniformly with real clips). The animatic / story-reel primitive.
 */
export function stillSegmentArgs(
  imagePath: string,
  duration: number,
  dim: Dimensions,
  fps: number,
  outputPath: string
): string[] {
  const fade = Math.min(0.4, duration / 4);
  const fadeOutStart = Math.max(0, duration - fade);
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    fps.toFixed(3),
    "-i",
    imagePath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    duration.toString(),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-vf",
    `${scalePad(dim)},fade=t=in:st=0:d=${fade},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fade},format=yuv420p`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    outputPath,
  ];
}

/**
 * Re-encode an existing clip to the uniform `dim`/`fps` with a silent track,
 * so a mixed cut (1080p finals + 480p drafts + held stills) concats cleanly.
 * Per-clip SFX is dropped on purpose — a WIP reel scores from --music/--narration.
 */
export function normalizeClipArgs(
  inputPath: string,
  dim: Dimensions,
  fps: number,
  outputPath: string
): string[] {
  return [
    "-y",
    "-i",
    inputPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-vf",
    `${scalePad(dim)},fps=${fps},format=yuv420p`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    outputPath,
  ];
}
