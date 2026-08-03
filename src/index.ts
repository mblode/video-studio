/**
 * The public API.
 *
 * Everything here is a pure planner, a primitive, a client, or a type. The
 * `commands/` layer is deliberately NOT exported: those functions own
 * `process.exitCode` and write to stdout, which is the CLI's job, not a
 * library's.
 *
 * Note the shape of the type re-export below. `export type * from "./types.js"`
 * silently turns runtime constants into type-only exports, which typecheck at
 * the call site and are `undefined` at run time; a plain `export *` carries
 * both, and picks up new constants without a second list to keep in sync.
 */
export * from "./types.js";
export {
  ANIMATIC_FPS,
  ANIMATIC_SHORT_SIDE,
  normalizeClipArgs,
  pickShotStill,
  shotDuration,
  stillSegmentArgs,
  targetDimensions,
} from "./animatic.js";
export type { Dimensions } from "./animatic.js";
export {
  ArkApiError,
  ArkClient,
  ArkResponseError,
  IMAGES_PATH,
  TASKS_PATH,
} from "./ark.js";
export type { PollOptions } from "./ark.js";
export {
  cardSvg,
  cardVideoArgs,
  fontIsAvailable,
  renderCardPng,
  wrapCardText,
} from "./cards.js";
export {
  checkCostCeiling,
  clipTokens,
  estimateClip,
  estimateClips,
  estimateCostUsd,
  estimateTokens,
  formatEstimate,
  frameSize,
  reconcileTokens,
  usdForTokens,
  videoTokens,
} from "./cost.js";
export type {
  ClipSpec,
  CostCeilingResult,
  CostEstimate,
  FrameSize,
  Reconciliation,
} from "./cost.js";
export { downloadFile } from "./download.js";
export {
  baseUrl,
  DEFAULT_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  findEnvFile,
  geminiBaseUrl,
  loadEnv,
  requireApiKey,
  requireGeminiApiKey,
} from "./env.js";
export {
  apiHint,
  formatError,
  isVsError,
  VS_ERROR_CODES,
  VsError,
} from "./errors.js";
export type { FormattedError, VsErrorCode, VsErrorOptions } from "./errors.js";
export {
  assertBinary,
  assertFfmpeg,
  escapeDrawtext,
  frameAtArgs,
  probeClip,
  runFfmpeg,
  summarizeFfmpegStderr,
} from "./ffmpeg.js";
export type { ClipProbe } from "./ffmpeg.js";
export {
  buildGeminiRequestBody,
  DEFAULT_GEMINI_IMAGE_MODEL,
  extractInlineImage,
  GEMINI_PRO_IMAGE_MODEL,
  GeminiApiError,
  GeminiClient,
  isGeminiModel,
  resolveInlineImage,
} from "./gemini.js";
export type { GeminiImageRequest, GeminiInlineImage } from "./gemini.js";
export {
  isComplete,
  isInFlight,
  isRevisionComplete,
  latestRevision,
  loadManifest,
  manifestPath,
  saveManifest,
  selectedRevision,
  upsertEntry,
} from "./manifest.js";
export type { EntryUpdate } from "./manifest.js";
export {
  isKnownModel,
  lookupModel,
  MODEL_IDS,
  MODEL_REGISTRY,
  modelRateLimits,
  normalizeModelId,
  usdPerMToken,
  validateShotAgainstModel,
} from "./models.js";
export type {
  Billing,
  CapabilityProblem,
  DurationSupport,
  ModelCapabilities,
  RateLimits,
  ShotCapabilityInput,
} from "./models.js";
export {
  isLocalPathSafe,
  passSuffix,
  resolveOutput,
  safeJoin,
} from "./paths.js";
export type { Pass } from "./paths.js";
export {
  buildTaskPayload,
  DEFAULT_VIDEO_MODEL,
  DRAFT_VIDEO_MODEL,
  effectiveShotParams,
  hashPayload,
  referenceCountsByType,
  referenceOrdinals,
  renderPayload,
  resolveReferenceUrl,
} from "./payload.js";
export type { EffectiveShotParams, PayloadOverrides } from "./payload.js";
export { createModelLimiter, MockVideoProvider } from "./provider.js";
export type {
  ModelLimiter,
  MockProviderOptions,
  VideoProvider,
} from "./provider.js";
export { frameTimestamps, probeWarnings, renderIndexMd } from "./review.js";
export type { ProbeSummary, ReviewRow } from "./review.js";
export { buildSharePlan } from "./share.js";
export type { SharePlan, SharePlanInput } from "./share.js";
export {
  lintShotsFile,
  lintStillsFile,
  loadShotsFile,
  loadStillsFile,
} from "./shots.js";
export {
  buildStitchPlan,
  computeXfadeOffsets,
  concatListContent,
  orderTimeline,
} from "./stitch.js";
export type {
  StitchClip,
  StitchOptions,
  StitchPlan,
  StitchStep,
} from "./stitch.js";
export { buildUpscalePlan } from "./upscale.js";
export type { UpscalePlan, UpscalePlanInput } from "./upscale.js";
export {
  assertNewVideoOutput,
  clipRevisionPath,
  nextExportPath,
  nextRenderPath,
  versionLabel,
} from "./versions.js";
