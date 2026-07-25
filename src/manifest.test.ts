import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isComplete, isInFlight, upsertEntry } from "./manifest.js";
import type { Manifest, ManifestEntry } from "./types.js";

function emptyManifest(): Manifest {
  return { entries: {}, shotsFile: "shots.json", version: 1 };
}

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    attempts: 1,
    shotId: "shot-01",
    status: "submitted",
    submittedAt: "2026-01-01T00:00:00.000Z",
    taskId: "task-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("saveManifest", () => {
  it("serializes concurrent saves to the same manifest", async () => {
    const { loadManifest, saveManifest } = await import("./manifest.js");
    const dir = await mkdtemp(join(tmpdir(), "vs-manifest-race-"));
    const shotsPath = join(dir, "shots.json");
    const manifest = emptyManifest();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        upsertEntry(manifest, {
          shotId: `shot-${i}`,
          status: "submitted",
          taskId: `task-${i}`,
        });
        return saveManifest(shotsPath, manifest);
      })
    );
    const loaded = await loadManifest(shotsPath);
    expect(Object.keys(loaded.entries)).toHaveLength(20);
  });
});

describe("resume logic", () => {
  it("treats succeeded + existing file as complete (skip)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-manifest-"));
    await writeFile(join(dir, "out.mp4"), "data");
    expect(
      isComplete(entry({ outputPath: "out.mp4", status: "downloaded" }), dir)
    ).toBe(true);
  });

  it("treats succeeded with missing file as incomplete (resubmit)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-manifest-"));
    expect(
      isComplete(entry({ outputPath: "missing.mp4", status: "succeeded" }), dir)
    ).toBe(false);
  });

  it("treats queued/running entries as in flight (re-attach, never re-pay)", () => {
    expect(isInFlight(entry({ status: "running" }))).toBe(true);
    expect(isInFlight(entry({ status: "queued" }))).toBe(true);
    expect(isInFlight(entry({ status: "failed" }))).toBe(false);
    expect(isInFlight()).toBe(false);
  });

  it("drops the presigned result URL once the clip is downloaded", () => {
    const manifest = emptyManifest();
    upsertEntry(manifest, {
      shotId: "shot-01",
      status: "succeeded",
      taskId: "task-1",
      videoUrl:
        "https://tos.example.com/clip.mp4?X-Tos-Credential=AKLTsecret&X-Tos-Signature=abc",
    });
    expect(manifest.entries["shot-01"]?.videoUrl).toContain("X-Tos-Credential");

    upsertEntry(manifest, {
      outputPath: "shot-01.mp4",
      shotId: "shot-01",
      status: "downloaded",
    });
    const downloaded = manifest.entries["shot-01"];
    expect(downloaded?.videoUrl).toBeUndefined();
    expect(JSON.stringify(downloaded)).not.toContain("AKLT");
    // the rest of the audit trail survives
    expect(downloaded?.taskId).toBe("task-1");
    expect(downloaded?.outputPath).toBe("shot-01.mp4");
  });

  it("keeps the billed token count once a terminal update reports it", () => {
    const manifest = emptyManifest();
    upsertEntry(manifest, {
      shotId: "shot-01",
      status: "succeeded",
      taskId: "task-1",
      tokensUsed: 108_000,
      videoUrl: "https://x/clip.mp4",
    });
    expect(manifest.entries["shot-01"]?.tokensUsed).toBe(108_000);

    // The download update carries no usage; it must not erase the bill, which
    // is what `vs generate` reconciles its estimate against.
    upsertEntry(manifest, {
      outputPath: "shot-01.mp4",
      shotId: "shot-01",
      status: "downloaded",
    });
    expect(manifest.entries["shot-01"]?.tokensUsed).toBe(108_000);
  });

  it("upsertEntry increments attempts only on new submissions", () => {
    const manifest = emptyManifest();
    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-1",
    });
    upsertEntry(manifest, { shotId: "shot-01", status: "running" });
    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-2",
    });
    const result = manifest.entries["shot-01"];
    expect(result?.attempts).toBe(2);
    expect(result?.taskId).toBe("task-2");
  });
});
