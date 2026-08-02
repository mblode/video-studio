import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { VsError } from "./errors.js";
import { isGeminiModel } from "./gemini.js";
import { lookupModel, MODEL_IDS } from "./models.js";
import { isLocalPathSafe } from "./paths.js";
import {
  ASPECT_RATIOS,
  DURATION_AUTO,
  DURATION_MAX,
  DURATION_MIN,
  RESOLUTIONS,
} from "./types.js";
import type { Shot, ShotsFile, StillsFile } from "./types.js";

const UNSAFE_LOCAL_PATH =
  "must stay within the film directory (no `..` or absolute paths)";

/** A local reference path (image refs, still refs) is safe unless it escapes the film dir. */
function isUnsafeLocalReference(url: string): boolean {
  return !url.startsWith("https://") && !isLocalPathSafe(url);
}

const ID_PATTERN = /^[a-z0-9_-]+$/iu;

/** Soft quality warn for Seedance 2.0-era models (platform allows more). */
const MAX_REFERENCES_DEFAULT = 5;
/** Soft quality warn for 2.5: still well below the 30/10/10 ceiling. */
const MAX_REFERENCES_SEEDANCE_25 = 12;

function softReferenceLimit(modelId: string | undefined): number {
  const { family } = lookupModel(modelId);
  return family.startsWith("seedance-2-5")
    ? MAX_REFERENCES_SEEDANCE_25
    : MAX_REFERENCES_DEFAULT;
}
const MAX_CHAIN_DEPTH = 3;
// Multi-beat timed-segment shots (several [0:00-0:0N] beats in one generation)
// legitimately need more words than a single-action shot; warn only past ~400 so
// real bloat (overstacked, model-diluting prompts) is still flagged.
const MAX_PROMPT_WORDS = 400;
/** Longer clips without a beat carrier tend to stretch one verb into slow-mo. */
const LONG_SHOT_BEAT_SECONDS = 12;
const HAS_SHOT_BEAT = /Shot\s+\d+\s*:/iu;
const HAS_TIMESTAMP_RANGE = /\d+\s*[–-]\s*\d+\s*s\b/iu;
const HAS_TIMECODE_BRACKET = /\[\d+:\d+/u;

function lacksBeatCarrier(prompt: string): boolean {
  return (
    !HAS_SHOT_BEAT.test(prompt) &&
    !HAS_TIMESTAMP_RANGE.test(prompt) &&
    !HAS_TIMECODE_BRACKET.test(prompt)
  );
}

function longShotMissingBeats(
  shotId: string,
  duration: number | undefined,
  prompt: string
): string | undefined {
  if (
    typeof duration !== "number" ||
    duration < LONG_SHOT_BEAT_SECONDS ||
    duration === -1 ||
    !lacksBeatCarrier(prompt)
  ) {
    return;
  }
  return `${shotId}: ${duration}s prompt has no beat carrier — add a timestamp plan or Shot N: lines so Seedance does not stretch one action; beat count follows the story`;
}
// A still is one composition, not a timed sequence, so its budget is far
// tighter: past this the image models start averaging the description away.
const MAX_STILL_PROMPT_WORDS = 200;

// Seedance renders "languid" vocabulary literally as slow-motion. A cluster of
// these terms in one prompt drags the whole shot; warn past two so a single
// "gently" is fine but a soft-motion pile-up gets flagged toward brisk verbs.
const SLOW_MOTION_TERMS = [
  "slowly",
  "gently",
  "gentle",
  "tenderly",
  "tender",
  "drifts",
  "drift ",
  " holds ",
  " holding ",
  "creep",
  "languid",
  "slow-motion",
];
const MAX_SLOW_TERMS = 2;

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

/** Count total occurrences of slow/soft motion terms in a prompt (case-insensitive). */
function slowMotionTermCount(text: string): number {
  const lower = text.toLowerCase();
  let total = 0;
  for (const term of SLOW_MOTION_TERMS) {
    let from = 0;
    let index = lower.indexOf(term, from);
    while (index !== -1) {
      total += 1;
      from = index + term.length;
      index = lower.indexOf(term, from);
    }
  }
  return total;
}

const FRAME_ROLES = new Set(["first_frame", "last_frame"]);

const ratioSchema = z.enum(ASPECT_RATIOS);
const resolutionSchema = z.enum(RESOLUTIONS);

const durationSchema = z.union([
  z.literal(DURATION_AUTO),
  z.number().int().min(DURATION_MIN).max(DURATION_MAX),
]);

// Every object here is STRICT. A misspelled key (`cameraFixxed`,
// `promptPremble`) used to parse fine and do nothing, so the user got a shot
// with no locked camera and no explanation; naming the key at load time is the
// difference between a typo and an afternoon.
const referenceSchema = z
  .strictObject({
    role: z.enum([
      "reference_image",
      "reference_video",
      "reference_audio",
      "first_frame",
      "last_frame",
    ]),
    type: z.enum(["image", "video", "audio"]),
    url: z.string().min(1),
  })
  .superRefine((ref, ctx) => {
    if (ref.type !== "image" && !ref.url.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${ref.type} references must be https URLs in v1 (local paths are supported for images only)`,
      });
    }
    if (ref.type === "image" && isUnsafeLocalReference(ref.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `image reference "${ref.url}" ${UNSAFE_LOCAL_PATH}`,
      });
    }
    if (FRAME_ROLES.has(ref.role) && ref.type !== "image") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${ref.role} references must be images`,
      });
    }
  });

const shotSchema = z
  .strictObject({
    cameraFixed: z.boolean().optional(),
    continueFrom: z.string().optional(),
    duration: durationSchema.optional(),
    id: z
      .string()
      .regex(ID_PATTERN, "shot id must be alphanumeric/dash/underscore"),
    output: z.string().optional(),
    prompt: z.string().min(1),
    ratio: ratioSchema.optional(),
    references: z.array(referenceSchema).optional(),
    resolution: resolutionSchema.optional(),
    seed: z.number().int().optional(),
    transition: z.number().min(0.05).max(2).optional(),
  })
  .superRefine((shot, ctx) => {
    const refs = shot.references ?? [];
    const frameRefs = refs.filter((ref) => FRAME_ROLES.has(ref.role));
    const referenceRefs = refs.filter((ref) => !FRAME_ROLES.has(ref.role));
    const hasImplicitFirstFrame = shot.continueFrom !== undefined;
    const firstFrames =
      refs.filter((ref) => ref.role === "first_frame").length +
      (hasImplicitFirstFrame ? 1 : 0);

    if (firstFrames > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: hasImplicitFirstFrame
          ? "continueFrom already supplies the first_frame — remove the explicit first_frame reference"
          : "at most one first_frame reference per shot",
      });
    }
    if (refs.filter((ref) => ref.role === "last_frame").length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at most one last_frame reference per shot",
      });
    }
    if (
      (frameRefs.length > 0 || hasImplicitFirstFrame) &&
      referenceRefs.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "first_frame/last_frame (including continueFrom) cannot be mixed with reference_* roles in one shot — Seedance's frame mode and omni-reference mode are mutually exclusive",
      });
    }
    if (shot.continueFrom === shot.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `shot ${shot.id} cannot continue from itself`,
      });
    }
    if (shot.output !== undefined && !isLocalPathSafe(shot.output)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `output "${shot.output}" ${UNSAFE_LOCAL_PATH}`,
      });
    }
  });

const cardSchema = z.strictObject({
  after: z.string().min(1),
  duration: z.number().positive().optional(),
  fontSize: z.number().positive().optional(),
  text: z.string().min(1),
  transition: z.number().min(0.05).max(2).optional(),
});

const shotsFileSchema = z
  .strictObject({
    cards: z.array(cardSchema).optional(),
    film: z.strictObject({
      defaults: z
        .strictObject({
          cameraFixed: z.boolean().optional(),
          duration: durationSchema.optional(),
          generateAudio: z.boolean().optional(),
          ratio: ratioSchema.optional(),
          resolution: resolutionSchema.optional(),
          watermark: z.boolean().optional(),
        })
        .optional(),
      draftModel: z.string().optional(),
      model: z.string().optional(),
      outputDir: z.string().optional(),
      promptPreamble: z.string().optional(),
      title: z.string().min(1),
    }),
    shots: z.array(shotSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seenIds = new Set<string>();
    for (const shot of file.shots) {
      if (seenIds.has(shot.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate shot id: ${shot.id}`,
        });
      }
      if (shot.continueFrom !== undefined && !seenIds.has(shot.continueFrom)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${shot.id} continueFrom "${shot.continueFrom}" must name an EARLIER shot in the file`,
        });
      }
      seenIds.add(shot.id);
    }
    for (const card of file.cards ?? []) {
      if (
        card.after !== "start" &&
        card.after !== "end" &&
        !seenIds.has(card.after)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `card "${card.text}" after "${card.after}" — must be "start", "end", or an existing shot id`,
        });
      }
    }
  });

const stillSchema = z
  .strictObject({
    id: z
      .string()
      .regex(ID_PATTERN, "still id must be alphanumeric/dash/underscore"),
    prompt: z.string().min(1),
    ratio: ratioSchema.optional(),
    references: z.array(z.string().min(1)).optional(),
    seed: z.number().int().optional(),
    size: z.string().optional(),
  })
  .superRefine((still, ctx) => {
    for (const [index, ref] of (still.references ?? []).entries()) {
      if (isUnsafeLocalReference(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reference "${ref}" ${UNSAFE_LOCAL_PATH}`,
          path: ["references", index],
        });
      }
    }
  });

const stillsFileSchema = z
  .strictObject({
    model: z.string().optional(),
    outputDir: z.string().optional(),
    ratio: ratioSchema.optional(),
    stills: z.array(stillSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const still of file.stills) {
      if (seen.has(still.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate still id: ${still.id}`,
        });
      }
      seen.add(still.id);
    }
  });

function chainDepth(shot: Shot, byId: Map<string, Shot>): number {
  let depth = 0;
  let current: Shot | undefined = shot;
  while (current?.continueFrom !== undefined && depth <= MAX_CHAIN_DEPTH + 1) {
    depth += 1;
    current = byId.get(current.continueFrom);
  }
  return depth;
}

function lintOneShot(
  shot: Shot,
  file: ShotsFile,
  byId: Map<string, Shot>,
  maxRefs: number
): string[] {
  const warnings: string[] = [];
  const refCount =
    (shot.references?.length ?? 0) + (shot.continueFrom === undefined ? 0 : 1);
  if (refCount > maxRefs) {
    warnings.push(
      `${shot.id}: ${refCount} references — quality degrades above ~${maxRefs} for this model; trim to the essentials`
    );
  }
  if (shot.seed === undefined) {
    warnings.push(
      `${shot.id}: no seed — set one so a draft and its final (and any retake) stay reproducible instead of re-rolling a new composition each run`
    );
  }
  const preamble = file.film.promptPreamble;
  const words = wordCount(
    preamble ? `${preamble} ${shot.prompt}` : shot.prompt
  );
  if (words > MAX_PROMPT_WORDS) {
    warnings.push(
      `${shot.id}: prompt is ${words} words (incl. promptPreamble) — even a multi-beat shot degrades past ~${MAX_PROMPT_WORDS}; move shared style into film.promptPreamble, trim to the timed beats, or split the shot`
    );
  }
  const slowTerms = slowMotionTermCount(shot.prompt);
  if (slowTerms > MAX_SLOW_TERMS) {
    warnings.push(
      `${shot.id}: ${slowTerms} slow/soft motion terms — Seedance renders these as slow-motion; use realtime, brisk, energetic motion verbs instead`
    );
  }
  const beatWarn = longShotMissingBeats(
    shot.id,
    shot.duration ?? file.film.defaults?.duration,
    shot.prompt
  );
  if (beatWarn) {
    warnings.push(beatWarn);
  }
  const hasImageRef = (shot.references ?? []).some(
    (ref) => ref.type === "image"
  );
  if (shot.cameraFixed && (hasImageRef || shot.continueFrom !== undefined)) {
    warnings.push(
      `${shot.id}: cameraFixed with an image reference — Seedance rejects camera_fixed in image-to-video (first_frame/reference) mode; drop it and lock the camera in the prompt instead`
    );
  }
  if (shot.continueFrom !== undefined) {
    warnings.push(
      `${shot.id}: continueFrom chains onto ${shot.continueFrom}'s last frame — prefer a literal keyframe (first_frame); chaining serializes generation and cascades retakes when an upstream shot changes`
    );
  } else if (!hasImageRef) {
    warnings.push(
      `${shot.id}: no image reference — anchor the shot to a literal keyframe (first_frame or reference_image); video generates tighter, cheaper, and less glitchy with an image to follow`
    );
  }
  const depth = chainDepth(shot, byId);
  if (depth > MAX_CHAIN_DEPTH) {
    warnings.push(
      `${shot.id}: chain depth ${depth} — re-anchor from reference stills every ${MAX_CHAIN_DEPTH} shots to stop drift accumulating`
    );
  }
  return warnings;
}

/**
 * Non-fatal best-practice checks, printed as warnings by `vs generate`:
 * Seedance degrades with >5 references; every shot should be anchored to a
 * literal keyframe (an image generates tighter and glitches less); chaining
 * serializes generation and cascades retakes, and deeper than 3 accumulates
 * drift — prefer a literal keyframe per shot.
 */
export function lintShotsFile(file: ShotsFile): string[] {
  const byId = new Map(file.shots.map((shot) => [shot.id, shot]));
  const maxRefs = softReferenceLimit(file.film.model ?? MODEL_IDS.seedance20);
  return file.shots.flatMap((shot) => lintOneShot(shot, file, byId, maxRefs));
}

/**
 * The stills counterpart of `lintShotsFile`. A `stills.json` parses to a
 * `StillsFile` with no `shots`, so the shot lint cannot run over it, and the
 * failure modes differ anyway: a still is a keyframe you will want to
 * regenerate identically later, and Nano Banana ignores Seedream's pixel
 * `size` outright.
 *
 * Pass `stillsDir` to also check that local references resolve on disk (a
 * reference that is not there produces a still with none of the likeness you
 * asked for, and no error).
 */
export function lintStillsFile(
  file: StillsFile,
  options: { stillsDir?: string } = {}
): string[] {
  const warnings: string[] = [];
  const gemini = isGeminiModel(file.model ?? "");
  const seen = new Set<string>();
  for (const still of file.stills) {
    // Unreachable via loadStillsFile (the schema rejects duplicates); reachable
    // for a StillsFile a caller built in memory.
    if (seen.has(still.id)) {
      warnings.push(
        `${still.id}: duplicate still id — the later one overwrites the earlier one's png`
      );
    }
    seen.add(still.id);
    if (still.seed === undefined) {
      warnings.push(
        `${still.id}: no seed — set one so a re-run reproduces this keyframe instead of rolling a new face and composition`
      );
    }
    const words = wordCount(still.prompt);
    if (words > MAX_STILL_PROMPT_WORDS) {
      warnings.push(
        `${still.id}: prompt is ${words} words — an image prompt dilutes past ~${MAX_STILL_PROMPT_WORDS}; describe one composition and move the shared look into the shots file's film.promptPreamble`
      );
    }
    if (gemini && still.size !== undefined) {
      warnings.push(
        `${still.id}: size "${still.size}" is ignored by ${file.model} — Nano Banana takes an aspect ratio, not pixels; set \`ratio\` instead`
      );
    }
    const { stillsDir } = options;
    if (stillsDir === undefined) {
      continue;
    }
    for (const ref of still.references ?? []) {
      if (!ref.startsWith("https://") && !existsSync(resolve(stillsDir, ref))) {
        warnings.push(
          `${still.id}: reference "${ref}" is not on disk — the still will generate without it, silently losing that likeness or style`
        );
      }
    }
  }
  return warnings;
}

// Not being able to read the film file is the first error most new users hit,
// so both failures here name the path and the way out rather than stating a
// fact and stopping.
async function loadJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    throw new VsError("file_not_found", `cannot read ${path}`, {
      cause: error,
      hint: `check the path (it is relative to your current directory), or scaffold a new film with \`vs init ${dirname(path)}\``,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new VsError("invalid_input", `${path} is not valid JSON`, {
      cause: error,
      hint: "a trailing comma or an unquoted key is the usual cause; most editors will point at the line, or run `npx jsonlint` over the file",
    });
  }
}

function formatIssues(path: string, error: z.ZodError): VsError {
  const details = error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  // Unrecognised keys only reach here because every object is strict, so say
  // what that means: the key is not ignored, it is a typo or does not exist.
  const typo = error.issues.some((issue) => issue.code === "unrecognized_keys");
  return new VsError("invalid_input", `invalid ${path}:\n${details}`, {
    hint: typo
      ? "that key is not part of the schema: check its spelling against an existing film, or against `vs init`'s scaffold"
      : "fix the fields listed above; `vs init <dir>` scaffolds a file with every supported key filled in",
  });
}

export async function loadShotsFile(path: string): Promise<ShotsFile> {
  const parsed = shotsFileSchema.safeParse(await loadJson(path));
  if (!parsed.success) {
    throw formatIssues(path, parsed.error);
  }
  return parsed.data;
}

export async function loadStillsFile(path: string): Promise<StillsFile> {
  const parsed = stillsFileSchema.safeParse(await loadJson(path));
  if (!parsed.success) {
    throw formatIssues(path, parsed.error);
  }
  return parsed.data;
}
