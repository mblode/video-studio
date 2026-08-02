import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ELEVEN_V3_MODEL } from "../elevenlabs.js";
import { runNarrate } from "./narrate.js";
import type * as OutputModule from "./output.js";

const reported = vi.hoisted(() => ({
  payloads: [] as unknown[],
}));

vi.mock("./output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OutputModule>();
  return {
    ...actual,
    emit: (payload: unknown, human: () => void) => {
      reported.payloads.push(payload);
      human();
    },
    heading: vi.fn(),
    line: vi.fn(),
    note: vi.fn(),
    ok: vi.fn(),
  };
});

describe("runNarrate --text-file", () => {
  beforeEach(() => {
    reported.payloads.length = 0;
    process.env.ELEVENLABS_VOICE_ID = "voice-test";
  });

  it("dry-runs a scratch VO from a text file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-cmd-"));
    const textFile = join(dir, "scratch.txt");
    await writeFile(textFile, "One monolith voiceover paragraph.");

    await runNarrate(undefined, {
      dryRun: true,
      force: false,
      model: ELEVEN_V3_MODEL,
      textFile,
    });

    const payload = reported.payloads.at(-1) as {
      dryRun?: boolean;
      output?: string;
      request?: { model_id: string; text: string };
      textFile?: string;
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.textFile).toBe(textFile);
    expect(payload.output).toBe(join(dir, "narration-scratch.mp3"));
    expect(payload.request?.model_id).toBe(ELEVEN_V3_MODEL);
    expect(payload.request?.text).toBe("One monolith voiceover paragraph.");
  });
});
