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

The lighthouse film runs three, and the cuts between them are the act turns:
**cliff at dusk** is cold blue twilight, wind-flattened grass, grey breaking
sea (exposed, unlit, waiting); **the lamp room** is amber and brass and cut
glass (warmth, purpose, the only interior in the film); **open sea at night**
is black water, white foam, and one moving beam (scale, and how small the
rescue is against it). The audience feels the change from the second one before
they can name it.

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
A weathered man in his sixties, tall and slightly stooped, grey stubble,
heavy navy wool coat over a thick jumper, working with brisk economy and
no wasted step.

THE SKIPPER
Younger and broad, in yellow oilskins with the hood down, hair plastered
flat by rain, hands fast and certain on the wheel.
```

Tall and grey against broad and yellow: the audience reads them apart in one
frame, which matters in a film where they never share one. When a character
ages, write the older block as "the same character as X, grown into...", keep
the load-bearing features, and update only what time changes.

## PROP blocks

A hero prop that must read identically every appearance gets its own block. The
test is thematic, not visual: an object earns a block when the story turns on
it. The lighthouse film pins the Fresnel lens (a great cut-glass drum, brass
frame, visible facets, taller than the keeper) because it is in three shots and
a generic lamp would break both continuity and the point.

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

The lighthouse film runs two. **The lamp is dark until s03**, so s01 specifies
"lamp room dark" and s02 gives the keeper a hand lantern instead: the ignition
has to be the first time the audience sees the light, or the payoff is spent.
**The keeper and the skipper never share a frame**, because the film is about
the person you do the work for and never meet.

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
