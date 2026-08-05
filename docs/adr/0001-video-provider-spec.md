# 1. A versioned video provider spec

- **Status:** accepted
- **Date:** 2026-08-05
- **Context:** adding MiniMax H3 alongside BytePlus Seedance

## Context and constraints

`vs` generated video against exactly one backend, BytePlus ModelArk. Adding
MiniMax H3 makes that two, and the shape of the codebase assumed one:

- `src/provider.ts` declared a `VideoProvider` port, but no command used it.
  `generate.ts`, `status.ts`, and `doctor.ts` all typed the client as
  `ArkClient`. Its own doc comment said no adapter existed "and none should".
- `CreateTaskRequest` in `src/types.ts` is simultaneously **the canonical
  internal request** and **the Ark wire body**. Every caller that builds a
  generation is therefore writing an Ark payload, whether it knows it or not.
- `src/cost.ts` prices in tokens end to end. `Billing.perSecond` was declared
  and never implemented, so a per-second model quoted `$0.00` and walked
  straight through `--max-cost`.
- Model capabilities were already data in `src/models.ts`, but four authoring
  behaviours were gated on an `isSeedance25()` family-string predicate.

Constraints that shape the answer:

- **Single package, single consumer.** This is one CLI binary, not a published
  SDK with third-party providers. Nobody outside this repo implements the spec.
- **Cost is a safety property** (`SECURITY.md`). A quote must never be lower
  than the bill, and `--dry-run` must work with no API key at all.
- **Generated video is immutable and paid for.** `payloadHash` in the manifest
  is an audit record; churning it silently invalidates every existing film's
  history.
- Two providers is a measurement. Three is a pattern. This decision commits to
  what two providers prove and explicitly defers the rest.

## Decision

Adopt a **versioned provider spec** in the shape of the Vercel AI SDK's
`LanguageModelV1`, in-package, with the pieces that two divergent wire formats
actually justify and none of the pieces that only a published SDK needs.

### Glossary

Recovered from the code, not invented. These are the names to use.

| Term | Meaning | Lives in |
| --- | --- | --- |
| **Film** | A `shots.json` and its output directory | `src/shots.ts` |
| **Shot** | One authored unit of generation | `src/types.ts` |
| **Revision** | One paid attempt at a shot (`vNNN`), append-only | `src/manifest.ts` |
| **Pass** | `draft` or `final`; picks the manifest and output dir | `src/paths.ts` |
| **Reference** | A role-tagged input image/video/audio on a shot | `src/types.ts` |
| **Ordinal** | A reference's 1-based index *within its media type* | `src/payload.ts` |
| **Model** | A generation model id, e.g. `dreamina-seedance-2-5-260628` | `src/models.ts` |
| **Provider** | The backend a model id is generated on | `src/models.ts` |
| **Capabilities** | What a model accepts and how it bills | `src/models.ts` |

### The four layers

```
commands/          knows: Shot, Film, cost, manifest
   |               never knows: which vendor, what the body looks like
   v
spec/              VideoModelV1 — the versioned contract
   |
   +-- providers/ark/       Seedance   (translate, HTTP, errors, statuses)
   +-- providers/minimax/   H3         (translate, HTTP, errors, statuses)
   |
models.ts          capabilities + billing as DATA (no network, no key)
cost.ts            pure pricing, branches on the billing union
```

**1. `src/spec/` — the contract.** A `VideoModelV1` carries
`specificationVersion: "v1"`, `provider`, `modelId`, `capabilities`, and the
methods the commands call. Provider-neutral **call options** replace the Ark
body as the thing callers construct:

```ts
export interface VideoModelV1CallOptions {
  prompt: string;
  references: readonly ShotReference[];
  durationSeconds: number;
  aspectRatio: AspectRatio;
  resolution?: Resolution;    // undefined = let the provider default
  seed?: number;
  generateAudio?: boolean;
  cameraFixed?: boolean;
  /** Non-portable knobs, keyed by provider id. Other providers ignore theirs. */
  providerOptions?: Record<string, Record<string, unknown>>;
}
```

`providerOptions` is the escape hatch that keeps the neutral type from growing a
union of every vendor's quirks. `camera_fixed` is Ark-only; `callback_url`
exists on both but means slightly different things. Anything portable is a
first-class field; anything not is namespaced and ignored elsewhere.

**2. `src/providers/<name>/` — the adapters.** Each owns, and is the only place
that knows: the wire body, HTTP and auth, boundary validation, status mapping
onto `TaskStatus`, and error mapping onto the shared taxonomy. A provider is
constructed by a factory, AI SDK style, so a test or `vs doctor` can build one
without a key:

```ts
const ark = createArk({ apiKey, baseUrl });
const model = ark.videoModel("dreamina-seedance-2-5-260628");
```

**3. `src/models.ts` — capabilities and billing as data.** Unchanged in spirit,
and deliberately *not* moved onto the model object. Cost estimation and
`--dry-run` must work with no key and no network, so what a model costs and
accepts stays a pure lookup. The provider contributes **data** (a `billing`
union member), never behaviour.

**4. `src/cost.ts` — pure pricing.** Branches on the `billing` discriminated
union. Adding a third billing shape is a new union member plus one branch.

### Model id resolution

`film.model` accepts a bare id (every existing film) or an explicit
`provider:modelId` form. Resolution order:

1. Explicit prefix wins: `minimax:MiniMax-H3`.
2. Otherwise the registry's `provider` field for that family.
3. Otherwise `ark`, preserving today's behaviour.

The prefix is not decoration. Today an unrecognised id falls back to a
permissive Ark entry, so a MiniMax model id the registry has not learned yet
would be POSTed to BytePlus and fail as a confusing 4xx. `minimax:` lets an
author name the backend for a model this file has never heard of, which is the
same "the API is the authority, the registry is advisory" stance `src/models.ts`
already takes.

### Why the interface is versioned

`specificationVersion: "v1"` is cheap now and is the only thing that makes a
future breaking change tractable: a `V2` adapter can be added beside `V1` and
providers migrated one at a time, rather than every provider changing in one
commit. This is the single most valuable thing the AI SDK shape provides and it
costs one literal field.

### `payloadHash` stays stable

`hashPayload` keeps hashing **the wire body**, not the call options. The Ark
adapter's `toRequestBody` produces byte-identical JSON to today's
`buildTaskPayload`, so no existing film's audit trail churns. A pinned-hash
regression test enforces this.

## Consequences

**Good.** Adding a provider is: one directory under `src/providers/`, one
registry entry, one `.env` key, one doctor check. No command changes. The
commands become genuinely vendor-blind, which is the property that was claimed
before and not true. `--dry-run` prints what will actually be sent, per
provider, instead of an Ark body wearing a MiniMax model id.

**Costs.** This is a wider refactor than bolting a second client on:
`payload.ts` stops building an Ark body and starts building call options, and
its tests move with it. Every command's client type changes. It is one commit's
worth of churn spent to avoid a permanent `if (provider === ...)` tax.

**Rollback.** Each phase leaves `npm run verify` green and is independently
revertable. The spec lands with Ark as its only implementation first, so if the
shape proves wrong it is reverted before MiniMax depends on it.

## Out of scope (deferred)

Recorded so a future audit does not re-litigate them. Each names what would
promote it.

| Not doing | Why | Promote when |
| --- | --- | --- |
| Separate npm packages per provider (`packages/ark`, `packages/minimax`) | One binary, one consumer. A package split buys independent versioning nobody needs and couples release cycles. | Someone outside this repo implements the spec. |
| Middleware / `wrapVideoModel` | No current requirement. Retry and rate limiting already live at the seam (`ModelLimiter`, the shared HTTP loop). | A cross-cutting concern appears that is not retry or concurrency. |
| A plugin loader for third-party providers | Providers are compiled in; a dynamic loader is an attack surface for a tool that spends money. | Never, unless `vs` becomes a library. |
| Streaming | Video generation is submit-then-poll. There is no token stream. | A provider ships partial-frame streaming. |
| Unifying the stills backends (Seedream, Gemini) behind the spec | Stills cost cents, not dollars, and are already routed by model id in `stills.ts`. `src/provider.ts` already documents this as deliberate. | A third stills backend, or stills start costing dollars. |
| Extracting the model registry into its own package | Same reason as the provider split. | Same trigger. |
| A cross-provider capability *negotiation* layer (auto-picking a model that fits a shot) | Speculative. Model choice is an authoring decision with cost and look consequences the tool should not make silently. | An explicit user request for it. |

## Enforcement

An unenforced contract decays. Each rule names its check:

| Rule | Enforced by |
| --- | --- |
| Commands never import a provider client directly | Import-boundary lint rule: nothing under `src/commands/` may import `src/providers/*` |
| Providers never import commands | Same rule, reversed |
| Every registry entry is complete | Type check: `RegistryEntry` is a total `Omit<ModelCapabilities, …>` |
| A per-second model never quotes $0 | Unit test in `src/cost.test.ts` |
| Ark payload bytes are unchanged | Pinned-hash test |
| Documented commands and flags are real | `src/docs-drift.test.ts` (already exists) |
| Shipped example films lint clean | `src/examples.test.ts` (already exists) |
