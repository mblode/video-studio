import { describe, expect, it } from "vitest";

import {
  checkCostCeiling,
  clipTokens,
  estimateClip,
  estimateClips,
  formatEstimate,
  frameSize,
  reconcileTokens,
  usdCeilingForClip,
  usdForClip,
  usdForTokens,
  videoTokens,
} from "./cost.js";
import { MODEL_IDS } from "./models.js";

const STANDARD = "dreamina-seedance-2-0-260128";
/** The only per-second-billed model in the registry. */
const PER_SECOND = "MiniMax-H3";

describe("frameSize", () => {
  it("matches the dimensions in the docs' worked examples", () => {
    expect(frameSize("720p", "16:9")).toEqual({ height: 720, width: 1280 });
    expect(frameSize("1080p", "16:9")).toEqual({ height: 1080, width: 1920 });
    expect(frameSize("4k", "16:9")).toEqual({ height: 2160, width: 3840 });
  });

  it("pins the SHORT side for portrait and square frames", () => {
    expect(frameSize("1080p", "9:16")).toEqual({ height: 1920, width: 1080 });
    expect(frameSize("720p", "1:1")).toEqual({ height: 720, width: 720 });
    expect(frameSize("720p", "4:3")).toEqual({ height: 720, width: 960 });
  });

  it("estimates `adaptive` on 16:9, which has no frame of its own", () => {
    expect(frameSize("720p", "adaptive")).toEqual(frameSize("720p", "16:9"));
  });
});

describe("videoTokens", () => {
  // duration × width × height × fps / 1024, the official ModelArk formula.
  it("reproduces the documented worked examples at 24 fps", () => {
    expect(videoTokens({ fps: 24, height: 720, seconds: 5, width: 1280 })).toBe(
      108_000
    );
    expect(
      videoTokens({ fps: 24, height: 1080, seconds: 5, width: 1920 })
    ).toBe(243_000);
    expect(
      videoTokens({ fps: 24, height: 2160, seconds: 5, width: 3840 })
    ).toBe(972_000);
  });
});

describe("clipTokens", () => {
  it("derives the worked examples from resolution alone", () => {
    expect(clipTokens({ duration: 5, resolution: "720p" })).toBe(108_000);
    expect(clipTokens({ duration: 5, resolution: "1080p" })).toBe(243_000);
    expect(clipTokens({ duration: 5, resolution: "4k" })).toBe(972_000);
  });

  it("scales tokens by the resolution pixel-area factor", () => {
    const final = clipTokens({ duration: 10, resolution: "1080p" });
    const draft = clipTokens({ duration: 10, resolution: "480p" });
    // The docs quote a 0.20x factor for 480p, but a measured 480p 16:9 frame is
    // 864x496, not the 864x480 that factor implies, so the real ratio is 0.207.
    // Measurement wins: `OBSERVED_FRAME_SIZE` reproduces the billed tokens
    // exactly, and this is still ~5x cheaper, which is the point of a draft.
    expect(draft / final).toBeCloseTo(0.2067, 4);
  });

  it("charges 4K ~4x 1080p, which is the trap the lower rate hides", () => {
    expect(clipTokens({ duration: 10, resolution: "4k" })).toBe(
      clipTokens({ duration: 10, resolution: "1080p" }) * 4
    );
  });

  it("prices auto duration (-1) as a typical mid-length clip", () => {
    expect(clipTokens({ duration: -1, resolution: "1080p" })).toBe(
      clipTokens({ duration: 8, resolution: "1080p" })
    );
  });

  it("bills input video seconds alongside the output", () => {
    // A reference VIDEO is billed; a reference still has no duration and is not.
    expect(
      clipTokens({ duration: 5, inputVideoSeconds: 5, resolution: "720p" })
    ).toBe(216_000);
  });

  it("costs a portrait frame the same as its landscape rotation", () => {
    expect(
      clipTokens({ duration: 5, ratio: "9:16", resolution: "1080p" })
    ).toBe(clipTokens({ duration: 5, ratio: "16:9", resolution: "1080p" }));
  });
});

describe("estimateClip / estimateClips", () => {
  it("quotes tokens and USD for one clip", () => {
    const estimate = estimateClip({
      duration: 5,
      modelId: STANDARD,
      resolution: "720p",
    });
    expect(estimate).toMatchObject({ clips: 1, seconds: 5, tokens: 108_000 });
    expect(estimate.usd).toBeCloseTo(
      usdForTokens(108_000, STANDARD, "720p"),
      6
    );
  });

  it("sums a batch", () => {
    const total = estimateClips([
      { duration: 5, modelId: STANDARD, resolution: "720p" },
      { duration: 5, modelId: STANDARD, resolution: "720p" },
    ]);
    expect(total).toMatchObject({ clips: 2, seconds: 10, tokens: 216_000 });
  });
});

describe("checkCostCeiling", () => {
  const estimate = estimateClips([
    { duration: 10, modelId: STANDARD, resolution: "1080p" },
  ]);

  it("allows a run under the ceiling", () => {
    expect(checkCostCeiling(estimate, 100).allowed).toBe(true);
  });

  it("treats an absent or zero ceiling as no ceiling", () => {
    expect(checkCostCeiling(estimate).allowed).toBe(true);
    expect(checkCostCeiling(estimate, 0).allowed).toBe(true);
  });

  it("blocks a run over the ceiling with both figures in the reason", () => {
    const result = checkCostCeiling(estimate, 0.001);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("--max-cost");
    expect(result.reason).toContain("$0.00");
  });
});

describe("reconcileTokens", () => {
  it("accepts a bill close to the estimate", () => {
    const result = reconcileTokens(100_000, 105_000);
    expect(result).toMatchObject({ deltaTokens: 5000, withinTolerance: true });
    expect(result.message).not.toContain("recalibrate");
  });

  it("flags an under-quote and says what to fix", () => {
    const result = reconcileTokens(100_000, 200_000);
    expect(result.ratio).toBe(2);
    expect(result.withinTolerance).toBe(false);
    expect(result.message).toContain("100% over");
    expect(result.message).toContain("recalibrate");
  });
});

describe("formatEstimate", () => {
  it("renders millions and a dollar amount", () => {
    expect(formatEstimate(4_400_000, 24.6)).toBe("4.4M tokens ≈ $24.60");
  });
});

describe("per-second billing", () => {
  // `Billing.perSecond` was declared in the registry and never implemented, so
  // `usdPerMToken` returned 0 for it and every quote came out as $0.00. Cost is
  // a safety property here (SECURITY.md): a model the estimator does not
  // understand must never look free, because `--max-cost` is the only guard
  // between an unattended `--yes` run and a real bill.
  it("never quotes a per-second model at zero", () => {
    const estimate = estimateClip({
      duration: 15,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    expect(estimate.usd).toBeGreaterThan(0);
  });

  it("prices the published rates exactly", () => {
    // 15s at 2K is the worked example on the provider's own pricing page.
    expect(
      usdForClip({ duration: 15, modelId: PER_SECOND, resolution: "2k" })
    ).toBeCloseTo(1.95, 2);
    expect(
      usdForClip({ duration: 15, modelId: PER_SECOND, resolution: "768p" })
    ).toBeCloseTo(1.2, 2);
  });

  it("does not scale with frame area the way token billing does", () => {
    // The whole reason a per-second 2K clip can undercut a token-billed 720p
    // one: 2K is 3.5x the pixels of 768P but only 1.6x the price.
    const cheap = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      resolution: "768p",
    });
    const dear = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    expect(dear / cheap).toBeLessThan(2);
  });

  it("applies the per-task minimum to a clip priced below it", () => {
    // 4s at 768P prices at 4 x $0.08 = $0.32, but the provider's per-task floor
    // is the cheapest REACHABLE request (2K x 4s = $0.52), so the floor wins.
    // Asserting the sum here instead would lock in a 38% under-quote.
    expect(
      usdForClip({ duration: 4, modelId: PER_SECOND, resolution: "768p" })
    ).toBeCloseTo(0.52, 2);
    // ...and does not inflate anything already above it.
    expect(
      usdForClip({ duration: 15, modelId: PER_SECOND, resolution: "768p" })
    ).toBeCloseTo(1.2, 2);
  });

  it("charges reference images past the free allowance, and only past it", () => {
    const base = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    const withFive = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      referenceImages: 5,
      resolution: "2k",
    });
    const withEight = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      referenceImages: 8,
      resolution: "2k",
    });
    expect(withFive).toBeCloseTo(base, 6);
    expect(withEight).toBeCloseTo(base + 3 * 0.04, 6);
  });

  it("bills input video seconds at the output rate", () => {
    const alone = usdForClip({
      duration: 10,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    const conditioned = usdForClip({
      duration: 10,
      inputVideoSeconds: 5,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    expect(conditioned).toBeCloseTo(alone + 5 * 0.13, 6);
  });

  it("reports no tokens, and formats without a token clause", () => {
    const estimate = estimateClip({
      duration: 15,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    expect(estimate.tokens).toBe(0);
    // "0K tokens ≈ $1.95" reads as a broken estimate, not a billing scheme.
    expect(formatEstimate(estimate.tokens, estimate.usd)).toBe("$1.95");
  });

  it("still enforces --max-cost, which is the point of all of the above", () => {
    const estimate = estimateClip({
      duration: 15,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    expect(checkCostCeiling(estimate, 0.5).allowed).toBe(false);
    expect(checkCostCeiling(estimate, 5).allowed).toBe(true);
  });

  it("totals a mixed-provider run across both billing schemes", () => {
    const total = estimateClips([
      { duration: 15, modelId: PER_SECOND, resolution: "2k" },
      { duration: 8, modelId: STANDARD, resolution: "720p" },
    ]);
    const perSecond = estimateClip({
      duration: 15,
      modelId: PER_SECOND,
      resolution: "2k",
    });
    const tokenBilled = estimateClip({
      duration: 8,
      modelId: STANDARD,
      resolution: "720p",
    });
    expect(total.clips).toBe(2);
    expect(total.usd).toBeCloseTo(perSecond.usd + tokenBilled.usd, 6);
    // Only the token-billed half contributes tokens.
    expect(total.tokens).toBe(tokenBilled.tokens);
  });
});

/**
 * A reference video bills its own duration alongside the output, and a remote
 * clip's length is not knowable before submitting. Quoting output-only made
 * `--max-cost` enforce a number already known to be too low.
 */
describe("range quotes for unknowable input video", () => {
  const withVideo = {
    duration: 8,
    modelId: MODEL_IDS.seedance20,
    ratio: "16:9" as const,
    referenceVideos: 1,
    resolution: "720p" as const,
  };

  it("quotes a ceiling strictly above the point estimate", () => {
    const estimate = estimateClip(withVideo);
    expect(estimate.usdMax).toBeGreaterThan(estimate.usd);
  });

  it("bounds the ceiling by the model's longest accepted input", () => {
    // 8s output + 15s worst-case input, billed at the cheaper with-video rate.
    const tokensPerSecond = clipTokens({ ...withVideo, duration: 1 });
    expect(usdCeilingForClip(withVideo)).toBeCloseTo(
      ((8 + 15) * tokensPerSecond * 4.3) / 1_000_000,
      6
    );
  });

  it("leaves a shot with no reference video on a single number", () => {
    const estimate = estimateClip({ ...withVideo, referenceVideos: 0 });
    expect(estimate.usdMax).toBe(estimate.usd);
  });

  it("uses the known length when the caller actually has one", () => {
    const known = { ...withVideo, inputVideoSeconds: 2 };
    expect(usdCeilingForClip(known)).toBe(usdForClip(known));
  });

  it("checks --max-cost against the ceiling, not the low end", () => {
    const estimate = estimateClip(withVideo);
    const between = (estimate.usd + estimate.usdMax) / 2;
    expect(checkCostCeiling(estimate, between).allowed).toBe(false);
  });

  it("prints a range only when the ends differ", () => {
    expect(formatEstimate(0, 1.2, 1.2)).toBe("$1.20");
    expect(formatEstimate(0, 1.2, 2.5)).toBe("$1.20-$2.50");
  });
});

/**
 * Regression: the token formula was always exact, but the geometry fed to it
 * was derived from a wrong premise (that a resolution pins the short side).
 * These are measured off real clips and reconciled against the billed
 * `usage.completion_tokens` in films/lighthouse's draft manifest.
 */
describe("measured frame sizes", () => {
  it("reproduces the exact bill for a 480p 16:9 draft clip", () => {
    // 6 clips, 80,770 billed tokens each at 8.041667s.
    expect(frameSize("480p", "16:9")).toEqual({ height: 496, width: 864 });
    expect(videoTokens({ height: 496, seconds: 8.041667, width: 864 })).toBe(
      80_771
    );
  });

  it("reproduces the exact bill for a 480p adaptive draft clip", () => {
    // 12 clips, 77,200 billed tokens each at 8.041667s.
    expect(frameSize("480p", "adaptive")).toEqual({ height: 640, width: 640 });
    expect(videoTokens({ height: 640, seconds: 8.041667, width: 640 })).toBe(
      77_200
    );
  });

  it("still derives a size for a pairing nobody has measured", () => {
    expect(frameSize("720p", "16:9")).toEqual({ height: 720, width: 1280 });
  });
});
