import { describe, expect, it } from "vitest";

import { stillIdFor, stillWaves } from "./stills.js";
import type { Still } from "./types.js";

const DIRS = { outputDir: "/film/stills", stillsDir: "/film" };

function still(id: string, references?: string[]): Still {
  return { id, prompt: `${id} prompt`, ...(references ? { references } : {}) };
}

const ids = (waves: Still[][]): string[][] =>
  waves.map((wave) => wave.map((s) => s.id));

describe("stillWaves", () => {
  it("keeps an independent file in one wave", () => {
    const waves = stillWaves([still("a"), still("b"), still("c")], DIRS);
    expect(ids(waves)).toEqual([["a", "b", "c"]]);
  });

  it("puts a still after the one whose png it references", () => {
    // The films/lighthouse shape: several keyframes chained off one plate.
    const waves = stillWaves(
      [
        still("s03", ["./stills/s02.png"]),
        still("s02"),
        still("s04", ["./stills/s02.png"]),
      ],
      DIRS
    );
    expect(ids(waves)).toEqual([["s02"], ["s03", "s04"]]);
  });

  it("orders a chain three deep", () => {
    const waves = stillWaves(
      [
        still("c", ["./stills/b.png"]),
        still("b", ["./stills/a.png"]),
        still("a"),
      ],
      DIRS
    );
    expect(ids(waves)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("ignores a reference to a plate no still in the file produces", () => {
    // An earlier run's output, or a likeness photo: already on disk, not an edge.
    const waves = stillWaves(
      [still("a", ["./refs/photo.jpg", "./stills/from-last-run.png"])],
      DIRS
    );
    expect(ids(waves)).toEqual([["a"]]);
  });

  it("ignores an https reference", () => {
    const waves = stillWaves([still("a", ["https://example.com/x.png"])], DIRS);
    expect(ids(waves)).toEqual([["a"]]);
  });

  it("does not make a still wait for itself", () => {
    // Self-reference is meaningless rather than cyclic: `vs stills --force`
    // over an existing png is a legitimate edit-in-place.
    const waves = stillWaves([still("a", ["./stills/a.png"])], DIRS);
    expect(ids(waves)).toEqual([["a"]]);
  });

  it("refuses a cycle instead of picking an arbitrary order", () => {
    expect(() =>
      stillWaves(
        [still("a", ["./stills/b.png"]), still("b", ["./stills/a.png"])],
        DIRS
      )
    ).toThrow(/cycle: a, b/u);
  });

  it("names only the stills actually stuck in the cycle", () => {
    expect(() =>
      stillWaves(
        [
          still("free"),
          still("a", ["./stills/b.png"]),
          still("b", ["./stills/a.png"]),
        ],
        DIRS
      )
    ).toThrow(/cycle: a, b$/mu);
  });

  it("treats a dependency outside the selection as already on disk", () => {
    // `vs stills --still s03` must not fail because s02 is not in the run.
    const waves = stillWaves([still("s03", ["./stills/s02.png"])], DIRS);
    expect(ids(waves)).toEqual([["s03"]]);
  });
});

describe("stillIdFor", () => {
  it("names the still that writes the referenced png", () => {
    expect(stillIdFor("./stills/keeper.png", DIRS)).toBe("keeper");
  });

  it("ignores a png outside the output directory", () => {
    expect(stillIdFor("./refs/keeper.png", DIRS)).toBeUndefined();
  });

  it("ignores a non-png reference in the output directory", () => {
    expect(stillIdFor("./stills/keeper.jpg", DIRS)).toBeUndefined();
  });

  it("ignores an https reference", () => {
    expect(stillIdFor("https://example.com/a.png", DIRS)).toBeUndefined();
  });
});
