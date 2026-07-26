# The Last Watch

The complete example film: 12 shots, about 1 minute 42 seconds with title cards,
in stark black-and-white and an exact 1.10:1 almost-square frame.

On his final night at a remote lighthouse, a veteran keeper ignores the worn
drive link found by the relief sent to replace him. When it breaks under load,
he must surrender the service key that lets her established emergency motor
restore the beam before a boat loses the safe channel.

The story is fictional and deliberately anonymous. It contains no real people,
families, companies, places, or dates.

## Start with the film

The preproduction documents are part of the example:

1. [Treatment](treatment.md) — premise, characters, synopsis, final image
2. [Style bible](style-bible.md) — visual, character, prop, and sound continuity
3. [Beat sheet](beat-sheet.md) — escalation, setups/payoffs, anchor map
4. [Screenplay](screenplay.md) — the silent story in scene order
5. [Shot list](shot-list.md) — camera, action, audio, continuity per generation
6. [Stills](stills.json) — literal first-frame keyframes
7. [Shots](shots.json) — validated Seedance requests

The documents progress from story decisions to build instructions. If an idea
changes upstream, update everything below it before paying for a generation.

## Run it

From the repository root:

```bash
npm install
npm link
cp .env.example .env   # add ARK_API_KEY
vs doctor
```

Then climb the cost ladder:

```bash
# Free: validate every request and see the full price.
vs generate films/lighthouse/shots.json --dry-run

# Cents: generate the 12 literal 2200x2000 opening frames.
vs stills films/lighthouse/stills.json

# Free: watch the whole edit from held stills.
vs animatic films/lighthouse/shots.json

# Conservative $7.19 ceiling estimate: test motion at 480p with audio off.
vs generate films/lighthouse/shots.json --draft --max-cost 8
vs review films/lighthouse/shots.json --draft
vs stitch films/lighthouse/shots.json --draft --xfade 0.4

# Conservative $15.97 ceiling estimate: generate only approved final clips.
vs generate films/lighthouse/shots.json --max-cost 18

# Free: assemble the selected revisions.
vs stitch films/lighthouse/shots.json --xfade 0.4
```

Those prices are estimates for 12 eight-second clips. `adaptive` framing is
conservatively priced as 16:9 even though the 1.10:1 frame has fewer pixels, so
the real total should be lower. The CLI recalculates before charging. Use your
own lower `--max-cost` if you want the run to stop earlier.

Seedance may quantize an adaptive near-square request to a square output. Keep
the compositions centred, then conform the assembled delivery to exact 11:10;
the completed cheap pass uses a 638×580 centre crop.

## Nothing gets overwritten

Every paid take is permanent and sortable:

```text
output/
  clips/
    s01-last-arrival/
      v001.mp4
      v002.mp4
  renders/
    final/
      v001.mp4
      v002.mp4
  animatics/
    v001.mp4
```

`--force` means “make a new revision,” not “replace the file”:

```bash
vs generate films/lighthouse/shots.json \
  --shot s05-pride-breaks-drive --force --max-cost 2
```

The new take becomes selected only after it downloads successfully. If it
fails, the previous good take remains selected and stitchable.

See the latest attempt, selected take, and every available revision:

```bash
vs status films/lighthouse/shots.json
```

Roll back instantly:

```bash
vs use films/lighthouse/shots.json s05-pride-breaks-drive v001
```

Stitches, animatics, upscales, and share exports also receive the next `vNNN`
path. An explicit `--output` is never replaced; choose a new name or omit it for
automatic versioning.

## Cut whatever exists

At any point, make a complete reel from the best available source for each shot:
final clip, then draft clip, then still.

```bash
vs stitch films/lighthouse/shots.json --latest
```

This is useful after every few approved shots. It keeps story and pacing visible
while the final is still incomplete.

## Why this example holds together

**One final image drives the film.** The old iron key and the relief’s modern
meter share a ledge while the inherited beam reaches an unknown boat. Every
earlier prop and action prepares that image.

**One protagonist makes one costly choice.** The keeper wants to finish alone.
He ignores a worn link, so his flaw causes the failure; the climax forces him
to choose between guarding the key and guarding the light.

**Every solution is paid for.** The worn link and spare appear before the
break. The motor case arrives in s01 and is shelved in s02 before returning in
s08. The boat's engine and steering always work; the restored beam reveals safe
water rather than magically repairing the vessel.

**The frame carries pressure.** Exact 2200×2000 keyframes drive Seedance's
adaptive ratio, while vertical tower, stair, chain, and bodies make the
almost-square composition feel claustrophobic. Orthochromatic monochrome,
crushed shadows, halation, grain, and gate weave define the look without
copying another film's shots or characters.

**Every generation is independently anchored.** Each shot has one dedicated
`first_frame` still and matching seed. Privacy-safe variants keep versioned
filenames. There are no chains, so all 12 shots can run concurrently and a
retake never invalidates its neighbours.

**Text and score stay in post.** The video model produces only image, motion,
ambience, and effects. Title cards are rendered by `vs stitch`; music and
narration are mixed there too.

## Add sound

A plain stitch contains wind, sea, machinery, and boat audio but no score or
voiceover. Add your own tracks:

```bash
vs stitch films/lighthouse/shots.json \
  --xfade 0.4 \
  --music score.mp3 \
  --narration narration.mp3
```

The mix ducks music under narration and masters the result. Media, manifests,
reviews, and generated outputs remain local and are ignored by git.
