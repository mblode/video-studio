import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  rules: {
    // Project idiom (matching book-converter): function declarations and
    // named node:path imports; sequential awaits are intentional in the
    // polling/retry loops; ark.ts pairs a client class with its error class.
    "eslint/func-style": "off",
    "eslint/max-classes-per-file": "off",
    "eslint/no-await-in-loop": "off",
    "oxc/branches-sharing-code": "off",
    "unicorn/import-style": "off",
    "unicorn/prefer-single-call": "off",
  },
});
