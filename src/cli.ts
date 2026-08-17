import { fail, isJsonMode, isVerbose, line, note } from "./commands/output.js";
import { loadEnv } from "./env.js";
import { formatError } from "./errors.js";
import { buildProgram } from "./program.js";

// ONCE, here, for every command. Loading `.env` ad hoc inside individual
// commands meant `vs doctor` read the nearest one and reported a key as set
// while `vs stills` and `vs generate` never loaded that file and failed on the
// same key as missing. Every missing-credential hint in src/env.ts tells you to
// put the key in a `.env`, so every command has to read it.
loadEnv();

try {
  await buildProgram().parseAsync();
} catch (error) {
  const { code, details, hint, message } = formatError(error, isVerbose());
  if (isJsonMode()) {
    line(JSON.stringify({ code, error: message, hint }));
  }
  fail(message);
  if (hint) {
    note(hint);
  }
  for (const detail of details) {
    note(detail);
  }
  if (!isVerbose()) {
    note("re-run with --verbose for the stack and the underlying cause");
  }
  process.exit(1);
}
