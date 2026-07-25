import { existsSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { passSuffix } from "./paths.js";
import type { Pass } from "./paths.js";
import type { Manifest, ManifestEntry, ManifestStatus } from "./types.js";

export function manifestPath(
  shotsFilePath: string,
  pass: Pass = "final"
): string {
  return join(dirname(resolve(shotsFilePath)), `tasks${passSuffix(pass)}.json`);
}

export async function loadManifest(
  shotsFilePath: string,
  pass: Pass = "final"
): Promise<Manifest> {
  const path = manifestPath(shotsFilePath, pass);
  if (!existsSync(path)) {
    return { entries: {}, shotsFile: shotsFilePath, version: 1 };
  }
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Manifest;
}

const writeQueues = new Map<string, Promise<void>>();

/**
 * Atomic write: tmp file then rename, so a killed process resumes cleanly.
 * Writes to the same manifest are serialized through an in-process queue —
 * concurrent saves (submit + poll updates) would otherwise race on the
 * shared tmp filename and crash with ENOENT on rename.
 */
export function saveManifest(
  shotsFilePath: string,
  manifest: Manifest,
  pass: Pass = "final"
): Promise<void> {
  const path = manifestPath(shotsFilePath, pass);
  // oxlint-disable-next-line promise/prefer-await-to-then -- queue chaining is the mechanism
  const queued = (writeQueues.get(path) ?? Promise.resolve()).then(async () => {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    await rename(tmp, path);
  });
  writeQueues.set(
    path,
    // oxlint-disable-next-line promise/prefer-await-to-then -- swallow only for the queue; callers still get the rejection via `queued`
    queued.catch(() => {
      // intentionally empty: keep the queue alive after a failed write
    })
  );
  return queued;
}

export interface EntryUpdate {
  error?: string;
  newAttempt?: boolean;
  outputPath?: string;
  params?: ManifestEntry["params"];
  payloadHash?: string;
  shotId: string;
  status: ManifestStatus;
  taskId?: string;
  /** Billed output tokens off a finished task (`usage.completion_tokens`). */
  tokensUsed?: number;
  videoUrl?: string;
}

/**
 * The audit trail, which an update may omit without erasing. A shot reports its
 * params at submit and its bill at completion, then gets a bare `downloaded`
 * update, so every one of these has to survive an update that does not mention
 * it.
 */
function carriedFields(
  update: EntryUpdate,
  existing: ManifestEntry | undefined
): Pick<
  ManifestEntry,
  "error" | "outputPath" | "params" | "payloadHash" | "tokensUsed"
> {
  return {
    error: update.error ?? existing?.error,
    outputPath: update.outputPath ?? existing?.outputPath,
    params: update.params ?? existing?.params,
    payloadHash: update.payloadHash ?? existing?.payloadHash,
    tokensUsed: update.tokensUsed ?? existing?.tokensUsed,
  };
}

/**
 * A result URL is a presigned link that expires ~24h after generation and
 * carries the provider's access key id in its query string. Once the clip is on
 * disk the URL has no remaining value, so it is dropped instead of being
 * committed with the manifest.
 */
export function upsertEntry(
  manifest: Manifest,
  update: EntryUpdate
): ManifestEntry {
  const now = new Date().toISOString();
  const existing = manifest.entries[update.shotId];
  const videoUrl =
    update.status === "downloaded"
      ? undefined
      : (update.videoUrl ?? existing?.videoUrl);
  const next: ManifestEntry = {
    ...carriedFields(update, existing),
    attempts: (existing?.attempts ?? 0) + (update.newAttempt ? 1 : 0),
    shotId: update.shotId,
    status: update.status,
    submittedAt: existing?.submittedAt ?? now,
    taskId: update.taskId ?? existing?.taskId ?? "",
    updatedAt: now,
    videoUrl,
  };
  manifest.entries[update.shotId] = next;
  return next;
}

/**
 * Resume semantics: a shot is complete when its manifest entry succeeded (or
 * downloaded) AND the output file exists on disk with size > 0.
 */
export function isComplete(
  entry: ManifestEntry | undefined,
  manifestDir: string
): boolean {
  if (!entry?.outputPath) {
    return false;
  }
  if (entry.status !== "succeeded" && entry.status !== "downloaded") {
    return false;
  }
  const path = resolve(manifestDir, entry.outputPath);
  return existsSync(path) && statSync(path).size > 0;
}

/** Tasks still in flight at the API — re-attach instead of re-paying. */
export function isInFlight(entry: ManifestEntry | undefined): boolean {
  return (
    entry !== undefined &&
    entry.taskId !== "" &&
    (entry.status === "submitted" ||
      entry.status === "queued" ||
      entry.status === "running")
  );
}
