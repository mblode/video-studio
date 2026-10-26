import { describe, expect, it, vi } from "vitest";

import { requestWithRetry } from "./http.js";

function fail(status: number, body: string, headers?: Record<string, string>) {
  return new Response(body, { headers, status });
}

function request(fetchImpl: ReturnType<typeof vi.fn>, method: "GET" | "POST") {
  return requestWithRetry({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    headers: {},
    method,
    provider: "Gemini",
    url: "https://gemini.test/v1/tts",
    what: "synthesize",
  });
}

/**
 * Gemini TTS at its daily quota answers 429 with `retry-after: 26782`. Sleeping
 * through that is 7.4 silent hours, so a long wait must fail fast instead.
 */
describe("requestWithRetry Retry-After cap", () => {
  it("throws quota_exhausted on a 429 whose Retry-After is past the cap", async () => {
    const f = vi.fn().mockResolvedValue(
      fail(429, "Rate limit exceeded. Please retry in 7h26m22s", {
        "retry-after": "26782",
      })
    );
    await expect(request(f, "POST")).rejects.toMatchObject({
      code: "quota_exhausted",
      hint: expect.stringContaining("resets in about 7h26m"),
      message: expect.stringMatching(/Gemini API 429: Rate limit exceeded/u),
      name: "VsError",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("still sleeps through a short Retry-After and replays the 429", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(fail(429, "slow down", { "retry-after": "0.01" }));
    f.mockResolvedValueOnce(Response.json({ ok: true }));
    const response = await request(f, "POST");
    expect(response.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not treat a long Retry-After on a POST 5xx as a quota", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(fail(503, "down", { "retry-after": "3600" }));
    await expect(request(f, "POST")).rejects.toMatchObject({
      code: "task_uncertain",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
