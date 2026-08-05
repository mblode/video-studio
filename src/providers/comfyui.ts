import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import type { PollOptions } from "../ark.js";
import { VsError } from "../errors.js";
import { requestJson } from "../http.js";
import { lookupModel } from "../models.js";
import type { ModelCapabilities, ProviderId } from "../models.js";
import { SPEC_VERSION } from "../spec/video-model.js";
import type {
  GeneratedVideoTask,
  ProviderV1,
  VideoModelV1,
  VideoModelV1CallOptions,
} from "../spec/video-model.js";
import type { AspectRatio, Resolution, TaskStatus } from "../types.js";

const TRANSFORMER = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const TEXT_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
const VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors";
const AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";
const createResponseSchema = z.looseObject({ prompt_id: z.string().min(1) });
const outputFileSchema = z.looseObject({
  filename: z.string().min(1),
  subfolder: z.string().default(""),
  type: z.string().default("output"),
});
const historyEntrySchema = z.looseObject({
  outputs: z
    .record(
      z.string(),
      z.looseObject({ images: z.array(outputFileSchema).optional() })
    )
    .default({}),
  status: z.looseObject({
    completed: z.boolean(),
    status_str: z.string(),
  }),
});
const historyResponseSchema = z.record(z.string(), historyEntrySchema);
const queueResponseSchema = z.looseObject({
  queue_pending: z.array(z.array(z.unknown())).default([]),
  queue_running: z.array(z.array(z.unknown())).default([]),
});
const TERMINAL_STATUSES = new Set<TaskStatus>([
  "cancelled",
  "expired",
  "failed",
  "succeeded",
]);

interface Dimensions {
  height: number;
  width: number;
}

const DIMENSIONS: Record<"480p" | "768p", Record<AspectRatio, Dimensions>> = {
  "480p": {
    "16:9": { height: 352, width: 608 },
    "1:1": { height: 448, width: 448 },
    "21:9": { height: 288, width: 640 },
    "3:4": { height: 512, width: 384 },
    "4:3": { height: 384, width: 512 },
    "9:16": { height: 608, width: 352 },
    adaptive: { height: 352, width: 608 },
  },
  "768p": {
    "16:9": { height: 768, width: 1344 },
    "1:1": { height: 768, width: 768 },
    "21:9": { height: 576, width: 1344 },
    "3:4": { height: 1024, width: 768 },
    "4:3": { height: 768, width: 1024 },
    "9:16": { height: 1344, width: 768 },
    adaptive: { height: 768, width: 1344 },
  },
};

function dimensionsFor(
  resolution: Resolution | undefined,
  ratio: AspectRatio
): Dimensions {
  const tier = resolution ?? "480p";
  if (tier !== "480p" && tier !== "768p") {
    throw new VsError(
      "invalid_input",
      `local MiniMax H3 does not support ${tier}`,
      { hint: "use 480p for the low-memory path or 768p for the native canvas" }
    );
  }
  return DIMENSIONS[tier][ratio];
}

/** Snap seconds to H3's required 17k+5 frame grid at 24 fps. */
function frameLength(seconds: number): number {
  const frames = Math.max(5, Math.round(seconds * 24));
  return frames + ((5 - (frames % 17) + 17) % 17);
}

function workflow(
  options: VideoModelV1CallOptions
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  if (options.references.length > 0) {
    throw new VsError(
      "invalid_input",
      "the local ComfyUI H3 adapter currently supports text-to-video only",
      {
        hint: "remove references or use hosted MiniMax-H3; local reference inputs need a ComfyUI asset-upload layer",
      }
    );
  }
  const { height, width } = dimensionsFor(
    options.resolution,
    options.aspectRatio
  );
  // Numeric ComfyUI node ids are ordered by graph flow, not lexicographically.
  // oxlint-disable-next-line eslint/sort-keys
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: TRANSFORMER, weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: TEXT_ENCODER,
        device: "default",
        type: "minimax",
      },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
    "4": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },
    "5": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["2", 0],
        height,
        length: frameLength(options.durationSeconds),
        prompt: options.prompt,
        vae: ["3", 0],
        width,
      },
    },
    "6": {
      class_type: "RandomNoise",
      inputs: { noise_seed: options.seed ?? 0 },
    },
    "7": {
      class_type: "BasicGuider",
      inputs: { conditioning: ["5", 0], model: ["1", 0] },
    },
    "8": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "res_multistep" },
    },
    "9": {
      class_type: "BasicScheduler",
      inputs: {
        denoise: 1,
        model: ["1", 0],
        scheduler: "simple",
        steps: 20,
      },
    },
    "10": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        guider: ["7", 0],
        latent_image: ["5", 1],
        noise: ["6", 0],
        sampler: ["8", 0],
        sigmas: ["9", 0],
      },
    },
    "11": {
      class_type: "VAEDecode",
      inputs: { samples: ["10", 0], vae: ["3", 0] },
    },
    "12": {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["10", 0], vae: ["4", 0] },
    },
    "13": {
      class_type: "CreateVideo",
      inputs: { audio: ["12", 0], bit_depth: 8, fps: 24, images: ["11", 0] },
    },
    "14": {
      class_type: "SaveVideo",
      inputs: {
        codec: "auto",
        filename_prefix: "video/video_studio_h3",
        format: "mp4",
        video: ["13", 0],
      },
    },
  };
}

class ComfyUIVideoModel implements VideoModelV1 {
  readonly specificationVersion = SPEC_VERSION;
  readonly provider: ProviderId = "comfyui";
  readonly capabilities: ModelCapabilities;
  readonly modelId: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(modelId: string, config: Required<ComfyUIProviderConfig>) {
    this.modelId = modelId;
    this.capabilities = lookupModel(modelId);
    this.base = config.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = config.fetchImpl;
  }

  toRequestBody(options: VideoModelV1CallOptions): Record<string, unknown> {
    if (this.modelId !== "MiniMax-H3-Local") {
      throw new VsError(
        "invalid_input",
        `unsupported local model ${this.modelId}`
      );
    }
    return { client_id: "video-studio", prompt: workflow(options) };
  }

  async createTask(
    options: VideoModelV1CallOptions
  ): Promise<GeneratedVideoTask> {
    const { prompt_id } = await requestJson({
      body: this.toRequestBody(options),
      fetchImpl: this.fetchImpl,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      provider: "ComfyUI",
      schema: createResponseSchema,
      url: `${this.base}/prompt`,
      what: "createTask",
    });
    return { id: prompt_id, model: this.modelId, status: "queued" };
  }

  async getTask(taskId: string): Promise<GeneratedVideoTask> {
    const history = await requestJson({
      fetchImpl: this.fetchImpl,
      headers: {},
      method: "GET",
      provider: "ComfyUI",
      schema: historyResponseSchema,
      url: `${this.base}/history/${encodeURIComponent(taskId)}`,
      what: "getTask",
    });
    const entry = history[taskId];
    if (!entry) {
      const queue = await requestJson({
        fetchImpl: this.fetchImpl,
        headers: {},
        method: "GET",
        provider: "ComfyUI",
        schema: queueResponseSchema,
        url: `${this.base}/queue`,
        what: "getQueue",
      });
      const running = queue.queue_running.some((item) => item[1] === taskId);
      return { id: taskId, status: running ? "running" : "queued" };
    }
    const file = Object.values(entry.outputs)
      .flatMap((output) => output.images ?? [])
      .find((candidate) => candidate.filename.toLowerCase().endsWith(".mp4"));
    if (
      entry.status.completed &&
      entry.status.status_str === "success" &&
      file
    ) {
      const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder,
        type: file.type,
      });
      return {
        content: { video_url: `${this.base}/view?${query.toString()}` },
        id: taskId,
        status: "succeeded",
      };
    }
    if (entry.status.status_str === "error") {
      return {
        error: { message: "ComfyUI execution failed" },
        id: taskId,
        status: "failed",
      };
    }
    if (entry.status.completed) {
      return {
        error: { message: "ComfyUI completed without an MP4 output" },
        id: taskId,
        status: "failed",
      };
    }
    return { id: taskId, status: "running" };
  }

  pollTask(
    taskId: string,
    pollOptions: PollOptions
  ): Promise<GeneratedVideoTask> {
    return this.pollUntilTerminal(taskId, pollOptions);
  }

  private async pollUntilTerminal(
    taskId: string,
    pollOptions: PollOptions
  ): Promise<GeneratedVideoTask> {
    const deadline = Date.now() + pollOptions.timeoutMs;
    for (;;) {
      if (Date.now() > deadline) {
        throw new VsError("timeout", `local ComfyUI task ${taskId} timed out`, {
          hint: "the task remains in ComfyUI; increase --timeout to keep waiting rather than submitting it again",
        });
      }
      const task = await this.getTask(taskId);
      await pollOptions.onUpdate?.(task);
      if (TERMINAL_STATUSES.has(task.status)) {
        return task;
      }
      await sleep(pollOptions.intervalMs);
    }
  }
}

export interface ComfyUIProviderConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export function createComfyUI(config: ComfyUIProviderConfig): ProviderV1 {
  const resolved: Required<ComfyUIProviderConfig> = {
    ...config,
    fetchImpl: config.fetchImpl ?? fetch,
  };
  return {
    providerId: "comfyui",
    specificationVersion: SPEC_VERSION,
    videoModel: (modelId: string) => new ComfyUIVideoModel(modelId, resolved),
  };
}
