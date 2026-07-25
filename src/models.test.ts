import { describe, expect, it } from "vitest";

import {
  isKnownModel,
  lookupModel,
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
      references: [{ role: "green_screen_plate" }],
    });
    expect(problems[0]?.message).toContain("green_screen_plate");
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
});
