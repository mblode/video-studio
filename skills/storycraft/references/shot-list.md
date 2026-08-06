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

- **Heading:** `## sNN · <shot-id> · <dur>s · <KEYFRAME|MODE B>`. Add the
  age block if the character ages. Anchor strategy in the heading so you can
  scan continuity at a glance.
- **Refs:** which stills the shot uses and in what role. This mirrors the
  beat-sheet decision; seedance owns what the roles mean.
- **Beats:** each one prefixed with **its timestamp span**, and each one a
  distinct camera setup and a distinct verb, written as prose. Spans are
  contiguous and cover the whole duration.
- **Camera:** the move for each beat, named in real cinematography terms.
- **Audio:** diegetic sound effects and ambience only.
- **Continuity:** the bookkeeping a future you needs. What must not appear,
  which card follows, what this shot sets up or pays off.

The timestamp span is not decoration. On anything 20s or longer the entry
compiles almost verbatim into the prompt's timestamp plan, so a beat without a
span is a decision you have deferred to the model. Short 2.0 clips can use bare
`Beat N:` numbering, since one beat fills the clip and there is nothing to
schedule.

A real 8s entry (`films/lighthouse/`, s09), in the bare-beat form:

```
## s09 · `s09-trust-turns-light` · 8s · KEYFRAME

Refs: s09-trust-turns-light (first_frame). Close two-shot over the exposed
service shaft; the relief holds one open palm between them, the keeper grips the
dark iron key, the motor is already mounted.
Beat 1: locked hand close. After the second horn he looks from the frozen beam
to her palm, unclips the key and places it there.
Beat 2: cut low along the drive. He points out the concealed release; she
unlocks the clutch while he holds the broken weight train clear, then couples
the motor.
Beat 3: crane up through the stairwell as she starts it. The flywheel and
Fresnel lens turn, and pale bars cross both faces for the first time.
Audio: muffled horn, belt clip, one metal chime, clutch clack, motor rising,
gears catching, glass resonance.
Continuity: first shared action; key ownership changes during the shot. Pays off
the opposite methods established in s03 and the exposed solution in s08.
```

The Continuity line is doing real work: it records the climax's relationship
turn, the hero-prop handover, and the exact earlier setups this paid generation
must resolve.

The same climax as a 30s act, where the entry is the timestamp plan:

```
## a03 · `a03-trust-turns-light` · 30s · MODE B

Refs: keeper (reference_image 1), relief (reference_image 2), service-shaft
plate (reference_image 3), lamp-room plate (reference_image 4).
0-6s: wide from the stairwell head, pushing in. The motor sits half-mounted on
the exposed drive; the clutch is locked and the beam is frozen inland.
7-12s: cut to a close two-shot. He looks from the dead beam to her open palm
and does not move; the second horn sounds under it.
13-18s: cut tight to the hands. He unclips the dark iron key and places it in
her palm, and the key changes owner on camera.
19-24s: cut low along the drive, tracking. She unlocks the concealed release
while he holds the broken weight train clear, then couples the motor.
25-30s: crane up through the stairwell as she starts it. The flywheel and the
Fresnel lens turn, and pale bars cross both faces for the first time.
Audio: muffled horn, belt clip, one metal chime, clutch clack, motor rising,
gears catching, glass resonance.
Continuity: first shared action; key ownership changes at 13-18s. Pays off the
opposite methods established in a01 and the exposed drive left at the end of
a02. Nothing in this act may show the beam reaching the water; that is a04.
```

Note what the act form costs you and buys you. Four of the five internal cuts
are now the model's to execute rather than the editor's, so the spans have to
be honest about where the story turns. In exchange, the key handover, the
clutch release, and the lens turning happen in one continuous take with one
lighting state and one pair of faces, which is the coherence that three
separate 8s generations were always fighting for.

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

Beat count follows the story, not a house number, but it does have to match the
duration. **Roughly one beat per 6 to 10 seconds.** That rule has two sides and
each model fails on a different one:

- **Too many beats for the window (the 2.0 failure).** Thirty seconds of story
  crammed into a six-second clip. The model skips actions, or blurs them into
  one another, and nothing reads. If a beat needs more room, it is another
  generation.
- **Too few beats for the window (the 2.5 failure).** Three beats in a 30s act.
  The model has thirty seconds to fill and only three things to do, so it
  stretches: drifting cameras, held gestures, slow-motion nobody asked for.
  Sludge. A 30s act wants five to seven beats, and the fix for a thin act is to
  find more story for it, not to shorten it and pay for a fifth generation.

Each beat opens on its own camera setup, which is what produces an internal cut
rather than one stretched gesture. On a 30s act those internal cuts are the
edit, so beat boundaries are cut points and should land where the story turns.

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
mirrored staging, age cuts, or continuity constraints. **A 30s act
always needs the full form**: five to seven beats, a reference pack, and a
timestamp span per beat do not fit in a table cell, and the entry is the
prompt.

## Checklist

- Every beat is one action, and beat density fits the duration: roughly one per
  6 to 10 seconds, neither crammed nor stretched.
- Every entry of 20s or more prefixes each beat with a contiguous timestamp
  span covering the full duration.
- Camera move matches the energy of the action and audio.
- Staging carries the beat: eyeline, presentation order, mirrored pairs, the
  pause before the reaction.
- Audio line is sound effects and ambience only.
- The shot opens mid-action, or holds a clean frame only where a card lands.
