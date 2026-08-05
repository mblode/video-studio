import { ArkClient } from "../ark.js";
import type { PollOptions } from "../ark.js";
import { lookupModel } from "../models.js";
import type { ModelCapabilities } from "../models.js";
import { resolveApiKey, SPEC_VERSION } from "../spec/video-model.js";
import type {
  ApiKeySource,
  GeneratedVideoTask,
  ProviderV1,
  VideoModelV1,
  VideoModelV1CallOptions,
} from "../spec/video-model.js";
import type {
  ArkContentItem,
  CreateTaskRequest,
  ShotReference,
} from "../types.js";

/**
 * BytePlus ModelArk (Seedance), as a `VideoModelV1`.
 *
 * This adapter is thin on purpose: Ark's task vocabulary IS the internal one,
 * because the internal one was derived from it. That is a historical accident,
 * not a design principle, and the second adapter is where it stops paying off.
 * Everything here that looks like a no-op (`toWireStatus`, the identity-ish
 * body translation) is the place a future Ark change lands without touching a
 * single command.
 */

/** One authored reference to one Ark content item. URLs are already resolved. */
function toContentItem(reference: ShotReference): ArkContentItem {
  const { role, url } = reference;
  if (reference.type === "image") {
    return { image_url: { url }, role, type: "image_url" };
  }
  if (reference.type === "video") {
    return { role, type: "video_url", video_url: { url } };
  }
  return { audio_url: { url }, role, type: "audio_url" };
}

class ArkVideoModel implements VideoModelV1 {
  readonly specificationVersion = SPEC_VERSION;
  readonly provider = "ark" as const;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;

  private readonly config: ArkProviderConfig;
  private client?: ArkClient;

  constructor(modelId: string, config: ArkProviderConfig) {
    this.modelId = modelId;
    this.capabilities = lookupModel(modelId);
    this.config = config;
  }

  /**
   * Built on first use, never in the constructor, so `--dry-run` can render a
   * body without a key. `resolveApiKey` is what throws when one is genuinely
   * needed, at the moment it is needed.
   */
  private clientOrCreate(): ArkClient {
    this.client ??= new ArkClient({
      apiKey: resolveApiKey(this.config.apiKey),
      baseUrl: this.config.baseUrl,
      ...(this.config.fetchImpl ? { fetchImpl: this.config.fetchImpl } : {}),
    });
    return this.client;
  }

  /**
   * The Ark create-task body.
   *
   * BYTE-FOR-BYTE what this CLI has always sent. `payloadHash` in every
   * existing film's manifest was computed over this exact JSON, and a manifest
   * is an audit record of a paid generation: reordering a key or emitting a
   * field that used to be omitted silently invalidates the lot. A pinned-hash
   * test guards it.
   *
   * Note `resolution` is emitted ONLY when the caller set one. The doc example
   * omits it, so an unconfigured film never risks an unknown-field reject, and
   * an unsent field cannot be rejected at all.
   */
  toRequestBody(options: VideoModelV1CallOptions): CreateTaskRequest {
    const content: ArkContentItem[] = [{ text: options.prompt, type: "text" }];
    for (const reference of options.references) {
      content.push(toContentItem(reference));
    }
    return {
      content,
      duration: options.durationSeconds,
      generate_audio: options.generateAudio ?? true,
      model: this.modelId,
      ratio: options.aspectRatio,
      watermark: options.watermark ?? false,
      ...(options.resolution ? { resolution: options.resolution } : {}),
      ...(options.cameraFixed ? { camera_fixed: true } : {}),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...options.providerOptions?.ark,
    };
  }

  createTask(options: VideoModelV1CallOptions): Promise<GeneratedVideoTask> {
    return this.clientOrCreate().createTask(this.toRequestBody(options));
  }

  getTask(taskId: string): Promise<GeneratedVideoTask> {
    return this.clientOrCreate().getTask(taskId);
  }

  pollTask(
    taskId: string,
    pollOptions: PollOptions
  ): Promise<GeneratedVideoTask> {
    return this.clientOrCreate().pollTask(taskId, pollOptions);
  }
}

export interface ArkProviderConfig {
  apiKey: ApiKeySource;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** Configure the Ark backend once; take models off it as needed. */
export function createArk(config: ArkProviderConfig): ProviderV1 {
  return {
    providerId: "ark",
    specificationVersion: SPEC_VERSION,
    videoModel: (modelId: string) => new ArkVideoModel(modelId, config),
  };
}
