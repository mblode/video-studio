import { dirname, resolve } from "node:path";

import { VsError } from "../errors.js";
import { isComplete, loadManifest, saveManifest } from "../manifest.js";
import type { Pass } from "../paths.js";
import { emit, ok } from "./output.js";

export interface UseOptions {
  draft: boolean;
}

/** Select any downloaded revision without moving or copying its media file. */
export async function runUse(
  shotsFile: string,
  shotId: string,
  version: number,
  options: UseOptions
): Promise<void> {
  const pass: Pass = options.draft ? "draft" : "final";
  const manifest = await loadManifest(shotsFile, pass);
  const entry = manifest.entries[shotId];
  if (!entry) {
    throw new VsError("unknown_id", `no revisions recorded for ${shotId}`, {
      hint: `run \`vs status ${shotsFile}\` to list recorded shots`,
    });
  }
  const revision = entry.versions?.find(
    (candidate) => candidate.version === version
  );
  if (!(revision?.outputPath && revision.status === "downloaded")) {
    throw new VsError(
      "missing_clip",
      `${shotId} v${String(version).padStart(3, "0")} is not downloaded`,
      {
        hint: `run \`vs status ${shotsFile}\` to see available revisions`,
      }
    );
  }

  entry.selectedVersion = version;
  entry.outputPath = revision.outputPath;
  if (!isComplete(entry, dirname(resolve(shotsFile)))) {
    throw new VsError(
      "file_not_found",
      `${shotId} v${String(version).padStart(3, "0")} is recorded but its file is missing`,
      { hint: `restore ${revision.outputPath}, or generate a new revision` }
    );
  }
  await saveManifest(shotsFile, manifest, pass);
  emit(
    {
      outputPath: revision.outputPath,
      pass,
      selectedVersion: version,
      shotId,
    },
    () => {
      ok(
        `${shotId} now uses v${String(version).padStart(3, "0")} → ${revision.outputPath}`
      );
    }
  );
}
