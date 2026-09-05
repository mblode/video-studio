import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { VsError } from "../errors.js";
import {
  isComplete,
  isRevisionComplete,
  latestRevision,
  loadManifest,
  saveManifest,
  selectedRevision,
  upsertEntry,
} from "../manifest.js";
import type { ProviderId } from "../models.js";
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
    // entries without recorded identity fail closed below: guessing a backend
    // can attach a task id to an unrelated provider.
    const refreshable = entries.flatMap((entry) => {
      const revision = latestRevision(entry);
      if (!revision?.taskId) {
        return [];
      }
      const pending =
        revision.status === "submitted" ||
        revision.status === "queued" ||
        revision.status === "running";
      const awaitingDownload =
        revision.status === "succeeded" &&
        !isRevisionComplete(revision, manifestDir);
      return pending || awaitingDownload ? [{ entry, revision }] : [];
    });
    const clients = new Map<string, VideoModelV4>();
    const clientFor = (modelId: string, provider: ProviderId): VideoModelV4 => {
      const key = `${provider}:${modelId}`;
      const existing = clients.get(key);
      if (existing) {
        return existing;
      }
      const created = createVideoModel(modelId);
      if (created.provider !== provider) {
        throw new VsError(
          "invalid_input",
          `cannot refresh ${modelId}: it was submitted through ${provider}, but that model now routes through ${created.provider}`,
          {
            hint: "restore a model spelling that routes to the recorded provider; polling a task on a different backend cannot recover it",
          }
        );
      }
      clients.set(key, created);
      return created;
    };
    // Validate and construct every route before the first request. If one
    // legacy attempt lacks identity, refreshing must make zero guesses and
    // zero network calls rather than partially updating the film.
    const routed = refreshable.map(({ entry, revision }) => {
      const model = revision.params?.model;
      const provider = revision.params?.provider;
      if (!(model && provider)) {
        throw new VsError(
          "invalid_input",
          `${entry.shotId} task ${revision.taskId} has no recorded provider/model and cannot be refreshed safely`,
          {
            hint: "inspect the task in the provider console; legacy pending tasks cannot be assigned to a backend automatically",
          }
        );
      }
      return { client: clientFor(model, provider), entry, revision };
    });
    for (const { client, entry, revision } of routed) {
      const task = await client.doStatus(revision.taskId);
      upsertEntry(manifest, {
        shotId: entry.shotId,
        status: task.status,
        taskId: revision.taskId,
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
