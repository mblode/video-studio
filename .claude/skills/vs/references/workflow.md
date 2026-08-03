# Running a film, rung by rung

The cost ladder, borrowed from how animation studios stage a film: story reel,
previs, animation, lighting, final render once. Every rung locks a decision
cheaply before the next one spends. Skipping rungs is how a film gets
regenerated three times.

`films/lighthouse/README.md` walks this with real numbers for the complete
12-shot showcase.

## The ladder

| Rung | Command                        | Costs      | Locks             |
| ---- | ------------------------------ | ---------- | ----------------- |
| 0    | `generate --dry-run`           | $0         | Schema and lint   |
| 1    | `stills`                       | cents      | The look          |
| 2    | `animatic`                     | $0 of video | Pacing and order |
| 3    | `generate --draft` (480p)      | ~45% of a final | Motion       |
| 4    | `generate` (720p)              | the real spend | Quality        |
| 5    | `review`, `stitch`, `upscale`  | free       | The cut           |

The ratio at rung 3 is unchanged on Seedance 2.5 (480p is 45% of 720p's tokens
at any duration), but the base is 3.75x larger per clip: a 30s 720p act on 2.5
costs $6.93, where an 8s 720p clip on 2.0 costs $1.33. **Rung 2 therefore
carries more weight than it used to.** The animatic is the last rung that costs
nothing, and every paid rung above it is now five times dearer per clip. Cut
the film in the animatic until the order and the act boundaries are settled.

```bash
node dist/cli.js doctor                                        # keys, ffmpeg, Node, card tools
node dist/cli.js generate films/<slug>/shots.json --dry-run    # payloads + lint, no network
node dist/cli.js stills   films/<slug>/stills.json
node dist/cli.js animatic films/<slug>/shots.json              # -> output/animatics/v001.mp4
node dist/cli.js generate films/<slug>/shots.json --draft
node dist/cli.js review   films/<slug>/shots.json --draft      # -> review-draft/index.md
node dist/cli.js generate films/<slug>/shots.json --max-cost 5
node dist/cli.js score    "instrumental bed prompt" --shots films/<slug>/shots.json
node dist/cli.js narrate  films/<slug>/lines.tsv
node dist/cli.js narrate  assemble films/<slug>/shots.json --xfade 0.4
node dist/cli.js stitch   films/<slug>/shots.json --xfade 0.4 --music score-v001.mp3 --narration narration.mp3
```

After generation, the full happy path adds post audio: `vs score` for the bed,
`vs narrate` from `lines.tsv`, `vs narrate assemble --xfade …` to place lines on
the cut, then `vs stitch --xfade … --music … --narration …` with the **same**
`--xfade` (and the same per-shot `transition` overrides). A plain stitch is
SFX-only.

Commands run as `node dist/cli.js <cmd>` from the repo root, or as `vs` after
`npm link`. Run `npm run build` first if `dist/` is stale.

## Draft and final live side by side

`--draft` (on `generate`, `status`, `download`, `review`, `stitch`, `animatic`,
`upscale`) forces 480p with audio off, uses `film.draftModel` if set, and
namespaces every artifact so it can never clobber the final:

|              | final (default) | `--draft`          |
| ------------ | --------------- | ------------------ |
| manifest     | `tasks.json`    | `tasks.draft.json` |
| clips        | `output/clips/<shot>/vNNN.mp4` | `output-draft/clips/<shot>/vNNN.mp4` |
| review sheet | `review/`       | `review-draft/`    |

Promotion needs no new command. The seed lives in `shots.json` and is shared
across passes, so re-running `generate` without `--draft` (optionally with
`--shot <approved ids>`) reproduces the approved draft's composition family at
full quality.

### Drafting a Seedance 2.5 film

**Leave `film.draftModel` unset.** There is no 2.5-fast, and 2.0-fast is not a
cheap proxy for a 30s act, it is a refused run: `vs generate --draft` validates
every shot against `film.draftModel` rather than `film.model`, 2.0-fast is
documented at 4-15s, and a documented mismatch is a hard error. A 30s film with
`draftModel: "dreamina-seedance-2-0-fast-260128"` fails with `invalid_input`
after you have already committed to the run.

With `draftModel` unset, `--draft` runs the film's own model at 480p, which is
45% of the final cost. That is the same ratio as the 2.0 ladder, on a base
3.75x larger per clip. `lintShotsFile` catches the envelope mismatch at
`--dry-run`, so rung 0 is where you find out, not rung 3:

```bash
node dist/cli.js generate films/<slug>/shots.json --dry-run
```

**Promote one act before drafting the rest.** The seed is portable across
passes but the composition is not guaranteed to survive a resolution change.
Run one act at 480p, promote that same act to 720p at the same seed, and
compare. If the composition re-rolls between the two, drafting the other acts
teaches you nothing and you should go straight to finals. At $6.93 an act that
one check is worth its own cost several times over.

## Cost control

`generate` prints an estimate (shot count, tokens, USD) and asks before
submitting anything paid.

- `--yes` skips the prompt. **Required non-interactively**: without a TTY the
  command fails fast rather than hanging on a prompt nobody can answer.
- `--max-cost <usd>` is a hard ceiling, enforced under `--yes` and `--dry-run`
  too. A run whose estimate exceeds it is refused, not confirmed. This is the
  real guardrail for an unattended or agent-driven run, and `--dry-run
  --max-cost` is how you check a film against a budget for free.

The estimate is derived from the provider's own token formula, and real billed
usage is written back to the manifest so the model self-corrects. Details in
`models.md`.

## Retakes and resumption

```bash
node dist/cli.js generate films/<slug>/shots.json --shot s06-drive-breaks --force
node dist/cli.js stills   films/<slug>/stills.json --still s06-drive-breaks --force
```

`--shot` / `--still` narrow the run to specific ids. On video, `--force`
submits the next immutable revision (`v001`, `v002`, …); it never replaces an
earlier clip. A new revision becomes selected only after it downloads
successfully, so a failed retake leaves the previous good take stitchable.
Without `--force`, completed shots are skipped, so re-running a whole film after
a partial failure only pays for what is missing.

`vs status <shots-file>` shows the latest, selected, and available revisions.
Roll back without moving media:

```bash
node dist/cli.js use films/<slug>/shots.json s06-drive-breaks v001
```

An in-flight task is **never resubmitted**: the manifest re-attaches by task id.
4xx responses are not retried. Result URLs expire in about 24 hours, so
`generate` downloads immediately and drops the presigned URL from the manifest
once the file is on disk.

If a run was interrupted after submission:

```bash
node dist/cli.js status   films/<slug>/shots.json --refresh
node dist/cli.js download films/<slug>/shots.json
```

`status` and `download` both take the shots file positionally. `--no-wait` on
`generate` submits without polling, which is the deliberate way to split
submission from collection.

Because the manifest is committed JSON, a half-finished generation resumes on
another machine, and a generation run is reviewable as a git diff.

## Concurrency

`--concurrency` defaults to 3 for `generate` (the individual account's task
limit) and 2 for `stills`. Every shot is independent, so they all submit in
parallel up to that limit. A 4K run is capped at one concurrent task by the
provider regardless of the flag.

**So is every Seedance 2.5 run**, at every resolution: 1 concurrent, 60 RPM. A
30s generation takes 10 to 15 minutes, so a six-act film is 60 to 90 minutes
strictly serial and `--concurrency` changes nothing. Plan the session around
that, and prefer one considered pass to three hopeful ones.

## Agent-driven runs

- `--json` on every command, automatic when stdout is not a TTY.
- `--verbose` for stack traces and the underlying cause of an error.
- Nothing prompts without a TTY; a command that would have prompted fails fast.
- `--dry-run` exists on everything that spends money or shells out to ffmpeg
  (`generate`, `stills`, `animatic`, `review`, `stitch`, `share`, `upscale`).
- `--output` always resolves against the current working directory, not the
  film directory.
