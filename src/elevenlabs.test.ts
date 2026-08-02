import { describe, expect, it } from "vitest";

import {
  ELEVEN_V3_MODEL,
  buildSpeechBody,
  defaultVoiceSettings,
} from "./elevenlabs.js";

describe("buildSpeechBody", () => {
  it("defaults to eleven_v3 and film VO voice settings", () => {
    const body = buildSpeechBody({
      text: "Hello.",
      voiceId: "abc",
    }) as {
      model_id: string;
      text: string;
      voice_settings: { stability: number };
    };
    expect(body.model_id).toBe(ELEVEN_V3_MODEL);
    expect(body.text).toBe("Hello.");
    expect(body.voice_settings.stability).toBe(
      defaultVoiceSettings().stability
    );
  });
});
