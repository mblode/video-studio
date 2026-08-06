# The audio mix

`vs stitch` builds a single ffmpeg filter graph for the whole cut
(`audioMixArgs` in `src/stitch.ts`). Three layers go in: the clips' own
diegetic audio, an optional music bed, and an optional narration track. What
comes out is mastered to streaming loudness.

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
vs narrate films/<slug>/narration/lines.tsv --voice <elevenlabs-voice-id>

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

## The chain

**Narration** is brought forward so dialogue reads over everything else:

1. `volume=<--narration-gain>dB`, default 0.
2. `highpass=f=85` to de-rumble.
3. A 3 kHz presence lift (`equalizer=f=3000:width_type=q:w=1.2:g=3`).
4. `loudnorm=I=-16:TP=-1.5:LRA=11` for a controlled, consistent level.
5. Split in two: one copy joins the mix, one keys the ducking below.

**Music** is levelled, then ducked under the voice:

1. `volume=<--music-gain>dB`, default -12.
2. A two-second `afade` out at the end of the program.
3. `sidechaincompress` keyed by the narration copy
   (`threshold=0.05:ratio=8:attack=15:release=450`), which pulls the bed about
   **9 dB under the voiceover** whenever narration is present. The slow 450 ms
   release is what makes the score swell back up cleanly between lines instead
   of pumping.

With no narration the sidechain is skipped and the bed plays flat.

**The program** is then mixed and mastered:

1. `amix` of clip audio, music, and narration with `normalize=0`, so the
   levels you set are the levels you get.
2. `loudnorm=I=-14:TP=-1.0:LRA=11`, the streaming standard, so the finished cut
   is not quiet next to anything else the viewer plays.

Every stream is conformed to stereo at 44.1 kHz
(`aformat=channel_layouts=stereo:sample_rates=44100`) before the sidechain and
the mix. A mono or 48 kHz input silently breaking the sidechain is the failure
this prevents.

## Tuning

| Flag                | Default | Effect                                          |
| ------------------- | ------- | ------------------------------------------------ |
| `--music-gain`      | `-12`   | Bed level before ducking                        |
| `--narration-gain`  | `0`     | Voice level before `loudnorm`                   |
| `--sfx-gain`        | `0`     | Clip audio level (ignored by `--latest`)        |

Raise `--music-gain` toward `-8` for a louder bed, lower it toward `-18` for a
VO-forward cut. Leave the mastering targets alone: they are the point of the
chain, not a preference.

`vs animatic` uses the same shape with `--music-gain` defaulting to `-18`,
because a story reel is scratch audio under a still frame and wants the bed
further back.

## When the mix does not run

`vs stitch` takes a lossless `-c copy` concat path when there are no
transitions, no music, no narration, and no `--grade`. That path is fast and
touches nothing, which also means none of the above happens. Any cut you intend
to show someone should be taking the re-encode path.
