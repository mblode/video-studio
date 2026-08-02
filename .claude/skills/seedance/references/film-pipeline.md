# From planning docs to JSON

The planning documents in `films/<slug>/` are the source of truth; the JSON is
assembled from them mechanically. This file covers that assembly and the
anchoring decisions it depends on.

The craft of writing the documents themselves (treatment, style bible, beat
sheet, screenplay, shot list) lives in the `storycraft` skill. Do not restate
it here.

## Contents

- [The verbatim-block mechanism](#the-verbatim-block-mechanism)
- [Anchor strategy: keyframe or chain](#anchor-strategy-keyframe-or-chain)
- [Reference stills to stills.json](#reference-stills-to-stillsjson)
- [Beats to shots.json](#beats-to-shotsjson)
- [Narration and titles](#narration-and-titles)

## The verbatim-block mechanism

Character and style drift across generations is the central problem, and the
model has no memory between them. The fix is textual: each reusable element is
written once in `style-bible.md` and reproduced literally wherever it appears.
Never paraphrase, never write "the keeper from the previous shot".

Two places carry those blocks:

- **`film.promptPreamble`** takes everything true of every frame: the style
  block, the standing palette, the recurring character descriptions, the
  realtime-motion instruction, the standing exclusions. It is prepended to
  every shot prompt automatically, so it is written once in JSON too.
- **The shot prompt** carries only what is unique to that shot, plus any
  character or prop block that appears in this shot and not the whole film.

A shot list may abbreviate with tokens (`{KEEPER}`, `{DUSK}`) for readability.
The CLI does not expand tokens: `shots.json` and `stills.json` must contain the
literal text.

## Anchor strategy: keyframe or chain

Decided per shot in the beat sheet, before any JSON exists.

**KEYFRAME (the default, and what the demo film uses everywhere).** The shot
gets its own still showing its exact opening composition, referenced as
`first_frame`. The model stays in a narrow lane, glitches drop sharply, and
each shot regenerates independently, so a retake never cascades and the whole
film submits concurrently.

**CHAIN (last resort).** `continueFrom: "<earlier-id>"` opens the shot on the
previous shot's last frame. Reach for it only when continuous action across a
cut genuinely needs that exact frame. The costs are real: generation
serializes, a retake invalidates every cached frame downstream, and the seam is
where most transition glitches appear. `lintShotsFile` warns on every one.

Constraints that shape the choice:

- **Frame mode cannot mix with reference roles.** A chained shot, or any shot
  with an explicit `first_frame`, carries no `reference_*` entries. If a beat
  needs both a fresh reference and exact continuity, make it a keyframe shot
  and carry the continuity in prompt text.
- **Chain at most 3 deep** before re-anchoring from a still.
- **A character who only ever appears in frame-mode shots needs no character
  still.** That likeness lives in prompt text, so generating a sheet for it
  burns an image call for nothing.

## Reference stills to stills.json

Every keyframe in the shot list becomes one `stills.json` entry sharing the
shot's id, so `s03-lamp-ignites.png` is unambiguously the keyframe for
`s03-lamp-ignites`. Beyond keyframes, generate a still for each character (one
per age block, if the character ages), each hero prop, and each environment
plate that more than one shot needs.

A still prompt is the style block, plus the palette, plus the relevant
character or prop block, plus the composition line. For a keyframe that
composition line is the literal opening frame of the shot. For a character
sheet it is "full body character sheet, neutral pose, front and three-quarter
view, plain background". A likeness photo, if you have one, goes in the still's
`references` array; a style-only still with none is valid.

When a character ages, generate one sheet per age block and point each shot at
the right one. For a clean age cut, give two consecutive shots the **same**
still as `first_frame`, and make that shared still an empty environment plate
so each shot's prompt paints in its own-age character rather than fighting a
baked-in one.

## Beats to shots.json

Each generation in the beat sheet becomes one shot. Its prompt is the beats
written as a timestamp plan or in `Shot N:` form (both are valid; see
`seedance-prompting.md`), preceded by a single line saying the opening frame
matches the keyframe. Set `references`
(keyframe) or `continueFrom` (chain) per the beat sheet, then `duration`,
`seed`, and `transition`.

Give every shot a `seed`, and use the same seed on the shot and its keyframe
still. That is what lets an approved 480p draft be promoted to a 720p final
without re-rolling the composition.

## Narration and titles

Narration lines from the beat sheet never appear in a shot prompt. Generate
them with `vs narrate` from a `lines.tsv`, place them on the cut with
`vs narrate assemble`, then mix at `vs stitch --narration`. Title and era text
becomes `cards` entries placed `after` the relevant shot id.

Cards consume real runtime, so the stitched film is always longer than the
summed clip durations. Report both numbers before a paid run.
