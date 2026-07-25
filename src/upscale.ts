export interface UpscalePlanInput {
  /** x264 quality (lower = higher quality / larger file). */
  crf: number;
  /** Target output height in pixels (e.g. 1080). */
  height: number;
  inputPath: string;
  outputPath: string;
  /** Source video height, used to decide whether there's anything to upscale. */
  sourceHeight: number;
}

export interface UpscalePlan {
  args: string[];
  /** True when the source is already >= the target height — nothing to do. */
  skip: boolean;
}

/**
 * Lanczos upscale a finished clip to a higher delivery resolution.
 *
 * The cost ladder's last rung: films generate at 720p (Seedance's native
 * ceiling) and only the shots that survive the edit get upscaled to 1080p for
 * delivery — for free, in ffmpeg, instead of paying the API's pricier 1080p
 * generation. `-2:height` keeps the width even and preserves aspect; lanczos is
 * the sharpest of the common scalers. Video is re-encoded (libx264) and audio
 * is copied through untouched, since upscaling is a video-only operation.
 *
 * If the source already meets the target height, `skip` is true and `args` is
 * empty — the caller leaves the master alone rather than re-encoding it.
 */
export function buildUpscalePlan(input: UpscalePlanInput): UpscalePlan {
  if (input.sourceHeight >= input.height) {
    return { args: [], skip: true };
  }
  return {
    args: [
      "-y",
      "-i",
      input.inputPath,
      "-vf",
      `scale=-2:${input.height}:flags=lanczos`,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(input.crf),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    skip: false,
  };
}
