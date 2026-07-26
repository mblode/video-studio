import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { VsError } from "./errors.js";

const execFileAsync = promisify(execFile);

export interface ClipProbe {
  duration: number;
  fps: number;
  hasAudio: boolean;
  height: number;
  width: number;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function notInstalled(name: string, cause: unknown): VsError {
  return new VsError("missing_dependency", `${name} is not installed`, {
    cause,
    hint: "install it with `brew install ffmpeg` (macOS) or your package manager, then re-run `vs doctor`",
  });
}

export async function assertBinary(name: string): Promise<void> {
  try {
    await execFileAsync(name, ["-version"]);
  } catch (error) {
    if (isEnoent(error)) {
      throw notInstalled(name, error);
    }
    throw error;
  }
}

export function assertFfmpeg(): Promise<void> {
  return assertBinary("ffmpeg");
}

/** Banner and progress noise ffmpeg prints before it gets to the real problem. */
const FFMPEG_NOISE =
  /^(?:ffmpeg version|built with|configuration:|\s|lib\w+\s+\d|Input #|Output #|Stream #|Metadata:|Duration:|frame=|\[.*@ 0x[\da-f]+\] Using|Press \[q\])/u;

/**
 * The one line worth putting in an error message. ffmpeg's real complaint is
 * almost always the last non-banner line; the rest belongs in `cause`, behind
 * `--verbose`.
 */
export function summarizeFfmpegStderr(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !FFMPEG_NOISE.test(l));
  return lines.at(-1) ?? "no diagnostic output";
}

export async function probeClip(path: string): Promise<ClipProbe> {
  // Checked before ffprobe is even located: without it a missing file surfaces
  // as a raw execFile command line, which reads like a crash rather than "you
  // named a file that is not there".
  if (!existsSync(path)) {
    throw new VsError("file_not_found", `${path}: no such file`, {
      hint: "check the path, or generate the clip first with `vs generate <shots-file>`",
    });
  }
  await assertBinary("ffprobe");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ]));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    const summary = summarizeFfmpegStderr(stderr);
    throw new VsError(
      "probe_failed",
      summary.includes(path) ? summary : `${path}: ${summary}`,
      {
        cause: error,
        hint: "the file is not a readable video (a truncated or partial download does this): delete it and re-download or regenerate the clip",
      }
    );
  }
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      avg_frame_rate?: string;
      codec_type?: string;
      duration?: string;
      height?: number;
      width?: number;
    }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const hasAudio = data.streams?.some((s) => s.codec_type === "audio") ?? false;
  if (!(video?.width && video.height)) {
    throw new VsError("probe_failed", `${path}: no video stream found`, {
      hint: "the file is audio-only or truncated: delete it and re-run `vs download <shots-file>` (or `vs generate ... --shot <id> --force`)",
    });
  }
  const [num, den] = (video.avg_frame_rate ?? "25/1").split("/").map(Number);
  // Use the VIDEO stream's duration for timeline math: audio commonly runs a
  // few frames longer, and xfade offsets computed past the real video end
  // truncate the whole chain.
  const formatDuration = Number(data.format?.duration ?? 0);
  const videoDuration = Number(video.duration ?? 0);
  return {
    duration:
      videoDuration > 0
        ? Math.min(videoDuration, formatDuration || videoDuration)
        : formatDuration,
    fps: den ? (num ?? 25) / den : 25,
    hasAudio,
    height: video.height,
    width: video.width,
  };
}

/** Extract the final frame of a video (seeks 0.5s before EOF). */
export function lastFrameArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-sseof",
    "-0.5",
    "-i",
    input,
    "-frames:v",
    "1",
    "-update",
    "1",
    "-q:v",
    "2",
    output,
  ];
}

/** Extract one frame at an absolute timestamp. */
export function frameAtArgs(
  input: string,
  seconds: number,
  output: string
): string[] {
  return [
    "-y",
    "-ss",
    seconds.toFixed(2),
    "-i",
    input,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    output,
  ];
}

/** Escape text for use inside an ffmpeg drawtext filter value. */
export function escapeDrawtext(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "’")
    .replaceAll(":", "\\:")
    .replaceAll("%", "\\%");
}

export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    if (isEnoent(error)) {
      throw notInstalled("ffmpeg", error);
    }
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    throw new VsError(
      "ffmpeg_failed",
      `ffmpeg failed: ${summarizeFfmpegStderr(stderr)}`,
      {
        cause: error,
        hint: "re-run with --verbose for the full ffmpeg output, or with --dry-run to inspect the command",
      }
    );
  }
}
