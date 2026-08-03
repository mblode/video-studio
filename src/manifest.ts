import { existsSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { passSuffix } from "./paths.js";
import type { Pass } from "./paths.js";
import type {
  Manifest,
  ManifestEntry,
  ManifestRevision,
  ManifestStatus,
} from "./types.js";

export function manifestPath(
  shotsFilePath: string,
  pass: Pass = "final"
): string {
  return join(dirname(resolve(shotsFilePath)), `tasks${passSuffix(pass)}.json`);
}

interface LegacyManifest {
  entries?: Record<string, ManifestEntry>;
  shotsFile?: string;
  version?: number;
}

function legacyRevision(entry: ManifestEntry): ManifestRevision | undefined {
  if (!entry.taskId) {
    return undefined;
  }
  return {
    error: entry.error,
    outputPath: entry.outputPath,
    params: entry.params,
    payloadHash: entry.payloadHash,
    status: entry.status,
    submittedAt: entry.submittedAt,
    taskId: entry.taskId,
    tokensUsed: entry.tokensUsed,
    updatedAt: entry.updatedAt,
    version: Math.max(entry.attempts, 1),
    videoUrl: entry.videoUrl,
  };
}

/** Read v1 manifests without moving or renaming their existing clips. */
/**
 * Drop every result URL for a clip that is already on disk.
 *
 * A result URL is presigned: it expires ~24h after generation and carries the
 * provider's access key id in its query string. `upsertEntry` never stores one
 * for a downloaded clip, but manifests written by older versions did, and
 * `legacyRevision` copied them forward on migration. Manifests are committed on
 * purpose so a generation resumes anywhere, so a stale URL is a credential in
 * someone's git history. Healing on read means the next command that touches an
 * old manifest cleans it, without anyone having to know to look.
 */
function dropDownloadedUrls(entry: ManifestEntry): void {
  if (entry.outputPath) {
    entry.videoUrl = undefined;
  }
  for (const revision of entry.versions ?? []) {
    if (revision.outputPath) {
      revision.videoUrl = undefined;
    }
  }
}

function migrateManifest(raw: LegacyManifest): Manifest {
  const entries = raw.entries ?? {};
  for (const entry of Object.values(entries)) {
    if (!entry.versions) {
      const revision = legacyRevision(entry);
      entry.versions = revision ? [revision] : [];
    }
    if (
      entry.selectedVersion === undefined &&
      entry.outputPath &&
      (entry.status === "downloaded" || entry.status === "succeeded")
    ) {
      entry.selectedVersion =
        entry.versions.findLast(
          (revision) => revision.outputPath === entry.outputPath
        )?.version ?? Math.max(entry.attempts, 1);
    }
    dropDownloadedUrls(entry);
  }
  return {
    entries,
    shotsFile: raw.shotsFile ?? "",
    version: 2,
  };
}

export async function loadManifest(
  shotsFilePath: string,
  pass: Pass = "final"
): Promise<Manifest> {
  const path = manifestPath(shotsFilePath, pass);
  if (!existsSync(path)) {
    return { entries: {}, shotsFile: shotsFilePath, version: 2 };
  }
  const raw = await readFile(path, "utf-8");
  return migrateManifest(JSON.parse(raw) as LegacyManifest);
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
  if (update.newAttempt) {
    return {
      error: update.error,
      // This is the selected successful path, not an attribute of the latest
      // attempt, so it remains available until a new download replaces it.
      outputPath: existing?.outputPath,
      params: update.params,
      payloadHash: update.payloadHash,
      tokensUsed: update.tokensUsed,
    };
  }
  return {
    error: update.error ?? existing?.error,
    outputPath: update.outputPath ?? existing?.outputPath,
    params: update.params ?? existing?.params,
    payloadHash: update.payloadHash ?? existing?.payloadHash,
    tokensUsed: update.tokensUsed ?? existing?.tokensUsed,
  };
}

function revisionFields(
  update: EntryUpdate,
  existing: ManifestRevision | undefined,
  now: string,
  version: number
): ManifestRevision {
  return {
    error: update.error ?? existing?.error,
    outputPath: update.outputPath ?? existing?.outputPath,
    params: update.params ?? existing?.params,
    payloadHash: update.payloadHash ?? existing?.payloadHash,
    status: update.status,
    submittedAt: existing?.submittedAt ?? now,
    taskId: update.taskId ?? existing?.taskId ?? "",
    tokensUsed: update.tokensUsed ?? existing?.tokensUsed,
    updatedAt: now,
    version,
    videoUrl:
      update.status === "downloaded"
        ? undefined
        : (update.videoUrl ?? existing?.videoUrl),
  };
}

interface RevisionUpdate {
  revisionVersion: number;
  versions: ManifestRevision[];
}

function updateRevisions(
  existing: ManifestEntry | undefined,
  update: EntryUpdate,
  attempts: number,
  now: string
): RevisionUpdate {
  const versions = (existing?.versions ?? []).map((revision) =>
    update.newAttempt ? { ...revision, videoUrl: undefined } : revision
  );
  let revisionIndex = update.newAttempt
    ? -1
    : versions.findLastIndex(
        (revision) =>
          update.taskId === undefined || revision.taskId === update.taskId
      );
  if (revisionIndex < 0 && existing && versions.length === 0) {
    const revision = legacyRevision(existing);
    if (revision) {
      versions.push(revision);
      revisionIndex = update.newAttempt ? -1 : 0;
    }
  }
  const revisionVersion = update.newAttempt
    ? Math.max(attempts, 1)
    : (versions[revisionIndex]?.version ?? Math.max(attempts, 1));
  const revision = revisionFields(
    update,
    revisionIndex >= 0 ? versions[revisionIndex] : undefined,
    now,
    revisionVersion
  );
  if (revisionIndex >= 0) {
    versions[revisionIndex] = revision;
  } else {
    versions.push(revision);
  }
  return { revisionVersion, versions };
}

function currentVideoUrl(
  existing: ManifestEntry | undefined,
  update: EntryUpdate
): string | undefined {
  if (update.status === "downloaded") {
    return undefined;
  }
  if (update.videoUrl !== undefined) {
    return update.videoUrl;
  }
  return update.newAttempt ? undefined : existing?.videoUrl;
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
  const attempts = (existing?.attempts ?? 0) + (update.newAttempt ? 1 : 0);
  const { revisionVersion, versions } = updateRevisions(
    existing,
    update,
    attempts,
    now
  );
  const selectedVersion =
    update.status === "downloaded" && update.outputPath
      ? revisionVersion
      : existing?.selectedVersion;
  const next: ManifestEntry = {
    ...carriedFields(update, existing),
    attempts,
    selectedVersion,
    shotId: update.shotId,
    status: update.status,
    submittedAt: update.newAttempt ? now : (existing?.submittedAt ?? now),
    taskId: update.taskId ?? existing?.taskId ?? "",
    updatedAt: now,
    versions,
    videoUrl: currentVideoUrl(existing, update),
  };
  manifest.entries[update.shotId] = next;
  return next;
}

export function selectedRevision(
  entry: ManifestEntry | undefined
): ManifestRevision | undefined {
  if (!entry) {
    return undefined;
  }
  if (entry.selectedVersion !== undefined) {
    return entry.versions?.find(
      (revision) => revision.version === entry.selectedVersion
    );
  }
  return legacyRevision(entry);
}

export function latestRevision(
  entry: ManifestEntry | undefined
): ManifestRevision | undefined {
  return entry?.versions?.at(-1) ?? (entry ? legacyRevision(entry) : undefined);
}

export function isRevisionComplete(
  revision: ManifestRevision | undefined,
  manifestDir: string
): boolean {
  if (!revision?.outputPath) {
    return false;
  }
  if (revision.status !== "succeeded" && revision.status !== "downloaded") {
    return false;
  }
  const path = resolve(manifestDir, revision.outputPath);
  return existsSync(path) && statSync(path).size > 0;
}

/**
 * Resume semantics: a shot is complete when its manifest entry succeeded (or
 * downloaded) AND the output file exists on disk with size > 0.
 */
export function isComplete(
  entry: ManifestEntry | undefined,
  manifestDir: string
): boolean {
  const selected = selectedRevision(entry);
  return isRevisionComplete(selected, manifestDir);
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
