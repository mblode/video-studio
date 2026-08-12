import { Buffer } from "node:buffer";

import type {
  Experimental_VideoModelV4 as AiVideoModel,
  Experimental_VideoModelV4CallOptions as AiCallOptions,
  Experimental_VideoModelV4File as AiFile,
  Experimental_VideoModelV4FrameImage as AiFrameImage,
  Experimental_VideoModelV4VideoData as AiVideoData,
  JSONValue,
} from "@ai-sdk/provider";

import { VsError } from "../errors.js";
import { lookupModel, normalizeModelId } from "../models.js";
import type { ModelCapabilities } from "../models.js";
import { pollUntilTerminal } from "../poll.js";
import type { PollOptions } from "../poll.js";
import { SPEC_VERSION } from "../spec/video-model.js";
import type {
  GeneratedVideoTask,
  VideoModelV4,
  VideoModelV4CallOptions,
} from "../spec/video-model.js";
import { ASPECT_RATIO_VALUE, RESOLUTION_SHORT_SIDE } from "../types.js";
import type { AspectRatio, ShotReference, TaskStatus } from "../types.js";

/**
 * The bridge to the AI SDK's own video models.
 *
 * ONE adapter for a whole family, rather than one per vendor. Every model
 * behind `@ai-sdk/gateway`, `@ai-sdk/google`, and friends implements the same
 * `VideoModelV4`, and this port already speaks that dialect, so reaching
 * Seedance 2.5 or Veo is a registry entry and a factory call rather than a
 * new directory.
 *
 * `toRequestBody` is the public `generateVideo({ model, prompt, duration, ... })`
 * argument list, JSON-serialisable, so `--dry-run` prints what an author would
 * write and `payloadHash` identifies that request. It is still an audit of the
 * REQUEST, not of the HTTP body: upstream offers no way to render a body
 * without sending it. Ark and MiniMax keep their literal-wire hashes.
 *
 * The wait path is `doStart`/`doStatus`. `generateVideo` polls inside one call
 * and swallows the operation id, so `tasks.json` could not re-attach across
 * processes; it also drops `inputReferences` when `frameImages` are set, which
 * would silently unbind mixed first-frame + ordinal packs. A model that has
 * no `doStart` is refused rather than faked: there is no persistable id.
 *
 * Cost comes from the registry only. Upstream carries no billing model, so a
 * bridged model with no registry entry quotes the dearest known rate.
 */

/**
 * Upstream's `${number}x${number}`. Derived from the short-side pin, not from
 * `frameSize`, because that function carries BytePlus-observed sizes (480p
 * 16:9 is 864x496 there). AI Gateway Seedance documents 854x480 / 1280x720,
 * which is `ceil(short × ratio)` without the macroblock round-up.
 */
function wireResolution(
  options: VideoModelV4CallOptions
): `${number}x${number}` | undefined {
  if (!options.resolution) {
    return;
  }
  const short = RESOLUTION_SHORT_SIDE[options.resolution];
  const ratio = ASPECT_RATIO_VALUE[options.aspectRatio];
  if (ratio === undefined) {
    return;
  }
  return ratio >= 1
    ? `${Math.ceil(short * ratio)}x${short}`
    : `${short}x${Math.ceil(short / ratio)}`;
}

/**
 * `adaptive` has no fixed frame, and sending nothing is the honest translation
 * of "let the model choose" — the same as generateVideo's undefined default.
 */
function wireAspectRatio(
  ratio: AspectRatio
): `${number}:${number}` | undefined {
  return ASPECT_RATIO_VALUE[ratio] === undefined
    ? undefined
    : (ratio as `${number}:${number}`);
}

const DATA_URL = /^data:(?<mediaType>[^;,]+)(?<base64>;base64)?,(?<data>.*)$/su;

/** Fallback when a remote URL has no usable extension. Gateway warns if omitted. */
const MEDIA_BY_TYPE: Record<string, string> = {
  audio: "audio/mpeg",
  image: "image/png",
  video: "video/mp4",
};

const MEDIA_BY_EXT: Record<string, string> = {
  ".aac": "audio/aac",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function mediaTypeOf(reference: ShotReference): string {
  const path = reference.url.split("?")[0] ?? reference.url;
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return (
    MEDIA_BY_EXT[ext] ??
    MEDIA_BY_TYPE[reference.type] ??
    "application/octet-stream"
  );
}

/**
 * By the time a reference reaches the spec, `buildCallOptions` has already
 * inlined any local file as a data URL, so there are exactly two shapes here.
 */
function toFile(reference: ShotReference): AiFile {
  const match = DATA_URL.exec(reference.url);
  const groups = match?.groups;
  if (groups?.data === undefined || groups.mediaType === undefined) {
    return {
      mediaType: mediaTypeOf(reference),
      type: "url",
      url: reference.url,
    };
  }
  return {
    data: groups.data,
    mediaType: groups.mediaType,
    type: "file",
  };
}

/** generateVideo's `DataContent`: a URL, or a data URL for inlined bytes. */
function toDataContent(file: AiFile): string {
  if (file.type === "url") {
    return file.url;
  }
  const bytes =
    typeof file.data === "string"
      ? file.data
      : Buffer.from(file.data).toString("base64");
  return `data:${file.mediaType};base64,${bytes}`;
}

/**
 * Split one authored array into upstream's two, WITHOUT reordering either.
 *
 * The single array is this port's ordinal contract: `@Image 2` counts images in
 * authored order and a frame role consumes an ordinal like any other image.
 * Filtering preserves relative order within each group, which is all upstream
 * can represent; a provider that renumbers across the two groups will bind
 * differently, which is why `lintOrdinalBinding` warns rather than promising.
 */
const FRAME_TYPES: Record<string, AiFrameImage["frameType"] | undefined> = {
  first_frame: "first_frame",
  last_frame: "last_frame",
};

function splitReferences(references: readonly ShotReference[]): {
  frameImages: AiFrameImage[];
  inputReferences: AiFile[];
} {
  const frameImages: AiFrameImage[] = [];
  const inputReferences: AiFile[] = [];
  for (const reference of references) {
    // `ReferenceRole` is deliberately open (`string & {}`) so the registry can
    // name roles this CLI has no constant for, which means a `===` test does
    // not narrow to upstream's closed `frameType`. Look it up instead.
    const frameType = FRAME_TYPES[reference.role];
    if (frameType) {
      frameImages.push({ frameType, image: toFile(reference) });
    } else {
      inputReferences.push(toFile(reference));
    }
  }
  return { frameImages, inputReferences };
}

/**
 * Persist whatever shape upstream handed back. Gateway Seedance may return a
 * URL, base64, or binary; `vs generate` writes the file immediately because
 * result URLs expire.
 */
function videoContent(videos: readonly AiVideoData[]): {
  video_url?: string;
  videoBytes?: Uint8Array;
} {
  const [first] = videos;
  if (first?.type === "url" && first.url.length > 0) {
    return { video_url: first.url };
  }
  if (first?.type === "base64" && first.data.length > 0) {
    return { videoBytes: Buffer.from(first.data, "base64") };
  }
  if (first?.type === "binary" && first.data.byteLength > 0) {
    return { videoBytes: first.data };
  }
  throw new VsError(
    "download_failed",
    `the provider returned the video as ${first?.type ?? "nothing"} with no bytes or URL`,
    {
      hint: "vs generate persists the result immediately because result URLs expire; open an issue with the model id if this shape is new",
    }
  );
}

/**
 * Seedance knobs that Ark sends as top-level body fields. On the Gateway they
 * ride in `providerOptions.bytedance`. Other bridged models (Veo) must not
 * grow a bytedance block — that would churn their `payloadHash`.
 */
function aisdkProviderOptions(
  modelId: string,
  options: VideoModelV4CallOptions
): Record<string, unknown> | undefined {
  const fromCaller = (options.providerOptions?.aisdk ?? {}) as Record<
    string,
    unknown
  >;
  if (!normalizeModelId(modelId).startsWith("seedance")) {
    return Object.keys(fromCaller).length > 0 ? fromCaller : undefined;
  }
  const existing =
    typeof fromCaller.bytedance === "object" && fromCaller.bytedance !== null
      ? (fromCaller.bytedance as Record<string, unknown>)
      : {};
  const bytedance = {
    ...existing,
    ...(options.cameraFixed === undefined
      ? {}
      : { cameraFixed: options.cameraFixed }),
    ...(options.watermark === undefined
      ? {}
      : { watermark: options.watermark }),
  };
  const result = {
    ...fromCaller,
    ...(Object.keys(bytedance).length > 0 ? { bytedance } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * The public generateVideo() argument list. Key order is fixed and every
 * value is derived from the options, so the hash is stable across runs.
 * Fields generateVideo would leave undefined are omitted, not padded.
 */
function toGenerateVideoArgs(
  modelId: string,
  options: VideoModelV4CallOptions
): Record<string, unknown> {
  const { frameImages, inputReferences } = splitReferences(options.references);
  const body: Record<string, unknown> = {
    model: modelId,
    prompt: options.prompt,
  };
  if (options.duration !== undefined) {
    body.duration = options.duration;
  }
  const aspectRatio = wireAspectRatio(options.aspectRatio);
  if (aspectRatio !== undefined) {
    body.aspectRatio = aspectRatio;
  }
  const resolution = wireResolution(options);
  if (resolution !== undefined) {
    body.resolution = resolution;
  }
  if (options.generateAudio !== undefined) {
    body.generateAudio = options.generateAudio;
  }
  if (options.seed !== undefined) {
    body.seed = options.seed;
  }
  const providerOptions = aisdkProviderOptions(modelId, options);
  if (providerOptions !== undefined) {
    body.providerOptions = providerOptions;
  }
  if (frameImages.length > 0) {
    body.frameImages = frameImages.map((frame) => ({
      frameType: frame.frameType,
      image: toDataContent(frame.image),
    }));
  }
  if (inputReferences.length > 0) {
    body.inputReferences = inputReferences.map(toDataContent);
  }
  return body;
}

/**
 * What upstream.doStart actually consumes: the v4 call options, with File
 * parts so a local reference stays binary rather than a data-URL string.
 */
function toUpstreamCallOptions(
  modelId: string,
  options: VideoModelV4CallOptions
): AiCallOptions {
  const { frameImages, inputReferences } = splitReferences(options.references);
  return {
    abortSignal: undefined,
    aspectRatio: wireAspectRatio(options.aspectRatio),
    duration: options.duration,
    fps: undefined,
    frameImages: frameImages.length > 0 ? frameImages : undefined,
    generateAudio: options.generateAudio,
    headers: undefined,
    image: undefined,
    inputReferences: inputReferences.length > 0 ? inputReferences : undefined,
    n: 1,
    prompt: options.prompt,
    providerOptions: (aisdkProviderOptions(modelId, options) ??
      {}) as AiCallOptions["providerOptions"],
    resolution: wireResolution(options),
    seed: options.seed,
  };
}

export interface AiSdkProviderConfig {
  /**
   * Builds the upstream model, e.g. `() => gateway.video("bytedance/seedance-2.5")`.
   *
   * A THUNK, not the model, for the same reason `ApiKeySource` is one: the
   * upstream factory reads its key eagerly, and `--dry-run` builds a model
   * purely to render a body. Passing the constructed model made
   * `vs generate --dry-run` and a `--max-cost` refusal both demand a
   * key on a machine that was never going to spend.
   */
  model: () => AiVideoModel;
  /** The id as the caller wrote it, prefix included, for the audit trail. */
  modelId: string;
}

class AiSdkVideoModel implements VideoModelV4 {
  readonly specificationVersion = SPEC_VERSION;
  readonly provider = "aisdk" as const;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;

  private readonly createModel: () => AiVideoModel;
  private upstream?: AiVideoModel;

  constructor(config: AiSdkProviderConfig) {
    this.modelId = config.modelId;
    this.capabilities = lookupModel(config.modelId);
    this.createModel = config.model;
  }

  /** Built on first use, never in the constructor. See `AiSdkProviderConfig`. */
  private model(): AiVideoModel {
    this.upstream ??= this.createModel();
    return this.upstream;
  }

  toRequestBody(options: VideoModelV4CallOptions): Record<string, unknown> {
    return toGenerateVideoArgs(this.modelId, options);
  }

  /**
   * Upstream's handle is an opaque `JSONValue`; the manifest stores a string.
   * Serialising it here is what keeps `ManifestEntry.taskId`, `vs status
   * <task-id>` and the `--json` contract unchanged for two providers that
   * genuinely have string ids.
   */
  async doStart(options: VideoModelV4CallOptions): Promise<GeneratedVideoTask> {
    const model = this.model();
    const start = model.doStart;
    if (!start) {
      throw new VsError(
        "invalid_input",
        `${this.modelId} does not implement doStart/doStatus`,
        {
          hint: "vs generate persists a task id so a later run can re-attach; a doGenerate-only model cannot. Use a Gateway catalog id (bytedance/seedance-2.5) or an Ark/MiniMax model",
        }
      );
    }
    const result = await start.call(
      model,
      toUpstreamCallOptions(this.modelId, options)
    );
    return {
      id: JSON.stringify(result.operation),
      model: this.modelId,
      status: "queued",
    };
  }

  async doStatus(taskId: string): Promise<GeneratedVideoTask> {
    const model = this.model();
    const status = model.doStatus;
    if (!status) {
      throw new VsError(
        "invalid_input",
        `${this.modelId} does not implement doStatus`,
        {
          hint: "vs generate resumes by task id; this model has no status handle to re-attach to",
        }
      );
    }
    let operation: JSONValue;
    try {
      operation = JSON.parse(taskId) as JSONValue;
    } catch (error) {
      throw new VsError(
        "invalid_input",
        `task id ${taskId} is not a handle this provider issued`,
        { cause: error, hint: "check the manifest was not hand-edited" }
      );
    }
    const result = await status.call(model, { operation });
    if (result.status === "error") {
      return {
        error: { message: result.error },
        id: taskId,
        status: "failed" satisfies TaskStatus,
      };
    }
    if (result.status === "completed") {
      return {
        content: videoContent(result.videos),
        id: taskId,
        status: "succeeded",
      };
    }
    return { id: taskId, status: "running" };
  }

  pollTask(
    taskId: string,
    pollOptions: PollOptions
  ): Promise<GeneratedVideoTask> {
    return pollUntilTerminal({
      options: pollOptions,
      provider: this.modelId,
      read: (id) => this.doStatus(id),
      taskId,
    });
  }
}

/**
 * Wrap an upstream model. The caller supplies the configured model, so this
 * file never learns which vendor or key is behind it:
 *
 * ```ts
 * createAiSdk({ model: () => gateway.video("bytedance/seedance-2.5"),
 *               modelId: "bytedance/seedance-2.5" })
 * ```
 */
export function createAiSdk(config: AiSdkProviderConfig): VideoModelV4 {
  return new AiSdkVideoModel(config);
}
