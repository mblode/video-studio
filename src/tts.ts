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

// The audio is a base64 WAV (24 kHz mono s16le) inside `steps[].content[]`.
const interactionSchema = z.object({
  steps: z.array(
    z.object({
      content: z
        .array(z.object({ data: z.string().optional(), type: z.string() }))
        .optional(),
    })
  ),
});

/** Keep the line-NN.mp3 contract `narrate assemble` and films rely on. */
async function wavToMp3(wav: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "vs-tts-"));
  try {
    const input = join(dir, "in.wav");
    const output = join(dir, "out.mp3");
    await writeFile(input, wav);
    await runFfmpeg([
      "-y",
      "-v",
      "error",
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
      schema: interactionSchema,
      url: `${this.base}/interactions`,
      what: "textToSpeech",
    });
    const data = json.steps
      .flatMap((step) => step.content ?? [])
      .find((part) => part.type === "audio" && part.data)?.data;
    if (!data) {
      throw new ResponseShapeError(
        PROVIDER,
        "textToSpeech",
        ["no audio content in steps"],
        json
      );
    }
    return await wavToMp3(Buffer.from(data, "base64"));
  }
}

export function resolveVoice(explicit?: string): string {
  return explicit ?? process.env.GEMINI_TTS_VOICE ?? DEFAULT_VOICE;
}
