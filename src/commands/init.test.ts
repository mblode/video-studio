import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cancel, intro, isCancel, text } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lintShotsFile, loadShotsFile, loadStillsFile } from "../shots.js";
import { assertInteractive } from "./context.js";
import { runInit } from "./init.js";

// `spy: true` keeps the real implementations, so only the one test that has to
// simulate a TTY and a Ctrl-C overrides them (per-call, with `…Once`).
vi.mock("@clack/prompts", { spy: true });
vi.mock("./context.js", { spy: true });

async function tmpFilm(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "vs-init-"));
  return join(parent, "demo");
}

afterEach(() => {
  vi.resetAllMocks();
  process.exitCode = undefined;
});

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

  /**
   * Hand-written keyframe prompts are real work and there is no undo, so the
   * guard covers everything the scaffold writes — not just shots.json, which is
   * the one file a user is most likely to have moved out of the way.
   */
  it("refuses to clobber a hand-written stills.json or README even with no shots.json", async () => {
    const dir = await tmpFilm();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "stills.json"), '{"mine":true}');
    await writeFile(join(dir, "README.md"), "# mine");

    const failure = (await runInit(dir, { force: false, yes: true }).catch(
      (error: unknown) => error
    )) as Error & { code?: string };
    expect(failure.code).toBe("already_exists");
    expect(failure.message).toContain("stills.json");
    expect(failure.message).toContain("README.md");

    // nothing was written over
    expect(await readFile(join(dir, "stills.json"), "utf-8")).toBe(
      '{"mine":true}'
    );
    expect(await readFile(join(dir, "README.md"), "utf-8")).toBe("# mine");
  });

  /**
   * Declining is a decision, not a success. `vs init films/x && vs stills
   * films/x/stills.json` used to run the second command against a film that was
   * never written, because cancelling the title prompt exited 0.
   */
  it("exits non-zero and writes nothing when the operator cancels a prompt", async () => {
    const dir = await tmpFilm();
    // There is no TTY under vitest, so the interactive path has to be opened
    // deliberately; the cancel handling below is the code actually under test.
    vi.mocked(assertInteractive).mockImplementationOnce(() => {
      /* pretend this is a terminal */
    });
    vi.mocked(intro).mockImplementationOnce(() => {
      /* no banner in test output */
    });
    vi.mocked(cancel).mockImplementationOnce(() => {
      /* ditto */
    });
    vi.mocked(text).mockResolvedValueOnce("never read");
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      runInit(dir, { force: false, yes: false })
    ).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(existsSync(join(dir, "shots.json"))).toBe(false);
    expect(existsSync(join(dir, "stills.json"))).toBe(false);
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
      /already has shots\.json/u
    );
    // --force allows it
    await expect(
      runInit(dir, { force: true, yes: true })
    ).resolves.toBeUndefined();
  });
});
