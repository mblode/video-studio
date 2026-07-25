import { describe, expect, it } from "vitest";

import { isVsError } from "./errors.js";
import {
  escapeDrawtext,
  frameAtArgs,
  lastFrameArgs,
  probeClip,
  summarizeFfmpegStderr,
} from "./ffmpeg.js";

describe("lastFrameArgs", () => {
  it("seeks from EOF and writes one frame", () => {
    const args = lastFrameArgs("/a/in.mp4", "/a/out.png");
    expect(args).toEqual([
      "-y",
      "-sseof",
      "-0.5",
      "-i",
      "/a/in.mp4",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-q:v",
      "2",
      "/a/out.png",
    ]);
  });
});

describe("frameAtArgs", () => {
  it("seeks to the timestamp", () => {
    expect(frameAtArgs("/a/in.mp4", 4.567, "/a/out.png")).toContain("4.57");
  });
});

describe("escapeDrawtext", () => {
  it("escapes colons, percent, backslashes, and swaps quotes", () => {
    expect(escapeDrawtext("UKRAINE: 100% 'home'\\")).toBe(
      "UKRAINE\\: 100\\% ’home’\\\\"
    );
  });
});

describe("summarizeFfmpegStderr", () => {
  it("picks the real complaint out of the banner", () => {
    const stderr = [
      "ffmpeg version 7.1 Copyright (c) 2000-2024",
      "  built with Apple clang",
      "  configuration: --prefix=/opt",
      "  libavutil      59. 39.100",
      "Input #0, mov,mp4, from 'a.mp4':",
      "  Duration: 00:00:08.00, start: 0.000000",
      "    Stream #0:0: Video: h264",
      "Unknown encoder 'libx265'",
    ].join("\n");
    expect(summarizeFfmpegStderr(stderr)).toBe("Unknown encoder 'libx265'");
  });

  it("degrades to a stable phrase when there is nothing to report", () => {
    expect(summarizeFfmpegStderr("")).toBe("no diagnostic output");
  });
});

describe("probeClip", () => {
  it("names the missing file instead of leaking an ffprobe command line", async () => {
    const failure = await probeClip("/nope/missing.mp4").catch(
      (error: unknown) => error
    );
    expect(isVsError(failure)).toBe(true);
    expect((failure as Error).message).toContain("no such file");
  });
});
