import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  isComplete,
  isInFlight,
  latestRevision,
  loadManifest,
  saveManifest,
  selectedRevision,
  upsertEntry,
} from "../manifest.js";
import { DEFAULT_VIDEO_MODEL } from "../models.js";
import type { Pass } from "../paths.js";
import { filmFileNotFound } from "../shots.js";
import type { VideoModelV4 } from "../spec/video-model.js";
import { createArkClient, createVideoModel } from "./context.js";
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
    // A bare task id carries no film, so there is no recorded model to route
    // off and this assumes Ark. Pass the shots file instead of the id to look
    // up a MiniMax or bridged task.
    const client = createArkClient();
    const task = await client.getTask(positional);
    line(JSON.stringify(task, null, 2));
    return;
  }

  const shotsFile = positional ?? options.shots;
  // `status` is the read-only command an agent checks before it spends, and a
  // missing manifest reads as "nothing generated yet". Without this, a mistyped
  // film reads exactly the same way — a clean, empty, exit-0 answer about a film
  // that does not exist — and the hint then points `vs generate` at the typo.
  if (!existsSync(shotsFile)) {
    throw filmFileNotFound(shotsFile);
  }
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
    // Routed PER ENTRY off the model recorded at submit time, not off one Ark
    // client for the whole film. A MiniMax or bridged task id sent to BytePlus
    // comes back as a baffling 4xx, and a film that changed `film.model` between
    // passes has entries belonging to two different backends at once. Legacy
    // entries predate `params`, so they fall back to the default model, which is
    // exactly what they were generated on.
    const clients = new Map<string, VideoModelV4>();
    const clientFor = (modelId: string): VideoModelV4 => {
      const existing = clients.get(modelId);
      if (existing) {
        return existing;
      }
      const created = createVideoModel(modelId);
      clients.set(modelId, created);
      return created;
    };
    for (const entry of entries.filter((candidate) => isInFlight(candidate))) {
      const client = clientFor(entry.params?.model ?? DEFAULT_VIDEO_MODEL);
      const task = await client.doStatus(entry.taskId);
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
    availableVersions: (entry.versions ?? [])
      .filter(
        (revision) =>
          revision.status === "downloaded" && revision.outputPath !== undefined
      )
      .map((revision) => revision.version),
    complete: isComplete(entry, manifestDir),
    latestVersion: latestRevision(entry)?.version,
    selectedVersion: selectedRevision(entry)?.version,
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
      const revisions =
        row.latestVersion === undefined
          ? ""
          : `  latest v${String(row.latestVersion).padStart(3, "0")}${
              row.selectedVersion === undefined
                ? ""
                : ` · selected v${String(row.selectedVersion).padStart(3, "0")}`
            }${
              row.availableVersions.length === 0
                ? ""
                : ` · available ${row.availableVersions
                    .map((version) => `v${String(version).padStart(3, "0")}`)
                    .join(", ")}`
            }`;
      line(
        `${row.shotId.padEnd(width)}  ${color(hue, row.status.padEnd(10))}  ${row.taskId}${revisions}${row.outputPath ? `  ${row.outputPath}` : ""}${row.error ? `  ${color("red", row.error)}` : ""}`
      );
    }
  });
}
