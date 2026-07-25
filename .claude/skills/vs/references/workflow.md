# Running a film, rung by rung

The cost ladder, borrowed from how animation studios stage a film: story reel,
previs, animation, lighting, final render once. Every rung locks a decision
cheaply before the next one spends. Skipping rungs is how a film gets
regenerated three times.

`films/lighthouse/README.md` walks this with real numbers for a five-shot film.

## The ladder

| Rung | Command                        | Costs      | Locks             |
| ---- | ------------------------------ | ---------- | ----------------- |
| 0    | `generate --dry-run`           | nothing    | Schema and lint   |
| 1    | `stills`                       | cents      | The look          |
| 2    | `animatic`                     | $0 of video | Pacing and order |
| 3    | `generate --draft`             | ~45% of a final | Motion       |
| 4    | `generate`                     | the real spend | Quality        |
| 5    | `review`, `stitch`, `upscale`  | free       | The cut           |

```bash
node dist/cli.js doctor                                        # keys, ffmpeg, Node, card tools
node dist/cli.js generate films/<slug>/shots.json --dry-run    # payloads + lint, no network
node dist/cli.js stills   films/<slug>/stills.json
node dist/cli.js animatic films/<slug>/shots.json              # -> output/animatic.mp4
node dist/cli.js generate films/<slug>/shots.json --draft
node dist/cli.js review   films/<slug>/shots.json --draft      # -> review-draft/index.md
node dist/cli.js generate films/<slug>/shots.json --max-cost 5
node dist/cli.js stitch   films/<slug>/shots.json --xfade 0.4 --music score.mp3 --narration vo.mp3
```

Commands run as `node dist/cli.js <cmd>` from the repo root, or as `vs` after
`npm link`. Run `npm run build` first if `dist/` is stale.

## Draft and final live side by side

`--draft` (on `generate`, `status`, `download`, `review`, `stitch`, `animatic`,
`upscale`) forces 480p with audio off, uses `film.draftModel` if set, and
namespaces every artifact so it can never clobber the final:

|              | final (default) | `--draft`          |
| ------------ | --------------- | ------------------ |
| manifest     | `tasks.json`    | `tasks.draft.json` |
| clips        | `output/`       | `output-draft/`    |
| chain frames | `frames/`       | `frames-draft/`    |
| review sheet | `review/`       | `review-draft/`    |

Promotion needs no new command. The seed lives in `shots.json` and is shared
across passes, so re-running `generate` without `--draft` (optionally with
`--shot <approved ids>`) reproduces the approved draft's composition family at
full quality.

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
node dist/cli.js generate films/<slug>/shots.json --shot s03-lamp-ignites --force
node dist/cli.js stills   films/<slug>/stills.json --still s03-lamp-ignites --force
```

`--shot` / `--still` narrow the run to specific ids; `--force` overwrites work
that already succeeded. Without `--force`, completed shots are skipped, so
re-running a whole film after a partial failure only pays for what is missing.

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
limit) and 2 for `stills`. Keyframe-anchored shots are independent, so they all
submit in parallel; `continueFrom` chains serialize because each shot needs the
previous clip's last frame. A 4K run is capped at one concurrent task by the
provider regardless of the flag.

## Agent-driven runs

- `--json` on every command, automatic when stdout is not a TTY.
- `--verbose` for stack traces and the underlying cause of an error.
- Nothing prompts without a TTY; a command that would have prompted fails fast.
- `--dry-run` exists on everything that spends money or shells out to ffmpeg
  (`generate`, `stills`, `animatic`, `review`, `stitch`, `share`, `upscale`).
- `--output` always resolves against the current working directory, not the
  film directory.
