import { describe, expect, it } from "vitest";

import { cardSvg, cardVideoArgs, wrapCardText } from "./cards.js";
import {
  buildStitchPlan,
  computeXfadeOffsets,
  concatListContent,
  orderTimeline,
} from "./stitch.js";
import type { StitchClip, StitchOptions } from "./stitch.js";
import type { Shot, TitleCard } from "./types.js";

const shot = (id: string): Shot => ({ id, prompt: "p" });
const clips: StitchClip[] = [
  { duration: 8, path: "/a/shot-01.mp4" },
  { duration: 10, path: "/a/shot-02.mp4" },
  { duration: 6, path: "/a/shot-03.mp4" },
];

function options(overrides: Partial<StitchOptions> = {}): StitchOptions {
  return {
    cardPaths: new Map(),
    concatListPath: "/a/list.txt",
    font: "/fonts/F.ttc",
    musicGainDb: -18,
    outputPath: "/a/out.mp4",
    xfade: 0,
    ...overrides,
  };
}

describe("computeXfadeOffsets", () => {
  it("two clips", () => {
    expect(computeXfadeOffsets([8, 10], 0.5)).toEqual([7.5]);
  });

  it("four clips accumulate the xfade per join", () => {
    expect(computeXfadeOffsets([8, 10, 6, 4], 0.5)).toEqual([7.5, 17, 22.5]);
  });

  it("accepts per-junction fade arrays", () => {
    expect(computeXfadeOffsets([8, 10, 6], [0.05, 0.9])).toEqual([7.95, 17.05]);
  });
});

describe("orderTimeline", () => {
  it("places cards at start, after a shot, and at end", () => {
    const cards: TitleCard[] = [
      { after: "end", text: "End" },
      { after: "start", text: "Start" },
      { after: "s1", text: "Mid" },
    ];
    const timeline = orderTimeline([shot("s1"), shot("s2")], cards);
    expect(
      timeline.map((t) => (t.kind === "shot" ? t.shot.id : t.card.text))
    ).toEqual(["Start", "s1", "Mid", "s2", "End"]);
  });
});

describe("buildStitchPlan", () => {
  it("lossless concat when no xfade/music/narration", () => {
    const plan = buildStitchPlan(clips, options());
    expect(plan.concatList).toContain("file '/a/shot-01.mp4'");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.args).toContain("copy");
    expect(plan.steps[0]?.args).not.toContain("-filter_complex");
  });

  it("xfade path builds chained xfade/acrossfade graph", () => {
    const plan = buildStitchPlan(clips, options({ xfade: 0.4 }));
    const filter = plan.steps[0]?.args[
      (plan.steps[0]?.args.indexOf("-filter_complex") ?? 0) + 1
    ] as string;
    expect(filter).toContain("xfade=transition=fade:duration=0.4:offset=7.600");
    expect(filter).toContain("acrossfade=d=0.4");
  });

  it("adds matched silence when a re-encoded clip has no audio", () => {
    const plan = buildStitchPlan(
      [
        { duration: 8, hasAudio: false, path: "/a/muted.mp4" },
        { duration: 10, path: "/a/sound.mp4" },
      ],
      options({ xfade: 0.4 })
    );
    const args = plan.steps[0]?.args ?? [];
    const filter = args[args.indexOf("-filter_complex") + 1] as string;

    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=44100");
    expect(filter).toContain("[0:v][2:v]xfade");
    expect(filter).toContain("[1:a][2:a]acrossfade");
  });

  it("music adds a volume filter at the configured gain and a final fade", () => {
    const plan = buildStitchPlan(
      clips,
      options({ musicGainDb: -18, musicPath: "/a/score.mp3" })
    );
    const filter = plan.steps[0]?.args[
      (plan.steps[0]?.args.indexOf("-filter_complex") ?? 0) + 1
    ] as string;
    expect(filter).toContain("volume=-18dB");
    expect(filter).toContain("amix=inputs=2");
    expect(plan.steps[0]?.args).toContain("/a/score.mp3");
  });

  it("narration joins the mix", () => {
    const plan = buildStitchPlan(
      clips,
      options({ musicPath: "/a/m.mp3", narrationPath: "/a/n.mp3" })
    );
    const filter = plan.steps[0]?.args[
      (plan.steps[0]?.args.indexOf("-filter_complex") ?? 0) + 1
    ] as string;
    expect(filter).toContain("amix=inputs=3");
  });

  it("throws on zero clips", () => {
    expect(() => buildStitchPlan([], options())).toThrow(/nothing to stitch/u);
  });
});

describe("cards", () => {
  it("wrapCardText wraps long text on word boundaries", () => {
    const lines = wrapCardText(
      "The keeper walked up the same two hundred steps every night for forty years. The light never went out once."
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 45)).toBe(true);
    expect(lines.join(" ")).toContain("never went out");
  });

  it("cardSvg renders a square canvas with centred, XML-escaped text", () => {
    const svg = cardSvg(
      { after: "start", text: "HALLOWS REEF LIGHT <est. 1887>" },
      1280,
      720
    );
    expect(svg).toContain('width="1280" height="1280"');
    expect(svg).toContain("HALLOWS REEF LIGHT &lt;est. 1887&gt;");
    expect(svg).toContain('text-anchor="middle"');
  });

  it("cardVideoArgs loops the png with fades at the clip fps", () => {
    const args = cardVideoArgs("/a/card.png", 3, 24, "/a/card.mp4");
    expect(args).toContain("-loop");
    expect(args).toContain("24.000");
    const vf = args[args.indexOf("-vf") + 1] as string;
    expect(vf).toContain("fade=t=in:st=0:d=0.5");
    expect(vf).toContain("fade=t=out:st=2.5:d=0.5");
  });
});

describe("concatListContent", () => {
  it("escapes single quotes in paths", () => {
    expect(concatListContent([{ duration: 1, path: "/a/it's.mp4" }])).toBe(
      "file '/a/it'\\''s.mp4'\n"
    );
  });
});

describe("--mute-clips", () => {
  const muteClipsFixture: StitchClip[] = [
    { duration: 10, path: "/a.mp4" },
    { duration: 12, path: "/b.mp4" },
  ];
  const base = {
    cardPaths: new Map<number, string>(),
    concatListPath: "/list.txt",
    font: "Helvetica",
    musicGainDb: -12,
    outputPath: "/out.mp4",
    xfade: 0,
  };

  it("stays lossless, dropping the stream rather than re-encoding", () => {
    // A model that bakes a full score into every clip produces N unrelated
    // beds across a cut. Dropping them must not also cost a re-encode.
    const plan = buildStitchPlan(muteClipsFixture, {
      ...base,
      muteClips: true,
    });
    const [step] = plan.steps;
    expect(step?.args).toContain("-an");
    expect(step?.args).toContain("copy");
    expect(step?.description).toMatch(/clip audio dropped/u);
  });

  it("substitutes silence when a re-encode is happening anyway", () => {
    const plan = buildStitchPlan(clips, {
      ...base,
      musicPath: "/score.mp3",
      muteClips: true,
    });
    const args = plan.steps[0]?.args.join(" ") ?? "";
    // The silent-source path that already existed for muted clips, reused.
    expect(args).toContain("anullsrc");
    expect(args).toContain("/score.mp3");
  });

  it("leaves clip audio alone by default", () => {
    const plan = buildStitchPlan(muteClipsFixture, base);
    expect(plan.steps[0]?.args).not.toContain("-an");
  });
});
