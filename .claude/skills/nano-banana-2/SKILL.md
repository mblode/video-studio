---
name: nano-banana-2
description: Crafts effective prompts for Google's Nano Banana image models (Gemini 3 family) for generation and editing. Covers the five prompting frameworks, creative-director controls (lighting, lens, color grading, materiality), text rendering, web-search grounding, and the model specs. Use when the user says "Nano Banana", "Nano Banana 2", "Nano Banana Pro", "Gemini image generation", "gemini-3.1-flash-image", "gemini-3-pro-image", "write me an image prompt", "image editing prompt", "render text in an image", "product mockup prompt", "poster prompt", "storyboard batch", "keyframe with text in it", or wants help directing a Gemini-generated still image. For assembling a film's stills.json/shots.json use seedance; to run the generation use vs.
---

# Nano Banana 2

Help the user write prompts that get the image they pictured out of Google's Nano Banana models (Gemini 3 family). The models apply deep reasoning to a prompt before they render, so a narrative, well-directed prompt beats a keyword list almost every time.

- **IS:** prompt craft for Gemini 3 image generation and editing. Picking the right framework, structuring the prompt, and dialing in lighting, camera, color, text, and references.
- **IS NOT:** video prompts of any kind (Seedance video prompts are `seedance`), and not the structure or schema of a film's `stills.json` / `shots.json` (also `seedance`).

This repo can generate stills with Nano Banana: set the stills file's top-level `model` to a `gemini-*` id and `vs stills` routes to the Gemini image API (needs `GEMINI_API_KEY`). Write the still prompt with the frameworks here, place it in `stills.json` per `seedance`, then run it with `vs`. The frameworks also stand alone for any one-off Gemini image (posters, mockups, marketing).

Read `references/frameworks.md` before writing any prompt: pick the framework that matches the task. Read `references/creative-direction.md` to elevate a working prompt to studio quality. Read `references/specs.md` for model ids, aspect ratios, resolutions, limits, and API config.

## The models

Three models share the Nano Banana name. Default to Nano Banana 2.

- **Nano Banana 2** = `gemini-3.1-flash-image`. The go-to: best balance of intelligence, cost, and latency. High-volume friendly, which makes it the storyboard-batch model. Adds 0.5K resolution, extreme aspect ratios (1:4, 4:1, 1:8, 8:1), Google Image Search grounding, video-to-image, and a tunable thinking level. Up to 10 high-fidelity objects and 4 characters; no style references.
- **Nano Banana Pro** = `gemini-3-pro-image`. Professional asset production and the hardest, most complex instructions. Up to 6 high-fidelity objects, 5 characters, and 3 style references (14 reference images total), deeper default thinking, up to 4K. **The best available model for legible in-frame text**, which is why any film keyframe carrying signage comes from Pro.
- **Nano Banana** (legacy) = `gemini-2.5-flash-image`. Fast and cheap, 1024px, best with up to 3 input images. Use only when speed and volume beat quality.

Both Gemini 3 models have a Jan 2025 knowledge cutoff and augment it with live web search. All output carries a SynthID watermark and C2PA Content Credentials.

## The four levers

1. **Describe the scene, do not list keywords.** A narrative paragraph that names subject, action, setting, composition, and style produces a more coherent image than disconnected words.
2. **Start with a strong verb that names the operation.** "Create", "Edit", "Remove", "Transform", "Render". It tells the model the primary thing you want done.
3. **Frame positively, never negatively.** There is no negative prompt. Describe the desired state: "an empty, deserted street" beats "no cars". "no X" phrasing is unreliable.
4. **Control the camera and iterate.** Use photographic and cinematic terms (low angle, wide-angle, golden hour), then refine conversationally ("warmer light", "more serious expression") rather than rewriting from scratch.

## Pick a framework

Match the task to a framework, then open `references/frameworks.md` for its formula and a worked example.

| Task                                         | Framework                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| New image from text only                     | Text-to-image: `[Subject] + [Action] + [Location/context] + [Composition] + [Style]`       |
| New image guided by reference images         | Multimodal: `[Reference images] + [Relationship instruction] + [New scenario]`             |
| Tweak an existing image, nothing new added   | Conversational editing / semantic masking (inpainting)                                     |
| Merge an object in, or restyle a whole image | Composition and style transfer (with new references)                                       |
| Image driven by real-time / real-world facts | Web-search grounding: `[Source/Search request] + [Analytical task] + [Visual translation]` |
| Legible text, logos, posters, localization   | Text rendering and localization (quote the words, name the font)                           |

## Gotchas

- **No negative prompts.** Describe what you want present, not what you want gone.
- **Text-first hack.** When the image must contain specific words, generate or settle the exact text conversationally FIRST, then ask for the image with that text. The model renders text it has already "written" far more reliably.
- **Quote literal text and name the font.** Enclose the words in quotes ("URBAN EXPLORER") and describe the typography ("bold white sans-serif", "flowing Brush Script"). The model excels at sharp multilingual text in 10+ languages when directed this way.
- **Reference image budget.** Up to 14 images, but the object-vs-character split differs by model (see The models). More references is not always better: prioritise style, then character, then environment.
- **Image count is not guaranteed.** The model will not always return the exact number of images you ask for.
- **Watermark is always present.** SynthID + C2PA on every output; you cannot disable it.
- **Multi-turn needs thought signatures.** Image and first-text parts carry an encrypted `thought_signature`; pass it back unchanged on the next turn or the response can fail. The official SDK chat helper handles this automatically, so prefer the chat API for iterative editing.
- **Thinking is always on (Gemini 3), and always billed.** It cannot be disabled, and its tokens are charged even when you hide the interim thought images. Set `thinking_level: "minimal"` for **storyboard batches**, where you are generating many similar keyframes and paying for reasoning depth on each one is waste; save `high` for the single hard frame.

## Reference files

| File                               | Read when                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `references/frameworks.md`         | Writing any prompt. The five frameworks with formulas and worked examples                  |
| `references/creative-direction.md` | Elevating a prompt: lighting, camera/lens, color grading, materiality, plus stock patterns |
| `references/specs.md`              | Choosing a model, aspect ratio, or resolution, or wiring up the API config                 |

## Related skills

- `seedance` to place a Nano Banana still prompt into a film's `stills.json`.
- `vs` to run `vs stills` once the stills file's `model` is a `gemini-*` id.
