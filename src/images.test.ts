import { describe, expect, it } from "vitest";

import { assertImageModelSupported, GEMINI_PRO_IMAGE_MODEL } from "./images.js";

describe("assertImageModelSupported", () => {
  it("accepts the models this CLI can route", () => {
    expect(() =>
      assertImageModelSupported(GEMINI_PRO_IMAGE_MODEL)
    ).not.toThrow();
    expect(() =>
      assertImageModelSupported("models/gemini-3-pro-image")
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
