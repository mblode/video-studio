import { requestWithRetry } from "./http.js";

/**
 * A thin `generateContent` client for Google's REST API.
 *
 * This used to be a hand-rolled Nano Banana image client: a request-body
 * builder, an inline-image extractor, base64 decoding, and local-file inlining.
 * All of it is gone, because `generateImage` from the AI SDK speaks the same
 * API through a maintained provider (see src/images.ts) and had been carrying
 * the note that it was "built but not yet smoke-tested" the whole time.
 *
 * What survives is the one thing the AI SDK has no model for: **Lyria music**
 * (`vs score`), which is a `generateContent` call like any other. A 50-line
 * passthrough for it is cheaper than a second dependency, and far cheaper than
 * keeping an image client nothing calls.
 */

/** Name used in error messages, e.g. "Gemini API 429: ...". */
const PROVIDER = "Gemini";

/** Historical name for the shared provider error; same class, not a subclass. */
export { ApiError as GeminiApiError } from "./http.js";

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

  /** Raw `generateContent`; the caller owns the body for its modality. */
  async generateContent(model: string, body: unknown): Promise<unknown> {
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
