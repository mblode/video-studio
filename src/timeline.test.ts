import { describe, expect, it } from "vitest";

import {
  buildFilmSegments,
  effectiveFade,
  shotStartTimes,
} from "./timeline.js";
import type { ShotsFile } from "./types.js";

describe("effectiveFade", () => {
  it("keeps hard cuts at 0", () => {
    expect(effectiveFade(0)).toBe(0);
  });

  it("floors positive fades at 0.05 like stitch xfade", () => {
    expect(effectiveFade(0.03)).toBe(0.05);
    expect(effectiveFade(0.4)).toBe(0.4);
  });
});

describe("buildFilmSegments + shotStartTimes", () => {
  const bare: ShotsFile = {
    film: { title: "T" },
    shots: [
      { duration: 10, id: "s01", prompt: "p" },
      { duration: 10, id: "s02", prompt: "p" },
    ],
  };

  it("defaults to stitch --xfade 0 (no time stolen between shots)", () => {
    const segments = buildFilmSegments(bare, { s01: 10, s02: 10 });
    const { starts, total } = shotStartTimes(segments);
    expect(starts.s01).toBe(0);
    expect(starts.s02).toBe(10);
    expect(total).toBe(20);
  });

  it("applies defaultTransition when shot.transition is unset", () => {
    const segments = buildFilmSegments(bare, { s01: 10, s02: 10 }, 0.4);
    const { starts } = shotStartTimes(segments);
    expect(starts.s01).toBe(0);
    expect(starts.s02).toBeCloseTo(9.6, 5);
  });

  it("lets per-shot transition override the default", () => {
    const file: ShotsFile = {
      film: { title: "T" },
      shots: [
        { duration: 10, id: "s01", prompt: "p", transition: 0 },
        { duration: 10, id: "s02", prompt: "p", transition: 0.4 },
      ],
    };
    const segments = buildFilmSegments(file, { s01: 10, s02: 10 }, 0);
    const { starts } = shotStartTimes(segments);
    expect(starts.s01).toBe(0);
    expect(starts.s02).toBeCloseTo(9.6, 5);
  });

  it("places the first shot after a start card with hard cut", () => {
    const file: ShotsFile = {
      cards: [{ after: "start", duration: 3, text: "TITLE" }],
      film: { title: "T" },
      shots: [{ duration: 10, id: "s01", prompt: "p" }],
    };
    const { starts } = shotStartTimes(buildFilmSegments(file, { s01: 10 }, 0));
    expect(starts.s01).toBe(3);
  });
});
