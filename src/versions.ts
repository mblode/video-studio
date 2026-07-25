import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import { VsError } from "./errors.js";
import { safeJoin } from "./paths.js";

export function versionLabel(version: number): string {
  return `v${String(version).padStart(3, "0")}`;
}

/** The immutable destination for one paid generation attempt. */
export function clipRevisionPath(
  outputDir: string,
  shotId: string,
  version: number,
  customOutput?: string
): string {
  const label = versionLabel(version);
  if (customOutput) {
    return safeJoin(outputDir, join("clips", shotId, label, customOutput));
  }
  return safeJoin(outputDir, join("clips", shotId, `${label}.mp4`));
}

/**
 * Allocate a new local render path. Explicit --output values bypass this:
 * naming a file is an explicit request, while defaults are always immutable.
 */
export function nextRenderPath(directory: string, extension = ".mp4"): string {
  for (let version = 1; ; version += 1) {
    const candidate = join(directory, `${versionLabel(version)}${extension}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

/** Version an export family while keeping its original media extension. */
export function nextExportPath(directory: string, inputPath: string): string {
  return nextRenderPath(directory, extname(inputPath) || ".mp4");
}

/** Refuse to replace an explicitly named deliverable. */
export function assertNewVideoOutput(outputPath: string): void {
  if (existsSync(outputPath)) {
    throw new VsError(
      "already_exists",
      `refusing to overwrite existing video: ${outputPath}`,
      {
        hint: "choose a new --output path, or omit --output to get the next automatic revision",
      }
    );
  }
}
