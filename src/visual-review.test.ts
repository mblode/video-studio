import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Shot } from "./types.js";
import { assertVisualApproval, recordVisualReview } from "./visual-review.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "vs-visual-review-"));
  const shotsFile = join(dir, "shots.json");
  const mediaPath = "clip.mp4";
  const shot: Shot = {
    cast: ["eric", "victor"],
    id: "a",
    prompt: "test",
    references: [
      { cast: "eric", role: "reference_image", type: "image", url: "eric.png" },
      {
        cast: "victor",
        role: "reference_image",
        type: "image",
        url: "victor.png",
      },
    ],
  };
  await writeFile(shotsFile, "{}");
  await writeFile(join(dir, mediaPath), "media");
  await writeFile(join(dir, "eric.png"), "eric");
  await writeFile(join(dir, "victor.png"), "victor");
  return { dir, mediaPath, shot, shotsFile };
}

describe("visual review receipts", () => {
  it("records and verifies an explicit approval bound to media and cast bytes", async () => {
    const input = await fixture();
    await recordVisualReview({
      ...input,
      note: "faces and motion match",
      pass: "final",
      verdict: "approved",
      version: 2,
    });
    await expect(
      assertVisualApproval({ ...input, pass: "final", version: 2 })
    ).resolves.toMatchObject({
      note: "faces and motion match",
      verdict: "approved",
    });
    const stored = JSON.parse(
      await readFile(join(input.dir, "visual-reviews.json"), "utf-8")
    );
    expect(stored.receipts["final:a:v2"].media.sha256).toHaveLength(64);
  });

  it("rejects an explicit rejection and stale media or canonical cast", async () => {
    const input = await fixture();
    await recordVisualReview({
      ...input,
      note: "identity drift",
      pass: "final",
      verdict: "rejected",
      version: 1,
    });
    await expect(
      assertVisualApproval({ ...input, pass: "final", version: 1 })
    ).rejects.toThrow("visually rejected");
    await recordVisualReview({
      ...input,
      note: "approved",
      pass: "final",
      verdict: "approved",
      version: 1,
    });
    await writeFile(join(input.dir, input.mediaPath), "changed");
    await expect(
      assertVisualApproval({ ...input, pass: "final", version: 1 })
    ).rejects.toThrow("approval is stale");
    await writeFile(join(input.dir, input.mediaPath), "media");
    await writeFile(join(input.dir, "eric.png"), "changed cast");
    await expect(
      assertVisualApproval({ ...input, pass: "final", version: 1 })
    ).rejects.toThrow("approval is stale");
  });

  it("refuses a cast shot unless every declared character has exactly one reference", async () => {
    const input = await fixture();
    input.shot.references = input.shot.references?.filter(
      (reference) => reference.cast !== "victor"
    );
    await expect(
      recordVisualReview({
        ...input,
        note: "looks okay",
        pass: "final",
        verdict: "approved",
        version: 1,
      })
    ).rejects.toThrow("needs exactly one canonical image reference");
  });

  it("accepts local absolute paths and rejects remote canonical references", async () => {
    const input = await fixture();
    input.mediaPath = join(input.dir, input.mediaPath);
    await expect(
      recordVisualReview({
        ...input,
        note: "local absolute media",
        pass: "final",
        verdict: "approved",
        version: 1,
      })
    ).resolves.toBeDefined();
    const firstReference = input.shot.references?.[0];
    if (!firstReference) {
      throw new Error("fixture is missing its first reference");
    }
    firstReference.url = "https://example.com/eric.png";
    await expect(
      recordVisualReview({
        ...input,
        note: "remote ref",
        pass: "final",
        verdict: "approved",
        version: 2,
      })
    ).rejects.toThrow("cannot hash remote URL");
  });

  it("rejects orphan cast references and invalid runtime verdicts", async () => {
    const input = await fixture();
    input.shot.cast = [];
    await expect(
      recordVisualReview({
        ...input,
        note: "orphan refs",
        pass: "final",
        verdict: "approved",
        version: 1,
      })
    ).rejects.toThrow("binds undeclared cast");
    await expect(
      recordVisualReview({
        ...input,
        note: "bad verdict",
        pass: "final",
        verdict: "maybe" as never,
        version: 1,
      })
    ).rejects.toThrow("must be approved or rejected");
  });

  it("serializes concurrent receipts without losing a different shot", async () => {
    const input = await fixture();
    const second = {
      ...input,
      shot: { ...input.shot, id: "b" },
    };
    await Promise.all([
      recordVisualReview({
        ...input,
        note: "a approved",
        pass: "final",
        verdict: "approved",
        version: 1,
      }),
      recordVisualReview({
        ...second,
        note: "b approved",
        pass: "final",
        verdict: "approved",
        version: 1,
      }),
    ]);
    const stored = JSON.parse(
      await readFile(join(input.dir, "visual-reviews.json"), "utf-8")
    );
    expect(Object.keys(stored.receipts).toSorted()).toEqual([
      "final:a:v1",
      "final:b:v1",
    ]);
  });
});
