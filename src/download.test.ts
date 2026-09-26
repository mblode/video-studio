import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadFile, writeVideoFile } from "./download.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadFile", () => {
  it("removes the .part file when the stream fails mid-download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-dl-"));
    const out = join(dir, "clip.mp4");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("stream broke"));
      },
    });
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(body, { status: 200 }))
    );

    await expect(downloadFile("https://x/clip.mp4", out)).rejects.toThrow();
    expect(existsSync(`${out}.part`)).toBe(false);
    expect(existsSync(out)).toBe(false);
  });
});

describe("writeVideoFile", () => {
  it("writes bytes via a .part file then renames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-write-"));
    const out = join(dir, "clip.mp4");
    await writeVideoFile(new Uint8Array([1, 2, 3, 4]), out);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(`${out}.part`)).toBe(false);
  });
});

describe("bounded download recovery", () => {
  it("aborts a stalled body, clears partial output, and recommends recovery without a retake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-dl-timeout-"));
    const out = join(dir, "clip.mp4");
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        expect(options.signal).toBe(controller.signal);
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new Uint8Array([1, 2, 3]));
          },
        });
        setTimeout(() => controller.abort(), 10);
        return Promise.resolve(new Response(body));
      })
    );
    try {
      await expect(
        downloadFile("https://example.test/video", out)
      ).rejects.toMatchObject({
        code: "download_failed",
        hint: expect.stringContaining("--refresh"),
      });
      expect(timeout).toHaveBeenCalledWith(600_000);
      expect(existsSync(`${out}.part`)).toBe(false);
      expect(existsSync(out)).toBe(false);
    } finally {
      timeout.mockRestore();
    }
  });
});
