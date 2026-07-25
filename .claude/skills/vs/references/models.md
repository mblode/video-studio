# Models, resolutions, and limits

What to put in `film.model`, `film.draftModel`, and a stills file's `model`,
and what the provider will let you do with each.

`src/models.ts` is the authority in code: capabilities are data, so adding a
model is a registry entry rather than a code change. The registry is advisory
and never a gate. An id it has never seen falls back to a permissive guess and
the API stays the arbiter, so a model released after that file was written
produces a warning at worst.

## Contents

- [Video model ids](#video-model-ids)
- [Never hardcode a vendor prefix](#never-hardcode-a-vendor-prefix)
- [Resolution](#resolution)
- [Rate limits](#rate-limits)
- [Reference limits](#reference-limits)
- [Stills models](#stills-models)
- [Cost](#cost)
- [Seedance 2.5](#seedance-25)

## Video model ids

Confirmed on BytePlus ModelArk:

| Model            | Id                                | Notes                                          |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| Seedance 2.0     | `dreamina-seedance-2-0-260128`    | The default. 480p to 4K                        |
| Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | 480p/720p only. About 27% cheaper per token |
| Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | 480p/720p only. Pricing not published       |

The same three ship on Volcengine with a `doubao-` prefix. Pre-2.0 releases
(`seedance-1-0-pro-250528`, `seedance-1-5-pro-251215`) are in the registry with
`confidence: "inferred"`, so their capability checks report warnings only.

The `fast` variant is the one to set as `film.draftModel`: it stacks a model
discount on top of the 480p resolution drop. It has to be activated in the
BytePlus console before the id resolves.

## Never hardcode a vendor prefix

Four prefixes have been observed for the same underlying models: `seedance-`,
`dreamina-`, `doubao-`, `dola-`. `normalizeModelId` strips the vendor prefix
and the trailing release stamp before lookup, so one registry entry covers all
of them. Any new code that branches on a model id normalises first.

## Resolution

`480p`, `720p`, `1080p`, `4k`, naming the **short** side of the frame.

**Generate at 720p.** 720p is what Seedance actually generates at; 1080p costs
more than twice as much per shot (0.44 versus 1.0 on the token factor) for a
rung the model does not really climb. `vs init` sets
`film.defaults.resolution: "720p"` for that reason. Deliver at 1080p by running
`vs upscale` on the shots that survive the edit, which costs nothing.

`DEFAULT_RESOLUTION` in `src/types.ts` is `1080p` on purpose: it models what
the API does when `resolution` is omitted, which is what keeps a cost estimate
for an unconfigured film honest. The field itself is only emitted when
explicitly set.

**The 4K trap.** 4K's per-token rate is *lower* than 1080p's, which reads like
a discount. It is not: 4K burns about four times the tokens. That, plus the
rate limits below, is why a flat dollars-per-second estimate is wrong by up to
5x across the range.

## Rate limits

Individual account tier:

| Scope       | RPM | Concurrent tasks |
| ----------- | --- | ---------------- |
| Default     | 180 | 3                |
| **4K**      | 15  | **1**            |

Enterprise is 600 RPM and 10 concurrent.

`--concurrency` defaults to 3 for `generate`, matching the individual tier. A
**4K film is strictly serial**: passing `--concurrency 3` to a 4K run just
queues, so plan the wall-clock time accordingly.

## Reference limits

Platform ceiling per generation: **9 images, 3 videos, 3 audio**.

`src/models.ts` sets a tighter advisory slot table (4 images, 1 video, 1 audio)
and `lintShotsFile` warns above 5 references total, because quality degrades
well before the platform ceiling. Both are warnings, not errors.

Frame mode and reference mode are mutually exclusive, which the schema does
enforce. See `../../seedance/references/shots-schema.md`.

## Stills models

`vs stills` routes on the stills file's top-level `model`:

- **`seedream-*`** (default, e.g. `seedream-5-0-260128`) hits the Ark image
  API. Needs `ARK_API_KEY`. Honours the per-still `size` and `seed`.
- **`gemini-*`** routes to Google's Nano Banana. Needs `GEMINI_API_KEY`. It
  ignores Seedream's pixel `size` and `seed`, and the CLI prints a note once
  when it drops them.

| Nano Banana model | Id                       | Good for                                        |
| ----------------- | ------------------------ | ------------------------------------------------ |
| Nano Banana Pro   | `gemini-3-pro-image`     | Keyframes with legible in-frame text or signage |
| Nano Banana 2     | `gemini-3.1-flash-image` | High-volume storyboard batches                  |

Pro handles 6 objects, 5 characters, and 3 style references, and is the best
available for text a viewer can actually read, which is why any shot with
signage gets its keyframe from Pro. Nano Banana 2 handles 10 objects and 4
characters with no style references.

Both bill thinking tokens by default. Set `thinking_level: "minimal"` for
storyboard batches where you want throughput rather than reasoning depth. Prompt
craft for these is in `../../nano-banana-2/`.

The Gemini stills path is built but has never been exercised against a live
key. Confirm with `vs stills --dry-run` and one real still before trusting it
for a batch.

## Cost

BytePlus bills per output token. The estimate uses the official formula rather
than a per-second rate:

```
tokens = (input_seconds + output_seconds) × width × height × fps / 1024
```

Width and height come from the requested resolution and aspect ratio, fps is 24
on every Seedance model. Dollar rates per model and resolution live in
`src/models.ts`; an unlisted combination quotes the dearest known rate, so an
unpriced pairing over-quotes rather than silently costing nothing.

Conditioned input (a reference still or a chained `first_frame`) is billed
cheaper than pure text-to-video, so a keyframe-anchored shot is both more
consistent and cheaper.

Real `usage.completion_tokens` is written back to the manifest after every run,
and `reconcileTokens` flags a run that lands outside a 15% tolerance so the
rates can be recalibrated from the console's usage breakdown. The original
calibration was 22,446,900 tokens over 101 calls.

## Seedance 2.5

Announced but, as of 2026-07-24, absent from the ModelArk model list and the
pricing table. There is no id and no rate to quote, so do not invent either.
When it lands, it is a new entry in the `src/models.ts` registry and nothing
else has to change.
