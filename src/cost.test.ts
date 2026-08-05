import { describe, expect, it } from "vitest";

import {
  checkCostCeiling,
  estimateClip,
  estimateClips,
  estimateCostUsd,
  estimateTokens,
  formatEstimate,
  frameSize,
  reconcileTokens,
  usdForClip,
  usdForTokens,
  videoTokens,
} from "./cost.js";

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

describe("estimateTokens", () => {
  it("derives the worked examples from resolution alone", () => {
    expect(estimateTokens(5, "720p")).toBe(108_000);
    expect(estimateTokens(5, "1080p")).toBe(243_000);
    expect(estimateTokens(5, "4k")).toBe(972_000);
  });

  it("scales tokens by the resolution pixel-area factor", () => {
    const final = estimateTokens(10, "1080p");
    const draft = estimateTokens(10, "480p");
    // 480p is the 0.20x factor — a draft is ~5x cheaper in tokens.
    expect(draft).toBeCloseTo(final * 0.2, 5);
  });

  it("charges 4K ~4x 1080p, which is the trap the lower rate hides", () => {
    expect(estimateTokens(10, "4k")).toBe(estimateTokens(10, "1080p") * 4);
  });

  it("prices auto duration (-1) as a typical mid-length clip", () => {
    expect(estimateTokens(-1, "1080p")).toBe(estimateTokens(8, "1080p"));
  });

  it("bills input video seconds alongside the output", () => {
    // A reference VIDEO is billed; a reference still has no duration and is not.
    expect(estimateTokens(5, "720p", { inputVideoSeconds: 5 })).toBe(216_000);
  });

  it("costs a portrait frame the same as its landscape rotation", () => {
    expect(estimateTokens(5, "1080p", { ratio: "9:16" })).toBe(
      estimateTokens(5, "1080p", { ratio: "16:9" })
    );
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

describe("estimateCostUsd", () => {
  it("charges the fast tier less than standard for the same tokens", () => {
    expect(estimateCostUsd(1_000_000, "fast")).toBeLessThan(
      estimateCostUsd(1_000_000, "standard")
    );
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
