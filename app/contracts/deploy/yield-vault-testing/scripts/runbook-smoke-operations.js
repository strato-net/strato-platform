#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  ADMIN_REGISTRY,
  MAX_UINT256,
  POLL_LIMIT_MS,
  RAY,
  U,
  assertEqual,
  assertResumeState,
  atomicWrite,
  authenticateActors,
  bigint,
  boolean,
  createContext,
  env,
  eventAttributes,
  executeCheckpoint,
  fetchExpectedTestnetNetwork,
  field,
  hashFile,
  normalizeAddress,
  parseArgs,
  readJson,
  runWithJournal,
  stableJson,
  validateStorageOwnerAuthority,
} = require("./common");
const {
  buildAddresses,
} = require("./capture-runbook-snapshot");
const {
  refreshSnapshotDerived,
} = require("./run-yield-vault-upgrade-e2e");

const REWARD_ALLOWANCE = 30n * U;
const SMOKE_AMOUNT = 10n * U;
const QUEUE_BUDGET = 160n * U;
const TRACE_FIELDS = [
  "paused",
  "perSecondSavingsRate",
  "lastAccrual",
  "idle",
  "accountedAssets",
  "totalAssets",
  "totalSupply",
  "totalQueuedShares",
  "totalClaimableAssets",
  "queueHead",
  "queueTail",
  "nextRequestId",
  "shares.SMOKE_USER",
  "shares.VAULT_PROXY",
  "claimableAssets.SMOKE_USER",
  "underlying.SMOKE_USER",
  "underlying.REWARD_DISTRIBUTOR",
  "allowances.SMOKE_USER",
  "allowances.REWARD_DISTRIBUTOR",
];
const ONLY_OWNER = Object.freeze({
  onlyOwner: true,
  governed: true,
  registryContract: "YieldVault",
});
const MODES = Object.freeze({
  prepare: {
    scriptName: "prepare-yield-vault-smoke",
    runState: "yield-vault-smoke-preparation-run-state.json",
    evidenceOutput: "yield-vault-smoke-preparation-evidence.json",
    actorNames: ["OWNER", "REWARD_DISTRIBUTOR", "SMOKE_USER"],
  },
  smoke: {
    scriptName: "run-yield-vault-smoke",
    runState: "yield-vault-smoke-run-state.json",
    evidenceOutput: "yield-vault-smoke-evidence.json",
    actorNames: ["OWNER", "APPROVER", "REWARD_DISTRIBUTOR", "SMOKE_USER"],
  },
});

function cloneSnapshot(snapshot) {
  return JSON.parse(stableJson(snapshot));
}

function add(container, key, amount) {
  container[key] = (bigint(container[key] || 0) + bigint(amount)).toString();
}

function spendAllowance(snapshot, actor, amount) {
  if (bigint(snapshot.allowances[actor]) !== MAX_UINT256) {
    add(snapshot.allowances, actor, -bigint(amount));
  }
}

function eventNamed(events, name) {
  const event = (events || []).find((candidate) =>
    field(candidate, ["eventName", "event_name", "name"], null) === name);
  if (!event) throw new Error(`Missing required ${name} event`);
  return event;
}

function eventTimestampSeconds(event) {
  const value = field(event, ["block_timestamp", "blockTimestamp", "timestamp"], null);
  if (/^\d+$/.test(String(value || ""))) {
    const numeric = bigint(value);
    return numeric > 10_000_000_000n ? numeric / 1000n : numeric;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid event timestamp ${value}`);
  return BigInt(Math.floor(milliseconds / 1000));
}

function updateAccrualTimestamp(expected, events, eventName) {
  expected.lastAccrual = eventTimestampSeconds(eventNamed(events, eventName)).toString();
}

function actorForAddress(context, address) {
  const normalized = normalizeAddress(address, "queue owner");
  const match = Object.entries(context.addresses).find(([role, candidate]) =>
    !["ASSET", "VAULT_PROXY", "OLD_IMPLEMENTATION", "VAULT_OWNER"].includes(role) &&
    normalizeAddress(candidate, `${role} address`) === normalized);
  if (!match) throw new Error(`Queue owner ${normalized} is not a configured runbook actor`);
  return match[0];
}

function reconcileSmokeDeposit({ preState, events }) {
  const expected = cloneSnapshot(preState);
  const deposit = eventAttributes(eventNamed(events, "Deposit"));
  const assets = bigint(deposit.assets, "Deposit.assets");
  const shares = bigint(deposit.shares, "Deposit.shares");
  assertEqual(assets, SMOKE_AMOUNT, "smoke deposit assets");
  add(expected.underlying, "SMOKE_USER", -assets);
  add(expected.underlying, "VAULT_PROXY", assets);
  spendAllowance(expected, "SMOKE_USER", assets);
  add(expected.shares, "SMOKE_USER", shares);
  add(expected, "totalSupply", shares);
  add(expected, "accountedAssets", assets);
  updateAccrualTimestamp(expected, events, "Deposit");
  return refreshSnapshotDerived(expected);
}

function reconcileSmokeRequest({ preState, events }, context) {
  const expected = cloneSnapshot(preState);
  const requested = eventAttributes(eventNamed(events, "WithdrawalRequested"));
  const requestId = bigint(requested.requestId, "WithdrawalRequested.requestId").toString();
  const shares = bigint(requested.shares, "WithdrawalRequested.shares");
  assertEqual(shares, SMOKE_AMOUNT, "smoke queued shares");
  assertEqual(requestId, preState.nextRequestId, "smoke request ID");
  const previousTail = bigint(preState.queueTail).toString();
  add(expected.shares, "SMOKE_USER", -shares);
  add(expected.shares, "VAULT_PROXY", shares);
  add(expected, "totalQueuedShares", shares);
  expected.activeRequestId.SMOKE_USER = requestId;
  expected.nextRequestId = (bigint(requestId) + 1n).toString();
  expected.requests[requestId] = {
    shares: shares.toString(),
    receiver: context.addresses.SMOKE_USER,
    next: "0",
    exists: true,
  };
  expected.requestOwner[requestId] = context.addresses.SMOKE_USER;
  if (bigint(previousTail) === 0n) {
    expected.queueHead = requestId;
  } else {
    expected.requests[previousTail].next = requestId;
  }
  expected.queueTail = requestId;
  updateAccrualTimestamp(expected, events, "WithdrawalRequested");
  return refreshSnapshotDerived(expected);
}

function reconcileSmokeQueue({ preState, events }, context) {
  const expected = cloneSnapshot(preState);
  const queueEvents = (events || [])
    .filter((event) => field(event, ["eventName", "event_name", "name"], null) ===
      "QueueProcessed")
    .sort((left, right) =>
      Number(field(left, ["event_index", "eventIndex"], 0)) -
      Number(field(right, ["event_index", "eventIndex"], 0)));
  assertEqual(queueEvents.length, 3, "smoke QueueProcessed event count");
  for (const event of queueEvents) {
    const processed = eventAttributes(event);
    const requestId = bigint(processed.requestId, "QueueProcessed.requestId").toString();
    const owner = actorForAddress(context, processed.owner);
    const burned = bigint(processed.sharesBurned, "QueueProcessed.sharesBurned");
    const reserved = bigint(processed.assetsReserved, "QueueProcessed.assetsReserved");
    if (!boolean(processed.fullyProcessed)) {
      throw new Error(`Smoke queue request ${requestId} was not fully processed`);
    }
    const request = expected.requests[requestId];
    if (!request || !request.exists || bigint(request.shares) !== burned) {
      throw new Error(`Smoke queue event does not fully consume request ${requestId}`);
    }
    const next = bigint(request.next).toString();
    add(expected, "totalSupply", -burned);
    add(expected, "totalQueuedShares", -burned);
    add(expected.shares, "VAULT_PROXY", -burned);
    add(expected.claimableAssets, owner, reserved);
    add(expected, "totalClaimableAssets", reserved);
    expected.activeRequestId[owner] = "0";
    // SolidVM's BLOC state retains the non-first struct fields after
    // `delete requests[current]`; the request is inactive because shares and
    // requestOwner are cleared and it is no longer reachable from queueHead.
    expected.requests[requestId].shares = "0";
    expected.requestOwner[requestId] = "0".repeat(40);
    expected.queueHead = next;
    if (bigint(next) === 0n) expected.queueTail = "0";
  }
  updateAccrualTimestamp(expected, events, "QueueProcessed");
  return refreshSnapshotDerived(expected);
}

function reconcileSmokeClaim({ preState, events }) {
  const expected = cloneSnapshot(preState);
  const claimed = eventAttributes(eventNamed(events, "WithdrawalClaimed"));
  const assets = bigint(claimed.assets, "WithdrawalClaimed.assets");
  assertEqual(assets, preState.claimableAssets.SMOKE_USER, "smoke claim assets");
  add(expected.underlying, "SMOKE_USER", assets);
  add(expected.underlying, "VAULT_PROXY", -assets);
  expected.claimableAssets.SMOKE_USER = "0";
  add(expected, "totalClaimableAssets", -assets);
  add(expected, "accountedAssets", -assets);
  return refreshSnapshotDerived(expected);
}

function prepareSpecs(context) {
  return {
    distributorApproval: {
      name: "reward distributor asset approval",
      actor: "REWARD_DISTRIBUTOR",
      contract: "ASSET",
      contractName: context.assetContractName,
      method: "approve",
      args: { spender: context.addresses.VAULT_PROXY, value: REWARD_ALLOWANCE },
      events: ["Approval"],
      traceFields: TRACE_FIELDS,
      expectedPostState(preState) {
        const expected = cloneSnapshot(preState);
        expected.allowances.REWARD_DISTRIBUTOR = REWARD_ALLOWANCE.toString();
        return expected;
      },
      assertPre(snapshot) {
        assertEqual(snapshot.paused, true, "preparation paused state");
        assertEqual(snapshot.accrualInitialized, true, "accrual initialization");
        assertEqual(
          snapshot.rewardDistributor,
          context.addresses.REWARD_DISTRIBUTOR,
          "manually configured reward distributor"
        );
        assertEqual(snapshot.perSecondSavingsRate, RAY, "manually configured neutral rate");
      },
      assertPost(snapshot) {
        assertEqual(
          snapshot.allowances.REWARD_DISTRIBUTOR,
          REWARD_ALLOWANCE,
          "reward distributor allowance"
        );
      },
    },
    smokeUserApproval: {
      name: "smoke user asset approval",
      actor: "SMOKE_USER",
      contract: "ASSET",
      contractName: context.assetContractName,
      method: "approve",
      args: { spender: context.addresses.VAULT_PROXY, value: SMOKE_AMOUNT },
      events: ["Approval"],
      traceFields: TRACE_FIELDS,
      expectedPostState(preState) {
        const expected = cloneSnapshot(preState);
        expected.allowances.SMOKE_USER = SMOKE_AMOUNT.toString();
        return expected;
      },
      assertPost(snapshot) {
        assertEqual(snapshot.allowances.SMOKE_USER, SMOKE_AMOUNT, "smoke user allowance");
      },
    },
  };
}

function smokeSpecs(context) {
  return {
    smokeDeposit: {
      name: "smoke user deposit",
      actor: "SMOKE_USER",
      contract: "VAULT_PROXY",
      contractName: "YieldVault",
      method: "deposit",
      args: { assets: SMOKE_AMOUNT, receiver: context.addresses.SMOKE_USER },
      events: ["Deposit", "Transfer"],
      traceFields: TRACE_FIELDS,
      assertPre(snapshot) {
        assertEqual(snapshot.paused, false, "smoke vault paused state");
        assertEqual(snapshot.perSecondSavingsRate, RAY, "smoke neutral savings rate");
        assertEqual(
          snapshot.rewardDistributor,
          context.addresses.REWARD_DISTRIBUTOR,
          "smoke reward distributor"
        );
        if (bigint(snapshot.allowances.SMOKE_USER) < SMOKE_AMOUNT) {
          throw new Error("SMOKE_USER allowance is below the 10-asset deposit");
        }
      },
      reconcileSubmittedPostState: reconcileSmokeDeposit,
    },
    smokeRedeemOrQueue: {
      name: "smoke user redeem-or-queue",
      actor: "SMOKE_USER",
      contract: "VAULT_PROXY",
      contractName: "YieldVault",
      method: "redeemOrQueue",
      args: {
        shares: SMOKE_AMOUNT,
        receiver: context.addresses.SMOKE_USER,
        owner_: context.addresses.SMOKE_USER,
      },
      events: ["WithdrawalRequested", "Transfer"],
      traceFields: TRACE_FIELDS,
      assertPre(snapshot) {
        assertEqual(snapshot.nextRequestId, 3n, "smoke next request ID");
        assertEqual(snapshot.activeRequestId.SMOKE_USER, 0n, "smoke active request");
        if (bigint(snapshot.shares.SMOKE_USER) < SMOKE_AMOUNT) {
          throw new Error("SMOKE_USER has fewer than 10 vault shares");
        }
      },
      reconcileSubmittedPostState: reconcileSmokeRequest,
    },
    smokeProcessQueue: {
      name: "process three smoke runbook requests",
      actor: "OWNER",
      contract: "VAULT_PROXY",
      contractName: "YieldVault",
      method: "processQueue",
      args: { maxRequests: 3n, maxAssets: QUEUE_BUDGET },
      events: ["QueueProcessed"],
      traceFields: TRACE_FIELDS,
      ...ONLY_OWNER,
      reconcileSubmittedPostState: reconcileSmokeQueue,
      assertPost(snapshot) {
        assertEqual(snapshot.queueHead, 0n, "post-smoke queue head");
        assertEqual(snapshot.queueTail, 0n, "post-smoke queue tail");
        if (bigint(snapshot.claimableAssets.SMOKE_USER) <= 0n) {
          throw new Error("Queue processing created no SMOKE_USER claim");
        }
      },
    },
    smokeClaim: {
      name: "smoke user claim",
      actor: "SMOKE_USER",
      contract: "VAULT_PROXY",
      contractName: "YieldVault",
      method: "claim",
      args: { receiver: context.addresses.SMOKE_USER },
      events: ["WithdrawalClaimed"],
      traceFields: TRACE_FIELDS,
      expectedPostState: null,
      assertPre(snapshot) {
        if (bigint(snapshot.claimableAssets.SMOKE_USER) <= 0n) {
          throw new Error("SMOKE_USER has no claimable assets");
        }
      },
      reconcileSubmittedPostState: reconcileSmokeClaim,
      assertPost(snapshot) {
        assertEqual(snapshot.claimableAssets.SMOKE_USER, 0n, "post-claim SMOKE_USER claim");
      },
    },
  };
}

function parseScriptArgs(mode, argv) {
  const defaults = MODES[mode];
  if (!defaults) throw new Error(`Unknown runbook smoke mode ${mode}`);
  const parsed = parseArgs(argv);
  const allowed = new Set(["seed-manifest", "funding-manifest", "run-state", "evidence-output"]);
  const unknown = Object.keys(parsed).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown argument --${unknown[0]}`);
  return {
    seedManifest: path.resolve(parsed["seed-manifest"] || "yield-vault-seed-manifest.json"),
    fundingManifest: path.resolve(parsed["funding-manifest"] || "yield-vault-funding-manifest.json"),
    runState: path.resolve(parsed["run-state"] || defaults.runState),
    evidenceOutput: path.resolve(parsed["evidence-output"] || defaults.evidenceOutput),
  };
}

function evidenceRecord(entry, spec) {
  return {
    actor: entry.actor,
    contractName: spec.contractName,
    contractAddress: entry.contractAddress,
    method: entry.method,
    arguments: entry.arguments,
    transactionHash: entry.transactionHash,
    receipt: entry.receipt,
    events: entry.observedEvents || [],
    governanceIssueId: entry.governanceIssueId || null,
    governanceIssueCreatedEvent: entry.governanceIssueCreatedEvent || null,
    governanceApproval: entry.governanceApproval || null,
    governanceExecution: entry.governanceExecution || null,
    governanceExecutionReceipt: entry.governanceExecutionReceipt || null,
  };
}

function migrateSolidVmQueueRetention(context) {
  const entry = context.journal.state.checkpoints.smokeProcessQueue;
  const differences = entry && entry.postStateDifferences || [];
  if (!entry || entry.status !== "submitted" || !entry.economicExpectedPostState ||
      !differences.length || differences.some((difference) =>
        !/^requests\.\d+\.(exists|next|receiver)$/.test(difference.field))) {
    return false;
  }
  const observed = entry.latestObservedPostState;
  if (!observed || bigint(observed.queueHead) !== 0n || bigint(observed.queueTail) !== 0n ||
      Object.values(observed.requests || {}).some((request) => bigint(request.shares) !== 0n) ||
      Object.values(observed.requestOwner || {}).some((owner) =>
        normalizeAddress(owner) !== "0".repeat(40))) {
    return false;
  }
  delete entry.economicExpectedPostState;
  delete entry.expectedPostState;
  delete entry.postStateDifferences;
  delete entry.receiptEventReconciledAt;
  entry.reconciliationModelMigration = {
    type: "solidvm-cleared-request-retention",
    migratedAt: new Date().toISOString(),
    retainedFields: ["exists", "next", "receiver"],
    clearedFields: ["shares", "requestOwner", "activeRequestId", "queueHead", "queueTail"],
  };
  context.journal.save();
  return true;
}

async function buildContext(mode, args, scriptPath) {
  const defaults = MODES[mode];
  const seedManifest = readJson(args.seedManifest);
  const fundingManifest = readJson(args.fundingManifest);
  const actors = await authenticateActors(defaults.actorNames);
  const addresses = buildAddresses(
    seedManifest,
    fundingManifest,
    actors.OWNER.address,
    "pre-smoke"
  );
  addresses.VAULT_OWNER = normalizeAddress(env("VAULT_OWNER_ADDRESS"), "VAULT_OWNER_ADDRESS");
  for (const role of ["REWARD_DISTRIBUTOR", "SMOKE_USER"]) {
    assertEqual(addresses[role], actors[role].address, `${role} manifest address`);
  }
  const networkIdentity = await fetchExpectedTestnetNetwork(actors.OWNER.token);
  const ownerAuthority = mode === "smoke"
    ? await validateStorageOwnerAuthority(actors.OWNER, addresses.VAULT_OWNER)
    : null;
  const approverAuthority = mode === "smoke"
    ? await validateStorageOwnerAuthority(actors.APPROVER, ADMIN_REGISTRY)
    : null;
  if (mode === "smoke" && actors.OWNER.address === actors.APPROVER.address) {
    throw new Error("OWNER and APPROVER must be different AdminRegistry admins");
  }
  const assetContractName = process.env.ASSET_CONTRACT_NAME || "Token";
  return createContext({
    scriptName: defaults.scriptName,
    scriptPath,
    runStatePath: args.runState,
    actors,
    addresses,
    ownerAuthority,
    approverAuthority,
    registryScope: "manualRunbook",
    assetContractName,
    requestIds: [1, 2, 3, 4],
    networkIdentity,
    faultInjector: async () => {},
    configuration: {
      mode,
      addresses,
      ownerAuthority,
      approverAuthority,
      assetContractName,
      networkIdentity,
      seedManifestHash: hashFile(args.seedManifest),
      fundingManifestHash: hashFile(args.fundingManifest),
      commonHash: hashFile(path.join(__dirname, "common.js")),
      operationsHash: hashFile(__filename),
      evidenceOutput: args.evidenceOutput,
      constants: {
        rewardAllowance: REWARD_ALLOWANCE.toString(),
        smokeAmount: SMOKE_AMOUNT.toString(),
        queueBudget: QUEUE_BUDGET.toString(),
        neutralRate: RAY.toString(),
      },
    },
  });
}

async function run(mode, argv, scriptPath) {
  const args = parseScriptArgs(mode, argv);
  const context = await buildContext(mode, args, scriptPath);
  const specs = mode === "prepare" ? prepareSpecs(context) : smokeSpecs(context);
  const checkpoints = Object.keys(specs);
  await runWithJournal(context, async () => {
    if (mode === "smoke") migrateSolidVmQueueRetention(context);
    assertEqual(context.journal.state.scriptHash, context.scriptHash, "run-state script hash");
    assertEqual(context.journal.state.configHash, context.configHash, "run-state configuration hash");
    let start = checkpoints.findIndex((checkpoint) =>
      !context.journal.state.checkpoints[checkpoint] ||
      context.journal.state.checkpoints[checkpoint].status !== "confirmed");
    if (start < 0) start = checkpoints.length;
    if (start < checkpoints.length) {
      await assertResumeState(context, checkpoints[start], checkpoints, specs[checkpoints[start]]);
    }
    for (let index = start; index < checkpoints.length; index++) {
      const checkpoint = checkpoints[index];
      const next = checkpoints[index + 1] || "DONE";
      await executeCheckpoint(
        context,
        checkpoint,
        next,
        specs[checkpoint],
        Date.now() + POLL_LIMIT_MS
      );
    }
    context.journal.state.completed = true;
    context.journal.state.completedAt =
      context.journal.state.completedAt || new Date().toISOString();
    context.journal.save();
    const transactions = Object.fromEntries(checkpoints.map((checkpoint) => [
      checkpoint,
      evidenceRecord(context.journal.state.checkpoints[checkpoint], specs[checkpoint]),
    ]));
    const evidence = {
      schemaVersion: 1,
      type: `yield-vault-${mode}-transaction-evidence`,
      completed: true,
      network: context.networkIdentity,
      addresses: context.addresses,
      transactions,
    };
    if (mode === "smoke") evidence.smokeTransactions = Object.values(transactions);
    atomicWrite(args.evidenceOutput, evidence);
  });
  console.log(
    `YIELD_VAULT_${mode.toUpperCase()}_COMPLETE ` +
    `runState=${args.runState} evidence=${args.evidenceOutput}`
  );
  return { runState: args.runState, evidenceOutput: args.evidenceOutput };
}

module.exports = {
  QUEUE_BUDGET,
  REWARD_ALLOWANCE,
  SMOKE_AMOUNT,
  eventTimestampSeconds,
  reconcileSmokeClaim,
  reconcileSmokeDeposit,
  reconcileSmokeQueue,
  reconcileSmokeRequest,
  migrateSolidVmQueueRetention,
  parseScriptArgs,
  prepareSpecs,
  smokeSpecs,
  run,
};
