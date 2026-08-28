import { rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { planCastSync } from "../cast.js";
import type { ShotPlan } from "../cast.js";
import { VsError } from "../errors.js";
import { isLocalPathSafe } from "../paths.js";
import {
  loadCharactersFile,
  loadRawFilmJson,
  parseShotsFile,
  parseStillsFile,
} from "../shots.js";
import type { ShotsFile, Still, StillsFile } from "../types.js";
import { emit, note, ok, warn } from "./output.js";

export interface CastSyncOptions {
  characters?: string;
  check: boolean;
  stills?: string;
}

/**
 * The raw shapes sync mutates. Deliberately loose: these objects came from
 * `JSON.parse`, not from zod, because zod rebuilds its output in SCHEMA key
 * order and serialising that would reorder every shot in the film the first
 * time you synced it. The validated copies are what the planning reads.
 */
interface RawShotsFile {
  shots: Record<string, unknown>[];
  [key: string]: unknown;
}
interface RawStillsFile {
  stills: Record<string, unknown>[];
  [key: string]: unknown;
}

/**
 * Rewrite one shot object, keeping the author's key order.
 *
 * `castPrompt` is placed straight after `prompt` so the diff reads as prose in
 * the order the model sees it. Rebuilding rather than assigning matters:
 * `delete` then set would move the key to the end of the object and churn the
 * diff on every run.
 */
function applyShot(
  raw: Record<string, unknown>,
  plan: ShotPlan
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  let placedReferences = false;
  for (const [key, value] of Object.entries(raw)) {
    if (key === "castPrompt") {
      continue;
    }
    if (key === "references") {
      if (plan.references.length > 0) {
        next.references = plan.references;
        placedReferences = true;
      }
      continue;
    }
    next[key] = value;
    if (key === "prompt" && plan.castPrompt !== undefined) {
      next.castPrompt = plan.castPrompt;
    }
  }
  if (!placedReferences && plan.references.length > 0) {
    next.references = plan.references;
  }
  return next;
}

function applyShots(raw: RawShotsFile, plans: Map<string, ShotPlan>): void {
  raw.shots = raw.shots.map((shot) => {
    const plan = plans.get(String(shot.id));
    return plan ? applyShot(shot, plan) : shot;
  });
}

/**
 * Upsert the sheets and prune the orphans.
 *
 * Only stills carrying `cast` are sync's to touch. A hand-written still is
 * left exactly as it is — the planner has already refused an id collision
 * rather than overwriting one.
 */
function applyStills(raw: RawStillsFile, sheets: Still[]): void {
  const wanted = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const kept: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const still of raw.stills) {
    const id = String(still.id);
    const sheet = wanted.get(id);
    if (sheet) {
      kept.push(sheet as unknown as Record<string, unknown>);
      seen.add(id);
      continue;
    }
    // A sheet for a character that is gone, or now text-only.
    if (still.cast !== undefined) {
      continue;
    }
    kept.push(still);
  }
  // New sheets go first: a keyframe references them, so they generate in the
  // first wave and the file reads in dependency order.
  const added = sheets.filter((sheet) => !seen.has(sheet.id));
  raw.stills = [...(added as unknown as Record<string, unknown>[]), ...kept];
}

/**
 * The path a shot must use to reference a still, as a string it can carry.
 *
 * Sibling files (the norm) give `./stills/char-keeper.png`. When they are not
 * siblings the relative path can climb out of the film directory, which the
 * schema rejects — so find out here, with a message that names the cause,
 * rather than at load time with a message about `..`.
 */
function stillsRefPrefix(shotsDir: string, outputDir: string): string {
  const rel = relative(shotsDir, outputDir).replaceAll("\\", "/");
  const prefix = rel === "" ? "./" : `./${rel}/`;
  if (!isLocalPathSafe(`${prefix}probe.png`)) {
    throw new VsError(
      "invalid_input",
      `the stills output directory (${outputDir}) is outside the shots file's directory (${shotsDir})`,
      {
        hint: "a shot can only reference a still inside the film directory; keep shots.json and stills.json siblings, or point the stills `outputDir` inside the film",
      }
    );
  }
  return prefix;
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmp, path);
}

function siblingOf(shotsFilePath: string, name: string): string {
  return resolve(dirname(resolve(shotsFilePath)), name);
}

export async function runCastSync(
  shotsFilePath: string,
  options: CastSyncOptions
): Promise<void> {
  const shotsPath = resolve(shotsFilePath);
  const shotsDir = dirname(shotsPath);
  const charactersPath = options.characters
    ? resolve(options.characters)
    : siblingOf(shotsPath, "characters.json");
  const stillsPath = options.stills
    ? resolve(options.stills)
    : siblingOf(shotsPath, "stills.json");

  const characters = await loadCharactersFile(charactersPath);
  // Twice each, on purpose: the raw object is what gets written back, the
  // validated one is what the planner reads. See RawShotsFile above.
  const shotsRaw = (await loadRawFilmJson(shotsPath)) as RawShotsFile;
  const stillsRaw = (await loadRawFilmJson(stillsPath)) as RawStillsFile;
  const shots: ShotsFile = parseShotsFile(shotsRaw, shotsPath);
  const stills: StillsFile = parseStillsFile(stillsRaw, stillsPath);

  const outputDir = resolve(
    dirname(stillsPath),
    stills.outputDir ?? "./stills"
  );
  const plan = planCastSync({
    characters,
    shots,
    stills,
    stillsRefPrefix: stillsRefPrefix(shotsDir, outputDir),
  });

  const before = {
    shots: structuredClone(shotsRaw),
    stills: structuredClone(stillsRaw),
  };
  applyShots(shotsRaw, plan.shots);
  applyStills(stillsRaw, plan.stills);

  // Validate the RESULT before it can reach disk. This is what makes a plan
  // that would violate the frame/reference rule or a slot cap impossible to
  // land: the file that fails to load is the one we never wrote.
  parseShotsFile(shotsRaw, shotsPath);
  parseStillsFile(stillsRaw, stillsPath);

  for (const warning of plan.warnings) {
    warn(warning);
  }

  // SEMANTIC, not byte, comparison. oxfmt collapses short arrays onto one line,
  // so a byte diff would have the formatter and this command fighting forever
  // in CI over a file neither of them thinks is wrong.
  const changed = [
    ...(isDeepStrictEqual(before.shots, shotsRaw) ? [] : [shotsPath]),
    ...(isDeepStrictEqual(before.stills, stillsRaw) ? [] : [stillsPath]),
  ];
  const bound = [...plan.shots.values()].filter(
    (shotPlan) => shotPlan.bound.length > 0
  ).length;

  if (options.check) {
    emit({ changed, check: true, inSync: changed.length === 0 }, () => {
      if (changed.length === 0) {
        ok("cast is in sync");
        return;
      }
      for (const path of changed) {
        note(`out of sync: ${path}`);
      }
      note("run `vs cast sync` without --check to update");
    });
    if (changed.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  for (const path of changed) {
    await writeAtomic(path, path === shotsPath ? shotsRaw : stillsRaw);
  }
  emit({ changed, sheets: plan.stills.map((sheet) => sheet.id) }, () => {
    if (changed.length === 0) {
      ok("cast is already in sync; nothing written");
      return;
    }
    for (const path of changed) {
      ok(`updated ${path}`);
    }
    if (plan.stills.length > 0) {
      note(
        `${plan.stills.length} sheet(s) bound across ${bound} shot(s) — run \`vs stills ${stillsPath}\` to generate them`
      );
    }
  });
}
