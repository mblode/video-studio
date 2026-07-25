# Prompt like a Creative Director

Once a prompt works, these controls take it from good to breathtaking. Stop typing keywords and start directing the scene: lighting, camera, color, and material are studio-quality levers the Gemini 3 models respond to precisely.

## 1. Design the lighting

Tell the model exactly how the scene is lit.

- **Studio setups:** "three-point softbox setup" for even, diffused product light with soft highlights and no harsh shadows.
- **Dramatic effects:** "chiaroscuro lighting, harsh, high contrast", "golden-hour backlighting creating long shadows", "soft diffused light from the top left".

## 2. Choose camera, lens, and focus

Use specific hardware and photographic terms to control depth, distortion, and perspective.

- **Hardware (changes the visual DNA):** shot on a GoPro for an immersive, distorted action feel; a Fujifilm camera for authentic color science; a cheap disposable camera for a raw, nostalgic flash aesthetic; an 85mm portrait lens for flattering compression and bokeh.
- **Lens and focus:** "low-angle shot with shallow depth of field (f/1.8)", "wide-angle lens" for vast scale, "macro lens" for intricate detail.

## 3. Color grading and film stock

Texture and color set the emotional tone.

- Nostalgic or gritty: "as if shot on 1980s color film, slightly grainy".
- Modern and moody: "cinematic color grading with muted teal tones".

## 4. Materiality and texture

For logos, products, and characters, define the physical makeup. Do not ask for "a suit jacket"; ask for "navy blue tweed". Not "armor" but "ornate elven plate armor, etched with silver leaf patterns". For mockups, specify the surface: "minimalist matte-black ceramic coffee mug".

## Stock prompt patterns

Reusable shapes from the API prompting guide.

- **Photorealistic portrait:** name camera angle, lens, lighting, and fine detail. "A close-up portrait of an elderly Japanese ceramicist with deep sun-etched wrinkles, inspecting a freshly glazed tea bowl, soft golden-hour light through a window, 85mm lens, blurred background (bokeh), serene mood, vertical orientation."
- **Sticker / icon / asset:** be explicit about style and request a white background (transparent is not supported). "A kawaii-style sticker of a happy red panda in a tiny bamboo hat, bold clean outlines, simple cel-shading, vibrant palette, white background."
- **Product mockup / commercial:** studio lighting plus precise framing. "A high-resolution studio product photograph of a matte-black ceramic mug on polished concrete, three-point softbox lighting, slightly elevated 45-degree angle, ultra-realistic, sharp focus on the rising steam, square image."
- **Minimalist / negative space (for overlaying text later):** "A single delicate red maple leaf in the bottom-right, vast empty off-white canvas with significant negative space, soft diffused light from the top left, square image."
- **Sequential art / comic / storyboard:** lean on character consistency plus scene description. "Make a 3-panel comic in a gritty noir style with high-contrast black-and-white inks." Works best on the Gemini 3 models.
- **Character turnaround (360 view):** prompt angle by angle and include the previously generated images in later turns to hold consistency. "A studio portrait of this man against white, in profile looking right." For complex poses, add a reference image of the pose.

## Best practices recap

- Be hyper-specific: more detail equals more control.
- Provide context and intent ("a logo for a high-end minimalist skincare brand" beats "a logo").
- Iterate conversationally; do not expect a perfect first try.
- For complex scenes, give step-by-step build instructions (background first, then midground, then the focal object).
- Use semantic negative prompts: "an empty deserted street" instead of "no cars".
- Control the camera with cinematic language.
