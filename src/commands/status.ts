import { dirname, resolve } from "node:path";

import {
  isComplete,
  isInFlight,
  loadManifest,
  saveManifest,
  upsertEntry,
} from "../manifest.js";
import type { Pass } from "../paths.js";
import { createArkClient } from "./context.js";
import { color, emit, line, note } from "./output.js";

export interface StatusOptions {
  draft: boolean;
  refresh: boolean;
  shots: string;
}

/**
 * The positional argument is a shots file when it looks like one, otherwise a
 * task id. Both are things you hold in your hand at that moment, and demanding
 * `--shots` for the common case was the source of the broken README lines.
 */
export function looksLikeShotsFile(value: string): boolean {
  return value.toLowerCase().endsWith(".json");
}

export async function runStatus(
  positional: string | undefined,
  options: StatusOptions
): Promise<void> {
  if (positional && !looksLikeShotsFile(positional)) {
    const client = createArkClient();
    const task = await client.getTask(positional);
    line(JSON.stringify(task, null, 2));
    return;
  }

  const shotsFile = positional ?? options.shots;
  const pass: Pass = options.draft ? "draft" : "final";
  const manifest = await loadManifest(shotsFile, pass);
  const manifestDir = dirname(resolve(shotsFile));
  const entries = Object.values(manifest.entries);
  if (entries.length === 0) {
    emit({ entries: [], pass, shotsFile }, () => {
      note(`no tasks recorded yet; run \`vs generate ${shotsFile}\` first`);
    });
    return;
  }

  if (options.refresh) {
    const client = createArkClient();
    for (const entry of entries.filter((candidate) => isInFlight(candidate))) {
      const task = await client.getTask(entry.taskId);
      upsertEntry(manifest, {
        shotId: entry.shotId,
        status: task.status,
        taskId: entry.taskId,
        videoUrl: task.content?.video_url,
      });
    }
    await saveManifest(shotsFile, manifest, pass);
  }

  const rows = Object.values(manifest.entries).map((entry) => ({
    ...entry,
    complete: isComplete(entry, manifestDir),
  }));

  emit({ entries: rows, pass, shotsFile }, () => {
    const width = Math.max(...rows.map((row) => row.shotId.length));
    for (const row of rows) {
      let hue: "green" | "red" | "yellow" = "yellow";
      if (row.status === "failed" || row.status === "cancelled") {
        hue = "red";
      } else if (row.complete) {
        hue = "green";
      }
      line(
        `${row.shotId.padEnd(width)}  ${color(hue, row.status.padEnd(10))}  ${row.taskId}${row.outputPath ? `  ${row.outputPath}` : ""}${row.error ? `  ${color("red", row.error)}` : ""}`
      );
    }
  });
}
