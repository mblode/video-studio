import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildGeminiRequestBody,
  extractInlineImage,
  GeminiApiError,
  GeminiClient,
  isGeminiModel,
  resolveInlineImage,
} from "./gemini.js";

function imageResponse(text: string): Response {
  return Response.json({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: Buffer.from(text).toString("base64"),
                mimeType: "image/png",
              },
            },
          ],
        },
      },
    ],
  });
}

describe("isGeminiModel", () => {
  it("routes gemini-* models to Nano Banana, others to Seedream", () => {
    expect(isGeminiModel("gemini-3.1-flash-image")).toBe(true);
    expect(isGeminiModel("gemini-3-pro-image")).toBe(true);
    expect(isGeminiModel("seedream-5-0-260128")).toBe(false);
  });
});

describe("buildGeminiRequestBody", () => {
  it("packs the prompt and inline images into one content part", () => {
    const body = buildGeminiRequestBody({
      images: [{ data: "AAAA", mimeType: "image/png" }],
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
    });
    expect(body).toEqual({
      contents: [
        {
          parts: [
            { text: "a cat" },
            { inlineData: { data: "AAAA", mimeType: "image/png" } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"] },
    });
  });

  it("emits imageConfig only when aspectRatio/imageSize are set", () => {
    const plain = buildGeminiRequestBody({
      model: "gemini-3-pro-image",
      prompt: "a cat",
    }) as { generationConfig: Record<string, unknown> };
    expect(plain.generationConfig.imageConfig).toBeUndefined();

    const sized = buildGeminiRequestBody({
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "gemini-3-pro-image",
      prompt: "a cat",
    }) as { generationConfig: Record<string, unknown> };
    expect(sized.generationConfig.imageConfig).toEqual({
      aspectRatio: "16:9",
      imageSize: "2K",
    });
  });
});

describe("extractInlineImage", () => {
  it("reads camelCase inlineData", () => {
    const image = extractInlineImage({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "Zm9v", mimeType: "image/png" } }],
          },
        },
      ],
    });
    expect(image).toEqual({ data: "Zm9v", mimeType: "image/png" });
  });

  it("skips thought parts and reads snake_case inline_data", () => {
    const image = extractInlineImage({
      candidates: [
        {
          content: {
            parts: [
              {
                inline_data: { data: "THOUGHT", mime_type: "image/png" },
                thought: true,
              },
              { inline_data: { data: "Zm9v", mime_type: "image/jpeg" } },
            ],
          },
        },
      ],
    });
    expect(image).toEqual({ data: "Zm9v", mimeType: "image/jpeg" });
  });

  it("surfaces returned text when no image is present", () => {
    expect(() =>
      extractInlineImage({
        candidates: [{ content: { parts: [{ text: "blocked by safety" }] } }],
      })
    ).toThrow(/blocked by safety/u);
  });

  it("throws when the response has no parts", () => {
    expect(() => extractInlineImage({})).toThrow(/no candidates/u);
  });
});

describe("GeminiClient.generateImage", () => {
  it("posts to the model endpoint and decodes the returned image", async () => {
    let calledUrl = "";
    const fetchImpl = ((url: string) => {
      calledUrl = String(url);
      return Promise.resolve(imageResponse("hello"));
    }) as unknown as typeof fetch;
    const client = new GeminiClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1beta",
      fetchImpl,
    });
    const bytes = await client.generateImage({
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
    });
    expect(bytes.toString()).toBe("hello");
    expect(calledUrl).toContain(
      "/models/gemini-3.1-flash-image:generateContent"
    );
  });

  it("throws GeminiApiError immediately on 4xx without retrying", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(new Response("bad request", { status: 400 }));
    }) as unknown as typeof fetch;
    const client = new GeminiClient({
      apiKey: "k",
      baseUrl: "https://example.com/v1beta",
      fetchImpl,
    });
    await expect(
      client.generateImage({ model: "gemini-3.1-flash-image", prompt: "x" })
    ).rejects.toBeInstanceOf(GeminiApiError);
    expect(calls).toBe(1);
  });
});

describe("resolveInlineImage", () => {
  it("base64-encodes an https reference using the response content-type", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(Buffer.from("imgdata"), {
          headers: { "content-type": "image/jpeg" },
          status: 200,
        })
      )) as unknown as typeof fetch;
    const image = await resolveInlineImage(
      "https://example.com/x.jpg",
      "/tmp",
      fetchImpl
    );
    expect(image.mimeType).toBe("image/jpeg");
    expect(Buffer.from(image.data, "base64").toString()).toBe("imgdata");
  });

  it("throws when an https reference fails to fetch", async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("nope", { status: 404 })
      )) as unknown as typeof fetch;
    await expect(
      resolveInlineImage("https://example.com/x.png", "/tmp", fetchImpl)
    ).rejects.toThrow(/failed to fetch/u);
  });

  it("reads and base64-encodes a local image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-gemini-"));
    await writeFile(join(dir, "k.png"), Buffer.from("localpng"));
    const image = await resolveInlineImage("./k.png", dir);
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data, "base64").toString()).toBe("localpng");
  });

  it("rejects an unsupported local extension", async () => {
    await expect(resolveInlineImage("./k.gif", "/tmp")).rejects.toThrow(
      /unsupported reference extension/u
    );
  });
});
