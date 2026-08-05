import { describe, expect, it } from "vitest";

import {
  isKnownModel,
  lookupModel,
  MODEL_IDS,
  MODEL_REGISTRY,
  modelRateLimits,
  normalizeModelId,
  usdPerMToken,
  validateShotAgainstModel,
} from "./models.js";

describe("normalizeModelId", () => {
  it("strips every observed vendor prefix and the release stamp", () => {
    // The same three models ship under four different prefixes, so nothing
    // downstream may key off one.
    expect(normalizeModelId("dreamina-seedance-2-0-260128")).toBe(
      "seedance-2-0"
    );
    expect(normalizeModelId("doubao-seedance-2-0-260128")).toBe("seedance-2-0");
    expect(normalizeModelId("seedance-1-5-pro-251215")).toBe(
      "seedance-1-5-pro"
    );
    expect(normalizeModelId("dreamina-seedance-2-0-fast-260128")).toBe(
      "seedance-2-0-fast"
    );
  });

  it("accepts the console's dotted, capitalised spelling", () => {
    expect(normalizeModelId("Dreamina-Seedance-2.0-fast")).toBe(
      "seedance-2-0-fast"
    );
  });
});

describe("lookupModel", () => {
  it("resolves the same entry for the BytePlus and Volcengine ids", () => {
    const byteplus = lookupModel("dreamina-seedance-2-0-260128");
    const volcengine = lookupModel("doubao-seedance-2-0-260128");
    expect(byteplus.family).toBe(volcengine.family);
    expect(byteplus.known).toBe(true);
    expect(byteplus.resolutions).toContain("4k");
  });

  it("caps fast and mini at 720p", () => {
    expect(
      lookupModel("dreamina-seedance-2-0-fast-260128").resolutions
    ).toEqual(["480p", "720p"]);
    expect(
      lookupModel("dreamina-seedance-2-0-mini-260615").resolutions
    ).toEqual(["480p", "720p"]);
  });

  it("falls back permissively for an unknown id instead of throwing", () => {
    const unknown = lookupModel("seedance-9-9-ultra-991231");
    expect(unknown.known).toBe(false);
    expect(unknown.resolutions).toContain("4k");
    expect(unknown.durations).toMatchObject({ kind: "range", min: 1 });
    expect(isKnownModel("seedance-9-9-ultra-991231")).toBe(false);
  });

  it("falls back for an undefined id (no model configured)", () => {
    expect(lookupModel().known).toBe(false);
  });

  it("models local H3 as a zero-provider-cost, single-concurrency backend", () => {
    const local = lookupModel("comfyui:MiniMax-H3-Local");
    expect(local).toMatchObject({
      known: true,
      limits: { concurrency: 1 },
      provider: "comfyui",
      resolutions: ["480p", "768p"],
    });
    expect(local.billing).toMatchObject({
      kind: "perSecond",
      usdPerSecondByResolution: { "480p": 0, "768p": 0 },
    });
  });
});

describe("modelRateLimits", () => {
  it("applies the 4K throttle, which is a single concurrent task", () => {
    const model = "dreamina-seedance-2-0-260128";
    expect(modelRateLimits(model, "1080p")).toEqual({
      concurrency: 3,
      rpm: 180,
    });
    expect(modelRateLimits(model, "4k")).toEqual({ concurrency: 1, rpm: 15 });
  });
});

describe("usdPerMToken", () => {
  it("quotes the dearest known rate for an unpriced resolution", () => {
    // fast publishes no 4K rate because it cannot render 4K; quoting 0 would
    // make an impossible request look free.
    const fast = lookupModel("dreamina-seedance-2-0-fast-260128");
    expect(usdPerMToken(fast, "4k")).toBe(usdPerMToken(fast, "720p"));
  });

  it("prices fast below standard", () => {
    expect(
      usdPerMToken(lookupModel("dreamina-seedance-2-0-fast-260128"), "720p")
    ).toBeLessThan(
      usdPerMToken(lookupModel("dreamina-seedance-2-0-260128"), "720p")
    );
  });
});

describe("validateShotAgainstModel", () => {
  const standard = "dreamina-seedance-2-0-260128";

  it("passes a shot inside the model's envelope", () => {
    expect(
      validateShotAgainstModel(standard, {
        duration: 10,
        ratio: "16:9",
        references: [{ role: "first_frame" }],
        resolution: "720p",
      })
    ).toEqual([]);
  });

  it("rejects 1080p on the fast model and names what is supported", () => {
    const problems = validateShotAgainstModel(
      "dreamina-seedance-2-0-fast-260128",
      { resolution: "1080p" }
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("resolution");
    expect(problems[0]?.severity).toBe("error");
    expect(problems[0]?.message).toContain("480p, 720p");
  });

  it("flags a duration outside the model's range but allows -1 auto", () => {
    expect(validateShotAgainstModel(standard, { duration: 30 })).toMatchObject([
      { field: "duration" },
    ]);
    expect(validateShotAgainstModel(standard, { duration: 2 })).toHaveLength(1);
    expect(validateShotAgainstModel(standard, { duration: -1 })).toEqual([]);
  });

  it("flags too many references of one role", () => {
    const problems = validateShotAgainstModel(standard, {
      references: [{ role: "first_frame" }, { role: "first_frame" }],
    });
    expect(problems).toMatchObject([{ field: "references" }]);
  });

  it("flags a reference role the model does not publish", () => {
    const problems = validateShotAgainstModel(standard, {
      references: [{ role: "not_a_real_wire_role" }],
    });
    expect(problems[0]?.message).toContain("not_a_real_wire_role");
  });

  it("says nothing about an unknown model: the API is the authority", () => {
    // A user may configure a model released after this registry was written.
    // Refusing to generate because a config file is stale is the wrong answer.
    expect(
      validateShotAgainstModel("some-model-nobody-has-seen", {
        duration: 30,
        resolution: "4k",
      })
    ).toEqual([]);
  });

  it("downgrades problems to warnings where the capability is inferred", () => {
    const problems = validateShotAgainstModel("seedance-1-0-pro-250528", {
      resolution: "4k",
    });
    expect(problems).toMatchObject([
      { field: "resolution", severity: "warning" },
    ]);
  });

  it("publishes Seedance 2.5 reference slot ceilings", () => {
    expect(lookupModel("dreamina-seedance-2-5-260628").referenceSlots).toEqual({
      first_frame: 1,
      last_frame: 1,
      reference_audio: 10,
      reference_image: 30,
      reference_video: 10,
    });
  });

  it("resolves Seedance 2.5 with 4-30s, 720p ceiling, and concurrency 1", () => {
    const model = lookupModel("dreamina-seedance-2-5-260628");
    expect(model.known).toBe(true);
    expect(model.family).toBe("seedance-2-5");
    expect(model.confidence).toBe("inferred");
    expect(model.durations).toMatchObject({ auto: false, max: 30, min: 4 });
    expect(model.resolutions).toEqual(["480p", "720p"]);
    expect(modelRateLimits(model.id, "720p")).toEqual({
      concurrency: 1,
      rpm: 60,
    });
    expect(usdPerMToken(model, "720p")).toBe(10.7);
    expect(
      validateShotAgainstModel(model.id, { duration: 24, resolution: "720p" })
    ).toEqual([]);
    expect(
      validateShotAgainstModel(model.id, { resolution: "1080p" })
    ).toMatchObject([{ field: "resolution", severity: "warning" }]);
    expect(validateShotAgainstModel(model.id, { duration: -1 })).toMatchObject([
      { field: "duration", severity: "warning" },
    ]);
  });
});

describe("Seedance 2.5 dual billing rate", () => {
  const model = lookupModel("dreamina-seedance-2-5-260628");

  it("quotes the without-video rate by default", () => {
    expect(usdPerMToken(model, "720p")).toBe(10.7);
  });

  it("quotes the cheaper rate only when video input is bound", () => {
    expect(usdPerMToken(model, "720p", { videoInput: true })).toBe(6.4);
  });

  it("leaves models with no with-video table on their single rate", () => {
    const model20 = lookupModel("dreamina-seedance-2-0-260128");
    expect(usdPerMToken(model20, "720p", { videoInput: true })).toBe(
      usdPerMToken(model20, "720p")
    );
  });
});

const partialRateModel = (): ModelCapabilities => ({
  ...lookupModel("dreamina-seedance-2-5-260628"),
  billing: {
    kind: "tokens",
    usdPerMTokenByResolution: { "1080p": 20, "480p": 10 },
    usdPerMTokenWithVideoInput: { "480p": 6.4 },
  },
});

describe("with-video rate falls through per resolution", () => {
  it("uses the base rate for a resolution the with-video table omits", () => {
    // Selecting the whole with-video table first would quote 6.4 for 1080p.
    expect(
      usdPerMToken(partialRateModel(), "1080p", { videoInput: true })
    ).toBe(20);
    expect(usdPerMToken(partialRateModel(), "480p", { videoInput: true })).toBe(
      6.4
    );
  });

  it("falls back to the model's dearest base rate, not the global one", () => {
    const empty: ModelCapabilities = {
      ...partialRateModel(),
      billing: {
        kind: "tokens",
        usdPerMTokenByResolution: { "480p": 10 },
        usdPerMTokenWithVideoInput: {},
      },
    };
    expect(usdPerMToken(empty, "720p", { videoInput: true })).toBe(10);
  });
});

describe("authoring limits are capability data, not model names", () => {
  // These four behaviours used to hang off an `isSeedance25()` family-string
  // predicate in src/shots.ts. The point of the flags is that a new model
  // declares what it can do instead of being added to four `if`s, so these
  // tests read the flags rather than asserting which model has them.
  it("lets 2.5 combine frame and reference modes where 2.0 cannot", () => {
    expect(lookupModel(MODEL_IDS.seedance25).framesExcludeReferences).toBe(
      false
    );
    expect(lookupModel(MODEL_IDS.seedance20).framesExcludeReferences).toBe(
      true
    );
  });

  it("permits inlined local video/audio only where the model accepts it", () => {
    expect(lookupModel(MODEL_IDS.seedance25).inlineNonImageRefs).toBe(true);
    expect(lookupModel(MODEL_IDS.seedance20).inlineNonImageRefs).toBe(false);
  });

  it("raises the soft reference and prompt budgets on 2.5", () => {
    const v25 = lookupModel(MODEL_IDS.seedance25);
    const v20 = lookupModel(MODEL_IDS.seedance20);
    expect(v25.softReferenceLimit).toBeGreaterThan(v20.softReferenceLimit);
    expect(v25.promptWordLimit).toBeGreaterThan(v20.promptWordLimit);
  });

  it("expects ordinal binding only where the idiom is used", () => {
    expect(lookupModel(MODEL_IDS.seedance25).ordinalBindingIdiom).toBe(true);
    expect(lookupModel(MODEL_IDS.seedance20).ordinalBindingIdiom).toBe(false);
  });

  it("gives an unknown model the CONSERVATIVE authoring envelope", () => {
    // Capabilities fall back permissively (an unknown model must not be
    // refused), but these two flags fail the other way: guessing that frame and
    // reference modes compose lets a payload the API will reject go out and be
    // billed, while guessing that they do not costs at most a warning.
    const unknown = lookupModel("some-model-released-next-year");
    expect(unknown.known).toBe(false);
    expect(unknown.framesExcludeReferences).toBe(true);
    expect(unknown.inlineNonImageRefs).toBe(false);
  });

  it("routes every registered model to a declared provider", () => {
    for (const family of Object.keys(MODEL_REGISTRY)) {
      expect(lookupModel(family).provider).toBeDefined();
    }
  });
});
