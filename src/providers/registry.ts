import { lookupModel } from "../models.js";
import type { ProviderId } from "../models.js";

/**
 * Which backend a model id belongs to.
 *
 * Spellings, in priority order:
 *
 * 1. **Explicit prefix** — `minimax:MiniMax-H3`, `aisdk:google/veo-...`.
 *    Wins outright.
 * 2. **AI Gateway spelling** — `vendor/model` with a slash and no colon,
 *    e.g. `bytedance/seedance-2.5`. This is the id `generateVideo` takes.
 *    A bare `google/veo-...` is this spelling too, not Gemini BYOK.
 * 3. **Registry lookup** — the `provider` field on the model's entry, with
 *    BytePlus vendor prefixes (`dreamina-`, `doubao-`, `dola-`) forced to
 *    Ark so a 2.5 family whose canonical transport is Gateway still POSTs
 *    a dreamina id to ModelArk.
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
 * `aisdk:` routes to the bridge in `src/providers/aisdk.ts`. The id AFTER the
 * prefix names the upstream provider and model together, e.g.
 * `aisdk:google/veo-3.1-fast-generate-preview` (Gemini BYOK). A slash-shaped
 * id without a prefix (`bytedance/seedance-2.5`) is the Gateway catalog: no
 * extra `aisdk:` needed. A bare `aisdk:veo-3.1` is not a catalog id.
 */
export interface ResolvedModelId {
  provider: ProviderId;
  /** The id to send on the wire, with any `provider:` prefix stripped. */
  modelId: string;
}

const PROVIDER_PREFIXES: readonly ProviderId[] = ["aisdk", "ark", "minimax"];

/**
 * Which upstream factory the aisdk adapter should call.
 *
 * A slash-shaped id is the AI Gateway catalog (`bytedance/seedance-2.5`,
 * `google/veo-3.1-fast-generate-preview`). Gemini BYOK is the explicit
 * `aisdk:google/` prefix, so a bare `google/veo-...` does not steal a
 * Gateway catalog entry.
 */
export function aisdkFactory(configured: string): "google" | "gateway" {
  return /^aisdk:google\//iu.test(configured) ? "google" : "gateway";
}

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
