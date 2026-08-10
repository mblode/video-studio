<div align="center">

# [Video Studio](https://video-studio.blode.md)

**Write a shot list as JSON and get back a finished film, without paying for the bad takes**

`vs` generates each shot with AI video models, then cuts them together with title cards, music, and narration.

</div>

## Demo

Install, the cost ladder, CLI reference, and the lighthouse walkthrough.

<p>
<a href="https://video-studio.blode.md">
<img alt="Read the docs" src=".github/assets/documentation.svg" width="200" />
</a>
</p>

## Install

You need [Node 24+](https://nodejs.org) and ffmpeg (`brew install ffmpeg`).

```bash
git clone https://github.com/mblode/video-studio.git
cd video-studio
npm install
npm link
```

Copy `.env.example` to `.env`, paste your `ARK_API_KEY`, then run `vs doctor`. Keys come from the [BytePlus console](https://console.byteplus.com).

## Quickstart

[`films/lighthouse/`](films/lighthouse/) is a complete 12-shot short. Climb the cost ladder:

```bash
vs generate films/lighthouse/shots.json --dry-run
vs stills   films/lighthouse/stills.json
vs animatic films/lighthouse/shots.json
vs generate films/lighthouse/shots.json --max-cost 18
vs stitch   films/lighthouse/shots.json --xfade 0.4
```

For your own film: `vs init films/my-film`.

## The cost ladder

- **Preview first:** assemble the cut from stills before paying for a clip.
- **Set a limit:** `--max-cost` refuses a run before it overspends.
- **Resume safely:** finished and in-flight shots are never resubmitted.
- **Keep every version:** retakes get numbered files; `vs use` rolls back.

## Agent skills

```bash
npx skills add mblode/video-studio -g --agent codex claude-code -y
```

Works with Claude Code, Codex, Cursor, and other [skills.sh](https://skills.sh) hosts. From a clone, `.claude/skills` and `.agents/skills` already point at `skills/`.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
