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
| Seedance 2.0     | `dreamina-seedance-2-0-260128`    | 4-15s, 480p to 4K                              |
| Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | 4-15s, 480p/720p only. About 27% cheaper per token |
| Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | 4-15s, 480p/720p only. Pricing not published |
| Seedance 2.5     | `dreamina-seedance-2-5-260628`    | **The default.** 4-30s, 480p/720p, $10.7/M. **1 concurrent, 60 RPM** |

And on MiniMax, a different provider entirely:

| Model | Id | Notes |
| --- | --- | --- |
| MiniMax H3 | `MiniMax-H3` | 4-15s, 768P/2K, **billed per second** ($0.08 / $0.13). Native stereo audio always. 5 RPM |
| MiniMax H3 Base (local) | `comfyui:MiniMax-H3-Local` | ComfyUI T2V adapter, serial, $0 provider cost. The tested 24 GB draft path is 608x352; native 768p is unverified on that card. |

`film.model` also accepts an explicit `provider:id` form (`minimax:MiniMax-H3`).
A bare id is resolved through the registry, so the prefix is only needed for a
model this repo has not learned yet: without it an unknown id falls back to
Ark and gets POSTed to BytePlus.

The local id is intentionally separate from hosted `MiniMax-H3`: the hosted
provider includes service-side orchestration that the open Base checkpoint does
not. Local setup, checkpoint provenance, and license constraints are documented
in `../../../../docs/local-h3-comfyui.md`.

The three Seedance models also ship on Volcengine with a `doubao-` prefix. Pre-2.0 releases
(`seedance-1-0-pro-250528`, `seedance-1-5-pro-251215`) are in the registry with
`confidence: "inferred"`, so their capability checks report warnings only.

On a 2.0 film the `fast` variant is the one to set as `film.draftModel`: it
stacks a model discount on top of the 480p resolution drop. It has to be
activated in the BytePlus console before the id resolves. **On a 2.5 film,
leave `film.draftModel` unset.** There is no 2.5-fast, and 2.0-fast tops out at
15s, so pointing a 30s film at it does not buy a cheap proxy, it buys a refused
run. See `workflow.md`.

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

This is not a theory. A prior 2.0 run in this repo requested 1080p, was
**delivered 720p**, and was **billed at the 1080p rate**: 2.25x the tokens for
the same pixels that came back. Requesting a rung the model does not climb is
paid for in full. 2.5 makes the same point more bluntly by not listing 1080p at
all.

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

| Scope             | RPM | Concurrent tasks |
| ----------------- | --- | ---------------- |
| Default (2.0)     | 180 | 3                |
| **4K** (2.0)      | 15  | **1**            |
| **Seedance 2.5**  | 60  | **1**            |
| **MiniMax H3**    | 5   | 3 (unpublished)  |

Enterprise is 600 RPM and 10 concurrent.

H3's concurrency is **not published**, and "not specified" is not "unlimited",
so the registry sets a conservative 3: at that width the opening burst cannot
breach 5 RPM on the create route, and multi-minute tasks then trickle well
under it. The poll route is the real risk, so the MiniMax adapter floors
`--poll-interval` at the 10s MiniMax itself recommends.

`--concurrency` defaults to 3 for `generate`, matching the individual tier. A
**4K film is strictly serial**: passing `--concurrency 3` to a 4K run just
queues, so plan the wall-clock time accordingly.

The same applies to the whole of 2.5, at every resolution: **a 2.5 run is
strictly serial regardless of `--concurrency`**. A 30s 720p generation takes 10
to 15 minutes, so a six-act film is 60 to 90 minutes of sequential submission
and nothing you pass on the command line shortens it.

## Reference limits

Limits are model-specific. `src/models.ts` is the authority.

**Seedance 2.0 (default).** Platform / registry hard ceiling per generation:
**9 images, 3 videos, 3 audio** (`validateShotAgainstModel` errors above that).
`lintShotsFile` soft-warns above **~5 references total**, because quality degrades
well before the ceiling.

**Seedance 2.5.** Product/console ceiling (Seed blog, 2026-07-31): **30 images,
10 video, 10 audio** per generation, 50 total. `lintShotsFile` soft-warns above
**~16 references total**, still well below the ceiling but higher than 2.0's
~5, because a 30s act legitimately binds a pack: characters, plates, and a
staging still per timestamp span. API access is **coming soon** on ModelArk;
keep the CLI default on 2.0 until create-task succeeds.

Both checks are warnings, not errors.

Frame mode and reference mode are mutually exclusive, which the schema does
enforce. See `../../seedance/references/shots-schema.md`.

## Stills models

Stills run on **Google's Nano Banana** through the AI SDK's `generateImage`.
The stills file's top-level `model` names the Gemini image model, and
`GEMINI_API_KEY` is the only key involved. `gemini-3-pro-image` is the default.

Nano Banana takes an aspect **`ratio`**, not pixels, and rolls its own seed, so
a per-still `size` or `seed` is ignored and `vs stills` says so once. Both stay
in the schema only so a stills file from the Seedream era still loads.

**Seedream is gone.** The hand-rolled Ark image client went with it: an image
backend is worth a dependency, not a wire format to maintain. To bring it back,
`npm i @ai-sdk/fal` and name a `fal-ai/bytedance/seedream/*` model in
`src/images.ts` — that is a broker's markup against the direct BytePlus key,
which is the trade.

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

One 30s clip at 16:9 on Seedance 2.5, at the $10.7/M rate:

| Resolution      | Tokens    | USD    |
| --------------- | --------- | ------ |
| 480p (864x480)  | 291,600   | $3.12  |
| 720p (1280x720) | 648,000   | $6.93  |
| 1080p (1920x1080) | 1,458,000 | $15.60 |

### Per-second billing changes the arithmetic entirely

Everything below this heading is about TOKEN billing. MiniMax H3 bills a flat
rate per second of output, which does not scale with frame area at all, and
that breaks the intuition the rest of this file builds:

| | $/sec of output |
| --- | --- |
| H3, 768P | **$0.080** |
| H3, 2K | **$0.130** |
| Seedance 2.5, 480p | $0.104 |
| Seedance 2.5, 720p | **$0.231** |
| Seedance 2.0, 720p | $0.166 |

So H3 at 2K — four times the pixels of 720p — is still **44% cheaper** than
2.5 at 720p. There is no 4K trap on a per-second model because there is no
pixel term. Extras: reference **video** is billed for its own duration at the
output rate, reference images past the first five are $0.04 each, and a task
has a floor equal to the cheapest valid request.

The 120s film, three ways:

| | Shape | USD | Concurrency | Native audio |
| --- | --- | --- | --- | --- |
| Seedance 2.0, 720p | 15 x 8s | $19.96 | 3 | SFX only |
| Seedance 2.5, 720p | 4 x 30s | $27.73 | **1** | SFX only |
| MiniMax H3, 768P | 8 x 15s | **$9.60** | 3 | full mix |
| MiniMax H3, 2K | 8 x 15s | $15.60 | 3 | full mix |

What you give up for the saving is **act length**: 15s against 2.5's 30s, so
every 30s act becomes two clips and a continuity seam. Decide on that, not on
the price.

`vs generate` prints no token count for a per-second model, because there is
none, and it does not reconcile afterwards either: H3 returns no `usage` block
at all, so the run reports the quote and says explicitly that nothing checked
it. That is honest; a fabricated reconciliation would make the ±15% tolerance
warning meaningless for every other model.

### Longer clips are not cheaper clips

True of TOKEN-billed models only (see above). **120 seconds at 720p costs exactly
2,592,000 tokens whether you spend it as 15 clips of 8s on 2.0 or 4 acts of 30s
on 2.5.** Identical pixels, identical token count. Only the rate differs:

| Same 120s at 720p | Tokens    | Rate     | USD    | Concurrency | Wall clock |
| ----------------- | --------- | -------- | ------ | ----------- | ---------- |
| 2.0, 15 x 8s      | 2,592,000 | $7.7/M   | $19.96 | 3           | baseline   |
| 2.5, 4 x 30s      | 2,592,000 | $10.7/M  | $27.73 | **1**       | **~4x**    |

So 2.5 is about **39% dearer** for the same runtime and roughly **four times
the wall clock**, because it runs one task at a time. What you buy for that is
coherence inside a 30s act and far fewer retakes. You do not buy price, and you
do not buy speed. Decide on that basis.

### The dual rate

The 2.5 registry entry carries two rates: **$10.7/M without video input** and
**$6.4/M with video input** (`usdPerMTokenWithVideoInput`). The cheaper rate is
applied in **reconciliation only, never in the pre-flight estimate**. The
conditioned input seconds are unknowable for a remote URL, so discounting an
under-counted token base would under-quote twice over. The repo's rule
throughout: an over-quote is a surprise, an under-quote is a bill.

It also does **not** make a region edit cheaper. The formula bills
`(input + output)` seconds, so a 30s edit on a 30s source is 60s of tokens at
the lower rate, about **20% more** than a fresh 30s pass. Region edit buys
quality, not savings.

Conditioned input on 2.0 (a `first_frame` keyframe or a reference still) is
billed cheaper than pure text-to-video, so a keyframe-anchored shot is both more
consistent and cheaper. A still image has no duration, so it adds no input
seconds; a reference *video* does.

Real `usage.completion_tokens` is written back to the manifest after every run,
and `reconcileTokens` flags a run that lands outside a 15% tolerance so the
rates can be recalibrated from the console's usage breakdown. The original
calibration was 22,446,900 tokens over 101 calls.

## Seedance 2.5

The model these docs are written around. A generation is a 30s act, not an 8s
beat, and every number below follows from that.

| Field | Value |
| --- | --- |
| Id | `dreamina-seedance-2-5-260628` |
| Duration | 4-30s (auto `-1` unconfirmed) |
| Resolutions | 480p, 720p |
| Refs (product ceiling) | 30 images / 10 video / 10 audio, 50 total |
| Refs (soft warn) | ~16 total |
| Rate (no video in) | **$10.7 / M tokens** |
| Rate (with video in) | $6.4 / M tokens, reconciliation only |
| Limits | **1 concurrent**, 60 RPM |
| Confidence | `inferred`: console card and rates are published (Seed blog 2026-07-31), the ModelArk API is still "coming soon" |

Opt in with `film.model: "dreamina-seedance-2-5-260628"`. Do **not** make it the
CLI default until a live create-task succeeds.

**What `inferred` buys you.** `validateShotAgainstModel` downgrades every
capability problem on an `inferred` model from error to warning, because
refusing a shot on a hunch is worse than letting the API arbitrate. The useful
consequence: requesting 1080p on 2.5 **warns and the request still goes out**.
The registry lists 480p and 720p because that is what the console card says.
Launch marketing claims up to 4K and 10-bit; that is unconfirmed and not
modelled here, so the warning is the CLI saying "the card disagrees with you",
not "this will fail". Once a live create-task succeeds, flip the entry to
`documented` and the same mismatch becomes a refusal.

Other 2.5 notes:

- Schema duration envelope is 4-30. `validateShotAgainstModel` still caps 2.0
  films at 15s, and 2.0 is `documented`, so there the cap is a hard error.
- Do not set `film.draftModel` on a 2.5 film. Draft on its own model at 480p;
  `workflow.md` has the ladder and the trap.
- Frame roles and `reference_*` roles may be mixed on 2.5. On 2.0 they are
  mutually exclusive, which the schema enforces.
- Clay, green-screen, and region edit are prompt conventions only. No new wire
  roles until ModelArk documents them.
- **Multi-round extend** for films longer than 30s is product-only, and out of
  CLI scope until the API ships. Cut across an act boundary instead.
