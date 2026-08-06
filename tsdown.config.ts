import { defineConfig } from "tsdown";

export default defineConfig({
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  entry: { cli: "src/cli.ts" },
  // Keeps the emitted extension `.js` rather than `.mjs`, which is what `bin`
  // in package.json points at.
  fixedExtension: false,
  format: ["esm"],
  sourcemap: true,
  target: "node24",
});
