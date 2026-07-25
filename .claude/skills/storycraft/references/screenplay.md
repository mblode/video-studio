# Screenplay

A `screenplay.md` is a traditional, human-readable rendering of the film. You read it to feel the story play before it is broken into generations. It is a review and reference document, NOT a generation input: the CLI never reads it, and nothing in it drives a prompt. The generation input is `shots.json` (defer all JSON and CLI mechanics to the `seedance` skill).

A screenplay is OPTIONAL for very simple films; the demo film ships without one. Write a screenplay when the story has enough scenes, dialogue, or narration that reading it whole catches pacing and tone problems the shot list alone would hide. Skip it for a one-idea piece where the beat sheet already reads cleanly.

## Contents

- [Standard screenplay format](#standard-screenplay-format)
- [Fountain plain-text syntax](#fountain-plain-text-syntax)
- [The repo house format](#the-repo-house-format)
- [Narration discipline](#narration-discipline)
- [Checklist](#checklist)

## Standard screenplay format

The conventions, so the document reads like a script to anyone:

- **Scene headings (sluglines):** `INT.` or `EXT.`, the LOCATION, and the TIME, all caps. Use `INT.` for interiors, `EXT.` for exteriors. Example: `EXT. SNOWY MARKET LANE - 1926`.
- **Action lines:** present tense, describing only what is seen and heard. Keep them concise. Reveal character through action (show, do not tell). Write "The keeper hauls the iron door open and shoulders through it," not "The keeper is determined."
- **Character cues:** the speaker's name in CAPS above their dialogue. Introduce a new character in CAPS on first appearance in an action line (`THE KEEPER (60s, navy wool coat)`), then normal case after.
- **Dialogue:** the spoken line, under the cue.
- **Parentheticals:** a short `(beat)` or `(whispering)` between cue and line. Use sparingly.
- **Transitions:** `FADE IN:`, `CUT TO:`, `FADE OUT.` Use sparingly; the cuts are implied by new headings.

One page is roughly one minute of screen time, a useful gut check on length.

## Fountain plain-text syntax

These files are `.md`, so write them in Fountain, a plain-text screenplay convention that needs no special characters:

- A line starting with `INT.` or `EXT.` is parsed as a scene heading.
- A standalone line in all caps is a character cue; the text under it is dialogue.
- `(parenthetical)` on its own line modifies the line below it.
- `> CENTERED <` centers text (good for cards).
- A line ending in `>` is a forced transition (`CUT TO: >`).
- Emphasis: `*italics*`, `**bold**`, `_underline_`.
- A line starting with `~` is a lyric.

Keep it light. You are writing for a human reader, not a Fountain compiler.

## The repo house format

The films in this repo extend Fountain with a few markdown conventions that tie each scene back to its generation:

- **Scene headings as markdown H2:** `## EXT. LOCATION - TIME - [sNN, timestamp]`. The H2 makes scenes separate visually when the file is rendered. Use hyphen separators between location, time, and the marker.
- **The embedded `[sNN, timestamp]` shot marker** at the end of each heading ties the scene to its generation id and its place in the cut, so a reader can cross-reference `shots.json`.
- **Narration as `> NARRATOR (V.O.)` blocks** under the action they cover.
- **`SOUND:` cue lines** listing the per-clip SFX and ambience for the scene.

A short example:

```markdown
## EXT. HEADLAND AND LIGHTHOUSE - LAST LIGHT - [s01, 0:03-0:09]

Wind flattens the long grass in fast waves. Gulls scatter off the
cliff edge. THE KEEPER (60s, navy wool coat) strides across the wet
grass toward the tower, hauls the iron door open, and swings it shut
behind him.

> NARRATOR (V.O.)
> He has never once been late.

SOUND: wind gusting, surf on rock far below, a hinge groan, a slam.
```

## Narration discipline

For these films narration is the dialogue layer; most shots have no spoken on-screen lines, so the narrator carries the story. Keep each narration line timed to the cut it rides over, short enough to land inside the scene's runtime. The per-clip audio is SFX and ambience only; the continuous narration and score are mixed in post (defer the mix mechanics to the `seedance` skill).

## Checklist

- Every scene has a slugline (`INT.`/`EXT.`, location, time, all caps).
- Action lines are present tense and concise.
- Character revealed through action, not stated (show, do not tell).
- Each H2 heading carries its `[sNN, timestamp]` marker tying the scene to a generation.
- Narration lines are timed to the cut, not overwritten.
- The document reads as a complete story on its own.
