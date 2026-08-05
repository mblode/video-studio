import { describe, expect, it, vi } from "vitest";

import { GeminiApiError, GeminiClient } from "./gemini.js";

/**
 * What is left of this client after image generation moved to the AI SDK: a
 * `generateContent` passthrough, kept for Lyria music (`vs score`), which has
 * no AI SDK model.
 */
describe("GeminiClient.generateContent", () => {
  const base = "https://generativelanguage.googleapis.com/v1beta";

  function clientWith(fetchImpl: unknown): GeminiClient {
    return new GeminiClient({
      apiKey: "k",
      baseUrl: base,
      fetchImpl: fetchImpl as typeof fetch,
    });
  }

  it("posts the caller's body to the model endpoint with the key header", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ ok: true })));

    const json = await clientWith(fetchImpl).generateContent("lyria-002", {
      prompt: "score",
    });

    expect(json).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${base}/models/lyria-002:generateContent`);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "k"
    );
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "score" });
  });

  it("throws GeminiApiError immediately on 4xx without retrying", async () => {
    // Retrying a 4xx cannot succeed and costs money on a generation endpoint.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 400 }))
    );

    await expect(
      clientWith(fetchImpl).generateContent("lyria-002", {})
    ).rejects.toBeInstanceOf(GeminiApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
