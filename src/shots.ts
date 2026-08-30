import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { fileReadError, VsError } from "./errors.js";
import {
  DEFAULT_VIDEO_MODEL,
  lookupModel,
  validateShotAgainstModel,
} from "./models.js";
import type { AuthoringLimits } from "./models.js";
import { isLocalPathSafe } from "./paths.js";
import { referenceCountsByType } from "./payload.js";
import { stillOutputPath } from "./stills.js";
import {
  ASPECT_RATIOS,
  DURATION_AUTO,
  DURATION_MAX,
  DURATION_MIN,
  RESOLUTIONS,
  STILL_ASPECT_RATIOS,
} from "./types.js";
import type {
  CharactersFile,
  Shot,
  ShotReference,
  ShotsFile,
  StillsFile,
} from "./types.js";

const UNSAFE_LOCAL_PATH =
  "must stay within the film directory (no `..` or absolute paths)";

/** A local reference path (image refs, still refs) is safe unless it escapes the film dir. */
function isUnsafeLocalReference(url: string): boolean {
  return !url.startsWith("https://") && !isLocalPathSafe(url);
}

const ID_PATTERN = /^[a-z0-9_-]+$/iu;
/** A still reference is an image; anything else is bytes the model cannot read. */
const STILL_REFERENCE_EXTENSION = /\.(?:png|jpe?g|webp)(?:\?.*)?$/iu;

/**
 * Every soft limit and mode rule that used to be decided here by asking "is this
 * Seedance 2.5?" now comes from the model's own registry entry. See
 * `AuthoringLimits` in src/models.ts for why the flags describe capabilities
 * rather than naming models.
 */
function authoringLimits(modelId: string | undefined): AuthoringLimits {
  return lookupModel(modelId);
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

/**
 * Ordinals a prompt binds per media type: `@Image 3`, `<Image_3>`, `@Video 1`,
 * and the bare `Video 1` that BytePlus's own reference-to-video sample prompt
 * uses. The sigil is the house style, but the model resolves either, and
 * treating the vendor's documented form as "binds nothing" warned at prompts
 * that were correct. The `\\b` stops `subimage 2` binding.
 */
const ORDINAL_PATTERN =
  /(?:@|<)?\s*\b(?<kind>image|video|audio)[\s_]*(?<index>\d+)/giu;

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
const stillRatioSchema = z.enum(STILL_ASPECT_RATIOS);
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
    // Written by `vs cast sync` to mark a reference it owns, so a re-sync
    // replaces exactly what it wrote and leaves a hand-authored reference
    // beside it alone. Never reaches a request body.
    cast: z.string().min(1).optional(),
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
    // Authored input to `vs cast sync`; `castPrompt` is what it writes back.
    cast: z.array(z.string().min(1)).optional(),
    castPrompt: z.string().min(1).optional(),
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
    const modelId = file.film.model ?? DEFAULT_VIDEO_MODEL;
    const { framesExcludeReferences, inlineAudioRefs } =
      authoringLimits(modelId);
    for (const [index, shot] of file.shots.entries()) {
      if (seenIds.has(shot.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate shot id: ${shot.id}`,
        });
      }
      const refs = shot.references ?? [];
      for (const ref of refs) {
        if (ref.type === "image" || ref.url.startsWith("https://")) {
          continue;
        }
        // Audio is the one heavy type a model may accept inline. Video never is:
        // Ark documents base64 for `image_url` and publishes nothing equivalent
        // for `video_url`, so inlining a clip meant paying for a ~27 MB upload to
        // discover that after submit.
        if (ref.type === "audio" && inlineAudioRefs) {
          continue;
        }
        const scope = ref.type === "video" ? "on every model" : `on ${modelId}`;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${shot.id}: ${ref.type} references must be https URLs ${scope} (local paths are always supported for images). Upload the clip and paste its URL.`,
        });
      }
      if (
        framesExcludeReferences &&
        refs.some((ref) => FRAME_ROLES.has(ref.role)) &&
        refs.some((ref) => !FRAME_ROLES.has(ref.role))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `shot ${shot.id}: first_frame/last_frame cannot be mixed with reference_* roles on ${modelId} — frame mode and omni-reference mode are mutually exclusive on this model. Drop one mode, or move the film to a model that combines them (Seedance 2.5 does).`,
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
    /** Set by `vs cast sync` on a sheet it generated. See `Still.cast`. */
    cast: z.string().min(1).optional(),
    id: z
      .string()
      .regex(ID_PATTERN, "still id must be alphanumeric/dash/underscore"),
    prompt: z.string().min(1),
    ratio: stillRatioSchema.optional(),
    references: z.array(z.string().min(1)).optional(),
    seed: z.number().int().optional(),
    size: z.string().optional(),
  })
  .superRefine((still, ctx) => {
    for (const [index, ref] of (still.references ?? []).entries()) {
      if (!STILL_REFERENCE_EXTENSION.test(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reference "${ref}" is not an image (use png/jpg/jpeg/webp) — it would be sent as raw bytes and generate nothing useful`,
          path: ["references", index],
        });
      }
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
    ratio: stillRatioSchema.optional(),
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

// A block is joined into `{name} is {block}; use @Image N for {binding}.`, so
// it must not carry its own terminator: "…no wasted step." would compose as
// "…no wasted step.; use @Image 1…" and, worse, would stop matching what sync
// wrote last run, which is what makes a re-sync a no-op.
const BLOCK_TERMINATOR = /[.;:,]$/u;

function sheetReferences(character: {
  sheet?: { references?: string[] };
  variants?: { sheet?: { references?: string[] } }[];
}): string[] {
  return [
    ...(character.sheet?.references ?? []),
    ...(character.variants ?? []).flatMap(
      (variant) => variant.sheet?.references ?? []
    ),
  ];
}

/**
 * The stills.json id for one character's sheet. Shared with src/cast.ts so the
 * collision check below and the upsert that writes the file cannot disagree
 * about what a character is called on disk.
 */
export function sheetStillId(key: string): string {
  return `char-${key.replace(":", "-")}`;
}

const sheetSchema = z.strictObject({
  prompt: z.string().min(1).optional(),
  ratio: stillRatioSchema.optional(),
  references: z.array(z.string().min(1)).optional(),
  seed: z.number().int().optional(),
});

const blockSchema = z
  .string()
  .min(1)
  .refine((block) => !BLOCK_TERMINATOR.test(block.trim()), {
    message:
      "block must not end in punctuation — it is joined into a longer sentence",
  });

const variantSchema = z.strictObject({
  binding: z.string().min(1).optional(),
  block: blockSchema,
  id: z
    .string()
    .regex(ID_PATTERN, "variant id must be alphanumeric/dash/underscore"),
  sheet: sheetSchema.optional(),
});

const characterSchema = z
  .strictObject({
    binding: z.string().min(1).optional(),
    block: blockSchema,
    id: z
      .string()
      .regex(ID_PATTERN, "character id must be alphanumeric/dash/underscore"),
    name: z.string().min(1),
    sheet: sheetSchema.optional(),
    variants: z.array(variantSchema).optional(),
  })
  .superRefine((character, ctx) => {
    // `binding` names the ONE job the sheet does. Without it the sentence has
    // no clause and the model averages the reference into everything it sees,
    // which is the failure the ordinal idiom exists to prevent.
    if (character.sheet && character.binding === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `character ${character.id} has a sheet but no binding — name the one job it does ("her face, hair and wardrobe only")`,
        path: ["binding"],
      });
    }
    const seen = new Set<string>();
    for (const variant of character.variants ?? []) {
      if (seen.has(variant.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate variant id: ${character.id}:${variant.id}`,
          path: ["variants"],
        });
      }
      seen.add(variant.id);
      if (
        variant.sheet &&
        (variant.binding ?? character.binding) === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `variant ${character.id}:${variant.id} has a sheet but neither it nor ${character.id} sets a binding`,
          path: ["variants"],
        });
      }
    }
    for (const ref of sheetReferences(character)) {
      if (!STILL_REFERENCE_EXTENSION.test(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sheet reference "${ref}" is not an image (use png/jpg/jpeg/webp)`,
        });
      }
      if (isUnsafeLocalReference(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sheet reference "${ref}" ${UNSAFE_LOCAL_PATH}`,
        });
      }
    }
  });

const charactersFileSchema = z
  .strictObject({
    characters: z.array(characterSchema).min(1),
    style: z.string().min(1).optional(),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const character of file.characters) {
      if (seen.has(character.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate character id: ${character.id}`,
        });
      }
      seen.add(character.id);
    }
    // `keeper` + variant `old` and a separate character `keeper-old` both derive
    // the still id `char-keeper-old`. Catch it here rather than letting one
    // sheet silently overwrite the other's png.
    const derived = new Map<string, string>();
    for (const character of file.characters) {
      for (const key of [
        character.id,
        ...(character.variants ?? []).map(
          (variant) => `${character.id}:${variant.id}`
        ),
      ]) {
        const stillId = sheetStillId(key);
        const owner = derived.get(stillId);
        if (owner !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} and ${owner} both derive the still id "${stillId}" — rename one`,
          });
        }
        derived.set(stillId, key);
      }
    }
  });

/**
 * The ordinal idiom is the cheapest thing to get wrong and the dearest to
 * discover: a mis-bound `@Image 3` spends the whole generation and reads as a
 * model failure rather than an authoring one. See `referenceOrdinals` in
 * src/payload.ts for the contract these checks enforce.
 */
function lintOrdinalBinding(
  shot: Shot,
  file: ShotsFile,
  modelId: string
): string[] {
  const warnings: string[] = [];
  const refs = shot.references ?? [];
  const { framesExcludeReferences, ordinalBindingIdiom } =
    authoringLimits(modelId);
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

  // No model gate needed: only a model that can render a clip this long can
  // reach the threshold, so the duration IS the condition.
  const duration = shot.duration ?? file.film.defaults?.duration;
  if (
    typeof duration === "number" &&
    duration >= TIMESTAMP_PLAN_SECONDS &&
    lacksTimestampPlan(shot.prompt)
  ) {
    warnings.push(
      `${shot.id}: ${duration}s with no timestamp plan — use 0-6s: / 7-13s: ranges (or [0:00-0:06]) so the turns are pinned to the clock; Shot N: alone orders the beats but leaves the model to invent the pacing between them`
    );
  }

  if (ordinalBindingIdiom && refs.length >= 2 && bound.size === 0) {
    warnings.push(
      `${shot.id}: ${refs.length} references but the prompt never binds one by ordinal — name each reference's single job ("use @Image 1 for her face, @Image 2 for the room") or the model averages them together`
    );
  }

  // Only reachable on a model that lets the two modes coexist; elsewhere the
  // schema has already refused the file.
  const frameRef = refs.find((ref) => FRAME_ROLES.has(ref.role));
  const mixedMode =
    !framesExcludeReferences &&
    frameRef &&
    refs.some((ref) => !FRAME_ROLES.has(ref.role));
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

function lintOneShot(shot: Shot, file: ShotsFile, modelId: string): string[] {
  const { promptWordLimit, softReferenceLimit } = authoringLimits(modelId);
  const warnings: string[] = [];
  const refCount = shot.references?.length ?? 0;
  if (refCount > softReferenceLimit) {
    warnings.push(
      `${shot.id}: ${refCount} references — quality degrades above ~${softReferenceLimit} for this model; trim to the essentials`
    );
  }
  if (shot.seed === undefined) {
    warnings.push(
      `${shot.id}: no seed — set one so a draft and its final (and any retake) stay reproducible instead of re-rolling a new composition each run`
    );
  }
  // Every segment `composePrompt` will send, not just the authored one. A cast
  // block is real prompt text on the wire, and five characters run 150-250
  // words — the difference between passing and busting 2.0's budget.
  const words = wordCount(
    [file.film.promptPreamble, shot.castPrompt, shot.prompt]
      .filter(Boolean)
      .join(" ")
  );
  if (words > promptWordLimit) {
    warnings.push(
      `${shot.id}: prompt is ${words} words (incl. promptPreamble and castPrompt) — even a multi-beat shot degrades past ~${promptWordLimit}; move shared style into film.promptPreamble, trim to the timed beats, or split the shot`
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
/**
 * Local shot references that are not on disk.
 *
 * Fatal rather than merely lossy: `resolveReferenceUrl` reads the file to inline
 * it, so a missing plate is an ENOENT at submit. It has to be a PRE-FLIGHT check
 * because of where that lands. Shots submit one at a time, and on Seedance 2.5
 * concurrency is 1 whatever `--concurrency` says, so a six-act film with a
 * missing plate in act 2 bills act 1 in full before it discovers the problem.
 * `--dry-run` was silent here because dry-run skips the inline read that fails.
 */
function missingReferences(
  file: ShotsFile,
  shotsDir: string | undefined
): string[] {
  if (shotsDir === undefined) {
    return [];
  }
  const warnings: string[] = [];
  for (const shot of file.shots) {
    for (const ref of shot.references ?? []) {
      if (
        !ref.url.startsWith("https://") &&
        !existsSync(resolve(shotsDir, ref.url))
      ) {
        warnings.push(
          `${shot.id}: reference "${ref.url}" is not on disk — this shot cannot be submitted, and on a serial model the shots before it are billed before the run reaches it`
        );
      }
    }
  }
  return warnings;
}

/** Pass `shotsDir` to also check that local references resolve on disk. */
export function lintShotsFile(
  file: ShotsFile,
  options: { shotsDir?: string } = {}
): string[] {
  const modelId = file.film.model ?? DEFAULT_VIDEO_MODEL;
  return [
    ...file.shots.flatMap((shot) => lintOneShot(shot, file, modelId)),
    ...lintDraftModelEnvelope(file),
    ...missingReferences(file, options.shotsDir),
  ];
}

/**
 * The stills counterpart of `lintShotsFile`. A `stills.json` parses to a
 * `StillsFile` with no `shots`, so the shot lint cannot run over it, and the
 * failure modes differ anyway: a still is a keyframe you will want to
 * regenerate identically later, and Nano Banana ignores Seedream's pixel
 * `size` outright.
 *
 * There is deliberately NO prompt-length warning here. The 200-word cap that
 * used to live here was fitted to `films/lighthouse` (whose longest still
 * prompt is 125 words) rather than to a model: Nano Banana Pro takes 131,072
 * input tokens, so a 400-word prompt is a fraction of a percent of its budget,
 * and `skills/nano-banana-2` explicitly prefers a narrative paragraph to a
 * terse one. It also told you to move the shared look into
 * `film.promptPreamble`, which a stills file does not have. It fired on every
 * keyframe of a real film, all of which had produced approved images.
 *
 * Pass `stillsDir` to also check that local references resolve on disk (a
 * reference that is not there produces a still with none of the likeness you
 * asked for, and no error). Pass `outputDir` too when the caller is about to
 * generate: a stills file legitimately chains one still off another's png, and
 * warning that a file this very run is going to write does not exist yet turns
 * a correct film into a screenful of noise on every first run.
 */
export function lintStillsFile(
  file: StillsFile,
  options: { outputDir?: string; stillsDir?: string } = {}
): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const { outputDir, stillsDir } = options;
  // The pngs this run will write, so a reference to one is not "missing".
  const producedHere = new Set(
    outputDir === undefined
      ? []
      : file.stills.map((still) => stillOutputPath(outputDir, still.id))
  );
  for (const still of file.stills) {
    // Unreachable via loadStillsFile (the schema rejects duplicates); reachable
    // for a StillsFile a caller built in memory.
    if (seen.has(still.id)) {
      warnings.push(
        `${still.id}: duplicate still id — the later one overwrites the earlier one's png`
      );
    }
    seen.add(still.id);
    if (still.size !== undefined) {
      warnings.push(
        `${still.id}: size "${still.size}" is ignored — Nano Banana takes an aspect ratio, not pixels; set \`ratio\` instead`
      );
    }
    if (stillsDir === undefined) {
      continue;
    }
    for (const ref of still.references ?? []) {
      if (ref.startsWith("https://")) {
        continue;
      }
      const resolved = resolve(stillsDir, ref);
      if (existsSync(resolved) || producedHere.has(resolved)) {
        continue;
      }
      warnings.push(
        `${still.id}: reference "${ref}" is not on disk — the still will generate without it, silently losing that likeness or style`
      );
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

/**
 * The raw `JSON.parse` result, for the one caller that has to WRITE the file
 * back: `vs cast sync`.
 *
 * Zod builds its output by walking the schema shape, not the input, so
 * `parsed.data` comes back with every key in schema order. Serialising that
 * would silently reorder every shot in a film the first time you synced it —
 * a several-hundred-line diff on a file whose whole contract is that what you
 * typed is what gets sent. Sync mutates this object and validates the parsed
 * one.
 */
export function loadRawFilmJson(path: string): Promise<unknown> {
  return loadJson(path);
}

/** Validate an already-parsed shots.json. `label` names the file in errors. */
export function parseShotsFile(value: unknown, label: string): ShotsFile {
  const parsed = shotsFileSchema.safeParse(value);
  if (!parsed.success) {
    throw formatIssues(label, parsed.error);
  }
  return parsed.data;
}

/** Validate an already-parsed stills.json. `label` names the file in errors. */
export function parseStillsFile(value: unknown, label: string): StillsFile {
  const parsed = stillsFileSchema.safeParse(value);
  if (!parsed.success) {
    throw formatIssues(label, parsed.error);
  }
  return parsed.data;
}

export async function loadShotsFile(path: string): Promise<ShotsFile> {
  return parseShotsFile(await loadJson(path), path);
}

export async function loadStillsFile(path: string): Promise<StillsFile> {
  return parseStillsFile(await loadJson(path), path);
}

export async function loadCharactersFile(
  path: string
): Promise<CharactersFile> {
  const parsed = charactersFileSchema.safeParse(await loadJson(path));
  if (!parsed.success) {
    throw formatIssues(path, parsed.error);
  }
  return parsed.data;
}
