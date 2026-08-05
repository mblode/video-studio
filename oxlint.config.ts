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

const USE_SPEC =
  "commands depend on the provider spec, never on an adapter: take a VideoModelV1 from createVideoModel() in ./context.js. See docs/adr/0001-video-provider-spec.md";
const PROVIDERS_ARE_LEAVES =
  "a provider adapter may not reach back into a command; it gets everything it needs through VideoModelV1CallOptions";

/**
 * The provider seam, which types alone cannot hold.
 *
 * `VideoModelV1` only buys vendor-blindness if no command can quietly reach
 * past it, and the cheapest way to break it is one `import { createMinimax }`
 * inside a command during a deadline. An unenforced boundary decays; an exit
 * code in pre-commit does not.
 */
const providerBoundary = (
  group: string[],
  message: string
): [string, { patterns: { group: string[]; message: string }[] }] => [
  "error",
  { patterns: [{ group, message }] },
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
      // Commands talk to the spec, not to an adapter.
      excludeFiles: [
        // The ONE place a provider is constructed, which is what makes it the
        // one place a key is read. Everything else asks it for a model.
        "src/commands/context.ts",
        // Tests build a real adapter on purpose, to assert that a command
        // submits the bytes a real provider would have sent.
        "**/*.test.ts",
      ],
      files: ["src/commands/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": providerBoundary(
          ["**/providers/*", "../providers/*", "./providers/*"],
          USE_SPEC
        ),
      },
    },
    {
      // Adapters are leaves: they know the spec and the wire, nothing upward.
      files: ["src/providers/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": providerBoundary(
          ["**/commands/*", "../commands/*", "./commands/*"],
          PROVIDERS_ARE_LEAVES
        ),
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
