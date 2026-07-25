import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lintShotsFile, loadShotsFile, loadStillsFile } from "../shots.js";
import { runInit } from "./init.js";

async function tmpFilm(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "vs-init-"));
  return join(parent, "demo");
}

describe("runInit", () => {
  it("scaffolds a schema-valid film with --yes", async () => {
    const dir = await tmpFilm();
    await runInit(dir, { force: false, yes: true });

    const file = await loadShotsFile(join(dir, "shots.json"));
    expect(file.film.title).toBe("demo");
    expect(file.shots).toHaveLength(2);
    // 720p native generation by default
    expect(file.film.defaults?.resolution).toBe("720p");
    // standalone, keyframe-anchored shots — no chaining in the scaffold
    expect(file.shots[1]?.continueFrom).toBeUndefined();
    expect(file.shots[1]?.references?.[0]?.role).toBe("first_frame");

    const stills = await loadStillsFile(join(dir, "stills.json"));
    // one literal keyframe still per scaffolded shot
    expect(stills.stills).toHaveLength(2);
  });

  it("honours an explicit title/ratio/duration", async () => {
    const dir = await tmpFilm();
    await runInit(dir, {
      duration: 12,
      force: false,
      ratio: "9:16",
      title: "My Film",
      yes: true,
    });
    const file = await loadShotsFile(join(dir, "shots.json"));
    expect(file.film.title).toBe("My Film");
    expect(file.film.defaults?.ratio).toBe("9:16");
    expect(file.film.defaults?.duration).toBe(12);
  });

  it("scaffolds a promptPreamble and lint-clean shots", async () => {
    const dir = await tmpFilm();
    await runInit(dir, {
      force: false,
      preamble: "Warm 35mm grain.",
      yes: true,
    });

    const file = await loadShotsFile(join(dir, "shots.json"));
    expect(file.film.promptPreamble).toBe("Warm 35mm grain.");
    // every shot pinned to a seed so a draft and its final stay reproducible
    expect(file.shots.every((shot) => shot.seed !== undefined)).toBe(true);
    expect(lintShotsFile(file)).toEqual([]);
  });

  it("fails fast rather than hanging when prompting without a TTY", async () => {
    const dir = await tmpFilm();
    const failure = await runInit(dir, { force: false, yes: false }).catch(
      (error: unknown) => error
    );
    expect((failure as Error & { code?: string }).code).toBe("not_interactive");
  });

  it("refuses to overwrite an existing film without --force", async () => {
    const dir = await tmpFilm();
    await runInit(dir, { force: false, yes: true });
    await expect(runInit(dir, { force: false, yes: true })).rejects.toThrow(
      /already has a shots\.json/u
    );
    // --force allows it
    await expect(
      runInit(dir, { force: true, yes: true })
    ).resolves.toBeUndefined();
  });
});
