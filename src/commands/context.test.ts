import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isVsError } from "../errors.js";
import { MODEL_IDS } from "../models.js";
import {
  assertInteractive,
  createVideoModel,
  packageInfo,
  resolveFilm,
} from "./context.js";

async function writeShots(outputDir?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vs-context-"));
  const path = join(dir, "shots.json");
  const film: Record<string, unknown> = { title: "Test" };
  if (outputDir !== undefined) {
    film.outputDir = outputDir;
  }
  await writeFile(
    path,
    JSON.stringify({ film, shots: [{ id: "shot-01", prompt: "a cat" }] })
  );
  return path;
}

describe("resolveFilm", () => {
  it("defaults outputDir to ./output beside the shots file", async () => {
    const { outputDir, shotsDir } = await resolveFilm(await writeShots());
    expect(outputDir).toBe(resolve(shotsDir, "output"));
  });

  it("honours film.outputDir", async () => {
    const { outputDir, shotsDir } = await resolveFilm(
      await writeShots("./clips")
    );
    expect(outputDir).toBe(resolve(shotsDir, "clips"));
  });

  it("resolves an explicit --output against the cwd, not the film dir", async () => {
    const { outputDir } = await resolveFilm(await writeShots("./clips"), {
      output: "./final",
    });
    expect(outputDir).toBe(resolve(process.cwd(), "final"));
  });

  it("ignores the draft suffix when --output is explicit", async () => {
    const { outputDir } = await resolveFilm(await writeShots("./clips"), {
      output: "./final",
      pass: "draft",
    });
    expect(outputDir).toBe(resolve(process.cwd(), "final"));
  });

  it("suffixes the output dir with -draft for a draft pass", async () => {
    const { outputDir, shotsDir } = await resolveFilm(
      await writeShots("./clips"),
      { pass: "draft" }
    );
    expect(outputDir).toBe(resolve(shotsDir, "clips-draft"));
  });
});

describe("assertInteractive", () => {
  const originalCi = process.env.CI;
  afterEach(() => {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  it("fails fast (rather than hanging) when stdin is not a TTY", () => {
    // vitest runs with a non-TTY stdin, which is exactly the agent/CI case.
    let caught: unknown;
    try {
      assertInteractive("--yes");
    } catch (error) {
      caught = error;
    }
    expect(isVsError(caught)).toBe(true);
    expect((caught as Error & { code: string }).code).toBe("not_interactive");
    expect((caught as Error & { hint?: string }).hint).toContain("--yes");
  });
});

describe("packageInfo", () => {
  it("finds this package's own manifest", () => {
    const info = packageInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(info.engines?.node).toBeDefined();
  });
});

describe("createVideoModel resolves credentials lazily", () => {
  // `--dry-run` builds a model purely to render a wire body, which is pure and
  // needs no auth. An earlier version resolved the key in the provider
  // constructor, so `vs generate --dry-run` died with "MINIMAX_API_KEY is not
  // set" on a machine that was never going to send anything, defeating the
  // whole point of a free preflight.
  const saved = {
    ark: process.env.ARK_API_KEY,
    comfyui: process.env.COMFYUI_BASE_URL,
    minimax: process.env.MINIMAX_API_KEY,
  };

  beforeEach(() => {
    saved.ark = process.env.ARK_API_KEY;
    saved.comfyui = process.env.COMFYUI_BASE_URL;
    saved.minimax = process.env.MINIMAX_API_KEY;
    // `delete`, not `= undefined`: assigning to process.env coerces, so the key
    // would read back as the string "undefined" and still look present.
    process.env.ARK_API_KEY = undefined;
    process.env.MINIMAX_API_KEY = undefined;
    delete process.env.ARK_API_KEY;
    delete process.env.COMFYUI_BASE_URL;
    delete process.env.MINIMAX_API_KEY;
  });

  afterEach(() => {
    process.env.ARK_API_KEY = saved.ark;
    process.env.COMFYUI_BASE_URL = saved.comfyui;
    process.env.MINIMAX_API_KEY = saved.minimax;
  });

  it.each([MODEL_IDS.minimaxH3, MODEL_IDS.seedance25])(
    "builds %s and renders a body with no api key set",
    (modelId) => {
      const model = createVideoModel(modelId);
      const body = model.toRequestBody({
        aspectRatio: "16:9",
        durationSeconds: 6,
        prompt: "a lighthouse",
        references: [],
      }) as Record<string, unknown>;
      expect(body.model).toBe(modelId);
    }
  );

  it("still refuses to submit without the key", async () => {
    // The other half of lazy: the key is not optional, only deferred. Losing
    // this would turn a clear missing_credential into a 401 from the provider.
    const model = createVideoModel(MODEL_IDS.minimaxH3);
    const failure = await model.getTask("t-1").catch((error: unknown) => error);
    expect(isVsError(failure)).toBe(true);
    expect((failure as { code?: string }).code).toBe("missing_credential");
  });

  it("builds the local H3 model without any API credential", () => {
    process.env.COMFYUI_BASE_URL = "http://127.0.0.1:8188";
    const model = createVideoModel("comfyui:MiniMax-H3-Local");
    const body = model.toRequestBody({
      aspectRatio: "16:9",
      durationSeconds: 5,
      prompt: "a lighthouse",
      references: [],
      resolution: "480p",
    }) as Record<string, unknown>;
    expect(model.provider).toBe("comfyui");
    expect(body.client_id).toBe("video-studio");
  });
});
