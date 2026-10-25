import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ImageModelV4 } from "@ai-sdk/provider";

import { requireGeminiApiKey, requireOpenAiApiKey } from "./env.js";
import { VsError } from "./errors.js";
import type { StillAspectRatio } from "./types.js";

/**
 * Stills, on the AI SDK.
 *
 * The whole file. `vs stills` resolves a model here, calls `generateImage`, and
 * writes the bytes; there is no wire format, no retry policy, and no response
 * parsing in this codebase for images at all.
 *
 * Stills are deliberately NOT behind the video provider spec in src/spec/, and
 * the difference is why one gets a bespoke spec and the other gets a
 * dependency: video costs dollars per call, needs a pre-flight `--max-cost`
 * estimate, and must re-attach to an in-flight paid task after a crash. Stills
 * cost cents and are one request. Nothing here is worth owning.
 *
 * ADDING A PROVIDER is `npm i @ai-sdk/<name>` and one line below. `@ai-sdk/fal`
 * is the one to reach for: it carries Seedream (`fal-ai/bytedance/seedream/*`),
 * Flux, and most of the rest, at a broker's markup.
 */

/** Nano Banana Pro — the professional-asset Gemini 3 Pro Image model. */
export const GEMINI_PRO_IMAGE_MODEL = "gemini-3-pro-image";

/**
 * Every id this file knows how to route: Google and OpenAI are the only
 * backends, so a `seedream-*` or `flux-*` id left over from an earlier stills
 * file is not a model this CLI can reach. `--dry-run` never resolves a model,
 * so this check is what catches it before a key prompt and a round trip.
 */
const GEMINI_IMAGE_MODEL = /^(?:models\/)?gemini-/u;

/**
 * OpenAI's GPT Image family (`gpt-image-2.5-sunburst` for quality,
 * `gpt-image-2.5-flare` for speed). It takes a pixel `size`, not a ratio, and
 * no seed; `imageCallOptions` is the one place that difference lives.
 */
const OPENAI_IMAGE_MODEL = /^gpt-image-/u;

function isOpenAiImageModel(modelId: string): boolean {
  return OPENAI_IMAGE_MODEL.test(modelId);
}

/**
 * The pixel size a GPT Image call asks for. Landscape ratios map to its
 * widest supported landscape size, portrait to its tallest, square to square.
 */
function imageSizeFor(ratio?: string): `${number}x${number}` {
  if (!ratio) {
    return "1024x1024";
  }
  const [w, h] = ratio.split(":").map(Number);
  if (w === h) {
    return "1024x1024";
  }
  return w > h ? "1536x1024" : "1024x1536";
}

/**
 * The per-model half of a `generateImage` call. Gemini takes a ratio and a
 * seed; GPT Image takes pixels and no seed, and sending it either of the
 * others is a warning the SDK prints and the backend ignores. Commands pass
 * the still's own settings and never branch on the provider.
 */
export function imageCallOptions(
  modelId: string,
  ratio?: StillAspectRatio,
  seed?: number
): {
  aspectRatio?: StillAspectRatio;
  seed?: number;
  size?: `${number}x${number}`;
} {
  if (isOpenAiImageModel(modelId)) {
    return { size: imageSizeFor(ratio) };
  }
  return {
    ...(ratio ? { aspectRatio: ratio } : {}),
    ...(seed === undefined ? {} : { seed }),
  };
}

export function assertImageModelSupported(modelId: string): void {
  if (GEMINI_IMAGE_MODEL.test(modelId) || isOpenAiImageModel(modelId)) {
    return;
  }
  throw new VsError(
    "invalid_input",
    `stills model "${modelId}" is not one this CLI can run`,
    {
      hint: `stills run on Google or OpenAI: use "${GEMINI_PRO_IMAGE_MODEL}" or "gpt-image-2.5-sunburst", or drop the top-level \`model\` to take the default. Seedream and Flux need \`npm i @ai-sdk/fal\` and a line in src/images.ts.`,
    }
  );
}

export function resolveImageModel(modelId: string): ImageModelV4 {
  assertImageModelSupported(modelId);
  if (isOpenAiImageModel(modelId)) {
    return createOpenAI({ apiKey: requireOpenAiApiKey() }).image(modelId);
  }
  return createGoogleGenerativeAI({ apiKey: requireGeminiApiKey() }).image(
    modelId
  );
}
