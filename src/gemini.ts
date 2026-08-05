import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { requestWithRetry } from "./http.js";
import { safeJoin } from "./paths.js";

/**
 * Nano Banana (Google Gemini native image generation) as an alternative stills
 * backend to BytePlus Seedream. goldy's keyframe workflow makes the literal
 * board in Nano Banana Pro, so a film can set `model` to a `gemini-*` id and
 * `vs stills` will route here instead of the Ark image API.
 *
 * Wire shape (REST): POST {base}/models/{model}:generateContent with the
 * `x-goog-api-key` header; the image comes back as base64 in
 * candidates[0].content.parts[].inlineData. Confirm against the live API once a
 * GEMINI_API_KEY with credit is available — this is built but not yet smoke-tested.
 */

/** Name used in error messages, e.g. "Gemini API 429: ...". */
const PROVIDER = "Gemini";

/** Nano Banana 2 — the high-efficiency Gemini 3.1 Flash Image model. */
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
/** Nano Banana Pro — the professional-asset Gemini 3 Pro Image model. */
export const GEMINI_PRO_IMAGE_MODEL = "gemini-3-pro-image";

const MIME_BY_EXT: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** A `gemini-*` model id routes stills to Nano Banana rather than Seedream. */
export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

export interface GeminiInlineImage {
  mimeType: string;
  /** base64-encoded image bytes. */
  data: string;
}

export interface GeminiImageRequest {
  model: string;
  prompt: string;
  /** Reference images, already resolved to inline base64. */
  images?: GeminiInlineImage[];
  /** Output aspect ratio, e.g. "16:9". Omitted → the model's default (1:1). */
  aspectRatio?: string;
  /** Output resolution tier: "1K" | "2K" | "4K" (uppercase). Omitted → 1K. */
  imageSize?: string;
}

/** Historical name for the shared provider error; same class, not a subclass. */
export { ApiError as GeminiApiError } from "./http.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function guessMime(url: string): string {
  return MIME_BY_EXT[extname(url).toLowerCase()] ?? "image/png";
}

/** The `generateContent` request body for a single image generation. */
export function buildGeminiRequestBody(request: GeminiImageRequest): unknown {
  const parts: unknown[] = [{ text: request.prompt }];
  for (const image of request.images ?? []) {
    parts.push({
      inlineData: { data: image.data, mimeType: image.mimeType },
    });
  }
  // imageConfig (aspectRatio/imageSize) is the REST shape for Gemini 3 image
  // generation; without an aspectRatio the model returns a 1:1 square, which
  // would distort a 16:9 keyframe used as a Seedance first_frame.
  const imageConfig: Record<string, string> = {};
  if (request.aspectRatio) {
    imageConfig.aspectRatio = request.aspectRatio;
  }
  if (request.imageSize) {
    imageConfig.imageSize = request.imageSize;
  }
  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    },
  };
}

/**
 * Pull the first real (non-thought) inline image out of a generateContent
 * response. Handles both camelCase (`inlineData`) and snake_case
 * (`inline_data`) shapes, and surfaces any returned text (often a safety
 * refusal) in the error when no image is present.
 */
export function extractInlineImage(json: unknown): GeminiInlineImage {
  const candidates = asRecord(json)?.candidates;
  const first = Array.isArray(candidates) ? asRecord(candidates[0]) : undefined;
  const parts = asRecord(first?.content)?.parts;
  if (!Array.isArray(parts)) {
    throw new TypeError("Gemini response had no candidates[0].content.parts");
  }
  const texts: string[] = [];
  for (const raw of parts) {
    const part = asRecord(raw);
    if (!part || part.thought === true) {
      continue;
    }
    if (typeof part.text === "string") {
      texts.push(part.text);
    }
    const inline = asRecord(part.inlineData) ?? asRecord(part.inline_data);
    const data = inline?.data;
    if (typeof data === "string" && data.length > 0) {
      const mime = inline?.mimeType ?? inline?.mime_type;
      return { data, mimeType: typeof mime === "string" ? mime : "image/png" };
    }
  }
  const text = texts.join(" ").trim();
  throw new Error(`Gemini returned no image${text ? `: ${text}` : ""}`);
}

/** Resolve a still reference (local path or https URL) to an inline base64 image. */
export async function resolveInlineImage(
  url: string,
  baseDir: string,
  fetchImpl: typeof fetch = fetch
): Promise<GeminiInlineImage> {
  if (url.startsWith("https://")) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`failed to fetch reference ${url}: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? guessMime(url);
    return { data: bytes.toString("base64"), mimeType };
  }
  const absolute = safeJoin(baseDir, url);
  const mimeType = MIME_BY_EXT[extname(absolute).toLowerCase()];
  if (!mimeType) {
    throw new Error(
      `unsupported reference extension for ${url} (use png/jpg/webp)`
    );
  }
  const bytes = await readFile(absolute);
  return { data: bytes.toString("base64"), mimeType };
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.base = options.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Generate one image, returning the decoded PNG/JPEG bytes. */
  async generateImage(request: GeminiImageRequest): Promise<Buffer> {
    const json = await this.request(
      request.model,
      buildGeminiRequestBody(request)
    );
    const image = extractInlineImage(json);
    return Buffer.from(image.data, "base64");
  }

  /**
   * Raw `generateContent` for non-image modalities (e.g. Lyria music). Retries
   * follow the same 429/5xx policy as `generateImage`.
   */
  async generateContent(model: string, body: unknown): Promise<unknown> {
    return await this.request(model, body);
  }

  /** Transport, retry, and backoff all come from the shared policy. */
  private async request(model: string, body: unknown): Promise<unknown> {
    const response = await requestWithRetry({
      body,
      fetchImpl: this.fetchImpl,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      method: "POST",
      provider: PROVIDER,
      url: `${this.base}/models/${encodeURIComponent(model)}:generateContent`,
    });
    return await response.json();
  }
}
