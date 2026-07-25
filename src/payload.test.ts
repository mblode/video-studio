import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildTaskPayload, hashPayload, renderPayload } from "./payload.js";
import type { Shot, ShotsFile } from "./types.js";

const film: ShotsFile["film"] = {
  defaults: {
    duration: 8,
    generateAudio: true,
    ratio: "16:9",
    watermark: false,
  },
  model: "dreamina-seedance-2-0-260128",
  title: "Test Film",
};

describe("buildTaskPayload", () => {
  it("reproduces the documented wire shape for all three reference types", async () => {
    const shot: Shot = {
      duration: 11,
      id: "tea-ad",
      prompt: "First-person POV fruit tea promotional ad",
      ratio: "16:9",
      references: [
        {
          role: "reference_image",
          type: "image",
          url: "https://example.com/pic1.jpg",
        },
        {
          role: "reference_video",
          type: "video",
          url: "https://example.com/video1.mp4",
        },
        {
          role: "reference_audio",
          type: "audio",
          url: "https://example.com/audio1.mp3",
        },
      ],
    };

    const payload = await buildTaskPayload(shot, film, "/tmp");

    expect(payload).toEqual({
      content: [
        { text: "First-person POV fruit tea promotional ad", type: "text" },
        {
          image_url: { url: "https://example.com/pic1.jpg" },
          role: "reference_image",
          type: "image_url",
        },
        {
          role: "reference_video",
          type: "video_url",
          video_url: { url: "https://example.com/video1.mp4" },
        },
        {
          audio_url: { url: "https://example.com/audio1.mp3" },
          role: "reference_audio",
          type: "audio_url",
        },
      ],
      duration: 11,
      generate_audio: true,
      model: "dreamina-seedance-2-0-260128",
      ratio: "16:9",
      watermark: false,
    });
  });

  it("applies film defaults when shot omits duration and ratio", async () => {
    const payload = await buildTaskPayload(
      { id: "a", prompt: "p" },
      film,
      "/tmp"
    );
    expect(payload.duration).toBe(8);
    expect(payload.ratio).toBe("16:9");
    expect(payload).not.toHaveProperty("seed");
  });

  it("inlines local image references as base64 data URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-test-"));
    await writeFile(join(dir, "still.png"), Buffer.from([1, 2, 3]));
    const payload = await buildTaskPayload(
      {
        id: "a",
        prompt: "p",
        references: [
          { role: "reference_image", type: "image", url: "./still.png" },
        ],
      },
      film,
      dir
    );
    const [, image] = payload.content;
    if (image?.type !== "image_url") {
      throw new Error("expected image_url content");
    }
    expect(image.image_url.url).toBe("data:image/png;base64,AQID");
  });

  it("truncates data URLs in dry-run rendering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-test-"));
    await writeFile(join(dir, "big.png"), Buffer.alloc(10_000, 7));
    const payload = await buildTaskPayload(
      {
        id: "a",
        prompt: "p",
        references: [
          { role: "reference_image", type: "image", url: "./big.png" },
        ],
      },
      film,
      dir
    );
    const rendered = renderPayload(payload);
    expect(rendered).toContain("(truncated)");
    expect(rendered.length).toBeLessThan(2000);
  });

  it("passes first_frame role through to the wire payload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-test-"));
    await writeFile(join(dir, "frame.png"), Buffer.from([9, 9]));
    const payload = await buildTaskPayload(
      {
        id: "a",
        prompt: "p",
        references: [
          { role: "first_frame", type: "image", url: "./frame.png" },
        ],
      },
      film,
      dir
    );
    const [, image] = payload.content;
    if (image?.type !== "image_url") {
      throw new Error("expected image_url content");
    }
    expect(image.role).toBe("first_frame");
  });
});

describe("hashPayload", () => {
  it("is stable and independent of data-URL bodies of equal content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-test-"));
    await writeFile(join(dir, "s.png"), Buffer.from([1, 2, 3]));
    const shot: Shot = {
      id: "a",
      prompt: "p",
      references: [{ role: "reference_image", type: "image", url: "./s.png" }],
    };
    const one = hashPayload(await buildTaskPayload(shot, film, dir));
    const two = hashPayload(await buildTaskPayload(shot, film, dir));
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{64}$/u);
    const different = hashPayload(
      await buildTaskPayload({ ...shot, prompt: "q" }, film, dir)
    );
    expect(different).not.toBe(one);
  });
});

describe("buildTaskPayload — preamble, resolution, camera", () => {
  const plainShot: Shot = { id: "s", prompt: "Eric mends the stall." };

  it("prepends film.promptPreamble to the shot prompt", async () => {
    const payload = await buildTaskPayload(
      plainShot,
      { ...film, promptPreamble: "Pixar-style 3D, winter shtetl palette." },
      "/tmp"
    );
    const text = payload.content.find((c) => c.type === "text");
    expect(text && "text" in text ? text.text : "").toBe(
      "Pixar-style 3D, winter shtetl palette.\n\nEric mends the stall."
    );
  });

  it("omits resolution entirely when nothing sets it (preserves the doc body)", async () => {
    const payload = await buildTaskPayload(plainShot, film, "/tmp");
    expect(payload.resolution).toBeUndefined();
  });

  it("emits a draft override resolution + drops audio without mutating the shot", async () => {
    const payload = await buildTaskPayload(plainShot, film, "/tmp", {
      overrides: { generateAudio: false, resolution: "480p" },
    });
    expect(payload.resolution).toBe("480p");
    expect(payload.generate_audio).toBe(false);
    expect(plainShot.resolution).toBeUndefined();
  });

  it("only emits camera_fixed when the shot locks the camera", async () => {
    const plain = await buildTaskPayload(plainShot, film, "/tmp");
    expect(plain.camera_fixed).toBeUndefined();
    const locked = await buildTaskPayload(
      { ...plainShot, cameraFixed: true },
      film,
      "/tmp"
    );
    expect(locked.camera_fixed).toBe(true);
  });
});
