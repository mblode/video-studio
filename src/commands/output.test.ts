import { afterEach, describe, expect, it, vi } from "vitest";

import { emit, isJsonMode, line, note, setJsonMode } from "./output.js";

const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

function written(spy: typeof stdout): string {
  return spy.mock.calls.map((call) => String(call[0])).join("");
}

afterEach(() => {
  stdout.mockClear();
  stderr.mockClear();
  setJsonMode(!process.stdout.isTTY);
});

describe("output routing", () => {
  it("sends progress to stderr so stdout stays parseable", () => {
    setJsonMode(false);
    note("submitting shot a");
    expect(written(stdout)).toBe("");
    expect(written(stderr)).toContain("submitting shot a");
  });

  it("sends data to stdout", () => {
    line("payload");
    expect(written(stdout)).toBe("payload\n");
  });
});

describe("emit", () => {
  it("prints JSON on stdout in json mode and skips the human rendering", () => {
    setJsonMode(true);
    const human = vi.fn();
    emit({ ok: true }, human);
    expect(human).not.toHaveBeenCalled();
    expect(JSON.parse(written(stdout))).toEqual({ ok: true });
  });

  it("runs the human rendering when json mode is off", () => {
    setJsonMode(false);
    const human = vi.fn();
    emit({ ok: true }, human);
    expect(human).toHaveBeenCalledOnce();
    expect(written(stdout)).toBe("");
  });

  it("defaults to json when stdout is not a terminal", () => {
    // vitest pipes stdout, which is the same shape as an agent invoking `vs`.
    expect(isJsonMode()).toBe(!process.stdout.isTTY);
  });
});
