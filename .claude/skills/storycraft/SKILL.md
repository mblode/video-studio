---
name: storycraft
description: Story and screen-development craft for the video-studio film pipeline, drawn from Disney, Pixar (the 22 rules), and DreamWorks practice. Covers writing the treatment, style bible, beat sheet, screenplay, and shot list, plus structure (Story Spine, three-act, Save the Cat), character (want vs need, arc), theme, and stakes. Use when the user says "write a treatment", "draft a beat sheet", "write the screenplay", "build a style bible", "write the shot list", "what's the story", "is my story working", "fix the second act", "what's the theme", "the protagonist is passive", "raise the stakes", or "apply Pixar's rules". For turning these documents into shots.json/stills.json use seedance; for image prompts use nano-banana-2.
---

# Storycraft

Write the planning documents a short film is built from, with narrative intelligence: a treatment, style bible, beat sheet, screenplay, and shot list under `films/<slug>/`. The craft here decides whether the film moves anyone; `seedance` then turns these documents into generation input.

- **IS:** story structure, character, theme, stakes, tone, and the conventions of each planning document. The WHAT and the WHY.
- **IS NOT:** the `shots.json` / `stills.json` schema, the verbatim-paste continuity mechanism, prompt assembly (all in `seedance`), the CLI (`vs`), or image prompts (`nano-banana-2`).

Read `references/story-principles.md` first for any story question. Then write the documents in order, each one feeding the next. Each reference below covers one document's craft.

## The pipeline

These films are short (about 30 seconds to a few minutes). Generation count and
per-clip duration follow the story and the model envelope (Seedance 2.0: up to
15s; 2.5: up to 30s with optional extend) — do not force a fixed shot length.
Every generation costs money, so the story must be proven on paper before any
spend. The documents are a cost ladder of their own: cheap decisions lock
before expensive ones. Public example: `films/lighthouse/`.

```text
Storycraft progress:
- [ ] Design the FINAL image first, then the throughline it proves (Pixar rule 7)
- [ ] Logline (who wants what, what is in the way) + why you must tell THIS story
- [ ] Pick a structure (the Story Spine is usually enough for a short)
- [ ] treatment.md   (the story in present-tense prose)
- [ ] style-bible.md (look, tone, character/prop blocks, secrets)
- [ ] beat-sheet.md  (one row per generation, audited)
- [ ] screenplay.md  (optional: read the story whole)
- [ ] shot-list.md   (per-shot staging spec)
- [ ] Hand to seedance to assemble the JSON
```

Design the ending before the middle. Stack the documents so each one commits something the next depends on: theme before beats, beats before shots.

## Pick a document

| Writing                                                                          | Read                             |
| -------------------------------------------------------------------------------- | -------------------------------- |
| Any story question (structure, character, theme, stakes, getting unstuck)        | `references/story-principles.md` |
| The treatment: logline, throughline, final image, narration voice                | `references/treatment.md`        |
| The style bible: STYLE / PALETTE / CHARACTER / PROP blocks, north stars, secrets | `references/style-bible.md`      |
| The beat sheet: one row per generation, pacing budget, audits                    | `references/beat-sheet.md`       |
| The screenplay: scene headings, action, V.O., Fountain format                    | `references/screenplay.md`       |
| The shot list: per-shot timed segments, camera, staging as story                 | `references/shot-list.md`        |

## Gotchas

Common story failures, framed from Pixar's rules:

- **Passive protagonist (rule 13).** A character things happen TO is poison. Give them an opinion and let them drive the beats.
- **No stakes (rule 16).** If nothing is lost when they fail, the audience does not care. Name what is at risk and raise it each beat.
- **Theme stated, not shown (rule 3).** Do not have a character announce the point. Prove it through action and the final image. Theme emerges at the end; then rewrite to earn it.
- **Coincidence solving the plot (rule 19).** Coincidence to get a character INTO trouble is fine; coincidence to get them OUT is cheating.
- **The first idea (rule 12).** Discount the first, second, third thing that comes to mind. The obvious version is rarely the good one.
- **Middle before ending (rule 7).** Writing the middle before the ending is locked is how shorts wander. Endings are hard; get yours working first.
- **Over-stuffed short (rule 5).** Simplify, focus, combine characters, hop over detours. A 2-minute film carries one clear idea, not three.
- **Unpaid setups.** Every setup must pay off and every payoff must be set up. The beat-sheet audits exist to catch this while fixing is still free.

## Reference files

| File                             | Read when                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `references/story-principles.md` | Any story question. Pixar's 22 rules, structure frameworks, character, theme, stakes, studio practice |
| `references/treatment.md`        | Writing the treatment. Logline, throughline, final-image-first, voice                                 |
| `references/style-bible.md`      | Writing the style bible. Block craft, palette as emotion, north stars, secrets as story devices       |
| `references/beat-sheet.md`       | Writing the beat sheet. Structure to rows, pacing budget, the audit patterns                          |
| `references/screenplay.md`       | Writing the screenplay. Standard + Fountain format, the repo house format, narration                  |
| `references/shot-list.md`        | Writing the shot list. Per-shot spec, camera language, staging as story                               |

## Related skills

- `seedance` to turn these documents into a validated `shots.json` / `stills.json`.
- `vs` to run the pipeline.
- `nano-banana-2` to write the reference-still image prompts.
