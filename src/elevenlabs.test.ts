import { describe, expect, it, vi } from "vitest";

import { ElevenLabsTtsClient } from "./elevenlabs.js";
import { buildSpeechBody, speechProvider } from "./tts.js";

describe("ElevenLabs routing", () => {
  it("routes eleven_* and elevenlabs: ids, and leaves Gemini alone", () => {
    expect(speechProvider("eleven_v4")).toBe("elevenlabs");
    expect(speechProvider("elevenlabs:eleven_v4_turbo")).toBe("elevenlabs");
    expect(speechProvider("gemini-3.8-flash-tts")).toBe("gemini");
  });

  it("sends --style as a leading audio tag and strips the prefix", () => {
    expect(
      buildSpeechBody({
        model: "elevenlabs:eleven_v4",
        style: "gravelly drawl",
        text: "Then Matt broke it.",
        voice: "abc",
      })
    ).toEqual({
      model_id: "eleven_v4",
      text: "[gravelly drawl] Then Matt broke it.",
      voice_settings: { similarity_boost: 0.75, stability: 0.5 },
    });
  });
});

function replying(status: number): ElevenLabsTtsClient {
  return new ElevenLabsTtsClient({
    apiKey: "k",
    baseUrl: "https://api.example",
    fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status })),
  });
}

describe("ElevenLabsTtsClient.textToSpeech", () => {
  const request = { model: "eleven_v4", text: "Hi.", voice: "v1" };

  it("posts to the voice's URL and returns the MP3 bytes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const client = new ElevenLabsTtsClient({
      apiKey: "k",
      baseUrl: "https://api.example/",
      fetchImpl,
    });
    const audio = await client.textToSpeech(request);
    expect([...audio]).toEqual([1, 2, 3]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.example/v1/text-to-speech/v1?output_format=mp3_44100_128"
    );
  });

  it("names the key on a 401 and the voice on a 404", async () => {
    await expect(replying(401).textToSpeech(request)).rejects.toMatchObject({
      code: "missing_credential",
    });
    await expect(replying(404).textToSpeech(request)).rejects.toMatchObject({
      code: "unknown_id",
    });
  });
});
