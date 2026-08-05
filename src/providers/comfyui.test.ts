import { describe, expect, it, vi } from "vitest";

import type {
  GeneratedVideoTask,
  VideoModelV1CallOptions,
} from "../spec/video-model.js";
import { createComfyUI } from "./comfyui.js";

function callOptions(
  overrides: Partial<VideoModelV1CallOptions> = {}
): VideoModelV1CallOptions {
  return {
    aspectRatio: "16:9",
    durationSeconds: 5,
    prompt: "a fox walks through a forest",
    references: [],
    resolution: "480p",
    seed: 42,
    ...overrides,
  };
}

describe("local H3 ComfyUI workflow", () => {
  it("builds a deterministic low-memory T2V graph", () => {
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
    }).videoModel("MiniMax-H3-Local");

    const body = model.toRequestBody(callOptions()) as {
      client_id: string;
      prompt: Record<
        string,
        { class_type: string; inputs: Record<string, unknown> }
      >;
    };

    expect(body.client_id).toBe("video-studio");
    expect(body.prompt["1"]?.inputs).toMatchObject({
      unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    });
    expect(body.prompt["5"]?.inputs).toMatchObject({
      height: 352,
      length: 124,
      prompt: "a fox walks through a forest",
      width: 608,
    });
    expect(body.prompt["6"]?.inputs.noise_seed).toBe(42);
    expect(body.prompt["14"]?.class_type).toBe("SaveVideo");
  });

  it("snaps four seconds upward to H3's 17k+5 frame grid", () => {
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
    }).videoModel("MiniMax-H3-Local");
    const body = model.toRequestBody(callOptions({ durationSeconds: 4 })) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(body.prompt["5"]?.inputs.length).toBe(107);
  });

  it("rejects references before submitting a graph", () => {
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
    }).videoModel("MiniMax-H3-Local");
    expect(() =>
      model.toRequestBody(
        callOptions({
          references: [
            {
              role: "first_frame",
              type: "image",
              url: "https://example.com/keyframe.png",
            },
          ],
        })
      )
    ).toThrow(/text-to-video only/u);
  });

  it("submits the graph to ComfyUI and returns its prompt id", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ node_errors: {}, prompt_id: "p-1" }))
    );
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).videoModel("MiniMax-H3-Local");

    await expect(model.createTask(callOptions())).resolves.toEqual({
      id: "p-1",
      model: "MiniMax-H3-Local",
      status: "queued",
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8188/prompt");
    expect(init.method).toBe("POST");
  });

  it("maps a completed animated output to a downloadable video URL", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          "p-1": {
            outputs: {
              "14": {
                animated: [true],
                images: [
                  {
                    filename: "video_studio_h3_00001_.mp4",
                    subfolder: "video",
                    type: "output",
                  },
                ],
              },
            },
            status: { completed: true, status_str: "success" },
          },
        })
      )
    );
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).videoModel("MiniMax-H3-Local");

    await expect(model.getTask("p-1")).resolves.toEqual({
      content: {
        video_url:
          "http://127.0.0.1:8188/view?filename=video_studio_h3_00001_.mp4&subfolder=video&type=output",
      },
      id: "p-1",
      status: "succeeded",
    });
  });

  it("reports an active ComfyUI queue item as running", async () => {
    const fetchImpl = vi
      .fn((_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(
          Response.json({
            queue_pending: [],
            queue_running: [[1, "p-1", {}, {}, []]],
          })
        )
      )
      .mockResolvedValueOnce(Response.json({}));
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).videoModel("MiniMax-H3-Local");

    await expect(model.getTask("p-1")).resolves.toMatchObject({
      id: "p-1",
      status: "running",
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8188/queue");
  });

  it("polls until ComfyUI records a terminal history entry", async () => {
    const running = Response.json({
      "p-1": {
        outputs: {},
        status: { completed: false, status_str: "running" },
      },
    });
    const succeeded = Response.json({
      "p-1": {
        outputs: {
          "14": {
            images: [
              { filename: "done.mp4", subfolder: "video", type: "output" },
            ],
          },
        },
        status: { completed: true, status_str: "success" },
      },
    });
    const fetchImpl = vi
      .fn((_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(succeeded.clone())
      )
      .mockResolvedValueOnce(running);
    const seen: string[] = [];
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).videoModel("MiniMax-H3-Local");

    const task = await model.pollTask("p-1", {
      intervalMs: 0,
      onUpdate: (update: GeneratedVideoTask) => {
        seen.push(update.status);
      },
      timeoutMs: 100,
    });
    expect(seen).toEqual(["running", "succeeded"]);
    expect(task.status).toBe("succeeded");
  });

  it("treats a ComfyUI execution error as terminal failure", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          "p-1": {
            outputs: {},
            status: { completed: false, status_str: "error" },
          },
        })
      )
    );
    const model = createComfyUI({
      baseUrl: "http://127.0.0.1:8188",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).videoModel("MiniMax-H3-Local");

    await expect(model.getTask("p-1")).resolves.toMatchObject({
      error: { message: "ComfyUI execution failed" },
      status: "failed",
    });
  });
});
