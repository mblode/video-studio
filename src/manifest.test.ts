import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isComplete,
  isInFlight,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "./manifest.js";
import type { Manifest, ManifestEntry } from "./types.js";

function emptyManifest(): Manifest {
  return { entries: {}, shotsFile: "shots.json", version: 2 };
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
        "https://tos.example.com/clip.mp4?X-Tos-Credential=credential-marker&X-Tos-Signature=signature-marker",
    });
    expect(manifest.entries["shot-01"]?.videoUrl).toContain("X-Tos-Credential");

    upsertEntry(manifest, {
      outputPath: "shot-01.mp4",
      shotId: "shot-01",
      status: "downloaded",
    });
    const downloaded = manifest.entries["shot-01"];
    expect(downloaded?.videoUrl).toBeUndefined();
    expect(JSON.stringify(downloaded)).not.toContain("credential-marker");
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
    expect(result?.versions?.map((revision) => revision.version)).toEqual([
      1, 2,
    ]);
  });

  it("keeps the selected good revision when a retake fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-manifest-retake-"));
    await writeFile(join(dir, "v001.mp4"), "good take");
    const manifest = emptyManifest();

    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-1",
    });
    upsertEntry(manifest, {
      outputPath: "v001.mp4",
      shotId: "shot-01",
      status: "downloaded",
      taskId: "task-1",
      tokensUsed: 100,
    });
    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-2",
    });
    upsertEntry(manifest, {
      error: "provider rejected the retake",
      shotId: "shot-01",
      status: "failed",
      taskId: "task-2",
    });

    const result = manifest.entries["shot-01"];
    expect(result?.status).toBe("failed");
    expect(result?.selectedVersion).toBe(1);
    expect(result?.outputPath).toBe("v001.mp4");
    expect(isComplete(result, dir)).toBe(true);
    expect(result?.versions).toHaveLength(2);
    expect(result?.tokensUsed).toBeUndefined();
    expect(result?.versions?.[0]?.tokensUsed).toBe(100);
  });

  it("scrubs an older presigned URL when a new attempt starts", () => {
    const manifest = emptyManifest();
    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-1",
    });
    upsertEntry(manifest, {
      shotId: "shot-01",
      status: "succeeded",
      taskId: "task-1",
      videoUrl: "https://x/first.mp4?credential-marker",
    });
    upsertEntry(manifest, {
      newAttempt: true,
      shotId: "shot-01",
      status: "submitted",
      taskId: "task-2",
    });

    expect(JSON.stringify(manifest)).not.toContain("credential-marker");
  });
});

describe("stale result URLs are healed on read", () => {
  const PRESIGNED =
    "https://x.example/clip.mp4?X-Tos-Credential=AKLTsecret&X-Tos-Signature=deadbeef";

  it("drops a v1 manifest's URL for a clip already on disk", async () => {
    // Manifests are committed on purpose, and older versions stored the
    // presigned URL next to a downloaded clip, so it became a credential in
    // git history. Reading one must clean it.
    const dir = await mkdtemp(join(tmpdir(), "vs-heal-"));
    const shotsFile = join(dir, "shots.json");
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({
        entries: {
          a: {
            attempts: 1,
            outputPath: "output/a.mp4",
            shotId: "a",
            status: "downloaded",
            submittedAt: "2026-06-16T08:02:42Z",
            taskId: "t1",
            updatedAt: "2026-06-16T08:02:42Z",
            videoUrl: PRESIGNED,
          },
        },
        shotsFile: "shots.json",
        version: 1,
      })
    );

    const manifest = await loadManifest(shotsFile);

    expect(JSON.stringify(manifest)).not.toContain("X-Tos-Credential");
    expect(manifest.entries.a?.videoUrl).toBeUndefined();
    // the migration still produced a usable revision
    expect(manifest.entries.a?.selectedVersion).toBe(1);
    expect(manifest.entries.a?.outputPath).toBe("output/a.mp4");
  });

  it("keeps the URL while the clip is not yet downloaded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-keep-"));
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({
        entries: {
          a: {
            attempts: 1,
            shotId: "a",
            status: "succeeded",
            submittedAt: "2026-06-16T08:02:42Z",
            taskId: "t1",
            updatedAt: "2026-06-16T08:02:42Z",
            videoUrl: PRESIGNED,
          },
        },
        shotsFile: "shots.json",
        version: 1,
      })
    );

    const manifest = await loadManifest(join(dir, "shots.json"));

    // `vs download` needs it: the clip exists remotely and not on disk.
    expect(manifest.entries.a?.videoUrl).toBe(PRESIGNED);
  });
});
