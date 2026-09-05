import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { VsError } from "./errors.js";
import type { Pass } from "./paths.js";
import type { Shot } from "./types.js";

export type VisualReviewVerdict = "approved" | "rejected";

interface CastReferenceHash {
  cast: string;
  sha256: string;
  url: string;
}

export interface VisualReviewReceipt {
  canonicalCast: { references: CastReferenceHash[]; sha256: string };
  media: { path: string; sha256: string };
  note: string;
  pass: Pass;
  reviewedAt: string;
  shotId: string;
  verdict: VisualReviewVerdict;
  version: number;
}

interface VisualReviewFile {
  receipts: Record<string, VisualReviewReceipt>;
  schemaVersion: 1;
}

const EMPTY_FILE: VisualReviewFile = { receipts: {}, schemaVersion: 1 };
const writeQueues = new Map<string, Promise<void>>();

function receiptKey(pass: Pass, shotId: string, version: number): string {
  return `${pass}:${shotId}:v${version}`;
}

function reviewPath(shotsFile: string): string {
  return join(dirname(resolve(shotsFile)), "visual-reviews.json");
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function localPath(shotsFile: string, path: string): string {
  if (/^https?:\/\//iu.test(path)) {
    throw new VsError(
      "invalid_input",
      `visual review cannot hash remote URL ${path}`,
      { hint: "materialize the reference locally before recording a verdict" }
    );
  }
  return isAbsolute(path)
    ? resolve(path)
    : resolve(dirname(resolve(shotsFile)), path);
}

async function canonicalCast(
  shotsFile: string,
  shot: Shot
): Promise<VisualReviewReceipt["canonicalCast"]> {
  const declared = shot.cast ?? [];
  const candidates = (shot.references ?? []).filter(
    (reference) => reference.cast && reference.type === "image"
  );
  const orphan = candidates.find(
    (reference) => !declared.includes(reference.cast as string)
  );
  if (orphan) {
    throw new VsError(
      "invalid_input",
      `${shot.id} reference ${orphan.url} binds undeclared cast ${orphan.cast}`,
      { hint: "run `vs cast sync`, then review the clip again" }
    );
  }
  for (const cast of declared) {
    const matches = candidates.filter((reference) => reference.cast === cast);
    if (matches.length !== 1) {
      throw new VsError(
        "invalid_input",
        `${shot.id} cast ${cast} needs exactly one canonical image reference; found ${matches.length}`,
        { hint: "run `vs cast sync`, then review the clip again" }
      );
    }
  }
  const references = await Promise.all(
    candidates
      .filter((reference) => declared.includes(reference.cast as string))
      .map(async (reference) => ({
        cast: reference.cast as string,
        sha256: await sha256(localPath(shotsFile, reference.url)),
        url: reference.url,
      }))
  );
  references.sort((a, b) =>
    `${a.cast}\0${a.url}`.localeCompare(`${b.cast}\0${b.url}`)
  );
  return {
    references,
    sha256: createHash("sha256")
      .update(JSON.stringify(references))
      .digest("hex"),
  };
}

async function load(shotsFile: string): Promise<VisualReviewFile> {
  const path = reviewPath(shotsFile);
  if (!existsSync(path)) {
    return { ...EMPTY_FILE, receipts: {} };
  }
  const parsed = JSON.parse(await readFile(path, "utf-8")) as VisualReviewFile;
  if (parsed.schemaVersion !== 1 || !parsed.receipts) {
    throw new VsError("invalid_input", `${path} is not a visual review file`);
  }
  return parsed;
}

export async function recordVisualReview(input: {
  mediaPath: string;
  note: string;
  pass: Pass;
  shot: Shot;
  shotsFile: string;
  verdict: VisualReviewVerdict;
  version: number;
}): Promise<VisualReviewReceipt> {
  if (input.verdict !== "approved" && input.verdict !== "rejected") {
    throw new VsError(
      "invalid_input",
      `visual review verdict must be approved or rejected; received ${String(input.verdict)}`
    );
  }
  const note = input.note.trim();
  if (!note) {
    throw new VsError("invalid_input", "visual review note must not be blank");
  }
  const mediaPath = localPath(input.shotsFile, input.mediaPath);
  const receipt: VisualReviewReceipt = {
    canonicalCast: await canonicalCast(input.shotsFile, input.shot),
    media: {
      path: input.mediaPath,
      sha256: await sha256(mediaPath),
    },
    note,
    pass: input.pass,
    reviewedAt: new Date().toISOString(),
    shotId: input.shot.id,
    verdict: input.verdict,
    version: input.version,
  };
  const path = reviewPath(input.shotsFile);
  // oxlint-disable-next-line promise/prefer-await-to-then -- queue chaining serializes writes to this receipt file
  const queued = (writeQueues.get(path) ?? Promise.resolve()).then(async () => {
    const file = await load(input.shotsFile);
    file.receipts[receiptKey(input.pass, input.shot.id, input.version)] =
      receipt;
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
    await rename(tmp, path);
  });
  writeQueues.set(
    path,
    // oxlint-disable-next-line promise/prefer-await-to-then -- callers get the original rejection; only keep the queue alive
    queued.catch(() => {
      // intentionally empty
    })
  );
  await queued;
  return receipt;
}

export async function assertVisualApproval(input: {
  mediaPath: string;
  pass: Pass;
  shot: Shot;
  shotsFile: string;
  version: number;
}): Promise<VisualReviewReceipt> {
  const file = await load(input.shotsFile);
  const receipt =
    file.receipts[receiptKey(input.pass, input.shot.id, input.version)];
  const hint = `record an explicit visual verdict for ${input.shot.id} v${String(input.version).padStart(3, "0")}`;
  if (!receipt) {
    throw new VsError(
      "invalid_input",
      `${input.shot.id} has no visual review receipt`,
      { hint }
    );
  }
  if (receipt.verdict !== "approved") {
    throw new VsError(
      "invalid_input",
      `${input.shot.id} was visually rejected: ${receipt.note}`,
      { hint }
    );
  }
  const [mediaHash, cast] = await Promise.all([
    sha256(localPath(input.shotsFile, input.mediaPath)),
    canonicalCast(input.shotsFile, input.shot),
  ]);
  if (
    receipt.media.path !== input.mediaPath ||
    receipt.media.sha256 !== mediaHash ||
    receipt.canonicalCast.sha256 !== cast.sha256
  ) {
    throw new VsError(
      "invalid_input",
      `${input.shot.id} visual approval is stale`,
      { hint }
    );
  }
  return receipt;
}

/** Lightweight gate check so films that did not opt in keep legacy behaviour. */
export async function visualApprovalRequired(
  shotsFile: string
): Promise<boolean> {
  const parsed = JSON.parse(await readFile(resolve(shotsFile), "utf-8")) as {
    film?: { requireVisualApproval?: unknown };
  };
  return parsed.film?.requireVisualApproval === true;
}
