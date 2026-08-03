---
name: vs
description: Runs the video-studio `vs` CLI that turns a shot list into AI-generated video clips via BytePlus Seedance 2.x, with reference stills from Seedream or Nano Banana, Lyria score beds, and ElevenLabs narration. Covers every command (init, doctor, stills, generate, score, narrate, status, use, download, animatic, review, stitch, upscale, share), immutable clip revisions, the draft-to-final cost ladder, the audio mix, and model ids and rate limits. Use when the user wants to "run vs", "generate the film", "generate stills", "make the animatic", "stitch the cut", "score the film", "narrate", "check task status", "roll back a take", "share the film", "upscale for delivery", "do a draft pass", "the mix sounds wrong", "which model should I use", or asks what a vs command or flag does. For authoring the shots.json/stills.json content itself, use seedance.
---

# vs

Operate the `vs` CLI: submit a film's `shots.json` to Seedance, poll and
download the clips, and assemble them into a finished cut. Each film is a
self-contained `films/<slug>/` directory holding `shots.json`, `stills.json`,
and a `tasks.json` manifest the CLI maintains.

- **IS:** running the commands, picking flags, and staging a film through the
  cost ladder.
- **IS NOT:** writing the `shots.json` / `stills.json` content (use `seedance`)
  or the story documents (use `storycraft`).

Run `npm run build` first if `dist/` is stale, then `node dist/cli.js <cmd>`
(or `vs` after `npm link`). **`--help` is accurate and is the authority on
flags.** Generation is paid: `vs doctor` checks keys and ffmpeg before you
spend, and `--dry-run` costs nothing.

## Commands

| Command                        | What it does                                                            |
| ------------------------------ | ------------------------------------------------------------------------ |
| `vs init <dir>`                | Scaffold a film (shots.json, stills.json, README) with 720p defaults    |
| `vs doctor [task-id]`          | Check Node, `.env`, keys, ffmpeg, card tools; with an id, the endpoint shape |
| `vs stills <stills-file>`      | Generate reference stills into `stills/`                                |
| `vs generate <shots-file>`     | Submit, poll, download immutable clips to `output/clips/<shot>/vNNN.mp4` |
| `vs score <prompt>`            | Lyria 3 Pro instrumental bed → `score-vNNN.mp3` at the film root        |
| `vs narrate <lines.tsv>`       | ElevenLabs per-line VO → `line-NN.mp3` (`NN\\ttext` TSV)                 |
| `vs narrate assemble <shots>`  | Place lines on the stitch timeline → `narration.mp3`. `--xfade` must match stitch |
| `vs status [shots-file-or-task-id]` | Show the manifest, or fetch one task from the API                  |
| `vs use <shots-file> <shot> <version>` | Select or roll back a downloaded clip revision                |
| `vs download [shots-file]`     | Fetch succeeded clips not yet on disk                                   |
| `vs animatic <shots-file>`     | Story reel cut from the stills. $0 of video                             |
| `vs review <shots-file>`       | Frame contact sheet plus delivered-vs-requested flags                   |
| `vs stitch <shots-file>`       | Assemble clips and title cards into one film                            |
| `vs upscale <shots-file>`      | Lanczos-upscale final clips for delivery. Free                          |
| `vs share <video>`             | Two-pass compress under a size ceiling                                  |

Cross-cutting: `--dry-run` on anything that spends money or shells out to
ffmpeg, `--json` everywhere (automatic when stdout is not a TTY), `--verbose`
for the underlying cause of an error, `--draft` on the generation and assembly
commands.

## Read for detail

| Reference                 | Read when                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| `references/workflow.md`  | Running a film end to end. The ladder, draft/final, cost ceilings, retakes, resumption |
| `references/assembly.md`  | `animatic`, `review`, `stitch`, `upscale`, `share`. Title cards           |
| `references/audio-mix.md` | Anything about how the cut sounds                                         |
| `references/models.md`    | Choosing a model or resolution. Ids, rate limits, reference limits, cost  |

## The things that bite

- **A plain `vs stitch` with no `--music`/`--narration` is an SFX-only cut and
  will sound empty.** Per-shot prompts only ask for sound effects. Happy path:
  `vs score` → `vs narrate` → `vs narrate assemble --xfade …` →
  `vs stitch --xfade … --music score-vNNN.mp3 --narration narration.mp3` (same
  `--xfade` on both). Re-stitch after regenerating a shot.
- **720p is the generation target, not 1080p.** Generate at 720p, then
  `vs upscale --shot <final-edit ids>` for delivery, which is free. A prior 2.0
  run here asked for 1080p, was delivered 720p, and was billed at the 1080p
  rate.
- **A Seedance 2.5 run is strictly serial.** 1 concurrent task regardless of
  `--concurrency`, and a 30s generation takes 10 to 15 minutes, so a six-act
  film is 60 to 90 minutes. It is also about 39% dearer than 2.0 for the same
  runtime. What it buys is coherence, not price or speed.
- **A 2.5 film sets no `film.draftModel`.** There is no 2.5-fast, and 2.0-fast
  caps at 15s, so a 30s film pointed at it is refused rather than drafted.
  Unset, `--draft` runs the film's own model at 480p. `--dry-run` lints for it.
- **Non-interactive runs need `--yes`**, or the command fails fast rather than
  hanging. Pair it with `--max-cost <usd>`, which is a hard refusal that
  applies even with `--yes`.
- **Never resubmit an in-flight task.** The manifest re-attaches by id. Result
  URLs expire in about 24 hours, so `generate` downloads immediately.
- **`--force` creates a new revision.** It never replaces a clip. A failed
  retake leaves the previous downloaded revision selected.
- **Title cards are macOS-only** (rasterised via `qlmanage` and `sips`), and
  ffmpeg is required for `animatic`, `review`, `stitch`, and `upscale`.
- **`--output` resolves against the cwd** and refuses to replace an existing
  video. Omit it for an automatically numbered render.

## Requirements

`ARK_API_KEY` in `.env` for video (Seedance) and Seedream stills;
`GEMINI_API_KEY` for Nano Banana stills and `vs score` (Lyria);
`ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID` or `--voice`) for `vs narrate`.
See `.env.example`.

## Related skills

- `seedance` to author the `shots.json` / `stills.json` a film runs on.
- `storycraft` for the treatment, beat sheet, and shot list behind it.
- `nano-banana-2` to write still prompts when a film's stills model is
  `gemini-*`.
