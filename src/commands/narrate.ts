import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildSpeechBody,
  ElevenLabsClient as ElevenClient,
  requireElevenLabsApiKey,
  requireElevenLabsVoiceId,
} from "../elevenlabs.js";
import type { ElevenLabsClient } from "../elevenlabs.js";
import { loadEnv } from "../env.js";
import { VsError } from "../errors.js";
import { isComplete, loadManifest } from "../manifest.js";
import {
  assertLastLineBeforeFade,
  buildAssembleFfmpegArgs,
  buildAssembleSegments,
  buildNarrateLineRequests,
  lineAudioPath,
  loadLinesFile,
  loadPlacementFile,
  loadScratchText,
  placeLines,
  renderNarrateDryRun,
  scratchAudioPath,
  shotStartTimes,
} from "../narrate.js";
import { resolveOutput } from "../paths.js";
import { assertNewVideoOutput } from "../versions.js";
import { resolveFilm } from "./context.js";
import { emit, heading, line, note, ok, warn } from "./output.js";

export interface NarrateOptions {
  dryRun: boolean;
  force: boolean;
  model: string;
  /** Directory for line-NN.mp3 (default: dirname of lines file). */
  outputDir?: string;
  /** Scratch VO mp3 path when using --text-file. */
  outputFile?: string;
  /** Monolith scratch VO from a plain text file (ignores lines TSV). */
  textFile?: string;
  voice?: string;
}

export interface NarrateAssembleOptions {
  dryRun: boolean;
  /** Prefer draft manifest clips when set. */
  draft: boolean;
  /** Shot id whose end fade the last line must clear (optional). */
  fadeShot?: string;
  /** Fade lead seconds before shot end (default 1.5). */
  fadeLead: number;
  output?: string;
  placement: string;
  /**
   * Default crossfade INTO each segment when shot/card `transition` is unset.
   * Must match `vs stitch --xfade` (CLI default 0).
   */
  xfade: number;
}

function createElevenClient(): ElevenLabsClient {
  loadEnv();
  return new ElevenClient({ apiKey: requireElevenLabsApiKey() });
}

function probeDuration(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf-8" }
  );
  return Number(out.trim());
}

export async function runNarrate(
  linesFilePath: string | undefined,
  options: NarrateOptions,
  injected: { client?: ElevenLabsClient } = {}
): Promise<void> {
  loadEnv();
  if (options.textFile) {
    const resolvedText = resolve(options.textFile);
    const text = await loadScratchText(resolvedText);
    const voiceId = requireElevenLabsVoiceId(options.voice);
    const outPath = scratchAudioPath(resolvedText, options.outputFile);
    const request = {
      modelId: options.model,
      text,
      voiceId,
    };

    if (options.dryRun) {
      emit(
        {
          dryRun: true,
          output: outPath,
          request: buildSpeechBody(request),
          textFile: resolvedText,
        },
        () => {
          heading("# narrate");
          line(
            `${outPath}: ${text.slice(0, 72)}${text.length > 72 ? "…" : ""}`
          );
          note(
            `scratch VO via ${options.model} → ${outPath}; nothing submitted.`
          );
        }
      );
      return;
    }

    if (existsSync(outPath) && !options.force) {
      note(`${outPath} exists, skipping (pass --force to regenerate)`);
      emit(
        { output: outPath, status: "skipped", textFile: resolvedText },
        () => {
          note(`existing scratch VO at ${outPath}`);
        }
      );
      return;
    }

    await mkdir(dirname(outPath), { recursive: true });
    const client = injected.client ?? createElevenClient();
    const bytes = await client.textToSpeech(request);
    await writeFile(outPath, bytes);
    emit({ output: outPath, status: "ok", textFile: resolvedText }, () => {
      ok(`scratch VO → ${outPath}`);
    });
    return;
  }
  if (!linesFilePath) {
    throw new VsError("invalid_input", "lines TSV path required", {
      hint: "pass a lines.tsv positional or use --text-file for scratch VO",
    });
  }
  const lines = await loadLinesFile(linesFilePath);
  const linesDir = options.outputDir
    ? resolve(process.cwd(), options.outputDir)
    : dirname(resolve(linesFilePath));
  const voiceId = requireElevenLabsVoiceId(options.voice);
  const requests = buildNarrateLineRequests(lines, voiceId, options.model);

  if (options.dryRun) {
    emit(
      {
        dryRun: true,
        lines: renderNarrateDryRun(requests),
        outputDir: linesDir,
      },
      () => {
        heading("# narrate");
        for (const entry of requests) {
          line(
            `${entry.path}: ${entry.request.text.slice(0, 72)}${entry.request.text.length > 72 ? "…" : ""}`
          );
        }
        note(
          `${requests.length} line(s) via ${options.model} → ${linesDir}; nothing submitted.`
        );
      }
    );
    return;
  }

  await mkdir(linesDir, { recursive: true });
  const client = injected.client ?? createElevenClient();

  for (const [index, entry] of requests.entries()) {
    const outPath = lineAudioPath(linesDir, entry.line);
    if (existsSync(outPath) && !options.force) {
      note(`${entry.path} exists, skipping (pass --force to regenerate)`);
      continue;
    }
    const previousText = lines[index - 1]?.text;
    const nextText = lines[index + 1]?.text;
    const bytes = await client.textToSpeech({
      modelId: options.model,
      nextText,
      previousText,
      text: entry.request.text,
      voiceId,
    });
    await writeFile(outPath, bytes);
    ok(`${entry.path} → ${outPath}`);
  }

  emit({ lines: requests.length, outputDir: linesDir, status: "ok" }, () => {
    note(
      `next: vs narrate assemble <shots.json> --placement narration/placement.tsv`
    );
  });
}

export async function runNarrateAssemble(
  shotsFilePath: string,
  options: NarrateAssembleOptions
): Promise<void> {
  const pass = options.draft ? "draft" : "final";
  const { file, shotsDir } = await resolveFilm(shotsFilePath, { pass });
  const placementPath = resolve(shotsDir, options.placement);
  const linesDir = dirname(placementPath);
  const placements = await loadPlacementFile(placementPath);
  const manifest = await loadManifest(shotsFilePath, pass);

  const shotDurations: Record<string, number> = {};
  for (const shot of file.shots) {
    const entry = manifest.entries[shot.id];
    if (entry?.outputPath && isComplete(entry, shotsDir)) {
      shotDurations[shot.id] = probeDuration(
        resolve(shotsDir, entry.outputPath)
      );
      continue;
    }
    const flat = join(
      shotsDir,
      options.draft ? "output-draft" : "output",
      `${shot.id}.mp4`
    );
    if (existsSync(flat)) {
      shotDurations[shot.id] = probeDuration(flat);
      continue;
    }
    warn(
      `missing clip for ${shot.id} — using authored duration for timeline math`
    );
  }

  const segments = buildAssembleSegments(file, shotDurations, options.xfade);
  const { starts, total } = shotStartTimes(segments);

  const lineDurations: Record<number, number> = {};
  for (const placement of placements) {
    const audio = lineAudioPath(linesDir, placement.line);
    if (!existsSync(audio)) {
      throw new VsError("invalid_input", `missing line audio: ${audio}`, {
        hint: "run `vs narrate <lines.tsv>` first",
      });
    }
    lineDurations[placement.line] = probeDuration(audio);
  }

  const placed = placeLines(placements, starts, lineDurations, linesDir);
  assertLastLineBeforeFade(
    placed,
    starts,
    segments,
    options.fadeShot,
    options.fadeLead
  );

  const outPath = options.output
    ? resolveOutput(options.output, join(shotsDir, "narration.mp3"))
    : join(shotsDir, "narration.mp3");

  const ffmpegArgs = buildAssembleFfmpegArgs(placed, total, outPath);

  if (options.dryRun) {
    emit(
      {
        dryRun: true,
        ffmpegArgs,
        placed,
        totalRuntime: total,
      },
      () => {
        heading("# narrate assemble");
        for (const seg of segments) {
          line(
            `${seg.kind.padEnd(5)} ${seg.id.padEnd(24)} dur=${seg.dur.toFixed(2)}`
          );
        }
        for (const entry of placed) {
          line(
            `line ${String(entry.line).padStart(2, "0")}: ${entry.start.toFixed(2)} → ${(entry.start + entry.duration).toFixed(2)}`
          );
        }
        note(`total ${total.toFixed(2)}s; would write ${outPath}`);
      }
    );
    return;
  }

  if (options.output) {
    assertNewVideoOutput(outPath);
  }
  await mkdir(dirname(outPath), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...ffmpegArgs], {
    stdio: "inherit",
  });
  emit({ output: outPath, status: "ok", totalRuntime: total }, () => {
    ok(`narration → ${outPath} (${probeDuration(outPath).toFixed(2)}s)`);
  });
}
