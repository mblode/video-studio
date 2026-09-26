import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildSpeechBody,
  DEFAULT_STYLE,
  GEMINI_TTS_MODEL,
  GeminiTtsClient,
} from "./tts.js";

describe("buildSpeechBody", () => {
  it("defaults to Gemini 3.8 Flash TTS and the film VO style", () => {
    const body = buildSpeechBody({ text: "Hello.", voice: "Kore" }) as {
      generation_config: { speech_config: { voice: string }[] };
      input: {
        content: { annotations: { style: string }[]; text: string }[];
      }[];
      model: string;
    };
    expect(body.model).toBe(GEMINI_TTS_MODEL);
    expect(body.generation_config.speech_config).toEqual([{ voice: "Kore" }]);
    const content = body.input[0]?.content[0];
    expect(content?.text).toBe("Hello.");
    expect(content?.annotations[0]?.style).toBe(DEFAULT_STYLE);
  });
});

describe("GeminiTtsClient.textToSpeech", () => {
  it("posts to /interactions and returns MP3 from the WAV in steps", async () => {
    // Half a second of 24 kHz mono silence, the shape the API returns.
    const wav = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "0.5",
      "-f",
      "wav",
      "pipe:1",
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        steps: [
          {
            content: [
              {
                data: wav.toString("base64"),
                mime_type: "audio/wav",
                type: "audio",
              },
            ],
            type: "model_output",
          },
        ],
      })
    );
    const client = new GeminiTtsClient({
      apiKey: "k",
      baseUrl: "https://example.test/v1beta/",
      fetchImpl,
    });

    const mp3 = await client.textToSpeech({ text: "Hi.", voice: "Kore" });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1beta/interactions"
    );
    // ffmpeg's MP3 muxer leads with an ID3v2 tag.
    expect(mp3.subarray(0, 3).toString()).toBe("ID3");
  });

  it("converts headerless L16 PCM at the rate its mime type states", async () => {
    // Half a second of 16 kHz mono s16le silence, with no container header.
    const pcm = Buffer.alloc(16_000);
    const client = new GeminiTtsClient({
      apiKey: "k",
      baseUrl: "https://example.test",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json({
          steps: [
            {
              content: [
                {
                  data: pcm.toString("base64"),
                  mime_type: "audio/L16;codec=pcm;rate=16000",
                  type: "audio",
                },
              ],
            },
          ],
        })
      ),
    });

    const mp3 = await client.textToSpeech({ text: "Hi.", voice: "Kore" });

    expect(mp3.subarray(0, 3).toString()).toBe("ID3");
    const dir = await mkdtemp(join(tmpdir(), "vs-tts-pcm-"));
    const path = join(dir, "out.mp3");
    await writeFile(path, mp3);
    const seconds = Number(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          path,
        ],
        { encoding: "utf-8" }
      ).trim()
    );
    // Read at the wrong rate (24 kHz) it would come out at about 0.33s.
    expect(seconds).toBeGreaterThan(0.45);
    expect(seconds).toBeLessThan(0.6);
  });

  it("points an unanswered request at a narrate re-run, not vs generate", async () => {
    const client = new GeminiTtsClient({
      apiKey: "k",
      baseUrl: "https://example.test",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response("bad gateway", { status: 502 })),
    });
    await expect(
      client.textToSpeech({ text: "Hi.", voice: "Kore" })
    ).rejects.toMatchObject({
      code: "task_uncertain",
      hint: expect.stringContaining("Re-run `vs narrate`"),
    });
  });

  it("fails loudly when the response carries no audio", async () => {
    const client = new GeminiTtsClient({
      apiKey: "k",
      baseUrl: "https://example.test",
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ steps: [] })),
    });
    await expect(
      client.textToSpeech({ text: "Hi.", voice: "Kore" })
    ).rejects.toThrow("no audio content");
  });
});
