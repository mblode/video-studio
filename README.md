<div align="center">

# Video Studio

**Write a shot list as JSON and get back a finished film, without paying for the bad takes**

`vs` generates each shot with AI video models, then cuts them together with title cards, music, and narration.

</div>

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

`doctor` reports anything missing. Get a key from the [BytePlus console](https://console.byteplus.com).

## Quickstart

[`films/lighthouse/`](films/lighthouse/) is a complete 12-shot fictional short with a treatment, style bible, beat sheet, screenplay, shot list, keyframes, and generation-ready JSON, in stark black-and-white 1.10:1. Run it top to bottom.

```bash
vs generate films/lighthouse/shots.json --dry-run   # free: check it, price it
vs stills   films/lighthouse/stills.json            # cents: the reference images
vs animatic films/lighthouse/shots.json             # $0: watch the whole edit
vs generate films/lighthouse/shots.json --max-cost 18
vs stitch   films/lighthouse/shots.json --xfade 0.4
```

For your own film, `vs init films/my-film` writes a `shots.json`, a `stills.json`, and a README to follow, then the same commands apply. Everything for a film lives in its own folder, and only the demo is committed to git.

## The cost ladder

AI video is expensive and unpredictable, so `vs` works in cheap steps: preview the whole edit from stills for $0, run a 480p draft, and only pay for the good version once.

- **Preview first:** watch the full edit assembled from stills before paying for a single clip.
- **Set a limit:** `--max-cost` refuses a run before it overspends, and holds even under `--yes`.
- **Pick up where you left off:** finished and in-flight shots are never resubmitted.
- **Keep every version:** retakes, renders, animatics, and exports get numbered files instead of overwriting earlier work.

## Commands

| Command | What it does |
| --- | --- |
| `vs init` | Start a new film |
| `vs doctor` | Check your setup |
| `vs stills` | Generate the reference images |
| `vs animatic` | Cut the whole film from stills, no video spend |
| `vs generate` | Generate the clips |
| `vs score` | Lyria instrumental bed (`score-vNNN.mp3`) |
| `vs narrate` | ElevenLabs per-line VO from a TSV |
| `vs narrate assemble` | Place lines on the cut, giving `narration.mp3` |
| `vs status` | See what has finished |
| `vs use` | Select or roll back a shot revision |
| `vs download` | Fetch clips you already generated |
| `vs review` | Contact sheet of frames, to spot problems |
| `vs stitch` | Assemble the film |
| `vs upscale` | 720p to 1080p, free |
| `vs share` | Shrink it to send on WhatsApp |

Useful flags: `--dry-run` to see what would happen, `--draft` for a cheap 480p pass that sits beside the real one, `--json` for scripts, `--verbose` when something breaks. Run `vs <command> --help` for the rest.

Generated clips live at `output/clips/<shot>/vNNN.mp4` and finished cuts at `output/renders/final/vNNN.mp4`. `--force` creates a new take, `vs use` switches the selected take without deleting anything, and `vs status` shows the latest, selected, and available revisions.

## Notes

- A plain `vs stitch` gives you a cut with sound effects but no music or voiceover. Generate those with `vs score` and `vs narrate` / `vs narrate assemble`, then pass `--music` and `--narration`, using the same `--xfade` on both.
- Title cards render on macOS only.
- Non-interactive runs need `--yes`, or the command fails fast rather than hanging.
- `vs` will never be a GUI, a video editor, or a host for models. Bug reports are welcome; new feature requests usually are not. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Agent skills

```bash
npx skills add mblode/video-studio
```

Works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Goose, OpenCode, and Windsurf.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
