import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import { assertFfmpeg, probeClip, runFfmpeg } from "../ffmpeg.js";
import { buildSharePlan } from "../share.js";
import { resolveOutput } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";

export interface ShareCommandOptions {
  audioKbps: number;
  dryRun: boolean;
  height: number;
  maxMb: number;
  output?: string;
}

/** Default output path: `<name>-whatsapp.mp4` beside the input. */
function defaultOutput(inputPath: string): string {
  const dir = dirname(inputPath);
  const name = basename(inputPath, extname(inputPath));
  return join(dir, `${name}-whatsapp.mp4`);
}

/**
 * Compress a finished video to a hard size ceiling for messaging apps
 * (WhatsApp/Telegram/email). Two-pass x264 so the size lands predictably,
 * preserving the source audio at a clean bitrate.
 */
export async function runShare(
  videoPath: string,
  options: ShareCommandOptions
): Promise<void> {
  await assertFfmpeg();
  const inputPath = resolve(process.cwd(), videoPath);
  const outputPath = resolveOutput(options.output, defaultOutput(inputPath));

  const probe = await probeClip(inputPath);
  const maxBytes = Math.floor(options.maxMb * 1_048_576);
  const plan = buildSharePlan({
    audioKbps: options.audioKbps,
    durationSec: probe.duration,
    height: options.height,
    inputPath,
    maxBytes,
    outputPath,
    passLogPrefix: join(
      tmpdir(),
      `vs-share-${basename(inputPath, extname(inputPath))}`
    ),
    sourceHeight: probe.height,
  });

  if (options.dryRun) {
    const commands = [
      { args: plan.pass1, description: "pass 1/2: analysis" },
      { args: plan.pass2, description: "pass 2/2: encode + audio" },
    ];
    emit(
      { commands, dryRun: true, outputPath, videoKbps: plan.videoKbps },
      () => {
        heading(
          `# two-pass encode → ${outputPath} (target ${options.maxMb}MB, video ${plan.videoKbps}kbps + audio ${options.audioKbps}kbps)`
        );
        for (const command of commands) {
          line(`ffmpeg ${command.args.join(" ")}`);
        }
      }
    );
    return;
  }

  note(`pass 1/2: video ${plan.videoKbps}kbps (target ${options.maxMb}MB)`);
  await runFfmpeg(plan.pass1);
  note("pass 2/2: encoding + audio");
  await runFfmpeg(plan.pass2);

  const finalStat = await stat(outputPath);
  const finalBytes = finalStat.size;
  const finalMb = Number((finalBytes / 1_048_576).toFixed(1));
  const within = finalBytes <= maxBytes;
  emit({ outputPath, sizeMb: finalMb, within }, () => {
    if (within) {
      ok(`${outputPath} (${finalMb}MB)`);
    } else {
      warn(
        `${outputPath} is ${finalMb}MB, over the ${options.maxMb}MB target; re-run with a lower --height or --max-mb`
      );
    }
  });
}
