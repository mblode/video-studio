import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { ArkClient } from "../ark.js";
import {
  baseUrl,
  comfyuiBaseUrl,
  geminiBaseUrl,
  loadEnv,
  minimaxBaseUrl,
  requireApiKey,
  requireGeminiApiKey,
  requireMinimaxApiKey,
} from "../env.js";
import { VsError } from "../errors.js";
import { GeminiClient } from "../gemini.js";
import { passSuffix, resolveOutput } from "../paths.js";
import type { Pass } from "../paths.js";
import { createArk } from "../providers/ark.js";
import { createComfyUI } from "../providers/comfyui.js";
import { createMinimax } from "../providers/minimax.js";
import { resolveModelId } from "../providers/registry.js";
import { loadShotsFile, loadStillsFile } from "../shots.js";
import type { VideoModelV1 } from "../spec/video-model.js";
import type { ShotsFile, StillsFile } from "../types.js";

/**
 * Load `.env` and build an authenticated Ark client.
 *
 * Still exported for the STILLS path (Seedream), which is deliberately not
 * behind the video provider spec: it already routes two backends by model id
 * in stills.ts, and it costs cents rather than dollars. Video commands must
 * use `createVideoModel` instead.
 */
export function createArkClient(): ArkClient {
  loadEnv();
  return new ArkClient({ apiKey: requireApiKey(), baseUrl: baseUrl() });
}

/**
 * The one place a video model is constructed, and the one place a key is read
 * for one.
 *
 * Routing is registry data, not a branch that grows per provider: see
 * `resolveModelId` in src/providers/registry.ts. A command passes the id its
 * film configured and gets back something satisfying `VideoModelV1`; it never
 * learns which backend answered.
 */
export function createVideoModel(configuredModelId: string): VideoModelV1 {
  loadEnv();
  const { modelId, provider } = resolveModelId(configuredModelId);
  if (provider === "comfyui") {
    return createComfyUI({ baseUrl: comfyuiBaseUrl() }).videoModel(modelId);
  }
  if (provider === "minimax") {
    return createMinimax({
      // The FUNCTION, not its result: a dry-run builds a model to render a
      // body and must not demand a key to do it.
      apiKey: requireMinimaxApiKey,
      baseUrl: minimaxBaseUrl(),
    }).videoModel(modelId);
  }
  return createArk({ apiKey: requireApiKey, baseUrl: baseUrl() }).videoModel(
    modelId
  );
}

/** Load `.env` and build a Gemini client for Nano Banana stills (gemini-* models). */
export function createGeminiClient(): GeminiClient {
  loadEnv();
  return new GeminiClient({
    apiKey: requireGeminiApiKey(),
    baseUrl: geminiBaseUrl(),
  });
}

export interface PackageInfo {
  engines?: { node?: string };
  version: string;
}

/**
 * This package's own manifest. Searched upward from the running module so the
 * lookup works both from `src/` (tests, tsx) and from the bundled `dist/cli.js`;
 * hardcoding `../package.json` is right for exactly one of those.
 */
export function packageInfo(): PackageInfo {
  let dir = import.meta.dirname;
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf-8")) as PackageInfo;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return { version: "0.0.0" };
    }
    dir = parent;
  }
}

/**
 * Fail fast instead of hanging when a prompt has no one to answer it.
 * `@clack/prompts` never resolves on a non-TTY stdin, so under a coding agent
 * or in CI an unguarded confirm wedges the run forever.
 */
export function assertInteractive(flag: string): void {
  if (process.env.CI || !process.stdin.isTTY) {
    throw new VsError(
      "not_interactive",
      "this step needs an answer but stdin is not an interactive terminal",
      { hint: `re-run with ${flag} to accept without prompting` }
    );
  }
}

export interface FilmContext {
  file: ShotsFile;
  outputDir: string;
  shotsDir: string;
}

/**
 * Resolve a shots file into its parsed contents plus the directories every
 * command needs: `shotsDir` (where the file lives) and `outputDir` (where clips
 * land, honouring `--output`, then `film.outputDir`, then `./output`).
 *
 * For a draft pass the default output dir gets a `-draft` suffix so drafts sit
 * beside finals. An explicit `--output` is resolved against the cwd; the
 * caller owns that path.
 */
export async function resolveFilm(
  shotsFilePath: string,
  options: { output?: string; pass?: Pass } = {}
): Promise<FilmContext> {
  const file = await loadShotsFile(shotsFilePath);
  const shotsDir = dirname(resolve(shotsFilePath));
  const suffix = passSuffix(options.pass ?? "final");
  const outputDir = resolveOutput(
    options.output,
    resolve(shotsDir, `${file.film.outputDir ?? "./output"}${suffix}`)
  );
  return { file, outputDir, shotsDir };
}

export interface StillsContext {
  file: StillsFile;
  outputDir: string;
  stillsDir: string;
}

/**
 * The stills-file counterpart of `resolveFilm`. Kept separate because the two
 * schemas disagree on where the output directory lives: `film.outputDir` for
 * shots, top-level `outputDir` for stills.
 */
export async function resolveStills(
  stillsFilePath: string,
  options: { output?: string } = {}
): Promise<StillsContext> {
  const file = await loadStillsFile(stillsFilePath);
  const stillsDir = dirname(resolve(stillsFilePath));
  const outputDir = resolveOutput(
    options.output,
    resolve(stillsDir, file.outputDir ?? "./stills")
  );
  return { file, outputDir, stillsDir };
}
