import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCastSync } from "./cast.js";

const CHARACTERS = {
  characters: [
    {
      binding: "his face, build and wardrobe only",
      block: "a lean weathered man in a near-black wool coat",
      id: "keeper",
      name: "THE KEEPER",
      sheet: { seed: 4021 },
    },
  ],
};

/**
 * Key order is authored, not alphabetical, so the fixture is written as text
 * rather than from an object literal: the point of several of these tests is
 * that the order survives a round trip.
 */
const SHOTS = `{
  "film": {
    "title": "T",
    "model": "dreamina-seedance-2-5-260628"
  },
  "shots": [
    {
      "id": "a1",
      "prompt": "Use @Image 1 for the room.",
      "ratio": "16:9",
      "seed": 11,
      "cast": ["keeper"],
      "references": [
        { "type": "image", "url": "./stills/room.png", "role": "reference_image" }
      ]
    }
  ]
}
`;

const STILLS = `{
  "outputDir": "./stills",
  "stills": [
    { "id": "room", "prompt": "the room" }
  ]
}
`;

async function film(): Promise<{ shots: string; stills: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vs-cast-"));
  const shots = join(dir, "shots.json");
  const stills = join(dir, "stills.json");
  await writeFile(shots, SHOTS);
  await writeFile(stills, STILLS);
  await writeFile(
    join(dir, "characters.json"),
    JSON.stringify(CHARACTERS, null, 2)
  );
  return { shots, stills };
}

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf-8"));

afterEach(() => {
  process.exitCode = undefined;
});

describe("runCastSync --check", () => {
  it("writes nothing and exits non-zero when out of sync", async () => {
    const paths = await film();
    const before = await readFile(paths.shots, "utf-8");
    await runCastSync(paths.shots, { check: true });
    expect(process.exitCode).toBe(1);
    expect(await readFile(paths.shots, "utf-8")).toBe(before);
  });

  it("exits zero once the film is synced", async () => {
    const paths = await film();
    await runCastSync(paths.shots, { check: false });
    process.exitCode = undefined;
    await runCastSync(paths.shots, { check: true });
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runCastSync writes", () => {
  it("expands the cast into references and a castPrompt", async () => {
    const paths = await film();
    await runCastSync(paths.shots, { check: false });
    const shots = await readJson(paths.shots);
    const [shot] = shots.shots as Record<string, unknown>[];
    expect(shot?.castPrompt).toContain("use @Image 2 for");
    expect(shot?.references).toHaveLength(2);
    const stills = await readJson(paths.stills);
    expect(
      (stills.stills as Record<string, unknown>[]).map((s) => s.id)
    ).toEqual(["char-keeper", "room"]);
  });

  it("keeps the author's key order and puts castPrompt after prompt", async () => {
    // Serialising zod's output instead of the raw parse would reorder every
    // shot in the film into schema order on the very first sync.
    const paths = await film();
    await runCastSync(paths.shots, { check: false });
    const shots = await readJson(paths.shots);
    const [shot] = shots.shots as Record<string, unknown>[];
    expect(Object.keys(shot as object)).toEqual([
      "id",
      "prompt",
      "castPrompt",
      "ratio",
      "seed",
      "cast",
      "references",
    ]);
  });

  it("is a byte-for-byte no-op on the second run", async () => {
    const paths = await film();
    await runCastSync(paths.shots, { check: false });
    const once = await readFile(paths.shots, "utf-8");
    const onceStills = await readFile(paths.stills, "utf-8");
    await runCastSync(paths.shots, { check: false });
    expect(await readFile(paths.shots, "utf-8")).toBe(once);
    expect(await readFile(paths.stills, "utf-8")).toBe(onceStills);
  });

  it("prunes the sheet and the block when a character leaves the cast", async () => {
    const paths = await film();
    await runCastSync(paths.shots, { check: false });
    const synced = await readJson(paths.shots);
    const [first] = synced.shots as Record<string, unknown>[];
    (first as Record<string, unknown>).cast = [];
    await writeFile(paths.shots, JSON.stringify(synced, null, 2));
    await runCastSync(paths.shots, { check: false });
    const shots = await readJson(paths.shots);
    const [shot] = shots.shots as Record<string, unknown>[];
    expect(shot?.castPrompt).toBeUndefined();
    expect(shot?.references).toHaveLength(1);
    const stills = await readJson(paths.stills);
    expect(
      (stills.stills as Record<string, unknown>[]).map((s) => s.id)
    ).toEqual(["room"]);
  });

  it("leaves both files untouched when the plan would not load", async () => {
    // Validating the planned objects before writing is what makes a bad plan
    // impossible to land: the file that fails to parse is never written.
    const paths = await film();
    const pack = Array.from({ length: 30 }, (_, index) => ({
      role: "reference_image",
      type: "image",
      url: `./stills/p${index}.png`,
    }));
    const shots = await readJson(paths.shots);
    const [target] = shots.shots as Record<string, unknown>[];
    (target as Record<string, unknown>).references = pack;
    await writeFile(paths.shots, JSON.stringify(shots, null, 2));
    const before = await readFile(paths.shots, "utf-8");
    await expect(runCastSync(paths.shots, { check: false })).rejects.toThrow(
      /reference images/u
    );
    expect(await readFile(paths.shots, "utf-8")).toBe(before);
  });
});
