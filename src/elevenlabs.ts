import { VsError } from "./errors.js";
import { ApiError, requestWithRetry, ResponseShapeError } from "./http.js";
import type { SpeechRequest } from "./tts.js";

/**
 * ElevenLabs text-to-speech, the second narration backend.
 *
 * Routed by model id in src/tts.ts (`eleven_*`, or `elevenlabs:<model>`), so
 * `vs narrate` never branches on provider. One POST returns the MP3 bytes
 * directly, already in the line-NN.mp3 format assembly expects, so unlike the
 * Gemini path there is no transcode.
 */

/** Highest-quality ElevenLabs model (Oct 2026); `eleven_v4_turbo` bills half. */
const ELEVENLABS_TTS_MODEL = "eleven_v4";

const MODEL_PREFIX = "elevenlabs:";

/** Name used in error messages, e.g. "ElevenLabs API 401: ...". */
const PROVIDER = "ElevenLabs";

/** The API default, stated so a default change upstream cannot drift a take. */
const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Only the two settings every current model honours. `GET /v1/models` reports
 * `can_use_style: false` and `can_use_speaker_boost: false` for eleven_v3 and
 * eleven_v4, so `style` and `use_speaker_boost` are left at the API defaults
 * rather than sent and ignored. 0.5 is v3's "Natural" stability: lower is more
 * expressive and less repeatable, higher flattens the read.
 */
const VOICE_SETTINGS = { similarity_boost: 0.75, stability: 0.5 };

const NARRATE_RECOVERY_HINT =
  "nothing was retried, because replaying a paid request bills twice; the line may have been billed with no audio returned (check https://elevenlabs.io/app/usage). Re-run `vs narrate`: it keeps every verified line on disk and requests only the missing ones";

export function isElevenLabsModel(model: string): boolean {
  return model.startsWith(MODEL_PREFIX) || model.startsWith("eleven_");
}

function modelId(model: string): string {
  return model.startsWith(MODEL_PREFIX)
    ? model.slice(MODEL_PREFIX.length)
    : model;
}

/**
 * v3 and v4 take direction as inline audio tags, not a separate field: the
 * documented form is a bracketed tag before the text, e.g.
 * `[low, gravelly voice] Twenty of us.` A style already written as tags is
 * passed through verbatim.
 */
function directedText(text: string, style: string | undefined): string {
  const direction = style?.trim();
  if (!direction) {
    return text;
  }
  return direction.startsWith("[")
    ? `${direction} ${text}`
    : `[${direction}] ${text}`;
}

/** The JSON body. The voice id rides in the URL, and the sidecar records it. */
export function buildElevenLabsSpeechBody(request: SpeechRequest): unknown {
  return {
    model_id: modelId(request.model ?? ELEVENLABS_TTS_MODEL),
    text: directedText(request.text, request.style),
    voice_settings: VOICE_SETTINGS,
  };
}

/**
 * The two failures that read alike as a bare status: a rejected key and a
 * voice the account cannot use. A Voice Library voice must be added to the
 * account (`POST /v1/voices/add/{public_owner_id}/{voice_id}`) before its id
 * works here.
 */
function explain(error: unknown, voice: string): unknown {
  if (!(error instanceof ApiError)) {
    return error;
  }
  if (error.status === 401) {
    return new VsError("missing_credential", error.message, {
      cause: error,
      hint: "ELEVENLABS_API_KEY was rejected; check the key in .env (and that it has text-to-speech permission), then re-run `vs doctor`",
    });
  }
  if (
    error.status === 404 ||
    /voice_not_found|voice.{0,40}(?:not found|does not exist)/iu.test(
      error.message
    )
  ) {
    return new VsError("unknown_id", `ElevenLabs voice "${voice}" not found`, {
      cause: error,
      hint: "pass a voice_id from `GET /v1/voices`; a Voice Library voice must first be added to your account (Voice Library, Add to my voices)",
    });
  }
  return error;
}

export class ElevenLabsTtsClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    fetchImpl: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.base = options.baseUrl.replace(/\/$/u, "");
    this.fetchImpl = options.fetchImpl;
  }

  /** Synthesize one utterance; returns MP3 bytes. */
  async textToSpeech(request: SpeechRequest): Promise<Buffer> {
    let response: Response;
    try {
      response = await requestWithRetry({
        body: buildElevenLabsSpeechBody(request),
        fetchImpl: this.fetchImpl,
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        method: "POST",
        provider: PROVIDER,
        recoveryHint: NARRATE_RECOVERY_HINT,
        url: `${this.base}/v1/text-to-speech/${encodeURIComponent(request.voice)}?output_format=${OUTPUT_FORMAT}`,
        what: "textToSpeech",
      });
    } catch (error) {
      throw explain(error, request.voice);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) {
      throw new ResponseShapeError(
        PROVIDER,
        "textToSpeech",
        ["empty audio body"],
        ""
      );
    }
    return audio;
  }
}
