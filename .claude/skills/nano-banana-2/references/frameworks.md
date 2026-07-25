# Prompting frameworks

The prompt structure depends on the operation. Start with a strong verb, pick the framework that matches the task, fill the formula, then refine with the creative-direction controls.

## 1. Text-to-image (no references)

A blank canvas. You are the director, so describe the scene narratively. A keyword list will not cut it.

**Formula:** `[Subject] + [Action] + [Location/context] + [Composition] + [Style]`

**Example:**

> [Subject] A striking fashion model wearing a tailored brown dress and sleek heeled shoes, holding a structured handbag. [Action] Posing with a confident, statuesque stance, slightly turned. [Location/context] A seamless, deep cherry red studio backdrop. [Composition] Medium-full shot, center-framed. [Style] Fashion magazine editorial, shot on medium-format analog film, pronounced grain, high saturation, cinematic lighting.

Each bracketed role is a place to be specific. The richer the Subject and Style, the more control you keep.

## 2. Multimodal generation (with references)

Combine one or more reference images to guide the output. Best for character consistency, putting a product into a new environment, or merging a sketch with a texture.

**Formula:** `[Reference images] + [Relationship instruction] + [New scenario]`

**Example:**

> Using the attached napkin sketch as the structure and the attached fabric sample as the texture [references], transform this into a high-fidelity 3D armchair render [relationship]. Place it in a sun-drenched, minimalist living room [new scenario].

The Relationship instruction is the load-bearing part: say exactly how each reference should be used (as structure, as texture, as the character whose face must stay identical).

## 3. Image editing

You already have a base image. The prompt focuses on what changes and what stays exactly the same.

### Conversational editing / semantic masking (no new references)

Define a "mask" in words to edit one region while leaving the rest untouched. Be explicit about what to keep.

**Example (remove):**

> Remove the man from the photo.

**Example (inpaint, keep everything else):**

> Change only the blue sofa to a vintage brown leather Chesterfield. Keep the rest of the room, including the pillows and the lighting, unchanged.

For preserving a critical detail (a face, a logo) through an edit, describe it in detail alongside the change so the model knows to hold it: "Ensure the woman's face and features remain completely unchanged."

### Composition and style transfer (with new references)

- **Add an element:** upload a base image plus an object image and tell the model to combine them, matching the base image's lighting and perspective.
- **Style transfer:** upload a photo and ask the model to recreate its exact content in a different style. "Transform this modern city street at night into the style of Van Gogh's Starry Night. Preserve the composition of buildings and cars, but render every element in swirling, impasto brushstrokes with deep blues and bright yellows."

## 4. Web-search grounding

The Gemini 3 models can search the web and generate from real-time data: weather, stock charts, recent events. Instead of describing a fictional scene, instruct the model to retrieve real data and then say how to visualize it. (Image-based search results are not passed through to the generator and are excluded from the response.)

**Formula:** `[Source/Search request] + [Analytical task] + [Visual translation]`

**Example:**

> Search for the current weather and date in San Francisco. Use that data to set the mood (if it is raining, make the scene grey and wet). Visualize it as a miniature city-in-a-cup concept embedded within a realistic modern smartphone UI.

Nano Banana 2 also supports Image Search grounding (using web images as visual context). If you display those results you must link to the source webpage with a direct, single-click path. Image search cannot be used to find real people.

## 5. Text rendering and localization

Nano Banana 2 and Pro render sharp, legible text and translate into 10+ languages. Rules:

- **Quote the words.** Enclose the exact text: "Happy Birthday", "URBAN EXPLORER".
- **Name the font.** Describe the typography or name it: "bold white sans-serif", "Century Gothic 12px", "flowing elegant Brush Script", "heavy blocky Impact".
- **Translate and localize.** Write the prompt in one language and specify a target language for the rendered text.
- **Text-first hack.** Generate or settle the exact text conversationally first, then ask for the image containing it.

**Example:**

> A high-end glossy beauty shot of a sleek minimalist nude-colored moisturizer jar on a warm studio background, soft radiant lighting. Next to the product, render three lines: top line "GLOW" in a flowing elegant Brush Script; middle line "10% OFF" in heavy blocky Impact; bottom line "Your First Order" in a thin minimalist Century Gothic. Then translate the text into Korean and Arabic.

**Text as a window** (a strong pattern):

> A typographic poster with a solid black background. Bold letters spell "New York", filling the center of the frame. The text is a cut-out window: a photograph of the New York skyline is visible ONLY inside the letterforms.
