import { describe, expect, it } from "vitest";

import { ArkApiError } from "./ark.js";
import { formatError, isVsError, VsError } from "./errors.js";

describe("VsError", () => {
  it("carries a code and a hint", () => {
    const error = new VsError("unknown_id", 'no shot with id "x"', {
      hint: "valid ids: a, b",
    });
    expect(isVsError(error)).toBe(true);
    expect(error.code).toBe("unknown_id");
    expect(formatError(error)).toMatchObject({
      code: "unknown_id",
      hint: "valid ids: a, b",
    });
  });

  it("keeps a plain Error distinguishable from a user mistake", () => {
    expect(isVsError(new Error("boom"))).toBe(false);
    expect(formatError(new Error("boom")).code).toBeUndefined();
  });
});

describe("formatError", () => {
  it("hides the cause chain unless verbose", () => {
    const error = new VsError("ffmpeg_failed", "ffmpeg failed: bad filter", {
      cause: new Error("Command failed"),
    });
    expect(formatError(error).details).toEqual([]);
    expect(formatError(error, true).details[0]).toContain("Command failed");
  });

  it("includes a cause's captured stderr in verbose details", () => {
    const cause = Object.assign(new Error("Command failed"), {
      stderr: "Unknown encoder 'nope'",
    });
    const { details } = formatError(
      new VsError("ffmpeg_failed", "ffmpeg failed", { cause }),
      true
    );
    expect(details[0]).toContain("Unknown encoder 'nope'");
  });

  it("maps an auth failure to the key to check", () => {
    expect(formatError(new ArkApiError("Ark", 401, "{}")).hint).toContain(
      "ARK_API_KEY"
    );
  });

  it("maps a 429 to the account's rate limits", () => {
    const hint = formatError(new ArkApiError("Ark", 429, "{}")).hint ?? "";
    expect(hint).toContain("180 requests/min");
    expect(hint).toContain("--concurrency");
  });

  it("leaves an ordinary 400 without a fabricated hint", () => {
    expect(
      formatError(new ArkApiError("Ark", 400, "bad prompt")).hint
    ).toBeUndefined();
  });

  it("stringifies a non-Error throw", () => {
    expect(formatError("plain string").message).toBe("plain string");
  });
});
