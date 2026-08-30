import { describe, expect, it } from "vitest";

import { planCastSync } from "./cast.js";
import type { VsError } from "./errors.js";
import type { CharactersFile, ShotsFile, Still, StillsFile } from "./types.js";

const KEEPER = {
  binding: "his face, build and wardrobe only",
  block: "a lean weathered man in a near-black wool coat",
  id: "keeper",
  name: "THE KEEPER",
  sheet: { seed: 4021 },
};
const RELIEF = {
  binding: "her face, hair and wardrobe only",
  block: "a woman with cropped dark curls in a pale oilskin",
  id: "relief",
  name: "THE RELIEF",
  sheet: { seed: 4030 },
};

function characters(overrides: Partial<CharactersFile> = {}): CharactersFile {
  return { characters: [KEEPER, RELIEF], ...overrides };
}

const SEEDANCE_25 = "dreamina-seedance-2-5-260628";
const SEEDANCE_20 = "dreamina-seedance-2-0-260128";

function shotsFile(shots: ShotsFile["shots"], model = SEEDANCE_25): ShotsFile {
  return { film: { model, title: "T" }, shots };
}

const EMPTY_STILLS: StillsFile = { stills: [{ id: "plate", prompt: "p" }] };

function plan(shots: ShotsFile, chars = characters(), stills = EMPTY_STILLS) {
  return planCastSync({
    characters: chars,
    shots,
    stills,
    stillsRefPrefix: "./stills/",
  });
}

describe("planCastSync ordinals", () => {
  it("appends cast references after the hand-authored ones", () => {
    // The append rule is the whole safety story: a hand-authored @Image 1 in
    // the prompt must mean the same reference before and after a sync.
    const result = plan(
      shotsFile([
        {
          cast: ["keeper", "relief"],
          id: "a1",
          prompt: "Use @Image 1 for the room.",
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/room.png",
            },
          ],
        },
      ])
    );
    const shot = result.shots.get("a1");
    expect(shot?.references.map((ref) => ref.url)).toEqual([
      "./stills/room.png",
      "./stills/char-keeper.png",
      "./stills/char-relief.png",
    ]);
    expect(shot?.castPrompt).toBe(
      "THE KEEPER is a lean weathered man in a near-black wool coat; use @Image 2 for his face, build and wardrobe only. THE RELIEF is a woman with cropped dark curls in a pale oilskin; use @Image 3 for her face, hair and wardrobe only."
    );
  });

  it("leaves @Image 1 to a first_frame and starts the cast at 2", () => {
    const result = plan(
      shotsFile([
        {
          cast: ["keeper"],
          id: "a2",
          prompt: "The opening frame matches @Image 1.",
          references: [
            { role: "first_frame", type: "image", url: "./stills/open.png" },
          ],
        },
      ])
    );
    expect(result.shots.get("a2")?.castPrompt).toContain("use @Image 2 for");
    expect(result.shots.get("a2")?.references[0]?.role).toBe("first_frame");
  });

  it("counts ordinals per media type, so a video reference does not shift images", () => {
    const result = plan(
      shotsFile([
        {
          cast: ["keeper"],
          id: "a3",
          prompt: "Extend @Video 1.",
          references: [
            {
              role: "reference_video",
              type: "video",
              url: "https://example.com/clip.mp4",
            },
          ],
        },
      ])
    );
    expect(result.shots.get("a3")?.castPrompt).toContain("use @Image 1 for");
  });
});

describe("planCastSync is idempotent", () => {
  it("re-planning an already-synced shot changes nothing", () => {
    // Sync reads the hand-authored file every run by dropping what it wrote
    // last time; without that, references accumulate and ordinals drift.
    const first = plan(
      shotsFile([
        {
          cast: ["keeper"],
          id: "a1",
          prompt: "p",
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/room.png",
            },
          ],
        },
      ])
    );
    const synced = first.shots.get("a1");
    const second = plan(
      shotsFile([
        {
          cast: ["keeper"],
          castPrompt: synced?.castPrompt,
          id: "a1",
          prompt: "p",
          references: synced?.references,
        },
      ])
    );
    expect(second.shots.get("a1")).toEqual(first.shots.get("a1"));
  });

  it("drops the cast block and references when cast is removed", () => {
    const result = plan(
      shotsFile([
        {
          castPrompt: "stale text from an earlier run",
          id: "a1",
          prompt: "p",
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/room.png",
            },
            {
              cast: "keeper",
              role: "reference_image",
              type: "image",
              url: "./stills/char-keeper.png",
            },
          ],
        },
      ])
    );
    const shot = result.shots.get("a1");
    expect(shot?.castPrompt).toBeUndefined();
    expect(shot?.references).toHaveLength(1);
  });
});

describe("planCastSync and frame-mode-only models", () => {
  it("falls back to text only on a keyframed shot on Seedance 2.0", () => {
    // 2.0 refuses a frame mixed with reference images at load time, so binding
    // the sheet would write a file that no longer parses. The likeness rides in
    // the text instead, which is what the pipeline doctrine prescribes.
    const result = plan(
      shotsFile(
        [
          {
            cast: ["keeper"],
            id: "a1",
            prompt: "p",
            references: [
              { role: "first_frame", type: "image", url: "./stills/open.png" },
            ],
          },
        ],
        SEEDANCE_20
      )
    );
    const shot = result.shots.get("a1");
    expect(shot?.references).toHaveLength(1);
    expect(shot?.castPrompt).toBe(
      "THE KEEPER is a lean weathered man in a near-black wool coat."
    );
    expect(shot?.castPrompt).not.toContain("@Image");
  });

  it("still binds a reference-mode shot on the same 2.0 film", () => {
    // Per shot, not per film: the same character binds by ordinal here and by
    // text in the keyframed shot beside it.
    const result = plan(
      shotsFile([{ cast: ["keeper"], id: "a1", prompt: "p" }], SEEDANCE_20)
    );
    expect(result.shots.get("a1")?.castPrompt).toContain("use @Image 1 for");
  });

  it("generates no sheet for a character nothing binds", () => {
    const result = plan(
      shotsFile(
        [
          {
            cast: ["keeper"],
            id: "a1",
            prompt: "p",
            references: [
              { role: "first_frame", type: "image", url: "./stills/open.png" },
            ],
          },
        ],
        SEEDANCE_20
      )
    );
    expect(result.stills).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("has a sheet no shot binds");
  });
});

describe("planCastSync sheets", () => {
  it("composes a sheet prompt with the style and the no-text clause", () => {
    // Lettering baked into a sheet is rendered into the video by the model
    // that reads it, so the clause is load-bearing rather than decorative.
    const result = plan(
      shotsFile([{ cast: ["keeper"], id: "a1", prompt: "p" }]),
      characters({ style: "Stark black-and-white." })
    );
    const [sheet] = result.stills;
    expect(sheet?.id).toBe("char-keeper");
    expect(sheet?.cast).toBe("keeper");
    expect(sheet?.ratio).toBe("16:9");
    expect(sheet?.seed).toBe(4021);
    expect(sheet?.prompt).toContain("Stark black-and-white.");
    expect(sheet?.prompt).toContain("front view, three-quarter view");
    expect(sheet?.prompt).toContain("No text, no labels");
  });

  it("keeps the no-text clause out of a custom composition line", () => {
    const result = plan(
      shotsFile([{ cast: ["keeper"], id: "a1", prompt: "p" }]),
      characters({
        characters: [{ ...KEEPER, sheet: { prompt: "Seated at a desk." } }],
      })
    );
    expect(result.stills[0]?.prompt).toContain("Seated at a desk.");
  });

  it("clears a sheet field the character no longer sets", () => {
    // Merging over the existing still made removal impossible: dropping
    // `references` or `seed` left the old value in place, `--check` reported
    // the film in sync, and the sheet kept generating against a reference the
    // author had deleted.
    const shots = shotsFile([{ cast: ["keeper"], id: "a1", prompt: "p" }]);
    const withExtras = plan(
      shots,
      characters({
        characters: [
          {
            ...KEEPER,
            sheet: { references: ["./refs/keeper.jpg"], seed: 4021 },
          },
        ],
      })
    );
    expect(withExtras.stills[0]).toMatchObject({
      references: ["./refs/keeper.jpg"],
      seed: 4021,
    });

    // Same film, same still already on disk, but the character no longer sets
    // either field.
    const stripped = plan(
      shots,
      characters({ characters: [{ ...KEEPER, sheet: {} }] }),
      { stills: [withExtras.stills[0] as Still] }
    );
    expect(stripped.stills[0]?.references).toBeUndefined();
    expect(stripped.stills[0]?.seed).toBeUndefined();
  });

  it("refuses to overwrite a hand-written still that shares the derived id", () => {
    expect(() =>
      plan(
        shotsFile([{ cast: ["keeper"], id: "a1", prompt: "p" }]),
        characters(),
        {
          stills: [
            { id: "char-keeper", prompt: "a prompt someone wrote by hand" },
          ],
        }
      )
    ).toThrow(/was not generated by cast sync/u);
  });

  it("gives a variant its own sheet and block", () => {
    const result = plan(
      shotsFile([{ cast: ["keeper:young"], id: "a1", prompt: "p" }]),
      characters({
        characters: [
          {
            ...KEEPER,
            variants: [
              {
                block: "the same man at thirty",
                id: "young",
                sheet: { seed: 9 },
              },
            ],
          },
        ],
      })
    );
    expect(result.stills.map((sheet) => sheet.id)).toEqual([
      "char-keeper-young",
    ]);
    expect(result.shots.get("a1")?.castPrompt).toContain(
      "THE KEEPER is the same man at thirty"
    );
  });
});

describe("planCastSync refuses what generate would refuse", () => {
  it("errors when the cast pushes a shot past the model's reference slots", () => {
    // 2.0 documents nine reference images. Discovering that at `vs generate`
    // costs a run; discovering it here costs nothing.
    const pack = Array.from({ length: 9 }, (_, index) => ({
      role: "reference_image" as const,
      type: "image" as const,
      url: `./stills/p${index}.png`,
    }));
    expect(() =>
      plan(
        shotsFile(
          [{ cast: ["keeper"], id: "a1", prompt: "p", references: pack }],
          SEEDANCE_20
        )
      )
    ).toThrow(/accepts 9/u);
  });

  it("names the known characters when a cast entry is unknown", () => {
    // The way out belongs in the hint, where every other unknown-id error in
    // this CLI puts it.
    expect.assertions(2);
    try {
      plan(shotsFile([{ cast: ["skipper"], id: "a1", prompt: "p" }]));
    } catch (error) {
      expect((error as VsError).message).toContain('no character "skipper"');
      expect((error as VsError).hint).toBe("known: keeper, relief");
    }
  });

  it("rejects a malformed cast entry", () => {
    expect(() =>
      plan(shotsFile([{ cast: ["keeper:"], id: "a1", prompt: "p" }]))
    ).toThrow(/malformed/u);
  });

  it("ignores a repeated cast entry rather than burning two ordinals", () => {
    const result = plan(
      shotsFile([{ cast: ["keeper", "keeper"], id: "a1", prompt: "p" }])
    );
    expect(result.shots.get("a1")?.references).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("listed twice");
  });

  it("adopts an existing reference to the sheet in place", () => {
    // The migration path for a hand-authored film: point the reference you
    // already have at the sheet path and add `cast`. Appending a second copy
    // would duplicate the image AND shift every later ordinal, so the shot's
    // own @Image 3 would quietly start meaning something else.
    const result = plan(
      shotsFile([
        {
          cast: ["keeper"],
          id: "a1",
          prompt: "Use @Image 2 for the room.",
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/char-keeper.png",
            },
            {
              role: "reference_image",
              type: "image",
              url: "./stills/room.png",
            },
          ],
        },
      ])
    );
    const shot = result.shots.get("a1");
    expect(shot?.references).toHaveLength(2);
    expect(shot?.references[0]).toMatchObject({
      cast: "keeper",
      url: "./stills/char-keeper.png",
    });
    // Position kept, so the hand-written @Image 2 still means the room.
    expect(shot?.references[1]?.url).toBe("./stills/room.png");
    expect(shot?.castPrompt).toContain("use @Image 1 for");
    // Adopted counts as bound, so the sheet is still generated.
    expect(result.stills.map((sheet) => sheet.id)).toEqual(["char-keeper"]);
  });
});
