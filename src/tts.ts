import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import {
  buildElevenLabsSpeechBody,
  ElevenLabsTtsClient,
  isElevenLabsModel,
} from "./elevenlabs.js";
import {
  elevenLabsBaseUrl,
  geminiBaseUrl,
  loadEnv,
  requireElevenLabsApiKey,
  requireGeminiApiKey,
} from "./env.js";
import { VsError } from "./errors.js";
import { runFfmpeg } from "./ffmpeg.js";
import { requestJson, ResponseShapeError } from "./http.js";

/** Highest-fidelity Gemini speech model (Sep 2026). */
export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";

/** A prebuilt voice; any id from `GET /v1beta/voices` works too. */
const DEFAULT_VOICE = "Charon";

/** Sustained delivery direction for film VO: warm, slightly slow. */
export const DEFAULT_STYLE =
  "warm, unhurried documentary narration; measured pace, clear diction";

/** Name used in error messages, e.g. "Gemini API 401: ...". */
const PROVIDER = "Gemini";

/** A narration line has no task id to adopt, so recovery is a re-run. */
const NARRATE_RECOVERY_HINT =
  "nothing was retried, because replaying a paid request bills twice; the line may have been billed with no audio returned. Re-run `vs narrate`: it keeps every verified line on disk and requests only the missing ones";

export interface SpeechRequest {
  text: string;
  voice: string;
  model?: string;
  style?: string;
}

function buildGeminiSpeechBody(request: SpeechRequest): unknown {
  return {
    generation_config: { speech_config: [{ voice: request.voice }] },
    input: [
      {
        content: [
          {
            annotations: [
              {
                style: request.style ?? DEFAULT_STYLE,
                type: "speech_metadata",
              },
            ],
            text: request.text,
            type: "text",
          },
        ],
        type: "user_input",
      },
    ],
    model: request.model ?? GEMINI_TTS_MODEL,
    response_format: { type: "audio" },
  };
}

/** Which backend a narration model id runs on; recorded in each sidecar. */
export function speechProvider(model: string): "elevenlabs" | "gemini" {
  return isElevenLabsModel(model) ? "elevenlabs" : "gemini";
}

/** The exact JSON body a request sends, for dry runs and the sidecar hash. */
export function buildSpeechBody(request: SpeechRequest): unknown {
  return speechProvider(request.model ?? GEMINI_TTS_MODEL) === "elevenlabs"
    ? buildElevenLabsSpeechBody(request)
    : buildGeminiSpeechBody(request);
}

// The audio is base64 inside `steps[].content[]`: a WAV today, but the
// generateContent route returns headerless PCM (`audio/L16;codec=pcm;rate=24000`),
// so the mime type decides how ffmpeg reads it.
const interactionSchema = z.object({
  steps: z.array(
    z.object({
      content: z
        .array(
          z.object({
            data: z.string().optional(),
            mime_type: z.string().optional(),
            type: z.string(),
          })
        )
        .optional(),
    })
  ),
});

/** Gemini's documented PCM rate, used when the mime type omits `rate=`. */
const DEFAULT_PCM_RATE = 24_000;

/**
 * ffmpeg input flags for a response mime type. Raw PCM has no header, so the
 * sample format, rate and channel count must be stated or ffmpeg cannot probe
 * it; anything else (WAV, or no mime type at all) carries its own header.
 */
function pcmInputArgs(mimeType: string | undefined): string[] {
  const mime = (mimeType ?? "").toLowerCase();
  if (!/^audio\/(?:l16|pcm)\b/u.test(mime)) {
    return [];
  }
  const rate = Number(
    /\brate=(?<rate>\d+)/u.exec(mime)?.groups?.rate ?? DEFAULT_PCM_RATE
  );
  return ["-f", "s16le", "-ar", String(rate), "-ac", "1"];
}

/** Keep the line-NN.mp3 contract `narrate assemble` and films rely on. */
async function audioToMp3(
  audio: Buffer,
  mimeType: string | undefined
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "vs-tts-"));
  try {
    const inputArgs = pcmInputArgs(mimeType);
    const input = join(dir, inputArgs.length > 0 ? "in.pcm" : "in.wav");
    const output = join(dir, "out.mp3");
    await writeFile(input, audio);
    await runFfmpeg([
      "-y",
      "-v",
      "error",
      ...inputArgs,
      "-i",
      input,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

/**
 * A TTS request the server never answers would otherwise hang `vs narrate`
 * forever, which it did mid-script on Sedona. A line is a few seconds of
 * audio, so two minutes is far past any real response.
 */
const TTS_TIMEOUT_MS = 120_000;

const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

export class GeminiTtsClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.base = options.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = options.fetchImpl ?? fetchWithTimeout;
  }

  /** Synthesize one utterance; returns MP3 bytes. */
  async textToSpeech(request: SpeechRequest): Promise<Buffer> {
    const json = await requestJson({
      body: buildSpeechBody(request),
      fetchImpl: this.fetchImpl,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      method: "POST",
      provider: PROVIDER,
      recoveryHint: NARRATE_RECOVERY_HINT,
      schema: interactionSchema,
      url: `${this.base}/interactions`,
      what: "textToSpeech",
    });
    const part = json.steps
      .flatMap((step) => step.content ?? [])
      .find((candidate) => candidate.type === "audio" && candidate.data);
    if (!part?.data) {
      throw new ResponseShapeError(
        PROVIDER,
        "textToSpeech",
        ["no audio content in steps"],
        json
      );
    }
    return await audioToMp3(Buffer.from(part.data, "base64"), part.mime_type);
  }
}

/** What `vs narrate` calls; each backend returns MP3 bytes. */
export interface TtsClient {
  textToSpeech: (request: SpeechRequest) => Promise<Buffer>;
}

/**
 * The one place a narration model id picks a backend, mirroring
 * `resolveImageModel` in src/images.ts. Adding a provider is a branch here and
 * one adapter file; the narrate command only ever sees `TtsClient`.
 */
export function createTtsClient(model: string): TtsClient {
  loadEnv();
  if (speechProvider(model) === "elevenlabs") {
    return new ElevenLabsTtsClient({
      apiKey: requireElevenLabsApiKey(),
      baseUrl: elevenLabsBaseUrl(),
      fetchImpl: fetchWithTimeout,
    });
  }
  return new GeminiTtsClient({
    apiKey: requireGeminiApiKey(),
    baseUrl: geminiBaseUrl(),
  });
}

/**
 * ElevenLabs voices are opaque per-account ids with no sensible default, so
 * one must be named; Gemini falls back to a prebuilt voice.
 */
export function resolveVoice(model: string, explicit?: string): string {
  if (speechProvider(model) === "gemini") {
    return explicit ?? process.env.GEMINI_TTS_VOICE ?? DEFAULT_VOICE;
  }
  const voice = explicit ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voice) {
    throw new VsError("invalid_input", `${model} needs a voice id`, {
      hint: "pass --voice <voice_id> (from `GET /v1/voices`), or set ELEVENLABS_VOICE_ID",
    });
  }
  return voice;
}
