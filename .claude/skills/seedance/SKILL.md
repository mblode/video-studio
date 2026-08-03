---
name: seedance
description: Turns a film idea into a generation-ready film under films/<slug>/ for the video-studio vs CLI. Produces validated stills.json and shots.json with Seedance 2.5 prompt craft (30s acts, timestamp plans, ordinal-bound reference packs), keyframe anchoring, and the hard schema rules. Use when the user says "turn this idea into a film", "make a Seedance short about...", "write the shots for...", "draft a shot list", "new film", "scaffold a film", "write stills.json / shots.json", "fix this prompt", "improve these prompts", or describes a story they want generated as AI video. Enforces the ordinal contract, per-shot anchoring, model-aware frame/reference rules, SFX-only per-clip audio, and title cards in post. For the story documents use storycraft; for Nano Banana still prompts use nano-banana-2; to run the CLI use vs.
---

# Seedance

Turn a film idea into a self-contained `films/<slug>/` package the `vs` CLI can
generate: a `stills.json` and `shots.json` that pass validation and follow
**Seedance 2.5 craft**.

- **IS:** structuring a story into reference stills and generation units,
  writing Seedance prompts, and producing schema-valid JSON.
- **IS NOT:** the story itself (`storycraft`), running the generations (`vs`),
  Nano Banana still prompts (`nano-banana-2`), or editing the CLI's TypeScript.

**Write for 2.5 and set it explicitly.** `film.model` is
`dreamina-seedance-2-5-260628`; the CLI's built-in default stays on 2.0, so a
film that omits `film.model` gets 2.0's envelope and 2.0's rules. ModelArk API
access for 2.5 is still marked coming soon (August 2026), which is why the
registry entry is `confidence: "inferred"`: a capability mismatch on 2.5 is
reported as a warning and the request still goes out, rather than being refused.

Two worked examples, the same story either way, both lint-clean in CI:

| File | Shows |
| --- | --- |
| `examples/shots-2-5.json` | 2.5: the film as two 30s acts, timestamp plans, a pure ordinal-bound pack in act 1 and the mixed mode (`first_frame` at `@Image 1`) in act 2 |
| `films/lighthouse/` | 2.0: the same film as twelve 8s shots, the complete planning ladder, keyframe-per-shot, cards, a real run |

`lighthouse` is the end-to-end demo of the whole pipeline and stays the model
for structure, anchoring, and planning documents. Its 8s `Shot N:` clips are
2.0's shape, not a template for a 2.5 act.

## Read before writing

| Reference                          | Read when                                                              |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `references/shots-schema.md`       | Writing or fixing any JSON. Exact fields, the ordinal contract, hard rules, every lint |
| `references/seedance-prompting.md` | Writing any prompt. Duration, timestamp plans, brackets, reference binding |
| `references/film-pipeline.md`      | Turning planning documents into JSON. Anchoring, blocks, still mapping |

## Workflow

```text
- [ ] 1. Lock the idea: logline, throughline, length, look, generation budget
- [ ] 2. Write the planning documents (storycraft)
- [ ] 3. Derive the keyframes and any character/prop/environment stills -> stills.json
- [ ] 4. Write shots.json: prompts, anchoring, ordinal bindings, seeds, cards
- [ ] 5. Dry-run both files, fix every warning, report cost
```

**Step 1.** Pin down the logline, the emotional throughline, total runtime,
generation count, look, and audio plan. Each shot's **duration is a story unit
within the model envelope** (2.5: 4-30s; 2.0: 4-15s). Short inserts, mid-length
multi-cuts, and 30s one-take acts are all valid; never force a house length and
never always max. On 2.5 the natural unit is an **act**, not a gesture: a 30s
pass holds setup, turn, and resolution. If the user gave a one-liner, propose a
logline and a final image, then confirm. `storycraft` owns this craft.

**Step 3.** One still per shot, sharing the shot's id, showing that shot's
literal opening composition. Add character sheets (one per age block), hero
props, and shared environment plates as needed. On 2.5, a long act usually also
wants a per-segment staging plate, so each timestamp range has its own image
ordinal to point at.

**Step 4.** Anchor every shot to at least one image, give it a `seed` matching
its still's seed, and write the beats as a **timestamp plan**. Name each
reference's single job by ordinal in the prompt. Shared style goes in
`film.promptPreamble`.

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

- **Bind every reference by ordinal, and count ordinals per media type.**
  `@Image 2` is the second **image** in `references[]`, not the second entry,
  and a `first_frame` consumes an image ordinal. Getting this wrong spends a
  whole 30s generation on the wrong reference for the wrong job. Full contract
  in `shots-schema.md`.
- **Anchor every shot to an image.** Mode A: a `first_frame` keyframe, the
  literal opening composition. Mode B: a `reference_image` pack for
  likeness, style, staging, and motion. **On 2.5 you may combine them**, and if
  you do, the frame role goes first so the packs start at `@Image 2`. On
  2.0-family, mixing frame roles with `reference_*` is a schema error.
- **A film longer than one generation is several independent acts, cut together
  by `vs stitch`.** Each act carries its own reference pack, is retakeable on
  its own, and generates concurrently up to the model's task limit. Continuing
  one generation from another's output is a repair tool, not a structure: see
  `seedance-prompting.md`.
- **Past 20s, a timestamp plan is the carrier.** `Shot N:` orders the beats but
  says nothing about rhythm, so the model invents the pacing between them and
  the gaps stretch. Use `0-6s:` / `7-13s:` ranges.
- **Prompts are fully expanded.** No tokens, no "the character from the
  previous shot". The model has no memory across generations.
- **Coverage, not empty time.** Every timestamp segment changes camera setup and
  verb. Open mid-action. Do not invent a mandatory beat count.
- **Per-clip audio is diegetic SFX and ambience only**, in `<angle brackets>`.
  Score and narration are mixed at `vs stitch`. Keep `generateAudio: true`.
- **Title cards are rendered in post** via the `cards` array. In-model text is
  unreliable, and any signage that must appear in frame is baked into the
  keyframe still instead.
- **Generate at 720p.** 1080p is a delivery upscale, not a generation target;
  2.5's console card lists 480p/720p only.
- **A 2.5 film sets no `film.draftModel`.** `vs generate --draft` validates
  against the draft model, and 2.0-fast is documented at 4-15s, so a 30s film
  with a 2.0-fast draft model is refused outright. Leave it unset and `--draft`
  runs the film's own model at 480p.

## Related skills

- `storycraft` for the treatment, style bible, beat sheet, and shot list.
- `vs` to run the pipeline once the JSON is written.
- `nano-banana-2` for still prompts when a film's stills `model` is `gemini-*`,
  and for any keyframe that must contain legible text.
