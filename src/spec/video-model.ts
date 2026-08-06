import type { ModelCapabilities, ProviderId } from "../models.js";
import type { PollOptions } from "../poll.js";
import type {
  ArkTask,
  AspectRatio,
  Resolution,
  ShotReference,
} from "../types.js";

/**
 * THE PROVIDER CONTRACT.
 *
 * Everything a command needs to generate video, and nothing about who is
 * generating it. See docs/adr/0001-video-provider-spec.md for why this shape
 * and what was deliberately left out of it.
 *
 * The rule this file exists to enforce: a command may depend on this module,
 * never on `src/providers/*`. What varies between providers is the wire body,
 * the auth, the status vocabulary, the error envelope, and the billing scheme.
 * All five live behind here.
 */

/**
 * Bumped when this interface changes shape.
 *
 * The single cheapest thing that makes a future breaking change tractable: a
 * `v5` adapter can be added beside `v4` and providers migrated one at a time,
 * instead of every provider having to change in one commit. It costs one
 * literal field and is the reason this is a spec rather than an interface.
 *
 * `v4` rather than `v1` because it tracks the AI SDK's own generation number.
 * `@ai-sdk/provider` ships `VideoModelV4` alongside the `ImageModelV4` that
 * src/images.ts already consumes, and the two describe the same thing; a port
 * that numbered itself independently would claim a compatibility relationship
 * it does not have. See docs/adr/0001 for what upstream does not cover and why
 * this port still exists.
 */
export const SPEC_VERSION = "v4" as const;
type SpecVersion = typeof SPEC_VERSION;

/**
 * One generation request, in provider-neutral terms.
 *
 * This is what callers construct. It deliberately is NOT a wire body: for most
 * of this codebase's life `CreateTaskRequest` was both the canonical internal
 * request and the BytePlus payload, which meant every caller was writing an
 * Ark body whether it knew it or not. Translating to the wire is the adapter's
 * job and happens in exactly one place per provider.
 */
export interface VideoModelV4CallOptions {
  /** Already composed: the film's preamble joined to the shot's prompt. */
  prompt: string;
  /**
   * References in AUTHORED ORDER, which is the ordinal contract every
   * `@Image N` binding depends on. Adapters must not reorder them.
   *
   * ONE array where upstream has two. `VideoModelV4CallOptions` splits the same
   * information into `frameImages` (role-tagged `first_frame`/`last_frame`) and
   * `inputReferences` (everything else), which loses the interleaving. That
   * interleaving IS the contract here: `@Image 2` counts images in authored
   * order across both groups, and a frame role consumes an ordinal like any
   * other image. Splitting them and rejoining would put the ordinals somewhere
   * the author did not write. `referenceOrdinals()` in src/payload.ts states
   * the rule; an adapter targeting upstream must re-derive both groups from
   * this array without reordering it.
   */
  references: readonly ShotReference[];
  /** Seconds. Named to match upstream, which also measures in seconds. */
  duration: number;
  aspectRatio: AspectRatio;
  /**
   * Undefined means "let the provider apply its own default", which is a
   * different fact from naming a resolution, and the two must stay
   * distinguishable all the way to the wire: an unsent field cannot be
   * rejected for being unknown.
   */
  resolution?: Resolution;
  seed?: number;
  generateAudio?: boolean;
  cameraFixed?: boolean;
  watermark?: boolean;
  /**
   * Non-portable, per-provider knobs, keyed by provider id. An adapter reads
   * its own key and ignores every other.
   *
   * This is what stops the neutral options above from growing into a union of
   * every vendor's quirks. A setting that is portable belongs as a field; one
   * that is not belongs here, namespaced, where adding it costs other
   * providers nothing.
   */
  providerOptions?: Partial<Record<ProviderId, Record<string, unknown>>>;
}

/**
 * A submitted generation, normalised.
 *
 * Currently structurally identical to `ArkTask` because Ark's vocabulary was
 * already the internal one. It is named separately so that stops being load
 * bearing: an adapter maps its provider's statuses and result fields onto
 * this, and no command learns that MiniMax nests its result under `task` and
 * calls the URL `content.url`.
 */
export type GeneratedVideoTask = ArkTask;

/**
 * One model, ready to call. Obtained from a provider, never constructed
 * directly by a command.
 *
 * `doStart`/`doStatus` are upstream's names for the asynchronous lifecycle,
 * and the shapes line up: upstream's `doStart` returns an opaque
 * JSON-serialisable `operation` handle and its `doStatus` reports
 * `pending | completed | error`. This port keeps the handle a plain string,
 * because `ManifestEntry.taskId` is a string that `vs status <task-id>` and the
 * `--json` key contract both depend on; widening it would be a manifest
 * migration for no gain while both providers key on an id. An adapter whose
 * provider hands back something richer serialises it into that string.
 */
export interface VideoModelV4 {
  readonly specificationVersion: SpecVersion;
  readonly provider: ProviderId;
  /** The id exactly as the caller supplied it, for the audit trail. */
  readonly modelId: string;
  /**
   * What this model accepts and how it bills. Registry data, so it is
   * available without a key or a network call, which is what keeps
   * `--dry-run` and cost estimation free.
   */
  readonly capabilities: ModelCapabilities;
  /**
   * The exact body that will be POSTed, for `--dry-run` and `payloadHash`.
   *
   * Pure and side-effect free, so `--dry-run` needs no key. It is what gets
   * hashed into the manifest, which is why an adapter may never reorder
   * content or inject a nondeterministic field: the hash is an audit record
   * and churning it silently invalidates every existing film's history.
   */
  toRequestBody: (options: VideoModelV4CallOptions) => unknown;
  doStart: (options: VideoModelV4CallOptions) => Promise<GeneratedVideoTask>;
  doStatus: (taskId: string) => Promise<GeneratedVideoTask>;
  /**
   * Poll to a terminal state. Kept beyond upstream's surface because resumption
   * here crosses process boundaries: `tasks.json` holds the id so a later run,
   * or a different machine, re-attaches to a task already paid for. Upstream's
   * polling lives inside one `generateVideo` call and cannot.
   */
  pollTask: (
    taskId: string,
    pollOptions: PollOptions
  ) => Promise<GeneratedVideoTask>;
}

/**
 * A credential that is resolved when a request is actually made, not when the
 * provider is constructed.
 *
 * A thunk rather than a string, and the reason is `--dry-run`: it builds a
 * model purely to call `toRequestBody`, which is pure and needs no auth.
 * Resolving the key eagerly made `vs generate --dry-run` fail with
 * "MINIMAX_API_KEY is not set" on a machine that was never going to send
 * anything, which defeats the point of a free preflight.
 */
export type ApiKeySource = string | (() => string);

export function resolveApiKey(source: ApiKeySource): string {
  return typeof source === "function" ? source() : source;
}

/**
 * A configured backend. Built by a factory (`createArk({apiKey})`) so a test
 * or `vs doctor` can construct one without reaching for globals, and so the
 * key is supplied once rather than per call.
 */
export interface ProviderV4 {
  readonly specificationVersion: SpecVersion;
  readonly providerId: ProviderId;
  videoModel: (modelId: string) => VideoModelV4;
}
