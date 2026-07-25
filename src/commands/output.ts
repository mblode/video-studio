import { styleText } from "node:util";

/**
 * One rule for every command's output: DATA goes to stdout, everything a human
 * reads while waiting (progress, warnings, per-shot success lines) goes to
 * stderr. `vs status films/x/shots.json > state.txt` then captures state and
 * still shows progress in the terminal.
 *
 * Colour is decided per stream. `styleText` already consults the stream's colour
 * depth (which honours NO_COLOR/FORCE_COLOR/TERM), but it defaults to checking
 * `process.stdout`, so stderr writes have to name their own stream or a
 * redirected log ends up full of escape codes.
 */
type Format = Parameters<typeof styleText>[0];

let json = !process.stdout.isTTY;
let verbose = false;

/** JSON mode: explicit `--json`, or stdout is not a terminal (an agent/pipe). */
export function isJsonMode(): boolean {
  return json;
}

export function setJsonMode(enabled: boolean): void {
  json = enabled;
}

export function isVerbose(): boolean {
  return verbose;
}

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

function paint(format: Format, text: string, stream: NodeJS.WriteStream) {
  return styleText(format, text, { stream });
}

/** Colour for stdout. Use only for human-mode data lines. */
export function color(format: Format, text: string): string {
  return paint(format, text, process.stdout);
}

function toStderr(format: Format, text: string): void {
  process.stderr.write(`${paint(format, text, process.stderr)}\n`);
}

/** Low-key progress ("· shot submitted"). Never parsed; always stderr. */
export function note(text: string): void {
  toStderr("dim", `· ${text}`);
}

/** A step that finished. Progress, not data, so stderr. */
export function ok(text: string): void {
  toStderr("green", `✓ ${text}`);
}

export function warn(text: string): void {
  toStderr("yellow", `⚠ ${text}`);
}

export function fail(text: string): void {
  toStderr("red", `✗ ${text}`);
}

/** A section header around dry-run payloads and the like. */
export function heading(text: string): void {
  toStderr("bold", text);
}

/** Data. One line on stdout, verbatim. */
export function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

/**
 * Emit a command's result: the JSON payload when a machine is reading, the
 * human rendering otherwise. Keeping both behind one call is what stops the
 * two drifting apart (the old `--dry-run` interleaved styled headers with JSON
 * and was unparseable as a result).
 */
export function emit(payload: unknown, human: () => void): void {
  if (json) {
    line(JSON.stringify(payload, null, 2));
    return;
  }
  human();
}
