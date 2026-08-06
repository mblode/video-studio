# Treatment

The narrative pitch and blueprint, written in present-tense prose before any
JSON exists. It is the first document in the chain (treatment, style bible,
beat sheet, shot list), the one that decides why the film is worth making and
where it lands. For a short film it is short: a paragraph per act or beat, not
a script. Everything downstream narrows it, so spend the thinking here.

Write it for two readers: a human deciding whether the film works, and yourself
assembling the build documents later. Generation count, audio mixing, and the
JSON schema belong to the seedance and vs skills, not here. For structure
frameworks, point the reader at `story-principles.md` rather than re-explaining
them.

## Logline

One sentence naming WHO the film is about, WHAT they want, and WHAT is in the
way. If you cannot write it, you do not yet have a film.

Formula: `[A protagonist] wants [a goal], but [an obstacle], so [the stakes or
turn].`

Example (the demo film): on his final night at a remote lighthouse, a veteran
keeper shuts out the young relief sent to replace him; when the lamp drive
fails in a storm, their old and new methods must work together before a boat
reaches the reef.

## Emotional throughline

The single idea the film proves. One line. Every beat must drive at it; a beat
that does not gets cut or changed.

Design the FINAL IMAGE FIRST (Pixar rule 7), then write backward so the whole
film is a delivery system for that last shot. Decide what the audience should
feel in the final frame, then build the logline and the beats to earn it.

Worked example:

- Throughline: stewardship survives when knowledge is passed on and allowed to
  change.
- Final image: the relief stands behind the turning lens while the old brass
  key and her modern meter share the foreground and the beam reaches an unknown
  vessel.
- Logline derived from that image: a keeper who mistakes ownership for duty
  must trust his replacement before he can leave the light in her hands.

The shared ledge is the throughline made literal. Old knowledge remains, new
knowledge earns its place, and the distant boat makes the duty larger than
either character.

## Why must you tell THIS story

State, briefly, the belief the film feeds off (Pixar rule 14). One or two
lines. The film should be unmistakably yours; if anyone could have written it,
the throughline is too generic. Put this near the top so every later decision
can check against it.

## Narration voice decision

Decide whether narration is STORY-ESSENTIAL (it carries information the images
cannot) or ATMOSPHERIC (mood only), and name the chosen voice in one line.
Per-clip audio is sound effects and ambience only; the continuous narration and
score are mixed in post.

Naming the voice early keeps every later narration line in one register. The
demo film chose atmospheric, and then chose to ship with no narration at all,
which is a legitimate answer: a wordless film puts the whole load on staging
and sound.

## Structure of the document

Open with a single intro line stating RUNTIME and GENERATION COUNT, then write
the acts or beats in order. The intro line is your honest scope statement.

```
A short film in twelve generations (~1:42). No dialogue. Wind, sea, radio,
and machinery carry it; any score is mixed in post.
```

The same film sized for Seedance 2.5, where each generation is an act:

```
A short film in four 30s acts (2:00 of clips, ~2:06 with cards). No dialogue.
Wind, sea, radio, and machinery carry it; any score is mixed in post.
```

Two valid prose registers, chosen by how tightly narrative must tie to
generations:

- **Screenplay-style.** Scene headings with embedded `[sNN, timestamp]` shot
  markers, so each paragraph maps to a generation and you can see the cut while
  you write. Use it when timing matters, or when the film is dense enough that
  you want the edit visible in the treatment itself.
- **Pure prose.** No headings or markers, a paragraph per act that just tells
  the story. Use it for a simple film where you want to lock tone and final
  image before worrying about which beat is which generation.

Start lighter and tighten in the beat sheet, or start tight if the film is
already shot-mapped in your head. Both are correct; the screenplay-style
version simply does more of the beat sheet's work up front.

## Length and budget reality

Runtime ties directly to generation count and each generation costs money, so
keep the treatment honest about scope. How many generations a runtime buys
depends entirely on the model:

| Runtime | Seedance 2.0 (4-15s, 8s typical) | Seedance 2.5 (4-30s) |
| ------- | -------------------------------- | -------------------- |
| 0:35    | 5 generations                    | 2 acts               |
| 1:00    | 8 generations                    | 2 to 3 acts          |
| 2:00    | 10 to 15 generations             | 4 acts               |

On 2.5 a generation is an act, so the count you write in the intro line is a
count of acts, and each one carries five to seven internal beats.

**Fewer generations is not a cheaper film, and this is the counter-intuitive
part.** Two minutes of 720p bills exactly the same tokens whether it is fifteen
8s clips or four 30s acts, because the token formula is per pixel-second. But
2.5's rate is dearer (about 39% more for the same runtime), and it runs one
task at a time against 2.0's three, so the same film takes roughly four times
the wall clock and is strictly serial. What the longer window buys is coherence
inside an act and far fewer retakes, not price and not speed. The budget
conversation gets shorter, not easier. Real numbers in the vs skill's
`references/models.md`.

Title cards add real runtime on top of the summed clip durations. If the
treatment implies forty beats, that is forty beats to place: forty generations
on 2.0, six or seven acts on 2.5, and a bill to match either way. Trim the
story to the budget here, in prose, where trimming is free.

## Checklist

- [ ] Logline (who, what they want, what is in the way)
- [ ] Emotional throughline (one line, the single idea the film proves)
- [ ] Final image designed FIRST, with every beat driving at it
- [ ] Why-this-story (the belief the film feeds off)
- [ ] Narration voice decision (essential vs atmospheric, named voice)
- [ ] Act beats in order, behind an intro line stating runtime and generation
      count
