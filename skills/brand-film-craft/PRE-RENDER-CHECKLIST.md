# Amtec Brand Film Pre-Render & Pre-Share Checklist

Run every item below before posting a render to Slack, attaching it to a PR, or handing it to Matt for review.

## 1. Script, Concept & Restraint
- [ ] **One concrete visual metaphor:** Every proverb or claim is proved by a physical action in the frame (e.g. hand chisel vs CNC mill, rope hoist vs tower crane), not abstract B-roll.
- [ ] **Verified claims only:** Every line of copy matches `packages/brand/BRAND.md` (no unverified throughput promises, no "agency/consultancy" labels, Australian English, no em dashes).
- [ ] **Text coverage <= 62%:** On-screen words occupy no more than 62% of total frames. Every completed sentence clears `8-16 frames` (`0.32s-0.64s`) before the next section so the picture breathes.
- [ ] **Dark/blueprint hold <= 1.85s:** No text-on-black or text-on-blueprint card sits static for longer than `1.85s`.

## 2. Typography & Layout (`tokens.json`)
- [ ] **Only token roles used:** Every title maps to one of the 6 roles in `tokens.json` (`hero`, `title`, `statement`, `lockup`, `tagline`, `url`). Zero ad-hoc per-line font sizes.
- [ ] **Title weight over footage:** Primary thesis claims (`"Rome wasn't built in a day."`) use **Söhne Halbfett (`600`)** at `96px` (`144` in Resolve Basic Title), and secondary build lines use **Söhne Kräftig (`500`)** at `84px` (`128` in Resolve). Söhne Buch (`400`) is never used over live footage.
- [ ] **Single display family on end cards:** `amtecai.com` uses **Söhne Kräftig (`500`)** at `32px` (`52` in Resolve), matching the `Amtec` lockup.
- [ ] **Zero glyph drift (`<= 1px`):** Phrases that build word-by-word lay out the full string once and reveal words in place so earlier letters never shift horizontally or shrink when the next word arrives.

## 3. Phone-Size Legibility (`390x220` iPhone Viewport)
- [ ] **P90 local contrast >= 4.5:1:** In every titled shot, the WCAG contrast ratio between `#F7F7F7` Chalk text and the **90th-percentile luminance** of the background pixels inside the text bounding box is at least `4.5:1` (`>= 3.5:1` against P95 specular highlights).
- [ ] **Radial scrim + diffused shadow on bright footage:** Shots with bright mid-frame textures (mortar, limestone, clouds, white surfaces) carry a feathered elliptical radial scrim centered on the text block plus a soft gaussian shadow (`blur 22px`), not a bottom-only linear gradient.
- [ ] **390x220 contact-sheet inspection:** Inspect key titled frames downscaled to `390x220` at 100% zoom to confirm instant readability at arm's length.

## 4. Motion, Pacing & Visual Continuity
- [ ] **True-to-life motion speed:** No unintentionally stretched/slow-motion AI takes; every clip has an active camera move and 2-3 real-time physical actions, and passes `vs review` with a hash-bound approval receipt.
- [ ] **No macro fingers or unapproved faces:** Hands are framed from `>= 1m` away; macro shots show tools and materials only.
- [ ] **Pulse-locked montage:** Setup montage cuts average `0.64s-0.80s` (2 pulses), acceleration bursts run at `0.33s` (1 pulse), and hero holds (`2.5s-3.7s`) are used at most twice in a 60-75s spot.
- [ ] **Visual rhyme across fast cuts:** Adjacent sub-0.5s cuts share a centered geometric anchor (circle, horizon, or motion vector) or use a 2-3 frame cross-dissolve so the eye does not fight a 48+/255 RGB jump on every cut.

## 5. Audio, Colour & Export
- [ ] **Shot-matched primary balance + unified print LUT:** Exposure and neutral-grey balance run per clip before the shared film LUT, halation, and dual-scale luma grain.
- [ ] **Full-HD vector assets:** Line drawings and animations (such as `rome-build.mp4`) are rendered natively at `1920x1080` (never upscaled from `960x540`).
- [ ] **Loudness normalized to `-16.0 LUFS` (`+/- 1.0 LU`):** Two-pass linear EBU R128 normalization applied (`TP <= -1.5 dBTP`, `LRA 6-12 LU`, `48 kHz` stereo AAC `256 kbps`).
- [ ] **Two-tier export generated:**
  - Archival Master (`-crf 16`)
  - Slack/Web Delivery (`-crf 20 -maxrate 10M -bufsize 20M -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart`, file size `< 85 MB`).
- [ ] **Poster frame check:** Frame 0 is the visible brand mark on Chalk (`#F7F7F7`), never black.
- [ ] **Automated gate passed:** `python3 skills/brand-film-craft/check-film-craft.py --tokens skills/brand-film-craft/tokens.json --decision <decision.json> --video <render.mp4>` exits `0`.
