import { describe, expect, it } from "vitest";

import * as api from "./index.js";

/**
 * Constants that MUST arrive as runtime values. `export type * from
 * "./types.js"` used to make these type-only: they typechecked at the call site
 * and were `undefined` at run time, which is invisible without this test.
 */
const VALUE_EXPORTS = [
  "ANIMATIC_FPS",
  "ANIMATIC_SHORT_SIDE",
  "ASPECT_RATIOS",
  "DEFAULT_BASE_URL",
  "DEFAULT_DURATION",
  "DEFAULT_GEMINI_BASE_URL",
  "DEFAULT_GEMINI_IMAGE_MODEL",
  "DEFAULT_RESOLUTION",
  "DEFAULT_VIDEO_MODEL",
  "DRAFT_RESOLUTION",
  "DRAFT_VIDEO_MODEL",
  "DURATION_AUTO",
  "DURATION_MAX",
  "DURATION_MIN",
  "GEMINI_PRO_IMAGE_MODEL",
  "MODEL_IDS",
  "MODEL_REGISTRY",
  "RESOLUTION_TOKEN_FACTOR",
  "RESOLUTIONS",
  "TASK_STATUSES",
  "TASKS_PATH",
  "TOKENS_PER_SECOND_1080P",
  "VIDEO_USD_PER_KTOKEN",
  "VS_ERROR_CODES",
] as const;

/** Callables a consumer needs to drive the pipeline from a script. */
const FUNCTION_EXPORTS = [
  "ArkClient",
  "ArkResponseError",
  "GeminiClient",
  "MockVideoProvider",
  "VsError",
  "assertFfmpeg",
  "buildSharePlan",
  "buildStitchPlan",
  "buildCallOptions",
  "buildUpscalePlan",
  "checkCostCeiling",
  "clipTokens",
  "createModelLimiter",
  "downloadFile",
  "effectiveShotParams",
  "estimateClip",
  "estimateClips",
  "estimateTokens",
  "findEnvFile",
  "formatError",
  "frameSize",
  "isKnownModel",
  "isLocalPathSafe",
  "lintShotsFile",
  "lintStillsFile",
  "loadManifest",
  "loadShotsFile",
  "loadStillsFile",
  "lookupModel",
  "modelRateLimits",
  "normalizeModelId",
  "orderTimeline",
  "passSuffix",
  "probeClip",
  "probeWarnings",
  "reconcileTokens",
  "renderIndexMd",
  "resolveOutput",
  "resolveReferenceUrl",
  "runFfmpeg",
  "safeJoin",
  "usdForTokens",
  "usdPerMToken",
  "validateShotAgainstModel",
  "videoTokens",
] as const;

const surface = api as unknown as Record<string, unknown>;

describe("public API surface", () => {
  it.each(VALUE_EXPORTS)("exports %s as a runtime value", (name) => {
    expect(surface[name]).toBeDefined();
  });

  it.each(FUNCTION_EXPORTS)("exports %s as a function", (name) => {
    expect(typeof surface[name]).toBe("function");
  });

  it("has no export that is undefined at run time", () => {
    const empty = Object.keys(surface).filter(
      (key) => surface[key] === undefined
    );
    expect(empty).toEqual([]);
  });

  it("keeps the commands layer private", () => {
    // `run*` command entry points own process.exitCode and stdout; only the
    // ffmpeg primitive shares the prefix.
    const commands = Object.keys(surface).filter(
      (key) => key.startsWith("run") && key !== "runFfmpeg"
    );
    expect(commands).toEqual([]);
  });
});
