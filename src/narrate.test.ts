import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLastLineBeforeFade,
  buildAssembleFfmpegArgs,
  buildAssembleSegments,
  buildNarrateLineRequests,
  loadLinesFile,
  loadPlacementFile,
  loadScratchText,
  parseLinesTsv,
  parsePlacementTsv,
  placeLines,
  scratchAudioPath,
  shotStartTimes,
} from "./narrate.js";
import type { ShotsFile } from "./types.js";

describe("parseLinesTsv", () => {
  it("parses NN\\ttext rows and skips comments", () => {
    const lines = parseLinesTsv(
      "# comment\n01\tHello world.\n02\tSecond line.\n"
    );
    expect(lines).toEqual([
      { number: 1, text: "Hello world." },
      { number: 2, text: "Second line." },
    ]);
  });
});

describe("parsePlacementTsv", () => {
  it("parses placement rows and skips a header", () => {
    const rows = parsePlacementTsv(
      "line\tshot\toffset\n1\ts01-eric-builds\t2\n2\ts02-victor-sells\t1.5\n"
    );
    expect(rows).toEqual([
      { line: 1, offsetIntoShot: 2, shotId: "s01-eric-builds" },
      { line: 2, offsetIntoShot: 1.5, shotId: "s02-victor-sells" },
    ]);
  });
});

describe("buildNarrateLineRequests", () => {
  it("threads previous/next text for continuity", () => {
    const requests = buildNarrateLineRequests(
      [
        { number: 1, text: "One." },
        { number: 2, text: "Two." },
      ],
      "voice-1"
    );
    expect(requests[0]?.request.nextText).toBe("Two.");
    expect(requests[1]?.request.previousText).toBe("One.");
    expect(requests[0]?.path).toBe("line-01.mp3");
  });
});

describe("assemble timeline math", () => {
  const file: ShotsFile = {
    cards: [{ after: "start", duration: 3, text: "TITLE", transition: 0.05 }],
    film: { title: "T" },
    shots: [
      { duration: 10, id: "s01", prompt: "p", transition: 0.05 },
      { duration: 10, id: "s02", prompt: "p", transition: 0.05 },
    ],
  };

  it("places lines after card + xfade into shots", () => {
    const segments = buildAssembleSegments(file, { s01: 10, s02: 10 }, 0);
    const { starts, total } = shotStartTimes(segments);
    // start card 3s @ trans 0.05 into… first item has no prior fade; then s01
    // subtracts its own transition 0.05 → start 2.95
    expect(starts.s01).toBeCloseTo(2.95, 2);
    expect(total).toBeGreaterThan(20);
  });

  it("matches stitch --xfade 0 when transitions are unset", () => {
    const plain: ShotsFile = {
      film: { title: "T" },
      shots: [
        { duration: 8, id: "a", prompt: "p" },
        { duration: 8, id: "b", prompt: "p" },
      ],
    };
    const { starts } = shotStartTimes(
      buildAssembleSegments(plain, { a: 8, b: 8 }, 0)
    );
    expect(starts.a).toBe(0);
    expect(starts.b).toBe(8);
  });

  it("builds adelay ffmpeg args and enforces min gap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-"));
    await writeFile(join(dir, "line-01.mp3"), "x");
    await writeFile(join(dir, "line-02.mp3"), "x");
    const placed = placeLines(
      [
        { line: 1, offsetIntoShot: 0, shotId: "s01" },
        { line: 2, offsetIntoShot: 0, shotId: "s01" },
      ],
      { s01: 0 },
      { 1: 2, 2: 2 },
      dir
    );
    expect(placed[0]?.start).toBe(0);
    // Second overlaps the first; shifted to firstEnd + MIN_GAP.
    expect(placed[1]?.start).toBeCloseTo(2.25, 2);
    const args = buildAssembleFfmpegArgs(placed, 30, join(dir, "out.mp3"));
    expect(args.join(" ")).toContain("adelay=");
    expect(args.at(-1)).toBe(join(dir, "out.mp3"));
  });
});

describe("assertLastLineBeforeFade", () => {
  const segments = [
    { dur: 10, id: "s01", kind: "shot" as const, trans: 0.05 },
    { dur: 10, id: "s02", kind: "shot" as const, trans: 0.05 },
  ];
  const starts = { s01: 0, s02: 9.95 };

  it("passes when the last line clears the fade window", () => {
    expect(() =>
      assertLastLineBeforeFade(
        [{ duration: 4, line: 1, path: "line-01.mp3", start: 14 }],
        starts,
        segments,
        "s02",
        1.5
      )
    ).not.toThrow();
  });

  it("throws when the last line runs into the fade window", () => {
    expect(() =>
      assertLastLineBeforeFade(
        [{ duration: 4, line: 1, path: "line-01.mp3", start: 18 }],
        starts,
        segments,
        "s02",
        1.5
      )
    ).toThrow(/fade begins/u);
  });
});

describe("scratchAudioPath", () => {
  it("defaults next to the text file", () => {
    expect(scratchAudioPath("/films/demo/vo.txt")).toMatch(
      /narration-scratch\.mp3$/u
    );
  });
});

/**
 * The placement TSV defaults to a path the user has usually not written yet, so
 * this is the most likely failure of `vs narrate assemble`. A raw ENOENT there
 * reaches a `--json` caller with no code to branch on and no way out.
 */
describe("narration files that are not there", () => {
  it("reports a missing placement TSV as file_not_found with the format in the hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narrate-"));
    const missing = join(dir, "narration", "placement.tsv");
    const failure = (await loadPlacementFile(missing).catch(
      (error: unknown) => error
    )) as Error & { code?: string; hint?: string };

    expect(failure.code).toBe("file_not_found");
    expect(failure.message).toContain(missing);
    expect(failure.hint).toContain("line\\tshotId\\toffset");
  });

  it("reports a missing lines TSV and a missing --text-file the same way", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narrate-"));
    for (const failure of await Promise.all([
      loadLinesFile(join(dir, "lines.tsv")).catch((error: unknown) => error),
      loadScratchText(join(dir, "vo.txt")).catch((error: unknown) => error),
    ])) {
      expect((failure as Error & { code?: string }).code).toBe(
        "file_not_found"
      );
      expect((failure as Error & { hint?: string }).hint).toBeTruthy();
    }
  });
});
