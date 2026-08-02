import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArkClient, PollOptions } from "../ark.js";
import { loadManifest } from "../manifest.js";
import type { ArkTask, ManifestEntry } from "../types.js";
import type { GenerateOptions } from "./generate.js";
import { runGenerate } from "./generate.js";
import type * as OutputModule from "./output.js";

vi.mock("../download.js", () => ({
  downloadFile: vi.fn(async (_url: string, outputPath: string) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "video");
  }),
}));

/**
 * Capture what the command reports instead of spying on the process streams:
 * `emit` picks its branch from whether stdout is a terminal, which a test has
 * no business depending on. The human branch is always run here so both the
 * structured payload and the lines an operator reads are assertable.
 */
const reported = vi.hoisted(() => ({
  lines: [] as string[],
  payloads: [] as unknown[],
}));

vi.mock("./output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OutputModule>();
  const record = (text: string) => {
    reported.lines.push(text);
  };
  return {
    ...actual,
    emit: (payload: unknown, human: () => void) => {
      reported.payloads.push(payload);
      human();
    },
    fail: record,
    heading: record,
    line: record,
    note: record,
    ok: record,
    warn: record,
  };
});

interface RunCost {
  actualTokens: number;
  actualUsd: number;
  estimatedTokens: number;
  estimatedUsd: number;
  message: string;
  shots: number;
  withinTolerance: boolean;
}

function lastPayload(): { cost?: RunCost } {
  return reported.payloads.at(-1) as { cost?: RunCost };
}

function fakeClient(
  failTaskIds: string[] = [],
  completionTokens?: number
): ArkClient {
  let n = 0;
  const fail = new Set(failTaskIds);
  return {
    createTask: vi.fn((): Promise<ArkTask> => {
      n += 1;
      return Promise.resolve({ id: `task-${n}`, status: "queued" });
    }),
    pollTask: vi.fn(
      async (id: string, pollOpts: PollOptions): Promise<ArkTask> => {
        const status: ArkTask["status"] = fail.has(id) ? "failed" : "succeeded";
        const billed =
          status === "succeeded" && completionTokens !== undefined
            ? {
                usage: {
                  completion_tokens: completionTokens,
                  total_tokens: completionTokens,
                },
              }
            : {};
        const task: ArkTask = {
          content:
            status === "succeeded"
              ? { video_url: `https://x/${id}.mp4` }
              : undefined,
          id,
          status,
          ...billed,
        };
        await pollOpts.onUpdate?.(task);
        return task;
      }
    ),
  } as unknown as ArkClient;
}

function opts(overrides?: Partial<GenerateOptions>): GenerateOptions {
  return {
    concurrency: 2,
    download: true,
    dryRun: false,
    force: false,
    pollInterval: 0,
    timeout: 1,
    wait: true,
    yes: true,
    ...overrides,
  };
}

async function scaffold(
  shots: unknown[],
  entries?: Record<string, Partial<ManifestEntry>>
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-gen-"));
  const shotsPath = join(dir, "shots.json");
  await writeFile(shotsPath, JSON.stringify({ film: { title: "T" }, shots }));
  if (entries) {
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({ entries, shotsFile: shotsPath, version: 1 })
    );
  }
  return shotsPath;
}

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    attempts: 1,
    shotId: "x",
    status: "submitted",
    submittedAt: "2026-01-01T00:00:00.000Z",
    taskId: "task-old",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runGenerate", () => {
  beforeEach(() => {
    reported.lines.length = 0;
    reported.payloads.length = 0;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("submits, polls, and downloads each shot (happy path)", async () => {
    const shotsPath = await scaffold([
      { id: "a", prompt: "p" },
      { id: "b", prompt: "p" },
    ]);
    const client = fakeClient();
    await runGenerate(shotsPath, opts(), { client });

    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.status).toBe("downloaded");
    expect(manifest.entries.b?.status).toBe("downloaded");
    expect(manifest.entries.a?.outputPath).toBe("output/clips/a/v001.mp4");
    expect(client.createTask).toHaveBeenCalledTimes(2);
  });

  it("skips a shot already downloaded on disk", async () => {
    const shotsPath = await scaffold(
      [
        { id: "a", prompt: "p" },
        { id: "b", prompt: "p" },
      ],
      {
        a: entry({
          outputPath: "output/a.mp4",
          shotId: "a",
          status: "downloaded",
        }),
      }
    );
    // create the on-disk clip so isComplete(a) is true
    await mkdir(join(dirname(shotsPath), "output"), { recursive: true });
    await writeFile(join(dirname(shotsPath), "output", "a.mp4"), "video");

    const client = fakeClient();
    await runGenerate(shotsPath, opts(), { client });

    // only b is submitted; a was skipped
    expect(client.createTask).toHaveBeenCalledTimes(1);
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.b?.status).toBe("downloaded");
  });

  it("re-attaches an in-flight shot instead of re-submitting", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }], {
      a: entry({ shotId: "a", status: "running", taskId: "task-live" }),
    });
    const client = fakeClient();
    await runGenerate(shotsPath, opts(), { client });

    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.pollTask).toHaveBeenCalledWith(
      "task-live",
      expect.anything()
    );
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.status).toBe("downloaded");
  });

  it("never duplicates an in-flight task, even when --force is passed", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }], {
      a: entry({ shotId: "a", status: "running", taskId: "task-live" }),
    });
    const client = fakeClient();
    await runGenerate(shotsPath, opts({ force: true }), { client });

    expect(client.createTask).not.toHaveBeenCalled();
    expect(client.pollTask).toHaveBeenCalledWith(
      "task-live",
      expect.anything()
    );
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.attempts).toBe(1);
  });

  it("fails fast instead of hanging when the cost prompt has no TTY", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    const client = fakeClient();
    // @clack/prompts never resolves on a non-TTY stdin, so an unguarded
    // confirm() wedges every agent and CI run forever.
    const failure = await runGenerate(shotsPath, opts({ yes: false }), {
      client,
    }).catch((error: unknown) => error);

    expect((failure as Error & { code?: string }).code).toBe("not_interactive");
    expect((failure as Error & { hint?: string }).hint).toContain("--yes");
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it("lists the valid ids when --shot names an unknown shot", async () => {
    const shotsPath = await scaffold([
      { id: "a", prompt: "p" },
      { id: "b", prompt: "p" },
    ]);
    const failure = await runGenerate(shotsPath, opts({ shot: ["nope"] }), {
      client: fakeClient(),
    }).catch((error: unknown) => error);

    expect((failure as Error & { code?: string }).code).toBe("unknown_id");
    expect((failure as Error & { hint?: string }).hint).toContain("a, b");
  });

  it("refuses a 24s shot on Seedance 2.0 even though the schema allows 30", async () => {
    const shotsPath = await scaffold([{ duration: 24, id: "a", prompt: "p" }]);
    const failure = await runGenerate(shotsPath, opts({ dryRun: true }), {
      client: fakeClient(),
    }).catch((error: unknown) => error);

    expect((failure as Error & { code?: string }).code).toBe("invalid_input");
    expect(String(failure)).toMatch(/duration 24s/u);
  });

  it("accepts a 24s shot on Seedance 2.5 in dry-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-gen-"));
    const shotsPath = join(dir, "shots.json");
    const model = "dreamina-seedance-2-5-260628";
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { model, title: "T" },
        shots: [{ duration: 24, id: "a", prompt: "p" }],
      })
    );
    await runGenerate(shotsPath, opts({ dryRun: true }), {
      client: fakeClient(),
    });

    const payload = reported.payloads.at(-1) as {
      dryRun?: boolean;
      payloads?: { payload: { duration: number; model: string } }[];
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.payloads?.[0]?.payload.duration).toBe(24);
    expect(payload.payloads?.[0]?.payload.model).toBe(model);
  });

  it("records the resolution actually sent, not a guessed default", async () => {
    const shotsPath = await scaffold([
      { id: "unset", prompt: "p" },
      { id: "set", prompt: "p", resolution: "720p" },
    ]);
    await runGenerate(shotsPath, opts(), { client: fakeClient() });

    const manifest = await loadManifest(shotsPath);
    // Nothing set a resolution, so nothing was sent: the audit trail says the
    // API chose, rather than claiming we asked for 1080p.
    expect(manifest.entries.unset?.params?.resolution).toBeUndefined();
    expect(manifest.entries.set?.params?.resolution).toBe("720p");
  });

  it("persists the billed tokens and keeps them through the download", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), {
      client: fakeClient([], 400_000),
    });

    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.status).toBe("downloaded");
    expect(manifest.entries.a?.tokensUsed).toBe(400_000);
  });

  it("reconciles the bill against the estimate after a run", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), { client: fakeClient([], 400_000) });

    const { cost } = lastPayload();
    expect(cost?.shots).toBe(1);
    expect(cost?.actualTokens).toBe(400_000);
    expect(cost?.estimatedTokens).toBeGreaterThan(0);
    expect(cost?.actualUsd).toBeGreaterThan(0);
    expect(cost?.message).toContain("billed");
  });

  it("flags an estimate that missed the bill by more than the tolerance", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), { client: fakeClient([], 5_000_000) });

    const { cost } = lastPayload();
    expect(cost?.withinTolerance).toBe(false);
    expect(cost?.message).toContain("recalibrate");
  });

  it("prints the tokens and the dollars a human can act on", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), { client: fakeClient([], 400_000) });

    const output = reported.lines.join("\n");
    expect(output).toContain("cost: billed");
    expect(output).toMatch(/\$\d+\.\d\d actual vs \$\d+\.\d\d estimated/u);
  });

  it("reports no reconciliation when the provider sends no usage", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), { client: fakeClient() });

    expect(lastPayload().cost).toBeUndefined();
  });

  it("isolates a failed shot from a succeeding one", async () => {
    const shotsPath = await scaffold([
      { id: "a", prompt: "p" },
      { id: "b", prompt: "p" },
    ]);
    // concurrency 1 → deterministic ids: a=task-1 (fails), b=task-2 (ok)
    const client = fakeClient(["task-1"]);
    await runGenerate(shotsPath, opts({ concurrency: 1 }), { client });

    expect(process.exitCode).toBe(1);
    const manifest = await loadManifest(shotsPath);
    expect(manifest.entries.a?.status).toBe("failed");
    expect(manifest.entries.b?.status).toBe("downloaded");
  });

  it("writes retakes beside the selected take instead of overwriting it", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await runGenerate(shotsPath, opts(), { client: fakeClient() });
    await runGenerate(shotsPath, opts({ force: true }), {
      client: fakeClient(),
    });

    const manifest = await loadManifest(shotsPath);
    const filmDir = dirname(shotsPath);
    expect(manifest.entries.a?.selectedVersion).toBe(2);
    expect(manifest.entries.a?.outputPath).toBe("output/clips/a/v002.mp4");
    expect(
      manifest.entries.a?.versions?.map((version) => version.outputPath)
    ).toEqual(["output/clips/a/v001.mp4", "output/clips/a/v002.mp4"]);
    expect(existsSync(join(filmDir, "output", "clips", "a", "v001.mp4"))).toBe(
      true
    );
    expect(existsSync(join(filmDir, "output", "clips", "a", "v002.mp4"))).toBe(
      true
    );
  });
});

/**
 * `--yes` is how an agent or a CI job runs `vs generate`, so a ceiling that
 * `--yes` waived would be a ceiling that never fires on the runs that need it.
 */
describe("runGenerate --max-cost", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  const expensive = [
    { duration: 15, id: "a", prompt: "p", resolution: "4k" },
  ] as const;

  it("refuses the run when the estimate exceeds the ceiling, even under --yes", async () => {
    const shotsPath = await scaffold([...expensive]);
    const client = fakeClient();
    const failure = (await runGenerate(
      shotsPath,
      opts({ maxCost: 1, yes: true }),
      { client }
    ).catch((error: unknown) => error)) as Error & {
      code?: string;
      hint?: string;
    };

    expect(failure.code).toBe("cost_ceiling");
    expect(failure.message).toContain("--max-cost");
    expect(failure.hint).toContain("--max-cost");
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it("submits when the estimate is under the ceiling", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    const client = fakeClient();
    await runGenerate(shotsPath, opts({ maxCost: 1000 }), { client });

    expect(client.createTask).toHaveBeenCalledTimes(1);
  });

  it("enforces the ceiling in --dry-run, so a budget can be checked for free", async () => {
    const shotsPath = await scaffold([...expensive]);
    const client = fakeClient();
    const failure = (await runGenerate(
      shotsPath,
      opts({ dryRun: true, maxCost: 1 }),
      { client }
    ).catch((error: unknown) => error)) as Error & { code?: string };

    expect(failure.code).toBe("cost_ceiling");
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it("passes a --dry-run that stays under the ceiling", async () => {
    const shotsPath = await scaffold([{ id: "a", prompt: "p" }]);
    await expect(
      runGenerate(shotsPath, opts({ dryRun: true, maxCost: 1000 }), {
        client: fakeClient(),
      })
    ).resolves.toBeUndefined();
  });
});
