import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { fileReadError, VsError } from "./errors.js";
import { isGeminiModel } from "./gemini.js";
import { lookupModel, MODEL_IDS, validateShotAgainstModel } from "./models.js";
import { isLocalPathSafe } from "./paths.js";
import { referenceCountsByType } from "./payload.js";
import {
  ASPECT_RATIOS,
  DURATION_AUTO,
  DURATION_MAX,
  DURATION_MIN,
  RESOLUTIONS,
} from "./types.js";
import type { Shot, ShotReference, ShotsFile, StillsFile } from "./types.js";

const UNSAFE_LOCAL_PATH =
  "must stay within the film directory (no `..` or absolute paths)";

/** A local reference path (image refs, still refs) is safe unless it escapes the film dir. */
function isUnsafeLocalReference(url: string): boolean {
  return !url.startsWith("https://") && !isLocalPathSafe(url);
}

const ID_PATTERN = /^[a-z0-9_-]+$/iu;

/** Soft quality warn for Seedance 2.0-era models (platform allows more). */
const MAX_REFERENCES_DEFAULT = 5;
/**
 * Soft quality warn for 2.5. An 8-14 reference ordinal pack is the design
 * idiom, so 12 warned on healthy work; 16 leaves headroom and is still barely
 * half the 30-image product ceiling. The ceiling is not a target.
 */
const MAX_REFERENCES_SEEDANCE_25 = 16;

function isSeedance25(modelId: string | undefined): boolean {
  return lookupModel(modelId).family.startsWith("seedance-2-5");
}

function softReferenceLimit(modelId: string | undefined): number {
  return isSeedance25(modelId)
    ? MAX_REFERENCES_SEEDANCE_25
    : MAX_REFERENCES_DEFAULT;
}
// Multi-beat timed-segment shots (several [0:00-0:0N] beats in one generation)
// legitimately need more words than a single-action shot; warn only past ~400 so
// real bloat (overstacked, model-diluting prompts) is still flagged.
const MAX_PROMPT_WORDS = 400;
/**
 * A 30s Seedance 2.5 act carries roughly twice the beats of a 15s shot AND an
 * ordinal binding block naming each reference's single job, so 400 words warns
 * on healthy work. Measured acts land at 380-430 plus preamble; 700 still
 * catches real bloat. Do NOT compress ordinal bindings to fit a cap.
 */
const MAX_PROMPT_WORDS_SEEDANCE_25 = 700;

function promptWordLimit(modelId: string | undefined): number {
  return isSeedance25(modelId)
    ? MAX_PROMPT_WORDS_SEEDANCE_25
    : MAX_PROMPT_WORDS;
}
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
/**
 * Past this, `Shot N:` is not enough on 2.5: it orders the beats but says
 * nothing about rhythm, so the model invents the pacing between them and the
 * gaps stretch. A timestamp plan pins the turns to the clock.
 */
const TIMESTAMP_PLAN_SECONDS = 20;

function lacksTimestampPlan(prompt: string): boolean {
  return !(
    HAS_TIMESTAMP_RANGE.test(prompt) || HAS_TIMECODE_BRACKET.test(prompt)
  );
}

/** Ordinals a prompt binds per media type: `@Image 3`, `<Image_3>`, `@Video 1`. */
const ORDINAL_PATTERN =
  /(?:@|<)\s*(?<kind>image|video|audio)[\s_]*(?<index>\d+)/giu;

function boundOrdinals(prompt: string): Map<ShotReference["type"], number> {
  const highest = new Map<ShotReference["type"], number>();
  for (const match of prompt.matchAll(ORDINAL_PATTERN)) {
    // ORDINAL_PATTERN only matches these three, so the narrowing is sound.
    const kind = (
      match.groups?.kind ?? ""
    ).toLowerCase() as ShotReference["type"];
    const n = Number(match.groups?.index);
    if (Number.isFinite(n) && n > (highest.get(kind) ?? 0)) {
      highest.set(kind, n);
    }
  }
  return highest;
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
    // Whether a LOCAL video/audio path is allowed at all is model-dependent
    // (2.5 only), so that lives in the file schema where `film.model` is
    // visible. Path containment is not model-dependent and belongs here.
    if (isUnsafeLocalReference(ref.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${ref.type} reference "${ref.url}" ${UNSAFE_LOCAL_PATH}`,
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
    for (const role of ["first_frame", "last_frame"] as const) {
      if (refs.filter((ref) => ref.role === role).length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `at most one ${role} reference per shot`,
        });
      }
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
    // Two rules below depend on the model, which only this schema can see.
    // Seedance 2.5 combines frame and reference modes (its own R2V demos bind a
    // scene reference alongside per-subject ones) and accepts local video and
    // audio paths. Seedance 2.0 does neither.
    const is25 = isSeedance25(file.film.model ?? MODEL_IDS.seedance20);
    for (const [index, shot] of file.shots.entries()) {
      if (seenIds.has(shot.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate shot id: ${shot.id}`,
        });
      }
      const refs = shot.references ?? [];
      for (const ref of refs) {
        if (ref.type !== "image" && !ref.url.startsWith("https://") && !is25) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `shot ${shot.id}: ${ref.type} references must be https URLs on this model (local paths are supported for images, and for video/audio on Seedance 2.5). Upload the clip and paste its URL.`,
          });
        }
      }
      if (
        !is25 &&
        refs.some((ref) => FRAME_ROLES.has(ref.role)) &&
        refs.some((ref) => !FRAME_ROLES.has(ref.role))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${shot.id}: first_frame/last_frame cannot be mixed with reference_* roles on this model. Seedance 2.0's frame mode and omni-reference mode are mutually exclusive; Seedance 2.5 allows both.`,
          path: ["shots", index, "references"],
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

/**
 * The 2.5 ordinal idiom is the cheapest thing to get wrong and the dearest to
 * discover: a mis-bound `@Image 3` spends the whole 30s generation and reads as
 * a model failure rather than an authoring one. See `referenceOrdinals` in
 * src/payload.ts for the contract these checks enforce.
 */
function lintOrdinalBinding(
  shot: Shot,
  file: ShotsFile,
  modelId: string
): string[] {
  const warnings: string[] = [];
  const refs = shot.references ?? [];
  const is25 = isSeedance25(modelId);
  const counts = referenceCountsByType(refs);
  const bound = boundOrdinals(shot.prompt);

  for (const [kind, highest] of bound) {
    const available = counts[kind];
    if (highest > available) {
      warnings.push(
        `${shot.id}: prompt binds ${kind} ordinal ${highest} but the shot carries only ${available} ${kind} reference(s) — ordinals count per media type in authored order, so the binding points at nothing`
      );
    }
  }

  const duration = shot.duration ?? file.film.defaults?.duration;
  if (
    is25 &&
    typeof duration === "number" &&
    duration >= TIMESTAMP_PLAN_SECONDS &&
    lacksTimestampPlan(shot.prompt)
  ) {
    warnings.push(
      `${shot.id}: ${duration}s on Seedance 2.5 with no timestamp plan — use 0-6s: / 7-13s: ranges (or [0:00-0:06]) so the turns are pinned to the clock; Shot N: alone orders the beats but leaves the model to invent the pacing between them`
    );
  }

  if (is25 && refs.length >= 2 && bound.size === 0) {
    warnings.push(
      `${shot.id}: ${refs.length} references but the prompt never binds one by ordinal — name each reference's single job ("use @Image 1 for her face, @Image 2 for the room") or the model averages them together`
    );
  }

  const frameRef = refs.find((ref) => FRAME_ROLES.has(ref.role));
  const mixedMode =
    is25 && frameRef && refs.some((ref) => !FRAME_ROLES.has(ref.role));
  if (mixedMode && refs[0] !== frameRef) {
    warnings.push(
      `${shot.id}: the ${frameRef.role} is not the first reference — a frame role is an image on the wire and consumes an image ordinal, so put it first and start the packs at @Image 2, or the ordinals shift under you`
    );
  }
  return warnings;
}

/**
 * `vs generate --draft` validates against `film.draftModel`, not `film.model`,
 * so a 30s Seedance 2.5 film with a 2.0-fast draft model is REFUSED at generate
 * (2.0-fast is documented at 4-15s, and a documented mismatch is a hard error).
 * That trap is invisible until you spend the run, so surface it at --dry-run.
 */
function lintDraftModelEnvelope(file: ShotsFile): string[] {
  const { draftModel } = file.film;
  if (draftModel === undefined) {
    return [];
  }
  const offenders = new Set<string>();
  for (const shot of file.shots) {
    const problems = validateShotAgainstModel(draftModel, {
      duration: shot.duration ?? file.film.defaults?.duration,
    });
    for (const problem of problems) {
      if (problem.severity === "error") {
        offenders.add(`${shot.id} (${problem.message})`);
      }
    }
  }
  if (offenders.size === 0) {
    return [];
  }
  return [
    `film.draftModel "${draftModel}" cannot render every shot, so \`vs generate --draft\` will refuse this film: ${[...offenders].join("; ")}. Unset film.draftModel to draft on the film's own model at 480p.`,
  ];
}

function lintOneShot(
  shot: Shot,
  file: ShotsFile,
  modelId: string,
  maxRefs: number
): string[] {
  const warnings: string[] = [];
  const refCount = shot.references?.length ?? 0;
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
  const wordLimit = promptWordLimit(modelId);
  if (words > wordLimit) {
    warnings.push(
      `${shot.id}: prompt is ${words} words (incl. promptPreamble) — even a multi-beat shot degrades past ~${wordLimit}; move shared style into film.promptPreamble, trim to the timed beats, or split the shot`
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
  if (shot.cameraFixed && hasImageRef) {
    warnings.push(
      `${shot.id}: cameraFixed with an image reference — Seedance rejects camera_fixed in image-to-video (first_frame/reference) mode; drop it and lock the camera in the prompt instead`
    );
  }
  if (!hasImageRef) {
    warnings.push(
      `${shot.id}: no image reference — anchor the shot to a literal keyframe (first_frame or reference_image); video generates tighter, cheaper, and less glitchy with an image to follow`
    );
  }
  warnings.push(...lintOrdinalBinding(shot, file, modelId));
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
  const modelId = file.film.model ?? MODEL_IDS.seedance20;
  const maxRefs = softReferenceLimit(modelId);
  return [
    ...file.shots.flatMap((shot) => lintOneShot(shot, file, modelId, maxRefs)),
    ...lintDraftModelEnvelope(file),
  ];
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

/**
 * Not being able to read the film file is the first error most new users hit,
 * so it names the path and the way out rather than stating a fact and stopping.
 * Shared with the commands that only stat the file (`vs status`), so a typo
 * reads the same however you arrived at it.
 */
export function filmFileNotFound(path: string, cause?: unknown): VsError {
  return new VsError("file_not_found", `cannot read ${path}`, {
    cause,
    hint: `check the path (it is relative to your current directory), or scaffold a new film with \`vs init ${dirname(path)}\``,
  });
}

async function loadJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    // Only a genuinely missing file is `file_not_found`. Reporting EACCES on a
    // root-owned film, or EISDIR on a path that named a directory, as "cannot
    // read X; scaffold a new film with `vs init`" sends the reader to fix the
    // one thing that was never wrong.
    throw fileReadError(path, error, () => filmFileNotFound(path, error));
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
