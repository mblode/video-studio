import type {
  Experimental_VideoModelV4 as AiVideoModel,
  Experimental_VideoModelV4CallOptions as AiCallOptions,
  Experimental_VideoModelV4File as AiFile,
  Experimental_VideoModelV4FrameImage as AiFrameImage,
  Experimental_VideoModelV4VideoData as AiVideoData,
  JSONValue,
} from "@ai-sdk/provider";

import { frameSize } from "../cost.js";
import { VsError } from "../errors.js";
import { lookupModel } from "../models.js";
import type { ModelCapabilities } from "../models.js";
import { pollUntilTerminal } from "../poll.js";
import type { PollOptions } from "../poll.js";
import { SPEC_VERSION } from "../spec/video-model.js";
import type {
  GeneratedVideoTask,
  VideoModelV4,
  VideoModelV4CallOptions,
} from "../spec/video-model.js";
import { ASPECT_RATIO_VALUE } from "../types.js";
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
 */

/** Upstream's `${number}x${number}`, derived from our resolution + ratio pair. */
function wireResolution(
  options: VideoModelV4CallOptions
): `${number}x${number}` | undefined {
  if (!options.resolution) {
    return;
  }
  const { height, width } = frameSize(options.resolution, options.aspectRatio);
  return `${width}x${height}`;
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

/**
 * By the time a reference reaches the spec, `buildCallOptions` has already
 * inlined any local file as a data URL, so there are exactly two shapes here.
 */
function toFile(reference: ShotReference): AiFile {
  const match = DATA_URL.exec(reference.url);
  const groups = match?.groups;
  if (groups?.data === undefined || groups.mediaType === undefined) {
    return { type: "url", url: reference.url };
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

/** Only a URL result can be handed to the existing download path. */
function videoUrl(videos: readonly AiVideoData[]): string {
  const [first] = videos;
  if (first?.type === "url") {
    return first.url;
  }
  throw new VsError(
    "download_failed",
    `the provider returned the video as ${first?.type ?? "nothing"} rather than a URL`,
    {
      hint: "this bridge persists URL results only; open an issue with the model id so the inline-bytes path can be added",
    }
  );
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

  // Needs no instance state, unlike Ark's and MiniMax's, because the model id
  // is bound into the upstream model rather than sent in the body. It stays an
  // instance method because `VideoModelV4` declares it as one.
  // oxlint-disable-next-line eslint/class-methods-use-this
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
      providerOptions: (options.providerOptions?.aisdk ??
        {}) as AiCallOptions["providerOptions"],
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
    if (!start) {
      throw new VsError(
        "invalid_input",
        `${this.modelId} does not support asynchronous starts`,
        {
          hint: "this CLI resumes paid generations across processes, which needs the model's doStart/doStatus pair; pick a model that implements them",
        }
      );
    }
    const result = await start.call(
      model,
      this.toRequestBody(options) as Parameters<typeof start>[0]
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
        `${this.modelId} does not support status polling`,
        { hint: "pick a model that implements doStart/doStatus" }
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
        content: { video_url: videoUrl(result.videos) },
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
