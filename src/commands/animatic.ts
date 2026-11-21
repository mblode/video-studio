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
import { cardLabel, renderCardPng } from "../cards.js";
import { assertFfmpeg, runFfmpeg } from "../ffmpeg.js";
import {
  decorateTimeline,
  decorationCommands,
  renderDecorations,
} from "../overlays.js";
import type { TimelineSegment } from "../overlays.js";
import { resolveOutput } from "../paths.js";
import type { Pass } from "../paths.js";
import { lintShotsFile } from "../shots.js";
import { buildStitchPlan, orderTimeline } from "../stitch.js";
import type { TitleCard } from "../types.js";
import { assertNewVideoOutput, nextRenderPath } from "../versions.js";
import { resolveFilm } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";
import { cardImagePath, filmFrame } from "./stitch.js";

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
  const segmentJobs: (TimelineSegment & {
    args: string[];
    description: string;
    slate?: { card: TitleCard; imagePath?: string; png: string };
  })[] = [];
  let lastStill: string | null = null;

  for (const [index, item] of timeline.entries()) {
    const seg = join(workDir, `seg-${index + 1}.mp4`);
    if (item.kind === "card") {
      const duration = item.card.duration ?? 3;
      const png = join(workDir, `card-${index + 1}.png`);
      segmentJobs.push({
        args: stillSegmentArgs(
          png,
          duration,
          dim,
          ANIMATIC_FPS,
          seg,
          item.card.fade !== false
        ),
        clip: { duration, path: seg, transition: 0 },
        description: `card "${cardLabel(item.card)}"`,
        id: item.card.id,
        slate: {
          card: item.card,
          imagePath: cardImagePath(item.card, shotsDir),
          png,
        },
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
        id: shot.id,
        trim: shot.trim,
      });
    } else {
      const png = join(workDir, `slate-${index + 1}.png`);
      segmentJobs.push({
        args: stillSegmentArgs(png, duration, dim, ANIMATIC_FPS, seg),
        clip: { duration, path: seg, transition: 0 },
        description: `${shot.id} (slate)`,
        id: shot.id,
        slate: { card: { after: "", text: shot.id }, png },
        trim: shot.trim,
      });
    }
  }

  // The same pre-pass as `vs stitch`, so type timing is judged on the story
  // reel, before any video is paid for.
  const decorateDir = join(workDir, "overlays");
  const frameSpec = { ...dim, fps: ANIMATIC_FPS };
  const decorated = decorateTimeline(segmentJobs, {
    font: options.font,
    frame: frameSpec,
    overlays: file.overlays,
    workDir: decorateDir,
  });
  const concatListPath = join(workDir, "animatic-list.txt");
  const plan = buildStitchPlan(decorated.clips, {
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
  });

  if (options.dryRun) {
    const commands = [
      ...segmentJobs.map((job) => ({
        args: job.args,
        description: `segment: ${job.description}`,
      })),
      ...(await decorationCommands(decorated.decorations)),
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
        job.slate.card,
        dim.width,
        dim.height,
        job.slate.png,
        options.font,
        job.slate.imagePath
      );
    }
    await runFfmpeg(job.args);
    note(job.description);
  }
  await renderDecorations(decorated.decorations, frameSpec, decorateDir);
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
