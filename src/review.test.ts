import { describe, expect, it } from "vitest";

import { probeWarnings } from "./review.js";
import type { ManifestEntry } from "./types.js";

const params: NonNullable<ManifestEntry["params"]> = {
  duration: 10,
  generateAudio: true,
  model: "m",
  ratio: "16:9",
  resolution: "1080p",
  watermark: false,
};

describe("probeWarnings", () => {
  it("is silent when the clip matches what was requested", () => {
    expect(
      probeWarnings({ duration: 10, height: 1080, width: 1920 }, params)
    ).toEqual([]);
  });

  it("flags a clip that came back the wrong length", () => {
    const warnings = probeWarnings(
      { duration: 6, height: 1080, width: 1920 },
      params
    );
    expect(warnings.some((w) => w.includes("duration"))).toBe(true);
  });

  it("flags a wrong aspect ratio", () => {
    const warnings = probeWarnings(
      { duration: 10, height: 1080, width: 1080 },
      params
    );
    expect(warnings.some((w) => w.includes("aspect"))).toBe(true);
  });

  it("flags a clip rendered below the requested resolution", () => {
    const warnings = probeWarnings(
      { duration: 10, height: 480, width: 854 },
      params
    );
    expect(warnings.some((w) => w.includes("short side"))).toBe(true);
  });

  it("never flags an auto-duration (-1) clip on length", () => {
    const warnings = probeWarnings(
      { duration: 4, height: 1080, width: 1920 },
      { ...params, duration: -1 }
    );
    expect(warnings.some((w) => w.includes("duration"))).toBe(false);
  });

  it("is silent when no params were recorded", () => {
    expect(probeWarnings({ duration: 6, height: 480, width: 854 })).toEqual([]);
  });
});
