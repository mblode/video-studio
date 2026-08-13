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
  const original = {
    ark: process.env.ARK_API_KEY,
    gateway: process.env.AI_GATEWAY_API_KEY,
    oidc: process.env.VERCEL_OIDC_TOKEN,
  };
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    if (original.ark === undefined) {
      delete process.env.ARK_API_KEY;
    } else {
      process.env.ARK_API_KEY = original.ark;
    }
    if (original.gateway === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = original.gateway;
    }
    if (original.oidc === undefined) {
      delete process.env.VERCEL_OIDC_TOKEN;
    } else {
      process.env.VERCEL_OIDC_TOKEN = original.oidc;
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

  it("fails when neither a Gateway key nor ARK_API_KEY is set", async () => {
    delete process.env.ARK_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    await runDoctor(undefined, { ffmpeg: false });
    expect(process.exitCode).toBe(1);
  });

  it("passes with only AI_GATEWAY_API_KEY", async () => {
    delete process.env.ARK_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.AI_GATEWAY_API_KEY = "gw";
    await runDoctor(undefined, { ffmpeg: false });
    expect(process.exitCode).toBeUndefined();
  });
});
