import type { Shot, TitleCard } from "./types.js";

export interface StitchClip {
  /** Absolute path of the mp4 (clip or rendered card). */
  path: string;
  duration: number;
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
  videoInputCount: number,
  totalDuration: number
): {
  extraInputs: string[];
  filterParts: string[];
  finalAudioLabel: string;
} {
  const extraInputs: string[] = [];
  const filterParts: string[] = [];
  const stereo = "aformat=channel_layouts=stereo:sample_rates=44100";
  let inputIndex = videoInputCount;

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

  const junctionFades = clips
    .slice(1)
    .map((clip) => clip.transition ?? options.xfade);
  const anyFade = junctionFades.some((f) => f > 0);
  const lossless =
    !anyFade && !options.musicPath && !options.narrationPath && !options.grade;

  if (lossless) {
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
            options.outputPath,
          ],
          description: `lossless concat of ${clips.length} clips`,
        },
      ],
    };
  }

  const inputs = clips.flatMap((clip) => ["-i", clip.path]);
  const filterParts: string[] = [];
  let videoLabel: string;
  let audioLabel: string;

  if (anyFade && clips.length > 1) {
    const offsets = computeXfadeOffsets(
      clips.map((clip) => clip.duration),
      junctionFades
    );
    let v = "[0:v]";
    let a = "[0:a]";
    for (let i = 1; i < clips.length; i += 1) {
      const fade = Math.max(0.05, junctionFades[i - 1] ?? 0.05);
      const vOut = i === clips.length - 1 ? "[vx]" : `[vx${i}]`;
      const aOut = i === clips.length - 1 ? "[ax]" : `[ax${i}]`;
      filterParts.push(
        `${v}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${(offsets[i - 1] ?? 0).toFixed(3)}${vOut}`
      );
      filterParts.push(`${a}[${i}:a]acrossfade=d=${fade}${aOut}`);
      v = vOut;
      a = aOut;
    }
    videoLabel = "[vx]";
    audioLabel = "[ax]";
  } else {
    const segments = clips.map((_, i) => `[${i}:v][${i}:a]`).join("");
    filterParts.push(`${segments}concat=n=${clips.length}:v=1:a=1[vx][ax]`);
    videoLabel = "[vx]";
    audioLabel = "[ax]";
  }

  const totalDuration =
    clips.reduce((sum, clip) => sum + clip.duration, 0) -
    junctionFades.reduce((sum, f) => sum + f, 0);
  if (options.grade) {
    filterParts.push(`${videoLabel}eq=contrast=1.04:saturation=1.1[vg]`);
    videoLabel = "[vg]";
  }
  filterParts.push(
    `${audioLabel}volume=${options.sfxGainDb ?? 0}dB,aformat=channel_layouts=stereo:sample_rates=44100[base_a]`
  );
  const mix = audioMixArgs(options, clips.length, totalDuration);
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
        description: `re-encode stitch of ${clips.length} clips${anyFade ? " with per-junction transitions" : ""}${options.musicPath ? " + music bed" : ""}${options.narrationPath ? " + narration" : ""}${options.grade ? " + grade" : ""}`,
      },
    ],
  };
}
