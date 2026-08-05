import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateImage } from "ai";
import pLimit from "p-limit";

import { formatError, VsError } from "../errors.js";
import { GEMINI_PRO_IMAGE_MODEL, resolveImageModel } from "../images.js";
import { safeJoin } from "../paths.js";
import type { Still, StillsFile } from "../types.js";
import { resolveStills } from "./context.js";
import { emit, fail, heading, isVerbose, line, note, ok } from "./output.js";

/**
 * Nano Banana Pro. Stills run on Google through the AI SDK; the older Seedream
 * default is gone with the hand-rolled Ark image client that served it. To use
 * Seedream again, add `@ai-sdk/fal` and name a `fal-ai/bytedance/seedream/*`
 * model (see src/images.ts).
 */
export const DEFAULT_IMAGE_MODEL = GEMINI_PRO_IMAGE_MODEL;

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

/** What `--dry-run` prints: the portable call, with reference bytes summarised. */
function previewCall(
  still: Still,
  file: StillsFile,
  model: string
): Record<string, unknown> {
  const ratio = still.ratio ?? file.ratio;
  return {
    model,
    prompt: still.prompt,
    ...(still.references?.length
      ? { references: still.references.map((url) => `<bytes from ${url}>`) }
      : {}),
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...(still.seed === undefined ? {} : { seed: still.seed }),
    ...(still.size === undefined ? {} : { size: still.size }),
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

  if (options.dryRun) {
    const payloads = stills.map((still) => ({
      payload: previewCall(still, file, model),
      stillId: still.id,
    }));
    emit({ dryRun: true, model, payloads }, () => {
      for (const { payload, stillId } of payloads) {
        heading(`# ${stillId}`);
        line(JSON.stringify(payload, null, 2));
      }
      note(`${payloads.length} payload(s); nothing submitted.`);
    });
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
  const { ratio } = file;
  async function generate(still: Still, outputPath: string): Promise<void> {
    const { image } = await generateImage({
      model: imageModel,
      prompt: await buildPrompt(still, stillsDir),
      ...((still.ratio ?? ratio)
        ? { aspectRatio: (still.ratio ?? ratio) as `${number}:${number}` }
        : {}),
      ...(still.seed === undefined ? {} : { seed: still.seed }),
      ...(still.size === undefined
        ? {}
        : { size: still.size as `${number}x${number}` }),
    });
    await writeFile(outputPath, image.uint8Array);
  }
  await mkdir(outputDir, { recursive: true });
  const limit = pLimit(options.concurrency);

  const generated: string[] = [];
  const results = await Promise.allSettled(
    stills.map((still) =>
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

  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    const { hint, message } = formatError(failure.reason, isVerbose());
    fail(message);
    if (hint) {
      note(`  ${hint}`);
    }
  }
  emit({ failed: failures.length, generated, outputDir }, () => {
    note(`${generated.length} still(s) generated into ${outputDir}`);
  });
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
