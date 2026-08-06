import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ContextModule from "./context.js";
import { looksLikeShotsFile, runStatus } from "./status.js";

// The positional shots-file path must never reach the network.
vi.mock("./context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ContextModule>();
  return {
    ...actual,
    createArkClient: vi.fn(() => {
      throw new Error("createArkClient must not be called");
    }),
    createVideoModel: vi.fn((modelId: string) => ({
      doStatus: vi.fn(() =>
        Promise.resolve({ id: "t", model: modelId, status: "running" })
      ),
      modelId,
    })),
  };
});

async function scaffold(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-status-"));
  const shotsPath = join(dir, "shots.json");
  await writeFile(
    shotsPath,
    JSON.stringify({ film: { title: "T" }, shots: [{ id: "a", prompt: "p" }] })
  );
  await writeFile(
    join(dir, "tasks.json"),
    JSON.stringify({
      entries: {
        a: {
          attempts: 1,
          shotId: "a",
          status: "succeeded",
          submittedAt: "2026-01-01T00:00:00.000Z",
          taskId: "task-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      shotsFile: shotsPath,
      version: 2,
    })
  );
  return shotsPath;
}

describe("looksLikeShotsFile", () => {
  it("treats a *.json path as a shots file and anything else as a task id", () => {
    expect(looksLikeShotsFile("films/x/shots.json")).toBe(true);
    expect(looksLikeShotsFile("cgt-2026061112-abcdef")).toBe(false);
  });
});

describe("runStatus", () => {
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  afterEach(() => {
    write.mockClear();
  });

  it("reads the manifest from a positional shots file", async () => {
    const shotsPath = await scaffold();
    await runStatus(shotsPath, {
      draft: false,
      refresh: false,
      shots: "./shots.json",
    });
    const output = write.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("task-1");
  });

  /**
   * `status` is what an agent reads to decide whether to spend, so a typo must
   * not come back as a clean, empty, exit-0 "nothing generated yet".
   */
  it("fails on a shots file that is not there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-status-"));
    const missing = join(dir, "nope.json");
    const failure = (await runStatus(missing, {
      draft: false,
      refresh: false,
      shots: "./shots.json",
    }).catch((error: unknown) => error)) as Error & {
      code?: string;
      hint?: string;
    };

    expect(failure.code).toBe("file_not_found");
    expect(failure.message).toContain(missing);
    expect(failure.hint).toContain("vs init");
  });

  it("still reports an empty manifest for a real film with nothing generated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-status-"));
    const shotsPath = join(dir, "shots.json");
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { title: "T" },
        shots: [{ id: "a", prompt: "p" }],
      })
    );
    await expect(
      runStatus(shotsPath, {
        draft: false,
        refresh: false,
        shots: "./shots.json",
      })
    ).resolves.toBeUndefined();
  });
});

const inFlight = (shotId: string, model: string) => ({
  attempts: 1,
  params: { duration: 8, generateAudio: true, model, ratio: "16:9" },
  shotId,
  status: "running",
  submittedAt: "2026-01-01T00:00:00.000Z",
  taskId: `task-${shotId}`,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/**
 * `--refresh` used to build ONE `ArkClient` for the whole film, so refreshing a
 * MiniMax or bridged film sent its task ids to BytePlus with an ARK_API_KEY and
 * came back as a baffling 4xx. Routing is per entry, off the model recorded at
 * submit time, because a film that changed `film.model` between passes has
 * entries belonging to two backends at once.
 */
describe("vs status --refresh routing", () => {
  it("asks each entry's own backend, not one Ark client for the film", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-status-refresh-"));
    const shotsPath = join(dir, "shots.json");
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { title: "T" },
        shots: [
          { id: "a", prompt: "p" },
          { id: "b", prompt: "p" },
        ],
      })
    );
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({
        entries: {
          a: inFlight("a", "dreamina-seedance-2-0-260128"),
          b: inFlight("b", "MiniMax-H3"),
        },
        shotsFile: shotsPath,
        version: 2,
      })
    );

    const context = await import("./context.js");
    await runStatus(shotsPath, {
      draft: false,
      refresh: true,
      shots: shotsPath,
    });

    const asked = vi
      .mocked(context.createVideoModel)
      .mock.calls.map(([modelId]) => modelId);
    expect(asked).toContain("dreamina-seedance-2-0-260128");
    expect(asked).toContain("MiniMax-H3");
  });
});
