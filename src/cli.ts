import { fail, isJsonMode, isVerbose, line, note } from "./commands/output.js";
import { formatError } from "./errors.js";
import { buildProgram } from "./program.js";

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
