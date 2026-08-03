import { Command, InvalidArgumentError } from "commander";

import { runAnimatic } from "./commands/animatic.js";
import { packageInfo } from "./commands/context.js";
import { runDoctor } from "./commands/doctor.js";
import { runDownload } from "./commands/download.js";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";
import { runNarrate, runNarrateAssemble } from "./commands/narrate.js";
import { setJsonMode, setVerbose } from "./commands/output.js";
import { runReview } from "./commands/review.js";
import { runScore } from "./commands/score.js";
import { runShare } from "./commands/share.js";
import { runStatus } from "./commands/status.js";
import { runStills } from "./commands/stills.js";
import { runStitch } from "./commands/stitch.js";
import { runUpscale } from "./commands/upscale.js";
import { runUse } from "./commands/use.js";
import { ELEVEN_V3_MODEL } from "./elevenlabs.js";
import { VsError } from "./errors.js";

// Title cards are rasterised by family name, so the default has to be a face
// every machine already has. Pass --font to use your own (it must be installed;
// `vs` checks and fails rather than letting qlmanage fall back silently).
const DEFAULT_FONT = "Helvetica";

interface NumberArgumentOptions {
  /** Reject fractions (counts, pixels, kbps). */
  integer?: boolean;
  max?: number;
  min?: number;
}

/**
 * Every other numeric flag goes through this, because an unchecked
 * `Number("10s")` is NaN and NaN fails silently rather than loudly: it collapses
 * `--poll-interval` into a 1ms hot loop against the rate limit, disables
 * `--timeout` outright (`Date.now() > NaN` is never true, so the run never gives
 * up), and reaches `pLimit` as a bare TypeError with no code. Reject the value
 * at the boundary instead, naming the flag and what actually arrived.
 *
 * `VsError` rather than commander's `InvalidArgumentError` so `--json` callers
 * get `"code": "invalid_input"` to branch on.
 */
function numberArgument(
  flag: string,
  options: NumberArgumentOptions = {}
): (value: string) => number {
  const { integer = false, max, min } = options;
  const bounds = [
    min === undefined ? undefined : `at least ${min}`,
    max === undefined ? undefined : `at most ${max}`,
  ]
    .filter(Boolean)
    .join(" and ");
  const expected = `expected ${integer ? "a whole number" : "a number"}${
    bounds ? ` ${bounds}` : ""
  }`;
  return (value: string): number => {
    const parsed = Number(value);
    const outOfRange =
      (min !== undefined && parsed < min) ||
      (max !== undefined && parsed > max);
    if (
      !Number.isFinite(parsed) ||
      (integer && !Number.isInteger(parsed)) ||
      outOfRange
    ) {
      throw new VsError(
        "invalid_input",
        `${flag} got "${value}": ${expected}`,
        {
          hint: "pass a bare number: the unit is implied by the flag, so drop any suffix (s, m, MB, dB)",
        }
      );
    }
    return parsed;
  };
}

function versionArgument(value: string): number {
  const version = Number(value.replace(/^v/iu, ""));
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new InvalidArgumentError("expected a revision such as 1 or v003");
  }
  return version;
}

/**
 * Build the command tree. Pure construction: nothing here parses argv, reads
 * stdin, or touches the network, so tests (and `--help` tooling) can inspect
 * the commands and flags without running the CLI.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("vs")
    .description(
      "CLI that turns a shot list into AI-generated video clips via BytePlus ModelArk Seedance 2.x"
    )
    .version(packageInfo().version);

  program
    .command("init")
    .description(
      "Scaffold a new film directory (shots.json, stills.json, README)"
    )
    .argument("<dir>", "film directory to create, e.g. films/my-film")
    .option("--title <title>", "film title (skips the prompt)")
    .option("--ratio <ratio>", "default aspect ratio")
    .option(
      "--duration <seconds>",
      "default shot duration",
      numberArgument("--duration", { integer: true })
    )
    .option(
      "--preamble <text>",
      "film.promptPreamble: the style block prepended to every shot prompt"
    )
    .option("--force", "overwrite an existing film", false)
    .option("--yes", "accept defaults without prompting", false)
    .action(async (dir: string, options) => {
      await runInit(dir, {
        duration: options.duration ? Number(options.duration) : undefined,
        force: options.force,
        preamble: options.preamble,
        ratio: options.ratio,
        title: options.title,
        yes: options.yes,
      });
    });

  program
    .command("generate")
    .description("Submit shots, poll to completion, and download the clips")
    .argument("<shots-file>", "path to shots.json")
    .option("--shot <id...>", "only generate these shot ids")
    .option(
      "--concurrency <n>",
      "max in-flight tasks",
      numberArgument("--concurrency", { integer: true, min: 1 }),
      3
    )
    .option(
      "--draft",
      "cheap 480p, audio-off pass into tasks.draft.json / output-draft/ (uses film.draftModel if set)",
      false
    )
    .option(
      "--dry-run",
      "print request payloads without calling the API",
      false
    )
    .option("--no-wait", "submit only; do not poll")
    .option(
      "--force",
      "submit a new numbered revision for shots that already succeeded",
      false
    )
    .option(
      "--poll-interval <seconds>",
      "poll interval",
      numberArgument("--poll-interval", { min: 1 }),
      10
    )
    .option(
      "--timeout <minutes>",
      "per-task poll timeout",
      numberArgument("--timeout", { min: 1 }),
      20
    )
    .option(
      "--max-cost <usd>",
      "refuse the run if the estimate exceeds this many USD (enforced under --yes and --dry-run too)",
      numberArgument("--max-cost", { min: 0.01 })
    )
    .option(
      "--yes",
      "skip the cost confirmation prompt (required non-interactively)",
      false
    )
    .action(async (shotsFile: string, options) => {
      await runGenerate(shotsFile, {
        concurrency: Number(options.concurrency),
        download: true,
        draft: options.draft,
        dryRun: options.dryRun,
        force: options.force,
        maxCost: options.maxCost,
        pollInterval: Number(options.pollInterval),
        shot: options.shot,
        timeout: Number(options.timeout),
        wait: options.wait,
        yes: options.yes,
      });
    });

  program
    .command("stills")
    .description(
      "Generate reference stills (Seedream via Ark, or Nano Banana when the stills file's top-level `model` is a gemini-* id)"
    )
    .argument("<stills-file>", "path to stills.json")
    .option("--still <id...>", "only generate these still ids")
    .option(
      "--concurrency <n>",
      "max in-flight requests",
      numberArgument("--concurrency", { integer: true, min: 1 }),
      2
    )
    .option(
      "--dry-run",
      "print request payloads without calling the API",
      false
    )
    .option("--force", "regenerate stills whose files already exist", false)
    .option("--output <dir>", "output directory, relative to the cwd")
    .action(async (stillsFile: string, options) => {
      await runStills(stillsFile, {
        concurrency: Number(options.concurrency),
        dryRun: options.dryRun,
        force: options.force,
        output: options.output,
        still: options.still,
      });
    });

  program
    .command("status")
    .description("Show the task manifest, or fetch one task by id")
    .argument(
      "[shots-file-or-task-id]",
      "a *.json shots file whose manifest to read, or a task id to fetch from the API"
    )
    .option(
      "--shots <file>",
      "shots file whose manifest to read",
      "./shots.json"
    )
    .option("--draft", "read the draft manifest (tasks.draft.json)", false)
    .option("--refresh", "re-query the API for non-terminal tasks", false)
    .action(async (positional: string | undefined, options) => {
      await runStatus(positional, {
        draft: options.draft,
        refresh: options.refresh,
        shots: options.shots,
      });
    });

  program
    .command("use")
    .description("Select which downloaded clip revision a shot uses")
    .argument("<shots-file>", "path to shots.json")
    .argument("<shot-id>", "shot whose selected revision should change")
    .argument("<version>", "revision number, e.g. 1 or v003", versionArgument)
    .option("--draft", "select from the draft manifest", false)
    .action(
      async (shotsFile: string, shotId: string, version: number, options) => {
        await runUse(shotsFile, shotId, version, {
          draft: options.draft,
        });
      }
    );

  program
    .command("stitch")
    .description("Assemble downloaded clips (and title cards) into one film")
    .argument("<shots-file>", "path to shots.json")
    .option(
      "--output <file>",
      "exact output file, relative to the cwd (default <outputDir>/renders/final/vNNN.mp4)"
    )
    .option(
      "--xfade <seconds>",
      "crossfade duration between clips",
      numberArgument("--xfade", { min: 0 }),
      0
    )
    .option("--music <file>", "continuous music bed mixed under clip audio")
    .option(
      "--music-gain <dB>",
      "music level in dB",
      numberArgument("--music-gain"),
      -12
    )
    .option("--narration <file>", "narration track mixed at full level")
    .option(
      "--narration-gain <dB>",
      "narration level in dB",
      numberArgument("--narration-gain"),
      0
    )
    .option(
      "--sfx-gain <dB>",
      "clip SFX level in dB (ignored by --latest)",
      numberArgument("--sfx-gain"),
      0
    )
    .option("--font <family>", "font family for title cards", DEFAULT_FONT)
    .option("--grade", "apply a subtle filmic grade", false)
    .option(
      "--draft",
      "stitch the draft cut (output-draft/, tasks.draft.json)",
      false
    )
    .option(
      "--latest",
      "always-a-reel: fill missing final clips with the draft clip, else a held still",
      false
    )
    .option("--dry-run", "print ffmpeg commands without running them", false)
    .action(async (shotsFile: string, options) => {
      await runStitch(shotsFile, {
        draft: options.draft,
        dryRun: options.dryRun,
        font: options.font,
        grade: options.grade,
        latest: options.latest,
        music: options.music,
        musicGain: Number(options.musicGain),
        narration: options.narration,
        narrationGain: Number(options.narrationGain),
        output: options.output,
        sfxGain: Number(options.sfxGain),
        xfade: Number(options.xfade),
      });
    });

  program
    .command("share")
    .description(
      "Compress a finished film under a size ceiling for messaging apps (two-pass)"
    )
    .argument("<video>", "path to the finished mp4")
    .option(
      "--output <file>",
      "exact output file, relative to the cwd (default exports/<name>-whatsapp/vNNN.mp4)"
    )
    .option(
      "--max-mb <n>",
      "hard size ceiling in MB",
      numberArgument("--max-mb", { min: 1 }),
      49
    )
    .option(
      "--height <n>",
      "cap output height (only downscales)",
      numberArgument("--height", { integer: true, min: 1 }),
      720
    )
    .option(
      "--audio-kbps <n>",
      "audio bitrate in kbps",
      numberArgument("--audio-kbps", { integer: true, min: 1 }),
      160
    )
    .option("--dry-run", "print ffmpeg commands without running them", false)
    .action(async (video: string, options) => {
      await runShare(video, {
        audioKbps: Number(options.audioKbps),
        dryRun: options.dryRun,
        height: Number(options.height),
        maxMb: Number(options.maxMb),
        output: options.output,
      });
    });

  program
    .command("upscale")
    .description(
      "Lanczos-upscale final clips to a delivery resolution (720p masters → output-1080/)"
    )
    .argument("<shots-file>", "path to shots.json")
    .option(
      "--shot <id...>",
      "only upscale these shot ids (the final-edit shots)"
    )
    .option(
      "--height <n>",
      "target height in pixels",
      numberArgument("--height", { integer: true, min: 1 }),
      1080
    )
    .option(
      "--crf <n>",
      "x264 quality (lower = higher quality)",
      numberArgument("--crf", { integer: true, max: 51, min: 0 }),
      18
    )
    .option("--draft", "upscale the draft pass instead of the final", false)
    .option(
      "--output <dir>",
      "output directory, relative to the cwd (default <outputDir>-<height>)"
    )
    .option("--dry-run", "print ffmpeg commands without running them", false)
    .action(async (shotsFile: string, options) => {
      await runUpscale(shotsFile, {
        crf: Number(options.crf),
        draft: options.draft,
        dryRun: options.dryRun,
        height: Number(options.height),
        output: options.output,
        shot: options.shot,
      });
    });

  program
    .command("animatic")
    .description(
      "Story reel: cut the whole film from stills (held to each shot's duration) with scratch audio — $0 of video"
    )
    .argument("<shots-file>", "path to shots.json")
    .option(
      "--output <file>",
      "exact output file, relative to the cwd (default <outputDir>/animatics/vNNN.mp4)"
    )
    .option("--music <file>", "temp music bed mixed under the reel")
    .option(
      "--music-gain <dB>",
      "music level in dB",
      numberArgument("--music-gain"),
      -18
    )
    .option("--narration <file>", "scratch narration mixed at full level")
    .option(
      "--narration-gain <dB>",
      "narration level in dB",
      numberArgument("--narration-gain"),
      0
    )
    .option("--font <family>", "font family for slates/cards", DEFAULT_FONT)
    .option("--draft", "write into the draft output dir (output-draft/)", false)
    .option("--dry-run", "print ffmpeg commands without running them", false)
    .action(async (shotsFile: string, options) => {
      await runAnimatic(shotsFile, {
        draft: options.draft,
        dryRun: options.dryRun,
        font: options.font,
        music: options.music,
        musicGain: Number(options.musicGain),
        narration: options.narration,
        narrationGain: Number(options.narrationGain),
        output: options.output,
      });
    });

  program
    .command("review")
    .description("Extract frames from downloaded clips into a contact sheet")
    .argument("<shots-file>", "path to shots.json")
    .option(
      "--frames <n>",
      "frames per clip",
      numberArgument("--frames", { integer: true, min: 1 }),
      3
    )
    .option(
      "--draft",
      "review the draft pass (output-draft/ → review-draft/)",
      false
    )
    .option(
      "--output <dir>",
      "review directory, relative to the cwd (default <filmDir>/review)"
    )
    .option("--dry-run", "print ffmpeg commands without running them", false)
    .action(async (shotsFile: string, options) => {
      await runReview(shotsFile, {
        draft: options.draft,
        dryRun: options.dryRun,
        frames: Number(options.frames),
        output: options.output,
      });
    });

  program
    .command("score")
    .description(
      "Generate a continuous instrumental score bed via Google Lyria 3 Pro (GEMINI_API_KEY)"
    )
    .argument("<prompt>", "score prompt (instrumental cinematic bed)")
    .option(
      "--shots <file>",
      "shots.json used to estimate program length and place score-vNNN.mp3 at the film root"
    )
    .option(
      "--duration <seconds>",
      "target bed length in seconds (overrides the shots.json estimate)",
      numberArgument("--duration", { min: 1 })
    )
    .option(
      "--clip",
      "use Lyria 3 Clip (~30s, cheaper) to iterate the prompt",
      false
    )
    .option(
      "--output <file>",
      "exact output file, relative to the cwd (default score-vNNN.mp3 at the film root)"
    )
    .option(
      "--dry-run",
      "print the Lyria request without calling the API",
      false
    )
    .action(async (prompt: string, options) => {
      await runScore({
        clip: options.clip,
        dryRun: options.dryRun,
        duration: options.duration ? Number(options.duration) : undefined,
        output: options.output,
        prompt,
        shots: options.shots,
      });
    });

  const narrate = program
    .command("narrate")
    .description(
      "Generate ElevenLabs narration from a TSV (NN\\ttext) or --text-file scratch VO"
    )
    .argument("[lines-file]", "path to lines.tsv (omit with --text-file)")
    .option(
      "--text-file <path>",
      "monolith scratch VO from a plain text file (ignores lines TSV)"
    )
    .option("--voice <id>", "ElevenLabs voice id (or set ELEVENLABS_VOICE_ID)")
    .option("--model <id>", "ElevenLabs model id", ELEVEN_V3_MODEL)
    .option(
      "--output <path>",
      "output dir for line-NN.mp3, or scratch mp3 path with --text-file"
    )
    .option("--force", "regenerate lines that already exist on disk", false)
    .option(
      "--dry-run",
      "print the TTS requests without calling the API",
      false
    )
    .action(async (linesFile: string | undefined, options) => {
      await runNarrate(linesFile, {
        dryRun: options.dryRun,
        force: options.force,
        model: options.model,
        outputDir: options.textFile ? undefined : options.output,
        outputFile: options.textFile ? options.output : undefined,
        textFile: options.textFile,
        voice: options.voice,
      });
    });

  narrate
    .command("assemble")
    .description(
      "Lay line-NN.mp3 files onto the stitch timeline into narration.mp3"
    )
    .argument("<shots-file>", "path to shots.json")
    .option(
      "--placement <file>",
      "placement TSV (line\\tshotId\\toffset), relative to the film dir",
      "narration/placement.tsv"
    )
    .option(
      "--output <file>",
      "exact output file, relative to the cwd (default narration.mp3 at the film root)"
    )
    .option(
      "--fade-shot <id>",
      "fail if the last line overlaps this shot's end fade"
    )
    .option(
      "--fade-lead <seconds>",
      "seconds before fade-shot end that must stay clear",
      numberArgument("--fade-lead", { min: 0 }),
      1.5
    )
    .option(
      "--draft",
      "probe draft clips (output-draft / tasks.draft.json)",
      false
    )
    .option(
      "--xfade <seconds>",
      "default crossfade INTO each segment when transition is unset (must match vs stitch --xfade)",
      numberArgument("--xfade", { min: 0 }),
      0
    )
    .option(
      "--dry-run",
      "print the timeline and ffmpeg plan without writing audio",
      false
    )
    .action(async (shotsFile: string, options) => {
      await runNarrateAssemble(shotsFile, {
        draft: options.draft,
        dryRun: options.dryRun,
        fadeLead: Number(options.fadeLead),
        fadeShot: options.fadeShot,
        output: options.output,
        placement: options.placement,
        xfade: Number(options.xfade),
      });
    });

  program
    .command("doctor")
    .description(
      "Check setup: Node, .env, API keys, ffmpeg/ffprobe, title-card tools, and optionally the Ark endpoint shape"
    )
    .argument(
      "[task-id]",
      "confirm the endpoint shape against an existing task (no paid generation)"
    )
    .option("--ffmpeg", "deprecated: ffmpeg is always checked", false)
    .action(async (taskId: string | undefined) => {
      await runDoctor(taskId);
    });

  program
    .command("download")
    .description("Download succeeded clips that are not yet on disk")
    .argument("[shots-file]", "path to shots.json", "./shots.json")
    .option(
      "--shots <file>",
      "alias for the positional shots file (kept for older scripts)"
    )
    .option(
      "--draft",
      "download from the draft manifest (tasks.draft.json)",
      false
    )
    .option("--output <dir>", "output directory, relative to the cwd")
    .action(async (shotsFile: string, options) => {
      const shots = options.shots ?? shotsFile;
      await runDownload(shots, {
        draft: options.draft,
        output: options.output,
        shots,
      });
    });

  // Every subcommand carries these, so `vs generate x --json` parses the same way
  // `vs --json generate x` does.
  for (const command of program.commands) {
    command
      .option(
        "--json",
        "emit machine-readable JSON on stdout (default when stdout is not a terminal)"
      )
      .option("--verbose", "print stack traces and the underlying error cause");
  }
  program
    .option("--json", "emit machine-readable JSON on stdout")
    .option("--verbose", "print stack traces and the underlying error cause");

  program.hook("preAction", (_program, action) => {
    const options = action.optsWithGlobals();
    if (options.json) {
      setJsonMode(true);
    }
    setVerbose(Boolean(options.verbose));
  });

  return program;
}
