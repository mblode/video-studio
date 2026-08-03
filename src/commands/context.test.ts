import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isVsError } from "../errors.js";
import { assertInteractive, packageInfo, resolveFilm } from "./context.js";

async function writeShots(outputDir?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-context-"));
  const path = join(dir, "shots.json");
  const film: Record<string, unknown> = { title: "Test" };
  if (outputDir !== undefined) {
    film.outputDir = outputDir;
  }
  await writeFile(
    path,
    JSON.stringify({ film, shots: [{ id: "shot-01", prompt: "a cat" }] })
  );
  return path;
}

describe("resolveFilm", () => {
  it("defaults outputDir to ./output beside the shots file", async () => {
    const { outputDir, shotsDir } = await resolveFilm(await writeShots());
    expect(outputDir).toBe(resolve(shotsDir, "output"));
  });

  it("honours film.outputDir", async () => {
    const { outputDir, shotsDir } = await resolveFilm(
      await writeShots("./clips")
    );
    expect(outputDir).toBe(resolve(shotsDir, "clips"));
  });

  it("resolves an explicit --output against the cwd, not the film dir", async () => {
    const { outputDir } = await resolveFilm(await writeShots("./clips"), {
      output: "./final",
    });
    expect(outputDir).toBe(resolve(process.cwd(), "final"));
  });

  it("ignores the draft suffix when --output is explicit", async () => {
    const { outputDir } = await resolveFilm(await writeShots("./clips"), {
      output: "./final",
      pass: "draft",
    });
    expect(outputDir).toBe(resolve(process.cwd(), "final"));
  });

  it("suffixes the output dir with -draft for a draft pass", async () => {
    const { outputDir, shotsDir } = await resolveFilm(
      await writeShots("./clips"),
      { pass: "draft" }
    );
    expect(outputDir).toBe(resolve(shotsDir, "clips-draft"));
  });
});

describe("assertInteractive", () => {
  const originalCi = process.env.CI;
  afterEach(() => {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  it("fails fast (rather than hanging) when stdin is not a TTY", () => {
    // vitest runs with a non-TTY stdin, which is exactly the agent/CI case.
    let caught: unknown;
    try {
      assertInteractive("--yes");
    } catch (error) {
      caught = error;
    }
    expect(isVsError(caught)).toBe(true);
    expect((caught as Error & { code: string }).code).toBe("not_interactive");
    expect((caught as Error & { hint?: string }).hint).toContain("--yes");
  });
});

describe("packageInfo", () => {
  it("finds this package's own manifest", () => {
    const info = packageInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(info.engines?.node).toBeDefined();
  });
});
