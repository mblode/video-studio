# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/mblode/video-studio/security/advisories/new)
rather than opening a public issue. I am one person, so expect a first reply
within about a week.

## What this tool does with your credentials

`vs` talks to paid generation APIs on your behalf, so it is worth being precise
about where keys live and what ends up on disk.

**Keys are read from the environment only.** `ARK_API_KEY` and the optional
`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID` are loaded
from a `.env` file or the process environment. They are never written to a
manifest, a log line, or an error message. `.env` is gitignored. `.env.example`
holds names with empty values and is the canonical list of what the tool reads.

**Manifests are designed to be committed, and are scrubbed for that.** Each film
keeps a `tasks.json` recording task ids, parameters, and status so a generation
resumes on any machine. It deliberately does not retain the provider's signed
result URL once a clip is downloaded: those URLs expire in about 24 hours and
carry the provider's access key id in the query string, which is how one ended
up in this repository's pre-release history.

**Generated video is append-only by default.** Every take, render, animatic,
upscale, and share export gets a numbered path. Failed retakes do not replace
the manifest's selected successful revision, and explicit output paths refuse
to replace an existing video.

**Generated media is gitignored by default.** `films/**` ignores video, audio,
and image files outright, so a reference photograph or a voice recording cannot
be committed by accident.

**Costs are a safety property here.** A misconfigured shot list can spend real
money quickly. `--dry-run` makes no network calls, `vs generate` asks for
confirmation with a cost estimate, and `--max-cost` refuses a run whose estimate
exceeds a ceiling you set. Estimates are estimates; treat them as guardrails
rather than guarantees.

## Scope

This is a local CLI. It has no server, no telemetry, and no network calls beyond
the generation APIs you configure and the result downloads they hand back.
