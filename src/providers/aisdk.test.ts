import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import type { VideoModelV4CallOptions } from "../spec/video-model.js";
import { createAiSdk } from "./aisdk.js";
import { aisdkFactory, resolveModelId } from "./registry.js";

const MODEL_ID = "aisdk:google/veo-3.1-fast-generate-preview";
const GATEWAY_ID = "bytedance/seedance-2.5";

function upstream(overrides: Record<string, unknown> = {}) {
  return {
    doStart: vi.fn(() =>
      Promise.resolve({
        operation: { name: "operations/abc", pollUrl: "https://x/1" },
        response: { headers: undefined, modelId: "veo", timestamp: new Date() },
        warnings: [],
      })
    ),
    doStatus: vi.fn(() =>
      Promise.resolve({
        response: { headers: undefined, modelId: "veo", timestamp: new Date() },
        status: "completed" as const,
        videos: [
          {
            mediaType: "video/mp4",
            type: "url" as const,
            url: "https://x/a.mp4",
          },
        ],
        warnings: [],
      })
    ),
    maxVideosPerCall: 1,
    modelId: "veo-3.1-fast-generate-preview",
    provider: "google",
    specificationVersion: "v4" as const,
    ...overrides,
  };
}

function model(overrides: Record<string, unknown> = {}) {
  return createAiSdk({
    model: () => upstream(overrides) as never,
    modelId: MODEL_ID,
  });
}

function options(
  overrides: Partial<VideoModelV4CallOptions> = {}
): VideoModelV4CallOptions {
  return {
    aspectRatio: "16:9",
    duration: 8,
    prompt: "a lighthouse",
    references: [],
    resolution: "720p",
    ...overrides,
  };
}

describe("the aisdk bridge renders generateVideo() arguments", () => {
  it("includes the model id and omits the padded SDK internals", () => {
    const body = model().toRequestBody(options());
    expect(body).toEqual({
      aspectRatio: "16:9",
      duration: 8,
      model: MODEL_ID,
      prompt: "a lighthouse",
      resolution: "1280x720",
    });
    expect(body).not.toHaveProperty("abortSignal");
    expect(body).not.toHaveProperty("fps");
    expect(body).not.toHaveProperty("headers");
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("n");
  });

  it("sends no ratio for `adaptive`, which has no fixed frame", () => {
    const body = model().toRequestBody(options({ aspectRatio: "adaptive" }));
    expect(body.aspectRatio).toBeUndefined();
  });

  it("splits frame roles from the other references without reordering", () => {
    const body = model().toRequestBody(
      options({
        references: [
          { role: "first_frame", type: "image", url: "https://a.png" },
          { role: "reference_image", type: "image", url: "https://b.png" },
          { role: "reference_image", type: "image", url: "https://c.png" },
          { role: "last_frame", type: "image", url: "https://d.png" },
        ],
      })
    );
    expect(body.frameImages).toEqual([
      { frameType: "first_frame", image: "https://a.png" },
      { frameType: "last_frame", image: "https://d.png" },
    ]);
    expect(body.inputReferences).toEqual(["https://b.png", "https://c.png"]);
  });

  it("unpacks an inlined local reference into a data URL", () => {
    const body = model().toRequestBody(
      options({
        references: [
          {
            role: "reference_image",
            type: "image",
            url: "data:image/png;base64,AAAA",
          },
        ],
      })
    );
    expect(body.inputReferences).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("turns 480p 16:9 into Gateway's 854x480, not BytePlus's 864x496", () => {
    expect(
      model().toRequestBody(options({ resolution: "480p" }))
    ).toMatchObject({
      resolution: "854x480",
    });
  });

  it("is pure, so --dry-run needs no key and the hash cannot drift", () => {
    const bridge = model();
    expect(JSON.stringify(bridge.toRequestBody(options()))).toBe(
      JSON.stringify(bridge.toRequestBody(options()))
    );
  });
});

describe("the aisdk bridge carries the task across processes", () => {
  it("serialises upstream's opaque handle into the manifest's string id", async () => {
    const task = await model().doStart(options());
    expect(JSON.parse(task.id)).toEqual({
      name: "operations/abc",
      pollUrl: "https://x/1",
    });
    expect(task.status).toBe("queued");
  });

  it("hands the same handle back on doStatus, which is what re-attach needs", async () => {
    const up = upstream();
    const bridge = createAiSdk({ model: () => up as never, modelId: MODEL_ID });
    const started = await bridge.doStart(options());
    const settled = await bridge.doStatus(started.id);

    expect(up.doStatus).toHaveBeenCalledWith({
      operation: { name: "operations/abc", pollUrl: "https://x/1" },
    });
    expect(settled).toMatchObject({
      content: { video_url: "https://x/a.mp4" },
      status: "succeeded",
    });
  });

  it("calls upstream doStart with file parts, not the public generateVideo body", async () => {
    const up = upstream();
    const bridge = createAiSdk({
      model: () => up as never,
      modelId: GATEWAY_ID,
    });
    await bridge.doStart(
      options({
        references: [
          { role: "reference_image", type: "image", url: "https://b.png" },
        ],
      })
    );
    expect(up.doStart).toHaveBeenCalledWith(
      expect.objectContaining({
        inputReferences: [
          { mediaType: "image/png", type: "url", url: "https://b.png" },
        ],
        n: 1,
        prompt: "a lighthouse",
      })
    );
  });

  it("maps an upstream error onto a failed task, not a thrown crash", async () => {
    const bridge = model({
      doStatus: vi.fn(() =>
        Promise.resolve({
          error: "safety filter",
          response: {
            headers: undefined,
            modelId: "veo",
            timestamp: new Date(),
          },
          status: "error" as const,
        })
      ),
    });
    await expect(bridge.doStatus('"op"')).resolves.toMatchObject({
      error: { message: "safety filter" },
      status: "failed",
    });
  });

  it("refuses a model that has no doStart rather than faking a task id", async () => {
    const bridge = model({
      doGenerate: vi.fn(),
      doStart: undefined,
      doStatus: undefined,
    });
    await expect(bridge.doStart(options())).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("persists a base64 result as bytes", async () => {
    const bridge = model({
      doStatus: vi.fn(() =>
        Promise.resolve({
          response: {
            headers: undefined,
            modelId: "veo",
            timestamp: new Date(),
          },
          status: "completed" as const,
          videos: [{ data: "AAAA", mediaType: "video/mp4", type: "base64" }],
          warnings: [],
        })
      ),
    });
    await expect(bridge.doStatus('"op"')).resolves.toMatchObject({
      content: { videoBytes: Buffer.from("AAAA", "base64") },
      status: "succeeded",
    });
  });

  it("persists a binary result as bytes", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const bridge = model({
      doStatus: vi.fn(() =>
        Promise.resolve({
          response: {
            headers: undefined,
            modelId: "veo",
            timestamp: new Date(),
          },
          status: "completed" as const,
          videos: [{ data: bytes, mediaType: "video/mp4", type: "binary" }],
          warnings: [],
        })
      ),
    });
    await expect(bridge.doStatus('"op"')).resolves.toMatchObject({
      content: { videoBytes: bytes },
      status: "succeeded",
    });
  });
});

describe("aisdk model ids", () => {
  it("routes an `aisdk:` prefix to the bridge", () => {
    expect(resolveModelId(MODEL_ID)).toEqual({
      modelId: "google/veo-3.1-fast-generate-preview",
      provider: "aisdk",
    });
  });

  it("routes the Gateway Seedance spelling without an aisdk: prefix", () => {
    expect(resolveModelId(GATEWAY_ID)).toEqual({
      modelId: GATEWAY_ID,
      provider: "aisdk",
    });
  });

  it("sends a bare google/veo id through the Gateway, not Gemini BYOK", () => {
    expect(aisdkFactory("google/veo-3.1-fast-generate-preview")).toBe(
      "gateway"
    );
    expect(aisdkFactory(MODEL_ID)).toBe("google");
    expect(aisdkFactory(GATEWAY_ID)).toBe("gateway");
  });

  it("puts Seedance camera and watermark knobs in providerOptions.bytedance", () => {
    const body = createAiSdk({
      model: () => upstream() as never,
      modelId: GATEWAY_ID,
    }).toRequestBody(options({ cameraFixed: true, watermark: false }));
    expect(body.providerOptions).toMatchObject({
      bytedance: { cameraFixed: true, watermark: false },
    });
  });

  it("prices a bridged model from the registry, with no key and no network", () => {
    // Veo Fast is per-second: 8s at $0.10 with audio included.
    expect(model().capabilities.billing.kind).toBe("perSecond");
    expect(model().capabilities.audio).toBe("always");
  });
});
