# The Last Watch

The complete example film: 13 shots, about 1 minute 50 seconds with title cards.

On his final night at a remote lighthouse, a veteran keeper shuts out the young
relief sent to replace him. When the lamp drive fails during a storm, their old
and new methods must work together before a boat reaches the reef.

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

# Cents: generate the 13 literal opening frames.
vs stills films/lighthouse/stills.json

# Free: watch the whole edit from held stills.
vs animatic films/lighthouse/shots.json

# About $7.78: test motion at 480p with audio off.
vs generate films/lighthouse/shots.json --draft --max-cost 8
vs review films/lighthouse/shots.json --draft

# About $17.30: generate only the approved final clips.
vs generate films/lighthouse/shots.json --max-cost 18

# Free: assemble the selected revisions.
vs stitch films/lighthouse/shots.json --xfade 0.4
```

Those prices are estimates for 13 eight-second clips. The CLI recalculates them
from the exact model, duration, resolution, and token formula before charging.
Use your own lower `--max-cost` if you want the run to stop earlier.

## Nothing gets overwritten

Every paid take is permanent and sortable:

```text
output/
  clips/
    s01-final-arrival/
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
  --shot s06-drive-breaks --force --max-cost 2
```

The new take becomes selected only after it downloads successfully. If it
fails, the previous good take remains selected and stitchable.

See the latest attempt, selected take, and every available revision:

```bash
vs status films/lighthouse/shots.json
```

Roll back instantly:

```bash
vs use films/lighthouse/shots.json s06-drive-breaks v001
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

**One final image drives the film.** The old brass key and the relief’s modern
meter share a ledge while the inherited beam reaches an unknown boat. Every
earlier prop and action prepares that image.

**The two characters have opposite gifts.** He knows the tower by sound and
touch. She measures and improvises. Each method fails alone before they combine
in the climax.

**The storm pays for its screen time.** The counterweight shudders before the
chain breaks. The boat appears before it needs rescue. The service motor is
shown before it moves the lens. The key changes hands in frame.

**Every generation is independently anchored.** Each shot has one same-id
`first_frame` still and matching seed. There are no chains, so all 13 shots can
run concurrently and a retake never invalidates its neighbours.

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
