# Contributing

Thanks for looking. Please read the scope note before opening anything, because
it will save us both time.

## Scope

`vs` turns a JSON shot list into generated clips and cuts them together. That is
the whole job.

**Non-goals**, deliberately and permanently: a GUI, a timeline or non-linear
editor, hosting models, proxying anyone's API keys, and general-purpose video
editing. There are good tools for each of those, and this one stays small by not
becoming them.

Because of that, **bug reports and provider-breakage reports are much more
welcome than feature PRs.** A feature PR that expands the scope above is
unlikely to be merged no matter how good it is, and I would rather say so here
than after you have written it. If you are unsure whether something is in scope,
open an issue first and ask.

## Reporting a bug

Use the Bug template. It asks for `vs doctor` output because most reports come
down to a missing key, a missing ffmpeg, or a Node version mismatch, and that
one command answers all three.

If a provider changed its API out from under the tool, use the Provider
breakage template instead. Include the request you sent and the response you
got, with your key redacted.

Do not paste an unredacted `tasks.json`: result URLs are presigned and contain
provider credentials.

## Working on the code

Requires Node >= 24 and ffmpeg.

```bash
npm install          # runs the build and installs git hooks
npm run verify       # lint + typecheck + knip + tests, the tier that gates a commit
```

Narrower tiers when you want a faster loop:

| Command | Checks |
| --- | --- |
| `npm run lint` | formatting and lint only |
| `npm run typecheck` | types only |
| `npm run test` | tests only |
| `npm run check` | lint + typecheck + knip |
| `npm run knip` | unused files, exports, and dependencies |
| `npm run verify` | lint + typecheck + knip + tests |

A pre-commit hook formats your staged files. It is scoped to staged files on
purpose, so it will not reformat anything you did not touch.

### Things worth knowing before you edit

- **The tool spends real money.** Anything touching `generate` or `stills` needs
  a `--dry-run` path that makes no network call, and any new cost-affecting
  parameter belongs in the estimate.
- **Never re-submit an in-flight task.** The manifest re-attaches by task id
  precisely so a retry does not pay twice.
- **Never overwrite generated video.** Paid takes and local renders use numbered
  revisions. A failed retake must leave the last successful selection intact.
- **Pure planners, thin commands.** The arg builders and planners in `src/` are
  pure functions with unit tests; the `commands/` layer does IO. New logic goes
  in the pure half where it can be tested without a network or a GPU.
- ESM only. Relative imports carry a `.js` extension or the build fails.

`AGENTS.md` carries the gotchas that are not visible from the code, and the
skills under `.claude/skills/` carry the domain knowledge about prompting the
models well. Both are worth a skim.

## Code of conduct

Be decent. I will remove anyone who is not.
