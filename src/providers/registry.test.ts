import { describe, expect, it } from "vitest";

import { MODEL_IDS } from "../models.js";
import { resolveModelId } from "./registry.js";

/**
 * Routing is the one thing that fails silently and expensively: a model id sent
 * to the wrong backend does not read as a routing bug, it reads as a baffling
 * 4xx from a provider you were not trying to use.
 */
describe("resolveModelId", () => {
  it("routes a bare id through the registry", () => {
    expect(resolveModelId(MODEL_IDS.seedance25)).toEqual({
      modelId: MODEL_IDS.seedance25,
      provider: "ark",
    });
    expect(resolveModelId(MODEL_IDS.minimaxH3)).toEqual({
      modelId: MODEL_IDS.minimaxH3,
      provider: "minimax",
    });
  });

  it("strips an explicit provider prefix from the wire id", () => {
    // The prefix is addressed to this CLI, not to the provider. Leaving it on
    // would send `minimax:MiniMax-H3` as the model name and 400.
    expect(resolveModelId("minimax:MiniMax-H3")).toEqual({
      modelId: "MiniMax-H3",
      provider: "minimax",
    });
  });

  it("lets an explicit prefix override what the registry would infer", () => {
    // The whole reason the prefix exists: an id this repo has never seen falls
    // back to Ark, so without a way to say otherwise a new MiniMax model would
    // be POSTed to BytePlus.
    const unknown = "some-h4-model-released-next-year";
    expect(resolveModelId(unknown).provider).toBe("ark");
    expect(resolveModelId(`minimax:${unknown}`)).toEqual({
      modelId: unknown,
      provider: "minimax",
    });
  });

  it("is case-insensitive about the prefix but not the id", () => {
    expect(resolveModelId("MiniMax:MiniMax-H3")).toEqual({
      modelId: "MiniMax-H3",
      provider: "minimax",
    });
  });

  it("leaves an unrecognised prefix alone rather than guessing", () => {
    // A colon is likelier to be part of the id than a typo'd provider, so the
    // whole string goes to the registry untouched.
    const id = "vendor:some-model";
    expect(resolveModelId(id)).toEqual({ modelId: id, provider: "ark" });
  });

  it("resolves a prefixed id to the same capabilities as a bare one", () => {
    // `normalizeModelId` has to strip the prefix too. If it did not, a prefixed
    // id would miss its registry entry and fall through to the permissive
    // fallback — which for a per-second model means a $0.00 quote.
    expect(resolveModelId("minimax:MiniMax-H3").provider).toBe("minimax");
  });
});
