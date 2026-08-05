import type { Shot, TitleCard } from "./types.js";

export interface StitchClip {
  /** Absolute path of the mp4 (clip or rendered card). */
  path: string;
  duration: number;
  /** Defaults to true. Muted clips get a matching silent input when re-encoded. */
  hasAudio?: boolean;
  /** Crossfade INTO this clip, in seconds; falls back to the global xfade. */
  transition?: number;
}

export interface StitchStep {
  args: string[];
  description: string;
}

export interface StitchPlan {
  /** Text content for the concat list file, when the concat path is used. */
  concatList?: string;
  steps: StitchStep[];
}

export interface StitchOptions {
  cardPaths: Map<number, string>;
  concatListPath: string;
  font: string;
  musicGainDb: number;
  musicPath?: string;
  /** Gain applied to the narration track, in dB. */
  narrationGainDb?: number;
  narrationPath?: string;
  outputPath: string;
  /** Gain applied to the clips' own audio (SFX), in dB. */
  sfxGainDb?: number;
  /**
   * Drop the clips' own audio entirely.
   *
   * For a Seedance cut the clip track is SFX and ambience, and you almost
   * always want it. For a MiniMax H3 cut it is a complete mix — score,
   * dialogue, and foley — generated independently per clip, so N clips means N
   * unrelated music beds colliding at every cut. Muting hands the soundtrack
   * back to `vs score` / `vs narrate`, which lay ONE continuous bed across the
   * whole timeline.
   */
  muteClips?: boolean;
  /** Apply a subtle filmic grade (contrast + saturation lift). */
  grade?: boolean;
  xfade: number;
}

/**
 * Final ordering of clips and cards: cards with after:"start" first, then
 * each shot's clip followed by any cards placed after it, then after:"end".
 */
export function orderTimeline(
  shots: Shot[],
  cards: TitleCard[]
): (
  | { kind: "shot"; shot: Shot }
  | { kind: "card"; card: TitleCard; index: number }
)[] {
  const timeline: (
    | { kind: "shot"; shot: Shot }
    | { kind: "card"; card: TitleCard; index: number }
  )[] = [];
  const cardsAfter = (position: string) => {
    for (const [index, card] of cards.entries()) {
      if (card.after === position) {
        timeline.push({ card, index, kind: "card" });
      }
    }
  };
  cardsAfter("start");
  for (const shot of shots) {
    timeline.push({ kind: "shot", shot });
    cardsAfter(shot.id);
  }
  cardsAfter("end");
  return timeline;
}

/**
 * xfade offsets for N clips: offset_i = sum(durations[0..i]) - (i+1)*xfade.
 * The classic off-by-one trap — offsets are where each NEXT clip starts
 * fading in on the combined timeline.
 */
export function computeXfadeOffsets(
  durations: number[],
  xfade: number | number[]
): number[] {
  const offsets: number[] = [];
  let total = 0;
  let faded = 0;
  for (let i = 0; i < durations.length - 1; i += 1) {
    total += durations[i] ?? 0;
    faded += Array.isArray(xfade) ? (xfade[i] ?? 0) : xfade;
    offsets.push(total - faded);
  }
  return offsets;
}

export function concatListContent(clips: StitchClip[]): string {
  return `${clips.map((clip) => `file '${clip.path.replaceAll("'", "'\\''")}'`).join("\n")}\n`;
}

function clipInputArgs(clips: StitchClip[]): {
  args: string[];
  audioInputs: number[];
  inputCount: number;
  videoInputs: number[];
} {
  const args: string[] = [];
  const videoInputs: number[] = [];
  const audioInputs: number[] = [];
  let inputCount = 0;
  for (const clip of clips) {
    args.push("-i", clip.path);
    videoInputs.push(inputCount);
    if (clip.hasAudio === false) {
      inputCount += 1;
      args.push(
        "-f",
        "lavfi",
        "-t",
        clip.duration.toString(),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100"
      );
      audioInputs.push(inputCount);
    } else {
      audioInputs.push(inputCount);
    }
    inputCount += 1;
  }
  return { args, audioInputs, inputCount, videoInputs };
}

/**
 * Gold-standard narration-over-music mix:
 * - Voiceover is brought forward: de-rumble high-pass, a gentle presence lift
 *   for intelligibility, then loudnorm to a controlled dialogue level.
 * - The score is ducked UNDER the voiceover via sidechain compression keyed by
 *   the narration, so dialogue stays clear instead of muffled by the bed.
 * - The whole program is mastered to the streaming loudness standard
 *   (-14 LUFS integrated, -1 dBTP) so it's audible on phones and laptops.
 *
 * Everything is conformed to stereo/44.1k before mixing so the sidechain and
 * amix stages compose without channel/rate mismatches.
 */
function audioMixArgs(
  options: StitchOptions,
  inputCount: number,
  totalDuration: number
): {
  extraInputs: string[];
  filterParts: string[];
  finalAudioLabel: string;
} {
  const extraInputs: string[] = [];
  const filterParts: string[] = [];
  const stereo = "aformat=channel_layouts=stereo:sample_rates=44100";
  let inputIndex = inputCount;

  let narrationLabel: string | null = null;
  let narrationKey: string | null = null;
  let musicLabel: string | null = null;

  if (options.narrationPath) {
    extraInputs.push("-i", options.narrationPath);
    // De-rumble + presence lift for clarity, controlled level, then split: one
    // copy for the mix, one to key the music ducking.
    filterParts.push(
      `[${inputIndex}:a]volume=${options.narrationGainDb ?? 0}dB,` +
        "highpass=f=85,equalizer=f=3000:width_type=q:w=1.2:g=3," +
        "loudnorm=I=-16:TP=-1.5:LRA=11," +
        `${stereo},asplit=2[narr_a][narr_key]`
    );
    narrationLabel = "[narr_a]";
    narrationKey = "[narr_key]";
    inputIndex += 1;
  }

  if (options.musicPath) {
    extraInputs.push("-i", options.musicPath);
    const fadeStart = Math.max(0, totalDuration - 2).toFixed(2);
    filterParts.push(
      `[${inputIndex}:a]volume=${options.musicGainDb}dB,${stereo},afade=t=out:st=${fadeStart}:d=2[music_pre]`
    );
    if (narrationKey) {
      // Duck the score ~9dB under the voiceover whenever narration is present,
      // with a slow release so the bed swells back up cleanly between lines.
      filterParts.push(
        `[music_pre]${narrationKey}sidechaincompress=threshold=0.05:ratio=8:attack=15:release=450:makeup=1[music_a]`
      );
    } else {
      filterParts.push(`[music_pre]anull[music_a]`);
    }
    musicLabel = "[music_a]";
    inputIndex += 1;
  }

  const mixLabels = ["[base_a]"];
  if (musicLabel) {
    mixLabels.push(musicLabel);
  }
  if (narrationLabel) {
    mixLabels.push(narrationLabel);
  }
  if (mixLabels.length === 1) {
    return { extraInputs, filterParts, finalAudioLabel: "[base_a]" };
  }
  filterParts.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[mix_a]`,
    // Master to the streaming loudness standard so the cut isn't quiet.
    `[mix_a]loudnorm=I=-14:TP=-1.0:LRA=11,${stereo}[out_a]`
  );
  return { extraInputs, filterParts, finalAudioLabel: "[out_a]" };
}

/**
 * The `-c copy` path: no filtergraph, no re-encode, no generation loss. Taken
 * whenever nothing needs mixing, which on a model that bakes its own full mix
 * into every clip is the NORMAL path rather than the empty-sounding one.
 */
function losslessPlan(clips: StitchClip[], options: StitchOptions): StitchPlan {
  return {
    concatList: concatListContent(clips),
    steps: [
      {
        args: [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          options.concatListPath,
          "-c",
          "copy",
          // Dropping a stream is still a stream copy, so muting does not cost
          // the lossless path.
          ...(options.muteClips ? ["-an"] : []),
          options.outputPath,
        ],
        description: `lossless concat of ${clips.length} clips${options.muteClips ? " (clip audio dropped)" : ""}`,
      },
    ],
  };
}

/**
 * Build the executable plan. Two paths:
 * - xfade === 0 and no music/narration: lossless concat (-c copy).
 * - otherwise: single re-encode pass (concat or xfade graph) + audio mix.
 */
export function buildStitchPlan(
  clips: StitchClip[],
  options: StitchOptions
): StitchPlan {
  if (clips.length === 0) {
    throw new Error("nothing to stitch — no downloaded clips found");
  }

  // Muting is expressed as "this clip has no audio", which the input builder
  // already handles by substituting a silent source. Reusing that path keeps
  // one description of what a silent clip means instead of two.
  const sourceClips = options.muteClips
    ? clips.map((clip) => ({ ...clip, hasAudio: false }))
    : clips;

  const junctionFades = sourceClips
    .slice(1)
    .map((clip) => clip.transition ?? options.xfade);
  const anyFade = junctionFades.some((f) => f > 0);
  const lossless =
    !anyFade && !options.musicPath && !options.narrationPath && !options.grade;

  if (lossless) {
    return losslessPlan(sourceClips, options);
  }

  const {
    args: inputs,
    audioInputs,
    inputCount,
    videoInputs,
  } = clipInputArgs(sourceClips);
  const filterParts: string[] = [];
  let videoLabel: string;
  let audioLabel: string;

  if (anyFade && sourceClips.length > 1) {
    const offsets = computeXfadeOffsets(
      sourceClips.map((clip) => clip.duration),
      junctionFades
    );
    let v = `[${videoInputs[0]}:v]`;
    let a = `[${audioInputs[0]}:a]`;
    for (let i = 1; i < sourceClips.length; i += 1) {
      const fade = Math.max(0.05, junctionFades[i - 1] ?? 0.05);
      const vOut = i === sourceClips.length - 1 ? "[vx]" : `[vx${i}]`;
      const aOut = i === sourceClips.length - 1 ? "[ax]" : `[ax${i}]`;
      filterParts.push(
        `${v}[${videoInputs[i]}:v]xfade=transition=fade:duration=${fade}:offset=${(offsets[i - 1] ?? 0).toFixed(3)}${vOut}`
      );
      filterParts.push(`${a}[${audioInputs[i]}:a]acrossfade=d=${fade}${aOut}`);
      v = vOut;
      a = aOut;
    }
    videoLabel = "[vx]";
    audioLabel = "[ax]";
  } else {
    const segments = sourceClips
      .map((_, i) => `[${videoInputs[i]}:v][${audioInputs[i]}:a]`)
      .join("");
    filterParts.push(
      `${segments}concat=n=${sourceClips.length}:v=1:a=1[vx][ax]`
    );
    videoLabel = "[vx]";
    audioLabel = "[ax]";
  }

  const totalDuration =
    sourceClips.reduce((sum, clip) => sum + clip.duration, 0) -
    junctionFades.reduce((sum, f) => sum + f, 0);
  if (options.grade) {
    filterParts.push(`${videoLabel}eq=contrast=1.04:saturation=1.1[vg]`);
    videoLabel = "[vg]";
  }
  filterParts.push(
    `${audioLabel}volume=${options.sfxGainDb ?? 0}dB,aformat=channel_layouts=stereo:sample_rates=44100[base_a]`
  );
  const mix = audioMixArgs(options, inputCount, totalDuration);
  filterParts.push(...mix.filterParts);

  return {
    steps: [
      {
        args: [
          "-y",
          ...inputs,
          ...mix.extraInputs,
          "-filter_complex",
          filterParts.join(";"),
          "-map",
          videoLabel,
          "-map",
          mix.finalAudioLabel,
          "-c:v",
          "libx264",
          "-crf",
          "17",
          "-preset",
          "slow",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "256k",
          options.outputPath,
        ],
        description: `re-encode stitch of ${sourceClips.length} clips${anyFade ? " with per-junction transitions" : ""}${options.musicPath ? " + music bed" : ""}${options.narrationPath ? " + narration" : ""}${options.grade ? " + grade" : ""}`,
      },
    ],
  };
}
