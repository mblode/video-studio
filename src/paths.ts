import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { VsError } from "./errors.js";

/**
 * A generation pass. "final" keeps the original paths (tasks.json, output/,
 * frames/, review/); "draft" namespaces them with a `-draft` suffix so a cheap
 * 480p draft run sits side-by-side with the approved final and never clobbers
 * it.
 */
export type Pass = "draft" | "final";

/** Path suffix for a pass: "" for final, "-draft" for draft. */
export function passSuffix(pass: Pass): "" | "-draft" {
  return pass === "draft" ? "-draft" : "";
}

function escapes(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * Resolve `untrusted` under `baseDir`, throwing if the result escapes that
 * directory (via `../`, an absolute path, etc). Use for any filesystem path
 * that originates from a shots/stills file rather than from the operator.
 */
export function safeJoin(baseDir: string, untrusted: string): string {
  const full = resolve(baseDir, untrusted);
  if (escapes(relative(baseDir, full))) {
    throw new VsError(
      "path_escape",
      `path "${untrusted}" escapes its film directory`,
      {
        hint: `write it relative to ${baseDir} (e.g. "./stills/key.png") and copy the file into the film directory; absolute paths and ../ are rejected so a film stays self-contained`,
      }
    );
  }
  return full;
}

/**
 * True when `input` is a relative path that stays within its base directory
 * (no `..` traversal, not absolute). Used by the zod schemas to reject unsafe
 * local paths at validation time.
 */
export function isLocalPathSafe(input: string): boolean {
  if (isAbsolute(input)) {
    return false;
  }
  return !escapes(normalize(input));
}
