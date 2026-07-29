#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { authenticateActors, readJson } = require("../scripts/common");
const { fetchExpectedTestnetNetwork } = require("../scripts/runtime");

const DIRECTORY = __dirname;
const SCRIPTS_DIRECTORY = path.join(DIRECTORY, "..", "scripts");

function parseArgs(argv) {
  const phase = argv[0];
  if (!["seed", "e2e"].includes(phase)) {
    throw new Error("First argument must be seed or e2e");
  }
  const required = phase === "seed"
    ? ["actors", "funding-manifest", "seed-state", "seed-manifest"]
    : ["funding-manifest", "seed-manifest", "runbook-report", "e2e-state", "e2e-report"];
  const allowed = new Set(required);
  const parsed = { phase };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid disposable ${phase} arguments`);
    }
    const name = key.slice(2);
    if (!allowed.has(name)) {
      throw new Error(`Unknown disposable ${phase} argument --${name}`);
    }
    parsed[name] = path.resolve(value);
  }
  for (const key of required) {
    if (!parsed[key]) throw new Error(`Missing required argument --${key}`);
  }
  return parsed;
}

function requireFresh(paths) {
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      throw new Error(
        `Disposable test requires a fresh path; remove explicitly before retrying: ${filePath}`
      );
    }
  }
}

function run(script, args, env) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIRECTORY, script), ...args], {
    cwd: path.resolve(DIRECTORY, "../../.."),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    throw new Error(`${script} exited ${result.status}`);
  }
}

async function assertDisposableNetwork() {
  if (String(process.env.YIELD_VAULT_DISPOSABLE_TEST).toLowerCase() !== "true") {
    throw new Error("Set YIELD_VAULT_DISPOSABLE_TEST=true to authorize this test");
  }
  const actors = await authenticateActors(["OWNER"]);
  const network = await fetchExpectedTestnetNetwork(actors.OWNER.token);
  if (!/(test|helium)/i.test(network.networkName)) {
    throw new Error(`Disposable tests refuse network ${network.networkName}`);
  }
  return network;
}

async function runSeedPhase(args) {
  if (!process.env.ASSET_ADDRESS || !process.env.FEE_TOKEN_ADDRESS) {
    throw new Error("ASSET_ADDRESS and FEE_TOKEN_ADDRESS are required");
  }
  requireFresh([
    args["funding-manifest"],
    `${args["funding-manifest"]}.run-state.json`,
    args["seed-state"],
    args["seed-manifest"],
  ]);
  run("fund-yield-vault-test-actors.js", [
    "--asset", process.env.ASSET_ADDRESS,
    "--fee-token", process.env.FEE_TOKEN_ADDRESS,
    "--runs", "10",
    "--actors", args.actors,
    "--output", args["funding-manifest"],
  ]);
  run("seed-yield-vault-old.js", [
    "--run-state", args["seed-state"],
  ], {
    YIELD_VAULT_FUNDING_MANIFEST: args["funding-manifest"],
    SEED_MANIFEST_PATH: args["seed-manifest"],
  });
  const manifest = readJson(args["seed-manifest"]);
  if (manifest.checkpoint190Complete !== true) {
    throw new Error("Disposable seed did not complete checkpoint 190");
  }
}

async function runE2EPhase(args) {
  requireFresh([args["e2e-state"], args["e2e-report"]]);
  run("run-yield-vault-upgrade-e2e.js", [
    "--seed-manifest", args["seed-manifest"],
    "--funding-manifest", args["funding-manifest"],
    "--runbook-report", args["runbook-report"],
    "--run-state", args["e2e-state"],
  ], {
    E2E_REPORT_PATH: args["e2e-report"],
  });
  const report = readJson(args["e2e-report"]);
  if (report.checkpoint700Complete !== true) {
    throw new Error("Disposable E2E did not complete checkpoint 700");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const network = await assertDisposableNetwork();
  if (args.phase === "seed") await runSeedPhase(args);
  else await runE2EPhase(args);
  console.log(
    `DISPOSABLE_ENVIRONMENT_PASS phase=${args.phase} ` +
    `network=${network.networkName} id=${network.networkID}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`DISPOSABLE_ENVIRONMENT_FAILED reason=${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  requireFresh,
  assertDisposableNetwork,
  runSeedPhase,
  runE2EPhase,
  main,
};
