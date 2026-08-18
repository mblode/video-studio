# Seedance prompt craft

How to write the `prompt` string for a shot. **Write for Seedance 2.5**:
timestamp-level narrative, camera, and rhythm control; 30s one-take acts; and
multimodal binding by ordinal (Seed product blog, 2026-07-31). You get it by
default: the CLI's built-in model is `dreamina-seedance-2-5-260628` on BytePlus
ModelArk. Name `bytedance/seedance-2.5` to route through Vercel AI Gateway
instead.

The first-party sources this file follows are the **2.5 prompt guide**
(ModelArk doc 2607689), the **2.5 tutorial** (doc 2607688), and the
**create-task API reference** (doc 1520757). The 2.0 guide (doc 2222480)
remains the origin of the bracket semantics, and 2.0 craft is the same craft
clipped to a 15s envelope. Anything below marked *observed* comes from
community reporting rather than those docs.

For the JSON around the prompt, see `shots-schema.md`. For model ids,
resolutions, and rate limits, see `../../vs/references/models.md`.

## Contents

- [Duration and story units](#duration-and-story-units)
- [Beat carriers](#beat-carriers)
- [Bracket semantics](#bracket-semantics)
- [Constraints and the two blessed negations](#constraints-and-the-two-blessed-negations)
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
| Seedance 2.5 (CLI default) | 4-30s single pass, or `-1` auto | An act: setup, turn, resolution in one generation |
| Seedance 2.0 | 4-15s (or `-1` auto) | One emotional beat or a short multi-cut sequence |

Do **not** prescribe packing every film into 8s, 10-15s, or "always max the
clip." Short inserts, long one-takes, and mid-length multi-cuts are all valid
when they match the beat. Cost scales with duration times resolution: report the
sum, then choose.

Everything is **24fps**, at every resolution, which is what `vs stitch` and
`vs narrate assemble` assume. 2.5 renders 480p, 720p or 1080p; **4K is 2.0
only**. Generate at 720p regardless: 1080p costs 2.25x the tokens for the same
act, and is *observed* by several people to weaken prompt adherence, apparently
because less compute lands per frame. `vs upscale` gets to 1080p afterwards for
free, and only on the shots that survived the edit.

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

**Timestamps are integer seconds.** This is the one hard piece of grammar in the
plan. Doc 2607689 gives the unit as one second ("use 1-second intervals as the
basic unit") and lists `0-3 seconds...3-7 seconds...7-15 seconds` and
`[1s-4s]....[4s-8s]....[8s-12s]` as the accepted spellings. A fractional range
like `[0.0s-4.0s]` is off-grammar. The lint agrees by accident and usefully: its
range pattern wants digits either side of the dash, so a fractional plan matches
neither it nor the `[0:00` bracket form, and a 30s act written that way reports
as **having no beat carrier at all**. Treat that warning on a prompt that
visibly has beats as a sign the timestamps are mis-spelled. Ranges must also be
**contiguous**: the same doc calls out "avoid gaps such as '0-3s... 5-6s...'",
because the model fills an unclaimed second with whatever it likes.

Two other clock controls exist and are worth knowing, both from 2607689:

- **A time point rather than a range.** "Quick left sideways transition at the
  5-second mark."
- **Relative time.** "The frame freezes for 1 second after the main character
  presses the shutter." Useful for a beat whose trigger matters more than its
  absolute position.

What timestamps will not do is drive **high-frequency action**. The doc is
explicit: do not write "shake your head three times per second."

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
- **Describe actions generally; save the detail for a few beats.** Counter to
  the instinct the Pitfalls list ends on, doc 2607689 asks for general action
  descriptions ("doing several sets of high-knee raises and somersaults") and
  says to "only write specific details for a few memorable actions, and avoid
  repeating the same actions". Reconcile the two like this: **be literal about
  identity, continuity, and staging; be broad about choreography.** What the
  model must not drift on gets spelled out. What it is good at inventing gets a
  verb and room.
- **Close with the invariants.** A single line after the plan, such as
  `Exactly two people in every frame, one KEEPER and one RELIEF, never
  duplicated.`, is cheaper than fighting duplication in every segment.

### How long a beat should be

**Four to seven seconds per segment on a 30s act.** Both ends of that range are
load-bearing, and doc 2607689 names both failures:

- **Too little in a range** and "the model may improvise more freely". That is
  the sludge you already know: one verb stretched into slow motion.
- **Too much in a range** and the result "may contain excessive cuts or omit
  parts of the plot". The act does not just get busy, it silently drops beats
  you paid for.

ByteDance's own worked examples run tighter than this, around 2.5-4s a beat (the
flagship 30s example is nine shots). Take that as the floor, not the target.
*Observed:* prompts carried over from 2.0, which tend toward rapid
one-second-style cutting, degrade visibly on 2.5, and acts given room to breathe
come back better. 2.5 punishes over-segmentation harder than 2.0 did, so when a
30s act feels thin the fix is more story, never more cuts.

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

When a film needs the model to stay off music and speech, say so in the
provider's own words: **"No BGM; generate only environmental sounds and action
sounds."** Do **not** write "no music, no spoken words". That exact string
tripped the content filter twice on a real film in
`../video-studio-films/smorgon-bros`, costing 3 and 6 retries, and the official
phrasing above does the same job without it.

## Constraints and the two blessed negations

There is **no `negative_prompt` field**, on any route: doc 1520757's parameter
list is `model`, `content`, `ratio`, `duration`, `resolution`, `output_format`,
`watermark`, `seed`, `camera_fixed`, `generate_audio`,
`omni_reference_task_type`, `callback_url`, `safety_identifier` and
`execution_expires_after`, and nothing else.

In-prompt negation is another matter, and it splits into three tiers.

**Officially supported, and reliable: subtitles and audio.** Doc 2607689 says
to "use positive descriptions whenever possible" but that "negative constraints
are supported for subtitles and audio control", with worked forms:

```
No subtitles.
No BGM; generate only environmental sounds and action sounds.
No audio.
```

Use these directly rather than paraphrasing them positively. They are the one
place a bare negation is documented to work.

**Undocumented but demonstrated first-party: visual exclusion.** ByteDance's
own showcase prompts carry a bracketed block, which is worth copying as a
format if a look keeps leaking:

```
[Strictly exclude] Black-and-white, monochrome, desaturated visuals; hand-drawn, sketch, line art; storyboard frames; tilt-shift miniature look, plastic CG, glossy overexposed CG.
```

**Everything else: positive language.** For anything not covered above, state
what the frame *does* contain in `film.promptPreamble` or the shot ("no readable
labels, subtitles, watermark or on-screen lettering" reads as a negation but is
really an inventory). Repeat only what that shot uniquely must not do. Prefer a
production-specific invariant, which the model holds far better than a blanket
prohibition: `Exactly two boys in every frame, one Eric and one Victor, with
clear air between them and no duplicates.` beats "no duplicated characters".

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

**Do not re-describe a reference that is already accurate.** Doc 2607689: "when
the reference asset itself is sufficiently accurate, simply state that it should
be referenced and avoid repeatedly describing the scene in detail." This is not
in tension with the fully-expanded rule, once you split what each half is for.
The **text** carries identity, continuity, and what changes over the act,
because the model has no memory between generations and may under-weight an
image. The **plate** carries composition, palette, and the geometry of a room.
Re-narrating a composition the plate already supplies spends words that the
timestamp plan needs, and gives the model two sources to average.

**Bind decomposed references, not composed target frames.** *Observed, from two
independent reports:* feeding a fully composed storyboard frame makes the model
treat it as a keyframe it has to converge on, which reads fine while the camera
holds and turns into visible morphing the moment blocking or camera position
moves away from it. What works instead is decomposition: the subject alone on a
clean background, plus the location plate with no people in it. This is an
argument *for* the per-range staging plate above, which is a location, and
against pre-composing your characters into it.

Never compress the binding block to fit a word count. The 2.5 word cap is 700
including `promptPreamble` precisely so a real act plus its bindings fits; if a
prompt is over, trim description, not bindings.

**What the word cap is actually protecting you from.** The provider's own
ceiling is higher than ours: doc 1520757 asks for "no more than 500 Chinese
characters or 1,000 English words", and names the failure precisely. An
over-long prompt does not error. It causes "scattered information", and the
model "may ignore details and only focus on key points, resulting in missing
elements in the generated video" - **silent dropout**, discovered only after you
have paid for the clip. ByteDance's own worked examples measure roughly 330-520
words. So: **aim at 300-550 words for a 30s act**, treat our 700 as a backstop
rather than a target, and read a prompt pushing the cap as a sign the act is
carrying two acts' worth of story.

### Modes

| Mode | Wire | Best for |
| --- | --- | --- |
| **A, frame** | `first_frame` (optional `last_frame`) | Literal opening composition, concurrent generates, safe retakes |
| **B, omni** | `reference_image` / `reference_video` / `reference_audio` | Likeness, style, staging, motion, mood packs |
| **A + B** | frame role first, then the packs | 2.5 only: an exact opening frame **and** a subject pack |

On 2.0-family, A and B are mutually exclusive and mixing them is a load-time
error. On 2.5 the combination is what the R2V demos do. There is no third mode:
a shot is anchored by the images you author, never by another shot's last frame.

**A frame role locks the aspect ratio and silently overrides `ratio`.** Doc
1520757 forces `ratio` to `adaptive` for first-frame, first-and-last-frame,
video-edit and video-extend tasks, and defines adaptive as "keep the aspect
ratio of the output video consistent with that of the first-frame image". The
consequence bites hardest on a vertical film: **a 9:16 shot anchored by a
`first_frame` needs its keyframe still authored 9:16** (720x1280 or 1080x1920),
because `"ratio": "9:16"` on the shot will not survive. Mode B has no such
lock, so a pure `reference_image` pack is the way to set the ratio explicitly.
Video edit also forces `duration: -1`.

**Ceilings:** 2.5 allows 30 images / 10 video / 10 audio; the lint soft-warns
above 16 total references. 2.0 hard-caps at 9 / 3 / 3; soft-warn above 5. An
8-14 image pack is the design idiom. The ceiling is not a target.

### Keyframe references, the official form

Where our house idiom binds a staging plate in the header block ("use @Image 4
for the staging of 12-19s only"), doc 2607689 documents two stronger forms for
when the act must follow the plates rather than merely be informed by them.

**Ordered keyframes.** When the video must strictly follow a storyboard, supply
each panel as its own reference in order and open the prompt with the binding:

```
Use Images 1 to 7 in order as keyframes.
```

**Per-range keyframes.** Bind the plate inline at the beat it governs, which is
the official spelling of what our header-block idiom does at a distance:

```
0-3s (reference: @Image 2): ...
3-5s (reference: @Image 3): ...
10-19s (references: @Image 6, @Image 7): ...
```

Both are still ordinal bindings, so everything in the contract above applies,
and the lint counts them like any other. Two limits the same doc gives: a
storyboard "will not be followed exactly frame by frame, and the generated video
retains a degree of autonomy", and multi-panel boards are "better suited for 15
panels or fewer" before the model starts emitting still frames or reordering
them. Do not write a character's name onto their panel and then refer to the
name in the prompt: the mapping belongs in the text, and a label baked into the
image "can easily cause character confusion or duplication".

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

**One principal move per beat.** *Observed, and consistent across every vendor
guide:* stacking moves inside a single segment is what produces the mush.
"Backward track plus a quick left pan plus a slight zoom" is three grammars
competing for the same three seconds; pick the one that carries the story turn
and let the rest be implied by the framing. The named failure mode is
*conflicting grammars*, a beat asking for drone, handheld, locked and orbit at
once. A beat that genuinely needs two moves is usually two beats.

**Transitions need a trigger and a method, not just a moment.** Doc 2607689:
"for transition shots, clearly specify both the trigger point and the transition
method", as in "at the 5-second mark, the camera quickly transitions leftward
using a left wipe combined with a natural dissolve". Where the timing matters
less than the cause, tie the move to the event instead of the clock: "the camera
does not pan until the ball has fully left both hands."

**Spell out any term the model may not know.** Doc 2607689 asks that "overly
niche or technical terms" be converted into `[term + descriptive explanation]`,
and gives the pattern: "rack focus: the focus shifts smoothly; the trees that
were originally clear in the foreground become blurred, while the character in
the background gradually becomes clear." Cheap insurance on anything more exotic
than the vocabulary listed above. Note this repo does not track focal length,
because the model has no literal lens.

## Audio

Per-clip: **diegetic SFX and ambience only**, in `<angle brackets>`. Score and
narration are assembled in post, never baked into a generation prompt:

1. `vs score` for a continuous music bed
2. `vs narrate` from `lines.tsv`, then `vs narrate assemble` for placed VO
3. `vs stitch --music --narration` for the final mix with clip SFX

Keep `generateAudio: true` unless drafting silent.

A `reference_audio` entry is a different thing from the score: it conditions the
generation (a voice timbre, a room tone, a rhythm to cut to) rather than being
mixed into the output. Bind it by ordinal like any other reference. 2.5 will
take audio as the *only* reference, with no image or video alongside it, which
2.0 would not.

Audio costs nothing extra: the bill is the same whether or not you generate it,
so there is no cost argument for drafting silent.

### Speech, and which languages actually work

These films are usually dialogue-free, and the pipeline puts narration in post,
so this rarely comes up. When it does, the language matters more than the
syntax.

2.5 generates native audio, including lip-synced dialogue, in **Chinese,
English, Spanish, Indonesian, Malay, Thai, Arabic, Portuguese, Vietnamese,
Japanese and Korean** (docs 2607688 and 1520757). **French, German, Italian and
Russian are on neither list.** Third-party guides claiming otherwise contradict
the first-party docs; treat them as wrong until a real generation says
different.

For a language off that list, ask for **non-lexical performance** in an English
prompt rather than a scripted line: `friends laughing and shouting excitedly in
French` will give you the texture, where `{French: "Allez, saute!"}` is asking
for phoneme-accurate lip-sync the model does not document supporting. For a
language on the list, doc 2607688 asks that you "specify the language before the
dialogue".

Attribute a spoken line to its speaker inside the beat that carries it, the way
the official examples do: `Dialogue (elderly woman): "Fly safe, my child."`

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

**Bind only the last 2 to 3 seconds of the previous clip, not the whole thing.**
*Observed, and expensive to learn:* the model spends output seconds
re-establishing whatever you hand it, so a 7s tail bound to a 20s generation
came back with its first 7 seconds regenerating footage the author already had.
The tail is motion and continuity reference; it does not need to be the act.
Note the token formula bills input seconds too, so a long tail is charged twice,
once at the input rate and again as the output it displaces.

*Observed:* several people report skipping the provider's extend endpoint
entirely and getting better results by binding the previous clip's last frame,
or its last few seconds, as an ordinary omni reference alongside the film's
usual pack. Expect a slight reframe between rounds either way.

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
- **Fractional timestamps.** `[0.0s-4.0s]` is off-grammar and invisible to the
  lint. Integer seconds only.
- **Over-segmenting a 30s act.** Ten three-second beats is the 2.5-specific
  failure: excessive cuts, and dropped beats you paid for. Four to seven
  seconds a segment.
- **Stacking camera moves in one beat.** Pick the move that carries the turn.
- **Composed target frames as references.** They morph as soon as the camera
  leaves them. Bind the subject and the empty location separately.
- **Binding a whole previous clip to extend.** Two to three seconds of tail.
- **Photographs of real people as video references.** BytePlus rejects them
  outright, and on a stylised film they drag the whole pass toward photoreal.
  Generate a still from the photograph and bind the still.
- **Contradictions.** Fast action, contemplative camera, calm music.
- **Over-stuffing.** Thirty references is a ceiling, not a target.
- **"You know what I mean".** The model executes literally, so be literal about
  identity, continuity and staging. Choreography is the exception: describe it
  generally and let the model invent inside the verb.
