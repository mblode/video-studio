import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as FfmpegModule from "../ffmpeg.js";
import { MockVideoProvider } from "../provider.js";
import { runDoctor } from "./doctor.js";
import type { GenerateOptions } from "./generate.js";
import { runGenerate } from "./generate.js";
import { setJsonMode } from "./output.js";
import { runStatus } from "./status.js";
import type { StitchCommandOptions } from "./stitch.js";
import { runStitch } from "./stitch.js";
import { runUse } from "./use.js";

/**
 * A RATCHET on the `--json` payload keys.
 *
 * `--json` is the default whenever stdout is not a TTY, so these key sets are
 * the contract every agent driving this CLI parses. Three weaker contracts are
 * already pinned (docs-drift.test.ts pins documented flags, examples.test.ts
 * pins the fixtures, index.test.ts pins the export surface) but the payload
 * keys were not: renaming `entries` to `shots` kept the suite green while
 * breaking every downstream script silently.
 *
 * This asserts KEY SETS, never values, so ordinary behaviour changes stay free
 * and a rename shows up as a deliberate diff. If a test here fails, that is the
 * question being asked: did you mean to change the contract?
 *
 * Two things follow from pinning the keys of the PARSED payload rather than the
 * object literal. An array of objects gets its representative element pinned
 * too (a status row, a doctor check, a dry-run command), because indexing into
 * those is the whole reason an agent asked for JSON. And a key whose value is
 * `undefined` is simply absent, so these sets describe a realistic run — one
 * shot, generated and downloaded — not every field the types allow.
 *
 * No network: the video provider is `MockVideoProvider`, the download is a
 * local write, and ffmpeg is never invoked (a stitch dry-run only prints the
 * commands it would run).
 */

vi.mock("../download.js", () => ({
  downloadFile: vi.fn(async (_url: string, outputPath: string) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "video");
  }),
}));

// Only the two calls a stitch dry-run makes against real binaries. `doctor`
// below still probes the real ffmpeg/ffprobe through `assertBinary`.
vi.mock("../ffmpeg.js", async (importOriginal) => {
  const actual = await importOriginal<typeof FfmpegModule>();
  return {
    ...actual,
    assertFfmpeg: vi.fn(() => Promise.resolve()),
    probeClip: vi.fn(() =>
      Promise.resolve({
        duration: 5,
        fps: 24,
        hasAudio: true,
        height: 1080,
        width: 1920,
      })
    ),
  };
});

/**
 * Capture stdout (the payload) and swallow stderr (progress an operator reads,
 * which is never part of the contract and only clutters a test run).
 */
const capture = (): { lines: string[]; restore: () => void } => {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  // oxlint-disable-next-line typescript/no-explicit-any -- narrow shim for the capture
  (process.stdout as any).write = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  // oxlint-disable-next-line typescript/no-explicit-any -- narrow shim for the capture
  (process.stderr as any).write = (): boolean => true;
  return {
    lines,
    restore: () => {
      // oxlint-disable-next-line typescript/no-explicit-any -- restoring the shims
      (process.stdout as any).write = out;
      // oxlint-disable-next-line typescript/no-explicit-any -- restoring the shims
      (process.stderr as any).write = err;
    },
  };
};

/** Run a command in JSON mode and parse the single payload it wrote. */
async function payloadOf(run: () => Promise<unknown>): Promise<Payload> {
  const out = capture();
  try {
    await run();
  } finally {
    out.restore();
  }
  return JSON.parse(out.lines.join("")) as Payload;
}

type Payload = Record<string, unknown>;

function keys(value: unknown): string[] {
  return Object.keys(value as object).toSorted();
}

async function writeFilm(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-contract-"));
  const path = join(dir, "shots.json");
  await writeFile(
    path,
    JSON.stringify({
      film: { title: "T" },
      shots: [{ id: "s01", prompt: "p", seed: 1 }],
    })
  );
  return path;
}

function generateOptions(
  overrides?: Partial<GenerateOptions>
): GenerateOptions {
  return {
    concurrency: 1,
    download: true,
    draft: false,
    dryRun: false,
    force: false,
    pollInterval: 0,
    timeout: 1,
    wait: true,
    yes: true,
    ...overrides,
  };
}

function stitchOptions(
  overrides?: Partial<StitchCommandOptions>
): StitchCommandOptions {
  return {
    draft: false,
    dryRun: true,
    font: "Helvetica",
    grade: false,
    latest: false,
    musicGain: 0,
    narrationGain: 0,
    sfxGain: 0,
    xfade: 0,
    ...overrides,
  };
}

/** A film whose one shot has been generated and downloaded, no network. */
async function generatedFilm(): Promise<string> {
  const shotsFile = await writeFilm();
  const client = new MockVideoProvider();
  await payloadOf(() => runGenerate(shotsFile, generateOptions(), { client }));
  return shotsFile;
}

describe("--json payload contract", () => {
  beforeEach(() => {
    setJsonMode(true);
  });
  afterEach(() => {
    setJsonMode(false);
    process.exitCode = undefined;
  });

  it("vs status emits { entries, pass, shotsFile } for a film with no manifest", async () => {
    const shotsFile = await writeFilm();
    const payload = await payloadOf(() =>
      runStatus(shotsFile, { draft: false, refresh: false, shots: shotsFile })
    );

    expect(keys(payload)).toEqual(["entries", "pass", "shotsFile"]);
    expect(payload.entries).toEqual([]);
  });

  it("vs status pins the row an agent indexes into, and its revisions", async () => {
    const shotsFile = await generatedFilm();
    const payload = await payloadOf(() =>
      runStatus(shotsFile, { draft: false, refresh: false, shots: shotsFile })
    );

    expect(keys(payload)).toEqual(["entries", "pass", "shotsFile"]);
    const row = (payload.entries as Payload[])[0] as Payload;
    expect(keys(row)).toEqual([
      "attempts",
      "availableVersions",
      "complete",
      "latestVersion",
      "outputPath",
      "params",
      "payloadHash",
      "selectedVersion",
      "shotId",
      "status",
      "submittedAt",
      "taskId",
      "tokensUsed",
      "updatedAt",
      "versions",
    ]);
    const [revision] = row.versions as Payload[];
    expect(keys(revision)).toEqual([
      "outputPath",
      "params",
      "payloadHash",
      "status",
      "submittedAt",
      "taskId",
      "tokensUsed",
      "updatedAt",
      "version",
    ]);
  });

  it("vs generate --dry-run emits { dryRun, estimate, pass, payloads }", async () => {
    const shotsFile = await writeFilm();
    const payload = await payloadOf(() =>
      runGenerate(shotsFile, generateOptions({ dryRun: true }))
    );

    expect(keys(payload)).toEqual(["dryRun", "estimate", "pass", "payloads"]);
    // The quote an agent budgets against.
    expect(keys(payload.estimate)).toEqual([
      "clips",
      "seconds",
      "tokens",
      "usd",
    ]);
    // The request body inside `payload` is the provider's contract, pinned by
    // payload.test.ts; this only pins the envelope around it.
    const [entry] = payload.payloads as Payload[];
    expect(keys(entry)).toEqual(["payload", "shotId"]);
  });

  it("vs generate emits { pass, pending, status } when there is nothing to do", async () => {
    const shotsFile = await generatedFilm();
    const client = new MockVideoProvider();
    const payload = await payloadOf(() =>
      runGenerate(shotsFile, generateOptions(), { client })
    );

    expect(keys(payload)).toEqual(["pass", "pending", "status"]);
  });

  it("vs doctor emits { checks, ok } with { detail, label, status } checks", async () => {
    // No task id: the endpoint probe is the only part of doctor that would
    // reach the network, and it is skipped without one.
    const payload = await payloadOf(() => runDoctor());

    expect(keys(payload)).toEqual(["checks", "ok"]);
    const checks = payload.checks as Payload[];
    expect(checks.length).toBeGreaterThan(0);
    // `detail` is only present on the checks that have something to add, so the
    // element contract is the union, with label/status on every one.
    expect(
      [...new Set(checks.flatMap((check) => Object.keys(check)))].toSorted()
    ).toEqual(["detail", "label", "status"]);
    for (const check of checks) {
      expect(Object.keys(check)).toEqual(
        expect.arrayContaining(["label", "status"])
      );
    }
  });

  it("vs stitch --dry-run emits { commands, dryRun, outputPath }", async () => {
    const shotsFile = await generatedFilm();
    const payload = await payloadOf(() =>
      runStitch(shotsFile, stitchOptions())
    );

    expect(keys(payload)).toEqual(["commands", "dryRun", "outputPath"]);
    const [command] = payload.commands as Payload[];
    expect(keys(command)).toEqual(["args", "description"]);
  });

  it("vs use emits { outputPath, pass, selectedVersion, shotId }", async () => {
    const shotsFile = await generatedFilm();
    const payload = await payloadOf(() =>
      runUse(shotsFile, "s01", 1, { draft: false })
    );

    expect(keys(payload)).toEqual([
      "outputPath",
      "pass",
      "selectedVersion",
      "shotId",
    ]);
  });
});
