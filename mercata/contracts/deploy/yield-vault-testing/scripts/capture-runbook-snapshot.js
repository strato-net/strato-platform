#!/usr/bin/env node
"use strict";

const path = require("path");
const { fetchExpectedTestnetNetwork } = require("./runtime");
const {
  atomicWrite,
  authenticateActors,
  latestBlock,
  normalizeAddress,
  readJson,
  readVaultSnapshot,
  stableJson,
} = require("./common");
const { attachLiveViews } = require("./run-yield-vault-upgrade-e2e");
const { readRequiredVaultViews } = require("./seed-yield-vault-old");

const PHASES = new Set(["initial", "post-initialization", "pre-smoke"]);
const SNAPSHOT_ACTOR_FIELDS = [
  "shares",
  "underlying",
  "allowances",
  "strategyDebt",
  "approvedStrategies",
  "activeRequestId",
  "claimableAssets",
];

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: node capture-runbook-snapshot.js --phase <phase> " +
        "--seed-manifest <path> --funding-manifest <path> --output <path>"
      );
    }
    parsed[key.slice(2)] = value;
  }
  for (const key of ["phase", "seed-manifest", "funding-manifest", "output"]) {
    if (!parsed[key]) throw new Error(`Missing required argument --${key}`);
  }
  if (!PHASES.has(parsed.phase)) {
    throw new Error(`--phase must be one of ${[...PHASES].join(", ")}`);
  }
  return {
    phase: parsed.phase,
    seedManifest: path.resolve(parsed["seed-manifest"]),
    fundingManifest: path.resolve(parsed["funding-manifest"]),
    output: path.resolve(parsed.output),
  };
}

function snapshotActorRoles(snapshot) {
  const roles = new Set();
  for (const field of SNAPSHOT_ACTOR_FIELDS) {
    for (const role of Object.keys(snapshot && snapshot[field] || {})) roles.add(role);
  }
  return roles;
}

function buildAddresses(seedManifest, fundingManifest, ownerAddress, phase) {
  const expected = seedManifest.finalUnpausedSeedSnapshot;
  const allowed = phase === "initial" ? snapshotActorRoles(expected) : null;
  const fundingActors = Object.entries(fundingManifest.actors || {})
    .filter(([name]) => !allowed || allowed.has(name));
  return {
    ...Object.fromEntries(fundingActors.map(([name, value]) => [
      name,
      normalizeAddress(typeof value === "object" ? value.address : value),
    ])),
    OWNER: normalizeAddress(ownerAddress),
    ASSET: normalizeAddress(seedManifest.addresses.ASSET),
    VAULT_PROXY: normalizeAddress(seedManifest.addresses.VAULT_PROXY),
    OLD_IMPLEMENTATION: normalizeAddress(seedManifest.addresses.OLD_IMPLEMENTATION),
  };
}

function snapshotRequestIds(seedManifest, phase) {
  if (phase !== "initial") return [1, 2, 3, 4];
  return Object.keys(
    seedManifest.finalUnpausedSeedSnapshot &&
      seedManifest.finalUnpausedSeedSnapshot.requests || {}
  ).map((value) => Number(value));
}

function assertInitialSnapshot(snapshot, expected) {
  if (!expected || stableJson(snapshot) !== stableJson(expected)) {
    throw new Error("Initial live snapshot does not exactly match the seed manifest");
  }
}

function withSerializableLiveViews(snapshot) {
  const liveViews = JSON.parse(JSON.stringify(
    snapshot.liveViews,
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  ));
  return { ...snapshot, liveViews };
}

async function capture(args) {
  const seedManifest = readJson(args.seedManifest);
  const fundingManifest = readJson(args.fundingManifest);
  const actors = await authenticateActors(["OWNER"]);
  const addresses = buildAddresses(
    seedManifest,
    fundingManifest,
    actors.OWNER.address,
    args.phase
  );
  const requestIds = snapshotRequestIds(seedManifest, args.phase);
  const network = await fetchExpectedTestnetNetwork(actors.OWNER.token);
  let snapshot = await readVaultSnapshot({
    actors,
    addresses,
    assetContractName: process.env.ASSET_CONTRACT_NAME || "Token",
    requestIds,
  });
  if (args.phase === "initial") {
    const liveViews = await readRequiredVaultViews({
      actors,
      addresses,
      assetContractName: process.env.ASSET_CONTRACT_NAME || "Token",
      requestIds,
    });
    const { source: _source, ...viewValues } = liveViews;
    Object.assign(snapshot, viewValues, { liveViews });
    const expected = seedManifest.finalUnpausedSeedSnapshot;
    assertInitialSnapshot(snapshot, expected);
  } else {
    await attachLiveViews({ actors, addresses }, snapshot);
    snapshot = withSerializableLiveViews(snapshot);
  }
  snapshot._evidence = {
    phase: args.phase,
    capturedAt: new Date().toISOString(),
    network,
    block: await latestBlock(actors.OWNER.token),
  };
  atomicWrite(args.output, snapshot);
  return snapshot;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await capture(args);
  console.log(
    `RUNBOOK_SNAPSHOT phase=${args.phase} path=${args.output} ` +
    `implementation=${snapshot.implementation}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`RUNBOOK_SNAPSHOT_FAILED reason=${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PHASES,
  SNAPSHOT_ACTOR_FIELDS,
  snapshotActorRoles,
  buildAddresses,
  snapshotRequestIds,
  assertInitialSnapshot,
  withSerializableLiveViews,
  parseArgs,
  capture,
  main,
};
