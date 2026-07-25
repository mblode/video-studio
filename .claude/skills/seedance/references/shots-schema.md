# shots.json and stills.json: schema and hard rules

The CLI validates both files with zod (`src/shots.ts`). Every object is
**strict**, so a misspelled key is a load-time error rather than a silently
ignored field. A rule below either fails validation or degrades a paid
generation, so always `--dry-run` first.

`films/lighthouse/shots.json` and `films/lighthouse/stills.json` are the
worked, runnable versions of everything here. Read them alongside this.

## Contents

- [stills.json](#stillsjson)
- [shots.json](#shotsjson)
- [Reference roles and the two modes](#reference-roles-and-the-two-modes)
- [Hard rules (enforced)](#hard-rules-enforced)
- [Lint warnings (non-fatal)](#lint-warnings-non-fatal)
- [Allowed values](#allowed-values)
- [Validate](#validate)

## stills.json

Generated first with `vs stills`. Locks the look: the literal opening
composition of every shot, plus any character, prop, or environment plate.

```json
{
  "model": "seedream-5-0-260128",
  "outputDir": "./stills",
  "ratio": "16:9",
  "stills": [
    {
      "id": "s01-final-arrival",
      "prompt": "Photorealistic cinematic keyframe, literal opening composition: remote whitewashed lighthouse and cottage on a treeless headland at steel-blue dusk, lamp room dark, warm cottage window, path entering lower left, tower on right third, wide aerial, no lettering.",
      "size": "2560x1440",
      "seed": 7101
    }
  ]
}
```

Per-still fields: `id` (required, `[a-z0-9_-]` case-insensitive, unique),
`prompt` (required), `references` (optional array of strings: https URLs or
local image paths relative to the stills file), `size` (optional free-form
string), `ratio` (optional), `seed` (optional int). File fields: `model`,
`outputDir`, `ratio`, `stills` (1 or more).

Stills carry no roles; every reference is a likeness or style input. A
style-only still with no `references` is valid, and that is what the demo film
uses. Environment plates end their prompt with "no people".

**Filename mapping:** a still with `id: foo` is written to `<outputDir>/foo.png`
and referenced from a shot as `./stills/foo.png`. Give a keyframe still the
same id as its shot so the two files stay in lockstep.

Backend follows the file's `model`: a `seedream-*` id (default) uses the Ark
image API, a `gemini-*` id routes to Nano Banana and needs `GEMINI_API_KEY`.
See `../../vs/references/models.md`.

## shots.json

Generated with `vs generate`. One shot is one paid task.

```json
{
  "film": {
    "title": "The Last Watch",
    "outputDir": "./output",
    "defaults": {
      "ratio": "16:9",
      "duration": 6,
      "resolution": "720p",
      "generateAudio": true,
      "watermark": false
    },
    "promptPreamble": "Photorealistic cinematic silent short set at an unnamed lighthouse... Natural realtime motion, precise physical action. No readable labels, subtitles, watermark or on-screen lettering."
  },
  "cards": [
    { "after": "start", "text": "THE LAST WATCH", "duration": 3, "transition": 0.4 },
    { "after": "end", "text": "THE WATCH PASSES ON", "duration": 3, "fontSize": 48, "transition": 0.7 }
  ],
  "shots": [
    {
      "id": "s01-final-arrival",
      "prompt": "<Shot 1: ... Shot 2: ... Shot 3: ...   see seedance-prompting.md>",
      "seed": 7101,
      "transition": 0.4,
      "references": [
        { "type": "image", "url": "./stills/s01-final-arrival.png", "role": "first_frame" }
      ]
    }
  ]
}
```

**Per-shot fields.** `id` (required, `[a-z0-9_-]`, unique), `prompt`
(required), `duration` (optional, 4 to 15 or `-1` for auto), `ratio`,
`resolution` (only emitted when set), `cameraFixed` (bool, sends
`camera_fixed`), `references`, `continueFrom` (an earlier shot id), `output`
(filename, defaults `${id}.mp4`, must stay inside the film dir), `seed` (int),
`transition` (0.05 to 2, the crossfade **into** this shot; 0.05 is a hard cut).
Downloaded takes default to `output/clips/<id>/vNNN.mp4`. A custom `output`
value is preserved inside that shot's numbered revision directory.

**`film` fields.** `title` (required), `model`, `draftModel` (the cheaper model
used under `--draft`), `outputDir`, `promptPreamble` (prepended to every shot
prompt, blank-line joined), `defaults` (`ratio`, `duration`, `resolution`,
`cameraFixed`, `generateAudio`, `watermark`).

**`cards`.** Each has `after` (`"start"`, `"end"`, or a shot id), `text`
(required), `duration` (default 3), `fontSize` (default 64), `transition`.
Cards are rendered in post because in-model text is unreliable, and they add
real runtime on top of the summed clip durations.

Keep `defaults.generateAudio: true`. It produces the diegetic SFX the prompt
asks for; it does not add music or dialogue.

## Reference roles and the two modes

A `references[]` entry has `type` (`image`, `video`, `audio`), `url`, and
`role`:

- **Reference mode:** `reference_image`, `reference_video`, `reference_audio`.
  Omni-reference inputs for likeness, style, motion, mood.
- **Frame mode:** `first_frame`, `last_frame`. Images only. They pin the
  literal opening or closing frame.

`continueFrom: "<earlier-id>"` is **implicit frame mode**: the CLI extracts
that shot's last frame with ffmpeg (cached in `frames/`) and submits it as this
shot's `first_frame`.

## Hard rules (enforced)

1. **Frame mode XOR reference mode.** A shot with `continueFrom`, a
   `first_frame`, or a `last_frame` may carry no `reference_*` entries.
   Seedance's two modes are mutually exclusive. Carry likeness in the prompt
   text instead.
2. **`continueFrom` supplies the first_frame.** Do not also add an explicit
   `first_frame`; that is two first frames.
3. **At most one `first_frame` and one `last_frame`** per shot.
4. **`continueFrom` must name an EARLIER shot** in file order, and never
   itself.
5. **Unique ids** per file, matching `[a-z0-9_-]+` case-insensitive.
6. **Card `after`** must be `"start"`, `"end"`, or an existing shot id.
7. **Non-image references must be https URLs.** Local paths are images only,
   resolved relative to the JSON file, and must stay inside the film directory
   (no `..`, no absolute paths). They are inlined as data URLs at submit.
8. **`first_frame`/`last_frame` must be images.**
9. **Duration** is an integer 4 to 15, or `-1`. 15s needs the Pro tier.
10. **Unknown keys are rejected**, everywhere. `cameraFixxed` is an error, not
    a silent no-op.

## Lint warnings (non-fatal)

`vs generate` prints these; `--dry-run` prints them for free. Fix all of them.

| Warning                               | Why                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| No image reference on a shot          | Anchor every shot to a literal keyframe. Tighter, cheaper, far fewer glitches |
| No `seed`                             | A draft and its final must share a seed or the final re-rolls the composition |
| More than 5 references                | Quality degrades. `continueFrom` counts as one                               |
| Prompt over 400 words                 | Counting `promptPreamble`. Move shared style up, or split the shot           |
| More than 2 slow-motion terms         | Seedance renders soft vocabulary literally. Use brisk verbs                  |
| `cameraFixed` with an image reference | Rejected in image-to-video mode. Lock the camera in the prompt instead        |
| Any `continueFrom`                    | Chaining serializes generation and cascades retakes onto downstream shots     |
| Chain depth over 3                    | Drift accumulates. Re-anchor from a still                                    |

## Allowed values

- **Aspect ratios:** `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `21:9`, `adaptive`.
  `adaptive` derives the frame from the reference image, so it has no numeric
  value: cost estimation falls back to an explicit ratio and `vs review` skips
  the aspect check.
- **Resolution:** `480p`, `720p`, `1080p`, `4k`. Generate at 720p and upscale
  for delivery; the reasoning and the 4K rate-limit trap are in
  `../../vs/references/models.md`.
- **Duration:** integer 4 to 15, or `-1`.
- **Transition:** 0.05 to 2 seconds.

Per-model support is narrower than these wire enums (the `fast` and `mini`
models are 480p/720p only). `src/models.ts` is the authority and reports a
mismatch as a warning, never a refusal.

## Validate

```bash
node dist/cli.js stills   films/<slug>/stills.json --dry-run
node dist/cli.js generate films/<slug>/shots.json --dry-run
```

Full validation and lint, request payloads printed, nothing written, nothing
spent. Retakes: `--shot <id> --force` / `--still <id> --force`.
