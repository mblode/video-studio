# Seedance 2.0 prompt craft

How to write the `prompt` string for a shot. Everything here tracks the official
BytePlus ModelArk prompt guide (doc 2222480, updated 2026-07-17), with this
repo's own measured findings noted where they go further.

For the JSON around the prompt, see `shots-schema.md`. For model ids,
resolutions, and rate limits, see `../../vs/references/models.md`.

## Contents

- [The shot-beat form](#the-shot-beat-form)
- [Bracket semantics](#bracket-semantics)
- [Constraints without a negative prompt](#constraints-without-a-negative-prompt)
- [Realtime motion](#realtime-motion)
- [Binding references](#binding-references)
- [Where the shared style lives](#where-the-shared-style-lives)
- [Camera language](#camera-language)
- [Audio](#audio)
- [In-frame text and signage](#in-frame-text-and-signage)
- [Video editing operations](#video-editing-operations)
- [Pitfalls](#pitfalls)

## The shot-beat form

Write **3 to 4 beats per generation**, each one a `Shot N:` line:

```
Shot 1: [camera method]; [subject actions]; [position or spatial relation]; [audio].
Shot 2: [camera method]; [subject actions]; [position or spatial relation]; [audio].
Shot 3: ...
```

That slot order is the framework: camera, then action, then where it sits in
frame, then sound. Front-load it and the model prioritises correctly.

**Do not use second-level timecodes.** The official guide warns that timing
phrased as "0-3 seconds" causes instability, and `【square brackets】` are
reserved for subtitles, so a bracketed ASCII timecode is doubly wrong. `Shot N:`
is the documented carrier for the same intent.

Why multiple beats matter, measured on this repo's clips: single-action
generations produced **0 internal scene-change events**, one continuous
stretched gesture that reads as slow motion. Multi-beat generations produced
**1 to 4**, which is what internal cuts, reframes, and realtime pace look like.
Per-frame pixel motion was almost identical between the two, so the missing
internal events were the whole difference. `Shot N:` is documented to produce
exactly those internal cuts.

Rules that follow:

- **Each beat is a distinct camera setup and a distinct verb.** If beats 2 and 3
  share a framing and a verb, you have written one beat twice.
- **Open mid-action.** A `first_frame` keyframe biases a static start, because
  the model eases out of the posed frame. Put a motion verb in beat 1 rather
  than re-describing the pose you already supplied as an image.
- **Name the cut.** "cut to", "hard cut to" at the head of a beat is what
  separates an internal cut from a lazy reframe.
- **Say the opening frame matches the keyframe once**, at the top, then stop
  describing it.

A shot from the demo film, verbatim (`films/lighthouse/shots.json`,
`s10-beam-returns`):

```
The opening frame matches the provided keyframe: close two-shot over exposed gears as THE KEEPER offers the brass winding key across to THE RELIEF, his left palm wrapped, her service motor ready beside the flywheel.
Shot 1: locked close; she accepts the key with both hands, their eyes meet, then he points the key toward the hidden clutch release; <key ring chiming once, alarm bell stopping>.
Shot 2: cut low along the drive; he braces the clutch open with his good hand while she locks the motor coupling onto the shaft and turns it on, their hands moving in one rhythm; <clutch clack, electric motor rising, gears catching cleanly>.
Shot 3: crane upward through the stairwell into the lamp room; the Fresnel lens begins turning again and the amber beam moves off the cliff, sweeps through rain and crosses their faces below; <steady mechanical turn, glass resonance, wind>.
```

Each beat changes camera, verb, and story state. The prompt also carries the
hero-prop handover and the characters' first shared action without asking the
model to infer either from another generation.

## Bracket semantics

Seedance reads four bracket types as typed content, not decoration. The wrong
pair puts your text on screen as a subtitle.

| Bracket              | Means         | Use in this pipeline                                 |
| -------------------- | ------------- | ---------------------------------------------------- |
| `(parentheses)`      | music         | Never. The score is mixed at `vs stitch`             |
| `<angle brackets>`   | sound effects | Yes. The per-beat diegetic audio cue                 |
| `{curly braces}`     | dialogue      | Rarely. Narration is recorded and mixed in post      |
| `【square brackets】` | subtitles     | Never. Titles are rendered as `cards` at stitch time |

Per-clip audio is SFX and ambience only, so `<...>` is the only pair a shot
prompt normally needs. Asking the model for music or dialogue fights the post
mix (see `../../vs/references/audio-mix.md`).

Angle brackets are overloaded: `<Image_1>` and `<Video_1>` are also the
reference binding form (below). Context separates them, but keep SFX cues to
plain sound descriptions so nothing is ambiguous.

## Constraints without a negative prompt

Seedance has **no negative prompt field**. "no X" scattered through a prompt is
ignored and only costs you words. The guide publishes explicit constraint
phrasings instead; use these:

- `keep it subtitle-free`
- `avoid generating any text or subtitles`
- `do not generate a logo`
- `do not generate a watermark`

Everything else is framed positively: describe the state you want, not the one
you want gone. "an empty deserted quay" beats "no people". Put the standing
exclusions in `film.promptPreamble` once rather than in every shot.

## Realtime motion

Seedance renders soft vocabulary literally as slow motion. Avoid **slow,
slowly, gently, tender, holds, drift, creep, languid, soft**. `lintShotsFile`
warns past two such terms in one prompt.

Direct the pace instead: strides, hauls, spins, scythes, detonating. A
"realtime speed, lively, not slow motion" line in the preamble is cheap global
insurance. There is no motion-strength parameter in the API; pace comes only
from verbs, the beat count, and (on text-to-video shots) `cameraFixed`.

## Binding references

The CLI passes references in array order. The official binding forms:

```
Reference <Subject_1> in <Image_1> to generate a wide shot of the quay at dawn.
```

When the subjects are not pre-defined, bind them explicitly:

```
<Subject_1>@<Image_1>, <Subject_2>@<Image_2>
```

Always say what each reference contributes ("Image 1 for the face and hair
only, not the clothing"). A reference named without a purpose is a reference
the model interprets freely.

Frame-mode shots (`continueFrom`, `first_frame`, `last_frame`) carry no
`reference_*` entries at all, so their character descriptions live in the
prompt text. `shots-schema.md` has the exclusivity rule.

## Where the shared style lives

`film.promptPreamble` is auto-prepended to every shot prompt, blank-line
joined. It is the colour script: palette, weather, character descriptions, the
realtime-motion instruction, and the standing exclusions, all written once.

Per-shot prompts then carry only what is unique to that shot, which is what
keeps them inside the word budget (`lintShotsFile` warns past 400 words,
counting the preamble). The demo film's preamble is a good length reference.

Keep character descriptions literal and unchanging. The model has no memory
across generations, so "the keeper from the previous shot" names nobody.

## Camera language

Name the move and the shot size in real cinematography terms inside each beat:
wide, medium, close, over-the-shoulder, POV; dolly, track, pan, tilt, crane,
push in; low, high, eye-level. "the camera moves around" gives the model
nothing.

Match camera energy to the action and the audio. A calm beat with a frantic
camera is a contradiction, and contradictions are the main failure mode.

For a genuinely locked camera, `cameraFixed: true` sends `camera_fixed`. It is
**rejected in image-to-video mode**, so any shot with a `first_frame` or a
`reference_image` locks the camera in prompt text instead ("the camera
completely static on a tripod for the whole beat", as `s03-lamp-ignites` does).
The linter warns if you combine the two.

## Audio

One `<...>` cue per beat, diegetic only: what a microphone in that room would
pick up. Time the cue to the action it belongs to. Keep `generateAudio: true`
so the cues are actually produced; setting it false to "avoid music" is the
wrong lever, because music is never generated in-model anyway.

## In-frame text and signage

Seedance misspells proper nouns. A hull name reading `MARY JANE` in your
keyframe comes back as `MARV JANF`.

So **bake all in-frame signage into the keyframe still** with Nano Banana Pro,
which renders legible text reliably (see `../../nano-banana-2/`), and in the
video prompt only say "the sign matches the first frame". Titles, credits, and
captions are never generated at all: they are `cards` rendered at stitch time.

## Video editing operations

Seedance also accepts editing instructions against an existing video. The
official phrasings:

```
At [Timestamp] and [Location] of <Video_1>, add [Element]
Remove [Element] from <Video_1>, keeping the rest unchanged
Extend <Video_1> forward/backward to generate [description]
```

The `vs` CLI does not drive these: it submits generations, not edits. They are
recorded here because a shot prompt that drifts into edit phrasing ("remove the
gulls") reads as an edit instruction with no video to edit.

## Pitfalls

- **Timecoded beats.** `[0:00-0:03]` is unstable and collides with subtitle
  brackets. Use `Shot N:`.
- **One action per generation.** Produces a stretched slow-motion gesture.
  Three to four beats.
- **Vague references.** "Use Image 1" without saying for what.
- **Contradictions.** Fast action, contemplative camera, calm music.
- **Over-stuffing.** Twelve near-identical references plus 500 words. Fewer
  high-impact references and a structured prompt beat both.
- **Over-long action.** 4 to 15s per generation. A beat that needs more is
  another shot.
- **"You know what I mean".** The model executes literally. Spell it out.
