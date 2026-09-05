import { describe, expect, it, vi } from "vitest";

import { runNarrateAssemble } from "./commands/narrate.js";
import { buildProgram } from "./program.js";

vi.mock("./commands/narrate.js", () => ({
  runNarrate: vi.fn(),
  runNarrateAssemble: vi.fn(),
}));

describe("nested narration option routing", () => {
  it("keeps dry-run and output on assemble instead of its parent", async () => {
    await buildProgram().parseAsync([
      "node",
      "vs",
      "narrate",
      "assemble",
      "shots.json",
      "--dry-run",
      "--output",
      "safe-version.mp3",
      "--json",
    ]);
    expect(runNarrateAssemble).toHaveBeenLastCalledWith(
      "shots.json",
      expect.objectContaining({
        dryRun: true,
        output: "safe-version.mp3",
      })
    );
  });
});
