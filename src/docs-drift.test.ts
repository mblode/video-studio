import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { buildProgram } from "./program.js";

const repoRoot = join(import.meta.dirname, "..");

/**
 * Every doc that promises the reader a working command line. Four of the bugs
 * fixed before the repo went public were flags that had been documented but
 * never existed, so the docs are checked against the real command tree rather
 * than against a hand-maintained list.
 */
const DOC_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "films/lighthouse/README.md",
  ...readdirSync(join(repoRoot, ".claude", "skills"), { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => join(".claude", "skills", entry)),
].toSorted();

interface Snippet {
  line: number;
  text: string;
}

const FENCE = /^\s*(?:```|~~~)/u;
const INLINE_CODE = /`(?<code>[^`\n]+)`/gu;
/** `node dist/cli.js <cmd>` and `vs <cmd>` are the same invocation. */
const NODE_ENTRY = /(?:^|\s)node\s+\S*cli\.js\s+/u;
const TRAILING_COMMENT = /(?:^|\s)#.*$/u;
const SEGMENT_SEPARATOR = /&&|\|\||;|\|/u;
/** `<shots-file>`, `[task-id]`: a slot for the reader to fill in, not a name. */
const PLACEHOLDER = /^[<[]/u;

/**
 * Pull out the parts of a markdown file that claim to be shell. Invocations
 * live in fenced blocks, in inline code in prose, and in inline code inside
 * table cells; bare prose is deliberately ignored, because "want vs need" and
 * "delivered-vs-requested" are not command lines.
 */
function codeSnippets(markdown: string): Snippet[] {
  const snippets: Snippet[] = [];
  const lines = markdown.split("\n");
  let inFence = false;
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index] ?? "";
    if (FENCE.test(raw)) {
      inFence = !inFence;
      index += 1;
      continue;
    }
    if (inFence) {
      // A trailing backslash continues the command onto the next line.
      const start = index;
      let text = raw;
      while (text.trimEnd().endsWith("\\") && index + 1 < lines.length) {
        index += 1;
        text = `${text.trimEnd().slice(0, -1)} ${(lines[index] ?? "").trim()}`;
      }
      snippets.push({ line: start + 1, text });
      index += 1;
      continue;
    }
    for (const match of raw.matchAll(INLINE_CODE)) {
      snippets.push({ line: index + 1, text: match.groups?.code ?? "" });
    }
    index += 1;
  }
  return snippets;
}

/** The `vs ...` command lines in one snippet, normalised to the `vs` form. */
function invocations(snippet: Snippet): string[] {
  const withoutComment = snippet.text.replace(TRAILING_COMMENT, "");
  return withoutComment
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.replace(NODE_ENTRY, " vs ").trim())
    .filter((segment) => segment === "vs" || segment.startsWith("vs "));
}

/** Long flags a subcommand accepts, including the positive form of `--no-x`. */
function longFlags(command: Command): Set<string> {
  const flags = new Set(["--help"]);
  for (const option of command.options) {
    if (!option.long) {
      continue;
    }
    flags.add(option.long);
    if (option.negate) {
      flags.add(option.long.replace("--no-", "--"));
    }
  }
  return flags;
}

function globalFlags(program: Command): Set<string> {
  const flags = longFlags(program);
  flags.add("--version");
  return flags;
}

/** Why this invocation would fail if a reader pasted it, or undefined. */
function problemWith(program: Command, invocation: string): string | undefined {
  const tokens = invocation.split(/\s+/u);
  const [, name] = tokens;
  if (!name || PLACEHOLDER.test(name) || name === "help") {
    return;
  }
  const command = program.commands.find(
    (candidate) =>
      candidate.name() === name || candidate.aliases().includes(name)
  );
  if (!command) {
    const known = program.commands.map((c) => c.name()).join(", ");
    return `unknown command "${name}" (vs has: ${known})`;
  }
  const accepted = longFlags(command).union(globalFlags(program));
  for (const token of tokens.slice(2)) {
    if (!token.startsWith("--") || token === "--") {
      continue;
    }
    const [rawFlag = ""] = token.split("=");
    const flag = rawFlag.replace(/[.,;:)\]]+$/u, "");
    if (!accepted.has(flag)) {
      const known = [...accepted].toSorted().join(" ");
      return `unknown flag "${flag}" on "vs ${name}" (accepts: ${known})`;
    }
  }
}

function driftProblems(
  program: Command,
  file: string,
  markdown: string
): string[] {
  const problems: string[] = [];
  for (const snippet of codeSnippets(markdown)) {
    for (const invocation of invocations(snippet)) {
      const problem = problemWith(program, invocation);
      if (problem) {
        problems.push(`${file}:${snippet.line}: ${problem}\n    ${invocation}`);
      }
    }
  }
  return problems;
}

function documentedInvocations(markdown: string): string[] {
  return codeSnippets(markdown).flatMap(invocations);
}

describe("documented commands match the CLI", () => {
  const program = buildProgram();

  it.each(DOC_FILES)("%s documents only real commands and flags", (file) => {
    const markdown = readFileSync(join(repoRoot, file), "utf-8");
    expect(driftProblems(program, file, markdown)).toEqual([]);
  });

  // Without this, an extractor that silently stopped matching anything would
  // leave every file above passing vacuously.
  it("finds the documented invocations it is meant to be checking", () => {
    const all = DOC_FILES.flatMap((file) =>
      documentedInvocations(readFileSync(join(repoRoot, file), "utf-8"))
    );
    const named = new Set(
      all
        .map((invocation) => invocation.split(/\s+/u)[1])
        .filter((name) => name && !PLACEHOLDER.test(name))
    );
    expect(all.length).toBeGreaterThan(40);
    // Every command the CLI ships is meant to be documented somewhere.
    for (const command of program.commands) {
      expect(named).toContain(command.name());
    }
  });

  it("catches a renamed command and a renamed flag", () => {
    const markdown = [
      "Run `vs stitch --xfade 0.4` to cut it together.",
      "",
      "```bash",
      "node dist/cli.js generate films/x/shots.json --max-spend 5",
      "vs animate films/x/shots.json",
      "```",
      "",
      "| `vs upscale --shot <ids>` | fine |",
    ].join("\n");
    const problems = driftProblems(program, "fake.md", markdown);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("fake.md:4");
    expect(problems[0]).toContain('unknown flag "--max-spend"');
    expect(problems[1]).toContain('unknown command "animate"');
  });

  it("ignores prose that merely says vs", () => {
    const markdown = "Want `vs` need, and frame mode vs reference roles.";
    expect(driftProblems(program, "fake.md", markdown)).toEqual([]);
  });
});
