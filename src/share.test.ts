import { describe, expect, it } from "vitest";

import { buildSharePlan } from "./share.js";

const base = {
  audioKbps: 160,
  durationSec: 170,
  height: 720,
  inputPath: "/a/in.mp4",
  maxBytes: 49 * 1_048_576,
  outputPath: "/a/out.mp4",
  passLogPrefix: "/tmp/p",
  sourceHeight: 720,
};

describe("buildSharePlan", () => {
  it("sizes video bitrate to the byte budget minus audio with headroom", () => {
    const plan = buildSharePlan(base);
    // (49MiB*8/1000)/170 - 160, *0.97 → floor 2190 kbps
    expect(plan.videoKbps).toBe(2190);
    expect(plan.pass2).toContain("2190k");
    expect(plan.pass2).toContain("+faststart");
    expect(plan.pass1).toContain("-an");
  });

  it("downscales only when the source is taller than the cap", () => {
    expect(buildSharePlan({ ...base, sourceHeight: 1080 }).pass2).toContain(
      "scale=-2:720"
    );
    expect(buildSharePlan({ ...base, sourceHeight: 720 }).pass2).not.toContain(
      "scale=-2:720"
    );
  });

  it("throws when the budget is too small for the duration", () => {
    expect(() => buildSharePlan({ ...base, maxBytes: 2 * 1_048_576 })).toThrow(
      /too small/u
    );
  });

  it("throws on a zero-duration input, naming the file and the next step", () => {
    let failure: (Error & { code?: string; hint?: string }) | undefined;
    try {
      buildSharePlan({ ...base, durationSec: 0 });
    } catch (error) {
      failure = error as Error & { code?: string; hint?: string };
    }
    expect(failure?.code).toBe("probe_failed");
    expect(failure?.message).toContain("/a/in.mp4");
    expect(failure?.hint).toContain("vs doctor");
  });
});
