# Style bible

The film's continuity and tone backbone. It holds the reusable blocks every
prompt draws from, so a good one keeps the look consistent across generations
and makes the audience read the same person, place, and prop every time.

This file is about the craft of those blocks: what makes a good one, and what
makes a coherent look bible. The verbatim-paste mechanism (where the blocks
land in JSON, how `promptPreamble` works) lives in the seedance skill; do not
restate it here.

Write each element once, vivid and tight, then reuse it. A weak block drifts; a
strong block locks.

## Contents

- [STYLE block](#style-block)
- [PALETTE blocks](#palette-blocks)
- [CHARACTER blocks](#character-blocks)
- [PROP blocks](#prop-blocks)
- [Aesthetic north stars](#aesthetic-north-stars)
- [Continuity anchors and secrets](#continuity-anchors-and-secrets)
- [Tone and audio](#tone-and-audio)
- [Checklist](#checklist)

## STYLE block

One paragraph, used in every prompt, fixing the rendering aesthetic for the
whole film. It is the most-reused text you will write, so make it carry weight
without bloat. Cover four things in order:

- **Medium and render style.** "Photorealistic cinematic", "Pixar-style 3D
  animation, stylized proportions, large expressive eyes", "high-contrast
  black-and-white silhouette theatre". Name a family the audience already
  knows.
- **Line and texture.** Real weather, sea mist, shallow depth of field, film
  grain. The tactile qualities that survive every shot.
- **Mood.** One or two words setting the emotional register.
- **Global guards.** The standing exclusions, in the phrasing the model
  actually respects: "keep every frame subtitle-free and free of any watermark
  or on-screen lettering". Plus the motion instruction, because soft vocabulary
  renders literally as slow motion: "realtime speed, brisk natural motion".

Keep it to what is true of every frame. A detail belonging to one location goes
in a palette block.

The demo film's whole style block is its `film.promptPreamble` in
`films/lighthouse/shots.json`, which is a good length reference.

## PALETTE blocks

One block per location, written as emotional language rather than decoration.
Colour and light carry feeling and mark act turns, so choose a palette for what
it makes the audience feel, then describe it concretely.

The lighthouse film moves through four linked palettes: **steel-blue dusk** for
the guarded arrival, **warm tower interiors** for craft and disagreement,
**near-black storm** broken by lightning and amber beam for crisis, then
**silver dawn and clear indigo** for the handover and new watch.

Write each block as setting, plus light, plus colour family, plus a few
concrete fixtures.

## CHARACTER blocks

One block per character, per age block if the character ages. The job is a
single vivid sentence carrying silhouette, signature items, and movement
quality, so the model and the audience read the same person every appearance.

- **Silhouette** is the fastest read. Make two characters in a scene contrast
  in shape.
- **Signature items** are the instant identification: a navy wool coat, a red
  knitted scarf, a particular hat. One or two, distinctive.
- **Movement quality** completes the read, and it is character. Keep the verbs
  brisk; "moving slowly and deliberately" is both a description and an
  instruction the video model will obey literally.

The lighthouse pair:

```text
THE KEEPER
A lean weathered man in his late sixties, grey stubble, navy wool coat, faded
red scarf, working with deliberate economy and no wasted step.

THE RELIEF
A woman in her early thirties with cropped dark curls, mustard-yellow oilskin,
dark teal sweater and brown canvas tool roll; still while observing, fast and
precise once she acts.
```

Navy and red against mustard and teal: the audience reads them apart even in a
storm-lit machinery room. When a character ages, write the older block as "the
same character as X, grown into...", keep the load-bearing features, and update
only what time changes.

## PROP blocks

A hero prop that must read identically every appearance gets its own block. The
test is thematic, not visual: an object earns a block when the story turns on
it. The lighthouse film pins the brass winding key and grey meter because their
ownership and final coexistence carry the character arc. It also pins the
Fresnel lens and drive because their working, frozen, and restored states carry
the external stakes.

Describe the prop tightly and positively. A prop that is just set dressing does
not need a block.

## Aesthetic north stars

Pick two or three touchstones and name why each is on the list. A film that
"feels like" something is borrowing that work's emotional optics, not its plot.
Each north star should own a different job. For the lighthouse film: Roger
Deakins' hard practical sources in the dark (light), Winslow Homer's late
marine paintings (sea and weather), Pixar's *La Luna* for wordless
craft-as-character (heart).

Three touchstones covering light, place, and heart give the film a centre of
gravity without any one reference dominating. State the job next to each so a
later writer knows what to protect.

## Continuity anchors and secrets

Where story constraints live, not just visual consistency. Anchors are rules
that shape staging across shots; secrets are facts the audience does not yet
know, which dictate what the camera may reveal and when.

The lighthouse film runs four. **The lamp is dark until s05. The key remains
with the keeper until s10. His left palm is uninjured before s08 and wrapped
afterward. The boat's reef geography in s07 and s11 mirrors exactly**, so the
corrected course reads without explanation.

Write anchors as flat rules. A single constraint like that governs staging,
eyelines, and pacing for half the film. When a chained shot inherits a previous
frame, that frame is ground truth: never write action contradicting what is
actually on screen.

## Tone and audio

State the emotional register in one line. Per-clip generated audio is sound
effects and ambience only, so every shot's audio direction stays diegetic;
score, narration, and the mix are post decisions handled at stitch time.

## Checklist

- [ ] STYLE block: one paragraph, medium plus texture plus mood plus the global
      guards, true of every frame.
- [ ] PALETTE block per location, chosen as emotional storytelling.
- [ ] CHARACTER block per character per age block: silhouette, signature items,
      movement quality, in one vivid sentence with brisk verbs.
- [ ] PROP block for each hero prop, tight and positive.
- [ ] Two or three north stars, each with its stated job.
- [ ] Continuity anchors and secrets written as staging rules.
- [ ] Tone in one line; per-clip audio is sound effects and ambience only.

Scale the bible to the film. A two-character short does not need a location
palette grid, but it still needs the silhouettes, the movement quality, and the
tone line.
