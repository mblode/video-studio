import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import pLimit from "p-limit";

import type { ArkClient } from "../ark.js";
import { downloadFile } from "../download.js";
import { formatError, VsError } from "../errors.js";
import { isGeminiModel, resolveInlineImage } from "../gemini.js";
import type { GeminiClient } from "../gemini.js";
import { resolveReferenceUrl } from "../payload.js";
import type { CreateImageRequest, Still, StillsFile } from "../types.js";
import {
  createArkClient,
  createGeminiClient,
  resolveStills,
} from "./context.js";
import { emit, fail, heading, isVerbose, line, note, ok } from "./output.js";

export const DEFAULT_IMAGE_MODEL = "seedream-5-0-260128";

/** Generate one still to `outputPath`. The backend (Seedream/Nano Banana) is bound up front. */
type StillGenerator = (still: Still, outputPath: string) => Promise<void>;

export interface StillsOptions {
  concurrency: number;
  dryRun: boolean;
  force: boolean;
  output?: string;
  still?: string[];
}

async function buildImagePayload(
  still: Still,
  file: StillsFile,
  stillsDir: string,
  skipInline: boolean
): Promise<CreateImageRequest> {
  const references = still.references
    ? await Promise.all(
        still.references.map((url) =>
          resolveReferenceUrl(url, stillsDir, skipInline)
        )
      )
    : undefined;
  return {
    model: file.model ?? DEFAULT_IMAGE_MODEL,
    prompt: still.prompt,
    response_format: "url",
    sequential_image_generation: "disabled",
    watermark: false,
    ...(references === undefined ? {} : { image: references }),
    ...(still.seed === undefined ? {} : { seed: still.seed }),
    ...(still.size === undefined ? {} : { size: still.size }),
  };
}

/** Dry-run preview of the Nano Banana / Gemini generateContent body (no files read). */
function geminiPreview(still: Still, file: StillsFile, model: string): unknown {
  const images = (still.references ?? []).map((url) => ({
    inlineData: {
      data: `<inlined from ${url} at submit time>`,
      mimeType: "image/*",
    },
  }));
  const ratio = still.ratio ?? file.ratio;
  return {
    contents: [{ parts: [{ text: still.prompt }, ...images] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(ratio ? { imageConfig: { aspectRatio: ratio } } : {}),
    },
    model,
  };
}

function seedreamGenerator(
  client: ArkClient,
  file: StillsFile,
  stillsDir: string
): StillGenerator {
  return async (still, outputPath) => {
    const response = await client.createImage(
      await buildImagePayload(still, file, stillsDir, false)
    );
    const [image] = response.data;
    if (image?.url) {
      await downloadFile(image.url, outputPath);
    } else if (image?.b64_json) {
      await writeFile(outputPath, Buffer.from(image.b64_json, "base64"));
    } else {
      throw new VsError(
        "probe_failed",
        `${still.id}: the image API returned neither a url nor b64_json`,
        {
          hint: "re-run with --dry-run to inspect the request, and check the model id in stills.json is one your account has activated",
        }
      );
    }
  };
}

function geminiGenerator(
  client: GeminiClient,
  file: StillsFile,
  model: string,
  stillsDir: string
): StillGenerator {
  return async (still, outputPath) => {
    const images = still.references
      ? await Promise.all(
          still.references.map((url) => resolveInlineImage(url, stillsDir))
        )
      : undefined;
    const bytes = await client.generateImage({
      aspectRatio: still.ratio ?? file.ratio,
      images,
      model,
      prompt: still.prompt,
    });
    await writeFile(outputPath, bytes);
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
  const gemini = isGeminiModel(model);

  if (options.dryRun) {
    const payloads: { payload: unknown; stillId: string }[] = [];
    for (const still of stills) {
      payloads.push({
        payload: gemini
          ? geminiPreview(still, file, model)
          : await buildImagePayload(still, file, stillsDir, true),
        stillId: still.id,
      });
    }
    emit({ dryRun: true, model, payloads }, () => {
      for (const { payload, stillId } of payloads) {
        heading(`# ${stillId}`);
        line(JSON.stringify(payload, null, 2));
      }
      note(`${payloads.length} payload(s); nothing submitted.`);
    });
    return;
  }

  // Nano Banana ignores Seedream's pixel `size` and image `seed`; flag it once
  // so a film carried over from Seedream doesn't silently drop those fields.
  if (
    gemini &&
    stills.some((s) => s.size !== undefined || s.seed !== undefined)
  ) {
    note("Nano Banana / Gemini ignores per-still seed and size");
  }

  const generate: StillGenerator = gemini
    ? geminiGenerator(createGeminiClient(), file, model, stillsDir)
    : seedreamGenerator(createArkClient(), file, stillsDir);
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
