import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  ImageModelV4,
  ImageModelV4CallOptions,
  ImageModelV4Result,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import { z } from "zod";

import { baseUrl, requireApiKey, requireGeminiApiKey } from "./env.js";
import { requestJson } from "./http.js";

/**
 * Stills, routed through the AI SDK.
 *
 * Stills are deliberately NOT behind the video provider spec in src/spec/: they
 * cost cents rather than dollars, they have no task lifecycle to re-attach to,
 * and nothing about them needs a pre-flight cost estimate. That is exactly the
 * profile `generateImage` already covers, so `vs stills` has ONE code path:
 * resolve an `ImageModelV4`, call `generateImage`, write the bytes. Video keeps
 * its own spec because `--max-cost` and re-attaching to an in-flight paid task
 * are things the SDK does not model.
 */

/** Nano Banana 2 — the high-efficiency Gemini 3.1 Flash Image model. */
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
/** Nano Banana Pro — the professional-asset Gemini 3 Pro Image model. */
export const GEMINI_PRO_IMAGE_MODEL = "gemini-3-pro-image";

/** `gemini-*` ids route to Google; anything else is treated as a Seedream id. */
export function isGeminiModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gemini-");
}

const SEEDREAM_PROVIDER = "seedream";
const IMAGES_PATH = "/images/generations";

/**
 * Provider-specific body fields for a Seedream call.
 *
 * `watermark: false` and `sequential_image_generation: "disabled"` are not
 * OpenAI fields, so they ride here rather than on the portable surface. The
 * watermark one matters: the default burns a logo into a keyframe that the
 * whole film then inherits.
 */
export function seedreamProviderOptions(): SharedV4ProviderOptions {
  return {
    [SEEDREAM_PROVIDER]: {
      sequential_image_generation: "disabled",
      watermark: false,
    },
  };
}

const imageResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      b64_json: z.string().optional(),
      url: z.string().optional(),
    })
  ),
});

type ImageModelV4File = NonNullable<ImageModelV4CallOptions["files"]>[number];

/**
 * One reference into the single string Ark's `image[]` accepts: an https URL
 * passes straight through, and raw bytes become a data URL.
 */
function toArkImage(file: ImageModelV4File): string {
  if (file.type === "url") {
    return file.url;
  }
  const data =
    typeof file.data === "string"
      ? file.data
      : Buffer.from(file.data).toString("base64");
  return data.startsWith("data:")
    ? data
    : `data:${file.mediaType};base64,${data}`;
}

/**
 * Seedream on BytePlus Ark, as an `ImageModelV4`.
 *
 * WHY THIS IS NOT `@ai-sdk/openai-compatible`, which was tried first: Ark's
 * endpoint is OpenAI-*shaped* but not OpenAI-compatible in the two places that
 * matter. The generic provider drops `seed` outright (OpenAI's images API has
 * none), and it sends reference images as multipart `FormData` to an edit
 * endpoint, whereas Ark wants JSON with `image: string[]` of URLs or data URLs.
 * Both were caught by asserting the outgoing body in src/images.test.ts, and
 * both would have been silent: a still that quietly loses its seed is
 * irreproducible, and one that quietly loses its references loses the likeness
 * that is the entire point of a keyframe board.
 *
 * ~50 lines to keep the single `generateImage` call path is a good trade.
 */
class SeedreamImageModel implements ImageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = SEEDREAM_PROVIDER;
  readonly modelId: string;
  /** Ark generates one image per call; the SDK loops for `n > 1`. */
  readonly maxImagesPerCall = 1;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async doGenerate(
    options: ImageModelV4CallOptions
  ): Promise<ImageModelV4Result> {
    const extra = options.providerOptions?.[SEEDREAM_PROVIDER] ?? {};
    const response = await requestJson({
      body: {
        model: this.modelId,
        prompt: options.prompt ?? "",
        response_format: "b64_json",
        ...(options.files?.length
          ? { image: options.files.map(toArkImage) }
          : {}),
        ...(options.seed === undefined ? {} : { seed: options.seed }),
        ...(options.size === undefined ? {} : { size: options.size }),
        ...extra,
      },
      fetchImpl: globalThis.fetch,
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      method: "POST",
      provider: "Seedream",
      schema: imageResponseSchema,
      url: `${baseUrl().replace(/\/$/u, "")}${IMAGES_PATH}`,
      what: "generateImage",
    });

    const images: string[] = [];
    const warnings: ImageModelV4Result["warnings"] = [];
    for (const entry of response.data) {
      if (entry.b64_json) {
        images.push(entry.b64_json);
      } else if (entry.url) {
        const bytes = await fetch(entry.url).then((r) => r.arrayBuffer());
        images.push(Buffer.from(bytes).toString("base64"));
      }
    }
    if (options.aspectRatio !== undefined) {
      // Ark sizes by pixels, not ratio. Say so rather than silently ignoring a
      // ratio the author set and then wondering why the frame is wrong.
      warnings.push({
        details: "Seedream sizes by pixels; set `size` instead",
        feature: "aspectRatio",
        type: "unsupported",
      });
    }
    return {
      images,
      response: {
        headers: undefined,
        modelId: this.modelId,
        timestamp: new Date(),
      },
      warnings,
    };
  }
}

export function resolveImageModel(modelId: string): ImageModelV4 {
  if (isGeminiModel(modelId)) {
    return createGoogleGenerativeAI({ apiKey: requireGeminiApiKey() }).image(
      modelId
    );
  }
  return new SeedreamImageModel(modelId);
}
