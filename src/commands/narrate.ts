import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { geminiBaseUrl, loadEnv, requireGeminiApiKey } from "../env.js";
import { VsError } from "../errors.js";
import { isComplete, loadManifest } from "../manifest.js";
import {
  assertLastLineBeforeFade,
  assertLinesWithinRuntime,
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
import { buildSpeechBody, GeminiTtsClient, resolveVoice } from "../tts.js";
import type { SpeechRequest } from "../tts.js";
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
  /** Delivery direction (tone, pace, emotion) for every line. */
  style?: string;
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

function createTtsClient(): GeminiTtsClient {
  loadEnv();
  return new GeminiTtsClient({
    apiKey: requireGeminiApiKey(),
    baseUrl: geminiBaseUrl(),
  });
}

function probeDuration(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf-8" }
  );
  return Number(out.trim());
}

async function speechIdentity(path: string, request: SpeechRequest) {
  return {
    audioSha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    model: request.model,
    requestSha256: createHash("sha256")
      .update(JSON.stringify(buildSpeechBody(request)))
      .digest("hex"),
    schemaVersion: 3,
    text: request.text,
    voice: request.voice,
  };
}

/** Existing audio is reusable only when its recorded script, voice and bytes match. */
async function assertReusableSpeech(
  path: string,
  request: SpeechRequest
): Promise<void> {
  let recorded: unknown;
  try {
    recorded = JSON.parse(await readFile(`${path}.json`, "utf-8"));
  } catch {
    throw new VsError(
      "invalid_input",
      `unverified existing narration: ${path}`,
      {
        hint: "use a new --output directory or audit the legacy recording before reuse; filenames alone do not prove which script was spoken",
      }
    );
  }
  const expected = await speechIdentity(path, request);
  if (
    !recorded ||
    typeof recorded !== "object" ||
    Object.entries(expected).some(
      ([key, value]) => (recorded as Record<string, unknown>)[key] !== value
    )
  ) {
    throw new VsError("invalid_input", `stale narration: ${path}`, {
      hint: "script, voice, style, model or audio changed; use a new --output directory, or --force to deliberately regenerate",
    });
  }
}

async function recordSpeech(
  path: string,
  request: SpeechRequest
): Promise<void> {
  await writeFile(
    `${path}.json`,
    JSON.stringify(await speechIdentity(path, request))
  );
}

async function validateAssemblyProvenance(
  linesDir: string,
  placements: Awaited<ReturnType<typeof loadPlacementFile>>
): Promise<void> {
  const linesPath = join(linesDir, "lines.tsv");
  if (!existsSync(linesPath)) {
    warn(
      `no ${linesPath}; assembling curated external audio without script provenance verification`
    );
    return;
  }
  const lines = await loadLinesFile(linesPath);
  const currentText = new Map(lines.map((entry) => [entry.number, entry.text]));
  for (const placement of placements) {
    const expectedText = currentText.get(placement.line);
    if (expectedText === undefined) {
      throw new VsError(
        "invalid_input",
        `placement references narration line ${placement.line} missing from ${linesPath}`,
        {
          hint: "update placement.tsv to use only current lines.tsv line numbers",
        }
      );
    }
    const audio = lineAudioPath(linesDir, placement.line);
    if (!existsSync(audio)) {
      throw new VsError("invalid_input", `missing line audio: ${audio}`, {
        hint: "run `vs narrate <lines.tsv>` first",
      });
    }
    const sidecarPath = `${audio}.json`;
    if (!existsSync(sidecarPath)) {
      warn(
        `line ${placement.line} has no provenance sidecar; assembling curated legacy audio without verification`
      );
      continue;
    }
    let sidecar: unknown;
    try {
      sidecar = JSON.parse(await readFile(sidecarPath, "utf-8"));
    } catch {
      throw new VsError(
        "invalid_input",
        `invalid narration provenance: ${sidecarPath}`,
        { hint: "repair or remove the sidecar after auditing the audio" }
      );
    }
    if (!sidecar || typeof sidecar !== "object") {
      throw new VsError(
        "invalid_input",
        `invalid narration provenance: ${sidecarPath}`
      );
    }
    const recorded = sidecar as Record<string, unknown>;
    const audioSha256 = createHash("sha256")
      .update(await readFile(audio))
      .digest("hex");
    if (
      recorded.text !== expectedText ||
      recorded.audioSha256 !== audioSha256
    ) {
      throw new VsError("invalid_input", `stale narration: ${audio}`, {
        hint: "the current line text or audio bytes do not match the provenance sidecar",
      });
    }
  }
}

export async function runNarrate(
  linesFilePath: string | undefined,
  options: NarrateOptions,
  injected: { client?: GeminiTtsClient } = {}
): Promise<void> {
  loadEnv();
  if (options.textFile) {
    const resolvedText = resolve(options.textFile);
    const text = await loadScratchText(resolvedText);
    const outPath = scratchAudioPath(resolvedText, options.outputFile);
    const request = {
      model: options.model,
      style: options.style,
      text,
      voice: resolveVoice(options.voice),
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
      await assertReusableSpeech(outPath, request);
      note(`${outPath} matches the recorded script and voice, skipping`);
      emit(
        { output: outPath, status: "skipped", textFile: resolvedText },
        () => {
          note(`existing scratch VO at ${outPath}`);
        }
      );
      return;
    }

    await mkdir(dirname(outPath), { recursive: true });
    const client = injected.client ?? createTtsClient();
    const bytes = await client.textToSpeech(request);
    await writeFile(outPath, bytes);
    await recordSpeech(outPath, request);
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
  const requests = buildNarrateLineRequests(
    lines,
    resolveVoice(options.voice),
    options.model,
    options.style
  );

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

  // Validate the entire batch before any paid request; an added line must not
  // hide stale or shifted existing recordings later in the script.
  if (!options.force) {
    for (const entry of requests) {
      const path = lineAudioPath(linesDir, entry.line);
      if (existsSync(path)) {
        await assertReusableSpeech(path, entry.request);
      }
    }
  }
  await mkdir(linesDir, { recursive: true });
  const client = injected.client ?? createTtsClient();

  for (const entry of requests) {
    const outPath = lineAudioPath(linesDir, entry.line);
    if (existsSync(outPath) && !options.force) {
      note(`${entry.path} exists, skipping (pass --force to regenerate)`);
      continue;
    }
    const bytes = await client.textToSpeech(entry.request);
    await writeFile(outPath, bytes);
    await recordSpeech(outPath, entry.request);
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
  await validateAssemblyProvenance(linesDir, placements);
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
  assertLinesWithinRuntime(placed, total);
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
  const shifted = placed.filter((entry) => entry.shiftSeconds > 0);

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
          const shift =
            entry.shiftSeconds > 0
              ? ` (shifted +${entry.shiftSeconds.toFixed(2)}s from ${entry.requestedStart.toFixed(2)}s to avoid overlap)`
              : "";
          line(
            `line ${String(entry.line).padStart(2, "0")}: ${entry.start.toFixed(2)} → ${(entry.start + entry.duration).toFixed(2)}${shift}`
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
  for (const entry of shifted) {
    warn(
      `line ${entry.line} shifted +${entry.shiftSeconds.toFixed(2)}s from ${entry.requestedStart.toFixed(2)}s to avoid overlap`
    );
  }
  await mkdir(dirname(outPath), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...ffmpegArgs], {
    stdio: "inherit",
  });
  emit(
    {
      output: outPath,
      placed,
      shiftedLines: shifted.length,
      status: "ok",
      totalRuntime: total,
    },
    () => {
      ok(`narration → ${outPath} (${probeDuration(outPath).toFixed(2)}s)`);
    }
  );
}
