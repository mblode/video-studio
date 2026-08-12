import { lookupModel } from "../models.js";
import type { ProviderId } from "../models.js";

/**
 * Which backend a model id belongs to.
 *
 * Two spellings, in priority order:
 *
 * 1. **Explicit prefix** — `minimax:MiniMax-H3`. Wins outright.
 * 2. **AI Gateway spelling** — `vendor/model` with a slash and no colon,
 *    e.g. `bytedance/seedance-2.5`. This is the id `generateVideo` takes.
 * 3. **Registry lookup** — the `provider` field on the model's entry.
 *
 * An unrecognised bare id falls through to the registry's permissive Ark
 * fallback, which is the historical behaviour and right for a Seedance release
 * this file has not learned yet. It is also exactly why the prefix exists: a
 * MiniMax model id the registry has never seen would otherwise be POSTed to
 * BytePlus and come back as a baffling 4xx. `minimax:` lets an author name the
 * backend for a model this codebase does not know about, which is the same
 * "the API is the authority, the registry is advisory" stance src/models.ts
 * already takes about capabilities.
 *
 * `aisdk:` is the same idea one level up. It routes to the bridge in
 * `src/providers/aisdk.ts`, and the id AFTER the prefix names the upstream
 * provider and model together, e.g. `aisdk:google/veo-3.1-fast-generate-preview`.
 * That second segment is what `createVideoModel` splits on to pick the
 * `@ai-sdk/*` package, so a bare `aisdk:veo-3.1` is not resolvable and says so.
 * A slash-shaped id without a prefix (`bytedance/seedance-2.5`) is the same
 * route: AI Gateway, no extra `aisdk:` needed.
 */
export interface ResolvedModelId {
  provider: ProviderId;
  /** The id to send on the wire, with any `provider:` prefix stripped. */
  modelId: string;
}

const PROVIDER_PREFIXES: readonly ProviderId[] = ["aisdk", "ark", "minimax"];

export function resolveModelId(configured: string): ResolvedModelId {
  const separator = configured.indexOf(":");
  if (separator > 0) {
    const prefix = configured.slice(0, separator).toLowerCase();
    const provider = PROVIDER_PREFIXES.find((known) => known === prefix);
    if (provider) {
      return { modelId: configured.slice(separator + 1), provider };
    }
    // An unknown prefix is far more likely to be part of the id itself than a
    // typo'd provider, so it is left alone rather than rejected. The registry
    // gets the whole string, unchanged.
  }
  // `bytedance/seedance-2.5` is the generateVideo / AI Gateway spelling. A
  // slash with no colon is never a BytePlus ModelArk id, so it must not fall
  // through to the registry's ark default.
  if (configured.includes("/") && !configured.includes(":")) {
    return { modelId: configured, provider: "aisdk" };
  }
  return { modelId: configured, provider: lookupModel(configured).provider };
}
