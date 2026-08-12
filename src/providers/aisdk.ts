import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type {
  Experimental_VideoModelV4 as AiVideoModel,
  Experimental_VideoModelV4CallOptions as AiCallOptions,
  Experimental_VideoModelV4File as AiFile,
  Experimental_VideoModelV4FrameImage as AiFrameImage,
  Experimental_VideoModelV4VideoData as AiVideoData,
  JSONValue,
} from "@ai-sdk/provider";
import { experimental_generateVideo as generateVideo } from "ai";

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
 * behind `@ai-sdk/google`, `@ai-sdk/fal`, `@ai-sdk/replicate` and friends
 * implements the same `VideoModelV4`, and this port already speaks that
 * dialect, so reaching Veo or Kling is a registry entry and a factory call
 * rather than a new directory.
 *
 * TWO THINGS ARE WEAKER HERE than in a hand-written adapter, and both are
 * deliberate rather than oversights:
 *
 * 1. `toRequestBody` renders the NORMALISED CALL OPTIONS, not the provider's
 *    HTTP body, because upstream offers no way to render a body without
 *    sending it. The result is still pure and byte-stable, so `--dry-run`
 *    works without a key and `payloadHash` still identifies what was asked
 *    for — but it is an audit record of the REQUEST, not of the wire. Films on
 *    Ark and MiniMax keep their literal-wire hashes untouched.
 * 2. Cost comes from the registry only. Upstream carries no billing model, so
 *    a bridged model with no registry entry quotes the dearest known rate.
 *
 * `generateVideo` from `ai` is the high-level call this adapter speaks. The
 * wait path still uses `doStart`/`doStatus` when the upstream model has them
 * (AI Gateway Seedance does), because `tasks.json` has to re-attach across
 * processes. `generateVideo` is the fallback for a model that only implements
 * `doGenerate`, and it cannot resume: there is no id until the bytes are back.
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
 * `adaptive` has no fixed frame, and upstream's type demands a literal ratio.
 * Sending nothing is the honest translation of "let the model choose".
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

/** `generateVideo`'s public API takes DataContent, not the v4 file part. */
function fileToDataContent(file: AiFile): string | Uint8Array {
  if (file.type === "url") {
    return file.url;
  }
  return typeof file.data === "string"
    ? `data:${file.mediaType};base64,${file.data}`
    : file.data;
}

/**
 * Seedance knobs that Ark sends as top-level body fields. On the Gateway they
 * ride in `providerOptions.bytedance`. Other bridged models (Veo) must not
 * grow a bytedance block — that would churn their `payloadHash`.
 */
function aisdkProviderOptions(
  modelId: string,
  options: VideoModelV4CallOptions
): AiCallOptions["providerOptions"] {
  const fromCaller = (options.providerOptions?.aisdk ?? {}) as Record<
    string,
    unknown
  >;
  if (!normalizeModelId(modelId).startsWith("seedance")) {
    return fromCaller as AiCallOptions["providerOptions"];
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
  return {
    ...fromCaller,
    ...(Object.keys(bytedance).length > 0 ? { bytedance } : {}),
  } as AiCallOptions["providerOptions"];
}

export interface AiSdkProviderConfig {
  /**
   * Builds the upstream model, e.g. `() => google.video("veo-3.1-...")`.
   *
   * A THUNK, not the model, for the same reason `ApiKeySource` is one: the
   * upstream factory reads its key eagerly, and `--dry-run` builds a model
   * purely to render a body. Passing the constructed model made
   * `vs generate --dry-run` and a `--max-cost` refusal both demand a
   * `GEMINI_API_KEY` on a machine that was never going to spend.
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
  /**
   * Bytes from a `generateVideo` / `doGenerate` fallback. That path has no
   * provider task id, so it cannot resume across processes; the cache lives
   * only for the rest of this poll loop.
   */
  private readonly completed = new Map<string, Uint8Array>();

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

  toRequestBody(options: VideoModelV4CallOptions): AiCallOptions {
    const { frameImages, inputReferences } = splitReferences(
      options.references
    );
    // Key order is fixed and every value is derived from the options, so the
    // hash is stable across runs. The `undefined` members satisfy upstream's
    // type and then vanish in JSON, so they hash identically to being absent —
    // which is what keeps a shot's hash unchanged when an unrelated optional
    // field is added here later.
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
      providerOptions: aisdkProviderOptions(this.modelId, options),
      resolution: wireResolution(options),
      seed: options.seed,
    };
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
    const body = this.toRequestBody(options);
    if (!start) {
      // Same call `generateVideo({ model: 'bytedance/seedance-2.5', prompt })`
      // makes. Used only when upstream has no doStart (doGenerate-only).
      // maxRetries is 0: a POST spends money, and this CLI never replays one.
      const { videos } = await generateVideo({
        aspectRatio: body.aspectRatio,
        duration: body.duration,
        frameImages: body.frameImages?.map((frame) => ({
          frameType: frame.frameType,
          image: fileToDataContent(frame.image),
        })),
        generateAudio: body.generateAudio,
        inputReferences: body.inputReferences?.map(fileToDataContent),
        maxRetries: 0,
        model,
        n: body.n,
        prompt: body.prompt ?? options.prompt,
        providerOptions: body.providerOptions,
        resolution: body.resolution,
        seed: body.seed,
      });
      const [first] = videos;
      if (first === undefined) {
        throw new VsError(
          "download_failed",
          `${this.modelId} returned no videos`,
          { hint: "check the prompt and references, then retry with --force" }
        );
      }
      const id = JSON.stringify({ aisdkCompleted: randomUUID() });
      this.completed.set(id, first.uint8Array);
      return { id, model: this.modelId, status: "queued" };
    }
    const result = await start.call(model, body as Parameters<typeof start>[0]);
    return {
      id: JSON.stringify(result.operation),
      model: this.modelId,
      status: "queued",
    };
  }

  async doStatus(taskId: string): Promise<GeneratedVideoTask> {
    const cached = this.completed.get(taskId);
    if (cached !== undefined) {
      this.completed.delete(taskId);
      return {
        content: { videoBytes: cached },
        id: taskId,
        status: "succeeded",
      };
    }
    const model = this.model();
    const status = model.doStatus;
    if (!status) {
      throw new VsError(
        "invalid_input",
        `${this.modelId} has no doStatus and task ${taskId} is not in the in-process cache`,
        {
          hint: "generateVideo-only models cannot resume across processes; re-run with --force to submit again",
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
 * createAiSdk({ model: google.video("veo-3.1-fast-generate-preview"),
 *               modelId: "aisdk:google/veo-3.1-fast-generate-preview" })
 * ```
 */
export function createAiSdk(config: AiSdkProviderConfig): VideoModelV4 {
  return new AiSdkVideoModel(config);
}
