# Shot list

The build spec: one detailed entry per generation, the last document before the
JSON. Everything upstream decides WHAT happens; the shot list decides how each
beat is framed, paced, and staged so the cut reads emotionally.

This file covers the craft of the document. For how an entry becomes the
`shots.json` prompt string (timestamp plan or `Shot N:` beat carriers, reference
roles, anchoring mechanics), see `../../seedance/references/seedance-prompting.md` and
`../../seedance/references/film-pipeline.md`. Do not restate that here.

## Contents

- [The per-shot entry](#the-per-shot-entry)
- [Camera language](#camera-language)
- [Staging as story](#staging-as-story)
- [Beats](#beats)
- [Audio line discipline](#audio-line-discipline)
- [A note on traditional shot-list columns](#a-note-on-traditional-shot-list-columns)
- [Scaling the form](#scaling-the-form)
- [Checklist](#checklist)

## The per-shot entry

One entry per generation, in film order:

- **Heading:** `## sNN · <shot-id> · <dur>s · <KEYFRAME|CHAIN>`. Add the age
  block if the character ages. Anchor strategy in the heading so you can scan
  continuity at a glance.
- **Refs:** which stills the shot uses and in what role. This mirrors the
  beat-sheet decision; seedance owns what the roles mean.
- **Beats:** as many as the story needs, each one a distinct camera setup and a
  distinct verb, written as prose.
- **Camera:** the move for each beat, named in real cinematography terms.
- **Audio:** diegetic sound effects and ambience only.
- **Continuity:** the bookkeeping a future you needs. What must not appear,
  which card follows, what this shot sets up or pays off.

A real entry (`films/lighthouse/`, s10):

```
## s10 · `s10-beam-returns` · 8s · KEYFRAME

Refs: s10-beam-returns (first_frame). Close two-shot over exposed gears as the
keeper offers the brass key to the relief; service motor ready by the flywheel.
Beat 1: locked close. She accepts the key; their eyes meet; he points it toward
the hidden clutch release.
Beat 2: cut low along the drive. He holds the clutch open while she couples the
motor; their hands move in one rhythm.
Beat 3: crane up through the stairwell. The Fresnel lens turns and amber light
moves off the cliff, through rain, across both faces.
Audio: key chime, alarm stopping, clutch clack, motor rising, gears catching.
Continuity: first shared action; key ownership changes during the shot. Pays off
the opposite methods established in s03 and the exposed solution in s09.
```

The Continuity line is doing real work: it records the climax's relationship
turn, the hero-prop handover, and the exact earlier setups this paid generation
must resolve.

## Camera language

Name each move in real cinematography terms. Pick from three axes:

- **Shot size:** wide (establish, geography), medium (action, body language),
  close-up (emotion), over-the-shoulder (two-person tension), POV
  (subjective).
- **Move:** dolly, track, pan, tilt, push in, crane, or locked.
- **Angle:** low (power, scale), high (vulnerability, smallness), eye-level
  (neutral, intimate).

Match camera energy to the action and the audio. A calm scene gets a calm
camera; a chaotic beat earns a faster move. Never write "the camera moves
around", and never contradict yourself with frantic action under a
contemplative camera.

## Staging as story

The high-value work of the shot list: the same beat staged two ways tells two
different stories.

- **Eyeline and presentation order carry meaning.** Who the camera meets first,
  who steps toward it, where a character looks.
- **Matched-pair mirroring.** When two shots are meant to rhyme, give them the
  same blocking and note the mirror in Continuity. The lighthouse film rhymes
  s07 and s11: the same boat and reef geography changes from danger to clear
  water, so the corrected course reads before the audience has to reason it
  out.
- **Emotional timing.** Build in the beat before the reaction. Stage the
  silence, not just the payoff.
- **Open mid-action.** Enter a shot with movement already underway. Reserve a
  held opening frame for the very first shot, or for a clean hold where a title
  card lands; a static opening anywhere else makes the cut hang.

## Beats

Beat count follows the story, not a house number. Each beat is one clear action.
Do not cram thirty seconds of story into a six-second clip; if a beat needs more
room, it is another generation. Each beat opens on its own camera setup, which is
what produces an internal cut rather than one stretched gesture.

The exact syntax the beats compile into is seedance's: a timestamp plan or
`Shot N:` form (see `../../seedance/references/seedance-prompting.md`). Here the
discipline is pacing.

## Audio line discipline

Per clip, name diegetic sound effects and ambience only. Time key cues to your
beats (a hinge groan under the door slam, one flint strike before the flare).

The continuous score and the narration voiceover are never specified per shot:
they are mixed at `vs stitch`. A per-shot audio line that asks for music or
dialogue fights the post mix.

## A note on traditional shot-list columns

Professional live-action shot lists track size, angle, movement, lens, and
subject as separate columns. We fold size, angle, and movement into the camera
line and subject into the beats, and we do not track lens, because the model
has no literal focal length. The discipline carries over; the column count does
not.

## Scaling the form

Not every film needs a full per-shot entry. For a short, mostly keyframed film
where each shot is a single clean beat, an ID / Still / Duration / Purpose
table is enough. Use the full entry form when shots carry multi-beat action,
mirrored staging, chaining, age cuts, or continuity constraints.

## Checklist

- Every beat is one action, and beats fit the shot duration.
- Camera move matches the energy of the action and audio.
- Staging carries the beat: eyeline, presentation order, mirrored pairs, the
  pause before the reaction.
- Audio line is sound effects and ambience only.
- The shot opens mid-action, or holds a clean frame only where a card lands.
