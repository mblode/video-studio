import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ANIMATIC_FPS,
  pickShotStill,
  shotDuration,
  stillSegmentArgs,
  targetDimensions,
} from "../animatic.js";
import type { Dimensions } from "../animatic.js";
import { renderCardPng } from "../cards.js";
import { assertFfmpeg, runFfmpeg } from "../ffmpeg.js";
import { resolveOutput } from "../paths.js";
import type { Pass } from "../paths.js";
import { lintShotsFile } from "../shots.js";
import { buildStitchPlan, orderTimeline } from "../stitch.js";
import type { StitchClip } from "../stitch.js";
import { assertNewVideoOutput, nextRenderPath } from "../versions.js";
import { resolveFilm } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";
import { filmFrame } from "./stitch.js";

export interface AnimaticOptions {
  draft: boolean;
  dryRun: boolean;
  font: string;
  music?: string;
  musicGain: number;
  narration?: string;
  narrationGain: number;
  output?: string;
}

export async function runAnimatic(
  shotsFilePath: string,
  options: AnimaticOptions
): Promise<void> {
  await assertFfmpeg();
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    pass,
  });
  for (const warning of lintShotsFile(file)) {
    warn(warning);
  }
  const frame = filmFrame(file);
  const defaultDuration = frame.duration;
  const dim: Dimensions = targetDimensions(frame.ratio);
  const workDir = join(outputDir, "animatic");
  const outputPath = resolveOutput(
    options.output,
    nextRenderPath(join(outputDir, "animatics"))
  );

  const timeline = orderTimeline(file.shots, file.cards ?? []);
  // Jobs: each produces one uniform segment mp4 to concatenate.
  const segmentJobs: {
    args: string[];
    clip: StitchClip;
    description: string;
    slate?: { png: string; text: string };
  }[] = [];
  let lastStill: string | null = null;

  for (const [index, item] of timeline.entries()) {
    const seg = join(workDir, `seg-${index + 1}.mp4`);
    if (item.kind === "card") {
      const duration = item.card.duration ?? 3;
      const png = join(workDir, `card-${index + 1}.png`);
      segmentJobs.push({
        args: stillSegmentArgs(png, duration, dim, ANIMATIC_FPS, seg),
        clip: { duration, path: seg, transition: 0 },
        description: `card "${item.card.text}"`,
        slate: { png, text: item.card.text },
      });
      continue;
    }
    const { shot } = item;
    const duration = shotDuration(shot, defaultDuration);
    const still: string | null = pickShotStill(shot, shotsDir) ?? lastStill;
    if (still) {
      lastStill = still;
      segmentJobs.push({
        args: stillSegmentArgs(still, duration, dim, ANIMATIC_FPS, seg),
        clip: { duration, path: seg, transition: 0 },
        description: `${shot.id} (still)`,
      });
    } else {
      const png = join(workDir, `slate-${index + 1}.png`);
      segmentJobs.push({
        args: stillSegmentArgs(png, duration, dim, ANIMATIC_FPS, seg),
        clip: { duration, path: seg, transition: 0 },
        description: `${shot.id} (slate)`,
        slate: { png, text: shot.id },
      });
    }
  }

  const concatListPath = join(workDir, "animatic-list.txt");
  const plan = buildStitchPlan(
    segmentJobs.map((job) => job.clip),
    {
      cardPaths: new Map(),
      concatListPath,
      font: options.font,
      musicGainDb: options.musicGain,
      musicPath: options.music,
      narrationGainDb: options.narrationGain,
      narrationPath: options.narration,
      outputPath,
      sfxGainDb: 0,
      xfade: 0,
    }
  );

  if (options.dryRun) {
    const commands = [
      ...segmentJobs.map((job) => ({
        args: job.args,
        description: `segment: ${job.description}`,
      })),
      ...plan.steps,
    ];
    emit({ commands, dryRun: true, outputPath }, () => {
      for (const command of commands) {
        heading(`# ${command.description}`);
        line(`ffmpeg ${command.args.join(" ")}`);
      }
    });
    return;
  }

  assertNewVideoOutput(outputPath);
  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  for (const job of segmentJobs) {
    if (job.slate) {
      await renderCardPng(
        { after: "", text: job.slate.text },
        dim.width,
        dim.height,
        job.slate.png,
        options.font
      );
    }
    await runFfmpeg(job.args);
    note(job.description);
  }
  if (plan.concatList) {
    await writeFile(concatListPath, plan.concatList, "utf-8");
  }
  for (const step of plan.steps) {
    await runFfmpeg(step.args);
  }
  emit({ outputPath, segments: segmentJobs.length }, () => {
    ok(outputPath);
  });
}
