import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { chainDependencies, resolveChainFrame } from "./chain.js";
import { frameTimestamps, renderIndexMd } from "./review.js";
import type { Manifest, Shot } from "./types.js";

const shot = (id: string, continueFrom?: string): Shot => ({
  continueFrom,
  id,
  prompt: "p",
});

describe("chainDependencies", () => {
  it("maps chained shots to their dependencies", () => {
    const deps = chainDependencies([
      shot("a"),
      shot("b", "a"),
      shot("c"),
      shot("d", "c"),
    ]);
    expect([...deps.entries()]).toEqual([
      ["b", "a"],
      ["d", "c"],
    ]);
  });
});

describe("resolveChainFrame", () => {
  it("names the cached frame after the selected revision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-chain-version-"));
    await writeFile(join(dir, "clip.mp4"), "video");
    await setTimeout(5);
    await mkdir(join(dir, "frames"), { recursive: true });
    await writeFile(join(dir, "frames", "a-v002-last.png"), "frame");
    const manifest: Manifest = {
      entries: {
        a: {
          attempts: 2,
          outputPath: "clip.mp4",
          selectedVersion: 2,
          shotId: "a",
          status: "downloaded",
          submittedAt: "2026-01-01T00:00:00.000Z",
          taskId: "t2",
          updatedAt: "2026-01-01T00:00:00.000Z",
          versions: [
            {
              outputPath: "clip.mp4",
              status: "downloaded",
              submittedAt: "2026-01-01T00:00:00.000Z",
              taskId: "t2",
              updatedAt: "2026-01-01T00:00:00.000Z",
              version: 2,
            },
          ],
        },
      },
      shotsFile: "shots.json",
      version: 2,
    };

    await expect(
      resolveChainFrame(shot("b", "a"), manifest, dir)
    ).resolves.toBe(join("frames", "a-v002-last.png"));
  });

  it("errors when the dependency is not downloaded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-chain-"));
    const manifest: Manifest = {
      entries: {
        a: {
          attempts: 1,
          shotId: "a",
          status: "failed",
          submittedAt: "2026-01-01T00:00:00.000Z",
          taskId: "t1",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      shotsFile: "shots.json",
      version: 2,
    };
    await expect(
      resolveChainFrame(shot("b", "a"), manifest, dir)
    ).rejects.toThrow(/not downloaded/u);
  });

  it("errors when continueFrom is missing entirely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-chain-"));
    const manifest: Manifest = {
      entries: {},
      shotsFile: "shots.json",
      version: 2,
    };
    await expect(
      resolveChainFrame(shot("b", "a"), manifest, dir)
    ).rejects.toThrow(/generate a first/u);
  });
});

describe("frameTimestamps", () => {
  it("samples the first (0%) and last (~98%) frame plus mids", () => {
    expect(frameTimestamps(10, 3)).toEqual([0, 4.9, 9.8]);
  });

  it("falls back to the midpoint for a single frame", () => {
    expect(frameTimestamps(8, 1)).toEqual([4]);
  });
});

describe("renderIndexMd", () => {
  it("renders generated and missing shots", async () => {
    const md = renderIndexMd(
      [
        {
          entry: {
            attempts: 2,
            params: {
              duration: 8,
              generateAudio: true,
              model: "m",
              ratio: "16:9",
              resolution: "1080p",
              seed: 7,
              watermark: false,
            },
            shotId: "s1",
            status: "downloaded",
            submittedAt: "",
            taskId: "t1",
            updatedAt: "",
          },
          frameFiles: ["s1-1.png", "s1-2.png"],
          promptExcerpt: "a quiet street",
          shotId: "s1",
          warnings: [],
        },
        { frameFiles: [], promptExcerpt: "x", shotId: "s2", warnings: [] },
      ],
      "shots.json"
    );
    expect(md).toContain("## s1");
    expect(md).toContain("attempts: 2");
    expect(md).toContain("seed 7");
    expect(md).toContain("![s1](s1-1.png)");
    expect(md).toContain("**Not generated.**");
    expect(md).toContain("--shot <id> --force");
    // make a write/read roundtrip cheap sanity check
    const dir = await mkdtemp(join(tmpdir(), "vs-review-"));
    await writeFile(join(dir, "index.md"), md);
  });
});
