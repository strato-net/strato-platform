import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Vite's `?raw` imports, as plain text
const raw = {
  name: "raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

await mkdir("node_modules/.cache", { recursive: true });
const directory = await mkdtemp("node_modules/.cache/smd-tests-");
try {
  const outfile = path.resolve(directory, "multisig.test.mjs");
  await build({
    entryPoints: ["src/services/multisig.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    tsconfig: "tsconfig.app.json",
    plugins: [raw],
  });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
