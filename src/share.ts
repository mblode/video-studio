import { devNull } from "node:os";

import { VsError } from "./errors.js";

export interface SharePlanInput {
  /** Audio bitrate to encode at, in kbps. */
  audioKbps: number;
  /** Video duration in seconds (drives the bitrate budget). */
  durationSec: number;
  /** Cap the output to this height; only ever downscales. */
  height: number;
  inputPath: string;
  /** Hard size ceiling in bytes (e.g. 49 MB for WhatsApp). */
  maxBytes: number;
  outputPath: string;
  /** Prefix for the two-pass log files (no extension). */
  passLogPrefix: string;
  /** Source video height, used to decide whether to downscale. */
  sourceHeight: number;
}

export interface SharePlan {
  pass1: string[];
  pass2: string[];
  /** The computed video bitrate, in kbps. */
  videoKbps: number;
}

/**
 * Two-pass x264 encode sized to land just under a hard byte ceiling.
 *
 * The bitrate budget is `maxBytes` spread across the clip's duration, minus the
 * audio track, with a small safety margin so muxer overhead doesn't push it
 * over. Two passes (vs a single CRF guess) are what make the final size land
 * predictably — the gold standard for a "must be under N MB" target.
 */
export function buildSharePlan(input: SharePlanInput): SharePlan {
  if (input.durationSec <= 0) {
    // Without a duration there is no bitrate budget, so this cannot be
    // guessed around: it is nearly always a file ffprobe could not read.
    throw new VsError(
      "probe_failed",
      `share: could not determine the duration of ${input.inputPath}`,
      {
        hint: "the file may not be a video ffprobe can read (a zero-byte or partial download does this); check it plays, and run `vs doctor` to confirm ffprobe is installed",
      }
    );
  }
  const totalKbits = (input.maxBytes * 8) / 1000;
  const budgetKbps = totalKbits / input.durationSec;
  // Reserve the audio, then keep ~3% headroom for container overhead.
  const videoKbps = Math.floor((budgetKbps - input.audioKbps) * 0.97);
  if (videoKbps < 100) {
    throw new Error(
      `share: target ${(input.maxBytes / 1_048_576).toFixed(0)}MB is too small for a ${input.durationSec.toFixed(0)}s clip (only ${videoKbps}kbps left for video) — raise --max-mb`
    );
  }

  const scale =
    input.sourceHeight > input.height
      ? ["-vf", `scale=-2:${input.height}`]
      : [];
  const common = [
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-b:v",
    `${videoKbps}k`,
    "-pix_fmt",
    "yuv420p",
    "-passlogfile",
    input.passLogPrefix,
    ...scale,
  ];

  return {
    pass1: [
      "-y",
      "-i",
      input.inputPath,
      ...common,
      "-pass",
      "1",
      "-an",
      "-f",
      "mp4",
      devNull,
    ],
    pass2: [
      "-y",
      "-i",
      input.inputPath,
      ...common,
      "-pass",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      `${input.audioKbps}k`,
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    videoKbps,
  };
}
