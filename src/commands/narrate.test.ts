import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeminiTtsClient } from "../tts.js";
import { GEMINI_TTS_MODEL } from "../tts.js";
import { runNarrate, runNarrateAssemble } from "./narrate.js";
import type * as OutputModule from "./output.js";

const reported = vi.hoisted(() => ({
  payloads: [] as unknown[],
  warnings: [] as string[],
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
    warn: (message: string) => reported.warnings.push(message),
  };
});

describe("runNarrate --text-file", () => {
  beforeEach(() => {
    reported.payloads.length = 0;
    reported.warnings.length = 0;
  });

  it("dry-runs a scratch VO from a text file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-cmd-"));
    const textFile = join(dir, "scratch.txt");
    await writeFile(textFile, "One monolith voiceover paragraph.");

    await runNarrate(undefined, {
      dryRun: true,
      force: false,
      model: GEMINI_TTS_MODEL,
      textFile,
    });

    const payload = reported.payloads.at(-1) as {
      dryRun?: boolean;
      output?: string;
      request?: { model: string; input: { content: { text: string }[] }[] };
      textFile?: string;
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.textFile).toBe(textFile);
    expect(payload.output).toBe(join(dir, "narration-scratch.mp3"));
    expect(payload.request?.model).toBe(GEMINI_TTS_MODEL);
    expect(payload.request?.input[0]?.content[0]?.text).toBe(
      "One monolith voiceover paragraph."
    );
  });
});

describe("runNarrateAssemble timing report", () => {
  beforeEach(() => {
    reported.payloads.length = 0;
    reported.warnings.length = 0;
  });

  it("reports overlap shifts in a synthetic dry-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-assemble-"));
    const outputDir = join(dir, "output");
    const narrationDir = join(dir, "narration");
    await mkdir(outputDir, { recursive: true });
    await mkdir(narrationDir, { recursive: true });
    const shotsPath = join(dir, "shots.json");
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { title: "Synthetic" },
        shots: [{ duration: 4, id: "s01", prompt: "p" }],
      })
    );
    await writeFile(
      join(narrationDir, "placement.tsv"),
      "1\ts01\t0\n2\ts01\t0\n"
    );
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=4",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-shortest",
      join(outputDir, "s01.mp4"),
    ]);
    for (const lineNumber of [1, 2]) {
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        "0.5",
        join(narrationDir, `line-0${lineNumber}.mp3`),
      ]);
    }

    await runNarrateAssemble(shotsPath, {
      draft: false,
      dryRun: true,
      fadeLead: 1.5,
      placement: "narration/placement.tsv",
      xfade: 0,
    });

    const payload = reported.payloads.at(-1) as {
      placed: {
        line: number;
        requestedStart: number;
        shiftSeconds: number;
        start: number;
      }[];
    };
    expect(payload.placed[0]).toMatchObject({
      line: 1,
      requestedStart: 0,
      shiftSeconds: 0,
      start: 0,
    });
    expect(payload.placed[1]?.shiftSeconds).toBeGreaterThan(0.7);
    expect(payload.placed[1]?.requestedStart).toBe(0);
    expect(payload.placed[1]?.start).toBe(payload.placed[1]?.shiftSeconds);
    expect(reported.warnings).toContainEqual(
      expect.stringContaining("curated external audio")
    );
  });

  it("accepts audited schema 1 sidecars without generation-context matching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-schema1-"));
    const outputDir = join(dir, "output");
    const narrationDir = join(dir, "narration");
    await mkdir(outputDir, { recursive: true });
    await mkdir(narrationDir, { recursive: true });
    const shotsPath = join(dir, "shots.json");
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { title: "Synthetic" },
        shots: [{ duration: 4, id: "s01", prompt: "p" }],
      })
    );
    await writeFile(join(narrationDir, "lines.tsv"), "1\tAudited words\n");
    await writeFile(join(narrationDir, "placement.tsv"), "1\ts01\t0\n");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=4",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-shortest",
      join(outputDir, "s01.mp4"),
    ]);
    const audio = join(narrationDir, "line-01.mp3");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "0.5",
      audio,
    ]);
    const audioSha256 = createHash("sha256")
      .update(await readFile(audio))
      .digest("hex");
    await writeFile(
      `${audio}.json`,
      JSON.stringify({
        audioSha256,
        modelId: "eleven_multilingual_v2",
        schemaVersion: 1,
        text: "Audited words",
        voiceId: "IKne3meq5aSn9XLyUdCD",
      })
    );

    await expect(
      runNarrateAssemble(shotsPath, {
        draft: false,
        dryRun: true,
        fadeLead: 1.5,
        placement: "narration/placement.tsv",
        xfade: 0,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects placement line numbers absent from the colocated script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-placement-"));
    const narrationDir = join(dir, "narration");
    await mkdir(narrationDir, { recursive: true });
    const shotsPath = join(dir, "shots.json");
    await writeFile(
      shotsPath,
      JSON.stringify({
        film: { title: "Synthetic" },
        shots: [{ duration: 4, id: "s01", prompt: "p" }],
      })
    );
    await writeFile(join(narrationDir, "lines.tsv"), "1\tCurrent words\n");
    await writeFile(join(narrationDir, "placement.tsv"), "2\ts01\t0\n");

    await expect(
      runNarrateAssemble(shotsPath, {
        draft: false,
        dryRun: true,
        fadeLead: 1.5,
        placement: "narration/placement.tsv",
        xfade: 0,
      })
    ).rejects.toThrow("missing from");
  });
});

describe("narration reuse provenance", () => {
  const options = {
    dryRun: false,
    force: false,
    model: GEMINI_TTS_MODEL,
    voice: "Kore",
  };

  it("rejects legacy numbering before submitting a new missing line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-stale-"));
    const script = join(dir, "lines.tsv");
    await writeFile(script, "1\tNew first line\n2\tRenumbered old line\n");
    await writeFile(join(dir, "line-02.mp3"), "older speech");
    const textToSpeech = vi.fn();
    await expect(
      runNarrate(script, options, {
        client: {
          textToSpeech,
        } as unknown as GeminiTtsClient,
      })
    ).rejects.toThrow("unverified existing narration");
    expect(textToSpeech).not.toHaveBeenCalled();
  });

  it("reuses verified audio but rejects a changed script or voice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-identity-"));
    const script = join(dir, "lines.tsv");
    await writeFile(script, "1\tOriginal words\n");
    const textToSpeech = vi.fn().mockResolvedValue(Buffer.from("speech bytes"));
    const client = {
      textToSpeech,
    } as unknown as GeminiTtsClient;
    await runNarrate(script, options, { client });
    await runNarrate(script, options, { client });
    expect(textToSpeech).toHaveBeenCalledTimes(1);
    await expect(
      runNarrate(script, { ...options, voice: "other" }, { client })
    ).rejects.toThrow("stale narration");
    await writeFile(script, "1\tRevised words\n");
    await expect(runNarrate(script, options, { client })).rejects.toThrow(
      "stale narration"
    );
    expect(textToSpeech).toHaveBeenCalledTimes(1);
  });

  it("treats a changed delivery style as stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-style-"));
    const script = join(dir, "lines.tsv");
    await writeFile(script, "1\tFirst words\n");
    const textToSpeech = vi.fn().mockResolvedValue(Buffer.from("speech bytes"));
    const client = { textToSpeech } as unknown as GeminiTtsClient;
    await runNarrate(script, options, { client });
    await expect(
      runNarrate(script, { ...options, style: "hushed, tense" }, { client })
    ).rejects.toThrow("stale narration");
    expect(textToSpeech).toHaveBeenCalledTimes(1);
  });

  it("rejects changed audio bytes before submitting any missing line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-hash-"));
    const script = join(dir, "lines.tsv");
    await writeFile(script, "2\tExisting words\n");
    const textToSpeech = vi.fn().mockResolvedValue(Buffer.from("speech bytes"));
    const client = { textToSpeech } as unknown as GeminiTtsClient;
    await runNarrate(script, options, { client });
    await writeFile(join(dir, "line-02.mp3"), "tampered bytes");
    await writeFile(script, "1\tMissing words\n2\tExisting words\n");

    await expect(runNarrate(script, options, { client })).rejects.toThrow(
      "stale narration"
    );
    expect(textToSpeech).toHaveBeenCalledTimes(1);
  });

  it("records schema 3 with a full effective-request hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-narr-schema-"));
    const script = join(dir, "lines.tsv");
    await writeFile(script, "1\tOriginal words\n");
    const client = {
      textToSpeech: vi.fn().mockResolvedValue(Buffer.from("speech bytes")),
    } as unknown as GeminiTtsClient;
    await runNarrate(script, options, { client });
    const sidecar = JSON.parse(
      await readFile(join(dir, "line-01.mp3.json"), "utf-8")
    ) as Record<string, unknown>;
    expect(sidecar.schemaVersion).toBe(3);
    expect(sidecar.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
