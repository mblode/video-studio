import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadFile } from "./download.js";

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
