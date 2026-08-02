import { describe, expect, it } from "vitest";

import {
  LYRIA_CLIP_MODEL,
  LYRIA_PRO_MODEL,
  buildLyriaRequestBody,
  buildScorePlan,
  composeScorePrompt,
  estimateFilmRuntimeSeconds,
  extensionForAudioMime,
  extractInlineAudio,
} from "./score.js";
import type { ShotsFile } from "./types.js";

describe("estimateFilmRuntimeSeconds", () => {
  it("sums shot and card durations", () => {
    const file: ShotsFile = {
      cards: [
        { after: "start", duration: 3, text: "A" },
        { after: "end", duration: 6, text: "B" },
      ],
      film: { defaults: { duration: 8 }, title: "T" },
      shots: [
        { duration: 10, id: "s1", prompt: "p" },
        { id: "s2", prompt: "p" },
      ],
    };
    expect(estimateFilmRuntimeSeconds(file)).toBe(10 + 8 + 3 + 6);
  });
});

describe("composeScorePrompt", () => {
  it("appends instrumental and duration constraints", () => {
    const prompt = composeScorePrompt("Warm piano bed", 174);
    expect(prompt).toContain("Warm piano bed");
    expect(prompt).toContain("174-second");
    expect(prompt).toMatch(/Instrumental only, no vocals/u);
  });
});

describe("buildScorePlan", () => {
  it("selects Pro by default and Clip with --clip", () => {
    expect(buildScorePlan({ prompt: "x" }).model).toBe(LYRIA_PRO_MODEL);
    expect(buildScorePlan({ clip: true, prompt: "x" }).model).toBe(
      LYRIA_CLIP_MODEL
    );
  });

  it("builds a generateContent body with AUDIO modality", () => {
    const plan = buildScorePlan({ durationSeconds: 60, prompt: "strings" });
    const body = plan.body as {
      generationConfig: { responseModalities: string[] };
    };
    expect(body.generationConfig.responseModalities).toContain("AUDIO");
    expect(buildLyriaRequestBody("hi")).toMatchObject({
      contents: [{ parts: [{ text: "hi" }] }],
    });
  });
});

describe("extractInlineAudio", () => {
  it("reads camelCase inlineData", () => {
    const audio = extractInlineAudio({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "YWJj", mimeType: "audio/mpeg" } }],
          },
        },
      ],
    });
    expect(audio).toEqual({ data: "YWJj", mimeType: "audio/mpeg" });
    expect(extensionForAudioMime("audio/wav")).toBe(".wav");
  });
});
