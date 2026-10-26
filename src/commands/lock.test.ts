import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withManifestLock } from "./lock.js";

async function film(): Promise<{ lock: string; shots: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vs-lock-"));
  return { lock: join(dir, "tasks.json.lock"), shots: join(dir, "shots.json") };
}

/** A pid that is certainly not running: well past any real pid_max. */
const DEAD_PID = 2 ** 30;

describe("withManifestLock", () => {
  it("holds the lock while the work runs and removes it afterwards", async () => {
    const { lock, shots } = await film();
    const seen = await withManifestLock(shots, "final", "generate", async () =>
      JSON.parse(await readFile(lock, "utf-8"))
    );
    expect(seen).toMatchObject({ command: "generate", pid: process.pid });
    expect(existsSync(lock)).toBe(false);
  });

  it("releases the lock when the work throws", async () => {
    const { lock, shots } = await film();
    await expect(
      withManifestLock(shots, "final", "use", () =>
        Promise.reject(new Error("boom"))
      )
    ).rejects.toThrow("boom");
    expect(existsSync(lock)).toBe(false);
  });

  it("refuses while a live process holds the lock, naming the holder", async () => {
    const { lock, shots } = await film();
    const holder = {
      command: "generate",
      pid: process.pid,
      startedAt: "2026-10-25T09:00:00.000Z",
    };
    await writeFile(lock, JSON.stringify(holder));
    let ran = false;
    await expect(
      withManifestLock(shots, "final", "download", () => {
        ran = true;
        return Promise.resolve();
      })
    ).rejects.toMatchObject({
      code: "film_locked",
      hint: expect.stringContaining(
        "never run two vs commands that write the same film at once"
      ),
      message: expect.stringContaining(
        `pid ${process.pid} (\`vs generate\`, started 2026-10-25T09:00:00.000Z)`
      ),
    });
    expect(ran).toBe(false);
    // Someone else's lock is never deleted by the refusal.
    expect(JSON.parse(await readFile(lock, "utf-8"))).toEqual(holder);
  });

  it("takes over a lock whose holder is dead", async () => {
    const { lock, shots } = await film();
    await writeFile(
      lock,
      JSON.stringify({
        command: "generate",
        pid: DEAD_PID,
        startedAt: "2026-10-25T09:00:00.000Z",
      })
    );
    const seen = await withManifestLock(shots, "final", "generate", async () =>
      JSON.parse(await readFile(lock, "utf-8"))
    );
    expect(seen).toMatchObject({ pid: process.pid });
    expect(existsSync(lock)).toBe(false);
  });

  it("locks each pass's manifest separately", async () => {
    const { shots } = await film();
    await withManifestLock(shots, "final", "generate", async () => {
      await expect(
        withManifestLock(shots, "draft", "generate", () =>
          Promise.resolve("draft ran")
        )
      ).resolves.toBe("draft ran");
      await expect(
        withManifestLock(shots, "final", "use", () =>
          Promise.resolve("unreachable")
        )
      ).rejects.toMatchObject({ code: "film_locked" });
    });
  });
});
