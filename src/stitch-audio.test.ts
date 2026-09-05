import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildStitchPlan } from "./stitch.js";
import type { StitchOptions } from "./stitch.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function ffmpeg(args: string[]): void {
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-filter_complex_threads",
      "1",
      ...args,
    ],
    { stdio: "pipe", timeout: 30_000 }
  );
}

async function fixture(): Promise<{
  clip: string;
  narration: string;
  music: string;
  output: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "vs-audio-"));
  directories.push(dir);
  const clip = join(dir, "clip.mp4");
  const narration = join(dir, "narration.wav");
  const music = join(dir, "music.wav");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:r=24:d=4",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    clip,
  ]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", narration]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=4", music]);
  return { clip, music, narration, output: join(dir, "out.mp4") };
}

function render(
  files: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<StitchOptions>
): void {
  const plan = buildStitchPlan(
    [{ duration: 4, hasAudio: false, path: files.clip }],
    {
      cardPaths: new Map(),
      concatListPath: "unused",
      font: "unused",
      musicGainDb: -12,
      outputPath: files.output,
      xfade: 0,
      ...overrides,
    }
  );
  for (const step of plan.steps) {
    ffmpeg(step.args);
  }
}

function audioRms(path: string, start: number, duration: number): number {
  const pcm = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(start),
      "-i",
      path,
      "-t",
      String(duration),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { timeout: 30_000 }
  );
  let energy = 0;
  for (let offset = 0; offset + 4 <= pcm.length; offset += 4) {
    energy += pcm.readFloatLE(offset) ** 2;
  }
  return Math.sqrt(energy / (pcm.length / 4));
}

describe("rendered soundtrack", () => {
  it("renders narration without a music sidechain", async () => {
    const files = await fixture();
    render(files, { narrationPath: files.narration });
    expect(audioRms(files.output, 0, 0.4)).toBeGreaterThan(0.001);
  });

  it("keeps the score audible after a short narration track ends", async () => {
    const files = await fixture();
    render(files, { musicPath: files.music, narrationPath: files.narration });
    expect(audioRms(files.output, 1.5, 0.25)).toBeGreaterThan(0.001);
  });

  it("mixes a separate effects stem into silent clips without a score", async () => {
    const files = await fixture();
    render(files, { effectsPath: files.music });
    expect(audioRms(files.output, 1.5, 0.25)).toBeGreaterThan(0.001);
  });

  it("renders all four layers with an independent effects gain", async () => {
    const files = await fixture();
    render(files, {
      effectsGainDb: -6,
      effectsPath: files.music,
      musicPath: files.music,
      narrationPath: files.narration,
    });
    expect(audioRms(files.output, 0, 0.4)).toBeGreaterThan(0.001);
    expect(audioRms(files.output, 1.5, 0.25)).toBeGreaterThan(0.001);
  });
});
