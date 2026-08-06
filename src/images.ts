import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ImageModelV4 } from "@ai-sdk/provider";

import { requireGeminiApiKey } from "./env.js";

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

export function resolveImageModel(modelId: string): ImageModelV4 {
  return createGoogleGenerativeAI({ apiKey: requireGeminiApiKey() }).image(
    modelId
  );
}
