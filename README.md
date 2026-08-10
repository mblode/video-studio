<div align="center">

# [Video Studio](https://video-studio.blode.md)

**Turn a list of shots into a finished film, without wasting money on bad takes**

Describe each shot in JSON. `vs` makes the AI clips, then cuts them into one video.

</div>

## Demo

Setup, costs, commands, and a sample film you can run.

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

Copy `.env.example` to `.env`, add your `ARK_API_KEY` from the [BytePlus console](https://console.byteplus.com), then run `vs doctor`.

## Quickstart

Try the sample film in [`films/lighthouse/`](films/lighthouse/):

```bash
vs generate films/lighthouse/shots.json --dry-run
vs stills   films/lighthouse/stills.json
vs animatic films/lighthouse/shots.json
vs generate films/lighthouse/shots.json --max-cost 18
vs stitch   films/lighthouse/shots.json --xfade 0.4
```

Start your own with `vs init films/my-film`.

## Spend less

- **Preview for free:** see the whole edit from stills before you pay for video.
- **Set a budget:** `--max-cost` stops a run that would go over.
- **Never pay twice:** finished or in-progress shots are not sent again.
- **Keep every take:** old versions stay on disk; `vs use` picks which one to use.

## Agent skills

```bash
npx skills add mblode/video-studio -g --agent codex claude-code -y
```

Works with Claude Code, Codex, Cursor, and other [skills.sh](https://skills.sh) agents. From a clone, they are already available.

## License

MIT

---

Crafted by [<img src="https://blode.co/avatar-circle.png" width="20" align="top" />](https://blode.co) [Matthew Blode](https://blode.co)
