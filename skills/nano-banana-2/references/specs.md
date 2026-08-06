# Model specs and API config

Tech specs as of the Gemini 3 image release. Always check the official `gemini-3.1-flash-image` and `gemini-3-pro-image` docs for the latest. This skill ships no API key and runs nothing: the snippets below are reference for whoever wires up the call.

## Model ids

| Name                 | Model id                 | Use it for                                                          |
| -------------------- | ------------------------ | ------------------------------------------------------------------- |
| Nano Banana 2        | `gemini-3.1-flash-image` | Default. Speed, high volume, best intelligence-to-cost balance      |
| Nano Banana Pro      | `gemini-3-pro-image`     | Professional asset production, hardest multi-step prompts, up to 4K |
| Nano Banana (legacy) | `gemini-2.5-flash-image` | Fast, cheap, 1024px, up to 3 input images                           |

## Capability limits

|                        | Nano Banana 2 (Flash)      | Nano Banana Pro            |
| ---------------------- | -------------------------- | -------------------------- |
| Input context          | 131,072 tokens             | 65,536 tokens              |
| Output context         | 32,768 tokens              | 32,768 tokens              |
| Reference images total | 14                         | 14                         |
| High-fidelity objects  | up to 10                   | up to 6                    |
| Character resemblance  | up to 4                    | up to 5                    |
| Style references       | none                       | up to 3                    |
| Legible in-frame text  | good                       | best available             |
| Resolutions            | 0.5K, 1K, 2K, 4K           | 1K, 2K, 4K                 |
| Video input            | yes (video-to-image)       | no                         |
| Knowledge cutoff       | Jan 2025 + live web search | Jan 2025 + live web search |

Supported input MIME types: `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`. Document input: text and PDF, up to 50 MB per file (API / Cloud Storage) or 7 MB via direct console upload.

## Aspect ratios

Both Gemini 3 models: `1:1`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`.

Nano Banana 2 (Flash) also adds the extreme ratios: `1:4`, `4:1`, `1:8`, `8:1`.

## Resolution sizing

Set `imageSize` to one of `1K`, `2K`, `4K`, or `512` (Flash only, the 0.5K tier). The `K` must be uppercase. `512` has no suffix. Lowercase (`1k`) is rejected. Default is 1K; if you provide input images and set nothing, output matches the input size, otherwise a 1:1 square.

Token cost scales with resolution tier, not just pixels (e.g. 1:1 is 747 / 1120 / 1680 / 2520 tokens at 0.5K / 1K / 2K / 4K).

## Minimal API config (JavaScript, @google/genai)

Image only, no text part:

```js
const response = await ai.models.generateContent({
  model: "gemini-3.1-flash-image",
  contents: prompt,
  config: { responseModalities: ["Image"] },
});
```

Aspect ratio and resolution:

```js
config: {
  responseModalities: ["Image"],
  responseFormat: { image: { aspectRatio: "16:9", imageSize: "2K" } },
}
```

Thinking level (Flash only, default `minimal`):

```js
config: {
  responseModalities: ["Image"],
  thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
}
```

Thinking tokens are billed whether or not `includeThoughts` is true. Thinking is always on for Gemini 3 and cannot be disabled.

Web-search grounding:

```js
config: {
  responseModalities: ["Image"],
  tools: [{ googleSearch: {} }],
}
```

Image-search grounding (Flash only):

```js
tools: [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }];
```

Grounded responses return `groundingMetadata` (`searchEntryPoint`, `groundingChunks`, and for image search `imageSearchQueries` plus image chunks with `uri` landing page and `image_uri`). If you display image-search results, link to the source webpage with a direct single-click path.

## Multi-turn note

Image parts and the first non-thought text part carry an encrypted `thought_signature`. Pass it back unchanged in the next turn's history or the request can fail. The official SDK chat helper (`ai.chats.create`) manages signatures automatically, so prefer it for iterative editing.

## Batch and Imagen

For large volumes, the Batch API gives higher rate limits with up to 24-hour turnaround. For a dedicated image model rather than Gemini's native generation, Imagen 4 is also available through the Gemini API (Imagen 4 Ultra for top quality, one image at a time).
