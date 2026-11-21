import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  assertFontResolves,
  escapeXml,
  renderSvgPng,
  wrapCardText,
} from "./cards.js";
import { runFfmpeg } from "./ffmpeg.js";
import type { StitchClip } from "./stitch.js";
import type { Overlay, Shot } from "./types.js";

/** Overlay `fontSize` is authored against this frame height and scaled. */
const REFERENCE_HEIGHT = 1080;
const DEFAULT_STAGGER = 0.25;

interface Frame {
  fps: number;
  height: number;
  width: number;
}

interface MatteLayer {
  color: string;
  end: number;
  fade: { in: boolean; out: boolean; seconds: number };
  png: string;
  start: number;
  svg: string;
}

interface Decoration {
  args: string[];
  description: string;
  /** Length of the decorated segment on the timeline. */
  duration: number;
  fonts: string[];
  hasAudio: boolean;
  layers: MatteLayer[];
  outputPath: string;
}

/** Where an overlay's text block sits inside the square matte canvas. */
function textBlock(overlay: Overlay, frame: { height: number; width: number }) {
  const size = Math.max(frame.width, frame.height);
  const fontSize = ((overlay.fontSize ?? 64) * frame.height) / REFERENCE_HEIGHT;
  const lines = wrapCardText(overlay.text, overlay.wrap);
  const lineHeight = fontSize * 1.3;
  // The frame is centre-cropped out of the square, so its origin is inset.
  const centreY = (size - frame.height) / 2 + (overlay.y ?? 0.5) * frame.height;
  return {
    centreY,
    firstY: centreY - ((lines.length - 1) * lineHeight) / 2,
    fontSize,
    lineHeight,
    lines,
    size,
    x: (size - frame.width) / 2 + (overlay.x ?? 0.5) * frame.width,
  };
}

/**
 * A luma matte for one overlay: white text on black, the full frame, in a
 * square svg like a card. `visibleWords` hides the words past that count with
 * `fill-opacity` rather than leaving them out, so every frame of a word reveal
 * is laid out identically and the words already on screen never shift.
 */
export function overlayMatteSvg(
  overlay: Overlay,
  frame: { height: number; width: number },
  fontFamily: string,
  visibleWords = Number.POSITIVE_INFINITY
): string {
  const { firstY, fontSize, lineHeight, lines, size, x } = textBlock(
    overlay,
    frame
  );
  const weight =
    overlay.weight === undefined ? "" : ` font-weight="${overlay.weight}"`;
  let wordIndex = 0;
  const texts = lines
    .map((line, index) => {
      // One run for the words on screen and one for the words still hidden.
      // A tspan per word made WebKit open a wide gap after the first word, so
      // the space between the two runs lives INSIDE the hidden one, kept by
      // xml:space, and a fully visible line is plain text.
      const lineWords = line.split(" ").filter(Boolean);
      const shown = Math.max(
        0,
        Math.min(lineWords.length, visibleWords - wordIndex)
      );
      wordIndex += lineWords.length;
      const visible = escapeXml(lineWords.slice(0, shown).join(" "));
      const hidden = escapeXml(lineWords.slice(shown).join(" "));
      const words =
        hidden === ""
          ? visible
          : `<tspan>${visible}</tspan><tspan fill-opacity="0">${shown > 0 ? " " : ""}${hidden}</tspan>`;
      return `<text x="${x}" y="${firstY + index * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"${weight} fill="white" text-anchor="${overlay.align ?? "middle"}" dominant-baseline="central" xml:space="preserve">${words}</text>`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="black"/>
  ${texts}
</svg>
`;
}

/**
 * The matte for an overlay's `band`: a full-width strip as tall as the text
 * block plus padding. Full width because nothing here can measure a line of
 * text, and a strip needs no measuring.
 */
export function bandMatteSvg(
  overlay: Overlay,
  frame: { height: number; width: number }
): string {
  const { centreY, fontSize, lineHeight, lines, size } = textBlock(
    overlay,
    frame
  );
  const height = lines.length * lineHeight + fontSize * 0.9;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="black"/>
  <rect x="0" y="${centreY - height / 2}" width="${size}" height="${height}" fill="white"/>
</svg>
`;
}

function wordTotal(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/**
 * The matte layers for one overlay and when each is on screen. A plain overlay
 * is one layer; a word reveal is one layer per word, each replacing the last,
 * with the final layer holding to the end.
 */
function overlayLayers(
  overlay: Overlay,
  segmentSeconds: number,
  frame: Frame,
  font: string,
  pngBase: string
): MatteLayer[] {
  const start = overlay.at ?? 0;
  const end = Math.min(
    segmentSeconds,
    overlay.duration === undefined ? segmentSeconds : start + overlay.duration
  );
  const color = (overlay.color ?? "#ffffff").replace("#", "0x");
  const fadeSeconds = overlay.fade ?? 0;
  const steps = overlay.reveal === "word" ? wordTotal(overlay.text) : 1;
  const stagger = overlay.stagger ?? DEFAULT_STAGGER;
  const layers: MatteLayer[] = [];
  if (overlay.band !== undefined && start < end) {
    // Under the text and on screen for the whole overlay, so a word reveal
    // builds on a strip that is already there.
    layers.push({
      color: overlay.band.replace("#", "0x"),
      end,
      fade: { in: true, out: true, seconds: fadeSeconds },
      png: `${pngBase}-band.png`,
      start,
      svg: bandMatteSvg(overlay, frame),
    });
  }
  for (let step = 0; step < steps; step += 1) {
    const layerStart = start + step * stagger;
    if (layerStart >= end) {
      break;
    }
    const last = step === steps - 1;
    layers.push({
      color,
      end: last ? end : Math.min(end, start + (step + 1) * stagger),
      fade: { in: step === 0, out: last, seconds: fadeSeconds },
      png: `${pngBase}-${step + 1}.png`,
      start: layerStart,
      svg: overlayMatteSvg(
        overlay,
        frame,
        font,
        overlay.reveal === "word" ? step + 1 : undefined
      ),
    });
  }
  return layers;
}

function layerFilter(layer: MatteLayer, input: number, frame: Frame): string {
  const fades: string[] = [];
  const { seconds } = layer.fade;
  if (seconds > 0 && layer.fade.in) {
    fades.push(`fade=t=in:st=${layer.start.toFixed(3)}:d=${seconds}:alpha=1`);
  }
  if (seconds > 0 && layer.fade.out) {
    fades.push(
      `fade=t=out:st=${Math.max(layer.start, layer.end - seconds).toFixed(3)}:d=${seconds}:alpha=1`
    );
  }
  return [
    `color=c=${layer.color}:s=${frame.width}x${frame.height}:r=${frame.fps.toFixed(3)}[c${input}]`,
    `[${input}:v]format=gray[m${input}]`,
    `[c${input}][m${input}]alphamerge${fades.map((fade) => `,${fade}`).join("")}[o${input}]`,
  ].join(";");
}

interface DecorationInput {
  /** Fallback family when an overlay names no `font`. */
  font: string;
  frame: Frame;
  hasAudio: boolean;
  outputPath: string;
  overlays: Overlay[];
  /** Length of the source segment before any trim. */
  seconds: number;
  segmentId: string;
  sourcePath: string;
  trim?: Shot["trim"];
  workDir: string;
}

/**
 * Plan the derived copy of one timeline segment that carries its trim and its
 * overlays, or null when it has neither and the source goes to the cut as is.
 *
 * The source is never modified. A clip under `output/clips/` is immutable and
 * its visual-approval receipt binds those bytes, so the decorated segment is a
 * new file in the render's work directory.
 */
function planDecoration(input: DecorationInput): Decoration | null {
  const { frame, overlays, trim } = input;
  if (!trim && overlays.length === 0) {
    return null;
  }
  const duration = trim
    ? Math.min(trim.duration, Math.max(0, input.seconds - trim.start))
    : input.seconds;
  const layers = overlays.flatMap((overlay, index) =>
    overlayLayers(
      overlay,
      duration,
      frame,
      overlay.font ?? input.font,
      join(input.workDir, `${input.segmentId}-overlay-${index + 1}`)
    )
  );
  const filters: string[] = [];
  let video = "[0:v]";
  for (const [index, layer] of layers.entries()) {
    const stream = index + 1;
    const out = index === layers.length - 1 ? "[vout]" : `[v${stream}]`;
    filters.push(layerFilter(layer, stream, frame));
    filters.push(
      `${video}[o${stream}]overlay=enable='between(t,${layer.start.toFixed(3)},${layer.end.toFixed(3)})':shortest=1${out}`
    );
    video = out;
  }
  const args = [
    "-y",
    // Before -i so both streams are cut together and timestamps restart at 0.
    ...(trim ? ["-ss", trim.start.toString(), "-t", duration.toString()] : []),
    "-i",
    input.sourcePath,
    ...layers.flatMap((layer) => ["-loop", "1", "-i", layer.png]),
    ...(layers.length > 0
      ? ["-filter_complex", filters.join(";"), "-map", "[vout]"]
      : ["-map", "0:v:0"]),
    ...(input.hasAudio
      ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "256k"]
      : ["-an"]),
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-r",
    frame.fps.toFixed(3),
    input.outputPath,
  ];
  const parts = [
    ...(trim ? [`trim ${trim.start}s+${duration}s`] : []),
    ...(overlays.length > 0 ? [`${overlays.length} overlay(s)`] : []),
  ];
  return {
    args,
    description: `${input.segmentId}: ${parts.join(", ")}`,
    duration,
    fonts: [...new Set(overlays.map((o) => o.font ?? input.font))],
    hasAudio: input.hasAudio,
    layers,
    outputPath: input.outputPath,
  };
}

export interface TimelineSegment {
  clip: StitchClip;
  /** Shot id or card id; a card with no id cannot carry overlays. */
  id?: string;
  trim?: Shot["trim"];
}

/**
 * Decorate a whole timeline: every segment with a trim or an overlay is
 * swapped for its derived copy, and everything else passes through untouched
 * (which is what keeps an undecorated film on the lossless concat path).
 */
export function decorateTimeline(
  segments: TimelineSegment[],
  options: {
    font: string;
    frame: Frame;
    overlays: Overlay[] | undefined;
    workDir: string;
  }
): { clips: StitchClip[]; decorations: Decoration[] } {
  const decorations: Decoration[] = [];
  const clips = segments.map((segment, index) => {
    const { clip, id } = segment;
    const decoration = planDecoration({
      font: options.font,
      frame: options.frame,
      hasAudio: clip.hasAudio ?? true,
      outputPath: join(options.workDir, `seg-${index + 1}.mp4`),
      // Authored order is draw order: a later overlay sits on top.
      overlays:
        id === undefined
          ? []
          : (options.overlays ?? []).filter((overlay) => overlay.on === id),
      seconds: clip.duration,
      segmentId: id ?? `segment-${index + 1}`,
      sourcePath: clip.path,
      trim: segment.trim,
      workDir: options.workDir,
    });
    if (!decoration) {
      return clip;
    }
    decorations.push(decoration);
    return {
      ...clip,
      duration: decoration.duration,
      path: decoration.outputPath,
    };
  });
  return { clips, decorations };
}

/**
 * qlmanage substitutes a default face and exits 0, so a missing family would
 * render the whole film in the wrong type. Checked on a dry run too.
 */
async function assertDecorationFonts(decorations: Decoration[]): Promise<void> {
  for (const font of new Set(decorations.flatMap((d) => d.fonts))) {
    await assertFontResolves(font);
  }
}

/** Rasterise each decoration's mattes, then write the decorated segments. */
export async function renderDecorations(
  decorations: Decoration[],
  frame: Frame,
  workDir: string
): Promise<void> {
  if (decorations.length === 0) {
    return;
  }
  await assertDecorationFonts(decorations);
  await mkdir(workDir, { recursive: true });
  for (const decoration of decorations) {
    for (const layer of decoration.layers) {
      await renderSvgPng(layer.svg, frame.width, frame.height, layer.png);
    }
    await runFfmpeg(decoration.args);
  }
}

/** What a dry run prints for the decorations, after checking their fonts. */
export async function decorationCommands(
  decorations: Decoration[]
): Promise<{ args: string[]; description: string }[]> {
  await assertDecorationFonts(decorations);
  return decorations.map((decoration) => ({
    args: decoration.args,
    description: `decorate ${decoration.description}`,
  }));
}
