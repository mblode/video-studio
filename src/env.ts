import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { VsError } from "./errors.js";

export const DEFAULT_BASE_URL =
  "https://ark.ap-southeast.bytepluses.com/api/v3";

export const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

/**
 * Nearest `.env`, searching from `from` up to the filesystem root. A globally
 * installed `vs` is normally run from a film directory or anywhere inside the
 * repo, not from the directory holding the key, so a cwd-only lookup silently
 * finds nothing and the run fails on a missing key it actually has.
 */
export function findEnvFile(from: string = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

/** Load the nearest `.env` into process.env. Returns the file used, if any. */
export function loadEnv(): string | undefined {
  const envPath = findEnvFile();
  if (envPath) {
    process.loadEnvFile(envPath);
  }
  return envPath;
}

export function requireApiKey(): string {
  const key = process.env.ARK_API_KEY;
  if (!key) {
    throw new VsError("missing_credential", "ARK_API_KEY is not set", {
      hint: "add `ARK_API_KEY=...` to a .env file (see .env.example) or export it, then re-run `vs doctor`",
    });
  }
  return key;
}

export function baseUrl(): string {
  return process.env.ARK_BASE_URL ?? DEFAULT_BASE_URL;
}

/** Google Gemini key — only needed to generate stills with Nano Banana (gemini-* models). */
export function requireGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new VsError("missing_credential", "GEMINI_API_KEY is not set", {
      hint: "add `GEMINI_API_KEY=...` to a .env file (see .env.example), or set stills.json `model` to a seedream-* id to use Ark instead",
    });
  }
  return key;
}

export function geminiBaseUrl(): string {
  return process.env.GEMINI_BASE_URL ?? DEFAULT_GEMINI_BASE_URL;
}
