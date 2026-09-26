# The audio mix

`vs stitch` builds a single ffmpeg filter graph for the whole cut
(`audioMixArgs` in `src/stitch.ts`). Four layers can go in: the clips' own
diegetic audio, music, narration, and a separately designed effects/ambience
stem. The final mix targets a web delivery loudness preset; it still needs
listening and measurement before release.

**A plain `vs stitch` with no `--music` and no `--narration` is an SFX-only
cut, and it will sound empty.** Per-shot prompts only ever ask the model for
sound effects and ambience. The score and the voiceover are a post decision, by
design. Re-stitch with both whenever any shot is regenerated.

## Happy path

```bash
# 1. Instrumental bed (Lyria 3 Pro via GEMINI_API_KEY)
vs score "Warm cinematic underscore, sparse piano and strings" \
  --shots films/<slug>/shots.json

# 2. Per-line VO from narration/lines.tsv (NN<TAB>text)
vs narrate films/<slug>/narration/lines.tsv --voice Charon \
  --style "warm, unhurried documentary narration"

# 3. Place lines on the stitch timeline (line<TAB>shotId<TAB>offset)
vs narrate assemble films/<slug>/shots.json \
  --placement narration/placement.tsv \
  --xfade 0.4 \
  --fade-shot <closing-shot-id>

# 4. Mix. --xfade must match assemble
vs stitch films/<slug>/shots.json \
  --xfade 0.4 \
  --music films/<slug>/score-v001.mp3 \
  --narration films/<slug>/narration.mp3
```

Use the same `--xfade` (and the same per-shot / per-card `transition`
overrides) for `vs narrate assemble` and `vs stitch`. Both default to `0`
(hard cuts / lossless concat when nothing else forces a re-encode).

Bring-your-own files still work: any path to `--music` / `--narration` is fine.
VO-forward cuts often want `--music-gain -18`; the CLI default remains `-12`.

For authored foley and ambience, pass `--effects <file> --effects-gain <dB>`.
The stem starts at film time zero, so include the opening cards and exactly the
same transitions as the cut. It works with `--latest` too, whose source clips
are silent. `--sfx-gain` controls the generated clips' audio; `--effects-gain`
controls the separate stem. Neither generates sound effects. Avoid doubling a
footstep or impact already present in the clip audio.

Narration assembly reports requested versus actual cue starts and every overlap
shift. It refuses lines that exceed the program runtime and an unknown
`--fade-shot`. Review shifts before mixing: a technically non-overlapping line
can still land over the wrong action. Missing lines must be recorded before
assembly; existing audio is not evidence that a revised script has been voiced.

Generated narration records the script, voice, model and audio checksum in an
adjacent `.mp3.json` file. Before any paid request, `vs narrate` checks every
existing line against this record. A changed script, renumbered line, switched
voice or unverified legacy MP3 stops the batch. Use a new output directory for
a revised performance; use `--force` only for a deliberate replacement. For
legacy audio, audition and conform it into a separate directory before assembly.
Never assume that a matching `line-NN.mp3` filename means matching spoken words.

## The chain

**Narration** is brought forward so dialogue reads over everything else:

1. `highpass=f=85` to de-rumble.
2. A 3 kHz presence lift (`equalizer=f=3000:width_type=q:w=1.2:g=3`).
3. `loudnorm=I=-16:TP=-1.5:LRA=11` for a controlled, consistent level.
4. `volume=<--narration-gain>dB`, default 0, after normalization so the offset
   changes voice level relative to the other stems.
5. Pad with silence and trim to the program duration. Split only when music
   needs a ducking key; narration alone has no unused filter output. The padded
   key keeps the score playing after the last spoken line.

**Music** is levelled, then ducked under the voice:

1. `volume=<--music-gain>dB`, default -12.
2. A two-second `afade` out at the end of the program.
3. `sidechaincompress` keyed by the narration copy
   (`threshold=0.05:ratio=8:attack=15:release=450`). Actual gain reduction depends
   on the narration signal; it is not a fixed 9 dB. Listen for pumping and
   masked words rather than assuming the preset fits every performance.

With no narration the sidechain is skipped and the bed plays flat.

**The program** is then mixed and mastered:

1. `amix` of clip audio, music, narration and effects with `normalize=0`, so the
   levels you set are the levels you get.
2. `loudnorm=I=-14:TP=-1.0:LRA=11`, this CLI's web preset. A filter target is
   not proof of the encoded file's measured loudness or a cinema delivery spec.

Every stream is conformed to stereo at 44.1 kHz
(`aformat=channel_layouts=stereo:sample_rates=44100`) before the sidechain and
the mix. A mono or 48 kHz input silently breaking the sidechain is the failure
this prevents.

## Tuning

| Flag                | Default | Effect                                          |
| ------------------- | ------- | ------------------------------------------------ |
| `--music-gain`      | `-12`   | Bed level before ducking                        |
| `--narration-gain`  | `0`     | Voice level after dialogue normalization       |
| `--sfx-gain`        | `0`     | Clip audio level (ignored by `--latest`)        |
| `--effects-gain`    | `0`     | Independent effects/ambience stem level        |

Raise `--music-gain` toward `-8` for a louder bed, lower it toward `-18` for a
VO-forward cut. Leave the mastering targets alone: they are the point of the
chain, not a preference.

`vs animatic` uses the same shape with `--music-gain` defaulting to `-18`,
because a story reel is scratch audio under a still frame and wants the bed
further back.

## When the mix does not run

`vs stitch` takes a lossless `-c copy` concat path when there are no
transitions, no music, no narration, no effects stem, and no `--grade`. That path is fast and
touches nothing, which also means none of the above happens. Any cut you intend
to show someone should be taking the re-encode path.
