#!/usr/bin/env node
"use strict";

const {
  WorkflowStop,
  parseArgs,
  requireArguments,
  requireOnlyArguments,
  runSafeUpgrade,
} = require("./upgrade-safety");

function usage() {
  console.error(
    "Upgrade: node safe-upgrade-yield-vault.js --proxy-address <address> " +
    "--expected-old-implementation <address> [--expected-owner <storage-owner>] " +
    "--run-state <path> --evidence-output <path>"
  );
  console.error(
    "Rollback: node safe-upgrade-yield-vault.js --rollback --proxy-address <address> " +
    "--implementation-address <old> --expected-current-implementation <new> " +
    "[--expected-owner <storage-owner>] --run-state <path> --evidence-output <path>"
  );
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, ["help", "rollback"]);
  requireOnlyArguments(args, [
    "help",
    "rollback",
    "proxy-address",
    "expected-old-implementation",
    "implementation-address",
    "expected-current-implementation",
    "expected-owner",
    "run-state",
    "evidence-output",
  ]);
  if (args.help) {
    usage();
    return null;
  }
  const common = ["proxy-address", "run-state", "evidence-output"];
  requireArguments(
    args,
    args.rollback
      ? [...common, "implementation-address", "expected-current-implementation"]
      : [...common, "expected-old-implementation"]
  );
  if (args.rollback && args["expected-old-implementation"]) {
    throw new Error("--expected-old-implementation is not valid with --rollback");
  }
  if (!args.rollback &&
      (args["implementation-address"] || args["expected-current-implementation"])) {
    throw new Error("Rollback arguments require --rollback");
  }
  const expectedStorageOwner = args["expected-owner"] || process.env.VAULT_OWNER_ADDRESS;
  if (!expectedStorageOwner) {
    throw new Error("VAULT_OWNER_ADDRESS or --expected-owner is required");
  }
  return runSafeUpgrade({
    rollback: args.rollback === true,
    proxyAddress: args["proxy-address"],
    expectedOldImplementation: args["expected-old-implementation"],
    implementationAddress: args["implementation-address"],
    expectedCurrentImplementation: args["expected-current-implementation"],
    expectedOwner: expectedStorageOwner,
    runState: args["run-state"],
    evidenceOutput: args["evidence-output"],
    expectedReviewedSourceHash: process.env.EXPECTED_REVIEWED_SOURCE_HASH,
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
