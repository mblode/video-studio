# Beat sheet

One row per generation: the bridge from the treatment to the shot list, and
where you prove the structure works before spending a cent. Each row is a task
you will eventually pay for, so the table doubles as a budget and a
story-logic ledger. Get the rows right and the JSON is mechanical.

This file is about the craft of turning structure into rows and using the table
to catch story holes. The anchoring mechanics (keyframes, chaining, frame mode,
the schema) live in the seedance skill; here you only record a choice per row.

## Contents

- [What it is](#what-it-is)
- [The table layout](#the-table-layout)
- [Distributing structure across the rows](#distributing-structure-across-the-rows)
- [Pacing and the duration budget](#pacing-and-the-duration-budget)
- [The audit patterns](#the-audit-patterns)
- [Checklist](#checklist)

## What it is

The treatment gives you the why and the acts; the beat sheet breaks those acts
into the units that get generated. Every row names a beat, a film-time slot, a
duration, an anchor strategy, and the narration line that rides under it.
Nothing is a finished prompt yet. You are deciding, for free, that the cut
tells the story before any image exists.

Scale the form to the film. A five-shot piece where each shot is one clean beat
needs a plain table. A film where a setup must pay off much later, or where a
theme has to be carried across a dozen generations, earns the audit sections
below.

## The table layout

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
- **Anchor**: KEYFRAME (the default) naming its still, or CHAIN (last resort).
- **Beat**: what happens, written as the internal beats that become the prompt
  body. The demo uses three per row; count follows the story, not a house rule.
- **Narration**: the scratch voiceover line for this slot, mixed in post.

Add an **Age** column when a character ages across the film, so each row points
at the right character sheet. Cards are rows because they consume real runtime.

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

Do the arithmetic before any spend.

The demo film uses 8s per row as one worked example (not a template length):
twelve generations at 8s is 96s of clips, plus two 3s cards, so about 1:42
before crossfade overlap. Pick each clip's duration from the story within the
model envelope.

Run the same sums for your film:

- Add every clip duration. That is your video spend, the expensive number.
- Add every card duration separately. Cards cost nothing to generate but extend
  runtime, so a film that "feels" two minutes runs longer once titles land.
- Check the act split against your intent.
- Keep each clip inside the active model's duration envelope. Pick duration from
  the story — short inserts, mid multi-cuts, and long one-takes are all valid;
  do not pad to a house length or always max the clip.

If the total runs long or an act bulges, fix it here by trimming durations or
merging beats, while it is still free.

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
- **Anchor map.** Every row's KEYFRAME or CHAIN choice in one place, confirming
  no chain runs deeper than 3 and that re-anchor points land where drift would
  otherwise creep in.

Write each audit as a trace with a tick per satisfied beat, so a gap shows up
as a missing entry.

## Checklist

- Every beat causally follows the one before it.
- The final beat was designed first and every earlier row drives at it.
- Stakes escalate down the rows; no flat middle.
- The runtime arithmetic is honest: clips summed, cards added separately, each
  clip a story unit inside the model envelope (not a padded or always-max length).
- The theme ladder is traced and every rung advances the controlling idea.
- Every setup has a payoff; constraint audits pass.
