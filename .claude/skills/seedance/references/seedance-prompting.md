# Seedance prompt craft

How to write the `prompt` string for a shot. **Seedance 2.5 is the gold
standard** — timestamp-level narrative/camera/rhythm control, one-take arcs,
and multimodal binding (Seed product blog, 2026-07-31). Seedance 2.0 still runs
today as the CLI default until ModelArk exposes 2.5; use the same craft, clipped
to that model's duration envelope. BytePlus ModelArk 2.0 guide (doc 2222480)
remains useful for bracket semantics and reference binding.

For the JSON around the prompt, see `shots-schema.md`. For model ids,
resolutions, and rate limits, see `../../vs/references/models.md`.

## Contents

- [Duration and story units](#duration-and-story-units)
- [Beat carriers](#beat-carriers)
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

## Duration and story units

Let the **story unit** pick the duration; do not force a house style length.

| Model | Envelope | Typical use |
| --- | --- | --- |
| Seedance 2.0 (default) | 4–15s (or `-1` auto) | One emotional beat or a short multi-cut sequence |
| Seedance 2.5 | 4–30s single pass | One-take arcs: setup → turn → resolution in one generation |

Do **not** prescribe packing every film into 8s, 10–15s, or “always max the
clip.” Short inserts, long one-takes, and mid-length multi-cuts are all valid
when they match the beat. Cost scales with duration × resolution — report the
sum, then choose.

On 2.5, a single pass can hold a miniature narrative (dressing room → corridor →
stage) rather than one frozen gesture. On 2.0, stay inside 15s and split when
the arc needs more.

**Multi-round extend** (continue from a prior generation's output video) is a
2.5 product path for films longer than 30s. It is **out of scope for this CLI**
until ModelArk documents the API — note it in planning, do not wire it in JSON.

## Beat carriers

Give the model **distinct camera setups and verbs** so it does not stretch one
action into slow motion. Two carriers are both official / demoed:

**Timestamp plan** (Seedance 2.5 official demos; best for one-take arcs):

```
0–4s: Close on hands lacing boots in a dim dressing room; locked medium, warm tungsten; <fabric rustle, distant crowd muffled>.
5–12s: Track backward as she stands and crosses to the mirror; camera rises to reveal full costume; she meets her own eyes; <footsteps on wood, mirror creak>.
13–22s: Hard cut to corridor — handheld follow behind her as she pushes through a stage door into blinding amber light; crowd roar swells; <door slam, crowd surge, no music>.
```

Use `0–5s:` / `6–10s:` ranges (or `[0:00-0:05]`) to pin narrative turn, camera
method, and rhythm within one generation. Each segment should change setup or
verb — same rule as `Shot N:`.

**Shot-beat form** (BytePlus 2.0 guide; lighthouse demo):

```
Shot 1: [camera method]; [subject actions]; [position or spatial relation]; [audio].
Shot 2: [camera method]; [subject actions]; [position or spatial relation]; [audio].
Shot 3: ...
```

ASCII `[0:00-0:03]` is fine. Avoid `【square brackets】` — that channel is
reserved for subtitles.

Slot order is still camera → action → frame position → sound. Front-load it.

Why multiple beats matter, measured on this repo's clips: single-action
generations produced **0 internal scene-change events**, one continuous
stretched gesture that reads as slow motion. Multi-beat generations produced
**1 to 4**, which is what internal cuts, reframes, and realtime pace look like.

Rules that follow:

- **Each beat is a distinct camera setup and a distinct verb.** If beats 2 and 3
  share a framing and a verb, you have written one beat twice.
- **Open mid-action.** A `first_frame` keyframe biases a static start, because
  the model eases out of the posed frame. Put a motion verb in beat 1 rather
  than re-describing the pose you already supplied as an image.
- **Name the cut** when you want an internal cut ("cut to", "hard cut to").
- **Say the opening frame matches the keyframe once**, at the top, then stop
  describing it.
- **Beat count follows the story**, not a fixed “always 3–4.” A pure hold may
  need fewer; a montage needs more. Empty beats stretch into sludge.

A shot from the public demo (`films/lighthouse/shots.json`, `s10-beam-returns`):

```
The opening frame matches the provided keyframe: close two-shot over exposed gears as THE KEEPER offers the brass winding key across to THE RELIEF, his left palm wrapped, her service motor ready beside the flywheel.
Shot 1: locked close; she accepts the key with both hands, their eyes meet, then he points the key toward the hidden clutch release; <key ring chiming once, alarm bell stopping>.
Shot 2: cut low along the drive; he braces the clutch open with his good hand while she locks the motor coupling onto the shaft and turns it on, their hands moving in one rhythm; <clutch clack, electric motor rising, gears catching cleanly>.
Shot 3: crane upward through the stairwell into the lamp room; the Fresnel lens begins turning again and the amber beam moves off the cliff, sweeps through rain and crosses their faces below; <steady mechanical turn, glass resonance, wind>.
```

Each beat changes camera, verb, and story state.

## Bracket semantics

| Marker | Meaning | In this pipeline |
| --- | --- | --- |
| `<…>` | Sound effects / ambience | Yes — diegetic only |
| `(…)` | Music | Never — score mixed at `vs stitch` |
| `{…}` | Spoken dialogue | Rarely — narration is usually post |
| `【…】` | Burned-in subtitles | Never |

End SFX lines with an explicit “no music, no spoken words” when that constraint
matters (silent / VO-over films).

## Constraints without a negative prompt

There is no negative-prompt field. Put exclusions in positive language in
`film.promptPreamble` or the shot: “no readable labels, subtitles, watermark or
on-screen lettering.” Repeat only what that shot uniquely must not do.

## Realtime motion

Seedance renders soft vocabulary literally as slow motion. Prefer brisk,
realtime verbs. The linter warns when a prompt piles soft terms.

## Binding references

### Mode A vs Mode B (pick one)

| Mode | Wire | Best for | Tradeoff |
| --- | --- | --- | --- |
| **A — Frame** | `first_frame` (optional `last_frame`) | Literal opening composition, concurrent generates, safe retakes | Cannot attach `reference_*` on the same shot |
| **B — Omni** | `reference_image` / `reference_video` / `reference_audio` only | 2.5 multimodal packs (face, wardrobe, motion, mood) | No `first_frame`; bind ordinals carefully in the prompt |

Default to Mode A for film pipelines in this repo. Use Mode B when the shot
needs a likeness/style/motion pack that a single keyframe cannot hold.
`continueFrom` is neither — it is local last-frame chaining, **not** product
R2V extend (`@Video 1` continue). Prefer Mode A + stitch until ModelArk
documents extend.

Name what each reference is for (`@Image 1` / `<Image_1>` for face only, etc.).
One job per asset. Content-array order matches `@Image N` ordinals.

**Ceilings:** Seedance 2.5 product allows up to **30 / 10 / 10** (image/video/audio).
CLI soft-warns above **~12** total. Seedance 2.0 platform hard-cap is **9 / 3 / 3**;
soft-warn above **~5**. Do not max the product ceiling for its own sake.

Clay / white-model prep, green-screen compositing, and region edit on existing
video are **2.5 product capabilities** (Seed blog, 2026-07-31). In this
pipeline they are **prompt + media conventions only** — describe the effect in
the prompt and supply the right reference still or https video URL. Do **not**
invent `role` values the schema rejects; region edit is not a generation prompt
when you have no source video to edit.

## Where the shared style lives

`film.promptPreamble` holds the locked look. Per-shot prompts hold only what is
unique to that generation.

## Camera language

Prefer concrete camera methods (locked, handheld, crane, orbit, push-in). On
2.5, combined moves in one take are demoed as more stable than on early 2.0;
still name the move rather than hoping the model invents coverage.

## Audio

Per-clip: **diegetic SFX and ambience only**, in `<angle brackets>`. Score and
narration are assembled in post — never baked into a generation prompt:

1. `vs score` — continuous music bed
2. `vs narrate` from `lines.tsv`, then `vs narrate assemble` — placed VO
3. `vs stitch --music --narration` — final mix with clip SFX

Keep `generateAudio: true` unless drafting silent.

## In-frame text and signage

Unreliable in-model. Bake legible text into the keyframe still (Nano Banana Pro
when needed). Title cards use the `cards` array in post.

## Video editing operations

Seedance 2.5 product demos show timestamped edit, green-screen compositing, and
camera-perspective edit **on existing video**. The `vs` CLI submits fresh
generations only — do not phrase a region edit into a prompt that has no source
video bound as `reference_video`.

For films longer than 30s, the product offers **multi-round extend** (continue
from a prior output). That path is **future/product-only** here: until ModelArk
ships the API, plan longer work as keyframed shots stitched in post, not extend
chains in JSON.

## Pitfalls

- **Prescriptive clip length.** Do not force every shot to 8s or 15s. Match the
  story unit; stay inside the model envelope.
- **One action per generation.** Produces a stretched slow-motion gesture when
  the story needs coverage.
- **Subtitle brackets as timecodes.** `【0:00-0:03】` is wrong; use `0–5s:` or
  `Shot N:`.
- **Vague references.** "Use Image 1" without saying for what.
- **Contradictions.** Fast action, contemplative camera, calm music.
- **Over-stuffing.** Too many references plus a novel-length prompt.
- **"You know what I mean".** The model executes literally. Spell it out.
