import { execFile } from "node:child_process";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { VsError } from "./errors.js";
import type { TitleCard } from "./types.js";

const execFileAsync = promisify(execFile);

const WRAP_AT = 38;

/**
 * Balanced word wrap: each paragraph is split into the fewest lines that fit
 * the width, then re-wrapped at an even target so line lengths are balanced
 * (no orphan last lines). Explicit \n is respected as a paragraph break.
 */
export function wrapCardText(text: string, width = WRAP_AT): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    const total = words.join(" ").length;
    const lineCount = Math.max(1, Math.ceil(total / width));
    const target = Math.ceil(total / lineCount);
    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (candidate.length > Math.max(target, word.length) && current !== "") {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * A SQUARE svg sized to the larger video dimension with the card content
 * centred — qlmanage thumbnails scale-to-fill a square, so a square source
 * renders 1:1 and a centre crop recovers the video frame.
 */
export function cardSvg(
  card: TitleCard,
  width: number,
  height: number,
  fontFamily = "Helvetica"
): string {
  const size = Math.max(width, height);
  const fontSize = card.fontSize ?? 64;
  const lines = wrapCardText(card.text);
  const lineHeight = fontSize * 1.4;
  const firstY = size / 2 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map(
      (line, index) =>
        `<text x="${size / 2}" y="${firstY + index * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}" fill="white" text-anchor="middle" dominant-baseline="central">${escapeXml(line)}</text>`
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="black"/>
  ${tspans}
</svg>
`;
}

/**
 * Whether a font family resolves on this machine. `fc-list` is authoritative
 * and fast, but it ships with fontconfig rather than macOS — returns null when
 * it is absent, so a missing checker never blocks a render.
 */
export async function fontIsAvailable(family: string): Promise<boolean | null> {
  try {
    await execFileAsync("fc-list", ["-q", family]);
    return true;
  } catch (error) {
    // Exit 1 means fc-list ran and found nothing; anything else (ENOENT most
    // likely) means we cannot tell.
    return (error as { code?: number | string }).code === 1 ? false : null;
  }
}

const fontChecks = new Map<string, boolean | null>();

/**
 * qlmanage substitutes a default face for a family it cannot resolve and exits
 * 0, so an unavailable font produces a silently wrong card. Fail instead.
 */
async function assertFontResolves(family: string): Promise<void> {
  let available = fontChecks.get(family);
  if (available === undefined) {
    available = await fontIsAvailable(family);
    fontChecks.set(family, available);
  }
  if (available === false) {
    throw new VsError(
      "missing_dependency",
      `font "${family}" is not installed, and qlmanage would silently substitute a different face`,
      {
        hint: "install the font, or pass a family you already have (e.g. `--font Helvetica`); `fc-list` lists what is available",
      }
    );
  }
}

/**
 * qlmanage and sips ARE the title-card renderer on this platform, so a bare
 * exec failure surfaces as "Command failed: qlmanage …" with nothing tying it
 * to title cards or saying what to do next.
 */
async function runCardTool(
  tool: "qlmanage" | "sips",
  args: string[]
): Promise<void> {
  try {
    await execFileAsync(tool, args);
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    throw new VsError(
      missing ? "missing_dependency" : "render_failed",
      `title-card rendering failed: \`${tool}\` ${missing ? "is not installed" : "exited non-zero"}`,
      {
        cause: error,
        hint: missing
          ? `${tool} ships with macOS; on a stripped-down system reinstall the command line tools, or drop \`cards\` from shots.json to stitch without title cards`
          : "re-run with --verbose for the tool's own output; a card with unusual characters or a huge fontSize is the usual cause",
      }
    );
  }
}

/**
 * Render a card to a PNG matching the video frame, via macOS qlmanage + sips
 * (this machine's ffmpeg lacks drawtext, so text is rasterised outside
 * ffmpeg entirely).
 */
export async function renderCardPng(
  card: TitleCard,
  width: number,
  height: number,
  outputPng: string,
  fontFamily?: string
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new VsError(
      "missing_dependency",
      `title-card rendering uses macOS qlmanage/sips, which do not exist on ${process.platform}`,
      {
        hint: "install an ffmpeg built with drawtext and adapt src/cards.ts (please file an issue), or remove `cards` from shots.json and stitch without title cards",
      }
    );
  }
  await assertFontResolves(fontFamily ?? "Helvetica");
  const size = Math.max(width, height);
  const svgPath = outputPng.replace(/\.png$/u, ".svg");
  await writeFile(svgPath, cardSvg(card, width, height, fontFamily), "utf-8");
  const outDir = dirname(outputPng);
  await runCardTool("qlmanage", [
    "-t",
    "-s",
    size.toString(),
    "-o",
    outDir,
    svgPath,
  ]);
  // qlmanage names its output <input-basename>.png
  const qlOutput = join(outDir, `${svgPath.split("/").pop()}.png`);
  await rename(qlOutput, outputPng);
  await runCardTool("sips", [
    "-c",
    height.toString(),
    width.toString(),
    outputPng,
  ]);
  await rm(svgPath, { force: true });
}

/**
 * ffmpeg args to turn the card PNG into a video segment with fades. The opening
 * card of a film passes `fadeIn: false` so frame 0 is the visible card rather
 * than pure black — otherwise messaging apps (WhatsApp) grab a black poster.
 */
export function cardVideoArgs(
  pngPath: string,
  duration: number,
  fps: number,
  outputPath: string,
  fadeIn = true
): string[] {
  const fade = 0.5;
  const fadeOutStart = Math.max(0, duration - fade);
  const filters = [
    ...(fadeIn ? [`fade=t=in:st=0:d=${fade}`] : []),
    `fade=t=out:st=${fadeOutStart}:d=${fade}`,
    "format=yuv420p",
  ].join(",");
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    fps.toFixed(3),
    "-i",
    pngPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    duration.toString(),
    "-vf",
    filters,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    outputPath,
  ];
}
