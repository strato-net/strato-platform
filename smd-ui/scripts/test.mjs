import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

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
  });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
