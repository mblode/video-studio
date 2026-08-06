# Beat sheet

One row per generation: the bridge from the treatment to the shot list, and
where you prove the structure works before spending a cent. Each row is a task
you will eventually pay for, so the table doubles as a budget and a
story-logic ledger. Get the rows right and the JSON is mechanical.

**One row per generation is still literally true, but on Seedance 2.5 a row is
no longer a beat.** At 8s a generation holds one beat, so the row and the beat
are the same thing. At 30s a generation is an ACT holding five to seven beats
the model cuts between, and the row's job changes: it must carry an internal
timestamp sub-plan, not a bare beat list, because that sub-plan is what
compiles into the prompt. Both worked tables are below.

This file is about the craft of turning structure into rows and using the table
to catch story holes. The anchoring mechanics (keyframes, reference packs, frame
mode, the schema) live in the seedance skill; here you only record a choice per
row.

## Contents

- [What it is](#what-it-is)
- [The table layout](#the-table-layout)
- [Distributing structure across the rows](#distributing-structure-across-the-rows)
- [Pacing and the duration budget](#pacing-and-the-duration-budget)
- [The audit patterns](#the-audit-patterns)
- [Checklist](#checklist)

## What it is

The treatment gives you the why and the acts; the beat sheet breaks those acts
into the units that get generated. Every row names its content, a film-time
slot, a duration, an anchor strategy, and the narration line that rides under
it. Nothing is a finished prompt yet. You are deciding, for free, that the cut
tells the story before any image exists.

Scale the form to the film. A five-shot piece where each shot is one clean beat
needs a plain table. A film where a setup must pay off much later, or where a
theme has to be carried across a dozen generations, earns the audit sections
below. A 30s-act film always earns the timestamp sub-plan, because the model is
cutting inside the row and the sub-plan is the only place you get to say where.

## The table layout

### Seedance 2.0: one row per beat

The demo film (`films/lighthouse/`), twelve generations and two cards:

```
| # | Generation | Dur | Anchor | Beat |
| --- | --- | --- | --- | --- |
| s01 | Last arrival | 8s | KEYFRAME s01-last-arrival | suitcase closes / relief approaches / dark tower waits |
| s02 | Refusal | 8s | KEYFRAME s02-refusal | offer refused / key retained / mugs separated |
| s03 | Worn link | 8s | KEYFRAME s03-worn-link | he listens / she measures / warning dismissed |
| s04 | Boat approaches | 8s | KEYFRAME s04-boat-approaches | radio static / boat in fog / keeper climbs |
| s05 | Pride breaks drive | 8s | KEYFRAME s05-pride-breaks-drive | lamp ignites / link breaks / beam stops inland |
| s06 | Reef in dark | 8s | KEYFRAME s06-reef-in-dark | reef appears / wheel fails / weak signal |
| s07 | Hand crank fails | 8s | KEYFRAME s07-hand-crank-fails | key forced / train kicks / keeper injured |
| s08 | Motor needs key | 8s | KEYFRAME s08-motor-needs-key | motor mounted / clutch locked / key needed |
| s09 | Trust turns light | 8s | KEYFRAME s09-trust-turns-light | key offered / methods combine / lens turns |
| s10 | Safe water | 8s | KEYFRAME s10-safe-water | beam finds boat / wheel turns / reef clears |
| s11 | Duty handed over | 8s | KEYFRAME s11-duty-handed-over | key left / key taken / keeper departs |
| s12 | Next watch | 8s | KEYFRAME s12-next-watch | she listens / lamp starts / beam reaches stranger |
```

- **#**: the shot id, the join key to `shots.json`. Cards get a `-`.
- **Generation**: a short human name for the beat.
- **Time (film)**: the running slot on the timeline. Continuous, including
  cards, so the arithmetic stays honest.
- **Dur**: clip length in seconds (within the model envelope; story picks the unit).
- **Anchor**: KEYFRAME (the default) naming its still, or MODE B naming its
  reference pack.
- **Beat**: what happens, written as the internal beats that become the prompt
  body. The demo uses three per row; count follows the story, not a house rule.
- **Narration**: the scratch voiceover line for this slot, mixed in post.

Add an **Age** column when a character ages across the film, so each row points
at the right character sheet. Cards are rows because they consume real runtime.

### Seedance 2.5: one row per act

The same story sized for 30s generations. Twelve beats do not become twelve
rows; they become four acts of five or six beats each, and the Beat column
turns into an internal timestamp sub-plan:

```
| # | Act | Time (film) | Dur | Anchor | Internal timestamp plan |
| --- | --- | --- | --- | --- | --- |
| - | Title card | 0:00-0:03 | 3s | - | LIGHTHOUSE |
| a01 | Arrival refused | 0:03-0:33 | 30s | MODE B (keeper, relief, tower plate) | 0-5s boat lands on the slip / 6-11s she climbs to the door / 12-17s the offered hand is refused / 18-23s she measures, he listens / 24-30s two mugs set apart, door closes |
| a02 | The drive breaks | 0:33-1:03 | 30s | MODE B (keeper, lamp room, reef plate) | 0-5s radio static, boat in fog / 6-12s the lamp ignites / 13-18s the worn link snaps, beam stops inland / 19-24s the reef surfaces under the hull / 25-30s he forces the key, the train kicks, his palm opens |
| a03 | Trust turns light | 1:03-1:33 | 30s | MODE B (keeper, relief, service shaft) | 0-6s the motor is mounted, clutch locked / 7-12s he looks from the frozen beam to her open palm / 13-18s the key changes hands / 19-24s she unlocks the clutch, he holds the broken train clear / 25-30s crane up, the lens turns, bars cross both faces |
| a04 | Next watch | 1:33-2:03 | 30s | MODE B (relief, lamp room, dawn plate) | 0-6s the beam finds the boat / 7-12s the wheel turns, the reef clears / 13-18s he sets the key on the ledge / 19-24s he goes down the stairs alone / 25-30s she stands behind the lens, key and meter together, the beam reaches a stranger |
| - | End card | 2:03-2:05 | 2s | - | The End |
```

What changes, and what does not:

- **The Beat column becomes a timestamp plan.** Spans are contiguous and cover
  the whole duration, because the model cuts on them. A row with a bare beat
  list is unfinished work: it has decided what happens but not when, and the
  when is exactly what a 30s prompt needs.
- **The Anchor column names a pack, not a single still.** KEYFRAME is Mode A (a
  literal `first_frame`); MODE B is a `reference_image` pack bound by ordinal.
  What the modes mean and how references bind is seedance's, not this
  document's.
- **Act boundaries are the real cut points.** The model handles the cuts inside
  an act; you handle the four between them. That makes the act break the most
  load-bearing structural decision in the table, so put it where the story
  turns, not where the arithmetic is tidy.
- **Everything else survives.** Causality, escalation, the audits below, and
  the final-beat-first discipline are unchanged. They now run over acts, and
  additionally within each act's plan.

## Distributing structure across the rows

Pick a structural frame first (`story-principles.md`), then map it onto N rows.

- **Design the FINAL beat first.** Decide the last image, then work backward so
  every earlier row drives at it. The lighthouse film designed s12 first: old
  key and new meter share the frame while the inherited beam reaches a stranger.
- **Escalate down the rows.** Each beat should raise the stakes or tighten the
  screw over the one above. A flat middle is the most common structural
  failure, and the table makes it visible at a glance.
- **One causal step per row.** A row should follow from the row above with "and
  so" or "but then", not merely sit after it with "and then". Two adjacent rows
  with no causal link mean a gap to fill or a beat to cut.

## Pacing and the duration budget

Do the arithmetic before any spend. Two sums, not one: clip seconds (the money)
and wall clock (the afternoon).

**2.0, 8s rows.** Twelve generations at 8s is 96s of clips, plus two 3s cards,
so about 1:42 before crossfade overlap. Three run concurrently, so twelve
generations is four waves of a few minutes each.

**2.5, 30s acts.** Four acts at 30s is 120s of clips, plus the same two cards,
so about 2:06. The same 120s at 720p bills the same 2,592,000 tokens either
way, but 2.5 charges a dearer rate for them (roughly +39%) and runs **one task
at a time**. A 30s generation takes 10 to 15 minutes, so a four-act film is 40
to 60 minutes strictly serial and a six-act film is 60 to 90. Budget the
afternoon, not just the dollars.

Run both sums for your film:

- Add every clip duration. That is your video spend, the expensive number.
- Multiply generations by 10 to 15 minutes on 2.5 (or divide by three
  concurrent tasks on 2.0). That is your wall clock, and on 2.5 it is the
  number that actually constrains how many retake rounds fit in a day.
- Add every card duration separately. Cards cost nothing to generate but extend
  runtime, so a film that "feels" two minutes runs longer once titles land.
- Check the act split against your intent.
- Keep each clip inside the active model's duration envelope (2.0: 4-15s; 2.5:
  4-30s). Pick duration from the story. Short inserts, mid multi-cuts, and long
  one-takes are all valid; do not pad to a house length or always max the clip.

If the total runs long or an act bulges, fix it here by trimming durations,
merging beats, or moving a beat across an act boundary, while it is still free.

## The audit patterns

The strongest reason to keep a full beat sheet. After the table, add sections
that trace one thread through every row and confirm it is set up, advanced, and
paid off. Audits catch dropped setups and broken constraints while the fix is a
re-typed row rather than a paid regeneration.

Four kinds worth running:

- **Theme ladder.** One line per beat showing how it advances the controlling
  idea. For the lighthouse film: the keeper retains the key, dismisses the
  relief's meter, fails alone, combines methods, hands over the key, and finally
  leaves key and meter together. A rung that does not advance the idea is
  decoration.
- **An object traced as states.** Follow one thing through its whole life. The
  key: withheld (s02), used unsuccessfully (s07), required by both methods (s08),
  passed during climax (s09), inherited (s11–s12), integrated with the meter
  (s12). Every state gets a row.
- **Constraint audits.** Rules the film must never break, verified row by row.
  The lighthouse keeps every role anonymous, the keeper's left palm uninjured
  before s08 and wrapped after it, and the key with the keeper until s10.
- **Anchor map.** Every row's anchor in one place: the keyframe still it names,
  or the pack it names. Confirms no row is unanchored, that every still it names
  is actually in `stills.json`, and that a still shared by two rows is
  deliberate (an age cut) rather than a copy-paste.

Write each audit as a trace with a tick per satisfied beat, so a gap shows up
as a missing entry.

## Checklist

- Every beat causally follows the one before it.
- The final beat was designed first and every earlier row drives at it.
- Stakes escalate down the rows; no flat middle.
- **Every row of 20s or more carries an internal timestamp plan, not just a
  beat list.** Contiguous spans covering the full duration, roughly one beat per
  6 to 10 seconds.
- The runtime arithmetic is honest: clips summed, cards added separately, each
  clip a story unit inside the model envelope (not a padded or always-max length).
- The wall clock is written down, and on 2.5 it assumes one task at a time.
- The theme ladder is traced and every rung advances the controlling idea.
- Every setup has a payoff; constraint audits pass.
