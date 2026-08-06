import { describe, expect, it, vi } from "vitest";

import { isVsError } from "../errors.js";
import type { VideoModelV4CallOptions } from "../spec/video-model.js";
import { createMinimax } from "./minimax.js";

const H3 = "MiniMax-H3";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function model(fetchImpl: typeof fetch) {
  return createMinimax({
    apiKey: "test-key",
    baseUrl: "https://api.minimax.io",
    fetchImpl,
  }).videoModel(H3);
}

function callOptions(
  overrides: Partial<VideoModelV4CallOptions> = {}
): VideoModelV4CallOptions {
  return {
    aspectRatio: "16:9",
    duration: 6,
    prompt: "a lighthouse in a storm",
    references: [],
    resolution: "2k",
    ...overrides,
  };
}

describe("H3 wire body", () => {
  it("uppercases the resolution to the spelling the API publishes", () => {
    const body = model(vi.fn()).toRequestBody(callOptions());
    expect(body.resolution).toBe("2K");
    expect(
      model(vi.fn()).toRequestBody(callOptions({ resolution: "768p" }))
        .resolution
    ).toBe("768P");
  });

  it("omits resolution entirely when nothing set one", () => {
    const body = model(vi.fn()).toRequestBody(
      callOptions({ resolution: undefined })
    );
    expect("resolution" in body).toBe(false);
  });

  it("drops every field H3 does not document", () => {
    // An unknown field risks a 400 (2013 invalid params), so these are dropped
    // rather than passed through. They are all meaningful on Ark, which is
    // exactly why a shared body would be wrong.
    const body = model(vi.fn()).toRequestBody(
      callOptions({
        cameraFixed: true,
        generateAudio: false,
        seed: 42,
        watermark: true,
      })
    );
    expect(Object.keys(body).toSorted()).toEqual([
      "content",
      "duration",
      "model",
      "ratio",
      "resolution",
    ]);
  });

  it("keeps references in authored order, so @Image N still resolves", () => {
    const body = model(vi.fn()).toRequestBody(
      callOptions({
        references: [
          { role: "reference_video", type: "video", url: "https://v/1.mp4" },
          { role: "reference_image", type: "image", url: "https://i/1.png" },
          { role: "reference_image", type: "image", url: "https://i/2.png" },
        ],
      })
    );
    const content = body.content as Record<string, unknown>[];
    // Text first, then authored order. `@Image 1` is the SECOND array entry,
    // because ordinals count per media type.
    expect(content.map((item) => item.type)).toEqual([
      "text",
      "video_url",
      "image_url",
      "image_url",
    ]);
  });

  it("rounds a fractional duration, which the API requires to be an integer", () => {
    const body = model(vi.fn()).toRequestBody(callOptions({ duration: 6.4 }));
    expect(body.duration).toBe(6);
  });

  it("passes provider-specific knobs through, and only its own", () => {
    const body = model(vi.fn()).toRequestBody(
      callOptions({
        providerOptions: {
          ark: { camera_fixed: true },
          minimax: { callback_url: "https://hook.test" },
        },
      })
    );
    expect(body.callback_url).toBe("https://hook.test");
    expect("camera_fixed" in body).toBe(false);
  });
});

describe("H3 responses", () => {
  it("reads the id out of task_id and reports it queued", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ task_id: "t-1" }))
    );
    const task = await model(fetchImpl as unknown as typeof fetch).doStart(
      callOptions()
    );
    expect(task).toEqual({ id: "t-1", model: H3, status: "queued" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.minimax.io/v2/video_generation");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key"
    );
  });

  it("unwraps the nested task and renames content.url", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          task: {
            content: { url: "https://cdn/out.mp4" },
            status: "succeeded",
          },
        })
      )
    );
    const task = await model(fetchImpl as unknown as typeof fetch).doStatus(
      "t-1"
    );
    expect(task.content?.video_url).toBe("https://cdn/out.mp4");
    expect(task.status).toBe("succeeded");
    // No usage block, deliberately: H3 bills per second and reports none, so
    // synthesising one would put a token count in the manifest nobody paid.
    expect(task.usage).toBeUndefined();
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.minimax.io/v2/query/video_generation/t-1");
  });

  it("maps the older capitalised status spellings too", async () => {
    for (const [wire, expected] of [
      ["Success", "succeeded"],
      ["Fail", "failed"],
      ["Queueing", "queued"],
      ["Processing", "running"],
    ] as const) {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse({ task: { status: wire } }))
      );
      const task = await model(fetchImpl as unknown as typeof fetch).doStatus(
        "t"
      );
      expect(task.status).toBe(expected);
    }
  });

  it("treats an UNKNOWN status as still running, never as terminal", async () => {
    // Calling an unrecognised status terminal would abandon a task that has
    // already been billed. Erring the other way just polls once more.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ task: { status: "some_new_state" } }))
    );
    const task = await model(fetchImpl as unknown as typeof fetch).doStatus(
      "t"
    );
    expect(task.status).toBe("running");
  });
});

describe("H3 errors name the cause, which the raw message does not", () => {
  it("points a 1004 at the region, not just the key", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { message: "not authorized (1004)" } }, 401)
      )
    );
    const failure = await model(fetchImpl as unknown as typeof fetch)
      .doStatus("t")
      .catch((error: unknown) => error);
    expect(isVsError(failure)).toBe(true);
    expect((failure as { hint?: string }).hint).toMatch(/region/u);
  });

  it("points a 2013 at the dry-run and the mode rules", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { message: "invalid params (2013)" } }, 400)
      )
    );
    const failure = await model(fetchImpl as unknown as typeof fetch)
      .doStart(callOptions())
      .catch((error: unknown) => error);
    expect(isVsError(failure)).toBe(true);
    expect((failure as { hint?: string }).hint).toMatch(/--dry-run/u);
  });

  it("does not retry a 4xx, because retrying costs money", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { message: "bad" } }, 400))
    );
    await model(fetchImpl as unknown as typeof fetch)
      .doStart(callOptions())
      .catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
