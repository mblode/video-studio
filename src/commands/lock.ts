import { readFileSync, unlinkSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";

import { VsError } from "../errors.js";
import { manifestPath } from "../manifest.js";
import type { Pass } from "../paths.js";
import { warn } from "./output.js";

/**
 * One writer per manifest, across processes.
 *
 * Every command that writes `tasks.json` loads it, works for minutes, and saves
 * its in-memory copy whole. Two such processes on one film do not merge: the
 * later save erases whatever the other recorded in between, and a task id that
 * vanishes that way is a paid take nobody can re-attach to. The in-process
 * queue in `saveManifest` cannot see another process, so the guard is a lock
 * file created with `wx`, which the filesystem makes exclusive.
 */

interface LockHolder {
  command: string;
  pid: number;
  startedAt: string;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

function lockPath(shotsFilePath: string, pass: Pass): string {
  return `${manifestPath(shotsFilePath, pass)}.lock`;
}

function parseHolder(raw: string): LockHolder | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<LockHolder>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.command === "string" &&
      typeof parsed.startedAt === "string"
    ) {
      return parsed as LockHolder;
    }
  } catch {
    // fall through: unreadable is reported as an unknown holder
  }
  return undefined;
}

/** `kill(pid, 0)` probes without signalling; EPERM still means it is alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function tryCreate(path: string, holder: LockHolder): Promise<boolean> {
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(holder)}\n`, "utf-8");
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function lockedError(path: string, holder: LockHolder | undefined): VsError {
  const who = holder
    ? `pid ${holder.pid} (\`vs ${holder.command}\`, started ${holder.startedAt})`
    : `an unknown process (${path} is unreadable)`;
  return new VsError(
    "film_locked",
    `this film's manifest is in use by ${who}`,
    {
      hint: holder
        ? "wait for it to finish; never run two vs commands that write the same film at once"
        : `wait for it to finish; never run two vs commands that write the same film at once. If no vs command is running, delete ${path}`,
    }
  );
}

/**
 * Take the manifest lock, refusing if a live process holds it and taking over
 * one whose holder is dead. Returns the release function.
 * SIGINT/SIGTERM release too, then re-raise so the exit is unchanged.
 */
async function acquireManifestLock(
  shotsFilePath: string,
  pass: Pass,
  command: string
): Promise<() => void> {
  const path = lockPath(shotsFilePath, pass);
  const holder: LockHolder = {
    command,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  const mine = `${JSON.stringify(holder)}\n`;

  if (!(await tryCreate(path, holder))) {
    const existing = parseHolder(await readFile(path, "utf-8").catch(() => ""));
    if (!existing || isAlive(existing.pid)) {
      throw lockedError(path, existing);
    }
    warn(
      `taking over a stale lock from pid ${existing.pid} (\`vs ${existing.command}\`, started ${existing.startedAt}), which is no longer running`
    );
    await unlink(path).catch(() => {
      // already gone: another process cleared it, and wx below decides who wins
    });
    if (!(await tryCreate(path, holder))) {
      throw lockedError(
        path,
        parseHolder(await readFile(path, "utf-8").catch(() => ""))
      );
    }
  }

  // Only ever delete the lock this process wrote: after a takeover race the
  // file on disk may belong to someone else.
  const releaseSync = () => {
    try {
      if (readFileSync(path, "utf-8") === mine) {
        unlinkSync(path);
      }
    } catch {
      // already gone
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    releaseSync();
    process.kill(process.pid, signal);
  };
  for (const signal of SIGNALS) {
    process.once(signal, onSignal);
  }
  return () => {
    for (const signal of SIGNALS) {
      process.off(signal, onSignal);
    }
    releaseSync();
  };
}

/** Run `work` holding the film's manifest lock for `pass`. */
export async function withManifestLock<T>(
  shotsFilePath: string,
  pass: Pass,
  command: string,
  work: () => Promise<T>
): Promise<T> {
  const release = await acquireManifestLock(shotsFilePath, pass, command);
  try {
    return await work();
  } finally {
    release();
  }
}
