#!/usr/bin/env node
"use strict";

const {
  WorkflowStop,
  parseArgs,
  requireArguments,
  requireOnlyArguments,
  runDeployOldProxy,
} = require("./upgrade-safety");

function usage() {
  console.error(
    "Usage: node deploy-yield-vault-old-proxy.js [--expected-owner <storage-owner>] " +
    "--run-state <path> --evidence-output <path>"
  );
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, ["help"]);
  requireOnlyArguments(args, ["help", "expected-owner", "run-state", "evidence-output"]);
  if (args.help) {
    usage();
    return null;
  }
  requireArguments(args, ["run-state", "evidence-output"]);
  const expectedStorageOwner = args["expected-owner"] || process.env.VAULT_OWNER_ADDRESS;
  if (!expectedStorageOwner) {
    throw new Error("VAULT_OWNER_ADDRESS or --expected-owner is required");
  }
  return runDeployOldProxy({
    expectedOwner: expectedStorageOwner,
    runState: args["run-state"],
    evidenceOutput: args["evidence-output"],
    expectedProxySourceHash: process.env.EXPECTED_PROXY_SOURCE_HASH,
    expectedOldSourceHash: process.env.EXPECTED_OLD_REVIEWED_SOURCE_HASH,
  });
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof WorkflowStop) {
      console.error(
        `UPGRADE_SAFETY_STOP checkpoint=${error.checkpoint} reason=${error.reason} ` +
        `txHash=${error.transactionHash || "none"}`
      );
    } else {
      console.error(`UPGRADE_SAFETY_FAILED reason=${JSON.stringify(error.message)}`);
    }
    process.exitCode = 1;
  });
}

module.exports = { main };
