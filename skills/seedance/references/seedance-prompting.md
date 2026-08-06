# Seedance prompt craft

How to write the `prompt` string for a shot. **Write for Seedance 2.5**:
timestamp-level narrative, camera, and rhythm control; 30s one-take acts; and
multimodal binding by ordinal (Seed product blog, 2026-07-31). Set
`film.model` to `dreamina-seedance-2-5-260628` to get it, because the CLI's
built-in default is still 2.0. The BytePlus ModelArk 2.0 guide (doc 2222480)
remains the reference for bracket semantics, and 2.0 craft is the same craft
clipped to a 15s envelope.

For the JSON around the prompt, see `shots-schema.md`. For model ids,
resolutions, and rate limits, see `../../vs/references/models.md`.

## Contents

- [Duration and story units](#duration-and-story-units)
- [Beat carriers](#beat-carriers)
- [Bracket semantics](#bracket-semantics)
- [Constraints without a negative prompt](#constraints-without-a-negative-prompt)
- [Realtime motion](#realtime-motion)
- [Binding references](#binding-references)
- [Clay and white-model blockout](#clay-and-white-model-blockout)
- [Where the shared style lives](#where-the-shared-style-lives)
- [Camera language](#camera-language)
- [Audio](#audio)
- [In-frame text and signage](#in-frame-text-and-signage)
- [Video editing operations](#video-editing-operations)
- [Pitfalls](#pitfalls)

## Duration and story units

Let the **story unit** pick the duration; do not force a house style length.

| Model | Envelope | Typical use |
| --- | --- | --- |
| Seedance 2.5 | 4-30s single pass | An act: setup, turn, resolution in one generation |
| Seedance 2.0 (CLI default) | 4-15s (or `-1` auto) | One emotional beat or a short multi-cut sequence |

Do **not** prescribe packing every film into 8s, 10-15s, or "always max the
clip." Short inserts, long one-takes, and mid-length multi-cuts are all valid
when they match the beat. Cost scales with duration times resolution: report the
sum, then choose.

On 2.5 a single pass holds a miniature narrative (quay to wheelhouse to open
water) rather than one frozen gesture, with internal hard cuts landing on
timestamps you specify. On 2.0, stay inside 15s and split when the arc needs
more.

For a film longer than a single pass, the shape is **acts stitched in post**:
several 30s generations, each independently retakeable, cut together by
`vs stitch`. Continuing one generation from another's output is possible through
`reference_video` (see [Video editing operations](#video-editing-operations)),
but it serializes generation and expires with the source URL, so it is a repair
tool, not a structure.

## Beat carriers

Give the model **distinct camera setups and verbs** so it does not stretch one
action into slow motion.

**Timestamp plan (the default on 2.5, and required past 20s).** Ranges pin the
narrative turn, the camera method, and the rhythm to the clock. From
`examples/shots-2-5.json`, `a1-the-refusal` (30s):

```
0-5s: open mid-action on a wide exterior pushing toward the vertical tower as wind lashes the long grass sideways; THE RELIEF climbs the lower path with her tool roll and a compact dark motor case, the lamp above her completely unlit; <wind tearing across grass, surf below, boots on wet stone>.
6-11s: hard cut to a cramped vertical two-shot across an open iron door; she offers her right hand, he takes the motor case from her instead, sets it against the stone wall and pushes the door shut between them; <iron hinges, a case set down on stone, a door closing hard>.
12-19s: hard cut low into the machinery room; he draws a large dark iron service key from inside his coat, fits it and winds the counterweight upward in long even strokes while she raises a grey vibration meter behind the guarded chain; <ratchet clicking, chain taking load, a meter ticking>.
20-25s: cut to macro inside the guard; one link passes through frame rubbed bright and thin against its neighbours, then climbs out of shot; <chain links knocking, metal under strain>.
26-30s: pull back to a locked two-shot; he steps across the guard to block her view, pockets the key and holds her eye; she lowers the meter without looking away; <the drive settling, wind through stone, no music>.
```

`0-6s:` / `7-14s:` ranges and `[0:00-0:06]` brackets both satisfy the lint.
Ranges should be contiguous and cover the whole duration.

**Shot-beat form (Seedance 2.0, and short multi-cut shots).** `Shot N:` orders
the beats but says nothing about rhythm, so past **20 seconds** the model
invents the pacing between them and the gaps stretch. The lint warns on a 2.5
shot of 20s or more that has no timestamp range.

```
Shot 1: [camera method]; [subject actions]; [position or spatial relation]; [audio].
Shot 2: [camera method]; [subject actions]; [position or spatial relation]; [audio].
```

ASCII `[0:00-0:03]` is fine. Avoid `【square brackets】`: that channel is
reserved for subtitles.

Slot order in either form is camera, then action, then frame position, then
sound. Front-load it.

Why multiple beats matter, measured on this repo's clips: single-action
generations produced **0 internal scene-change events**, one continuous
stretched gesture that reads as slow motion. Multi-beat generations produced
**1 to 4**, which is what internal cuts, reframes, and realtime pace look like.

Rules that follow:

- **Each beat is a distinct camera setup and a distinct verb.** If beats 2 and 3
  share a framing and a verb, you have written one beat twice.
- **Open mid-action.** A `first_frame` keyframe biases a static start, because
  the model eases out of the posed frame. Put a motion verb in the first
  segment rather than re-describing the pose you already supplied as an image.
- **Name the cut** when you want an internal cut ("cut to", "hard cut to").
- **Say the opening frame matches the keyframe once**, at the top, then stop
  describing it.
- **Beat count follows the story**, not a fixed "always 3-4". A 30s act runs to
  four to six segments; a pure hold needs fewer. Empty beats stretch into sludge.
- **Close with the invariants.** A single line after the plan, such as
  `Exactly two people in every frame, one KEEPER and one RELIEF, never
  duplicated.`, is cheaper than fighting duplication in every segment.

The 2.0 equivalent, from `films/lighthouse/shots.json` (`s09-trust-turns-light`):

```
The opening frame matches the provided keyframe: close two-shot over the exposed service shaft, THE RELIEF holds one open palm between them, THE KEEPER grips the dark iron key, and the motor is already mounted.
Shot 1: completely locked hand close; after the second horn he looks from the frozen beam to her palm, unclips the key and places it there; <muffled horn, belt clip, one metal chime>.
Shot 2: cut low along the drive; he points out the concealed release, she unlocks the clutch while he holds the broken weight train clear, then she couples the motor; <key turning, clutch clack, coupling lock>.
Shot 3: crane upward through the stairwell as she starts the motor; the flywheel and Fresnel lens turn, and pale bars travel across both faces for the first time; <motor rising, gears catching cleanly, glass resonance, storm wind>.
```

## Bracket semantics

| Marker | Meaning | In this pipeline |
| --- | --- | --- |
| `<…>` | Sound effects / ambience | Yes, diegetic only |
| `(…)` | Music | Never, score mixed at `vs stitch` |
| `{…}` | Spoken dialogue | Rarely, narration is usually post |
| `【…】` | Burned-in subtitles | Never |

End SFX lines with an explicit "no music, no spoken words" when that constraint
matters (silent / VO-over films).

## Constraints without a negative prompt

There is no negative-prompt field. Put exclusions in positive language in
`film.promptPreamble` or the shot: "no readable labels, subtitles, watermark or
on-screen lettering." Repeat only what that shot uniquely must not do.

## Realtime motion

Seedance renders soft vocabulary literally as slow motion. Prefer brisk,
realtime verbs. The linter warns when a prompt piles soft terms.

## Binding references

### The ordinal contract

A 2.5 prompt names each reference's single job by ordinal, and that ordinal is
resolved against the submitted content array. Two ways to get it wrong, both
of which spend the whole generation before you find out:

1. **Ordinals count per media type, not per array index.** In
   `[video, image, image]`, `@Image 1` is the **second** array entry.
2. **A frame role consumes an image ordinal.** `first_frame` and `last_frame`
   are images on the wire, so a shot with a `first_frame` plus two
   `reference_image` entries has its keyframe at `@Image 1` and its packs at
   `@Image 2` and `@Image 3`. Put the frame role first in `references[]`.

The CLI never reorders `references[]`: authored order is what the model sees.
The full contract, and the lints that catch a mis-binding, are in
`shots-schema.md`.

`@Image 1` and `<Image_1>` are both recognised. One job per asset, and say what
the job is. From `examples/shots-2-5.json`, `a1-the-refusal`:

```
THE KEEPER is a lean weathered man in his late sixties with grey stubble, a near-black wool coat, thick dark scarf and black boots, working with deliberate economy and no wasted step; use @Image 1 for his face, build and wardrobe only. THE RELIEF is a woman in her early thirties with cropped dark curls, a pale slick oilskin, black sweater and brown canvas tool roll, still while observing and fast once she acts; use @Image 2 for her face, hair and wardrobe only. Use @Image 3 for the exterior: a remote white stone lighthouse rising vertically out of a treeless headland, its lamp dark, a wet path climbing to a low cottage. Use @Image 4 for the windowless machinery room, its guarded vertical weight chain and its clockwork drive. Use @Image 5 for the single worn chain link, rubbed bright and thin against its neighbours.
```

Five references, five jobs, and the word "only" on each likeness so a face does
not leak into a location. Where an act moves through locations the plates cannot
cover, add **one staging plate per timestamp range** and bind it with "only"
(`@Image 4 for the staging of 12-19s only`); that is what stops the model
averaging three locations into one.

Never compress the binding block to fit a word count. The 2.5 word cap is 700
including `promptPreamble` precisely so a real act plus its bindings fits; if a
prompt is over, trim description, not bindings.

### Modes

| Mode | Wire | Best for |
| --- | --- | --- |
| **A, frame** | `first_frame` (optional `last_frame`) | Literal opening composition, concurrent generates, safe retakes |
| **B, omni** | `reference_image` / `reference_video` / `reference_audio` | Likeness, style, staging, motion, mood packs |
| **A + B** | frame role first, then the packs | 2.5 only: an exact opening frame **and** a subject pack |

On 2.0-family, A and B are mutually exclusive and mixing them is a load-time
error. On 2.5 the combination is what the R2V demos do. There is no third mode:
a shot is anchored by the images you author, never by another shot's last frame.

**Ceilings:** 2.5 allows 30 images / 10 video / 10 audio; the lint soft-warns
above 16 total references. 2.0 hard-caps at 9 / 3 / 3; soft-warn above 5. An
8-14 image pack is the design idiom. The ceiling is not a target.

## Clay and white-model blockout

A supported pattern that needs no new schema: a clay render, grey-box previz, or
white-model animation is just an image or video reference with a specific job.
Bind structure to the blockout and surface to the plates:

```
Refer to @Video 1 (the clay render) for camera movement, pacing, shot-size transitions, subject trajectory and blocking; refer to @Image 2 for materials, lighting, colour and atmosphere.
```

Beyond matching a previz, this buys **physically plausible lighting**: the model
reads spatial structure (volumes, occlusion, floor and wall planes) off the
blockout instead of inferring it from a flat plate, so contact shadows and
falloff land where the geometry says they should.

Use the real `@Image N` / `@Video N` ordinal in the binding, with the friendly
name in parentheses as above. A bare `@Clay Render 1` is invisible to the
ordinal lint, so a mis-count in that prompt goes uncaught.

## Where the shared style lives

`film.promptPreamble` holds the locked look. Per-shot prompts hold only what is
unique to that generation. On a 2.5 film the preamble is also the right place
for the standing ordinal discipline, as in `examples/shots-2-5.json`:

```
Reference images are bound by ordinal: each @Image N is named in the timestamp plan with the one job it does, and is used for nothing else.
```

## Camera language

Prefer concrete camera methods (locked, handheld, crane, orbit, push-in, aerial
pull-back). On 2.5, combined moves in one take are demoed as more stable than on
early 2.0; still name the move rather than hoping the model invents coverage.
Name the move **and** the cut type at each timestamp boundary, so an internal
hard cut does not come out as a whip pan.

## Audio

Per-clip: **diegetic SFX and ambience only**, in `<angle brackets>`. Score and
narration are assembled in post, never baked into a generation prompt:

1. `vs score` for a continuous music bed
2. `vs narrate` from `lines.tsv`, then `vs narrate assemble` for placed VO
3. `vs stitch --music --narration` for the final mix with clip SFX

Keep `generateAudio: true` unless drafting silent.

A `reference_audio` entry is a different thing from the score: it conditions the
generation (a voice timbre, a room tone, a rhythm to cut to) rather than being
mixed into the output. Bind it by ordinal like any other reference.

## In-frame text and signage

Unreliable in-model. Bake legible text into the keyframe still (Nano Banana Pro
when needed). Title cards use the `cards` array in post.

## Video editing operations

Seedance 2.5 takes video as an input, and the schema already carries it:
`{ "type": "video", "url": "...", "role": "reference_video" }`. Local video
paths are allowed on 2.5 under a 20 MB inline ceiling (`vs share` will compress
a clip first), but an https URL is the supported path, because nobody has
confirmed that Ark's `video_url` content type accepts data URLs. There is
deliberately **no `extendFrom` field**: the capability is reachable through the
schema that exists, and a field whose wire name is a guess would be dead JSON.

**Multi-round extend.** Bind the previous act's clip and use the documented R2V
idiom:

```
Extend the video. Continue from the visuals and subjects in @Video 1, keeping the character subjects, scene, visual style and sound effects consistent.
```

Then write the new timestamp plan under it. Each round is a fresh paid
generation.

**Region edit.** Same mechanism: bind the source clip as `@Video 1`, then say
what changes and, in the same breath, what must not. Use it to salvage an act
where the first five beats are right and the sixth is wrong.

Two things to be honest about before reaching for either:

- **Region edit is not a cost saving. It is about 20% dearer.** The token
  formula bills input seconds plus output seconds, so a 30s edit on a 30s source
  is 60s of tokens at the with-video rate of $6.4/M, about **$8.29**, against
  **$6.93** for a fresh 30s pass at $10.7/M. It buys quality, not money.
- **It is same-day only.** The provider's result URL expires in roughly 24
  hours. Past that you need the downloaded clip re-hosted, or a local path
  under the inline ceiling.

Green-screen compositing and camera-perspective edit are the same shape: a
prompt convention over a bound `reference_video`, with no new role to invent.

## Pitfalls

- **Prescriptive clip length.** Do not force every shot to 8s or 30s. Match the
  story unit; stay inside the model envelope.
- **`Shot N:` on a 30s act.** It orders the beats and leaves the rhythm to the
  model. Use a timestamp plan past 20s.
- **One action per generation.** Produces a stretched slow-motion gesture when
  the story needs coverage.
- **Miscounted ordinals.** A `first_frame` is `@Image 1`. Count per media type.
- **Unbound references.** Supplying five images and naming none of them averages
  them together.
- **Trimming the bindings to hit a word cap.** Trim description instead.
- **Subtitle brackets as timecodes.** `【0:00-0:03】` is wrong; use `0-5s:` or
  `[0:00-0:05]`.
- **Contradictions.** Fast action, contemplative camera, calm music.
- **Over-stuffing.** Thirty references is a ceiling, not a target.
- **"You know what I mean".** The model executes literally. Spell it out.
