---
name: brand-film-craft
description: >
  Enforces Amtec's brand-film craft bar (type scale tokens, phone-size legibility,
  pulse-locked edit pacing, text dwell restraint, EBU R128 loudness, and two-tier
  export presets) across video-studio and video-studio-films. Use before authoring,
  stitching, grading, or exporting any brand film or product spot.
---

# Brand Film Craft (`brand-film-craft`)

Use this skill whenever you author, cut, grade, or export an Amtec brand or product film in `video-studio` or `video-studio-films`. It closes the gap between a working AI clip pipeline and a finished brand spot at the level of Anthropic's *Keep Thinking* and *What we make of this moment* films.

## 1. One Source of Truth in Git

Every film in `video-studio-films/<slug>/` owns its entire build recipe in Git. Never leave a DaVinci Resolve generator (`author.py`, `build_xml.py`, `decision.json`, `Finish.lua`) only in `~/Movies/`. If a film uses a Resolve interchange package, commit the generator and `decision.json` under `video-studio-films/<slug>/resolve/` and keep `Media/` and `.drp` artifacts gitignored.

## 2. Typography and Layout Rules

Read `tokens.json` before setting any card or overlay. Never invent per-line font sizes or fall back to `Helvetica`.

| Role | Face & Weight | 1080p Size | Resolve Basic Title | Tracking | Max Measure | Use |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `hero` | Söhne Halbfett (`600`) | `360px` | `440` | `-0.035em` | 1-2 words | Single climax word (`Rome.`) |
| `title` | Söhne Halbfett (`600`) | `96px` | `144` | `-0.028em` | 26 chars / 2 lines | Primary thesis statements and proverb claims (`Rome wasn't built in a day.`) |
| `statement` | Söhne Kräftig (`500`) | `84px` | `128` | `-0.024em` | 30 chars / 2 lines | Multi-cut build lines and secondary bridges |
| `lockup` | Söhne Kräftig (`500`) | `112px` | `168` | `-0.025em` | 1 word | Live `Amtec` beside/under the A mark on Chalk (`#F7F7F7`) |
| `tagline` | Söhne Buch (`400`) | `44px` | `68` | `-0.015em` | 40 chars | End-card descriptor (`Enabling AI for your business`) |
| `url` | Söhne Kräftig (`500`) | `32px` | `52` | `-0.010em` | 28 chars | End-card address (`amtecai.com`) |

- **No body weight over live footage.** Söhne Buch (`400`) is reserved for light-ground end-card descriptors. Any text over moving footage uses `Halbfett` (`600`) for primary claims or `Kräftig` (`500`) for secondary statements.
- **Zero glyph drift on word builds.** Lay out the complete phrase once at its final size and reveal word spans by opacity (`fill-opacity="0"` -> `"1"`). Persistent glyph drift across word arrivals must stay `<= 1px` at 1080p.
- **Safe margins.** Keep all text ink inside the central `84% x 80%` safe area (`x` within `154..1766`, `y` within `108..972` at 1080p).

## 3. Phone-Size Legibility (`390x220`) and Scrims

Most viewers watch brand spots inline in Slack or on a phone in portrait feed (`390px` wide).
- **Local P90 contrast >= 4.5:1.** Measure WCAG luminance contrast of the rendered text ink (`#F7F7F7`) against the **90th-percentile background luminance** inside the text bounding box, not the whole-frame average.
- **Radial soft scrim + diffused shadow, never a bottom-heavy linear ramp alone.** A linear bottom gradient leaves mid-frame text (`y=480..640`) unprotected against bright macro textures (wet mortar, sunlit limestone, white plastic). Place a soft elliptical radial scrim (`1.45x` text width by `2.1x` text height, feathered gaussian blur) plus a wide diffused shadow (`stdDeviation=22px`, alpha `0.55-0.70`) behind light text whenever background P90 luminance exceeds `0.15`.

## 4. Edit Pacing and Text Restraint

- **Text leaves once read.** Calculate minimum reading time as `words / 3.0 + 0.50s`. Never hold a static sentence on screen for more than `2.0x` its reading time.
- **Clear the text before the section turn.** Drop the completed line `0.32s-0.64s` (8-16 frames) *before* the visual sequence ends so the viewer experiences the image without reading for at least a beat.
- **Dark / blueprint card ceiling (`<= 1.85s`).** Never park static text on a dark or black card for a full 3-second hold. Either build the words across the pulse grid or cut back to physical footage as soon as the phrase lands.
- **Total text coverage `<= 62%`.** At least 38% of the film's runtime (including wordless acceleration bursts, visual turns, and breathing frames between sentences) must be pure picture or brand mark.
- **Montage cut lengths.** Lock picture cuts to the musical pulse grid (`0.33s` / 8 frames per pulse, `0.64s-0.67s` / 16 frames per paired pulse). Opening setup montages should average `0.64s-0.80s` per cut, accelerating to `0.33s` during visual-rhyme bursts, and opening out to `2.5s-3.7s` only on earned hero holds.

## 5. Audio, Colour, and Two-Tier Export

- **Sound design.** Layer subtle diegetic transient accents (stone strike, cable latch, turbine swell, room air) at `-18 dB` to `-24 dB` under the score on key visual turns so cuts have physical weight.
- **Loudness target.** Master web, Slack, and social exports with **two-pass linear EBU R128 `loudnorm`** to **`-16.0 LUFS` (`+/- 1.0 LU`)**, True Peak **`<= -1.5 dBTP`**, LRA **`6-12 LU`**, `48 kHz` stereo AAC at `256 kbps`. Never stream-copy an unnormalized `-23 LUFS` reference stem into a shareable MP4.
- **Two-tier export on every render:**
  1. `output/renders/master-vNNN.mp4` (`-crf 16 -preset slow`) for archival and cinema.
  2. `output/renders/slack-vNNN.mp4` (`-crf 20 -maxrate 10M -bufsize 20M -preset slow -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart`), guaranteed `< 85 MB` for Slack inline playback and PR uploads.

## 6. Verification Gate

Run `check-film-craft.py` before sharing any cut:

```bash
python3 skills/brand-film-craft/check-film-craft.py --tokens skills/brand-film-craft/tokens.json --decision Edit/decision.json --video output/renders/slack-vNNN.mp4
```

The script needs Python 3.10 or newer with `numpy`, and `ffmpeg` and `ffprobe` on the PATH.
