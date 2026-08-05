# shots.json and stills.json: schema and hard rules

The CLI validates both files with zod (`src/shots.ts`). Every object is
**strict**, so a misspelled key is a load-time error rather than a silently
ignored field. A rule below either fails validation or degrades a paid
generation, so always `--dry-run` first.

Several rules are **model-dependent**, keyed off `film.model`. A file with no
`film.model` is validated as Seedance 2.0, because that is the CLI's built-in
default. Set `"model": "dreamina-seedance-2-5-260628"` to get 2.5's rules.

Two worked, lint-clean files to read alongside this, both the same story:
`examples/shots-2-5.json` (2.5, two 30s acts: a pure ordinal-bound pack, then
the mixed mode with a `first_frame` at `@Image 1`) and
`films/lighthouse/shots.json` plus `films/lighthouse/stills.json` (2.0, twelve
8s shots, and the complete pipeline end to end).

## Contents

- [stills.json](#stillsjson)
- [shots.json](#shotsjson)
- [Reference roles and the two modes](#reference-roles-and-the-two-modes)
- [The ordinal contract](#the-ordinal-contract)
- [Hard rules (enforced)](#hard-rules-enforced)
- [Lint warnings (non-fatal)](#lint-warnings-non-fatal)
- [Allowed values](#allowed-values)
- [Validate](#validate)

## stills.json

Generated first with `vs stills`. Locks the look: the literal opening
composition of every shot, plus any character, prop, or environment plate.

```json
{
  "model": "gemini-3-pro-image",
  "outputDir": "./stills-v2",
  "ratio": "1:1",
  "stills": [
    {
      "id": "s01-last-arrival",
      "prompt": "Photorealistic expressionist maritime black-and-white keyframe, exact 1.10:1 almost-square composition, orthochromatic tonal response... Literal opening composition: remote white stone lighthouse rises vertically through pearl-grey dusk, lamp room dark, cottage compressed below, wet path entering at bottom; THE RELIEF is small on the path in a pale slick oilskin.",
      "ratio": "1:1"
    }
  ]
}
```

Per-still fields: `id` (required, `[a-z0-9_-]` case-insensitive, unique),
`prompt` (required), `references` (optional array of strings: https URLs or
local image paths relative to the stills file; png/jpg/webp only), `ratio`
(optional; a literal `{w}:{h}`, never `adaptive`). File fields: `model`,
`outputDir`, `ratio`, `stills` (1 or more).

`size` and `seed` still parse but are IGNORED: Nano Banana takes a ratio rather
than pixels and rolls its own seed. They remain in the schema only so a stills
file written for Seedream still loads.

Stills carry no roles; every reference is a likeness or style input. A
style-only still with no `references` is valid, and that is what the demo film
uses. Environment plates end their prompt with "no people".

**Filename mapping:** a still with `id: foo` is written to `<outputDir>/foo.png`
and referenced from a shot as `./stills/foo.png`. Give a keyframe still the
same id as its shot so the two files stay in lockstep.

Stills run on Nano Banana through the AI SDK and need `GEMINI_API_KEY`. See
`../../vs/references/models.md`.

## shots.json

Generated with `vs generate`. One shot is one paid task.

```json
{
  "film": {
    "title": "The Last Watch (Seedance 2.5 cut)",
    "outputDir": "./output",
    "model": "dreamina-seedance-2-5-260628",
    "defaults": {
      "ratio": "1:1",
      "duration": 30,
      "resolution": "720p",
      "generateAudio": true,
      "watermark": false
    },
    "promptPreamble": "Photorealistic expressionist maritime cinema in stark black-and-white... Reference images are bound by ordinal: each @Image N is named in the timestamp plan with the one job it does, and is used for nothing else. Realtime speed, brisk natural motion. Keep every frame subtitle-free and free of any watermark or on-screen lettering."
  },
  "cards": [
    { "after": "start", "text": "THE LAST WATCH", "duration": 3, "transition": 0.4 },
    { "after": "end", "text": "THE WATCH PASSES ON", "duration": 3, "fontSize": 48, "transition": 0.7 }
  ],
  "shots": [
    {
      "id": "a1-the-refusal",
      "prompt": "<ordinal bindings, then a timestamp plan: see seedance-prompting.md>",
      "seed": 8201,
      "transition": 0.4,
      "references": [
        { "type": "image", "url": "./stills/keeper.png", "role": "reference_image" },
        { "type": "image", "url": "./stills/relief.png", "role": "reference_image" },
        { "type": "image", "url": "./stills/machinery-room.png", "role": "reference_image" }
      ]
    }
  ]
}
```

That is `examples/shots-2-5.json`, trimmed. Copy from the file, not from here.

**Per-shot fields.** `id` (required, `[a-z0-9_-]`, unique), `prompt`
(required), `duration` (optional, 4-30 schema envelope, or `-1` for auto;
2.5 allows up to 30, Seedance 2.0 still caps at 15 at generate time), `ratio`,
`resolution` (only emitted when set), `cameraFixed` (bool, sends
`camera_fixed`), `references`, `output`
(filename, defaults `${id}.mp4`, must stay inside the film dir), `seed` (int),
`transition` (0.05 to 2, the crossfade **into** this shot). Omit it and use
`--xfade 0` on stitch/assemble for a true hard cut; 0.05 is the minimum ffmpeg
fade, not a cut.
Downloaded takes default to `output/clips/<id>/vNNN.mp4`. A custom `output`
value is preserved inside that shot's numbered revision directory.

**`film` fields.** `title` (required), `model`, `draftModel` (the cheaper model
used under `--draft`), `outputDir`, `promptPreamble` (prepended to every shot
prompt, blank-line joined), `defaults` (`ratio`, `duration`, `resolution`,
`cameraFixed`, `generateAudio`, `watermark`).

**`film.draftModel` on a 2.5 film: leave it unset.** `vs generate --draft`
validates every shot against the draft model, and `dreamina-seedance-2-0-fast-260128`
is documented at 4-15s, so a 30s film with that draft model is **refused**, not
warned. Unset, `--draft` runs the film's own model at 480p with audio off.

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
  Omni-reference inputs for likeness, style, staging, motion, mood.
- **Frame mode:** `first_frame`, `last_frame`. Images only. They pin the
  literal opening or closing frame.

**On Seedance 2.5 the two modes combine.** 2.5's own R2V demos bind a scene
reference alongside per-subject references, so a `first_frame` plus a
`reference_image` pack loads and submits. Put the frame role **first** in the
array (hard rule 2 below). On 2.0-family the two modes are mutually exclusive
and mixing them is a load-time error.

**Ceilings.** Seedance 2.5 product allows **30 images / 10 video / 10 audio**
(50 total). Seedance 2.0 platform hard-caps at **9 / 3 / 3**, enforced as an
error by `validateShotAgainstModel`. The lint soft-warns above **16 total
references on 2.5** and **5 on 2.0**. The ceiling is not a target: an 8-14 image pack is the design idiom, and quality drops well
before 30.

**Local paths.** Images are always allowed as local paths and are inlined as
base64 data URLs at submit. **Video and audio local paths are allowed on 2.5
only**, subject to a **20 MB inline ceiling** (a clear error above it; `vs share`
will compress a clip first). Honest caveat: nobody has confirmed that Ark's
`video_url` content type accepts data URLs at all, only that `image_url` does,
which is why images are inlined without hesitation. An **https URL is the
supported path** for video and audio. On 2.0-family a local video or audio path
is refused outright, naming the upload workaround.

The schema accepts only the five wire roles above, and every reference is an
asset you authored: there is no field that anchors a shot on another shot's
last frame. There is likewise no clay, green-screen, region-edit, or extend
role, and no `extendFrom` field: those capabilities are reachable through the
roles that exist (see `seedance-prompting.md`), and inventing a field whose
wire name is a guess would be dead JSON.

## The ordinal contract

A 2.5 prompt binds references by ordinal: `use @Image 1 for his face, @Image 2
for the machinery room`. That ordinal is resolved against the submitted `content`
array. What you type has to match what the model receives, or a $7 generation
uses the wrong reference for the wrong job and looks like a model failure.
`referenceOrdinals` in `src/payload.ts` is the authority.

1. **Ordinals count per media type, not per array index.** In
   `[video, image, image]`, `@Image 1` is the **second** array entry and
   `@Video 1` is the first. Images, video, and audio each number from 1.
2. **A frame role consumes an image ordinal.** `first_frame` and `last_frame`
   are `image_url` items on the wire. A shot with a `first_frame` plus two
   `reference_image` entries has its keyframe at `@Image 1` and its packs at
   `@Image 2` and `@Image 3`. Put the frame role first in `references[]` so the
   packs start at 2 and stay there; the lint warns when it is not first.
3. **The array is never reordered.** `buildTaskPayload` emits the text item
   first, then references in authored order, exactly as written. Authored order
   is the contract.
4. **Bind every reference, and bind nothing that is not there.** A prompt that
   supplies references and names none of them lets the model average them
   together. A prompt that names `@Image 3` on a two-image shot points at
   nothing. Both are lint warnings.

## Hard rules (enforced)

1. **Frame mode XOR reference mode, on 2.0-family only.** On
   `seedance-2-0`, `-fast`, `-mini` and the 1.x entries, a shot with a
   `first_frame` or `last_frame` may carry no `reference_*` entries: the two
   modes are mutually exclusive there, so carry likeness in the prompt text
   instead. **On Seedance 2.5 both are allowed** and the shot loads.
2. **On 2.5, a frame role goes first in `references[]`.** Not a load error, a
   lint warning, but treat it as a rule: it is what keeps `@Image 2` meaning
   what you think it means.
3. **At most one `first_frame` and one `last_frame`** per shot.
4. **Unique ids** per file, matching `[a-z0-9_-]+` case-insensitive.
5. **Card `after`** must be `"start"`, `"end"`, or an existing shot id.
6. **Local reference paths must stay inside the film directory** (no `..`, no
   absolute paths), resolved relative to the JSON file. Local **video and audio**
   paths additionally require Seedance 2.5; on 2.0-family they must be https
   URLs. Local files are inlined as data URLs at submit, and a non-image over
   20 MB is an error.
7. **`first_frame`/`last_frame` must be images.**
8. **Duration** is an integer 4-30 (schema), or `-1`. Per-model caps are
   enforced at generate: 2.0-family refuses >15s as an error; 2.5 accepts 30
   and reports `-1` as a warning, because its console card does not list auto.
9. **Unknown keys are rejected**, everywhere. `cameraFixxed` is an error, not
   a silent no-op.

## Lint warnings (non-fatal)

`vs generate` prints these; `--dry-run` prints them for free. Fix all of them.
`M` marks a check whose threshold or applicability depends on `film.model`.

### shots.json (`lintShotsFile`)

| Warning | Why |
| --- | --- |
| No image reference on a shot | Anchor every shot to a literal keyframe. Tighter, cheaper, far fewer glitches |
| No `seed` | A draft and its final must share a seed or the final re-rolls the composition |
| Too many references **M** | Soft warn above 16 on 2.5, 5 on 2.0-family. Product ceiling is 30/10/10, and quality drops long before it |
| Prompt over the word cap **M** | 700 words on 2.5, 400 on 2.0-family, counting `promptPreamble`. Move shared style up, trim to the timed beats, or split the shot. Do **not** compress ordinal bindings to fit |
| More than 2 slow-motion terms | Seedance renders soft vocabulary literally. Use brisk verbs |
| 12s or longer with no beat carrier | A single verb stretches into slow motion. `Shot N:`, `0-5s:`, or `[0:00-0:05]` all satisfy it. Skipped for `-1` |
| 20s or longer on 2.5 with no **timestamp** plan **M** | `Shot N:` orders the beats but says nothing about rhythm, so past 20s the model invents the pacing between them. Only a timestamp range or `[0:00` bracket clears this one |
| Prompt binds an ordinal the shot does not carry | `@Image 3` on a two-image shot points at nothing. Remember ordinals count per media type. Every model |
| References supplied but never bound by ordinal **M** | 2.5, 2 or more references. Name each one's single job or the model averages them together |
| Frame role is not the first reference **M** | 2.5 mixed mode. The frame role consumes an image ordinal, so the packs shift under you |
| `cameraFixed` with an image reference | Rejected in image-to-video mode. Lock the camera in the prompt instead |
| `film.draftModel` cannot render every shot | `vs generate --draft` will **refuse** the film. A 30s 2.5 film with a 2.0-fast draft model hard-fails, because 2.0-fast is documented at 4-15s and a documented mismatch is an error. Unset `film.draftModel` |

### stills.json (`lintStillsFile`)

| Warning | Why |
| --- | --- |
| Duplicate still id | The later one overwrites the earlier one's png |
| No `seed` | A re-run rolls a new face and composition instead of reproducing the keyframe |
| Prompt over 200 words | An image prompt is one composition, not a timed sequence; it dilutes past ~200. Move the shared look into the shots file's `film.promptPreamble` |
| `size` set on a `gemini-*` model | Nano Banana takes an aspect ratio, not pixels. Set `ratio` |
| Local reference not on disk | The still generates without it, silently losing that likeness or style |

## Allowed values

- **Aspect ratios:** `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `21:9`, `adaptive`.
  `adaptive` derives the frame from the reference image, so it has no numeric
  value: cost estimation falls back to an explicit ratio and `vs review` skips
  the aspect check.
- **Resolution:** `480p`, `720p`, `1080p`, `4k`. Generate at 720p and upscale
  for delivery; the reasoning and the 4K rate-limit trap are in
  `../../vs/references/models.md`.
- **Duration:** integer 4-30 (schema), or `-1`. Seedance 2.0 still refuses
  >15s at generate; 2.5 allows up to 30 and does not list auto.
- **Transition:** 0.05 to 2 seconds.

Per-model support is narrower than these wire enums: the `fast` and `mini`
models are 480p/720p only, and 2.5's console card lists 480p/720p. `src/models.ts`
is the authority, and `validateShotAgainstModel` refuses documented mismatches
at generate. On 2.5 the registry entry is `confidence: "inferred"` until a live
create-task succeeds, so a mismatch there (a 1080p request, `-1`) is reported as
a **warning** and the request still goes out.

## Validate

```bash
node dist/cli.js stills   films/<slug>/stills.json --dry-run
node dist/cli.js generate films/<slug>/shots.json --dry-run
```

Full validation and lint, request payloads printed, nothing written, nothing
spent. Retakes: `--shot <id> --force` / `--still <id> --force`.
