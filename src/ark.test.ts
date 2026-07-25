import { describe, expect, it, vi } from "vitest";

import { ArkApiError, ArkClient, ArkResponseError } from "./ark.js";

function ok(body: unknown): Response {
  return Response.json(body);
}

function fail(status: number, headers?: Record<string, string>): Response {
  return new Response("boom", { headers, status });
}

function makeClient(fetchImpl: ReturnType<typeof vi.fn>): ArkClient {
  return new ArkClient({
    apiKey: "k",
    baseUrl: "https://ark.test/api/v3",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe("ArkClient.request", () => {
  it("retries a 429 (honouring retry-after) then succeeds", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(fail(429, { "retry-after": "0.01" }));
    f.mockResolvedValueOnce(ok({ id: "t1", status: "queued" }));
    const client = makeClient(f);
    await expect(client.createTask({} as never)).resolves.toEqual({
      id: "t1",
      status: "queued",
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx then succeeds", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(fail(503));
    f.mockResolvedValueOnce(ok({ id: "t2", status: "running" }));
    const client = makeClient(f);
    await expect(client.createTask({} as never)).resolves.toEqual({
      id: "t2",
      status: "running",
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const f = vi.fn().mockResolvedValue(fail(400));
    const client = makeClient(f);
    await expect(client.createTask({} as never)).rejects.toBeInstanceOf(
      ArkApiError
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("ArkClient response validation", () => {
  it("parses the fields the CLI actually reads", async () => {
    const f = vi.fn().mockResolvedValue(
      ok({
        content: { last_frame_url: "https://f", video_url: "https://v" },
        id: "t",
        status: "succeeded",
        usage: { completion_tokens: 108_000, total_tokens: 108_000 },
      })
    );
    await expect(makeClient(f).getTask("t")).resolves.toMatchObject({
      content: { last_frame_url: "https://f", video_url: "https://v" },
      usage: { completion_tokens: 108_000 },
    });
  });

  it("passes unknown fields through instead of rejecting them", async () => {
    // Validating fields we ignore would turn a harmless provider addition
    // into an outage.
    const f = vi
      .fn()
      .mockResolvedValue(
        ok({ brand_new_field: 42, id: "t", status: "queued" })
      );
    await expect(makeClient(f).getTask("t")).resolves.toMatchObject({
      brand_new_field: 42,
    });
  });

  it("defaults the status of a freshly created task to queued", async () => {
    // The create response documents only `id`.
    const f = vi.fn().mockResolvedValue(ok({ id: "new-task" }));
    await expect(makeClient(f).createTask({} as never)).resolves.toEqual({
      id: "new-task",
      status: "queued",
    });
  });

  it("throws a named error when a required field is missing", async () => {
    const f = vi.fn().mockResolvedValue(ok({ status: "succeeded" }));
    await expect(makeClient(f).getTask("t")).rejects.toThrow(
      /getTask.*\bid\b/su
    );
    await expect(makeClient(f).getTask("t")).rejects.toBeInstanceOf(
      ArkResponseError
    );
  });

  it("throws on an unrecognised status rather than polling forever", async () => {
    const f = vi.fn().mockResolvedValue(ok({ id: "t", status: "levitating" }));
    await expect(makeClient(f).getTask("t")).rejects.toThrow(/status/u);
  });

  it("does not retry an unparseable body", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("<html>nope</html>", { status: 200 }));
    await expect(makeClient(f).getTask("t")).rejects.toBeInstanceOf(
      ArkResponseError
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats an explicit null as absent, not as a contract violation", async () => {
    // A queued task can legitimately report `content: { video_url: null }`.
    const f = vi
      .fn()
      .mockResolvedValue(
        ok({ content: { video_url: null }, id: "t", status: "running" })
      );
    const task = await makeClient(f).getTask("t");
    expect(task.content?.video_url).toBeUndefined();
  });

  it("tolerates a numeric error code", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        ok({ error: { code: 500, message: "boom" }, id: "t", status: "failed" })
      );
    await expect(makeClient(f).getTask("t")).resolves.toMatchObject({
      error: { code: "500" },
    });
  });

  it("validates the image response shape", async () => {
    const f = vi.fn().mockResolvedValue(ok({ data: "not-an-array" }));
    await expect(makeClient(f).createImage({} as never)).rejects.toBeInstanceOf(
      ArkResponseError
    );
  });
});

describe("ArkClient.pollTask", () => {
  it("returns once the task reaches a terminal status, updating each poll", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(ok({ id: "t", status: "running" }));
    f.mockResolvedValueOnce(ok({ id: "t", status: "succeeded" }));
    const seen: string[] = [];
    const final = await makeClient(f).pollTask("t", {
      intervalMs: 1,
      onUpdate: (task) => {
        seen.push(task.status);
      },
      timeoutMs: 10_000,
    });
    expect(final.status).toBe("succeeded");
    expect(seen).toEqual(["running", "succeeded"]);
  });

  it("stops on `expired`, which is terminal like a failure", async () => {
    const f = vi.fn(() => Promise.resolve(ok({ id: "t", status: "expired" })));
    await expect(
      makeClient(f).pollTask("t", { intervalMs: 1, timeoutMs: 10_000 })
    ).resolves.toMatchObject({ status: "expired" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("throws on timeout when the task never finishes", async () => {
    const f = vi.fn(() => Promise.resolve(ok({ id: "t", status: "running" })));
    await expect(
      makeClient(f).pollTask("t", { intervalMs: 1, timeoutMs: 5 })
    ).rejects.toThrow(/timed out/u);
  });

  it("reports the timeout in the unit --timeout is typed in, and how to recover", async () => {
    const f = vi.fn(() => Promise.resolve(ok({ id: "t", status: "running" })));
    // Jump the clock past the deadline rather than actually waiting 2 minutes:
    // the first read sets it, every later read is already past it.
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValue(999_999);
    const failure = (await makeClient(f)
      .pollTask("t", { intervalMs: 1, timeoutMs: 120_000 })
      .catch((error: unknown) => error)) as Error & {
      code?: string;
      hint?: string;
    };
    now.mockRestore();
    expect(failure.code).toBe("timeout");
    // minutes, not the 120000ms the operator never typed
    expect(failure.message).toContain("2 minute(s)");
    expect(failure.message).not.toContain("ms");
    expect(failure.hint).toContain("--timeout 4");
    expect(failure.hint).toContain("re-attaches");
  });

  it("tolerates transient getTask failures then recovers", async () => {
    let n = 0;
    const f = vi.fn(() => {
      n += 1;
      return Promise.resolve(
        n <= 4 ? fail(404) : ok({ id: "t", status: "succeeded" })
      );
    });
    await expect(
      makeClient(f).pollTask("t", { intervalMs: 1, timeoutMs: 10_000 })
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("gives up after 5 consecutive getTask failures", async () => {
    const f = vi.fn(() => Promise.resolve(fail(404)));
    await expect(
      makeClient(f).pollTask("t", { intervalMs: 1, timeoutMs: 10_000 })
    ).rejects.toBeInstanceOf(ArkApiError);
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("propagates an onUpdate rejection (regression: it is now awaited)", async () => {
    const f = vi.fn(() => Promise.resolve(ok({ id: "t", status: "running" })));
    await expect(
      makeClient(f).pollTask("t", {
        intervalMs: 1,
        onUpdate: () => Promise.reject(new Error("disk full")),
        timeoutMs: 10_000,
      })
    ).rejects.toThrow(/disk full/u);
  });
});
