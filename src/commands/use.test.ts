import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadManifest } from "../manifest.js";
import { runUse } from "./use.js";

describe("runUse", () => {
  it("selects an older downloaded revision without deleting the latest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-use-"));
    const shotsPath = join(dir, "shots.json");
    await writeFile(shotsPath, JSON.stringify({ film: {}, shots: [] }));
    await writeFile(join(dir, "v001.mp4"), "one");
    await writeFile(join(dir, "v002.mp4"), "two");
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({
        entries: {
          a: {
            attempts: 2,
            outputPath: "v002.mp4",
            selectedVersion: 2,
            shotId: "a",
            status: "downloaded",
            submittedAt: "2026-01-01T00:00:00.000Z",
            taskId: "task-2",
            updatedAt: "2026-01-01T00:00:00.000Z",
            versions: [
              {
                outputPath: "v001.mp4",
                status: "downloaded",
                submittedAt: "2026-01-01T00:00:00.000Z",
                taskId: "task-1",
                updatedAt: "2026-01-01T00:00:00.000Z",
                version: 1,
              },
              {
                outputPath: "v002.mp4",
                status: "downloaded",
                submittedAt: "2026-01-01T00:00:00.000Z",
                taskId: "task-2",
                updatedAt: "2026-01-01T00:00:00.000Z",
                version: 2,
              },
            ],
          },
        },
        shotsFile: shotsPath,
        version: 2,
      })
    );

    await runUse(shotsPath, "a", 1, { draft: false });

    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.selectedVersion).toBe(1);
    expect(manifest.entries.a?.outputPath).toBe("v001.mp4");
    expect(manifest.entries.a?.versions).toHaveLength(2);
  });
});
