# From planning docs to JSON

The planning documents in `films/<slug>/` are the source of truth; the JSON is
assembled from them mechanically. This file covers that assembly and the
anchoring decisions it depends on.

The craft of writing the documents themselves (treatment, style bible, beat
sheet, screenplay, shot list) lives in the `storycraft` skill. Do not restate
it here.

## Contents

- [The verbatim-block mechanism](#the-verbatim-block-mechanism)
- [Anchor strategy: keyframe, pack, or both](#anchor-strategy-keyframe-pack-or-both)
- [Reference stills to stills.json](#reference-stills-to-stillsjson)
- [Beats to shots.json](#beats-to-shotsjson)
- [Model and draft settings](#model-and-draft-settings)
- [Narration and titles](#narration-and-titles)

## The verbatim-block mechanism

Character and style drift across generations is the central problem, and the
model has no memory between them. The fix is textual: each reusable element is
written once in `style-bible.md` and reproduced literally wherever it appears.
Never paraphrase, never write "the keeper from the previous shot".

Two places carry those blocks:

- **`film.promptPreamble`** takes everything true of every frame: the style
  block, the standing palette, the recurring character descriptions, the
  realtime-motion instruction, the standing exclusions, and on a 2.5 film the
  standing ordinal discipline ("each `@Image N` is named with the one job it
  does and used for nothing else"). It is prepended to every shot prompt
  automatically, so it is written once in JSON too.
- **The shot prompt** carries only what is unique to that shot: its ordinal
  binding block, its timestamp plan, and any character or prop block that
  appears in this shot and not the whole film.

A shot list may abbreviate with tokens (`{KEEPER}`, `{DUSK}`) for readability.
The CLI does not expand tokens: `shots.json` and `stills.json` must contain the
literal text.

On 2.5 the verbatim block and the reference pack do the same job from two
directions. Keep both: the text survives a reference the model under-weights,
and the reference survives a description the model reads loosely.

## Anchor strategy: keyframe, pack, or both

Decided per shot in the beat sheet, before any JSON exists.

**KEYFRAME (the default).** The shot gets its own still showing its exact
opening composition, referenced as `first_frame`. The model stays in a narrow
lane, glitches drop sharply, and each shot regenerates independently, so a
retake never cascades and the whole film submits concurrently. This is what
`films/lighthouse` uses everywhere.

**OMNI PACK.** Several `reference_image` entries, each bound by ordinal to one
job: a face, a location, the staging of one timestamp range. This is the 2.5
idiom for a 30s act, where no single frame can hold three locations, and it is
what act 1 of `examples/shots-2-5.json` uses. It leaves the opening composition
to the model, so open mid-action and describe the first segment concretely.

**BOTH (2.5 only).** A `first_frame` for the literal opening plus a pack for the
subjects and later staging. Put the frame role **first** in `references[]`: it
is an image on the wire, so it takes `@Image 1` and the packs start at
`@Image 2`. That is act 2 of `examples/shots-2-5.json`. On 2.0-family this
combination is a load-time error.

**A character who only ever appears in frame-mode shots needs no character
still.** That likeness lives in prompt text, so generating a sheet for it burns
an image call for nothing. A character bound as `@Image 1` across several acts
does need one, and one sheet serves all of them.

### Long action across a cut

There is no chaining option. A film longer than one generation is **several
independent acts stitched in post**: each act is a 30s pass with its own
reference pack, each is retakeable without touching its neighbours, and they
generate concurrently up to the model's task limit. Continuity across the cut is
carried by the shared verbatim blocks and by reusing the same plates in both
acts.

Continuing one generation from another's **output video** is a separate path
(`reference_video` plus the R2V extend idiom, see `seedance-prompting.md`). It
is a repair tool, not a structure: it serializes generation, is billed on input
plus output seconds so it is about 20% dearer than a fresh pass, and the
provider's result URL expires in roughly a day.

## Reference stills to stills.json

Every keyframe in the shot list becomes one `stills.json` entry sharing the
shot's id, so `s03-lamp-ignites.png` is unambiguously the keyframe for
`s03-lamp-ignites`. Beyond keyframes, generate a still for each character (one
per age block, if the character ages), each hero prop, and each environment
plate that more than one shot needs.

On a 2.5 act that moves through several locations, add **one staging plate per
timestamp range**. Name them after the act and the moment (`a2-radio-room`,
`a2-lamp-room`, `a2-sea-geography`) so the mapping from plate to segment is
legible in both files, and bind each one to its range and only its range. Three locations in one act need three plates; one
averaged plate produces one averaged location.

A still prompt is the style block, plus the palette, plus the relevant
character or prop block, plus the composition line. For a keyframe that
composition line is the literal opening frame of the shot. For a character
sheet it is "full body character sheet, neutral pose, front and three-quarter
view, plain background". A likeness photo, if you have one, goes in the still's
`references` array; a style-only still with none is valid. Keep a still prompt
under 200 words: it is one composition, not a timed sequence.

When a character ages, generate one sheet per age block and point each shot at
the right one. For a clean age cut, give two consecutive shots the **same**
still as `first_frame`, and make that shared still an empty environment plate
so each shot's prompt paints in its own-age character rather than fighting a
baked-in one.

## Beats to shots.json

Each generation in the beat sheet becomes one shot. Its prompt is:

1. **The binding block.** One sentence per reference, in ordinal order, naming
   the single job that reference does and nothing else. Count ordinals per
   media type, and remember a `first_frame` takes `@Image 1`.
2. **The plan.** On 2.5, the beats as a timestamp plan whose ranges are
   contiguous and cover the whole duration. On 2.0, or on a short multi-cut
   shot, `Shot N:` lines. If the shot has a keyframe, one line at the top saying
   the opening frame matches it, then stop describing it.
3. **The invariants.** A closing line for what must hold in every frame
   ("exactly two people, one KEEPER and one RELIEF, never duplicated").

Then set `references` (keyframe, pack, or both) per the beat sheet, plus
`duration`, `seed`, and `transition`.

Give every shot a `seed`, and use the same seed on the shot and its keyframe
still. That is what lets an approved 480p draft be promoted to a 720p final
without re-rolling the composition.

## Model and draft settings

- **`film.model`** is set explicitly to `dreamina-seedance-2-5-260628` for a 2.5
  film. Omit it and the film is validated and generated as Seedance 2.0: 15s
  ceiling, no local video references, no mixing frame roles with `reference_*`.
- **`film.draftModel` stays unset on a 2.5 film.** `vs generate --draft`
  validates every shot against the draft model, and
  `dreamina-seedance-2-0-fast-260128` is documented at 4-15s, so a 30s film with
  that draft model is refused rather than warned. Unset, `--draft` runs the
  film's own model at 480p with audio off, which is the cheap pass you wanted.
  `--dry-run` surfaces this before you spend anything.
- **`defaults.resolution` is `720p`.** 2.5's console card lists 480p and 720p;
  a 1080p request is reported as a warning (the registry entry is `inferred`)
  and still goes out, but delivery upscaling with `vs upscale` is the intended
  path.

## Narration and titles

Narration lines from the beat sheet never appear in a shot prompt. Generate
them with `vs narrate` from a `lines.tsv`, place them on the cut with
`vs narrate assemble`, then mix at `vs stitch --narration`. Title and era text
becomes `cards` entries placed `after` the relevant shot id.

Cards consume real runtime, so the stitched film is always longer than the
summed clip durations. Report both numbers before a paid run.
