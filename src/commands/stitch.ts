import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  ANIMATIC_FPS,
  normalizeClipArgs,
  pickShotStill,
  shotDuration,
  stillSegmentArgs,
  targetDimensions,
} from "../animatic.js";
import type { Dimensions } from "../animatic.js";
import { cardVideoArgs, renderCardPng } from "../cards.js";
import { VsError } from "../errors.js";
import { assertFfmpeg, probeClip, runFfmpeg } from "../ffmpeg.js";
import type { ClipProbe } from "../ffmpeg.js";
import { isComplete, loadManifest } from "../manifest.js";
import type { Pass } from "../paths.js";
import { lintShotsFile } from "../shots.js";
import { buildStitchPlan, orderTimeline } from "../stitch.js";
import type { StitchClip } from "../stitch.js";
import { ASPECT_RATIOS, DEFAULT_DURATION } from "../types.js";
import type {
  AspectRatio,
  ManifestEntry,
  Shot,
  ShotsFile,
  TitleCard,
} from "../types.js";
import { resolveFilm, resolveOutput } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";

/**
 * The frame every generated segment is conformed to. `film.defaults` wins;
 * otherwise fall back to the first shot that states a ratio/duration, so a film
 * that only configures its shots is not silently cut at 16:9. A single concat
 * needs one frame, so a genuinely mixed-ratio film is letterboxed into this one
 * rather than changing shape mid-cut.
 */
export function filmFrame(file: ShotsFile): {
  duration: number;
  ratio: AspectRatio;
} {
  const { defaults } = file.film;
  return {
    duration:
      defaults?.duration ??
      file.shots.find((shot) => shot.duration !== undefined)?.duration ??
      DEFAULT_DURATION,
    ratio:
      defaults?.ratio ??
      file.shots.find((shot) => shot.ratio !== undefined)?.ratio ??
      ASPECT_RATIOS[0],
  };
}

export interface StitchCommandOptions {
  draft: boolean;
  dryRun: boolean;
  font: string;
  /** Always-a-reel: fill missing finals with the draft clip, else a held still. */
  latest: boolean;
  music?: string;
  musicGain: number;
  narration?: string;
  grade: boolean;
  narrationGain: number;
  output?: string;
  sfxGain: number;
  xfade: number;
}

function assertUniformStreams(probes: Map<string, ClipProbe>): ClipProbe {
  const entries = [...probes.entries()];
  const [firstPath, first] = entries[0] ?? [];
  if (!(firstPath && first)) {
    throw new VsError("missing_clip", "no clips to stitch", {
      hint: "generate the film first, or use `vs stitch <shots-file> --latest` to cut whatever exists",
    });
  }
  for (const [path, probe] of entries.slice(1)) {
    if (
      probe.width !== first.width ||
      probe.height !== first.height ||
      Math.abs(probe.fps - first.fps) > 0.01
    ) {
      throw new VsError(
        "stream_mismatch",
        `${path} is ${probe.width}x${probe.height}@${probe.fps.toFixed(2)} but ${firstPath} is ${first.width}x${first.height}@${first.fps.toFixed(2)}`,
        {
          hint: "lossless concat would corrupt the cut; re-encode by passing --xfade 0.4, or regenerate the odd clip at the film's resolution",
        }
      );
    }
  }
  return first;
}

interface ResolvedClips {
  clipPaths: Map<string, string>;
  probes: Map<string, ClipProbe>;
  reference: ClipProbe;
}

async function resolveClips(
  shots: { id: string }[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  shotsDir: string
): Promise<ResolvedClips> {
  const missing: string[] = [];
  const clipPaths = new Map<string, string>();
  for (const shot of shots) {
    const entry = manifest.entries[shot.id];
    if (entry?.outputPath && isComplete(entry, shotsDir)) {
      clipPaths.set(shot.id, resolve(shotsDir, entry.outputPath));
    } else {
      missing.push(shot.id);
    }
  }
  if (missing.length > 0) {
    throw new VsError(
      "missing_clip",
      `no downloaded clip for: ${missing.join(", ")}`,
      {
        hint: "generate them first, or pass --latest to cut a reel from whatever exists (final, else draft, else the still)",
      }
    );
  }
  const probes = new Map<string, ClipProbe>();
  for (const [, path] of clipPaths) {
    if (!probes.has(path)) {
      probes.set(path, await probeClip(path));
    }
  }
  return { clipPaths, probes, reference: assertUniformStreams(probes) };
}

interface LatestSegment {
  args: string[];
  clip: StitchClip;
  description: string;
  slate?: { png: string; text: string };
}

/**
 * Build the reference frame (dims + fps) for a "latest" reel: match the first
 * finished FINAL clip so the cut looks like the real film; fall back to a
 * 720-class frame from the film ratio when no finals exist yet.
 */
async function latestReference(
  shots: Shot[],
  finalManifest: Awaited<ReturnType<typeof loadManifest>>,
  shotsDir: string,
  ratio: Parameters<typeof targetDimensions>[0]
): Promise<{ dim: Dimensions; fps: number }> {
  for (const shot of shots) {
    const entry = finalManifest.entries[shot.id];
    if (entry?.outputPath && isComplete(entry, shotsDir)) {
      const probe = await probeClip(resolve(shotsDir, entry.outputPath));
      return {
        dim: { height: probe.height, width: probe.width },
        fps: probe.fps,
      };
    }
  }
  return { dim: targetDimensions(ratio), fps: ANIMATIC_FPS };
}

interface LatestShotInput {
  defaultDuration: number;
  dim: Dimensions;
  draftEntry?: ManifestEntry;
  finalEntry?: ManifestEntry;
  fps: number;
  lastStill: string | null;
  seg: string;
  shot: Shot;
  shotsDir: string;
  slatePng: string;
}

/** A normalized clip segment from an mp4 source (final or draft). */
async function clipSegment(
  src: string,
  label: string,
  input: LatestShotInput
): Promise<LatestSegment> {
  const probe = await probeClip(src);
  return {
    args: normalizeClipArgs(src, input.dim, input.fps, input.seg),
    clip: {
      duration: probe.duration,
      path: input.seg,
      transition: input.shot.transition,
    },
    description: `${input.shot.id} (${label})`,
  };
}

/**
 * Pick the best available source for one shot — FINAL clip, else DRAFT clip,
 * else a held still, else a slate — and return the normalized segment plus the
 * still to carry forward for the next chained/text-only shot.
 */
async function resolveLatestShot(
  input: LatestShotInput
): Promise<{ segment: LatestSegment; still: string | null }> {
  const { shot, shotsDir, finalEntry, draftEntry } = input;
  if (finalEntry?.outputPath && isComplete(finalEntry, shotsDir)) {
    const src = resolve(shotsDir, finalEntry.outputPath);
    return {
      segment: await clipSegment(src, "final", input),
      still: input.lastStill,
    };
  }
  if (draftEntry?.outputPath && isComplete(draftEntry, shotsDir)) {
    const src = resolve(shotsDir, draftEntry.outputPath);
    return {
      segment: await clipSegment(src, "draft", input),
      still: input.lastStill,
    };
  }
  const duration = shotDuration(shot, input.defaultDuration);
  const still: string | null = pickShotStill(shot, shotsDir) ?? input.lastStill;
  if (still) {
    return {
      segment: {
        args: stillSegmentArgs(
          still,
          duration,
          input.dim,
          input.fps,
          input.seg
        ),
        clip: { duration, path: input.seg, transition: shot.transition },
        description: `${shot.id} (still)`,
      },
      still,
    };
  }
  return {
    segment: {
      args: stillSegmentArgs(
        input.slatePng,
        duration,
        input.dim,
        input.fps,
        input.seg
      ),
      clip: { duration, path: input.seg, transition: shot.transition },
      description: `${shot.id} (slate)`,
      slate: { png: input.slatePng, text: shot.id },
    },
    still: input.lastStill,
  };
}

/**
 * Always-a-reel: prefer each shot's FINAL clip, fall back to its DRAFT clip,
 * then to a held still (or a slate) — every source normalized to one frame so a
 * half-finished film still cuts into a complete, watchable reel (the editorial
 * "story reel → color reel" continuity the studios keep at every stage).
 */
async function runLatestStitch(
  shotsFilePath: string,
  options: StitchCommandOptions
): Promise<void> {
  // --draft only moves where the reel is WRITTEN: a latest cut always reads
  // both manifests, since preferring the final and falling back to the draft
  // is the whole point.
  const pass: Pass = options.draft ? "draft" : "final";
  // `--output` names the reel FILE here, so it must not redirect the film's
  // working directory.
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    pass,
  });
  for (const warning of lintShotsFile(file)) {
    warn(warning);
  }
  if (options.sfxGain !== 0) {
    warn(
      "--sfx-gain is ignored by --latest: segments are re-encoded silent so mixed sources cut together; score the reel with --music/--narration"
    );
  }
  const finalManifest = await loadManifest(shotsFilePath, "final");
  const draftManifest = await loadManifest(shotsFilePath, "draft");
  const frame = filmFrame(file);
  const defaultDuration = frame.duration;
  const { dim, fps } = await latestReference(
    file.shots,
    finalManifest,
    shotsDir,
    frame.ratio
  );
  const workDir = join(outputDir, "latest");
  const outputPath = resolveOutput(
    options.output,
    join(outputDir, "film-latest.mp4")
  );

  const segments: LatestSegment[] = [];
  let lastStill: string | null = null;
  let index = 0;
  for (const item of orderTimeline(file.shots, file.cards ?? [])) {
    index += 1;
    const seg = join(workDir, `seg-${index}.mp4`);
    if (item.kind === "card") {
      const duration = item.card.duration ?? 3;
      const png = join(workDir, `card-${index}.png`);
      segments.push({
        args: stillSegmentArgs(png, duration, dim, fps, seg),
        clip: { duration, path: seg, transition: item.card.transition },
        description: `card "${item.card.text}"`,
        slate: { png, text: item.card.text },
      });
      continue;
    }
    const resolved = await resolveLatestShot({
      defaultDuration,
      dim,
      draftEntry: draftManifest.entries[item.shot.id],
      finalEntry: finalManifest.entries[item.shot.id],
      fps,
      lastStill,
      seg,
      shot: item.shot,
      shotsDir,
      slatePng: join(workDir, `slate-${index}.png`),
    });
    lastStill = resolved.still;
    segments.push(resolved.segment);
  }

  const concatListPath = join(workDir, "latest-list.txt");
  const plan = buildStitchPlan(
    segments.map((s) => s.clip),
    {
      cardPaths: new Map(),
      concatListPath,
      font: options.font,
      grade: options.grade,
      musicGainDb: options.musicGain,
      musicPath: options.music,
      narrationGainDb: options.narrationGain,
      narrationPath: options.narration,
      outputPath,
      sfxGainDb: 0,
      xfade: options.xfade,
    }
  );

  if (options.dryRun) {
    const commands = [
      ...segments.map((s) => ({
        args: s.args,
        description: `segment: ${s.description}`,
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

  await mkdir(workDir, { recursive: true });
  for (const s of segments) {
    if (s.slate) {
      await renderCardPng(
        { after: "", text: s.slate.text },
        dim.width,
        dim.height,
        s.slate.png,
        options.font
      );
    }
    await runFfmpeg(s.args);
    note(s.description);
  }
  if (plan.concatList) {
    await writeFile(concatListPath, plan.concatList, "utf-8");
  }
  for (const step of plan.steps) {
    await runFfmpeg(step.args);
  }
  emit(
    { outputPath, pass, segments: segments.map((s) => s.description) },
    () => {
      ok(outputPath);
    }
  );
}

export async function runStitch(
  shotsFilePath: string,
  options: StitchCommandOptions
): Promise<void> {
  await assertFfmpeg();
  if (options.latest) {
    await runLatestStitch(shotsFilePath, options);
    return;
  }
  const pass: Pass = options.draft ? "draft" : "final";
  const { file, outputDir, shotsDir } = await resolveFilm(shotsFilePath, {
    pass,
  });
  for (const warning of lintShotsFile(file)) {
    warn(warning);
  }
  const manifest = await loadManifest(shotsFilePath, pass);
  const outputPath = resolveOutput(options.output, join(outputDir, "film.mp4"));

  const { clipPaths, probes, reference } = await resolveClips(
    file.shots,
    manifest,
    shotsDir
  );

  // render title cards as matching segments
  const cardsDir = join(outputDir, "cards");
  const timeline = orderTimeline(file.shots, file.cards ?? []);
  const clips: StitchClip[] = [];
  const cardJobs: {
    card: TitleCard;
    fadeIn: boolean;
    mp4: string;
    png: string;
  }[] = [];
  for (const [position, item] of timeline.entries()) {
    if (item.kind === "shot") {
      const path = clipPaths.get(item.shot.id) as string;
      clips.push({
        duration: probes.get(path)?.duration ?? 0,
        path,
        transition: item.shot.transition,
      });
    } else {
      const mp4 = join(cardsDir, `card-${item.index + 1}.mp4`);
      cardJobs.push({
        card: item.card,
        // The very first frame of the film must not be black, or messaging
        // apps grab a blank poster — open the card fully visible.
        fadeIn: position !== 0,
        mp4,
        png: join(cardsDir, `card-${item.index + 1}.png`),
      });
      clips.push({
        duration: item.card.duration ?? 3,
        path: mp4,
        transition: item.card.transition,
      });
    }
  }

  const concatListPath = join(outputDir, "stitch-list.txt");
  const plan = buildStitchPlan(clips, {
    cardPaths: new Map(),
    concatListPath,
    font: options.font,
    grade: options.grade,
    musicGainDb: options.musicGain,
    musicPath: options.music,
    narrationGainDb: options.narrationGain,
    narrationPath: options.narration,
    outputPath,
    sfxGainDb: options.sfxGain,
    xfade: options.xfade,
  });

  if (options.dryRun) {
    const commands = [
      ...cardJobs.map((job) => ({
        args: cardVideoArgs(
          job.png,
          job.card.duration ?? 3,
          reference.fps,
          job.mp4,
          job.fadeIn
        ),
        description: `render card "${job.card.text}" → ${job.mp4}`,
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

  if (cardJobs.length > 0) {
    await mkdir(cardsDir, { recursive: true });
    for (const job of cardJobs) {
      await renderCardPng(
        job.card,
        reference.width,
        reference.height,
        job.png,
        options.font
      );
      await runFfmpeg(
        cardVideoArgs(
          job.png,
          job.card.duration ?? 3,
          reference.fps,
          job.mp4,
          job.fadeIn
        )
      );
      note(`rendered ${job.mp4}`);
    }
  }
  if (plan.concatList) {
    await mkdir(dirname(concatListPath), { recursive: true });
    await writeFile(concatListPath, plan.concatList, "utf-8");
  }
  for (const step of plan.steps) {
    note(step.description);
    await runFfmpeg(step.args);
  }
  emit({ clips: clips.length, outputPath, pass }, () => {
    ok(outputPath);
  });
}
