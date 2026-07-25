import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";

import { VsError } from "../errors.js";
import { lintShotsFile, loadShotsFile, loadStillsFile } from "../shots.js";
import { ASPECT_RATIOS, DEFAULT_DURATION } from "../types.js";
import type { AspectRatio } from "../types.js";
import { assertInteractive } from "./context.js";
import { ok, warn } from "./output.js";

export interface InitOptions {
  duration?: number;
  force: boolean;
  /** Shared style/continuity block prepended to every shot prompt. */
  preamble?: string;
  ratio?: AspectRatio;
  title?: string;
  yes: boolean;
}

interface FilmConfigInput {
  duration: number;
  preamble?: string;
  ratio: AspectRatio;
  title: string;
}

const [DEFAULT_RATIO] = ASPECT_RATIOS;

const PREAMBLE_PLACEHOLDER =
  "Consistent look across the film: describe the palette, lighting, film stock, and character continuity here once. Realtime speed, lively, not slow motion.";

async function collectConfig(
  options: InitOptions,
  defaultTitle: string
): Promise<FilmConfigInput> {
  if (options.yes) {
    return {
      duration: options.duration ?? DEFAULT_DURATION,
      preamble: options.preamble ?? PREAMBLE_PLACEHOLDER,
      ratio: options.ratio ?? DEFAULT_RATIO,
      title: options.title ?? defaultTitle,
    };
  }

  assertInteractive("--yes");
  intro("New film");
  const title = await text({
    initialValue: options.title ?? defaultTitle,
    message: "Film title",
  });
  if (isCancel(title)) {
    cancel("Aborted.");
    process.exit(0);
  }
  const ratio = await select({
    initialValue: options.ratio ?? DEFAULT_RATIO,
    message: "Default aspect ratio",
    options: ASPECT_RATIOS.map((value) => ({ value })),
  });
  if (isCancel(ratio)) {
    cancel("Aborted.");
    process.exit(0);
  }
  const duration = await text({
    initialValue: String(options.duration ?? DEFAULT_DURATION),
    message: "Default shot duration (seconds)",
  });
  if (isCancel(duration)) {
    cancel("Aborted.");
    process.exit(0);
  }
  // The colour script: one style block every shot inherits, so per-shot prompts
  // stay short enough to keep their timed beats inside the length lint.
  const preamble = await text({
    initialValue: options.preamble ?? PREAMBLE_PLACEHOLDER,
    message: "Style preamble prepended to every shot prompt (blank to skip)",
  });
  if (isCancel(preamble)) {
    cancel("Aborted.");
    process.exit(0);
  }

  return {
    duration: Number(duration) || DEFAULT_DURATION,
    preamble: preamble.trim() || undefined,
    ratio: ratio as AspectRatio,
    title,
  };
}

function shotsTemplate(config: FilmConfigInput): unknown {
  return {
    cards: [{ after: "start", duration: 3, text: config.title }],
    film: {
      // 720p is Seedance's native ceiling — generate there and upscale only the
      // shots that make the final edit. 1080p generation is just a pricier
      // upscale locked in per shot.
      defaults: {
        duration: config.duration,
        ratio: config.ratio,
        resolution: "720p",
      },
      ...(config.preamble ? { promptPreamble: config.preamble } : {}),
      title: config.title,
    },
    shots: [
      {
        id: "s01-establishing",
        prompt:
          "An establishing wide shot. Replace with your own prompt; describe the exact action and anchor it to the literal keyframe you make for this shot.",
        references: [
          {
            role: "reference_image",
            type: "image",
            url: "./stills/s01-key.png",
          },
        ],
        // A fixed seed keeps a draft, its final, and any retake in the same
        // composition family instead of re-rolling a new one every run.
        seed: 101,
      },
      {
        // Standalone, not chained: a self-contained beat anchored to its OWN
        // literal keyframe, so it regenerates independently and the cut lands
        // on the generation length.
        id: "s02-continuation",
        prompt:
          "A self-contained beat that cuts cleanly after the first shot. Replace with your own prompt; anchor it to its own literal keyframe.",
        references: [
          {
            role: "first_frame",
            type: "image",
            url: "./stills/s02-key.png",
          },
        ],
        seed: 102,
      },
    ],
  };
}

function stillsTemplate(): unknown {
  return {
    stills: [
      {
        id: "s01-key",
        prompt:
          "A literal keyframe of the exact opening of shot 1 — the composition you want on screen, not an abstract mood board. Replace with your own prompt.",
      },
      {
        id: "s02-key",
        prompt:
          "A literal keyframe of the exact opening of shot 2. Replace with your own prompt.",
      },
    ],
  };
}

function readmeTemplate(config: FilmConfigInput, slug: string): string {
  return `# ${config.title}

A film for the \`vs\` CLI. Edit \`shots.json\` and \`stills.json\`, then run the
pipeline from the repo root:

\`\`\`bash
vs doctor                          # confirm setup before any paid call
vs stills ${slug}/stills.json      # 1. generate reference stills (Seedream)
vs animatic ${slug}/shots.json     # 2. story reel from the stills, $0 of video
vs generate ${slug}/shots.json     # 3. submit, poll, download clips (Seedance)
vs status ${slug}/shots.json --refresh   # check in on running tasks
vs download ${slug}/shots.json     # (re)download any clips not yet on disk
vs stitch ${slug}/shots.json --xfade 0.4 # 4. assemble the film
\`\`\`

Scripting it (no prompts): add \`--yes\` to \`vs generate\`; every command exits
non-zero when something failed, and \`--json\` prints machine-readable results.

Tips:
- Make a literal keyframe of the exact shot you want (nano banana pro, gpt image,
  or \`vs stills\`) and anchor every shot to it — video generates tighter and
  glitches less with an image to follow. Hand-made boards drop straight into
  \`stills/\` and get referenced; you do not have to generate them with \`vs stills\`.
- Keep each shot a self-contained beat and let the cut land on the generation
  length — standalone shots regenerate independently and never cascade a retake.
- \`--dry-run\` on \`stills\`/\`generate\` prints payloads without spending anything.
- Video takes and finished renders are numbered \`v001\`, \`v002\`, and so on;
  \`--force\` creates a new take, \`vs status\` shows latest vs selected, and
  \`vs use <shots-file> <shot-id> <version>\` rolls back without deleting media.
- Default duration ${config.duration}s, ratio ${config.ratio}, and 720p generation
  live in \`shots.json\` under \`film.defaults\`. 720p is Seedance's native ceiling —
  upscale only the shots that make the final edit if you need 1080p delivery.
- \`film.promptPreamble\` is the colour script: the style block every shot prompt
  inherits. Keep per-shot prompts to what is unique to the shot.
- \`continueFrom\` (chaining a shot onto the previous clip's last frame) still
  exists for tight continuity, but it serializes generation and cascades retakes —
  prefer a literal keyframe per shot.
`;
}

export async function runInit(
  dir: string,
  options: InitOptions
): Promise<void> {
  const filmDir = resolve(process.cwd(), dir);
  const shotsPath = join(filmDir, "shots.json");
  if (existsSync(shotsPath) && !options.force) {
    throw new VsError("already_exists", `${dir} already has a shots.json`, {
      hint: "pass --force to overwrite it, or pick a new directory",
    });
  }

  const config = await collectConfig(options, basename(filmDir));
  const stillsPath = join(filmDir, "stills.json");

  await mkdir(filmDir, { recursive: true });
  await writeFile(
    shotsPath,
    `${JSON.stringify(shotsTemplate(config), null, 2)}\n`
  );
  await writeFile(stillsPath, `${JSON.stringify(stillsTemplate(), null, 2)}\n`);
  await writeFile(join(filmDir, "README.md"), readmeTemplate(config, dir));

  // Guarantee the template never drifts out of schema or past the linter.
  const scaffolded = await loadShotsFile(shotsPath);
  await loadStillsFile(stillsPath);
  for (const warning of lintShotsFile(scaffolded)) {
    warn(warning);
  }

  const done = `scaffolded ${dir} (shots.json, stills.json, README.md)`;
  if (options.yes) {
    ok(done);
  } else {
    outro(`✓ ${done}`);
  }
}
