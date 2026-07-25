import {
  ASPECT_RATIO_VALUE,
  DURATION_AUTO,
  RESOLUTION_SHORT_SIDE,
} from "./types.js";
import type { ManifestEntry } from "./types.js";

/**
 * Frame sample points across the clip. We force the FIRST frame (~0%) and the
 * LAST frame (~98%, just shy of EOF) and spread the rest between: the first
 * frame is what you eyeball against the reference still for identity drift, and
 * the last frame is what a `continueFrom` chain consumes as its next opening.
 */
export function frameTimestamps(duration: number, count: number): number[] {
  if (count <= 1) {
    return [duration / 2];
  }
  const start = 0;
  const end = 0.98;
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Number((duration * (start + i * step)).toFixed(2))
  );
}

export interface ProbeSummary {
  duration: number;
  height: number;
  width: number;
}

/**
 * Cheap artifact heuristics: the probed clip vs what we asked for. A clip that
 * came back the wrong length, aspect, or resolution is the most common silent
 * failure, and these flags surface it in the contact sheet without opening the
 * mp4.
 */
export function probeWarnings(
  probe: ProbeSummary,
  params: ManifestEntry["params"]
): string[] {
  const warnings: string[] = [];
  if (!params) {
    return warnings;
  }
  if (
    params.duration !== DURATION_AUTO &&
    Math.abs(probe.duration - params.duration) > 1
  ) {
    warnings.push(
      `duration ${probe.duration.toFixed(1)}s vs requested ${params.duration}s`
    );
  }
  const actualRatio = probe.width / probe.height;
  // `adaptive` is deliberately undefined: the delivered frame is only knowable
  // after generation, so there is nothing to compare against.
  const expectedRatio = ASPECT_RATIO_VALUE[params.ratio];
  if (
    expectedRatio &&
    Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.05
  ) {
    warnings.push(
      `aspect ${probe.width}x${probe.height} (${actualRatio.toFixed(2)}) vs requested ${params.ratio}`
    );
  }
  const shortSide = Math.min(probe.width, probe.height);
  // An unset resolution means the request let the API choose, so there is no
  // requested value to hold the clip against.
  const expectedShort =
    params.resolution && RESOLUTION_SHORT_SIDE[params.resolution];
  if (
    expectedShort &&
    Math.abs(shortSide - expectedShort) / expectedShort > 0.1
  ) {
    warnings.push(
      `short side ${shortSide}px vs requested ${params.resolution}`
    );
  }
  return warnings;
}

export interface ReviewRow {
  entry?: ManifestEntry;
  frameFiles: string[];
  promptExcerpt: string;
  shotId: string;
  warnings: string[];
}

export function renderIndexMd(
  rows: ReviewRow[],
  shotsFileName: string
): string {
  const lines: string[] = [
    "# Review contact sheet",
    "",
    `Retake any shot with: \`vs generate ${shotsFileName} --shot <id> --force\``,
    "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.shotId}`, "");
    if (!row.entry) {
      lines.push("**Not generated.**", "");
      continue;
    }
    const { params } = row.entry;
    lines.push(
      `- status: ${row.entry.status} · attempts: ${row.entry.attempts} · task: ${row.entry.taskId}`,
      params
        ? `- ${params.model} · ${params.duration}s · ${params.ratio} · ${params.resolution ?? "api default"}${params.seed === undefined ? "" : ` · seed ${params.seed}`}`
        : "- (no params recorded)",
      `- prompt: ${row.promptExcerpt}`
    );
    for (const warning of row.warnings ?? []) {
      lines.push(`- ⚠️ ${warning}`);
    }
    lines.push("");
    for (const frame of row.frameFiles) {
      lines.push(`![${row.shotId}](${frame})`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
