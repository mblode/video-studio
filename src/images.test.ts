import { describe, expect, it } from "vitest";

import {
  assertImageModelSupported,
  GEMINI_PRO_IMAGE_MODEL,
  imageSizeFor,
} from "./images.js";

describe("assertImageModelSupported", () => {
  it("accepts the models this CLI can route", () => {
    expect(() =>
      assertImageModelSupported(GEMINI_PRO_IMAGE_MODEL)
    ).not.toThrow();
    expect(() =>
      assertImageModelSupported("models/gemini-3-pro-image")
    ).not.toThrow();
    expect(() =>
      assertImageModelSupported("gpt-image-2.5-sunburst")
    ).not.toThrow();
  });

  it("refuses an id from a backend that is no longer wired up", () => {
    // The Seedream client went with the hand-rolled Ark image path. Without
    // this the id is handed to the Gemini endpoint and rejected there, after
    // prompting for a key and spending a round trip — and `--dry-run` never
    // reaches `resolveImageModel`, so nothing else catches it.
    expect(() => assertImageModelSupported("seedream-5-0-260128")).toThrow(
      /not one this CLI can run/u
    );
    expect(() =>
      assertImageModelSupported("fal-ai/bytedance/seedream/v4")
    ).toThrow(/not one this CLI can run/u);
  });
});

describe("imageSizeFor", () => {
  it("maps a ratio to the nearest GPT Image size", () => {
    expect(imageSizeFor("16:9")).toBe("1536x1024");
    expect(imageSizeFor("9:16")).toBe("1024x1536");
    expect(imageSizeFor("1:1")).toBe("1024x1024");
    expect(imageSizeFor()).toBe("1024x1024");
  });
});
