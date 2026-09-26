import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

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

export function buildSpeechBody(request: SpeechRequest): unknown {
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
    this.fetchImpl = options.fetchImpl ?? fetch;
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

export function resolveVoice(explicit?: string): string {
  return explicit ?? process.env.GEMINI_TTS_VOICE ?? DEFAULT_VOICE;
}
