# Assembling the cut

The commands that turn clips into something watchable. All of them need
`ffmpeg` and `ffprobe` on `PATH` (`brew install ffmpeg`), and all of them take
`--dry-run` to print the ffmpeg commands without running them.

## `vs animatic`: the story reel

```bash
node dist/cli.js animatic films/<slug>/shots.json --narration vo.mp3 --music scratch.mp3
```

Cuts the **whole film** from each shot's still, held to that shot's duration,
with scratch narration and music. Title cards are included, so the reel is a
complete edit. Zero video spend, which makes it the cheapest place to discover
that the shot order is wrong.

A shot with no still of its own (text-only, or a Mode-B pack shot) inherits the
previous shot's still, or gets a labelled slate. Outputs are immutable:
`output/animatics/vNNN.mp4`, or the same structure under `output-draft/`.

## `vs review`: the QA gate

```bash
node dist/cli.js review films/<slug>/shots.json --frames 3
```

Extracts frames from every downloaded clip into `review/index.md`. It samples
the **first** frame (0%) and the **last** (~98%) plus mids: the first is your
identity check against the keyframe, the last is what the cut into the next
shot lands on.

It also probes each clip and flags a mismatch between what was delivered and
what was requested (duration, aspect, resolution) with a warning marker. An
`adaptive` ratio skips the aspect check, because the delivered frame is only
known after generation.

Run it on the draft pass before approving shots for the final.

## `vs stitch`: the cut

```bash
vs score "Cinematic underscore…" --shots films/<slug>/shots.json
vs narrate films/<slug>/narration/lines.tsv
vs narrate assemble films/<slug>/shots.json --placement narration/placement.tsv --xfade 0.4
vs stitch films/<slug>/shots.json --xfade 0.4 \
  --music films/<slug>/score-v001.mp3 \
  --narration films/<slug>/narration.mp3
```

Assembles clips and title cards into one film. Use the same `--xfade` on
`vs narrate assemble` and `vs stitch` so narration lands on the same timeline
(both default to `0`). Per-shot `transition` overrides
`--xfade` for the cut **into** that shot. `--grade` applies a subtle filmic
grade.

Two paths: a lossless `-c copy` concat when there are no transitions, no audio
tracks, and no grade (and only when a probe confirms the streams match
exactly), otherwise a single re-encode pass. The probe preflight is mandatory,
not polish: concatenating mismatched streams produces a file that plays wrong
rather than an error.

Always pass `--music` and `--narration` for anything shareable, and re-stitch
after regenerating any shot. Score/narrate details and the filter chain are in
`audio-mix.md`.

### `--latest`: always a watchable reel

```bash
node dist/cli.js stitch films/<slug>/shots.json --latest   # -> output/renders/latest/vNNN.mp4
```

Per shot it prefers the final clip, falls back to the draft clip, then to a
held still or slate, normalising every source to one frame so a half-finished
film still cuts into a complete reel. Plain `vs stitch` still requires every
final clip and keeps the fast lossless path.

### Title cards

Rendered outside the model, because in-model text is unreliable. This project's
ffmpeg has no `drawtext`, so cards are rasterised from generated SVG through
macOS `qlmanage` and `sips`. **That makes cards macOS-only**; on Linux, install
an ffmpeg with `drawtext` and adapt `src/cards.ts`.

`--font` fails loudly for a family that is not installed, because `qlmanage`
would otherwise substitute a default face and exit 0.

A card can be styled and can carry an image: `background` and `color` take a
6-digit hex, `image` draws a local svg, png, jpg or webp centred (a logo end
card), and `fade: false` cuts the card in and out hard. A card with an `id`
and no text is a blank ground for overlays.

### Overlays and trims

`overlays` in the shots file put text over a shot or a card, and a shot's
`trim` cuts a part of its clip into the film. Both are applied by `vs stitch`
(including `--latest`) and `vs animatic`, so the type and the pacing are judged
on the story reel before any video is paid for.

Each segment that has a trim or an overlay is written as a derived copy under
`<outputDir>/overlays/` and that copy goes into the cut. The clip under
`output/clips/` is never modified, so its visual-approval receipt still binds
the same bytes, and nothing here reaches a provider or changes a `payloadHash`.
A segment with neither is passed through untouched, which keeps a film with no
overlays on the fast lossless path.

`qlmanage` always paints an opaque ground, so overlay text is rasterised as a
white-on-black matte and ffmpeg merges it as the alpha of a flat colour. That
is why an overlay is one colour, and why overlays are macOS-only like cards.
Every overlay `font` must be installed; a dry run checks them and fails loudly.

`vs narrate assemble` places lines against the trimmed length of a shot.

The **opening** card (timeline position 0) renders with `fadeIn: false` so
frame 0 is the visible card rather than black. Messaging apps grab a poster
frame from the start of the file, and a fade-up gives them a black one. Keep
any shareable cut opening on a non-black frame.

## `vs upscale`: 720p masters to a delivery resolution

```bash
node dist/cli.js upscale films/<slug>/shots.json --shot s01-last-arrival s10-safe-water
```

Lanczos upscale (`scale=-2:1080:flags=lanczos`), video re-encoded at `--crf 18`,
audio copied, written as numbered files under
`output-1080/clips/<shot>/vNNN.mp4` so the 720p masters and earlier upscales are
untouched. It only sources complete final clips and skips anything already at
or above the target height.

This is the free half of the resolution strategy: generate at 720p, then
upscale **only the shots that survive the edit**. `--shot` is how you scope it
to those; without it, every clip is upscaled.

## `vs share`: a size-capped export

```bash
node dist/cli.js share films/<slug>/output/renders/final/v001.mp4 --max-mb 49
```

Two-pass x264 sized to land just under the ceiling (default 49 MB, for
WhatsApp, Telegram, and email), `--height` caps resolution at 720 and only ever
downscales, audio at `--audio-kbps` (default 160), with `+faststart`. The
bitrate budget is `maxBytes × 8 / duration − audio`, with 3% headroom.

Run it on the finished cut, and re-run it after any re-stitch so it carries the
latest audio. WhatsApp re-compresses hard on an in-app video send, so send the
result as a **Document** to preserve the quality you just paid for.

Default stitch, animatic, upscale, and share destinations allocate the next
`vNNN` file. An explicit `--output` is exact and refuses to replace an existing
video.
