import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { buildProgram } from "./program.js";

/** Value placeholders that promise a number: `--timeout <minutes>`, `--crf <n>`. */
const NUMERIC_PLACEHOLDER = /<(?:n|seconds|minutes|dB|usd)>/u;

function commandAt(program: Command, path: string[]): Command {
  let current = program;
  for (const name of path) {
    const next = current.commands.find(
      (candidate) => candidate.name() === name
    );
    if (!next) {
      throw new Error(`no command \`vs ${path.join(" ")}\``);
    }
    current = next;
  }
  return current;
}

/** Run one flag's argument parser, the way commander runs it during parse. */
function parse(path: string[], flag: string, value: string): number {
  const option = commandAt(buildProgram(), path).options.find(
    (candidate) => candidate.long === flag
  );
  if (!option?.parseArg) {
    throw new Error(`${flag} on \`vs ${path.join(" ")}\` has no parser`);
  }
  const parseArg = option.parseArg as unknown as (input: string) => number;
  return parseArg(value);
}

function rejection(run: () => unknown): Error & {
  code?: string;
  hint?: string;
} {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string; hint?: string };
  }
  throw new Error("expected the value to be refused");
}

interface NumericOption {
  flag: string;
  label: string;
  validated: boolean;
}

function numericOptions(
  command: Command,
  path: string[] = []
): NumericOption[] {
  const found: NumericOption[] = command.options
    .filter((option) => option.long && NUMERIC_PLACEHOLDER.test(option.flags))
    .map((option) => ({
      flag: option.long ?? "",
      label: ["vs", ...path].join(" "),
      validated: option.parseArg !== undefined,
    }));
  for (const sub of command.commands) {
    found.push(...numericOptions(sub, [...path, sub.name()]));
  }
  return found;
}

/**
 * A numeric flag that reaches the run as NaN does not fail, it misbehaves:
 * `--poll-interval 10s` becomes a 1ms hot loop against a 180 rpm limit,
 * `--timeout 20m` disables the deadline (`Date.now() > NaN` is never true), and
 * `--concurrency abc` reaches pLimit as a bare TypeError. Every one of them has
 * to be refused at the boundary instead.
 */
describe("numeric flags", () => {
  it.each([
    { flag: "--poll-interval", path: ["generate"], value: "10s" },
    { flag: "--timeout", path: ["generate"], value: "20m" },
    { flag: "--concurrency", path: ["generate"], value: "abc" },
    { flag: "--crf", path: ["upscale"], value: "1.5" },
    { flag: "--height", path: ["upscale"], value: "0" },
    { flag: "--max-mb", path: ["share"], value: "-1" },
    { flag: "--frames", path: ["review"], value: "" },
    { flag: "--xfade", path: ["narrate", "assemble"], value: "half" },
    // --max-cost used to throw commander's InvalidArgumentError instead, so it
    // was the one numeric flag a `--json` caller could not branch on by code.
    { flag: "--max-cost", path: ["generate"], value: "bogus" },
  ])("refuses `$flag $value`", ({ flag, path, value }) => {
    const failure = rejection(() => parse(path, flag, value));

    expect(failure.code).toBe("invalid_input");
    // names the flag and what actually arrived, so the caller can fix the call
    expect(failure.message).toContain(flag);
    expect(failure.message).toContain(`"${value}"`);
    expect(failure.hint).toBeTruthy();
  });

  it("accepts the values these flags are for, including negative dB", () => {
    expect(parse(["generate"], "--poll-interval", "10")).toBe(10);
    expect(parse(["stitch"], "--music-gain", "-12")).toBe(-12);
    expect(parse(["stitch"], "--xfade", "0.4")).toBe(0.4);
    expect(parse(["upscale"], "--crf", "18")).toBe(18);
    expect(parse(["generate"], "--max-cost", "12.50")).toBe(12.5);
  });

  it("still refuses a zero or negative spend ceiling", () => {
    // --max-cost 0 must not read as "no limit"; it is the one bound whose
    // failure mode is an unbounded bill.
    expect(rejection(() => parse(["generate"], "--max-cost", "0")).code).toBe(
      "invalid_input"
    );
    expect(rejection(() => parse(["generate"], "--max-cost", "-5")).code).toBe(
      "invalid_input"
    );
  });

  // Without this, the next numeric flag added would be NaN-prone by default.
  it("validates every numeric flag in the tree", () => {
    const unguarded = numericOptions(buildProgram())
      .filter((option) => !option.validated)
      .map((option) => `${option.label} ${option.flag}`);
    expect(unguarded).toEqual([]);
  });
});
