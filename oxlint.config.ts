import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

const USE_OUTPUT =
  "only src/commands/output.ts writes to a stream; use line()/note()/ok()/warn()/fail()/emit()/writeLine() from ./output.js";
const USE_EXIT_CODE =
  "only src/cli.ts calls process.exit; a command sets process.exitCode and returns, so in-flight stdout writes drain and a caller's `&&` chain sees the failure";

/**
 * The two invariants the CLI cannot enforce in types.
 *
 * `output.ts` owns the streams (data on stdout, human progress on stderr, colour
 * keyed to the stream being written) and `cli.ts` owns the exit. A stray
 * `console.log` breaks `vs status … | jq`; a stray `process.exit` truncates a
 * piped write and, at `exit(0)`, reports work that never happened as a success.
 */
const streamsAndExit = [
  { message: USE_OUTPUT, object: "console" },
  { message: USE_OUTPUT, object: "process", property: "stderr" },
  { message: USE_OUTPUT, object: "process", property: "stdout" },
  { message: USE_EXIT_CODE, object: "process", property: "exit" },
];

const except = (...allowed: string[]) =>
  streamsAndExit.filter(
    (entry) => !allowed.includes(entry.property ?? entry.object)
  );

export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // The one module that owns the streams. It still may not use `console`,
      // which bypasses the stdout/stderr split entirely.
      files: ["src/commands/output.ts"],
      rules: {
        "eslint/no-restricted-properties": [
          "error",
          ...except("stdout", "stderr"),
        ],
      },
    },
    {
      // The process's only exit point: the top-level catch, after the error has
      // been rendered.
      files: ["src/cli.ts"],
      rules: {
        "eslint/no-restricted-properties": ["error", ...except("exit")],
      },
    },
    {
      // Tests spy on the streams to assert the stdout/stderr contract itself.
      files: ["**/*.test.ts"],
      rules: {
        "eslint/no-restricted-properties": [
          "error",
          ...except("stdout", "stderr"),
        ],
      },
    },
  ],
  rules: {
    // Project idiom (matching book-converter): function declarations and
    // named node:path imports; sequential awaits are intentional in the
    // polling/retry loops; ark.ts pairs a client class with its error class.
    "eslint/func-style": "off",
    "eslint/max-classes-per-file": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/no-restricted-properties": ["error", ...streamsAndExit],
    "oxc/branches-sharing-code": "off",
    "unicorn/import-style": "off",
    "unicorn/prefer-single-call": "off",
  },
});
