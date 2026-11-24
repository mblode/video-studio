import { describe, expect, it } from "vitest";

import { cardSvg, cardVideoArgs } from "./cards.js";
import { bandMatteSvg, decorateTimeline, overlayMatteSvg } from "./overlays.js";
import type { TimelineSegment } from "./overlays.js";
import { buildStitchPlan } from "./stitch.js";
import { buildFilmSegments } from "./timeline.js";
import type { Overlay } from "./types.js";

const frame = { fps: 24, height: 720, width: 1280 };
const options = (overlays?: Overlay[]) => ({
  font: "Helvetica",
  frame,
  overlays,
  workDir: "/w",
});
const segment = (
  id: string,
  extra: Partial<TimelineSegment> = {}
): TimelineSegment => ({
  clip: { duration: 4, hasAudio: true, path: `/clips/${id}.mp4` },
  id,
  ...extra,
});

const count = (svg: string) => svg.match(/<text /gu)?.length;

describe("overlayMatteSvg", () => {
  it("draws white text on black, scaled from a 1080-high frame", () => {
    const svg = overlayMatteSvg(
      { fontSize: 90, on: "s1", text: "a <b>" },
      frame,
      "Archivo"
    );
    expect(svg).toContain('fill="black"');
    expect(svg).toContain('font-family="Archivo" font-size="60"');
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).toContain('text-anchor="middle"');
  });

  it("places the block inside the centre-cropped frame", () => {
    const svg = overlayMatteSvg(
      { align: "start", on: "s1", text: "label", x: 0.25, y: 1 },
      frame,
      "Helvetica"
    );
    // The 1280 square is cropped to 720 high, so the frame starts 280 down.
    expect(svg).toContain('x="320" y="1000"');
    expect(svg).toContain('text-anchor="start"');
  });

  it("wraps at the overlay's own width", () => {
    const text = "Tell us what your team still does by hand.";
    expect(count(overlayMatteSvg({ on: "s1", text }, frame, "H"))).toBe(3);
    expect(
      count(overlayMatteSvg({ on: "s1", text, wrap: 60 }, frame, "H"))
    ).toBe(1);
  });

  it("hides later words in a reveal without moving the earlier ones", () => {
    const overlay: Overlay = { on: "s1", text: "work less today" };
    const one = overlayMatteSvg(overlay, frame, "Helvetica", 1);
    const all = overlayMatteSvg(overlay, frame, "Helvetica");
    // One hidden run, not a tspan per word: WebKit opens a wide gap after the
    // first word when every word is its own tspan.
    expect(one.match(/<tspan/gu)).toHaveLength(2);
    expect(one).toContain(
      '<tspan>work</tspan><tspan fill-opacity="0"> less today</tspan>'
    );
    expect(all).not.toContain("tspan");
    expect(all).toContain(">work less today</text>");
  });
});

describe("decorateTimeline", () => {
  it("passes an undecorated film through, so the lossless cut survives", () => {
    const segments = [segment("s1"), segment("s2")];
    const { clips, decorations } = decorateTimeline(segments, options());
    expect(decorations).toEqual([]);
    expect(clips).toEqual(segments.map((s) => s.clip));
    const stitch = {
      cardPaths: new Map(),
      concatListPath: "/w/list.txt",
      font: "Helvetica",
      musicGainDb: -12,
      outputPath: "/w/out.mp4",
      xfade: 0,
    };
    expect(buildStitchPlan(clips, stitch)).toEqual(
      buildStitchPlan(
        segments.map((s) => s.clip),
        stitch
      )
    );
  });

  it("trims with an input seek and never rewrites the source clip", () => {
    const { clips, decorations } = decorateTimeline(
      [segment("s1", { trim: { duration: 1.5, start: 1 } })],
      options()
    );
    const args = decorations[0]?.args ?? [];
    expect(args.slice(0, 7)).toEqual([
      "-y",
      "-ss",
      "1",
      "-t",
      "1.5",
      "-i",
      "/clips/s1.mp4",
    ]);
    expect(args).not.toContain("-filter_complex");
    expect(args.at(-1)).toBe("/w/seg-1.mp4");
    expect(clips[0]).toMatchObject({ duration: 1.5, path: "/w/seg-1.mp4" });
  });

  it("composites an overlay as a tinted matte inside its time window", () => {
    const { decorations } = decorateTimeline(
      [segment("s1")],
      options([
        {
          at: 0.5,
          color: "#f7f7f7",
          duration: 2,
          fade: 0.2,
          on: "s1",
          text: "hi",
        },
      ])
    );
    const args = decorations[0]?.args ?? [];
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("color=c=0xf7f7f7:s=1280x720");
    expect(graph).toContain("alphamerge,fade=t=in:st=0.500:d=0.2:alpha=1");
    expect(graph).toContain("fade=t=out:st=2.300:d=0.2:alpha=1");
    expect(graph).toContain("overlay=enable='between(t,0.500,2.500)'");
    expect(args).toContain("/w/s1-overlay-1-1.png");
  });

  it("gives a word reveal one layer per word, the last holding to the end", () => {
    const { decorations } = decorateTimeline(
      [segment("s1", { trim: { duration: 2, start: 0 } })],
      options([
        { on: "s1", reveal: "word", stagger: 0.5, text: "one two three" },
      ])
    );
    expect(
      decorations[0]?.layers.map((layer) => [layer.start, layer.end])
    ).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1, 2],
    ]);
  });

  it("lays a band under the text for the whole overlay", () => {
    const overlay: Overlay = {
      band: "#f7f7f7",
      color: "#0a5fe0",
      fontSize: 90,
      on: "s1",
      text: "follow-up",
    };
    const { decorations } = decorateTimeline(
      [segment("s1")],
      options([overlay])
    );
    expect(decorations[0]?.layers.map((layer) => layer.color)).toEqual([
      "0xf7f7f7",
      "0x0a5fe0",
    ]);
    expect(decorations[0]?.layers[0]).toMatchObject({ end: 4, start: 0 });
    // One 60px line at the centre of a 720-high frame: 78 + 54 tall.
    expect(bandMatteSvg(overlay, frame)).toContain(
      '<rect x="0" y="574" width="1280" height="132" fill="white"/>'
    );
  });

  it("drops the audio map for a silent source", () => {
    const { decorations } = decorateTimeline(
      [
        {
          clip: { duration: 4, hasAudio: false, path: "/clips/s1.mp4" },
          id: "s1",
          trim: { duration: 2, start: 0 },
        },
      ],
      options()
    );
    expect(decorations[0]?.args).toContain("-an");
  });

  it("ignores overlays on a card that has no id", () => {
    const { decorations } = decorateTimeline(
      [{ clip: { duration: 3, path: "/cards/card-1.mp4" } }],
      options([{ on: "s1", text: "hi" }])
    );
    expect(decorations).toEqual([]);
  });
});

describe("styled cards", () => {
  it("paints the ground and text colours and embeds the image", () => {
    const svg = cardSvg(
      {
        after: "end",
        background: "#f7f7f7",
        color: "#121d2c",
        text: "amtecai.com",
      },
      1280,
      720,
      "Helvetica",
      "data:image/png;base64,AAAA"
    );
    expect(svg).toContain('<rect width="100%" height="100%" fill="#f7f7f7"/>');
    expect(svg).toContain('fill="#121d2c"');
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
  });

  it("renders a blank ground for a card that only carries overlays", () => {
    const svg = cardSvg({ after: "start", id: "open" }, 1280, 720);
    expect(svg).not.toContain("<text");
  });

  it("cuts hard when both fades are off", () => {
    const args = cardVideoArgs("/a/c.png", 3, 24, "/a/c.mp4", false, false);
    expect(args[args.indexOf("-vf") + 1]).toBe("format=yuv420p");
  });
});

describe("buildFilmSegments with a trim", () => {
  it("uses the trimmed length even when a clip was probed longer", () => {
    const segments = buildFilmSegments(
      {
        film: { title: "T" },
        shots: [
          { id: "s1", prompt: "p", trim: { duration: 1.5, start: 1 } },
          { id: "s2", prompt: "p" },
        ],
      },
      { s1: 4.04, s2: 4.04 }
    );
    expect(segments.map((s) => s.dur)).toEqual([1.5, 4.04]);
  });
});
