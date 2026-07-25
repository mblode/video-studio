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

The demo film (`films/lighthouse/`), five generations and two cards:

```
| #   | Generation     | Time (film) | Dur | Anchor              | Beat                                                          | Narration |
| --- | -------------- | ----------- | --- | ------------------- | ------------------------------------------------------------- | --------- |
| --- | TITLE card     | 0:00-0:03   | 3s  | card                |                                                                 |           |
| s01 | Dusk cliff     | 0:03-0:09   | 6s  | KEYFRAME s01-dusk-cliff | aerial over the headland / keeper strides to the door / door slams | line 1 |
| s02 | Keeper stairs  | 0:09-0:15   | 6s  | KEYFRAME s02-keeper-stairs | climbs two at a time / lantern light races the spiral / clears the top step | line 2 |
| s03 | Lamp ignites   | 0:15-0:21   | 6s  | KEYFRAME s03-lamp-ignites | cranks the valve, strikes / mantle flares white / the lens starts to turn | line 3 |
| s04 | Beam sweeps    | 0:21-0:27   | 6s  | KEYFRAME s04-beam-sweeps | beam rakes the cliff / flares past the gallery rail / a full circle from above | line 4 |
| s05 | Boat turns     | 0:27-0:33   | 6s  | KEYFRAME s05-boat-turns | boat pitches over a crest / skipper spins the wheel / runs at the light | line 5 |
| --- | END card       | 0:33-0:36   | 3s  | card                |                                                                 |           |
```

- **#**: the shot id, the join key to `shots.json`. Cards get a `-`.
- **Generation**: a short human name for the beat.
- **Time (film)**: the running slot on the timeline. Continuous, including
  cards, so the arithmetic stays honest.
- **Dur**: clip length in seconds (4 to 15; 15 needs the Pro tier).
- **Anchor**: KEYFRAME (the default) naming its still, or CHAIN (last resort).
- **Beat**: what happens, written as the internal beats that become the prompt
  body. Three per generation is the working default.
- **Narration**: the scratch voiceover line for this slot, mixed in post.

Add an **Age** column when a character ages across the film, so each row points
at the right character sheet. Cards are rows because they consume real runtime.

## Distributing structure across the rows

Pick a structural frame first (`story-principles.md`), then map it onto N rows.

- **Design the FINAL beat first.** Decide the last image, then work backward so
  every earlier row drives at it. The lighthouse film designed s05 first, the
  boat turning toward a light whose keeper it never sees; everything before it
  exists to make that turn mean something.
- **Escalate down the rows.** Each beat should raise the stakes or tighten the
  screw over the one above. A flat middle is the most common structural
  failure, and the table makes it visible at a glance.
- **One causal step per row.** A row should follow from the row above with "and
  so" or "but then", not merely sit after it with "and then". Two adjacent rows
  with no causal link mean a gap to fill or a beat to cut.

## Pacing and the duration budget

Do the arithmetic before any spend.

The demo film: five generations at 6s each is 30s of clips, plus two 3s cards,
so about 36s before crossfade overlap, and about 35s in the finished cut.

Run the same sums for your film:

- Add every clip duration. That is your video spend, the expensive number.
- Add every card duration separately. Cards cost nothing to generate but extend
  runtime, so a film that "feels" two minutes runs longer once titles land.
- Check the act split against your intent.
- Keep each clip within 4 to 15s.

If the total runs long or an act bulges, fix it here by trimming durations or
merging beats, while it is still free.

## The audit patterns

The strongest reason to keep a full beat sheet. After the table, add sections
that trace one thread through every row and confirm it is set up, advanced, and
paid off. Audits catch dropped setups and broken constraints while the fix is a
re-typed row rather than a paid regeneration.

Four kinds worth running:

- **Theme ladder.** One line per beat showing how it advances the controlling
  idea. For the lighthouse film ("the light is kept for someone you never
  meet"): the tower stands empty and dark, the keeper climbs anyway, the lamp
  catches, the beam goes out over nothing visible, someone out there turns
  toward it. A rung that does not advance the idea is decoration.
- **An object traced as states.** Follow one thing through its whole life. The
  light: unlit (s01), carried as a hand lantern (s02), ignited (s03), sweeping
  the sea (s04), received (s05). Every state gets a row; a missing state is a
  plot hole.
- **Constraint audits.** Rules the film must never break, verified row by row.
  The lighthouse constraint: the keeper and the skipper never share a frame and
  never acknowledge each other, because the whole point is that they do not
  meet. List the constraint, then the rows that honour it.
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
  clip 4 to 15s.
- The theme ladder is traced and every rung advances the controlling idea.
- Every setup has a payoff; constraint audits pass.
