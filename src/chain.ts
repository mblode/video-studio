import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { lastFrameArgs, runFfmpeg } from "./ffmpeg.js";
import { isComplete } from "./manifest.js";
import { passSuffix } from "./paths.js";
import type { Pass } from "./paths.js";
import type { Manifest, Shot } from "./types.js";

/** Map of shot id -> the shot id it continues from. */
export function chainDependencies(shots: Shot[]): Map<string, string> {
  const deps = new Map<string, string>();
  for (const shot of shots) {
    if (shot.continueFrom !== undefined) {
      deps.set(shot.id, shot.continueFrom);
    }
  }
  return deps;
}

/**
 * Resolve the cached last-frame PNG for a shot's continueFrom dependency,
 * extracting it with ffmpeg if missing or stale. Returns a path relative to
 * the shots dir (ready for reference inlining).
 */
export async function resolveChainFrame(
  shot: Shot,
  manifest: Manifest,
  shotsDir: string,
  pass: Pass = "final"
): Promise<string> {
  const depId = shot.continueFrom;
  if (depId === undefined) {
    throw new Error(`${shot.id} has no continueFrom`);
  }
  const entry = manifest.entries[depId];
  if (!(entry && isComplete(entry, shotsDir) && entry.outputPath)) {
    throw new Error(
      `${shot.id} continueFrom ${depId}, which is not downloaded — generate ${depId} first`
    );
  }
  const mp4Path = resolve(shotsDir, entry.outputPath);
  // Frames are extracted from the SAME pass's clips so a chained draft anchors
  // on the draft hand-off, not the final's.
  const framesRel = `frames${passSuffix(pass)}`;
  const framesDir = join(shotsDir, framesRel);
  const framePath = join(framesDir, `${depId}-last.png`);

  const fresh =
    existsSync(framePath) &&
    statSync(framePath).mtimeMs >= statSync(mp4Path).mtimeMs;
  if (!fresh) {
    await mkdir(framesDir, { recursive: true });
    await runFfmpeg(lastFrameArgs(mp4Path, framePath));
  }
  return join(framesRel, `${depId}-last.png`);
}
