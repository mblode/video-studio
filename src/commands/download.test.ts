import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadManifest } from "../manifest.js";
import { runDownload } from "./download.js";

vi.mock("../download.js", () => ({
  downloadFile: vi.fn(async (_url: string, outputPath: string) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "video");
  }),
}));

async function scaffold(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-dl-cmd-"));
  const shotsPath = join(dir, "shots.json");
  await writeFile(
    shotsPath,
    JSON.stringify({ film: { title: "T" }, shots: [{ id: "a", prompt: "p" }] })
  );
  await writeFile(
    join(dir, "tasks.json"),
    JSON.stringify({
      entries: {
        a: {
          attempts: 1,
          shotId: "a",
          status: "succeeded",
          submittedAt: "2026-01-01T00:00:00.000Z",
          taskId: "task-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          videoUrl: "https://x/a.mp4",
        },
      },
      shotsFile: shotsPath,
      version: 1,
    })
  );
  return shotsPath;
}

describe("runDownload", () => {
  it("takes the shots file positionally", async () => {
    const shotsPath = await scaffold();
    await runDownload(shotsPath, {
      draft: false,
      shots: shotsPath,
    });

    expect(
      existsSync(join(dirname(shotsPath), "output", "clips", "a", "v001.mp4"))
    ).toBe(true);
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.status).toBe("downloaded");
  });

  it("resolves --output against the cwd, not the film directory", async () => {
    const shotsPath = await scaffold();
    const dest = await mkdtemp(join(tmpdir(), "vs-dl-out-"));
    await runDownload(shotsPath, {
      draft: false,
      output: dest,
      shots: shotsPath,
    });

    expect(existsSync(join(dest, "clips", "a", "v001.mp4"))).toBe(true);
    expect(existsSync(join(dirname(shotsPath), "output", "a.mp4"))).toBe(false);
  });

  it("downloads the latest retake even when an older selection exists", async () => {
    const shotsPath = await scaffold();
    const filmDir = dirname(shotsPath);
    const first = join(filmDir, "output", "clips", "a", "v001.mp4");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "first take");
    await writeFile(
      join(filmDir, "tasks.json"),
      JSON.stringify({
        entries: {
          a: {
            attempts: 2,
            outputPath: "output/clips/a/v001.mp4",
            selectedVersion: 1,
            shotId: "a",
            status: "succeeded",
            submittedAt: "2026-01-01T00:00:00.000Z",
            taskId: "task-2",
            updatedAt: "2026-01-01T00:00:00.000Z",
            versions: [
              {
                outputPath: "output/clips/a/v001.mp4",
                status: "downloaded",
                submittedAt: "2026-01-01T00:00:00.000Z",
                taskId: "task-1",
                updatedAt: "2026-01-01T00:00:00.000Z",
                version: 1,
              },
              {
                status: "succeeded",
                submittedAt: "2026-01-01T00:01:00.000Z",
                taskId: "task-2",
                updatedAt: "2026-01-01T00:02:00.000Z",
                version: 2,
                videoUrl: "https://x/a-v2.mp4",
              },
            ],
            videoUrl: "https://x/a-v2.mp4",
          },
        },
        shotsFile: shotsPath,
        version: 2,
      })
    );

    await runDownload(shotsPath, {
      draft: false,
      shots: shotsPath,
    });

    expect(existsSync(join(filmDir, "output", "clips", "a", "v002.mp4"))).toBe(
      true
    );
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.selectedVersion).toBe(2);
  });
});
