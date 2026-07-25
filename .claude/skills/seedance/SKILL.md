---
name: seedance
description: Turns a film idea into a generation-ready film under films/<slug>/ for the video-studio vs CLI. Produces validated stills.json and shots.json with Seedance 2.0 multi-shot prompts (the official `Shot 1: ... Shot 2: ...` form), keyframe anchoring, and the hard schema rules. Use when the user says "turn this idea into a film", "make a Seedance short about...", "write the shots for...", "draft a shot list", "new film", "scaffold a film", "write stills.json / shots.json", "fix this prompt", "improve these prompts", or describes a story they want generated as AI video. Enforces keyframe-per-shot anchoring, frame-mode vs reference-roles exclusivity, chain depth limits, SFX-only per-clip audio, and title cards in post. For the story documents use storycraft; for Nano Banana still prompts use nano-banana-2; to run the CLI use vs.
---

# Seedance

Turn a film idea into a self-contained `films/<slug>/` package the `vs` CLI can
generate: a `stills.json` and `shots.json` that pass validation and follow
Seedance 2.0 prompt craft.

- **IS:** structuring a story into reference stills and generation units,
  writing Seedance prompts, and producing schema-valid JSON.
- **IS NOT:** the story itself (`storycraft`), running the generations (`vs`),
  Nano Banana still prompts (`nano-banana-2`), or editing the CLI's TypeScript.

`films/lighthouse/` is the worked example: five keyframe-anchored shots, a
`promptPreamble`, title cards, no chaining. Read its `shots.json` before
writing your own, and its `README.md` for what each part demonstrates.

## Read before writing

| Reference                          | Read when                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `references/shots-schema.md`       | Writing or fixing any JSON. Exact fields, hard rules, lint warnings    |
| `references/seedance-prompting.md` | Writing any prompt. Beat form, brackets, constraints, references       |
| `references/film-pipeline.md`      | Turning planning documents into JSON. Anchoring, blocks, still mapping |

## Workflow

```text
- [ ] 1. Lock the idea: logline, throughline, length, look, generation budget
- [ ] 2. Write the planning documents (storycraft)
- [ ] 3. Derive the keyframes and any character/prop/environment stills -> stills.json
- [ ] 4. Write shots.json: prompts, anchoring, seeds, cards
- [ ] 5. Dry-run both files, fix every warning, report cost
```

**Step 1.** Pin down the logline, the emotional throughline, the total runtime
and generation count, one or two visual touchstones, and the audio plan. Each
generation is 4 to 15s and costs money. If the user gave a one-liner, propose a
logline and a final image, then confirm before proceeding. `storycraft` owns
this craft.

**Step 3.** One still per shot, sharing the shot's id, showing that shot's
literal opening composition. Add character sheets (one per age block), hero
props, and shared environment plates as needed.

**Step 4.** Every shot gets its own keyframe as `first_frame`, a `seed`
matching its still's seed, and 3 to 4 `Shot N:` beats. Shared style goes in
`film.promptPreamble`, not in each prompt.

**Step 5.**

```bash
node dist/cli.js stills   films/<slug>/stills.json --dry-run
node dist/cli.js generate films/<slug>/shots.json --dry-run
```

Same validation, lint, and cost estimate as a real run, with no network calls
and no manifest writes. Then report the generation count, the summed clip
seconds, and the card seconds separately, because cards add runtime the clip
total does not show.

## Non-negotiables

- **Anchor every shot to a literal keyframe.** A still of the exact opening
  composition as `first_frame`. Keyframed shots submit concurrently and a
  retake never cascades. `continueFrom` chaining is a last resort and the
  linter warns on every use.
- **Never mix frame mode with reference roles.** A shot with `continueFrom` or
  a `first_frame` carries no `reference_*` entries. This is the most common way
  to waste thinking on a prompt that cannot be submitted.
- **Prompts are fully expanded.** No tokens, no "the character from the
  previous shot". The model has no memory across generations.
- **3 to 4 `Shot N:` beats per generation, opening mid-action.** Not one action
  per clip, which produces a stretched slow-motion gesture. Not second-level
  timecodes, which the official guide warns are unstable.
- **Per-clip audio is diegetic SFX and ambience only**, in `<angle brackets>`.
  Score and narration are mixed at `vs stitch`. Keep `generateAudio: true`.
- **Title cards are rendered in post** via the `cards` array. In-model text is
  unreliable, and any signage that must appear in frame is baked into the
  keyframe still instead.
- **Generate at 720p.** 1080p is a delivery upscale, not a generation target.
- **Local paths stay inside the film directory** and are images only. Video and
  audio references must be https URLs.

## Related skills

- `storycraft` for the treatment, style bible, beat sheet, and shot list.
- `vs` to run the pipeline once the JSON is written.
- `nano-banana-2` for still prompts when a film's stills `model` is `gemini-*`,
  and for any keyframe that must contain legible text.
