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
      version: 1,
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
});
