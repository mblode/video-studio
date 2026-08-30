import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateImage } from "ai";
import pLimit from "p-limit";

import { formatError, VsError } from "../errors.js";
import {
  assertImageModelSupported,
  GEMINI_PRO_IMAGE_MODEL,
  resolveImageModel,
} from "../images.js";
import { safeJoin } from "../paths.js";
import { lintStillsFile } from "../shots.js";
import { stillIdFor, stillWaves } from "../stills.js";
import type { Still, StillAspectRatio, StillsFile } from "../types.js";
import { resolveStills } from "./context.js";
import {
  emit,
  fail,
  heading,
  isVerbose,
  line,
  note,
  ok,
  warn,
} from "./output.js";

/**
 * Nano Banana Pro. Stills run on Google through the AI SDK; the older Seedream
 * default is gone with the hand-rolled Ark image client that served it. To use
 * Seedream again, add `@ai-sdk/fal` and name a `fal-ai/bytedance/seedream/*`
 * model (see src/images.ts).
 */
const DEFAULT_IMAGE_MODEL = GEMINI_PRO_IMAGE_MODEL;

export interface StillsOptions {
  concurrency: number;
  dryRun: boolean;
  force: boolean;
  output?: string;
  still?: string[];
}

/**
 * A reference image, as bytes.
 *
 * `generateImage` takes references as `DataContent` on the prompt object, so a
 * local path is read and a remote one fetched, and the SDK's provider encodes
 * each for whichever wire format its backend wants. That encoding is the whole
 * reason this file no longer has two generators.
 */
async function loadReference(
  url: string,
  stillsDir: string
): Promise<Uint8Array> {
  if (url.startsWith("https://")) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new VsError(
        "probe_failed",
        `reference ${url} returned ${response.status}`,
        { hint: "check the URL is public and still live" }
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  return new Uint8Array(await readFile(safeJoin(stillsDir, url)));
}

/**
 * The prompt for one still: bare text, or text plus reference images when the
 * still binds any. Nano Banana's likeness workflow and Seedream's reference
 * mode are the same shape here, which they were not before.
 */
async function buildPrompt(
  still: Still,
  stillsDir: string
): Promise<string | { images: Uint8Array[]; text: string }> {
  const references = still.references ?? [];
  if (references.length === 0) {
    return still.prompt;
  }
  return {
    images: await Promise.all(
      references.map((url) => loadReference(url, stillsDir))
    ),
    text: still.prompt,
  };
}

/**
 * Every argument `generateImage` will receive except the prompt.
 *
 * ONE definition, shared by the real call and by `--dry-run`. Two copies is how
 * a dry-run drifts from what is actually sent, which turns the free preflight
 * into a confident lie. `size` is deliberately absent: Nano Banana ignores
 * pixel sizes, so passing one through would be dead weight the preview then
 * advertised.
 */
function callSettings(
  still: Still,
  file: StillsFile
): { aspectRatio?: StillAspectRatio; seed?: number } {
  const ratio = still.ratio ?? file.ratio;
  return {
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...(still.seed === undefined ? {} : { seed: still.seed }),
  };
}

/** What `--dry-run` prints. Reads no bytes: it is the free preflight. */
function previewCall(
  still: Still,
  file: StillsFile,
  model: string
): Record<string, unknown> {
  return {
    model,
    prompt: still.prompt,
    ...(still.references?.length
      ? { references: still.references.map((url) => `<bytes from ${url}>`) }
      : {}),
    ...callSettings(still, file),
  };
}

function selectStills(file: StillsFile, ids: string[] | undefined): Still[] {
  if (!ids || ids.length === 0) {
    return file.stills;
  }
  const byId = new Map(file.stills.map((still) => [still.id, still]));
  return ids.map((id) => {
    const still = byId.get(id);
    if (!still) {
      throw new VsError("unknown_id", `no still with id "${id}" in this file`, {
        hint: `valid ids: ${file.stills.map((s) => s.id).join(", ")}`,
      });
    }
    return still;
  });
}

export async function runStills(
  stillsFilePath: string,
  options: StillsOptions
): Promise<void> {
  const { file, outputDir, stillsDir } = await resolveStills(stillsFilePath, {
    output: options.output,
  });
  const stills = selectStills(file, options.still);
  const model = file.model ?? DEFAULT_IMAGE_MODEL;
  // A stills file is a DAG (a keyframe references the character sheet this same
  // file produces), so decide the order before anything else reads it: a cycle
  // is unrunnable and should say so for free rather than after the first call.
  const waves = stillWaves(stills, { outputDir, stillsDir });
  // Before the dry-run branch on purpose: a model this CLI cannot route is the
  // kind of thing a free preflight exists to catch, and `resolveImageModel` is
  // only reached once you are already spending.
  assertImageModelSupported(model);

  // `vs generate` has printed its lints since before `--dry-run` existed; the
  // stills side had the same lints written and never called. `outputDir` is
  // what stops it warning about a reference this very run is about to write.
  for (const warning of lintStillsFile(file, { outputDir, stillsDir })) {
    warn(warning);
  }

  if (options.dryRun) {
    const payloads = stills.map((still) => ({
      payload: previewCall(still, file, model),
      stillId: still.id,
    }));
    emit(
      {
        dryRun: true,
        model,
        payloads,
        waves: waves.map((wave) => wave.map((still) => still.id)),
      },
      () => {
        for (const { payload, stillId } of payloads) {
          heading(`# ${stillId}`);
          line(JSON.stringify(payload, null, 2));
        }
        if (waves.length > 1) {
          note(
            `${waves.length} waves (a still that references another waits for it): ${waves.map((wave) => wave.map((s) => s.id).join(" ")).join(" → ")}`
          );
        }
        note(`${payloads.length} payload(s); nothing submitted.`);
      }
    );
    return;
  }

  // Nano Banana takes a ratio, not pixels, and rolls its own seed. Flag it once
  // so a stills file carried over from Seedream does not silently drop them.
  if (stills.some((s) => s.size !== undefined || s.seed !== undefined)) {
    note("Nano Banana ignores per-still seed and size; use `ratio` instead");
  }
  // ONE path. The model is an `ImageModelV4` whichever backend answers, so
  // nothing below this line knows or cares which one it is.
  const imageModel = resolveImageModel(model);
  async function generate(still: Still, outputPath: string): Promise<void> {
    const { image } = await generateImage({
      model: imageModel,
      prompt: await buildPrompt(still, stillsDir),
      ...callSettings(still, file),
    });
    await writeFile(outputPath, image.uint8Array);
  }
  await mkdir(outputDir, { recursive: true });
  const limit = pLimit(options.concurrency);

  const generated: string[] = [];
  const failures: unknown[] = [];
  // Ids that will not be on disk when a later wave reads them, so a still that
  // references one is skipped rather than generated against a missing plate.
  // Paying for a still that silently lost the likeness it was chained to is
  // worse than not generating it: the file looks finished and is not.
  const unavailable = new Set<string>();
  const skipped: string[] = [];

  for (const wave of waves) {
    const runnable = wave.filter((still) => {
      const blockers = (still.references ?? [])
        .map((ref) => stillIdFor(ref, { outputDir, stillsDir }))
        .filter((id): id is string => id !== undefined && unavailable.has(id));
      if (blockers.length === 0) {
        return true;
      }
      unavailable.add(still.id);
      skipped.push(still.id);
      warn(
        `${still.id} skipped — it references ${blockers.join(", ")}, which did not generate`
      );
      return false;
    });

    // Sequential BETWEEN waves, concurrent within one: the whole point is that
    // a dependant reads its input's png after that png is on disk.
    const results = await Promise.allSettled(
      runnable.map((still) =>
        limit(async () => {
          const outputPath = join(outputDir, `${still.id}.png`);
          if (!options.force && existsSync(outputPath)) {
            note(`${still.id} already exists, skipping`);
            return;
          }
          await generate(still, outputPath);
          generated.push(still.id);
          ok(`${still.id} → ${outputPath}`);
        })
      )
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failures.push(result.reason);
        const failed = runnable[index];
        if (failed) {
          unavailable.add(failed.id);
        }
      }
    }
  }

  for (const reason of failures) {
    const { hint, message } = formatError(reason, isVerbose());
    fail(message);
    if (hint) {
      note(`  ${hint}`);
    }
  }
  emit({ failed: failures.length, generated, outputDir, skipped }, () => {
    note(`${generated.length} still(s) generated into ${outputDir}`);
  });
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
