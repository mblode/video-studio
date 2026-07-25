import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { VsError } from "./errors.js";

const EXPIRY_HINT =
  "result URLs expire ~24h after generation, so re-run `vs generate <shots-file> --shot <id> --force` to regenerate the clip";

/** Stream a remote file to disk via a .part temp file, then rename. */
export async function downloadFile(
  url: string,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const response = await fetch(url);
  if (!(response.ok && response.body)) {
    throw new VsError(
      "download_failed",
      `download failed with HTTP ${response.status} for ${outputPath}`,
      { hint: EXPIRY_HINT }
    );
  }
  const tmp = `${outputPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
    await rename(tmp, outputPath);
  } catch (error) {
    // A mid-stream failure must not leave a stale .part behind for the next run.
    await rm(tmp, { force: true });
    throw new VsError(
      "download_failed",
      `download of ${outputPath} was interrupted`,
      { cause: error, hint: EXPIRY_HINT }
    );
  }
}
