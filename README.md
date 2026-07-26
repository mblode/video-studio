# video-studio

Write a shot list as JSON, get back a finished film.

`vs` generates each shot with AI video models, then cuts them together with
title cards, music, and narration. AI video is expensive and unpredictable, so
it works in cheap steps: preview the whole edit from still images for $0, run a
480p draft, and only pay for the good version once.

- **Preview first:** watch the full edit from stills before paying for video.
- **Set a limit:** `--max-cost` stops a run before it overspends.
- **Pick up where you left off:** finished and in-flight shots are not submitted
  again.
- **Keep every version:** retakes, renders, animatics, and exports get numbered
  files instead of overwriting earlier work.

## Install

You need [Node 24+](https://nodejs.org) and ffmpeg (`brew install ffmpeg`).

```bash
git clone https://github.com/mblode/video-studio.git
cd video-studio
npm install
npm link

cp .env.example .env   # paste your ARK_API_KEY into it
vs doctor
```

`doctor` tells you if anything is missing. Get a key from the
[BytePlus console](https://console.bytepluses.com).

## Try it

[`films/lighthouse/`](films/lighthouse/) is a complete 12-shot fictional short
with a treatment, style bible, beat sheet, screenplay, shot list, keyframes, and
generation-ready JSON. It uses stark black-and-white 1.10:1 keyframes. Run it
top to bottom.

```bash
vs generate films/lighthouse/shots.json --dry-run   # free: check it, price it
vs stills   films/lighthouse/stills.json            # cents: the reference images
vs animatic films/lighthouse/shots.json             # $0: watch the whole edit
vs generate films/lighthouse/shots.json --max-cost 18
vs stitch   films/lighthouse/shots.json --xfade 0.4
```

## Your own film

```bash
vs init films/my-film
```

That writes a `shots.json`, a `stills.json`, and a README to follow. Edit the
shots, then run the same commands as above.

Everything for a film lives in its own folder. Only the demo is committed to
git; your films stay on your machine.

## Commands

| Command | What it does |
| --- | --- |
| `vs init` | Start a new film |
| `vs doctor` | Check your setup |
| `vs stills` | Generate the reference images |
| `vs animatic` | Cut the whole film from stills, no video spend |
| `vs generate` | Generate the clips |
| `vs status` | See what has finished |
| `vs use` | Select or roll back a shot revision |
| `vs download` | Fetch clips you already generated |
| `vs review` | Contact sheet of frames, to spot problems |
| `vs stitch` | Assemble the film |
| `vs upscale` | 720p to 1080p, free |
| `vs share` | Shrink it to send on WhatsApp |

Useful flags: `--dry-run` to see what would happen, `--draft` for a cheap 480p
pass that sits beside the real one, `--json` for scripts, `--verbose` when
something breaks. Run `vs <command> --help` for the rest.

Generated clips live at `output/clips/<shot>/vNNN.mp4`; finished cuts live at
`output/renders/final/vNNN.mp4`. `--force` creates a new take, and `vs use`
switches the selected take without deleting anything. `vs status` shows the
latest, selected, and available revisions.

Two things worth knowing. `vs stitch` on its own gives you a cut with sound
effects but no music or voiceover, so pass `--music` and `--narration` for
anything you plan to show people. And title cards only render on macOS.

## Using it with an AI coding agent

```bash
npx skills add mblode/video-studio
```

Works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose,
OpenCode, and Windsurf.

## Scope

`vs` turns a shot list into clips and cuts them together. It will never be a
GUI, a video editor, or a host for models. Bug reports are welcome; new feature
requests usually are not. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE.md)
