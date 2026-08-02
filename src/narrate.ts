import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ELEVEN_V3_MODEL, buildSpeechBody } from "./elevenlabs.js";
import type { ElevenLabsSpeechRequest } from "./elevenlabs.js";
import { VsError } from "./errors.js";
import type { TimelineSegment } from "./timeline.js";

export {
  buildFilmSegments as buildAssembleSegments,
  shotStartTimes,
} from "./timeline.js";

export interface NarrationLine {
  /** 1-based line number from the TSV. */
  number: number;
  text: string;
}

/** Placement: line N starts at (shot start + offsetIntoShot). */
export interface NarrationPlacement {
  line: number;
  shotId: string;
  /** Seconds into the shot's segment (after cards/xfades are accounted for). */
  offsetIntoShot: number;
}

/** Alias of TimelineSegment for narrate call sites. */
export type AssembleSegment = TimelineSegment;

export interface PlacedLine {
  line: number;
  start: number;
  duration: number;
  path: string;
}

export interface AssemblePlan {
  segments: AssembleSegment[];
  shotStarts: Record<string, number>;
  totalRuntime: number;
  placed: PlacedLine[];
  /** ffmpeg args after `-y -loglevel error` (inputs + filter + map + bitrate). */
  ffmpegArgs: string[];
}

const MIN_GAP = 0.25;

/**
 * Parse `NN\ttext` rows. Blank lines and `#` comments are ignored.
 */
export function parseLinesTsv(contents: string): NarrationLine[] {
  const lines: NarrationLine[] = [];
  for (const raw of contents.split(/\r?\n/u)) {
    const row = raw.trim();
    if (!row || row.startsWith("#")) {
      continue;
    }
    const tab = row.indexOf("\t");
    if (tab === -1) {
      throw new VsError(
        "invalid_input",
        `narration line missing tab separator: ${row.slice(0, 60)}`,
        {
          hint: "each row must be `NN\\ttext`",
        }
      );
    }
    const number = Math.trunc(Number(row.slice(0, tab)));
    const text = row.slice(tab + 1).trim();
    if (!Number.isFinite(number) || number < 1 || !text) {
      throw new VsError(
        "invalid_input",
        `invalid narration row: ${row.slice(0, 60)}`
      );
    }
    lines.push({ number, text });
  }
  if (lines.length === 0) {
    throw new VsError("invalid_input", "narration TSV has no lines");
  }
  return lines;
}

/**
 * Parse `line\tshotId\toffset` placement rows. Header row optional
 * (`line\tshot\toffset`).
 */
export function parsePlacementTsv(contents: string): NarrationPlacement[] {
  const placements: NarrationPlacement[] = [];
  for (const raw of contents.split(/\r?\n/u)) {
    const row = raw.trim();
    if (!row || row.startsWith("#")) {
      continue;
    }
    const cols = row.split("\t");
    if (cols.length < 3) {
      throw new VsError(
        "invalid_input",
        `placement row needs line, shotId, offset: ${row.slice(0, 60)}`
      );
    }
    if (cols[0]?.toLowerCase() === "line") {
      continue;
    }
    const line = Math.trunc(Number(cols[0] ?? ""));
    const shotId = cols[1] ?? "";
    const offsetIntoShot = Number(cols[2] ?? "");
    if (
      !Number.isFinite(line) ||
      !shotId ||
      !Number.isFinite(offsetIntoShot) ||
      offsetIntoShot < 0
    ) {
      throw new VsError(
        "invalid_input",
        `invalid placement row: ${row.slice(0, 60)}`
      );
    }
    placements.push({ line, offsetIntoShot, shotId });
  }
  if (placements.length === 0) {
    throw new VsError("invalid_input", "placement TSV has no rows");
  }
  return placements;
}

export function lineAudioPath(linesDir: string, lineNumber: number): string {
  return join(linesDir, `line-${String(lineNumber).padStart(2, "0")}.mp3`);
}

/** Dry-run / submit payloads for each TSV line. */
export function buildNarrateLineRequests(
  lines: NarrationLine[],
  voiceId: string,
  modelId: string = ELEVEN_V3_MODEL
): { line: number; path: string; request: ElevenLabsSpeechRequest }[] {
  return lines.map((entry, index) => {
    const previousText = lines[index - 1]?.text;
    const nextText = lines[index + 1]?.text;
    return {
      line: entry.number,
      path: `line-${String(entry.number).padStart(2, "0")}.mp3`,
      request: {
        modelId,
        nextText,
        previousText,
        text: entry.text,
        voiceId,
      },
    };
  });
}

export function renderNarrateDryRun(
  requests: ReturnType<typeof buildNarrateLineRequests>
): unknown[] {
  return requests.map(({ line, path, request }) => ({
    body: buildSpeechBody(request),
    line,
    path,
    voiceId: request.voiceId,
  }));
}

export function placeLines(
  placements: NarrationPlacement[],
  shotStarts: Record<string, number>,
  lineDurations: Record<number, number>,
  linesDir: string,
  minGap = MIN_GAP
): PlacedLine[] {
  const placed: PlacedLine[] = [];
  let prevEnd: number | undefined;
  for (const placement of placements) {
    const shotStart = shotStarts[placement.shotId];
    if (shotStart === undefined) {
      throw new VsError(
        "invalid_input",
        `placement references unknown shot "${placement.shotId}"`,
        {
          hint: `valid ids: ${Object.keys(shotStarts).join(", ")}`,
        }
      );
    }
    const path = lineAudioPath(linesDir, placement.line);
    if (!existsSync(path)) {
      throw new VsError("invalid_input", `missing line audio: ${path}`, {
        hint: "run `vs narrate <lines.tsv>` first",
      });
    }
    const duration = lineDurations[placement.line];
    if (duration === undefined) {
      throw new VsError(
        "invalid_input",
        `no probed duration for line ${placement.line}`
      );
    }
    let start = shotStart + placement.offsetIntoShot;
    if (prevEnd !== undefined && start < prevEnd + minGap) {
      start = prevEnd + minGap;
    }
    placed.push({
      duration,
      line: placement.line,
      path,
      start,
    });
    prevEnd = start + duration;
  }
  return placed;
}

export function buildAssembleFfmpegArgs(
  placed: PlacedLine[],
  totalRuntime: number,
  outPath: string
): string[] {
  const args: string[] = [];
  const filters: string[] = [];
  for (const [idx, entry] of placed.entries()) {
    args.push("-i", entry.path);
    const ms = Math.round(entry.start * 1000);
    filters.push(`[${idx}:a]adelay=${ms}|${ms}[a${idx}]`);
  }
  const mixIn = placed.map((_, i) => `[a${i}]`).join("");
  filters.push(
    `${mixIn}amix=inputs=${placed.length}:duration=longest:normalize=0,apad=whole_dur=${totalRuntime.toFixed(2)}[out]`
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-b:a",
    "192k",
    outPath
  );
  return args;
}

export const SCRATCH_NARRATION_FILENAME = "narration-scratch.mp3";

export function scratchAudioPath(
  textFilePath: string,
  output?: string
): string {
  if (output) {
    return resolve(process.cwd(), output);
  }
  return join(dirname(resolve(textFilePath)), SCRATCH_NARRATION_FILENAME);
}

export async function loadScratchText(path: string): Promise<string> {
  const raw = await readFile(path, "utf-8");
  const text = raw.trim();
  if (!text) {
    throw new VsError("invalid_input", "text file is empty", {
      hint: "add narration copy to the file or pass a different --text-file path",
    });
  }
  return text;
}

export async function loadLinesFile(path: string): Promise<NarrationLine[]> {
  return parseLinesTsv(await readFile(path, "utf-8"));
}

export async function loadPlacementFile(
  path: string
): Promise<NarrationPlacement[]> {
  return parsePlacementTsv(await readFile(path, "utf-8"));
}

/**
 * Soft check used by assemble: last line should finish before a named shot's
 * fade window (default: fade begins `fadeLeadSeconds` before that shot ends).
 */
export function assertLastLineBeforeFade(
  placed: PlacedLine[],
  shotStarts: Record<string, number>,
  segments: AssembleSegment[],
  fadeShotId: string | undefined,
  fadeLeadSeconds = 1.5
): void {
  if (!fadeShotId) {
    return;
  }
  const seg = segments.find((s) => s.id === fadeShotId);
  const start = shotStarts[fadeShotId];
  if (!seg || start === undefined) {
    return;
  }
  const fadeBegins = start + seg.dur - fadeLeadSeconds;
  const last = placed.at(-1);
  if (!last) {
    return;
  }
  const lastEnd = last.start + last.duration;
  if (lastEnd > fadeBegins) {
    throw new VsError(
      "invalid_input",
      `last narration line ends at ${lastEnd.toFixed(2)}s after fade begins at ${fadeBegins.toFixed(2)}s on ${fadeShotId}`,
      {
        hint: "retime placement or shorten the final line rather than speeding audio",
      }
    );
  }
}
