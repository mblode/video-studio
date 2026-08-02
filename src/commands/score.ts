import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GeminiClient } from "../gemini.js";
import {
  buildScorePlan,
  estimateFilmRuntimeSeconds,
  extensionForAudioMime,
  extractInlineAudio,
} from "../score.js";
import { assertNewVideoOutput, versionLabel } from "../versions.js";
import { createGeminiClient, resolveFilm, resolveOutput } from "./context.js";
import { emit, heading, line, note, ok } from "./output.js";

export interface ScoreOptions {
  clip: boolean;
  dryRun: boolean;
  /** Explicit bed length in seconds; otherwise estimated from shots.json. */
  duration?: number;
  /** Explicit output path (cwd-relative). Omit for score-vNNN.mp3 at film root. */
  output?: string;
  /** Prompt text. */
  prompt: string;
  /** Optional shots.json — used to estimate program length when --duration omitted. */
  shots?: string;
}

/** Allocate `score-vNNN.mp3` (or .wav) next to the film, never overwriting. */
export function nextScorePath(filmDir: string, extension = ".mp3"): string {
  for (let version = 1; ; version += 1) {
    const candidate = join(
      filmDir,
      `score-${versionLabel(version)}${extension}`
    );
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

export async function runScore(
  options: ScoreOptions,
  injected: { client?: GeminiClient } = {}
): Promise<void> {
  let durationSeconds = options.duration;
  let filmDir = process.cwd();

  if (options.shots) {
    const { file, shotsDir } = await resolveFilm(options.shots);
    filmDir = shotsDir;
    if (durationSeconds === undefined) {
      durationSeconds = estimateFilmRuntimeSeconds(file);
    }
  }

  const plan = buildScorePlan({
    clip: options.clip,
    durationSeconds,
    prompt: options.prompt,
  });

  const outputPath = options.output
    ? resolveOutput(options.output, nextScorePath(filmDir))
    : nextScorePath(filmDir);

  if (options.dryRun) {
    emit(
      {
        dryRun: true,
        model: plan.model,
        note: plan.note,
        output: outputPath,
        payload: plan.body,
      },
      () => {
        heading("# score");
        line(JSON.stringify(plan.body, undefined, 2));
        note(`${plan.note}; would write ${outputPath}`);
      }
    );
    return;
  }

  assertNewVideoOutput(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const client = injected.client ?? createGeminiClient();
  const json = await client.generateContent(plan.model, plan.body);
  const audio = extractInlineAudio(json);
  const ext = extensionForAudioMime(audio.mimeType);
  const writePath = outputPath.endsWith(ext)
    ? outputPath
    : outputPath.replace(/\.[^.]+$/u, ext);
  if (writePath !== outputPath) {
    assertNewVideoOutput(writePath);
  }
  await writeFile(writePath, Buffer.from(audio.data, "base64"));

  emit({ model: plan.model, output: writePath, status: "ok" }, () => {
    ok(`score → ${writePath}`);
    note(
      `mix with: vs stitch <shots.json> --music ${writePath} --narration narration.mp3`
    );
  });
}
