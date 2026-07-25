import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isLocalPathSafe, safeJoin } from "./paths.js";

const BASE = "/films/demo";

describe("safeJoin", () => {
  it("resolves a path that stays within the base", () => {
    expect(safeJoin(BASE, "sub/a.mp4")).toBe(resolve(BASE, "sub/a.mp4"));
    expect(safeJoin(BASE, "a.mp4")).toBe(resolve(BASE, "a.mp4"));
  });

  it("throws on parent-directory traversal", () => {
    expect(() => safeJoin(BASE, "../escape.mp4")).toThrow(/escapes/u);
    expect(() => safeJoin(BASE, "a/../../b")).toThrow(/escapes/u);
  });

  it("throws on an absolute path", () => {
    expect(() => safeJoin(BASE, "/etc/passwd")).toThrow(/escapes/u);
  });
});

describe("isLocalPathSafe", () => {
  it("accepts relative paths within the base", () => {
    expect(isLocalPathSafe("a.png")).toBe(true);
    expect(isLocalPathSafe("./stills/a.png")).toBe(true);
    expect(isLocalPathSafe("sub/dir/a.png")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isLocalPathSafe("../a.png")).toBe(false);
    expect(isLocalPathSafe("sub/../../a.png")).toBe(false);
    expect(isLocalPathSafe("/etc/passwd")).toBe(false);
  });
});
