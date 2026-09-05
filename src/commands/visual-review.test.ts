import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type * as FfmpegModule from "../ffmpeg.js";
import { runReview } from "./review.js";
import { runStitch } from "./stitch.js";
import { runUse } from "./use.js";

vi.mock("../ffmpeg.js", async (original) => ({
  ...(await original<typeof FfmpegModule>()),
  assertFfmpeg: vi.fn(),
}));

async function fixture(draft = false) {
  const dir = await mkdtemp(join(tmpdir(), "vs-visual-gate-"));
  const shotsFile = join(dir, "shots.json");
  await writeFile(
    shotsFile,
    JSON.stringify({
      film: { requireVisualApproval: true, title: "Test" },
      shots: [
        {
          cast: ["eric"],
          id: "a",
          prompt: "A subject moving",
          references: [
            {
              cast: "eric",
              role: "reference_image",
              type: "image",
              url: "eric.png",
            },
          ],
        },
      ],
    })
  );
  await writeFile(join(dir, "eric.png"), "canonical");
  await writeFile(join(dir, "clip.mp4"), "media");
  const manifest = {
    entries: {
      a: {
        attempts: 1,
        outputPath: "clip.mp4",
        selectedVersion: 1,
        shotId: "a",
        status: "downloaded",
        taskId: "one",
        versions: [
          {
            outputPath: "clip.mp4",
            status: "downloaded",
            taskId: "one",
            version: 1,
          },
        ],
      },
    },
    shotsFile,
    version: 2,
  };
  const path = join(dir, draft ? "tasks-draft.json" : "tasks.json");
  await writeFile(path, JSON.stringify(manifest));
  return { dir, path, shotsFile };
}
const options = {
  draft: false,
  dryRun: true,
  font: "Georgia",
  grade: false,
  latest: false,
  musicGain: 0,
  muteClips: false,
  narrationGain: 0,
  sfxGain: 0,
  xfade: 0,
};

describe("visual review command gates", () => {
  it.each([false, true])(
    "blocks unreviewed stitch before media probing, latest=%s",
    async (latest) => {
      const f = await fixture();
      await expect(
        runStitch(f.shotsFile, { ...options, latest })
      ).rejects.toThrow("no visual review receipt");
    }
  );
  it("latest checks the selected draft receipt rather than bypassing review", async () => {
    const f = await fixture(true);
    await expect(
      runStitch(f.shotsFile, { ...options, latest: true })
    ).rejects.toThrow("no visual review receipt");
  });
  it("an explicit approval permits selection until the canonical sheet changes", async () => {
    const f = await fixture();
    await runReview(f.shotsFile, {
      draft: false,
      dryRun: false,
      frames: 3,
      note: "Inspected moving footage: stable face and prop geometry",
      shot: "a",
      verdict: "approved",
      version: 1,
    });
    await expect(
      runUse(f.shotsFile, "a", 1, { draft: false })
    ).resolves.toBeUndefined();
    await writeFile(join(f.dir, "eric.png"), "changed identity");
    await expect(runStitch(f.shotsFile, options)).rejects.toThrow(
      "approval is stale"
    );
  });
  it("blocks use without changing the manifest", async () => {
    const f = await fixture();
    const before = await readFile(f.path, "utf-8");
    await expect(runUse(f.shotsFile, "a", 1, { draft: false })).rejects.toThrow(
      "no visual review receipt"
    );
    expect(await readFile(f.path, "utf-8")).toBe(before);
  });
  it("review dry-run does not write a receipt", async () => {
    const f = await fixture();
    await runReview(f.shotsFile, {
      draft: false,
      dryRun: true,
      frames: 3,
      note: "Cash geometry changes",
      shot: "a",
      verdict: "rejected",
      version: 1,
    });
    await expect(
      readFile(join(f.dir, "visual-reviews.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("records rejection and blocks both use and latest stitching", async () => {
    const f = await fixture();
    await runReview(f.shotsFile, {
      draft: false,
      dryRun: false,
      frames: 3,
      note: "Cash geometry changes",
      shot: "a",
      verdict: "rejected",
      version: 1,
    });
    await expect(runUse(f.shotsFile, "a", 1, { draft: false })).rejects.toThrow(
      "visually rejected"
    );
    await expect(
      runStitch(f.shotsFile, { ...options, latest: true })
    ).rejects.toThrow("visually rejected");
  });
  it("latest cannot bypass rejection by falling back to a still", async () => {
    const f = await fixture();
    await writeFile(f.path, JSON.stringify({ entries: {}, version: 2 }));
    await expect(
      runStitch(f.shotsFile, { ...options, latest: true })
    ).rejects.toThrow("cannot substitute an unreviewed still");
  });
});
