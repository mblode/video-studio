# video-studio

A CLI (`vs`) that turns a JSON shot list into AI-generated video clips and cuts
them together. Each film is a self-contained directory under `films/`.

Setup is `npm install` (Node >= 24, and ffmpeg on the PATH); it builds and
installs the git hooks. `vs doctor` diagnoses a broken environment. `README.md`
has the command surface and `--help` is accurate, so don't restate either here.

Run `npm run verify` (lint, typecheck, tests) before a commit. Narrower tiers:
`npm run lint`, `npm run typecheck`, `npm run test`, `npm run check`.

## Where the knowledge lives

| Consult when | File |
| --- | --- |
| Writing or fixing a shot prompt, or touching the shots schema | `.claude/skills/seedance/` |
| Writing a treatment, beat sheet, or shot list | `.claude/skills/storycraft/` |
| Generating stills or keyframe boards | `.claude/skills/nano-banana-2/` |
| Driving the CLI through a film, end to end | `.claude/skills/vs/` |
| A worked, runnable example of every feature | `films/lighthouse/` |
| Scope, non-goals, verification tiers | `CONTRIBUTING.md` |
| Key handling, what lands in a manifest | `SECURITY.md` |

## Gotchas

- **ESM only.** Relative imports need a `.js` extension or the NodeNext
  typecheck fails.
- **Dual build.** `tsdown.config.ts` emits `cli.js` (shebang via `banner`) and
  `index.js` (with types). Don't merge them or put a shebang in `src/cli.ts`.
  `fixedExtension: false` is what keeps the output extensions matching
  package.json.
- **`resolution` is only emitted when explicitly set.** The API's own example
  omits it, so an unconfigured final sends the original body and can't trip an
  unknown-field reject. `DEFAULT_RESOLUTION` stays `1080p` because it models
  what the API does when the field is absent, which is what keeps a cost
  estimate for an unconfigured film honest.
- **Cost estimates come from the official token formula**
  (`duration × w × h × fps / 1024`), not a per-second rate. Watch the 4K trap:
  its per-token rate is *lower* than 1080p, but it burns about 4x the tokens, so
  a flat $/sec estimate is wrong by up to 5x across the range. Real
  `usage.completion_tokens` is written back to the manifest so estimates
  self-correct; the original calibration was 22,446,900 tokens over 101 calls.
- **Never re-submit an in-flight task.** `isInFlight` re-attaches by task id.
  4xx is never retried. Result URLs expire in about 24 hours, so `generate`
  downloads immediately, and the URL is dropped from the manifest once the file
  is on disk (it is presigned and carries the provider's access key id).
- **The opening title card renders with `fadeIn: false`** so frame 0 is the
  visible card rather than black. Otherwise WhatsApp and friends grab a black
  poster frame. Keep any shareable cut opening on a non-black frame.
- **A plain `vs stitch` with no `--music`/`--narration` is an SFX-only cut and
  will sound empty.** Per-shot prompts only ever ask for SFX and ambience; the
  score and voiceover are mixed at stitch time. Re-stitch with both whenever a
  shot is regenerated.
- **Title cards are macOS-only.** This machine's ffmpeg lacks `drawtext`, so
  cards are rasterised through `qlmanage` and `sips`. `--font` fails loudly for
  a family that is not installed, because qlmanage substitutes a default face
  and exits 0.
- **`films/` is a gitignored workspace.** Only `films/lighthouse` is public, and
  a media backstop blocks every video, audio, and image file under `films/`.
  Your own films stay local. A film's `tasks.json` is committable on purpose so
  a generation resumes anywhere.
- **The Gemini stills path is built but has never run against a live key.**
  Confirm with `--dry-run` and one real still before trusting it.
- **The pre-commit hook is scoped to `{staged_files}`.** Removing that makes
  `ultracite fix` walk the repo and sweep unrelated files into the commit.
