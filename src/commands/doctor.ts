import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ArkClient } from "../ark.js";
import { baseUrl, loadEnv } from "../env.js";
import { formatError } from "../errors.js";
import { assertBinary } from "../ffmpeg.js";
import { TASK_STATUSES } from "../types.js";
import { createArkClient, packageInfo } from "./context.js";
import {
  color,
  emit,
  fail,
  isJsonMode,
  isVerbose,
  line,
  writeLine,
} from "./output.js";

const execFileAsync = promisify(execFile);

export interface DoctorOptions {
  /** Deprecated: ffmpeg is always checked. Kept so old scripts still parse. */
  ffmpeg?: boolean;
}

export type CheckStatus = "fail" | "ok" | "skip" | "warn";

export interface DoctorCheck {
  detail?: string;
  label: string;
  status: CheckStatus;
}

/**
 * Validate that an arbitrary value matches the assumed `ArkTask` wire shape.
 * Returns a list of problems (empty = valid). Used to confirm the assumed
 * GET /contents/generations/tasks/{id} endpoint against a real task.
 */
export function validateTaskShape(task: unknown): string[] {
  if (typeof task !== "object" || task === null) {
    return ["response is not a JSON object"];
  }
  const problems: string[] = [];
  const record = task as Record<string, unknown>;
  if (typeof record.id !== "string") {
    problems.push("missing string `id`");
  }
  if (
    typeof record.status !== "string" ||
    !(TASK_STATUSES as readonly string[]).includes(record.status)
  ) {
    problems.push(
      `status "${String(record.status)}" is not one of ${TASK_STATUSES.join(", ")}`
    );
  }
  if (record.content !== undefined && record.content !== null) {
    const content = record.content as Record<string, unknown>;
    if (
      content.video_url !== undefined &&
      typeof content.video_url !== "string"
    ) {
      problems.push("content.video_url is present but not a string");
    }
  }
  return problems;
}

/** Lowest Node major the package claims to support (`engines.node`, e.g. ">=24"). */
export function requiredNodeMajor(engines?: { node?: string }): number | null {
  const match = /(?<major>\d+)/u.exec(engines?.node ?? "");
  return match ? Number(match.groups?.major) : null;
}

async function onPath(name: string): Promise<boolean> {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function binaryCheck(
  name: string,
  purpose: string
): Promise<DoctorCheck> {
  try {
    await assertBinary(name);
    return { label: `${name} available`, status: "ok" };
  } catch (error) {
    const { hint, message } = formatError(error);
    return {
      detail: `${message}${hint ? `: ${hint}` : ""} (needed for ${purpose})`,
      label: name,
      status: "fail",
    };
  }
}

function nodeCheck(): DoctorCheck {
  const required = requiredNodeMajor(packageInfo().engines);
  const current = Number(process.versions.node.split(".")[0]);
  if (required === null || current >= required) {
    return { label: `Node ${process.versions.node}`, status: "ok" };
  }
  return {
    detail: `Node >= ${required} is required (engines.node); upgrade with \`nvm install ${required}\` or your version manager`,
    label: `Node ${process.versions.node} is too old`,
    status: "fail",
  };
}

function envCheck(envPath: string | undefined): DoctorCheck {
  if (envPath) {
    return { detail: envPath, label: ".env loaded", status: "ok" };
  }
  return {
    detail:
      "searched upward from the current directory; copy .env.example to .env and add your keys",
    label: "no .env found",
    status: "warn",
  };
}

function keyChecks(): DoctorCheck[] {
  return [
    process.env.ARK_API_KEY
      ? {
          detail: `base URL: ${baseUrl()}`,
          label: "ARK_API_KEY set",
          status: "ok",
        }
      : {
          detail:
            "add `ARK_API_KEY=...` to .env (see .env.example); every generate/stills/status call needs it",
          label: "ARK_API_KEY missing",
          status: "fail",
        },
    process.env.GEMINI_API_KEY
      ? {
          label: "GEMINI_API_KEY set (Nano Banana stills / Lyria score)",
          status: "ok",
        }
      : {
          detail: "needed for gemini-* stills and `vs score`",
          label: "GEMINI_API_KEY not set",
          status: "skip",
        },
    process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY
      ? {
          label: "ELEVENLABS_API_KEY set (vs narrate)",
          status: "ok",
        }
      : {
          detail: "only needed for `vs narrate`",
          label: "ELEVENLABS_API_KEY not set",
          status: "skip",
        },
    process.env.ELEVENLABS_VOICE_ID
      ? {
          label: "ELEVENLABS_VOICE_ID set",
          status: "ok",
        }
      : {
          detail: "pass --voice to `vs narrate` if unset",
          label: "ELEVENLABS_VOICE_ID not set",
          status: "skip",
        },
  ];
}

/** macOS-only card rasterisation path (`src/cards.ts` renders SVG via qlmanage). */
async function cardChecks(): Promise<DoctorCheck[]> {
  if (process.platform !== "darwin") {
    return [
      {
        detail:
          "title cards are rasterised with macOS `qlmanage`; on this platform install an ffmpeg with drawtext and adapt src/cards.ts",
        label: "title cards unsupported on this platform",
        status: "warn",
      },
    ];
  }
  const checks: DoctorCheck[] = [];
  for (const name of ["qlmanage", "sips"]) {
    checks.push(
      (await onPath(name))
        ? { label: `${name} available (title cards)`, status: "ok" }
        : {
            detail:
              "part of macOS; `vs stitch` cannot render title cards without it",
            label: `${name} not on PATH`,
            status: "fail",
          }
    );
  }
  return checks;
}

async function endpointCheck(
  taskId: string,
  client?: ArkClient
): Promise<DoctorCheck> {
  if (!(process.env.ARK_API_KEY || client)) {
    return {
      detail: "set ARK_API_KEY first",
      label: "endpoint check skipped",
      status: "skip",
    };
  }
  const ark = client ?? createArkClient();
  try {
    const task = await ark.getTask(taskId);
    const problems = validateTaskShape(task);
    if (problems.length === 0) {
      return {
        label: `endpoint shape confirmed (task ${taskId} → ${task.status})`,
        status: "ok",
      };
    }
    return {
      detail: problems.join("; "),
      label: "endpoint response did not match ArkTask",
      status: "fail",
    };
  } catch (error) {
    const { hint, message } = formatError(error, isVerbose());
    return {
      detail: `${message}${hint ? `: ${hint}` : ""}`,
      label: `getTask(${taskId}) failed`,
      status: "fail",
    };
  }
}

const MARKS: Record<
  CheckStatus,
  { color: "dim" | "green" | "red" | "yellow"; mark: string }
> = {
  fail: { color: "red", mark: "✗" },
  ok: { color: "green", mark: "✓" },
  skip: { color: "dim", mark: "·" },
  warn: { color: "yellow", mark: "⚠" },
};

function print(check: DoctorCheck): void {
  const { color: hue, mark } = MARKS[check.status];
  // Failures go to stderr so `vs doctor 2>/dev/null` shows only what passed.
  // Naming the stream rather than holding it keeps the per-stream painter in
  // output.ts: `color()` is keyed to stdout's colour depth, so painting a stderr
  // write with it puts raw escape codes into `vs doctor 2> log` for exactly the
  // checks a bug report needs to be legible.
  const stream = check.status === "fail" ? "stderr" : "stdout";
  writeLine(stream, hue, `${mark} ${check.label}`);
  if (check.detail) {
    writeLine(stream, "dim", `    ${check.detail}`);
  }
}

/** Runs every check, prints them, and returns them so callers can assert on them. */
export async function runDoctor(
  taskId: string | undefined,
  _options: DoctorOptions = {},
  injected: { client?: ArkClient } = {}
): Promise<DoctorCheck[]> {
  const envPath = loadEnv();
  const checks: DoctorCheck[] = [
    nodeCheck(),
    envCheck(envPath),
    ...keyChecks(),
    await binaryCheck("ffmpeg", "stitch, review, chaining"),
    await binaryCheck("ffprobe", "stream probing before any concat"),
    ...(await cardChecks()),
  ];
  if (taskId) {
    checks.push(await endpointCheck(taskId, injected.client));
  }

  emit({ checks, ok: !checks.some((c) => c.status === "fail") }, () => {
    for (const check of checks) {
      print(check);
    }
    if (!taskId) {
      line(
        color(
          "dim",
          "  (pass a task id, `vs doctor <task-id>`, to confirm the Ark endpoint shape against an existing task; no paid generation)"
        )
      );
    }
  });

  if (checks.some((check) => check.status === "fail")) {
    if (isJsonMode()) {
      // The human rendering already showed every ✗; in JSON mode stdout is the
      // payload, so the headline goes to stderr on its own.
      fail("doctor found problems");
    }
    process.exitCode = 1;
  }
  return checks;
}
