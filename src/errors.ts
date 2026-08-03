/**
 * Stable machine-readable failure codes. Agents and scripts branch on these
 * instead of parsing prose, so treat them as API: add freely, rename never.
 */
export const VS_ERROR_CODES = [
  /** The target already exists and no --force was given. */
  "already_exists",
  /** The estimated spend for a run exceeds the --max-cost ceiling. */
  "cost_ceiling",
  /** A remote fetch of a generated asset failed. */
  "download_failed",
  /** ffmpeg/ffprobe ran but exited non-zero. */
  "ffmpeg_failed",
  /** A path the operator supplied does not exist on disk. */
  "file_not_found",
  /** The path exists but could not be read (permissions, or it is a directory). */
  "file_unreadable",
  /** A shots/stills file failed schema validation or could not be parsed. */
  "invalid_input",
  /** A clip the command needs has not been generated/downloaded yet. */
  "missing_clip",
  /** An API key is not set. */
  "missing_credential",
  /** An external binary (ffmpeg, qlmanage) is not installed. */
  "missing_dependency",
  /** The command needs a prompt answer but stdin is not a TTY. */
  "not_interactive",
  /** A film-supplied path escapes its film directory. */
  "path_escape",
  /** ffprobe could not make sense of a media file. */
  "probe_failed",
  /** Rasterising a title card failed (qlmanage/sips, or an unresolvable font). */
  "render_failed",
  /** Clips cannot be concatenated because their streams differ. */
  "stream_mismatch",
  /** A generation task ended in a non-succeeded state. */
  "task_failed",
  /** A task did not reach a terminal state before the poll deadline. */
  "timeout",
  /** An id passed on the command line matches nothing in the film. */
  "unknown_id",
] as const;

export type VsErrorCode = (typeof VS_ERROR_CODES)[number];

export interface VsErrorOptions {
  cause?: unknown;
  /** The next step the operator should take. Printed under the message. */
  hint?: string;
}

/**
 * A failure the operator can act on: a missing key, a bad id, a file that is
 * not there. Plain `Error` stays reserved for programmer bugs, so a mistake and
 * a crash no longer print identically (`--verbose` shows the stack and the
 * cause chain for both).
 */
export class VsError extends Error {
  readonly code: VsErrorCode;
  readonly hint?: string;

  constructor(
    code: VsErrorCode,
    message: string,
    options: VsErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "VsError";
    this.code = code;
    this.hint = options.hint;
  }
}

export function isVsError(error: unknown): error is VsError {
  return error instanceof VsError;
}

/**
 * BytePlus/Google rate limits, quoted so a 429 tells you what to change.
 * Individual tier: 180 requests/min and 3 concurrent tasks (4K: 15/min, 1).
 */
const RATE_LIMIT_HINT =
  "the individual tier allows 180 requests/min and 3 concurrent tasks (15/min and 1 concurrent at 4K); lower --concurrency and re-run; completed shots are skipped";

const AUTH_HINT =
  "check ARK_API_KEY (or GEMINI_API_KEY for gemini-* stills) in .env, then re-run `vs doctor`";

/**
 * HTTP status carried by a provider error (ArkApiError/GeminiApiError). Read
 * structurally rather than by class so a new provider client is covered too.
 */
function apiStatus(error: unknown): number | undefined {
  if (!(error instanceof Error && error.name.endsWith("ApiError"))) {
    return;
  }
  const { status } = error as Error & { status?: unknown };
  return typeof status === "number" ? status : undefined;
}

/** Turn a provider HTTP status into a next step, if we know one. */
export function apiHint(error: unknown): string | undefined {
  const status = apiStatus(error);
  if (status === 401 || status === 403) {
    return AUTH_HINT;
  }
  if (status === 429) {
    return RATE_LIMIT_HINT;
  }
  if (status !== undefined && status >= 500) {
    return "the provider is failing; retry in a few minutes (in-flight tasks are re-attached, not re-billed)";
  }
  return undefined;
}

export interface FormattedError {
  /** Set only for VsError; scripts can branch on it. */
  code?: VsErrorCode;
  /** Cause chain and stack. Populated only in verbose mode. */
  details: string[];
  hint?: string;
  message: string;
}

/** The tail of a captured stderr, when a cause carries one (ffmpeg). */
function causeDetail(error: Error): string {
  const { stderr } = error as Error & { stderr?: unknown };
  if (typeof stderr === "string" && stderr.trim().length > 0) {
    return `${error.message}\n${stderr.slice(-2000)}`;
  }
  return error.message;
}

function collectDetails(error: unknown): string[] {
  const details: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  while (current instanceof Error) {
    details.push(`caused by: ${causeDetail(current)}`);
    current = current.cause;
  }
  if (error instanceof Error && error.stack) {
    details.push(error.stack);
  }
  return details;
}

/**
 * Normalise any thrown value into the shape the CLI prints: one line the
 * operator reads, one hint naming the next step, and (verbose only) the cause
 * chain that `src/ffmpeg.ts` and friends attach.
 */
export function formatError(error: unknown, verbose = false): FormattedError {
  const details = verbose ? collectDetails(error) : [];
  if (isVsError(error)) {
    return {
      code: error.code,
      details,
      hint: error.hint,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return { details, hint: apiHint(error), message: error.message };
  }
  return { details, message: String(error) };
}

/**
 * Map a failed file read onto the right stable code.
 *
 * ENOENT is the operator's path being wrong, and `missing` supplies the
 * command-specific hint for that. Anything else means the path resolved to
 * something we could not read, which is a different fix (permissions, or the
 * path named a directory), so it must not borrow the "check the path" hint.
 */
export function fileReadError(
  path: string,
  cause: unknown,
  missing: () => VsError
): VsError {
  const { code } = cause as NodeJS.ErrnoException;
  if (code === "ENOENT") {
    return missing();
  }
  const reason = code === "EISDIR" ? "it is a directory" : "permission denied";
  return new VsError("file_unreadable", `cannot read ${path}: ${reason}`, {
    cause,
    hint:
      code === "EISDIR"
        ? "point at the file inside that directory, not the directory itself"
        : `check the file's permissions (\`ls -l ${path}\`)`,
  });
}
