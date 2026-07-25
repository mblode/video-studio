import { describe, expect, it } from "vitest";

import {
  normalizeClipArgs,
  pickShotStill,
  shotDuration,
  stillSegmentArgs,
  targetDimensions,
} from "./animatic.js";
import type { Shot } from "./types.js";

describe("targetDimensions", () => {
  it("pins the height for a landscape ratio", () => {
    expect(targetDimensions("16:9", 720)).toEqual({ height: 720, width: 1280 });
  });

  it("pins the width for a portrait ratio", () => {
    expect(targetDimensions("9:16", 720)).toEqual({ height: 1280, width: 720 });
  });

  it("returns a square for 1:1 and always-even dimensions", () => {
    const square = targetDimensions("1:1", 721);
    expect(square.width).toBe(square.height);
    expect(square.width % 2).toBe(0);
  });

  it("handles the other landscape ratios", () => {
    expect(targetDimensions("4:3", 720)).toEqual({ height: 720, width: 960 });
    expect(targetDimensions("21:9", 720)).toEqual({ height: 720, width: 1680 });
  });
});

describe("stillSegmentArgs", () => {
  it("loops the image, holds for the duration, and adds a silent track", () => {
    const args = stillSegmentArgs(
      "a.png",
      6,
      { height: 720, width: 1280 },
      24,
      "seg.mp4"
    );
    expect(args).toContain("-loop");
    expect(args.join(" ")).toContain("anullsrc");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("6");
    expect(args.at(-1)).toBe("seg.mp4");
  });
});

describe("normalizeClipArgs", () => {
  it("scales to the target frame and replaces audio with silence", () => {
    const args = normalizeClipArgs(
      "clip.mp4",
      { height: 1080, width: 1920 },
      24,
      "out.mp4"
    );
    expect(args.join(" ")).toContain("scale=1920:1080");
    expect(args.join(" ")).toContain("anullsrc");
    expect(args).not.toContain("-loop");
  });
});

const shotWith = (refs: Shot["references"]): Shot => ({
  id: "s",
  prompt: "p",
  references: refs,
});

describe("pickShotStill", () => {
  it("prefers a first_frame reference over a plain image reference", () => {
    const shot = shotWith([
      { role: "reference_image", type: "image", url: "./a.png" },
      { role: "first_frame", type: "image", url: "./b.png" },
    ]);
    expect(pickShotStill(shot, "/film")).toBe("/film/b.png");
  });

  it("returns null for a chained/text-only shot", () => {
    expect(pickShotStill(shotWith(), "/film")).toBeNull();
  });

  it("returns null for a remote-only reference (can't loop locally)", () => {
    const shot = shotWith([
      { role: "reference_image", type: "image", url: "https://x/y.png" },
    ]);
    expect(pickShotStill(shot, "/film")).toBeNull();
  });
});

describe("shotDuration", () => {
  it("resolves auto (-1) to the film default", () => {
    expect(shotDuration({ duration: -1, id: "s", prompt: "p" }, 8)).toBe(8);
  });

  it("uses the shot duration when set", () => {
    expect(shotDuration({ duration: 12, id: "s", prompt: "p" }, 8)).toBe(12);
  });
});
