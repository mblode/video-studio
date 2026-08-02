import { DEFAULT_DURATION } from "./types.js";
import type { ShotsFile } from "./types.js";

/**
 * One item on the film timeline (card or shot). `trans` is the crossfade
 * INTO this item from the previous one — same semantics as stitch's
 * `clip.transition ?? --xfade`.
 */
export interface TimelineSegment {
  dur: number;
  id: string;
  kind: "card" | "shot";
  trans: number;
}

/**
 * Effective junction fade duration for timeline math.
 * Matches stitch: hard cuts stay 0; any positive fade is floored at 0.05
 * (ffmpeg xfade rejects tinier values).
 */
export function effectiveFade(trans: number): number {
  if (trans <= 0) {
    return 0;
  }
  return Math.max(0.05, trans);
}

/**
 * Build the stitch-equivalent segment list: start cards, each shot + its
 * cards, then end cards. Shot durations come from probed clips when provided,
 * otherwise authored defaults.
 */
export function buildFilmSegments(
  file: ShotsFile,
  shotDurations: Record<string, number>,
  defaultTransition = 0
): TimelineSegment[] {
  const cards = file.cards ?? [];
  const segments: TimelineSegment[] = [];

  const cardsAfter = (position: string): void => {
    for (const card of cards) {
      if (card.after === position) {
        segments.push({
          dur: card.duration ?? 3,
          id: card.text.slice(0, 40),
          kind: "card",
          trans: card.transition ?? defaultTransition,
        });
      }
    }
  };

  cardsAfter("start");
  for (const shot of file.shots) {
    const dur =
      shotDurations[shot.id] ??
      shot.duration ??
      file.film.defaults?.duration ??
      DEFAULT_DURATION;
    segments.push({
      dur,
      id: shot.id,
      kind: "shot",
      trans: shot.transition ?? defaultTransition,
    });
    cardsAfter(shot.id);
  }
  cardsAfter("end");
  return segments;
}

/** Absolute start time of each shot (xfade INTO each segment after the first). */
export function shotStartTimes(segments: TimelineSegment[]): {
  starts: Record<string, number>;
  total: number;
} {
  const starts: Record<string, number> = {};
  let t = 0;
  for (const [i, seg] of segments.entries()) {
    if (i > 0) {
      t -= effectiveFade(seg.trans);
    }
    if (seg.kind === "shot") {
      starts[seg.id] = t;
    }
    t += seg.dur;
  }
  return { starts, total: t };
}
