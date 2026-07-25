import { relative } from "node:path";

import { downloadFile } from "../download.js";
import {
  isRevisionComplete,
  latestRevision,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "../manifest.js";
import type { Pass } from "../paths.js";
import { clipRevisionPath } from "../versions.js";
import { resolveFilm } from "./context.js";
import { emit, note, ok, warn } from "./output.js";

export interface DownloadOptions {
  draft: boolean;
  output?: string;
  shots: string;
}

export async function runDownload(
  shotsFilePath: string,
  options: DownloadOptions
): Promise<void> {
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    output: options.output,
    pass,
  });
  const manifest = await loadManifest(shotsFilePath, pass);
  const byId = new Map(file.shots.map((shot) => [shot.id, shot]));

  const downloaded: string[] = [];
  const stale: string[] = [];
  for (const entry of Object.values(manifest.entries)) {
    const latest = latestRevision(entry);
    if (
      latest?.status !== "succeeded" ||
      isRevisionComplete(latest, shotsDir)
    ) {
      continue;
    }
    if (!latest.videoUrl) {
      warn(
        `${entry.shotId} succeeded but has no stored URL; re-query it with \`vs status ${latest.taskId}\``
      );
      stale.push(entry.shotId);
      continue;
    }
    const shot = byId.get(entry.shotId);
    const outputPath = clipRevisionPath(
      outputDir,
      entry.shotId,
      latest.version,
      shot?.output
    );
    await downloadFile(latest.videoUrl, outputPath);
    upsertEntry(manifest, {
      outputPath: relative(shotsDir, outputPath),
      shotId: entry.shotId,
      status: "downloaded",
      taskId: latest.taskId,
    });
    await saveManifest(shotsFilePath, manifest, pass);
    ok(`${entry.shotId} → ${outputPath}`);
    downloaded.push(entry.shotId);
  }

  emit({ downloaded, outputDir, pass, stale }, () => {
    note(
      downloaded.length === 0
        ? "nothing to download"
        : `${downloaded.length} clip(s) downloaded`
    );
  });
}
