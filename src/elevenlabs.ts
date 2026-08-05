import { VsError } from "./errors.js";
import { requestWithRetry } from "./http.js";

/** Best expressive model for film narration (Aug 2026). */
export const ELEVEN_V3_MODEL = "eleven_v3";
/** Stable long-form fallback when retake consistency matters more than drama. */
export const ELEVEN_MULTILINGUAL_V2_MODEL = "eleven_multilingual_v2";

export const DEFAULT_ELEVEN_BASE_URL = "https://api.elevenlabs.io";

/** Name used in error messages, e.g. "ElevenLabs API 401: ...". */
const PROVIDER = "ElevenLabs";

export interface ElevenLabsSpeechRequest {
  text: string;
  voiceId: string;
  modelId?: string;
  /** Query `output_format`; default mp3_44100_128. */
  outputFormat?: string;
  previousText?: string;
  nextText?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    speed?: number;
    use_speaker_boost?: boolean;
  };
}

/** Historical name for the shared provider error; same class, not a subclass. */
export { ApiError as ElevenLabsApiError } from "./http.js";

/** Default film-VO settings: warm, slightly slow, speaker-boosted. */
export function defaultVoiceSettings(): NonNullable<
  ElevenLabsSpeechRequest["voiceSettings"]
> {
  return {
    similarity_boost: 0.75,
    speed: 0.95,
    stability: 0.5,
    style: 0,
    use_speaker_boost: true,
  };
}

export function buildSpeechBody(request: ElevenLabsSpeechRequest): unknown {
  return {
    model_id: request.modelId ?? ELEVEN_V3_MODEL,
    text: request.text,
    voice_settings: request.voiceSettings ?? defaultVoiceSettings(),
    ...(request.previousText
      ? { previous_text: request.previousText }
      : undefined),
    ...(request.nextText ? { next_text: request.nextText } : undefined),
  };
}

export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.base = (options.baseUrl ?? DEFAULT_ELEVEN_BASE_URL).replace(
      /\/$/u,
      ""
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Synthesize one utterance; returns MP3 (or chosen format) bytes. */
  async textToSpeech(request: ElevenLabsSpeechRequest): Promise<Buffer> {
    const format = request.outputFormat ?? "mp3_44100_128";
    const url = new URL(
      `${this.base}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}`
    );
    url.searchParams.set("output_format", format);
    const body = buildSpeechBody(request);

    // Audio bytes, not JSON, which is exactly why the shared helper returns a
    // Response rather than a parsed body.
    const response = await requestWithRetry({
      body,
      fetchImpl: this.fetchImpl,
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      method: "POST",
      provider: PROVIDER,
      url: url.toString(),
    });
    return Buffer.from(await response.arrayBuffer());
  }
}

export function requireElevenLabsApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.XI_API_KEY;
  if (!key) {
    throw new VsError("missing_credential", "ELEVENLABS_API_KEY is not set", {
      hint: "add `ELEVENLABS_API_KEY=...` to .env (see .env.example) for vs narrate",
    });
  }
  return key;
}

export function requireElevenLabsVoiceId(explicit?: string): string {
  const voiceId = explicit ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new VsError(
      "invalid_input",
      "no ElevenLabs voice id — pass --voice or set ELEVENLABS_VOICE_ID",
      {
        hint: "pick a voice in the ElevenLabs Voice Library and copy its id",
      }
    );
  }
  return voiceId;
}
