import { generateImage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  isGeminiModel,
  resolveImageModel,
  seedreamProviderOptions,
} from "./images.js";

const SEEDREAM = "seedream-5-0-260128";
const NANO_BANANA = "gemini-3.1-flash-image";

describe("isGeminiModel", () => {
  it("routes gemini-* to Google and everything else to Seedream", () => {
    expect(isGeminiModel(NANO_BANANA)).toBe(true);
    expect(isGeminiModel("gemini-3-pro-image")).toBe(true);
    expect(isGeminiModel(SEEDREAM)).toBe(false);
    expect(isGeminiModel("GEMINI-3-PRO-IMAGE")).toBe(true);
  });
});

/**
 * THE RISK THIS MIGRATION TAKES.
 *
 * Seedream used to have a bespoke client that built the Ark body by hand. It
 * now goes through the `openai-compatible` provider, which is only correct
 * because Ark's image endpoint happens to be OpenAI-shaped. That "happens to
 * be" is the whole bet, so it is asserted against the real outgoing request
 * rather than assumed: the previous client is deleted and nothing else would
 * notice if the body drifted.
 */
describe("the Seedream wire body still matches what Ark accepts", () => {
  async function captureRequest(
    call: (model: ReturnType<typeof resolveImageModel>) => Promise<unknown>
  ): Promise<{ body: Record<string, unknown>; url: string }> {
    process.env.ARK_API_KEY = "test-key";
    let captured: { body: Record<string, unknown>; url: string } | undefined;
    const fetchImpl = vi.fn((input: unknown, init: RequestInit) => {
      captured = {
        body: JSON.parse(init.body as string) as Record<string, unknown>,
        url: String(input),
      };
      return Promise.resolve(
        Response.json({
          data: [{ b64_json: Buffer.from("png").toString("base64") }],
        })
      );
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      await call(resolveImageModel(SEEDREAM));
    } finally {
      globalThis.fetch = original;
    }
    if (!captured) {
      throw new Error("no request was made");
    }
    return captured;
  }

  it("posts to Ark's documented images path with the model and prompt", async () => {
    const { body, url } = await captureRequest((model) =>
      generateImage({ model, prompt: "a lighthouse in a storm" })
    );

    // CONFIRMED path from the Ark docs; the base URL already carries /api/v3.
    expect(url).toContain("/images/generations");
    expect(body.model).toBe(SEEDREAM);
    expect(body.prompt).toBe("a lighthouse in a storm");
  });

  it("carries seed, size, and the non-OpenAI Ark fields", async () => {
    const { body } = await captureRequest((model) =>
      generateImage({
        model,
        prompt: "p",
        providerOptions: seedreamProviderOptions(),
        seed: 42,
        size: "2048x1152",
      })
    );

    expect(body.seed).toBe(42);
    expect(body.size).toBe("2048x1152");
    // The watermark default burns a logo into a keyframe the whole film then
    // inherits, so losing this is a silent, expensive regression.
    expect(body.watermark).toBe(false);
    expect(body.sequential_image_generation).toBe("disabled");
  });

  it("sends reference images, which is what stills exist for", async () => {
    // Keyframe boards bind a character's likeness by reference. If the SDK
    // dropped these, every still would silently lose its likeness and read as
    // a model failure rather than a wiring one.
    const { body } = await captureRequest((model) =>
      generateImage({
        model,
        prompt: { images: [new Uint8Array([1, 2, 3])], text: "her face" },
      })
    );

    expect(JSON.stringify(body)).toContain("her face");
    expect(Object.keys(body)).toContain("image");
  });
});
