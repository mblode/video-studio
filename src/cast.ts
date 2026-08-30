import { VsError } from "./errors.js";
import { DEFAULT_VIDEO_MODEL, lookupModel } from "./models.js";
import { referenceOrdinals } from "./payload.js";
import { sheetStillId } from "./shots.js";
import type {
  Character,
  CharactersFile,
  CharacterSheet,
  Shot,
  ShotReference,
  ShotsFile,
  Still,
  StillsFile,
} from "./types.js";

const FRAME_ROLES = new Set(["first_frame", "last_frame"]);

/**
 * The composition line every sheet shares.
 *
 * The no-text clause is not politeness. A sheet is bound into a shot as a
 * reference image, and Seedance renders lettering it finds in a reference
 * straight into the video — which is why the labelled, print-ready sheet that
 * image tools produce is a review artefact and cannot be the thing we generate.
 */
const SHEET_COMPOSITION =
  "Full-body character sheet on a plain seamless neutral background: front view, three-quarter view and profile view of the same person, standing neutral with arms at sides, consistent scale, identical lighting and identical wardrobe across all three views. No text, no labels, no numbering, no logos, no watermarks.";

/** Three panels side by side need a wide frame. */
const SHEET_RATIO = "16:9" as const;

/** One addressable likeness: a character, or one of its variants. */
interface CastMember {
  /** `id`, or `id:variant`. */
  key: string;
  name: string;
  block: string;
  binding?: string;
  sheet?: CharacterSheet;
}

function membersOf(file: CharactersFile): Map<string, CastMember> {
  const members = new Map<string, CastMember>();
  for (const character of file.characters) {
    members.set(character.id, {
      binding: character.binding,
      block: character.block,
      key: character.id,
      name: character.name,
      sheet: character.sheet,
    });
    for (const variant of character.variants ?? []) {
      members.set(`${character.id}:${variant.id}`, {
        // A variant inherits the binding unless it changes what the reference
        // is for; the block it must restate, since that is what makes it a
        // different age or costume in the first place.
        binding: variant.binding ?? character.binding,
        block: variant.block,
        key: `${character.id}:${variant.id}`,
        name: character.name,
        sheet: variant.sheet,
      });
    }
  }
  return members;
}

function variantsOf(character: Character): string[] {
  return (character.variants ?? []).map(
    (variant) => `${character.id}:${variant.id}`
  );
}

function resolveMember(
  key: string,
  members: Map<string, CastMember>,
  file: CharactersFile,
  shotId: string
): CastMember {
  const member = members.get(key);
  if (member) {
    return member;
  }
  const known = file.characters
    .flatMap((character) => [character.id, ...variantsOf(character)])
    .join(", ");
  throw new VsError(
    "unknown_id",
    `shot ${shotId}: no character "${key}" in characters.json`,
    { hint: `known: ${known}` }
  );
}

/** The sheet's still id, and the path a shot references it by. */
function sheetPath(key: string, stillsRefPrefix: string): string {
  return `${stillsRefPrefix}${sheetStillId(key)}.png`;
}

/**
 * One sentence of the binding block.
 *
 * `ordinal` is undefined when the member contributes no reference to this shot
 * — either it has no sheet, or the shot is in frame mode on a model that
 * forbids mixing. The block still goes in: the likeness is carried by the text,
 * which is exactly what the project's own doctrine prescribes for a character
 * that only ever appears in frame-mode shots.
 */
function castSentence(member: CastMember, ordinal: number | undefined): string {
  const opening = `${member.name} is ${member.block}`;
  if (ordinal === undefined || member.binding === undefined) {
    return `${opening}.`;
  }
  return `${opening}; use @Image ${ordinal} for ${member.binding}.`;
}

function composeSheetPrompt(
  member: CastMember,
  style: string | undefined
): string {
  return [
    style,
    `${member.name} is ${member.block}.`,
    member.sheet?.prompt ?? SHEET_COMPOSITION,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Whether this shot can carry cast REFERENCES at all.
 *
 * On Seedance 2.0 and MiniMax H3, frame mode and reference mode are mutually
 * exclusive and the schema refuses the mix outright, so appending a sheet to a
 * keyframed shot would write a shots.json that no longer loads. The answer is
 * not to refuse the film — every shot in `films/lighthouse` is keyframed — but
 * to fall back to the text-only form for that shot. It is decided per shot, so
 * the same character binds by ordinal in a reference-mode shot and by text in a
 * frame-mode one, in the same film.
 */
function textOnlyShot(shot: Shot, modelId: string): boolean {
  const { framesExcludeReferences } = lookupModel(modelId);
  if (!framesExcludeReferences) {
    return false;
  }
  return (shot.references ?? []).some((ref) => FRAME_ROLES.has(ref.role));
}

function dedupeCast(cast: string[], shotId: string, warnings: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const key of cast) {
    if (seen.has(key)) {
      warnings.push(
        `${shotId}: "${key}" is listed twice in cast — ignoring the repeat; one likeness gets one reference and one ordinal`
      );
      continue;
    }
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

function assertWellFormedKey(key: string, shotId: string): void {
  const parts = key.split(":");
  if (parts.length > 2 || parts.some((part) => part.length === 0)) {
    throw new VsError(
      "invalid_input",
      `shot ${shotId}: cast entry "${key}" is malformed`,
      { hint: 'use "character" or "character:variant"' }
    );
  }
}

/** What the sync would do to one shot. */
export interface ShotPlan {
  references: ShotReference[];
  castPrompt?: string;
  /** Members whose sheet this shot binds, so unused sheets can be reported. */
  bound: string[];
}

function planShot(input: {
  characters: CharactersFile;
  members: Map<string, CastMember>;
  modelId: string;
  shot: Shot;
  stillsRefPrefix: string;
  warnings: string[];
}): ShotPlan {
  const { characters, members, modelId, shot, stillsRefPrefix, warnings } =
    input;
  const cast = dedupeCast(shot.cast ?? [], shot.id, warnings);
  if (cast.length === 0) {
    return {
      bound: [],
      references: (shot.references ?? []).filter(
        (ref) => ref.cast === undefined
      ),
    };
  }
  const textOnly = textOnlyShot(shot, modelId);
  const resolved = cast.map((key) => {
    assertWellFormedKey(key, shot.id);
    return resolveMember(key, members, characters, shot.id);
  });
  // Which members should carry a reference in this shot at all.
  const wanted = new Map(
    resolved
      .filter((member) => member.sheet && !textOnly)
      .map(
        (member) => [sheetPath(member.key, stillsRefPrefix), member] as const
      )
  );

  // SYNC NEVER MOVES AN EXISTING REFERENCE. Start from the array exactly as
  // authored, drop only the sheets that are no longer cast, and adopt or append
  // the rest in place. Rebuilding from the unmarked references instead — which
  // is what this did first — quietly re-appended every previously adopted sheet
  // at the end, so the second sync of a migrated film shifted every hand-written
  // ordinal that came after it. The marker means "sync owns this", never "sync
  // may relocate it".
  const references: ShotReference[] = [];
  for (const ref of shot.references ?? []) {
    if (ref.cast !== undefined && !wanted.has(ref.url)) {
      continue;
    }
    references.push(ref);
  }

  const bound: string[] = [];
  // Position in `references`, per member — not the reference object. Keying by
  // object would collapse an aliased array to one entry and report the wrong
  // ordinal, which is the exact hazard `referenceOrdinals` documents.
  const slotOf = new Map<string, number>();
  for (const member of resolved) {
    if (!member.sheet || textOnly) {
      continue;
    }
    const url = sheetPath(member.key, stillsRefPrefix);
    const at = references.findIndex((ref) => ref.url === url);
    if (at !== -1) {
      // Already there, whoever put it there. Keep its position and take
      // ownership, unless it is a frame role — a sheet used as the opening
      // composition is a different intent, so bind its ordinal and leave the
      // role alone.
      const ref = references[at] as ShotReference;
      if (ref.role === "reference_image") {
        references[at] = { ...ref, cast: member.key };
      }
      slotOf.set(member.key, at);
      bound.push(member.key);
      continue;
    }
    // APPEND, never insert: appending is the only position that cannot shift a
    // hand-written `@Image N`, and it keeps a frame role at `@Image 1`.
    slotOf.set(member.key, references.length);
    references.push({
      cast: member.key,
      role: "reference_image",
      type: "image",
      url,
    });
    bound.push(member.key);
  }

  // Ordinals come from the FINAL array, so the sentences describe what the
  // model will actually receive rather than what cast alone would imply.
  const ordinals = referenceOrdinals(references);
  const sentences = resolved.map((member) => {
    const slot = slotOf.get(member.key);
    return castSentence(
      member,
      slot === undefined ? undefined : ordinals[slot]
    );
  });

  if (textOnly && resolved.some((member) => member.sheet)) {
    warnings.push(
      `${shot.id}: keyframed on ${modelId}, which cannot mix a frame with reference images — the cast block goes in as text only. That is the intended shape for a frame-mode shot; move the film to Seedance 2.5 if you want the sheets bound as well.`
    );
  }

  return {
    bound,
    castPrompt: sentences.join(" "),
    references,
  };
}

/**
 * Refuse a shot the model would refuse anyway, while sync is still free.
 *
 * Only fires when sync ADDED references. A film already over the cap by hand is
 * `vs generate`'s to report: failing here would blame the cast for an overflow
 * it did not cause, and would block a sync that makes the file no worse.
 */
function assertWithinSlots(shot: Shot, plan: ShotPlan, modelId: string): void {
  if (plan.bound.length === 0) {
    return;
  }
  const cap = lookupModel(modelId).referenceSlots.reference_image;
  if (cap === undefined) {
    return;
  }
  const used = plan.references.filter(
    (ref) => ref.role === "reference_image"
  ).length;
  if (used <= cap) {
    return;
  }
  throw new VsError(
    "invalid_input",
    `shot ${shot.id}: ${used} reference images once its ${plan.bound.length} cast sheet(s) are added, but ${modelId} accepts ${cap}`,
    {
      hint: "trim `cast`, or trim the hand-authored pack — `vs generate` would refuse this shot anyway, and finding out here costs nothing",
    }
  );
}

/**
 * The stills entry for one sheet, built wholly from characters.json.
 *
 * Deliberately NOT merged over the existing still. Spreading the previous
 * entry made removal impossible: drop `references` or `seed` from a character
 * and the old value survived, `--check` reported the film in sync, and the
 * sheet kept generating against a reference the author had deleted. Every
 * field here is derived, and a sheet still has no author-owned field to
 * preserve — `planCastSync` refuses outright to touch a still that is missing
 * the `cast` marker, so ownership is settled before this is ever called.
 */
function sheetStill(member: CastMember, style: string | undefined): Still {
  const sheet = member.sheet as CharacterSheet;
  return {
    cast: member.key,
    id: sheetStillId(member.key),
    prompt: composeSheetPrompt(member, style),
    ratio: sheet.ratio ?? SHEET_RATIO,
    ...(sheet.references ? { references: sheet.references } : {}),
    ...(sheet.seed === undefined ? {} : { seed: sheet.seed }),
  };
}

export interface CastSyncPlan {
  /** Sheets keyed by still id, in characters.json order. */
  stills: Still[];
  /** Per shot id: the references and castPrompt it should carry. */
  shots: Map<string, ShotPlan>;
  warnings: string[];
}

/**
 * Work out what `vs cast sync` should write, without touching the filesystem.
 *
 * Pure so the interesting rules — ordinal arithmetic, the frame-mode fallback,
 * idempotence — are testable without a temp directory, and so the command can
 * validate the result before anything lands on disk.
 */
export function planCastSync(input: {
  characters: CharactersFile;
  shots: ShotsFile;
  stills: StillsFile;
  /** Path prefix from the shots file to the stills output dir, e.g. "./stills/". */
  stillsRefPrefix: string;
}): CastSyncPlan {
  const { characters, shots, stills, stillsRefPrefix } = input;
  const members = membersOf(characters);
  const modelId = shots.film.model ?? DEFAULT_VIDEO_MODEL;
  const warnings: string[] = [];

  const plans = new Map<string, ShotPlan>();
  const boundAnywhere = new Set<string>();
  for (const shot of shots.shots) {
    const plan = planShot({
      characters,
      members,
      modelId,
      shot,
      stillsRefPrefix,
      warnings,
    });
    assertWithinSlots(shot, plan, modelId);
    plans.set(shot.id, plan);
    for (const key of plan.bound) {
      boundAnywhere.add(key);
    }
  }

  // Only generate a sheet some shot actually binds. An image call for a sheet
  // nothing references buys nothing, and on a frame-mode film that is every
  // sheet — which is the case the doctrine calls out explicitly.
  const sheets: Still[] = [];
  const byId = new Map(stills.stills.map((still) => [still.id, still]));
  for (const member of members.values()) {
    if (!(member.sheet && boundAnywhere.has(member.key))) {
      if (member.sheet) {
        warnings.push(
          `${member.key} has a sheet no shot binds — no still is generated for it; add it to a shot's cast, or drop its sheet to make it text-only`
        );
      }
      continue;
    }
    const existing = byId.get(sheetStillId(member.key));
    if (existing && existing.cast === undefined) {
      throw new VsError(
        "invalid_input",
        `still "${existing.id}" already exists and was not generated by cast sync`,
        {
          hint: "a hand-written still prompt is real work with no undo, so sync will not overwrite it — rename that still, or rename the character",
        }
      );
    }
    sheets.push(sheetStill(member, characters.style));
  }

  return { shots: plans, stills: sheets, warnings };
}
