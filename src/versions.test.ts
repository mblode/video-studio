import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertNewVideoOutput,
  clipRevisionPath,
  nextRenderPath,
  versionLabel,
} from "./versions.js";

describe("video revisions", () => {
  it("formats stable, sortable version labels", () => {
    expect(versionLabel(1)).toBe("v001");
    expect(versionLabel(42)).toBe("v042");
  });

  it("keeps every take in its shot directory", () => {
    expect(clipRevisionPath("/film/output", "wide", 3)).toBe(
      "/film/output/clips/wide/v003.mp4"
    );
    expect(clipRevisionPath("/film/output", "wide", 3, "custom/take.mp4")).toBe(
      "/film/output/clips/wide/v003/custom/take.mp4"
    );
  });

  it("allocates the first unused render without touching older files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-versions-"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "v001.mp4"), "first");
    await writeFile(join(dir, "v002.mp4"), "second");

    expect(nextRenderPath(dir)).toBe(join(dir, "v003.mp4"));
  });

  it("refuses to replace an explicitly named video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-output-"));
    const output = join(dir, "final.mp4");
    await writeFile(output, "keep me");

    expect(() => assertNewVideoOutput(output)).toThrow(
      "refusing to overwrite existing video"
    );
  });
});
