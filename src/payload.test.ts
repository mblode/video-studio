import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCallOptions,
  effectiveShotParams,
  hashPayload,
  referenceCountsByType,
  referenceOrdinals,
  renderPayload,
} from "./payload.js";
import { createArk } from "./providers/ark.js";
import { DEFAULT_RESOLUTION } from "./types.js";
import type {
  CreateTaskRequest,
  Shot,
  ShotReference,
  ShotsFile,
} from "./types.js";

/**
 * The composition every command performs: resolve a shot into neutral call
 * options, then let the model that will actually submit it produce the wire
 * body. These assertions are on the BYTES, which is the point — the Ark body
 * must be byte-identical to what this CLI sent before the provider spec
 * existed, because `payloadHash` in every existing film's manifest was
 * computed over it.
 */
const ark = createArk({
  apiKey: "test-key",
  baseUrl: "https://example.invalid",
});

async function buildTaskPayload(
  shot: Shot,
  filmConfig: ShotsFile["film"],
  shotsDir: string,
  options?: Parameters<typeof buildCallOptions>[3]
): Promise<CreateTaskRequest> {
  const { model } = effectiveShotParams(shot, filmConfig, options?.overrides);
  return ark
    .videoModel(model)
    .toRequestBody(
      await buildCallOptions(shot, filmConfig, shotsDir, options)
    ) as CreateTaskRequest;
}

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

/**
 * The planner is the ONLY copy of the ladder, and `vs generate` prices what it
 * returns. If a wire field ever stops matching the planner, the estimate is
 * quoting a different run than the one being submitted — so pin the two
 * together at every rung: nothing set, film default, shot, run override.
 */
describe("effectiveShotParams", () => {
  const unset: ShotsFile["film"] = { title: "Unset" };
  const rungs: { name: string; film: ShotsFile["film"]; shot: Shot }[] = [
    { film: unset, name: "nothing set", shot: { id: "a", prompt: "p" } },
    { film, name: "film defaults", shot: { id: "a", prompt: "p" } },
    {
      film,
      name: "shot values",
      shot: {
        duration: 12,
        id: "a",
        prompt: "p",
        ratio: "9:16",
        resolution: "720p",
      },
    },
  ];

  it.each(rungs)("sends exactly what it plans ($name)", async (rung) => {
    for (const overrides of [
      undefined,
      { generateAudio: false, model: "dreamina-seedance-2-5-260628" },
      { resolution: "480p" as const },
    ]) {
      const params = effectiveShotParams(rung.shot, rung.film, overrides);
      const payload = await buildTaskPayload(rung.shot, rung.film, "/tmp", {
        overrides,
      });
      expect(payload.duration).toBe(params.duration);
      expect(payload.ratio).toBe(params.ratio);
      expect(payload.model).toBe(params.model);
      expect(payload.generate_audio).toBe(params.generateAudio);
      expect(payload.watermark).toBe(params.watermark);
      // The one deliberate asymmetry: the payload omits `resolution` unless
      // something set one, while `params.resolution` always names the frame the
      // clip renders (and bills) at.
      expect(payload.resolution).toBe(
        params.emitResolution ? params.resolution : undefined
      );
    }
  });

  it("prices the API's default when nothing sets a resolution", () => {
    const params = effectiveShotParams({ id: "a", prompt: "p" }, film);
    expect(params.emitResolution).toBe(false);
    expect(params.resolution).toBe(DEFAULT_RESOLUTION);
  });
});

const refImage = (n: number): ShotReference => ({
  role: "reference_image",
  type: "image",
  url: `https://example.com/${n}.png`,
});

describe("the ordinal contract", () => {
  it("counts ordinals per media type, not per array index", () => {
    // `@Image 1` is the SECOND array entry here. This is the trap.
    const refs: ShotReference[] = [
      { role: "reference_video", type: "video", url: "https://e.com/v.mp4" },
      refImage(1),
      refImage(2),
    ];
    // Video ordinal 1, then Image ordinals 1 and 2.
    expect(referenceOrdinals(refs)).toEqual([1, 1, 2]);
  });

  it("lets a frame role consume an image ordinal", () => {
    const refs: ShotReference[] = [
      { role: "first_frame", type: "image", url: "./stills/key.png" },
      refImage(1),
    ];
    // The keyframe itself occupies Image ordinal 1.
    expect(referenceOrdinals(refs)).toEqual([1, 2]);
    expect(referenceCountsByType(refs)).toEqual({
      audio: 0,
      image: 2,
      video: 0,
    });
  });

  it("submits references in authored order, so ordinals match the wire", async () => {
    const refs: ShotReference[] = [
      { role: "reference_video", type: "video", url: "https://e.com/v.mp4" },
      refImage(1),
      refImage(2),
    ];
    const payload = await buildTaskPayload(
      { id: "s", prompt: "use @Image 1 for her face", references: refs },
      film,
      "/tmp"
    );

    // Text first, then references in the exact order the author wrote them.
    expect(payload.content.map((c) => c.type)).toEqual([
      "text",
      "video_url",
      "image_url",
      "image_url",
    ]);
  });
});

const payloadWithInlineVideo = (bodyLength = 5000): CreateTaskRequest => ({
  content: [
    { text: "edit this", type: "text" },
    {
      role: "reference_video",
      type: "video_url",
      video_url: { url: `data:video/mp4;base64,${"A".repeat(bodyLength)}` },
    },
  ],
  duration: 30,
  generate_audio: true,
  model: "dreamina-seedance-2-5-260628",
  ratio: "16:9",
  watermark: false,
});

describe("data URLs never reach the hash or the terminal", () => {
  it("truncates an inlined video instead of dumping megabytes into --dry-run", () => {
    const rendered = renderPayload(payloadWithInlineVideo());
    expect(rendered).toContain("(truncated)");
    expect(rendered).not.toContain("A".repeat(200));
  });

  it("hashes an inlined video by digest rather than by its whole body", () => {
    const small = payloadWithInlineVideo(64);
    const large = payloadWithInlineVideo(5000);
    // Same digest length whatever the body size: the hash is over a sha256 of
    // the data URL, not the megabytes themselves.
    expect(hashPayload(small)).toHaveLength(64);
    expect(hashPayload(large)).toHaveLength(64);
    expect(hashPayload(small)).not.toBe(hashPayload(large));
  });

  it("does not move an existing film's payloadHash", () => {
    // payloadHash is persisted in every manifest, so if this literal changes,
    // every already-generated film reads as if its payload had been edited.
    // Adding the video/audio branches to mapDataUrls must not disturb it.
    const imageOnly: CreateTaskRequest = {
      content: [
        { text: "a quiet street", type: "text" },
        {
          image_url: { url: "data:image/png;base64,AAAA" },
          role: "first_frame",
          type: "image_url",
        },
      ],
      duration: 8,
      generate_audio: true,
      model: "dreamina-seedance-2-0-260128",
      ratio: "16:9",
      watermark: false,
    };
    expect(hashPayload(imageOnly)).toBe(
      "24b3df2fff5ef0a0f4be39832bbc2c7b8e22cfdb2e42d068776a8c130b3b8c1e"
    );
  });
});

describe("referenceOrdinals is positional", () => {
  it("gives an aliased array two distinct ordinals", () => {
    // A Map keyed by the reference object collapses [r, r] to one entry and
    // reports ordinal 2 for the first reference. Position cannot.
    const r: ShotReference = {
      role: "reference_image",
      type: "image",
      url: "./a.png",
    };
    expect(referenceOrdinals([r, r])).toEqual([1, 2]);
  });
});

describe("payloadHash is an audit record, not a cache key", () => {
  // A manifest records paid generations. Every existing film's `payloadHash`
  // was computed over the Ark body this CLI produced BEFORE the provider spec
  // existed, so routing that body through `buildCallOptions` +
  // `ArkVideoModel.toRequestBody` has to reproduce it byte for byte. If this
  // test ever fails, the fix is the code, not the constant.
  it("still hashes the exact bytes it always has", async () => {
    const shot: Shot = {
      duration: 8,
      id: "s01",
      prompt: "a lighthouse in a storm",
      seed: 42,
    };
    const payload = await buildTaskPayload(shot, film, "/tmp");
    expect(payload).toEqual({
      content: [{ text: "a lighthouse in a storm", type: "text" }],
      duration: 8,
      generate_audio: true,
      model: "dreamina-seedance-2-0-260128",
      ratio: "16:9",
      seed: 42,
      watermark: false,
    });
    // Derived from the PRE-SPEC algorithm, not copied from current output:
    //   sha256(JSON.stringify({...body, content: body.content}))
    // over the body above. That is what shipped, so that is the target.
    expect(hashPayload(payload)).toBe(
      "937b8a7e85a2d725a06652e15d5775938667ee87cca29f343df2c2ee7b930380"
    );
  });
});
