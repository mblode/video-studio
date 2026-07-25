import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { assertFfmpeg, probeClip, runFfmpeg } from "../ffmpeg.js";
import { isComplete, loadManifest } from "../manifest.js";
import type { Pass } from "../paths.js";
import { buildUpscalePlan } from "../upscale.js";
import { resolveFilm, resolveOutput } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";

export interface UpscaleOptions {
  crf: number;
  draft: boolean;
  dryRun: boolean;
  height: number;
  output?: string;
  shot?: string[];
}

/**
 * Lanczos-upscale finished clips to a delivery resolution (default 1080p). The
 * last rung of the cost ladder: generate at 720p, then upscale only the shots
 * that make the final edit — for free, in ffmpeg. Reads the same manifest
 * `vs stitch`/`vs download` use; sources only complete clips and writes into a
 * sibling `output-1080/` so the 720 masters are never touched.
 */
export async function runUpscale(
  shotsFile: string,
  options: UpscaleOptions
): Promise<void> {
  await assertFfmpeg();
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFile, { pass });
  const manifest = await loadManifest(shotsFile, pass);
  const destDir = resolveOutput(
    options.output,
    `${outputDir}-${options.height}`
  );

  const wanted = options.shot ? new Set(options.shot) : undefined;
  const shots = file.shots.filter((shot) => !wanted || wanted.has(shot.id));

  if (!options.dryRun) {
    await mkdir(destDir, { recursive: true });
  }

  const upscaled: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  for (const shot of shots) {
    const entry = manifest.entries[shot.id];
    if (!isComplete(entry, shotsDir)) {
      note(`${shot.id}: no completed clip; skipping`);
      missing.push(shot.id);
      continue;
    }
    const inputPath = resolve(shotsDir, entry?.outputPath as string);
    const outputPath = resolve(destDir, basename(inputPath));
    const probe = await probeClip(inputPath);
    const plan = buildUpscalePlan({
      crf: options.crf,
      height: options.height,
      inputPath,
      outputPath,
      sourceHeight: probe.height,
    });

    if (plan.skip) {
      note(
        `${shot.id} already ${probe.height}p (>= ${options.height}p), left as-is`
      );
      skipped.push(shot.id);
      continue;
    }

    if (options.dryRun) {
      heading(
        `# upscale ${shot.id} ${probe.height}p → ${options.height}p → ${outputPath}`
      );
      line(`ffmpeg ${plan.args.join(" ")}`);
      continue;
    }

    await runFfmpeg(plan.args);
    ok(`${shot.id} → ${outputPath}`);
    upscaled.push(shot.id);
  }

  if (options.dryRun) {
    return;
  }

  emit({ destDir, missing, skipped, upscaled }, () => {
    note(
      `${upscaled.length} upscaled, ${skipped.length} already ≥${options.height}p, ${missing.length} missing`
    );
  });

  // Every requested shot missing means nothing was delivered; say so.
  if (shots.length > 0 && missing.length === shots.length) {
    warn(
      `no completed ${pass} clips to upscale; run \`vs generate ${shotsFile}\` (or \`vs download\`) first`
    );
    process.exitCode = 1;
  }
}
