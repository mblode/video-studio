import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArkClient } from "../ark.js";
import type * as EnvModule from "../env.js";
import { runDoctor, validateTaskShape } from "./doctor.js";

// Keep loadEnv from importing the repo's real .env (which has a key).
vi.mock("../env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, loadEnv: vi.fn() };
});

function clientReturning(task: unknown): ArkClient {
  return {
    getTask: vi.fn(() => Promise.resolve(task)),
  } as unknown as ArkClient;
}

const VALID_TASK = {
  content: { video_url: "https://x/v.mp4" },
  id: "t1",
  status: "succeeded",
};

describe("validateTaskShape", () => {
  it("accepts a well-formed task", () => {
    expect(validateTaskShape(VALID_TASK)).toEqual([]);
    expect(validateTaskShape({ id: "t", status: "queued" })).toEqual([]);
  });

  it("flags a missing id", () => {
    expect(validateTaskShape({ status: "queued" })).toContainEqual(
      expect.stringContaining("id")
    );
  });

  it("flags an unknown status", () => {
    expect(validateTaskShape({ id: "t", status: "weird" })).toContainEqual(
      expect.stringContaining("status")
    );
  });

  it("flags a non-string video_url", () => {
    expect(
      validateTaskShape({
        content: { video_url: 5 },
        id: "t",
        status: "queued",
      })
    ).toContainEqual(expect.stringContaining("video_url"));
  });

  it("rejects a non-object", () => {
    expect(validateTaskShape(null).length).toBeGreaterThan(0);
    expect(validateTaskShape("nope").length).toBeGreaterThan(0);
  });
});

describe("runDoctor", () => {
  const original = process.env.ARK_API_KEY;
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    if (original === undefined) {
      process.env.ARK_API_KEY = undefined;
      delete process.env.ARK_API_KEY;
    } else {
      process.env.ARK_API_KEY = original;
    }
    process.exitCode = undefined;
  });

  it("passes with a key and a well-formed endpoint response", async () => {
    process.env.ARK_API_KEY = "k";
    await runDoctor(
      "t1",
      { ffmpeg: false },
      { client: clientReturning(VALID_TASK) }
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when the endpoint response is malformed", async () => {
    process.env.ARK_API_KEY = "k";
    await runDoctor(
      "t1",
      { ffmpeg: false },
      { client: clientReturning({ id: "t1", status: "bogus" }) }
    );
    expect(process.exitCode).toBe(1);
  });

  it("fails when ARK_API_KEY is missing", async () => {
    process.env.ARK_API_KEY = undefined;
    delete process.env.ARK_API_KEY;
    await runDoctor(undefined, { ffmpeg: false });
    expect(process.exitCode).toBe(1);
  });
});
