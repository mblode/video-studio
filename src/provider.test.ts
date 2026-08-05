import { describe, expect, it } from "vitest";

import { ArkClient } from "./ark.js";
import { DEFAULT_VIDEO_MODEL } from "./models.js";
import { createModelLimiter, MockVideoProvider } from "./provider.js";
import type { VideoProvider } from "./provider.js";
import type { VideoModelV1CallOptions } from "./spec/video-model.js";

const STANDARD = "dreamina-seedance-2-0-260128";

/** A minimal neutral request. The mock translates it with the real Ark rules. */
function request(): VideoModelV1CallOptions {
  return {
    aspectRatio: "16:9",
    durationSeconds: 5,
    generateAudio: false,
    prompt: "a shot",
    references: [],
    watermark: false,
  };
}

describe("VideoProvider port", () => {
  it("is satisfied by ArkClient without an adapter", () => {
    // The legacy port, kept for the doctor probe: the raw client still fits it,
    // so a task-status check needs no model and no film.
    const client: VideoProvider = new ArkClient({
      apiKey: "k",
      baseUrl: "https://ark.test/api/v3",
    });
    expect(client).toBeInstanceOf(ArkClient);
  });
});

describe("MockVideoProvider", () => {
  it("runs a task through running to succeeded with a usage figure", async () => {
    const provider = new MockVideoProvider({ pollsUntilDone: 2 });
    const created = await provider.createTask(request());
    expect(created).toMatchObject({ id: "task-1", status: "queued" });

    const seen: string[] = [];
    const final = await provider.pollTask(created.id, {
      intervalMs: 0,
      onUpdate: (task) => {
        seen.push(task.status);
      },
      timeoutMs: 0,
    });
    expect(seen).toEqual(["running", "running", "succeeded"]);
    expect(final.content?.video_url).toContain("task-1");
    expect(final.usage?.completion_tokens).toBe(108_000);
  });

  it("fails the task ids it was told to, with an error and no video", async () => {
    const provider = new MockVideoProvider({
      failTasks: ["task-2"],
      pollsUntilDone: 0,
    });
    await provider.createTask(request());
    const second = await provider.createTask(request());
    const final = await provider.pollTask(second.id, {
      intervalMs: 0,
      timeoutMs: 0,
    });
    expect(final.status).toBe("failed");
    expect(final.error?.message).toContain("task-2");
    expect(final.content?.video_url).toBeUndefined();
  });

  it("records every submitted payload for assertions", async () => {
    const provider = new MockVideoProvider();
    await provider.createTask(request());
    expect(provider.requests).toHaveLength(1);
    // The mock claims the CLI's default model, so this also pins what an
    // unconfigured film generates on.
    expect(provider.requests[0]?.model).toBe(DEFAULT_VIDEO_MODEL);
  });
});

describe("createModelLimiter", () => {
  it("caps 4K at the model's single concurrent slot", () => {
    const limiter = createModelLimiter(3);
    expect(limiter.concurrencyFor(STANDARD, "720p")).toBe(3);
    // Submitting 3 at once would not error, it would silently queue.
    expect(limiter.concurrencyFor(STANDARD, "4k")).toBe(1);
  });

  it("never exceeds what the operator asked for", () => {
    const limiter = createModelLimiter(1);
    expect(limiter.concurrencyFor(STANDARD, "720p")).toBe(1);
  });

  it("never drops below 1, whatever the operator passes", () => {
    expect(createModelLimiter(0).concurrencyFor(STANDARD, "720p")).toBe(1);
  });

  it("gives an unknown model the permissive default", () => {
    expect(createModelLimiter(3).concurrencyFor("who-knows", "4k")).toBe(3);
  });

  it("actually serialises 4K work while running 720p in parallel", async () => {
    const limiter = createModelLimiter(3);
    let running = 0;
    let peak4k = 0;
    let peak720 = 0;

    async function work(resolution: "4k" | "720p"): Promise<void> {
      await limiter.run(STANDARD, resolution, async () => {
        running += 1;
        if (resolution === "4k") {
          peak4k = Math.max(peak4k, running);
        } else {
          peak720 = Math.max(peak720, running);
        }
        await Promise.resolve();
        running -= 1;
      });
    }

    await Promise.all([work("4k"), work("4k"), work("4k")]);
    expect(peak4k).toBe(1);

    running = 0;
    await Promise.all([work("720p"), work("720p"), work("720p")]);
    expect(peak720).toBeGreaterThan(1);
  });
});
