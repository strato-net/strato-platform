#!/usr/bin/env node
"use strict";

const path = require("path");

const { atomicWriteJson, requiredEnv } = require("./runtime");

const CORE_ROLES = [
  "MINTER",
  "OWNER",
  "ALICE",
  "BOB",
  "CAROL",
  "STRATEGY",
  "LOSS_SINK",
  "SMOKE_USER",
  "REWARD_DISTRIBUTOR",
  "DONOR",
  "DAVE",
];
const ADDRESS_RE = /^[0-9a-f]{40}$/;

function addressFor(role) {
  const value = requiredEnv(`${role}_ADDRESS`);
  if (!ADDRESS_RE.test(value)) {
    throw new Error(`${role}_ADDRESS must be lowercase 40-hex without 0x`);
  }
  return value;
}

function parseArgs(argv) {
  if (argv.length === 0) return { output: path.resolve("yield-vault-actors.json") };
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
    throw new Error("Usage: node generate-actors-json.js [--output <actors.json>]");
  }
  return { output: path.resolve(argv[1]) };
}

function buildActors() {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    expectedNetworkID: requiredEnv("EXPECTED_NETWORK_ID"),
    actors: Object.fromEntries(CORE_ROLES.map((role) => [role, addressFor(role)])),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildActors();
  atomicWriteJson(args.output, manifest);
  console.log(`ACTORS_JSON path=${args.output} roles=${Object.keys(manifest.actors).length}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ACTORS_JSON_FAILED reason=${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { CORE_ROLES, buildActors, main, parseArgs };
