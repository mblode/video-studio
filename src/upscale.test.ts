import { describe, expect, it } from "vitest";

import { buildUpscalePlan } from "./upscale.js";

const base = {
  crf: 18,
  height: 1080,
  inputPath: "/a/in.mp4",
  outputPath: "/a/out.mp4",
  sourceHeight: 720,
};

describe("buildUpscalePlan", () => {
  it("lanczos-scales to the target height with an even width", () => {
    const plan = buildUpscalePlan(base);
    expect(plan.skip).toBe(false);
    expect(plan.args).toContain("scale=-2:1080:flags=lanczos");
    expect(plan.args).toContain("libx264");
  });

  it("copies audio and writes a faststart mp4", () => {
    const { args } = buildUpscalePlan(base);
    const aIdx = args.indexOf("-c:a");
    expect(args[aIdx + 1]).toBe("copy");
    expect(args).toContain("+faststart");
    expect(args.at(-1)).toBe("/a/out.mp4");
  });

  it("passes the crf through", () => {
    const { args } = buildUpscalePlan({ ...base, crf: 20 });
    const idx = args.indexOf("-crf");
    expect(args[idx + 1]).toBe("20");
  });

  it("skips when the source already meets the target height", () => {
    expect(buildUpscalePlan({ ...base, sourceHeight: 1080 })).toEqual({
      args: [],
      skip: true,
    });
    expect(buildUpscalePlan({ ...base, sourceHeight: 2160 }).skip).toBe(true);
  });
});
