import { basename, dirname, extname, join, resolve } from "node:path";

import { VsError } from "./errors.js";
import type { Still } from "./types.js";

/**
 * A stills file is a DAG, not a list.
 *
 * `films/lighthouse` chains nine of its twelve stills off one earlier still's
 * png, and a character sheet makes that structural rather than incidental:
 * every keyframe that binds a likeness references a sheet the same file
 * produces. Generating the whole file concurrently therefore races its own
 * inputs — on a first run the dependants read a png that does not exist yet.
 *
 * Nothing in the schema declares the edge, and nothing needs to. A reference
 * that resolves to the path some other still WRITES is an edge, and that is the
 * same `outputDir`-plus-id mapping the rest of the CLI already uses to answer
 * "which still is this shot's keyframe".
 */
function outputPathsById(
  stills: readonly Still[],
  outputDir: string
): Map<string, string> {
  return new Map(
    stills.map((still) => [
      still.id,
      resolve(join(outputDir, `${still.id}.png`)),
    ])
  );
}

/**
 * Which stills in this file each still must wait for.
 *
 * Only edges INSIDE the given set count. A reference to a png some earlier run
 * left on disk, or to a still excluded by `--still`, is not a dependency this
 * run can satisfy or needs to — it is already there, or the author meant to
 * reuse it.
 */
function dependencies(
  stills: readonly Still[],
  options: { outputDir: string; stillsDir: string }
): Map<string, Set<string>> {
  const outputs = outputPathsById(stills, options.outputDir);
  const owners = new Map([...outputs].map(([id, path]) => [path, id] as const));
  const edges = new Map<string, Set<string>>();
  for (const still of stills) {
    const needs = new Set<string>();
    for (const ref of still.references ?? []) {
      if (ref.startsWith("https://")) {
        continue;
      }
      const producer = owners.get(resolve(options.stillsDir, ref));
      if (producer !== undefined && producer !== still.id) {
        needs.add(producer);
      }
    }
    edges.set(still.id, needs);
  }
  return edges;
}

/**
 * Order stills into waves: everything in wave N can generate concurrently, and
 * wave N+1 may reference wave N's output.
 *
 * A cycle is a hard error rather than a best-effort ordering. There is no order
 * that satisfies it, and the alternative — generating anyway — spends an image
 * call per member to produce stills that silently lose the likeness they were
 * chained together to preserve.
 */
export function stillWaves(
  stills: readonly Still[],
  options: { outputDir: string; stillsDir: string }
): Still[][] {
  const pending = new Map(stills.map((still) => [still.id, still]));
  const edges = dependencies(stills, options);
  const done = new Set<string>();
  const waves: Still[][] = [];

  while (pending.size > 0) {
    const ready = [...pending.values()].filter((still) =>
      [...(edges.get(still.id) ?? [])].every((need) => done.has(need))
    );
    if (ready.length === 0) {
      // Everything left is waiting on something else that is left.
      const stuck = [...pending.keys()].toSorted();
      throw new VsError(
        "invalid_input",
        `stills reference each other in a cycle: ${stuck.join(", ")}`,
        {
          hint: "a still cannot be its own ancestor — break the chain by pointing one of these at a plate it does not produce, or generate it in a separate run",
        }
      );
    }
    waves.push(ready);
    for (const still of ready) {
      pending.delete(still.id);
      done.add(still.id);
    }
  }
  return waves;
}

/**
 * The still id a reference points at, if it points at one this file produces.
 *
 * The same edge `stillWaves` walks, exposed for the runner: after a wave
 * fails, the next one needs to know which of its references will not be there.
 * Returns undefined for an https reference, or a local plate that no still in
 * this file writes.
 */
export function stillIdFor(
  reference: string,
  options: { outputDir: string; stillsDir: string }
): string | undefined {
  if (reference.startsWith("https://")) {
    return;
  }
  const resolved = resolve(options.stillsDir, reference);
  if (
    dirname(resolved) !== resolve(options.outputDir) ||
    extname(resolved).toLowerCase() !== ".png"
  ) {
    return;
  }
  return basename(resolved, extname(resolved));
}
