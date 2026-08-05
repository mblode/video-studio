import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadShotsFile, loadStillsFile } from "./shots.js";

async function writeShotsFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-shots-"));
  const path = join(dir, "shots.json");
  await writeFile(path, JSON.stringify(content));
  return path;
}

const validShot = { id: "shot-01", prompt: "a quiet street" };

const makeImageRefs = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    role: "reference_image" as const,
    type: "image" as const,
    url: `./s${i}.png`,
  }));

describe("loadShotsFile", () => {
  it("accepts a minimal valid file", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [validShot],
    });
    const file = await loadShotsFile(path);
    expect(file.shots).toHaveLength(1);
  });

  it("rejects duration outside the 4-30 schema envelope", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [{ ...validShot, duration: 31 }],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/duration|30/u);
  });

  it("accepts duration 24 inside the schema envelope (model caps apply at generate)", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [{ ...validShot, duration: 24 }],
    });
    const file = await loadShotsFile(path);
    expect(file.shots[0]?.duration).toBe(24);
  });

  it("rejects duplicate shot ids", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [validShot, validShot],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/duplicate shot id/u);
  });

  it("rejects http (non-https) video references", async () => {
    const path = await writeShotsFile({
      // A 2.0-era rule, so name 2.0 rather than leaning on the default.
      film: { model: "dreamina-seedance-2-0-260128", title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            {
              role: "reference_video",
              type: "video",
              url: "http://example.com/v.mp4",
            },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/https/u);
  });

  it("allows local paths for image references", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/a.png",
            },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).resolves.toBeDefined();
  });
});

describe("v2 validation", () => {
  it("rejects mixing first_frame with reference_image", async () => {
    const path = await writeShotsFile({
      // A 2.0-era rule, so name 2.0 rather than leaning on the default.
      film: { model: "dreamina-seedance-2-0-260128", title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            { role: "first_frame", type: "image", url: "./a.png" },
            { role: "reference_image", type: "image", url: "./b.png" },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/cannot be mixed/u);
  });

  it("rejects last_frame on a video reference", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            {
              role: "last_frame",
              type: "video",
              url: "https://example.com/v.mp4",
            },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/must be images/u);
  });

  it("lets Seedance 2.5 mix a first_frame with reference_image packs", async () => {
    const path = await writeShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          id: "a",
          prompt: "use @Image 1 for the plate, @Image 2 for her face",
          references: [
            { role: "first_frame", type: "image", url: "./a.png" },
            { role: "reference_image", type: "image", url: "./b.png" },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).resolves.toBeDefined();
  });

  it("accepts duration -1, 15, and 30; rejects 0 and 31", async () => {
    const ok = await writeShotsFile({
      film: { title: "T" },
      shots: [
        { duration: -1, id: "a", prompt: "p" },
        { duration: 15, id: "b", prompt: "p" },
        { duration: 30, id: "c", prompt: "p" },
      ],
    });
    await expect(loadShotsFile(ok)).resolves.toBeDefined();
    for (const duration of [0, 31]) {
      const bad = await writeShotsFile({
        film: { title: "T" },
        shots: [{ duration, id: "a", prompt: "p" }],
      });
      await expect(loadShotsFile(bad)).rejects.toThrow(/invalid/u);
    }
  });

  it("validates card placement", async () => {
    const bad = await writeShotsFile({
      cards: [{ after: "nope", text: "X" }],
      film: { title: "T" },
      shots: [validShot],
    });
    await expect(loadShotsFile(bad)).rejects.toThrow(/existing shot id/u);
    const ok = await writeShotsFile({
      cards: [
        { after: "start", text: "A" },
        { after: "shot-01", text: "B" },
        { after: "end", text: "C" },
      ],
      film: { title: "T" },
      shots: [validShot],
    });
    await expect(loadShotsFile(ok)).resolves.toBeDefined();
  });

  it("lintShotsFile warns on >5 refs for Seedance 2.0 (default model)", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const refs = Array.from({ length: 6 }, (_, i) => ({
      role: "reference_image" as const,
      type: "image" as const,
      url: `./s${i}.png`,
    }));
    const warnings = lintShotsFile({
      film: { title: "T" },
      shots: [{ id: "a", prompt: "p", references: refs }],
    });
    expect(warnings.some((w) => w.includes("6 references"))).toBe(true);
  });

  it("lintShotsFile warns when a shot has no image anchor", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { title: "T" },
      shots: [{ id: "a", prompt: "p", seed: 1 }],
    });
    expect(warnings.some((w) => w.includes("no image reference"))).toBe(true);
  });

  it("lintShotsFile uses a ~16 ref soft cap on Seedance 2.5", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const film25 = { model: "dreamina-seedance-2-5-260628", title: "T" };
    // A 14-ref ordinal pack is the design idiom and must not warn.
    const ok = lintShotsFile({
      film: film25,
      shots: [{ id: "a", prompt: "p", references: makeImageRefs(14), seed: 1 }],
    });
    expect(ok.some((w) => w.includes("references —"))).toBe(false);
    const heavy = lintShotsFile({
      film: film25,
      shots: [{ id: "b", prompt: "p", references: makeImageRefs(17), seed: 1 }],
    });
    expect(heavy.some((w) => w.includes("17 references"))).toBe(true);
    expect(heavy.some((w) => w.includes("~16"))).toBe(true);
  });

  it("warns when a prompt binds an ordinal the shot does not carry", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          id: "a",
          prompt: "use @Image 1 for her face and @Image 3 for the room",
          references: makeImageRefs(2),
          seed: 1,
        },
      ],
    });
    expect(warnings.some((w) => w.includes("binds image ordinal 3"))).toBe(
      true
    );
  });

  it("warns when a 2.5 shot supplies references but binds none by ordinal", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          id: "a",
          prompt: "0-8s: she crosses the room. 9-20s: she opens the door.",
          references: makeImageRefs(3),
          seed: 1,
        },
      ],
    });
    expect(warnings.some((w) => w.includes("never binds one by ordinal"))).toBe(
      true
    );
  });

  it("requires a timestamp plan past 20s on 2.5, not just Shot N:", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const shotBeats = lintShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          duration: 30,
          id: "a",
          prompt: "Shot 1: she waits. Shot 2: she runs. Shot 3: she stops.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    expect(shotBeats.some((w) => w.includes("no timestamp plan"))).toBe(true);

    const timestamped = lintShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          duration: 30,
          id: "a",
          prompt: "0-10s: she waits. 11-20s: she runs. 21-30s: she stops.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    expect(timestamped.some((w) => w.includes("no timestamp plan"))).toBe(
      false
    );
  });

  it("wants a mixed-mode frame role first, so image ordinals do not shift", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [
        {
          id: "a",
          prompt: "use @Image 1 for the pack",
          references: [
            {
              role: "reference_image",
              type: "image",
              url: "./stills/pack.png",
            },
            { role: "first_frame", type: "image", url: "./stills/key.png" },
          ],
          seed: 1,
        },
      ],
    });
    expect(warnings.some((w) => w.includes("is not the first reference"))).toBe(
      true
    );
  });

  it("warns that a draft model which cannot render the shots will refuse the run", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: {
        draftModel: "dreamina-seedance-2-0-fast-260128",
        model: "dreamina-seedance-2-5-260628",
        title: "T",
      },
      shots: [
        {
          duration: 30,
          id: "a1",
          prompt: "0-15s: one. 16-30s: two.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    const warning = warnings.find((w) => w.includes("film.draftModel"));
    expect(warning).toBeDefined();
    expect(warning).toContain("a1");
    expect(warning).toContain("Unset film.draftModel");
  });

  it("lintShotsFile warns when a long shot lacks a beat carrier", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const bare = lintShotsFile({
      film: { title: "T" },
      shots: [
        {
          duration: 24,
          id: "long",
          prompt: "She walks toward the tower in the wind.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    expect(bare.some((w) => w.includes("no beat carrier"))).toBe(true);

    const stamped = lintShotsFile({
      film: { title: "T" },
      shots: [
        {
          duration: 24,
          id: "ok",
          prompt:
            "0–8s: she climbs the path. 9–16s: the key turns. 17–24s: the door opens.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    expect(stamped.some((w) => w.includes("no beat carrier"))).toBe(false);

    const short = lintShotsFile({
      film: { title: "T" },
      shots: [
        {
          duration: 6,
          id: "brief",
          prompt: "A latch clicks shut.",
          references: makeImageRefs(1),
          seed: 1,
        },
      ],
    });
    expect(short.some((w) => w.includes("no beat carrier"))).toBe(false);
  });

  it("lintShotsFile warns on a shot with no seed", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { title: "T" },
      shots: [
        { id: "seeded", prompt: "p", seed: 7 },
        { id: "unseeded", prompt: "p" },
      ],
    });
    const noSeed = warnings.filter((w) => w.includes("no seed"));
    expect(noSeed).toHaveLength(1);
    expect(noSeed[0]?.startsWith("unseeded: no seed")).toBe(true);
  });

  it("lintShotsFile warns on cameraFixed combined with an image reference (i2v)", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { title: "T" },
      shots: [
        {
          cameraFixed: true,
          id: "locked",
          prompt: "p",
          references: [{ role: "first_frame", type: "image", url: "./k.png" }],
          seed: 1,
        },
      ],
    });
    expect(warnings.some((w) => w.includes("cameraFixed"))).toBe(true);
  });

  it("lintShotsFile warns when a prompt (incl. preamble) exceeds ~400 words", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const bloated = Array.from({ length: 420 }, () => "word").join(" ");
    const multiBeat = Array.from({ length: 300 }, () => "word").join(" ");
    const warnings = lintShotsFile({
      // A 2.0-era rule, so name 2.0 rather than leaning on the default.
      film: { model: "dreamina-seedance-2-0-260128", title: "T" },
      shots: [
        { id: "multibeat", prompt: multiBeat, seed: 1 },
        { id: "bloated", prompt: bloated, seed: 2 },
      ],
    });
    const tooLong = warnings.filter((w) => w.includes("words"));
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0]?.startsWith("bloated: prompt is 420 words")).toBe(true);
  });

  it("lintShotsFile warns on a cluster of 3+ slow/soft motion terms", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const warnings = lintShotsFile({
      film: { title: "T" },
      shots: [
        {
          id: "brisk",
          prompt: "he sprints across the yard and gently taps the gate",
          seed: 1,
        },
        {
          id: "languid",
          prompt:
            "she slowly drifts down the hall, gently holding a candle, the light creeps tenderly across the wall",
          seed: 2,
        },
      ],
    });
    const slow = warnings.filter((w) => w.includes("slow/soft motion terms"));
    expect(slow).toHaveLength(1);
    expect(slow[0]?.startsWith("languid:")).toBe(true);
  });

  it("lintShotsFile counts the promptPreamble toward the word budget", async () => {
    const { lintShotsFile } = await import("./shots.js");
    const preamble = Array.from({ length: 400 }, () => "style").join(" ");
    const warnings = lintShotsFile({
      film: {
        model: "dreamina-seedance-2-0-260128",
        promptPreamble: preamble,
        title: "T",
      },
      shots: [
        { id: "s", prompt: "a calm single action beat here now", seed: 1 },
      ],
    });
    expect(warnings.some((w) => w.includes("incl. promptPreamble"))).toBe(true);
  });
});

describe("path safety", () => {
  it("rejects a shot output that escapes the film directory", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [{ ...validShot, output: "../escape.mp4" }],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/stay within/u);
  });

  it("rejects an absolute shot output", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [{ ...validShot, output: "/tmp/escape.mp4" }],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/stay within/u);
  });

  it("rejects a local image reference that escapes the film directory", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            { role: "reference_image", type: "image", url: "../../.env.png" },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/stay within/u);
  });

  it("still accepts a safe local image reference and an https one", async () => {
    const path = await writeShotsFile({
      film: { title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            { role: "reference_image", type: "image", url: "./stills/a.png" },
          ],
        },
      ],
    });
    await expect(loadShotsFile(path)).resolves.toBeDefined();
  });

  it("rejects a still reference that escapes the film directory", async () => {
    const path = await writeShotsFile({
      stills: [{ id: "a", prompt: "p", references: ["../secret.png"] }],
    });
    await expect(loadStillsFile(path)).rejects.toThrow(/stay within/u);
  });

  it("accepts safe and remote still references", async () => {
    const path = await writeShotsFile({
      stills: [
        {
          id: "a",
          prompt: "p",
          references: ["./refs/a.png", "https://example.com/b.png"],
        },
      ],
    });
    await expect(loadStillsFile(path)).resolves.toBeDefined();
  });
});

describe("loadStillsFile", () => {
  it("rejects duplicate still ids", async () => {
    const path = await writeShotsFile({
      stills: [
        { id: "a", prompt: "p" },
        { id: "a", prompt: "q" },
      ],
    });
    await expect(loadStillsFile(path)).rejects.toThrow(/duplicate still id/u);
  });
});

/**
 * A misspelled key used to parse fine and do nothing at all, so the user got a
 * shot with no locked camera, no preamble, and no explanation.
 */
describe("strict schemas", () => {
  async function loadError(content: unknown) {
    const path = await writeShotsFile(content);
    return (await loadShotsFile(path).catch((error: unknown) => error)) as
      | (Error & { code?: string; hint?: string })
      | undefined;
  }

  it("rejects a typo'd shot key and names it", async () => {
    const error = await loadError({
      film: { title: "T" },
      shots: [{ ...validShot, cameraFixxed: true }],
    });
    expect(error?.code).toBe("invalid_input");
    expect(error?.message).toContain("cameraFixxed");
    expect(error?.hint).toContain("spelling");
  });

  it("rejects a typo'd film key", async () => {
    const error = await loadError({
      film: { promptPremble: "style", title: "T" },
      shots: [validShot],
    });
    expect(error?.message).toContain("promptPremble");
  });

  it("rejects unknown keys in film.defaults, cards, and references", async () => {
    const defaults = await loadError({
      film: { defaults: { resolutions: "720p" }, title: "T" },
      shots: [validShot],
    });
    expect(defaults?.message).toContain("resolutions");

    const card = await loadError({
      cards: [{ after: "start", colour: "red", text: "X" }],
      film: { title: "T" },
      shots: [validShot],
    });
    expect(card?.message).toContain("colour");

    const reference = await loadError({
      film: { title: "T" },
      shots: [
        {
          ...validShot,
          references: [
            {
              role: "first_frame",
              strength: 0.5,
              type: "image",
              url: "./a.png",
            },
          ],
        },
      ],
    });
    expect(reference?.message).toContain("strength");
  });

  it("rejects a typo'd still key", async () => {
    const path = await writeShotsFile({
      stills: [{ id: "a", prompt: "p", sized: "2K" }],
    });
    await expect(loadStillsFile(path)).rejects.toThrow(/sized/u);
  });
});

describe("loadJson failures", () => {
  it("points a missing file at the path and at `vs init`", async () => {
    const failure = (await loadShotsFile("/nope/does-not-exist.json").catch(
      (error: unknown) => error
    )) as Error & { code?: string; hint?: string };
    expect(failure.code).toBe("file_not_found");
    expect(failure.message).toContain("/nope/does-not-exist.json");
    expect(failure.hint).toContain("vs init");
  });

  it("says what to look for in malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-shots-"));
    const path = join(dir, "shots.json");
    await writeFile(path, '{ "film": { "title": "T" }, }');
    const failure = (await loadShotsFile(path).catch(
      (error: unknown) => error
    )) as Error & { code?: string; hint?: string };
    expect(failure.code).toBe("invalid_input");
    expect(failure.message).toContain("not valid JSON");
    expect(failure.hint).toContain("trailing comma");
  });
});

describe("lintStillsFile", () => {
  it("warns on a bloated prompt but no longer demands a seed", async () => {
    // The seed advice went with Seedream: Nano Banana rolls its own, so telling
    // an author to set one was pointing at a field the model discards.
    const { lintStillsFile } = await import("./shots.js");
    const warnings = lintStillsFile({
      stills: [
        { id: "unseeded", prompt: "one clean composition" },
        {
          id: "bloated",
          prompt: Array.from({ length: 220 }, () => "word").join(" "),
        },
      ],
    });
    expect(warnings.filter((w) => w.includes("no seed"))).toHaveLength(0);
    const long = warnings.find((w) => w.includes("220 words"));
    expect(long?.startsWith("bloated:")).toBe(true);
  });

  it("warns that a pixel size is ignored, whatever the model", async () => {
    // Stills run on Nano Banana, which takes a ratio rather than pixels. The
    // warning used to be conditional because Seedream honoured `size`; that
    // backend is gone, so a `size` anywhere is now dead config.
    const { lintStillsFile } = await import("./shots.js");
    const warnings = lintStillsFile({
      model: "gemini-3-pro-image",
      stills: [{ id: "a", prompt: "p", size: "2560x1440" }],
    });
    expect(warnings.some((w) => w.includes("ignored"))).toBe(true);
    expect(
      lintStillsFile({
        model: "gemini-3-pro-image",
        stills: [{ id: "a", prompt: "p", ratio: "1:1" }],
      })
    ).toEqual([]);
  });

  it("warns only about local references that are not on disk", async () => {
    const { lintStillsFile } = await import("./shots.js");
    const dir = await mkdtemp(join(tmpdir(), "vs-stills-"));
    await writeFile(join(dir, "here.png"), "png");
    const warnings = lintStillsFile(
      {
        stills: [
          {
            id: "a",
            prompt: "p",
            references: [
              "./here.png",
              "./gone.png",
              "https://example.com/remote.png",
            ],
            seed: 1,
          },
        ],
      },
      { stillsDir: dir }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("gone.png");
  });

  it("checks nothing on disk without a stillsDir", async () => {
    const { lintStillsFile } = await import("./shots.js");
    expect(
      lintStillsFile({
        stills: [{ id: "a", prompt: "p", references: ["./gone.png"], seed: 1 }],
      })
    ).toEqual([]);
  });
});

const videoShot = (url: string) => ({
  duration: 30,
  id: "a1",
  prompt: "0-15s: one. 16-30s: two. use @Video 1 for the source",
  references: [{ role: "reference_video", type: "video", url }],
  seed: 1,
});

describe("video references: region edit and extend", () => {
  it("lets Seedance 2.5 bind a local clip, which is what region edit and extend need", async () => {
    const path = await writeShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [videoShot("./output/clips/a1/v001.mp4")],
    });
    await expect(loadShotsFile(path)).resolves.toBeDefined();
  });

  it("refuses a local clip on 2.0 and names the workaround", async () => {
    const path = await writeShotsFile({
      // A 2.0-era rule, so name 2.0 rather than leaning on the default.
      film: { model: "dreamina-seedance-2-0-260128", title: "T" },
      shots: [videoShot("./output/clips/a1/v001.mp4")],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/Upload the clip/u);
  });

  it("still refuses a video path that escapes the film directory", async () => {
    const path = await writeShotsFile({
      film: { model: "dreamina-seedance-2-5-260628", title: "T" },
      shots: [videoShot("../../etc/passwd.mp4")],
    });
    await expect(loadShotsFile(path)).rejects.toThrow(/film directory/u);
  });
});

describe("file read errors map to the right code", () => {
  it("reports a directory as file_unreadable, not file_not_found", async () => {
    // Catching every read error as file_not_found sent the reader to fix the
    // path, which was the one thing that was never wrong.
    const dir = await mkdtemp(join(tmpdir(), "vs-dir-"));
    await expect(loadShotsFile(dir)).rejects.toThrow(/it is a directory/u);
  });

  it("still reports a genuinely missing file as file_not_found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-gone-"));
    // Regression guard: the missing-file branch takes a callback, and passing
    // it unbound made it run with no path at all.
    await expect(loadShotsFile(join(dir, "nope.json"))).rejects.toThrow(
      /cannot read .*nope\.json/u
    );
  });
});

describe("stills schema refuses what the image backend cannot read", () => {
  it("rejects ratio: adaptive on a still", async () => {
    // `adaptive` asks a VIDEO model to derive the frame from a reference clip.
    // A still has none, and the image API wants a literal {w}:{h}, so this used
    // to be cast to a numeric ratio and sent as the string "adaptive".
    const dir = await mkdtemp(join(tmpdir(), "vs-stills-"));
    const path = join(dir, "stills.json");
    await writeFile(
      path,
      JSON.stringify({
        stills: [{ id: "a", prompt: "p", ratio: "adaptive" }],
      })
    );

    await expect(loadStillsFile(path)).rejects.toThrow(/ratio/u);
  });

  it("rejects a reference that is not an image", async () => {
    // Anything else is read as raw bytes and posted as an image, which
    // generates something unrelated rather than failing.
    const dir = await mkdtemp(join(tmpdir(), "vs-stills-"));
    const path = join(dir, "stills.json");
    await writeFile(
      path,
      JSON.stringify({
        stills: [{ id: "a", prompt: "p", references: ["./notes.txt"] }],
      })
    );

    await expect(loadStillsFile(path)).rejects.toThrow(/png\/jpg\/jpeg\/webp/u);
  });

  it("still accepts a literal ratio and an image reference", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-stills-"));
    const path = join(dir, "stills.json");
    await writeFile(
      path,
      JSON.stringify({
        ratio: "1:1",
        stills: [{ id: "a", prompt: "p", references: ["./face.png"] }],
      })
    );

    const file = await loadStillsFile(path);
    expect(file.stills[0]?.references).toEqual(["./face.png"]);
  });
});
