import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { VsError } from "../errors.js";
import { assertFfmpeg, frameAtArgs, probeClip, runFfmpeg } from "../ffmpeg.js";
import { isComplete, loadManifest, selectedRevision } from "../manifest.js";
import type { Pass } from "../paths.js";
import { passSuffix, resolveOutput } from "../paths.js";
import { frameTimestamps, probeWarnings, renderIndexMd } from "../review.js";
import type { ReviewRow } from "../review.js";
import { lintShotsFile } from "../shots.js";
import type { Manifest, ShotsFile } from "../types.js";
import { recordVisualReview } from "../visual-review.js";
import { resolveFilm } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";

export interface ReviewOptions {
  shot?: string;
  version?: number;
  verdict?: string;
  note?: string;
  draft: boolean;
  dryRun: boolean;
  frames: number;
  output?: string;
}

async function recordRequestedVerdict(
  shotsFilePath: string,
  file: ShotsFile,
  manifest: Manifest,
  pass: Pass,
  options: ReviewOptions
): Promise<boolean> {
  if (
    options.verdict === undefined &&
    options.shot === undefined &&
    options.version === undefined &&
    options.note === undefined
  ) {
    return false;
  }
  if (
    !(
      options.shot &&
      options.version &&
      options.note?.trim() &&
      (options.verdict === "approved" || options.verdict === "rejected")
    )
  ) {
    throw new VsError(
      "invalid_input",
      "a visual verdict requires --shot, --version, --verdict approved|rejected and a nonblank --note"
    );
  }
  const shot = file.shots.find((candidate) => candidate.id === options.shot);
  const revision = manifest.entries[options.shot]?.versions?.find(
    (candidate) => candidate.version === options.version
  );
  if (!(shot && revision?.outputPath && revision.status === "downloaded")) {
    throw new VsError(
      "missing_clip",
      "visual verdict requires a known downloaded revision"
    );
  }
  if (options.dryRun) {
    emit(
      {
        dryRun: true,
        note: options.note,
        shotId: shot.id,
        verdict: options.verdict,
        version: options.version,
      },
      () => note("No visual verdict written (dry run).")
    );
    return true;
  }
  const receipt = await recordVisualReview({
    mediaPath: revision.outputPath,
    note: options.note,
    pass,
    shot,
    shotsFile: shotsFilePath,
    verdict: options.verdict,
    version: options.version,
  });
  emit(receipt, () => ok(`${shot.id} v${options.version}: ${options.verdict}`));
  return true;
}

export async function runReview(
  shotsFilePath: string,
  options: ReviewOptions
): Promise<void> {
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, shotsDir } = await resolveFilm(shotsFilePath, { pass });
  for (const warning of lintShotsFile(file)) {
    warn(warning);
  }
  const manifest = await loadManifest(shotsFilePath, pass);
  if (
    await recordRequestedVerdict(shotsFilePath, file, manifest, pass, options)
  ) {
    return;
  }
  await assertFfmpeg();
  const reviewDir = resolveOutput(
    options.output,
    join(shotsDir, `review${passSuffix(pass)}`)
  );
  if (!options.dryRun) {
    await mkdir(reviewDir, { recursive: true });
  }

  const rows: ReviewRow[] = [];
  let sampled = 0;
  for (const shot of file.shots) {
    const entry = manifest.entries[shot.id];
    const excerpt =
      shot.prompt.length > 80 ? `${shot.prompt.slice(0, 80)}…` : shot.prompt;
    if (!(entry?.outputPath && isComplete(entry, shotsDir))) {
      rows.push({
        entry,
        frameFiles: [],
        promptExcerpt: excerpt,
        shotId: shot.id,
        warnings: [],
      });
      continue;
    }
    const clipPath = resolve(shotsDir, entry.outputPath);
    const selected = selectedRevision(entry);
    const reviewedEntry = selected
      ? {
          ...entry,
          error: selected.error,
          params: selected.params,
          status: selected.status,
          taskId: selected.taskId,
          tokensUsed: selected.tokensUsed,
        }
      : entry;
    const probe = await probeClip(clipPath);
    const frameFiles: string[] = [];
    const stamps = frameTimestamps(probe.duration, options.frames);
    for (const [index, stamp] of stamps.entries()) {
      const frameFile = `${shot.id}-${index + 1}.png`;
      const args = frameAtArgs(clipPath, stamp, join(reviewDir, frameFile));
      if (options.dryRun) {
        heading(`# ${shot.id} frame ${index + 1} @ ${stamp}s`);
        line(`ffmpeg ${args.join(" ")}`);
      } else {
        await runFfmpeg(args);
      }
      frameFiles.push(frameFile);
    }
    const warnings = probeWarnings(probe, reviewedEntry.params);
    rows.push({
      entry: reviewedEntry,
      frameFiles,
      promptExcerpt: excerpt,
      shotId: shot.id,
      warnings,
    });
    sampled += 1;
    note(
      `${shot.id}: ${frameFiles.length} frames${warnings.length > 0 ? " ⚠️" : ""}`
    );
  }

  if (options.dryRun) {
    return;
  }

  const indexPath = join(reviewDir, "index.md");
  await writeFile(
    indexPath,
    renderIndexMd(rows, basename(shotsFilePath)),
    "utf-8"
  );

  emit(
    {
      indexPath,
      reviewed: sampled,
      shots: rows.map((row) => ({
        frames: row.frameFiles.length,
        shotId: row.shotId,
        warnings: row.warnings,
      })),
    },
    () => {
      ok(indexPath);
    }
  );

  // A contact sheet of nothing is not a successful review.
  if (sampled === 0) {
    warn(
      `no downloaded clips for this ${pass} pass; run \`vs generate ${shotsFilePath}${options.draft ? " --draft" : ""}\` first`
    );
    process.exitCode = 1;
  }
}
