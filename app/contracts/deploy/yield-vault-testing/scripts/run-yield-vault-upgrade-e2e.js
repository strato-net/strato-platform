#!/usr/bin/env node

const path = require("path");
const axios = require("axios");
const {
  fetchExpectedTestnetNetwork,
  rootNodeUrl,
} = require("./runtime");
const {
  U,
  RAY,
  MAX_UINT256,
  MAX_RATE,
  POLL_LIMIT_MS,
  sleep,
  stableJson,
  hashFile,
  atomicWrite,
  readJson,
  parseArgs,
  env,
  normalizeAddress,
  bigint,
  authenticateActors,
  assertDistinctAddresses,
  latestBlock,
  assertEqual: commonAssertEqual,
  eventAttributes,
  assertEventValues: commonAssertEventValues,
  snapshotDiff,
  executeCheckpoint,
  assertResumeState,
  createContext,
  runWithJournal,
  loadFundingEvidence,
  CheckpointStop,
  readTokenBalances,
  actorEconomicDelta,
  remainingCheckpointRequirements,
  validateStorageOwnerAuthority,
  readAdminMembership,
  ADMIN_REGISTRY,
} = require("./common");
const { reviewedPolicyForNetwork } = require("./fee-policy");
const { readFeePolicyEvidence } = require("./fund-yield-vault-test-actors");

const SCRIPT_NAME = "run-yield-vault-upgrade-e2e";
const TX_HASH_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const SOURCE_HASH_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const ZERO_ADDRESS = "0".repeat(40);
const CHECKPOINTS = [
  "000", "100", "101", "102", "103", "200", "201", "202", "210", "211",
  "212", "213", "300", "400", "410", "411", "500", "501", "502", "503",
  "504", "505", "600", "601", "602", "603", "604", "605", "606", "607", "700",
];

const C = {
  REWARD_BUDGET: 30n * U,
  ACCRUAL_WAIT: 60n,
  CAROL_REDEEM: 25n * U,
  DAVE_DEPOSIT: 25n * U,
  DONATION: 5n * U,
  NEW_QUEUE_SHARES: 80n * U,
  PARTIAL_BUDGET: 10n * U,
};
const E2E_FUNDING_FLOWS = {
  "202": [{ actor: "STRATEGY", delta: -210n * U }],
  "210": [{ actor: "STRATEGY", delta: 80n * U }],
  "211": [{ actor: "STRATEGY", delta: -20n * U }],
  "213": [{ actor: "STRATEGY", delta: -60n * U }],
  "502": [{ actor: "DONOR", delta: -C.DONATION }],
  "504": [{ actor: "DAVE", delta: -C.DAVE_DEPOSIT }],
};
const FUNDING_PER_RUN = {
  STRATEGY: 30n * U,
  REWARD_DISTRIBUTOR: 30n * U,
  DONOR: 5n * U,
  DAVE: 25n * U,
};
const SMOKE_PROFILE = [
  {
    actor: "SMOKE_USER",
    method: "deposit",
    args: { assets: 10n * U, receiver: "SMOKE_USER" },
    events: ["Deposit", "Transfer"],
  },
  {
    actor: "SMOKE_USER",
    method: "redeemOrQueue",
    args: { shares: 10n * U, receiver: "SMOKE_USER", owner_: "SMOKE_USER" },
    events: ["WithdrawalRequested", "Transfer"],
  },
  {
    actor: "OWNER",
    method: "processQueue",
    args: { maxRequests: 3n, maxAssets: 160n * U },
    events: ["QueueProcessed"],
  },
  {
    actor: "SMOKE_USER",
    method: "claim",
    args: { receiver: "SMOKE_USER" },
    events: ["WithdrawalClaimed"],
  },
];
const EXACT_RESUME_CHECKPOINTS = [
  "100", "101", "201", "210", "211", "502", "503", "600", "603", "604", "607",
];
const DYNAMIC_RESUME_CHECKPOINTS = {
  "202": "returnCapital calls _accrue; lastAccrual uses the execution block timestamp",
  "212": "reportStrategyLoss calls _accrue; lastAccrual uses the execution block timestamp",
  "213": "returnCapital calls _accrue; lastAccrual uses the execution block timestamp",
  "300": "redeem calls _accrue; lastAccrual uses the execution block timestamp",
  "400": "rate configuration sets lastAccrual to the execution block timestamp",
  "410": "accrual timestamp and credited amount are execution-time values",
  "411": "rate configuration settles execution-time accrual and timestamp",
  "504": "deposit calls _accrue; lastAccrual uses the execution block timestamp",
  "505": "redeem calls _accrue; lastAccrual uses the execution block timestamp",
  "601": "redeemOrQueue calls _accrue; lastAccrual uses the execution block timestamp",
  "602": "processQueue calls _accrue; lastAccrual uses the execution block timestamp",
  "605": "returnCapital calls _accrue; lastAccrual uses the execution block timestamp",
  "606": "processQueue calls _accrue; lastAccrual uses the execution block timestamp",
};
const ONLY_OWNER = Object.freeze({
  onlyOwner: true,
  governed: true,
  registryContract: "YieldVault",
});

let assertionContext = null;
let assertionCheckpoint = "input";

function assertionId(label) {
  return `${assertionCheckpoint}.${String(label).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}`;
}

function recordAssertion(label, callback) {
  try {
    const value = callback();
    if (assertionContext) {
      assertionContext.journal.state.assertionResults[assertionId(label)] = true;
    }
    return value;
  } catch (error) {
    if (assertionContext) {
      assertionContext.journal.state.assertionResults[assertionId(label)] = false;
    }
    throw error;
  }
}

function assertEqual(actual, expected, label) {
  return recordAssertion(label, () => commonAssertEqual(actual, expected, label));
}

function assertCondition(condition, label, message) {
  return recordAssertion(label, () => {
    if (!condition) throw new Error(message || label);
  });
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value == null ? undefined : value[key], object);
}

function assertSnapshot(snapshot, expected, prefix = "state") {
  for (const [key, expectedValue] of Object.entries(expected)) {
    assertEqual(getPath(snapshot, key), expectedValue, `${prefix}.${key}`);
  }
}

function assertEventValues(events, eventName, expected) {
  return recordAssertion(
    `${eventName} event ${Object.keys(expected).join(",")}`,
    () => commonAssertEventValues(events, eventName, expected)
  );
}

const TRACE_FIELDS = [
  "implementation", "paused", "decimals", "lastAccrual", "idle", "deployedAssets", "accountedAssets",
  "totalAssets", "activeAssets", "totalSupply", "exchangeRate", "perSecondSavingsRate",
  "freeIdleForInstantWithdrawals", "freeIdleForQueueProcessing", "maxDeploy",
  "totalQueuedShares", "totalClaimableAssets", "strategyDebt.STRATEGY",
  "shares.ALICE", "shares.BOB", "shares.CAROL",
  "shares.DAVE", "shares.VAULT_PROXY", "claimableAssets.ALICE", "claimableAssets.BOB",
  "underlying.REWARD_DISTRIBUTOR",
];

function usage() {
  console.error(
    "Usage: node run-yield-vault-upgrade-e2e.js " +
    "--seed-manifest <path> --funding-manifest <path> --runbook-report <path> --run-state <path> " +
    "[--checkpoint <CHECKPOINT_ID>]"
  );
}

function assertAtLeast(actual, minimum, label) {
  assertCondition(
    bigint(actual) >= bigint(minimum),
    label,
    `${label}: expected at least ${minimum}, observed ${actual}`
  );
}

function assertCore(snapshot) {
  assertEqual(
    snapshot.deployedAssets,
    bigint(snapshot.strategyDebt.STRATEGY),
    "deployed assets equal checked strategy debt"
  );
  assertEqual(
    snapshot.totalAssets,
    bigint(snapshot.idle) + bigint(snapshot.deployedAssets),
    "total assets identity"
  );
  assertEqual(snapshot.totalAssets, snapshot.accountedAssets, "accounted assets identity");
  assertEqual(
    snapshot.totalClaimableAssets,
    ["ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
      "REWARD_DISTRIBUTOR", "DAVE", "DONOR", "SMOKE_USER"]
      .reduce((sum, actor) => sum + bigint(snapshot.claimableAssets[actor] || 0), 0n),
    "checked claims identity"
  );
  assertEqual(
    snapshot.totalQueuedShares,
    Object.values(snapshot.requests || {}).reduce(
      (sum, request) => sum + (request && request.exists ? bigint(request.shares) : 0n),
      0n
    ),
    "queued shares equal live request sum"
  );
  assertCondition(
    bigint(snapshot.idle) >= bigint(snapshot.totalClaimableAssets),
    "idle covers claims",
    `idle ${snapshot.idle} is below claims ${snapshot.totalClaimableAssets}`
  );
  if (snapshot.liveViews) {
    assertEqual(snapshot.liveViews.totalAssets, snapshot.totalAssets, "live totalAssets view");
    assertEqual(snapshot.liveViews.activeAssets, snapshot.activeAssets, "live activeAssets view");
    assertEqual(snapshot.liveViews.exchangeRate, snapshot.exchangeRate, "live exchangeRate view");
    assertEqual(
      snapshot.liveViews.freeIdleForQueueProcessing,
      snapshot.freeIdleForQueueProcessing,
      "live free idle queue view"
    );
    const economic = bigint(snapshot.totalAssets);
    const accounted = bigint(snapshot.accountedAssets);
    const reconciled = economic < accounted ? economic : accounted;
    const reconciledActive = reconciled > bigint(snapshot.totalClaimableAssets)
      ? reconciled - bigint(snapshot.totalClaimableAssets)
      : 0n;
    const projectedActive = reconciledActive + snapshot.liveViews.pendingAccrual.funded;
    const expectedFreeInstant = bigint(snapshot.queueHead) !== 0n ||
      projectedActive <= bigint(snapshot.deployedAssets)
      ? 0n
      : projectedActive - bigint(snapshot.deployedAssets);
    assertEqual(
      snapshot.liveViews.freeIdleForInstantWithdrawals,
      expectedFreeInstant,
      "live free idle instant view"
    );
    assertEqual(snapshot.liveViews.maxDeploy, snapshot.maxDeploy, "live maxDeploy view");
    if (assertionContext) {
      const viewEvidence = ensureDerived(assertionContext).viewEvidence;
      viewEvidence[assertionCheckpoint] = {
        ...(viewEvidence[assertionCheckpoint] || {}),
        blockBefore: snapshot.liveViews.blockBefore,
        blockAfter: snapshot.liveViews.blockAfter,
        totalAssets: snapshot.liveViews.totalAssets.toString(),
        activeAssets: snapshot.liveViews.activeAssets.toString(),
        exchangeRate: snapshot.liveViews.exchangeRate.toString(),
        freeIdleForInstantWithdrawals:
          snapshot.liveViews.freeIdleForInstantWithdrawals.toString(),
        freeIdleForQueueProcessing:
          snapshot.liveViews.freeIdleForQueueProcessing.toString(),
        maxDeploy: snapshot.liveViews.maxDeploy.toString(),
        pendingAccrual: {
          target: snapshot.liveViews.pendingAccrual.target.toString(),
          funded: snapshot.liveViews.pendingAccrual.funded.toString(),
        },
      };
    }
  }
}

function tx(name, actor, contract, contractName, method, args, events = [], access = {}) {
  return {
    name,
    actor,
    contract,
    contractName,
    method,
    args,
    events,
    ...access,
    traceFields: TRACE_FIELDS,
  };
}

function observed(name, actor, assertion, rules = []) {
  return {
    name,
    actor,
    noTransaction: true,
    traceFields: TRACE_FIELDS,
    postRules: rules,
    assertPost: assertion,
  };
}

function reportField(report, names) {
  for (const name of names) {
    const value = name.split(".").reduce((current, key) => current && current[key], report);
    if (value != null) return value;
  }
  return null;
}

async function authenticatedGet(url, tokenObj, params) {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params,
  });
  return response.data;
}

async function fetchNetworkIdentity(tokenObj, get = authenticatedGet) {
  return fetchExpectedTestnetNetwork(tokenObj, async () =>
    get(`${rootNodeUrl()}/strato-api/eth/v1.2/metadata`, tokenObj)
  );
}

function validateManifestNetworkIdentity(label, manifest, networkIdentity) {
  const validation = {};
  const networkId = reportField(manifest, ["network.networkID", "network.networkId"]);
  const networkName = reportField(manifest, ["network.networkName", "network.name"]);
  if (networkId != null) {
    assertEqual(String(networkId), networkIdentity.networkID, `${label} network ID`);
    validation[`${label}.networkID`] = true;
  }
  if (networkName != null) {
    assertEqual(String(networkName), networkIdentity.networkName, `${label} network name`);
    validation[`${label}.networkName`] = true;
  }
  return validation;
}

function validateFundingManifest(fundingEvidence, addresses, seedManifest, networkIdentity) {
  const manifest = fundingEvidence.manifest;
  if (manifest.schemaVersion !== 2) {
    throw new Error("Funding manifest schemaVersion must be 2");
  }
  if (!manifest.network || manifest.network.networkID == null ||
      manifest.network.networkName == null || !manifest.network.nodeUrl) {
    throw new Error("Funding manifest network identity is incomplete");
  }
  const validation = networkIdentity
    ? validateManifestNetworkIdentity("funding", manifest, networkIdentity)
    : {};
  if (manifest.completed !== true ||
      manifest.allPlannedMintsConfirmed !== true ||
      manifest.allFinalAssertionsConfirmed !== true) {
    throw new Error("Funding manifest completion assertions are not all true");
  }
  if (!Array.isArray(manifest.mintPlan) || !Array.isArray(manifest.transactions) ||
      manifest.transactions.length !== manifest.mintPlan.length ||
      manifest.transactions.length === 0) {
    throw new Error("Funding manifest transactions must exactly match the non-empty mint plan");
  }
  manifest.transactions.forEach((transaction, index) => {
    const confirmedHash = transaction && transaction.receipt && (
      transaction.receipt.hash || transaction.receipt.transactionHash ||
      transaction.receipt.transaction_hash || transaction.receipt.txHash
    );
    if (!transaction || !transaction.transactionHash ||
        !transaction.receipt || transaction.receipt.status !== "Success" ||
        String(confirmedHash || "").replace(/^0x/, "").toLowerCase() !==
          String(transaction.transactionHash).replace(/^0x/, "").toLowerCase()) {
      throw new Error(`Funding manifest transaction ${index + 1} is not confirmed successful`);
    }
  });
  validation["funding.completed"] = true;
  validation["funding.allTransactionsSuccessful"] = true;
  const runs = bigint(reportField(manifest, ["runs", "requestedRuns", "configuration.runs"]) || 0);
  if (runs < 10n) throw new Error(`Funding manifest covers only ${runs} runs`);
  assertEqual(String(runs), String(seedManifest.fundingRequestedRuns), "funding run count");
  validation["funding.runCount"] = true;
  const asset = reportField(manifest, [
    "tokens.asset.address", "asset.address", "addresses.ASSET", "assetAddress",
    "configuration.asset",
  ]);
  assertEqual(normalizeAddress(asset, "funding asset"), addresses.ASSET, "funding asset");
  validation["funding.assetAddress"] = true;
  assertEqual(
    String(manifest.network && manifest.network.nodeUrl).replace(/\/$/, ""),
    rootNodeUrl(),
    "funding network"
  );
  validation["funding.network"] = true;
  const manifestActors = manifest.actors || {};
  for (const actor of [
    "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
    "SMOKE_USER", "REWARD_DISTRIBUTOR", "DONOR", "DAVE",
  ]) {
    if (!manifestActors[actor]) throw new Error(`Funding manifest is missing actor ${actor}`);
    const actorAddress = typeof manifestActors[actor] === "object"
      ? manifestActors[actor].address
      : manifestActors[actor];
    assertEqual(
      normalizeAddress(actorAddress, `funding ${actor}`),
      addresses[actor],
      `funding ${actor}`
    );
  }
  if (manifestActors.STRATEGY_A !== undefined || manifestActors.STRATEGY_B !== undefined) {
    throw new Error("Funding manifest must use singular STRATEGY");
  }
  validation["funding.actorAddresses"] = true;

  const perRun = manifest.budgets && manifest.budgets.perRunUnderlying;
  const targets = manifest.budgets && manifest.budgets.computedUnderlyingByRole;
  const finalBalances = manifest.final && manifest.final.balances;
  if (!perRun || !targets || !finalBalances) {
    throw new Error(
      "Funding manifest must include per-run budgets, underlying targets, and final balances"
    );
  }
  for (const [name, value] of Object.entries({
    noUnexpectedUnderlyingRecipients:
      reportField(manifest, ["assertions.noUnexpectedUnderlyingRecipients"]),
    exactTransferEventsVerified:
      reportField(manifest, ["assertions.exactTransferEventsVerified"]),
  })) {
    if (value != null && value !== true) {
      throw new Error(`Funding manifest assertion ${name} did not pass`);
    }
    if (value === true) validation[`funding.${name}`] = true;
  }
  for (const [actor, perRunAmount] of Object.entries(FUNDING_PER_RUN)) {
    const target = perRunAmount * runs;
    if (perRun[actor] == null) throw new Error(`Funding budget is missing ${actor}`);
    assertEqual(perRun[actor], perRunAmount, `funding ${actor} per-run budget`);
    validation[`funding.${actor}.perRunBudget`] = true;
    if (targets[actor] == null) throw new Error(`Funding target is missing ${actor}`);
    assertEqual(targets[actor], target, `funding ${actor} target`);
    validation[`funding.${actor}.target`] = true;
    const finalBalance = finalBalances[`${addresses.ASSET}:${addresses[actor]}`];
    if (finalBalance == null) {
      throw new Error(`Funding final balance is missing ${actor}`);
    }
    assertAtLeast(finalBalance, target, `funding ${actor} final balance`);
    validation[`funding.${actor}.finalBalance`] = true;
  }
  const feeToken = normalizeAddress(manifest.addresses.FEE_TOKEN, "funding fee token");
  assertEqual(feeToken, normalizeAddress(env("FEE_TOKEN_ADDRESS")), "configured fee token");
  const feeTargets = manifest.budgets && manifest.budgets.computedFeeByRole;
  for (const actor of [
    "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "REWARD_DISTRIBUTOR", "DAVE", "DONOR",
  ]) {
    if (!feeTargets || feeTargets[actor] == null) {
      throw new Error(`Funding fee target is missing ${actor}`);
    }
    const finalBalance = finalBalances[`${feeToken}:${addresses[actor]}`];
    if (finalBalance == null) throw new Error(`Funding final fee balance is missing ${actor}`);
    assertAtLeast(finalBalance, feeTargets[actor], `funding ${actor} final fee balance`);
    if (feeToken === addresses.ASSET && targets[actor] != null) {
      assertAtLeast(
        finalBalance,
        bigint(feeTargets[actor]) + bigint(targets[actor]),
        `funding ${actor} combined final balance`
      );
    }
    validation[`funding.${actor}.feeTargetAndFinalBalance`] = true;
  }
  return validation;
}

function requireNestedKeys(value, keys, label) {
  for (const key of keys) {
    if (getPath(value, key) == null) throw new Error(`${label} is missing ${key}`);
  }
}

function smokeActorMatches(value, role, addresses) {
  const actor = value && typeof value === "object"
    ? value.role || value.name || value.address
    : value;
  if (String(actor || "").toUpperCase() === role) return true;
  try {
    return normalizeAddress(actor, "smoke actor") === addresses[role];
  } catch (_) {
    return false;
  }
}

function smokeEventNames(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => typeof event === "string"
    ? event
    : event && (event.eventName || event.event_name || event.name)).filter(Boolean);
}

function validateSmokeTransactions(smokeTransactions, addresses) {
  if (!Array.isArray(smokeTransactions) || smokeTransactions.length !== SMOKE_PROFILE.length) {
    throw new Error("Runbook report must include four ordered structured smoke transaction records");
  }
  const hashes = new Set();
  for (let index = 0; index < SMOKE_PROFILE.length; index++) {
    const expected = SMOKE_PROFILE[index];
    const entry = smokeTransactions[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Smoke transaction ${index + 1} lacks structured proof`);
    }
    const operation = entry.operation && typeof entry.operation === "object"
      ? entry.operation
      : entry;
    const hash = entry.executionTransactionHash || entry.transactionHash || entry.hash ||
      operation.transactionHash || operation.hash;
    if (!TX_HASH_RE.test(String(hash || ""))) {
      throw new Error(`Malformed smoke transaction ID: ${stableJson(entry)}`);
    }
    const normalizedHash = String(hash).toLowerCase().replace(/^0x/, "");
    if (hashes.has(normalizedHash)) {
      throw new Error(`Smoke transaction ${index + 1} reuses an earlier transaction ID`);
    }
    hashes.add(normalizedHash);
    const receipt = entry.executionReceipt || entry.receipt;
    const receiptHash = receipt && (
      receipt.transaction_hash || receipt.transactionHash ||
      receipt.txHash || receipt.hash
    );
    const txResultHash = receipt && receipt.txResult &&
      receipt.txResult.transactionHash;
    if (!receipt || receipt.status !== "Success" ||
        String(receiptHash || "").toLowerCase().replace(/^0x/, "") !== normalizedHash ||
        String(txResultHash || "").toLowerCase().replace(/^0x/, "") !== normalizedHash) {
      throw new Error(`Smoke transaction ${index + 1} receipt evidence is incomplete`);
    }
    if (!smokeActorMatches(
      entry.actor || entry.actorRole || entry.actorAddress || operation.actor,
      expected.actor,
      addresses
    )) {
      throw new Error(`Smoke transaction ${index + 1} has the wrong actor`);
    }
    const method = entry.method || operation.method;
    if (method !== expected.method) {
      throw new Error(
        `Smoke transaction ${index + 1} expected method ${expected.method}, observed ${method}`
      );
    }
    const args = entry.arguments || entry.args || operation.arguments || operation.args;
    if (!args || typeof args !== "object") {
      throw new Error(`Smoke transaction ${index + 1} is missing arguments`);
    }
    for (const [name, expectedValue] of Object.entries(expected.args)) {
      if (typeof expectedValue === "bigint") {
        assertEqual(
          bigint(args[name], `smoke ${index + 1} argument ${name}`),
          expectedValue,
          `smoke ${index + 1} argument ${name}`
        );
      } else {
        const expectedAddress = addresses[expectedValue];
        if (!smokeActorMatches(args[name], expectedValue, addresses) &&
            normalizeAddress(args[name], `smoke ${index + 1} ${name}`) !== expectedAddress) {
          throw new Error(`Smoke transaction ${index + 1} has the wrong ${name}`);
        }
      }
    }
    const eventRecords =
      entry.events || entry.observedEvents || operation.events || operation.observedEvents;
    if (!Array.isArray(eventRecords) || eventRecords.length === 0 ||
        eventRecords.some((event) => !event || typeof event !== "object" || Array.isArray(event))) {
      throw new Error(`Smoke transaction ${index + 1} requires structured event records`);
    }
    for (const event of eventRecords) {
      const eventHash =
        event.transaction_hash || event.transactionHash || event.txHash || event.hash;
      const eventTimestamp =
        event.block_timestamp || event.blockTimestamp || event.timestamp;
      if (String(eventHash || "").toLowerCase().replace(/^0x/, "") !== normalizedHash ||
          !eventTimestamp ||
          event.id == null && event.event_index == null && event.eventIndex == null) {
        throw new Error(`Smoke transaction ${index + 1} event evidence is incomplete`);
      }
    }
    const observedEvents = new Set(smokeEventNames(eventRecords));
    for (const eventName of expected.events) {
      if (!observedEvents.has(eventName)) {
        throw new Error(`Smoke transaction ${index + 1} is missing ${eventName} event proof`);
      }
    }
    if (expected.method === "processQueue") {
      const queueEvents = eventRecords.filter((event) =>
        (event.eventName || event.event_name || event.name) === "QueueProcessed");
      if (queueEvents.length !== 3 || queueEvents.some((event) => {
        const attributes = event.attributes;
        return event.event_index == null && event.eventIndex == null ||
          !attributes || attributes.sharesBurned == null ||
          bigint(attributes.sharesBurned, "QueueProcessed.sharesBurned") <= 0n;
      })) {
        throw new Error(
          `Smoke transaction ${index + 1} must prove three indexed QueueProcessed events`
        );
      }
    }
  }
}

function parseRunbookReport(report) {
  if (report.schemaVersion !== 1 || report.type !== "yield-vault-safe-upgrade") {
    throw new Error("Runbook report has an unsupported schema or type");
  }
  const newImplementation = reportField(report, [
    "addresses.NEW_IMPLEMENTATION", "NEW_IMPLEMENTATION", "newImplementation",
  ]);
  const sourceHash = reportField(report, [
    "reviewedSourceHash", "sourceHash", "reviewedSourceCommit", "sourceCommit",
  ]);
  const finalSnapshot = reportField(report, [
    "finalSnapshot", "finalRunbookSnapshot", "snapshots.final",
  ]);
  if (!newImplementation || !sourceHash || !finalSnapshot) {
    throw new Error(
      "Runbook report must contain NEW_IMPLEMENTATION, reviewed source hash/commit, and final snapshot"
    );
  }
  if (!SOURCE_HASH_RE.test(String(sourceHash))) {
    throw new Error("Reviewed source hash must be a 64-character hexadecimal hash");
  }
  const expectedSourceHash = env("EXPECTED_REVIEWED_SOURCE_HASH");
  if (!SOURCE_HASH_RE.test(expectedSourceHash)) {
    throw new Error("EXPECTED_REVIEWED_SOURCE_HASH must be a 64-character hexadecimal hash");
  }
  assertEqual(
    String(sourceHash).toLowerCase().replace(/^0x/, ""),
    expectedSourceHash.toLowerCase().replace(/^0x/, ""),
    "independent reviewed source hash"
  );
  if (report.completed !== true || report.checksPassed === false) {
    throw new Error("Runbook report must explicitly set completed=true");
  }
  const seedStatePreserved = report.seedStatePreserved === true ||
    report.checks && report.checks.seedStatePreserved === true;
  if (!seedStatePreserved) throw new Error("Runbook report must prove seedStatePreserved=true");
  const requiredAssertions = [
    "schemaComplete",
    "sourceBoundToReviewedHash",
    "implementationDeploymentVerified",
    "proxyPointerGovernanceVerified",
    "manualRawTransactionsVerified",
    "globalEventsVerified",
    "smokeApprovalVerified",
    "fourEconomicSmokeTransactionsVerified",
    "preUnpauseSafetyVerified",
    "noUnexpectedStrayAssetsRemoved",
    "chronologicalOrderVerified",
    "seedStatePreserved",
    "liveFinalSnapshotCaptured",
    "rollbackPlanAvailable",
  ];
  for (const name of requiredAssertions) {
    if (!report.requirementAssertions ||
        report.requirementAssertions[name] !== true) {
      throw new Error(`Runbook report mandatory assertion ${name} did not pass`);
    }
  }
  const externalHashes = report.externalTransactionHashes;
  if (!externalHashes ||
      !TX_HASH_RE.test(String(externalHashes.implementationDeploymentSubmission || "")) ||
      !TX_HASH_RE.test(String(externalHashes.pointerSubmission || "")) ||
      !externalHashes.manual ||
      !TX_HASH_RE.test(String(externalHashes.manual.smokeUserApproval || "")) ||
      !Array.isArray(externalHashes.smoke) ||
      externalHashes.smoke.length !== 4 ||
      externalHashes.smoke.some((value) => !TX_HASH_RE.test(String(value || "")))) {
    throw new Error("Runbook report is missing mandatory external transaction hashes");
  }
  for (const value of [
    externalHashes.implementationDeploymentExecution,
    externalHashes.pointerExecution,
  ]) {
    if (value != null && !TX_HASH_RE.test(String(value))) {
      throw new Error("Runbook report contains a malformed governance execution hash");
    }
  }
  const sourceEvidence = report.sourceEvidence || {};
  if (sourceEvidence.combinedSourceHash !== sourceEvidence.reviewedSourceHash ||
      sourceEvidence.reviewedSourceHash !==
        sourceEvidence.independentlyExpectedSourceHash ||
      sourceEvidence.reviewedSourceHash !== sourceHash) {
    throw new Error("Runbook source evidence is not bound to the independent hash");
  }
  if (!report.rollback ||
      normalizeAddress(report.rollback.oldImplementation, "rollback old implementation") !==
        normalizeAddress(report.addresses.OLD_IMPLEMENTATION, "OLD_IMPLEMENTATION") ||
      report.rollback.guardedWorkflowAvailable !== true ||
      report.rollback.drill != null &&
        (typeof report.rollback.drill !== "object" ||
          !report.rollback.drill.validation ||
          report.rollback.drill.validation.validated !== true)) {
    throw new Error("Runbook report has an invalid rollback plan or drill");
  }
  if (!Array.isArray(report.orderedBlockEvidence) ||
      report.orderedBlockEvidence.length < 18) {
    throw new Error("Runbook report is missing ordered block evidence");
  }
  for (const key of [
    "implementation", "owner", "proxyOwner", "asset", "name", "symbol", "paused",
    "decimals", "vaultInitialized", "accrualInitialized",
    "perSecondSavingsRate", "lastAccrual", "rewardDistributor", "accountedAssets", "idle",
    "deployedAssets", "totalAssets", "activeAssets", "totalSupply", "exchangeRate",
    "freeIdleForInstantWithdrawals", "freeIdleForQueueProcessing", "maxDeploy",
    "minIdleBps", "nextRequestId", "queueHead", "queueTail", "totalQueuedShares",
    "totalClaimableAssets", "shares", "strategyDebt", "approvedStrategies",
    "activeRequestId", "claimableAssets", "requests", "requestOwner",
    "underlying", "allowances",
  ]) {
    if (finalSnapshot[key] == null) {
      throw new Error(`Runbook final snapshot is missing ${key}`);
    }
  }
  requireNestedKeys(finalSnapshot, [
    "shares.ALICE", "shares.BOB", "shares.CAROL", "shares.SMOKE_USER",
    "shares.VAULT_PROXY",
    "strategyDebt.STRATEGY",
    "strategyDebt.REWARD_DISTRIBUTOR",
    "approvedStrategies.STRATEGY",
    "activeRequestId.ALICE", "activeRequestId.BOB", "activeRequestId.SMOKE_USER",
    "claimableAssets.ALICE", "claimableAssets.BOB", "claimableAssets.SMOKE_USER",
    "requests.1.shares", "requests.1.receiver", "requests.1.next", "requests.1.exists",
    "requests.2.shares", "requests.2.receiver", "requests.2.next", "requests.2.exists",
    "requests.3.shares", "requests.3.receiver", "requests.3.next", "requests.3.exists",
    "requestOwner.1", "requestOwner.2", "requestOwner.3",
    "underlying.REWARD_DISTRIBUTOR", "allowances.REWARD_DISTRIBUTOR",
  ], "Runbook final snapshot");
  const upgradeTransactionHash = reportField(report, [
    "upgradeTransactionHash", "upgrade.transactionHash", "transactions.upgrade.transactionHash",
  ]);
  if (!upgradeTransactionHash) throw new Error("Runbook report is missing the upgrade transaction hash");
  if (!TX_HASH_RE.test(String(upgradeTransactionHash))) {
    throw new Error("Runbook upgrade transaction hash is malformed");
  }
  const deploymentSigner = normalizeAddress(
    reportField(report, ["actors.DEPLOYER"]),
    "runbook DEPLOYER signer"
  );
  const pointerSigner = normalizeAddress(
    reportField(report, ["actors.OWNER"]),
    "runbook OWNER signer"
  );
  const vaultOwner = normalizeAddress(
    reportField(report, ["actors.VAULT_OWNER"]),
    "runbook VAULT_OWNER"
  );
  const signerRecords = report.signers || {};
  if (deploymentSigner === pointerSigner ||
      !signerRecords.deployment || signerRecords.deployment.role !== "DEPLOYER" ||
      normalizeAddress(signerRecords.deployment.address, "deployment signer record") !==
        deploymentSigner ||
      typeof signerRecords.deployment.username !== "string" ||
      !signerRecords.deployment.username ||
      !signerRecords.pointer || signerRecords.pointer.role !== "OWNER" ||
      normalizeAddress(signerRecords.pointer.address, "pointer signer record") !==
        pointerSigner ||
      typeof signerRecords.pointer.username !== "string" ||
      !signerRecords.pointer.username) {
    throw new Error("Runbook report does not preserve DEPLOYER/OWNER signer separation");
  }
  if (vaultOwner === ADMIN_REGISTRY) {
    for (const [role, authority, signer] of [
      ["DEPLOYER", report.deployerAuthority, deploymentSigner],
      ["OWNER", report.ownerAuthority, pointerSigner],
    ]) {
      if (!authority || authority.mode !== "admin-registry" ||
          authority.verified !== true ||
          normalizeAddress(authority.signer, `${role} authority signer`) !== signer ||
          normalizeAddress(authority.adminRegistry, `${role} authority registry`) !==
            ADMIN_REGISTRY ||
          bigint(authority.adminMapMembership, `${role} authority membership`) <= 0n) {
        throw new Error(`Runbook report has incomplete ${role} AdminRegistry authority`);
      }
    }
  }
  const smokeTransactions = report.smokeTransactions ||
    report.transactions && report.transactions.smoke;
  const smokeAddresses = {
    OWNER: normalizeAddress(
      reportField(report, ["actors.OWNER", "OWNER", "operatorSigner"]),
      "runbook OWNER signer"
    ),
    SMOKE_USER: normalizeAddress(
      reportField(report, ["actors.SMOKE_USER", "SMOKE_USER", "smokeUser"]),
      "SMOKE_USER"
    ),
  };
  validateSmokeTransactions(smokeTransactions, smokeAddresses);
  return {
    newImplementation: normalizeAddress(newImplementation, "NEW_IMPLEMENTATION"),
    sourceHash: String(sourceHash),
    finalSnapshot,
    smokeTransactions,
    upgradeTransactionHash,
    governanceIssueId: report.governanceIssueId || null,
    externalTransactionHashes: externalHashes,
    requirementAssertions: report.requirementAssertions,
    assertions: {
      "runbook.schemaAndType": true,
      "runbook.completed": true,
      "runbook.seedStatePreserved": true,
      "runbook.completeFinalSnapshot": true,
      "runbook.upgradeTransactionHash": true,
      "runbook.reviewedSourceHash": true,
      "runbook.structuredSmokeEvidence": true,
    },
  };
}

function assertSnapshotSubset(actual, expected, prefix = "runbookFinalSnapshot") {
  return recordAssertion(prefix, () => {
    const failures = [];
    function compare(observed, wanted, location) {
      if (wanted && typeof wanted === "object" && !Array.isArray(wanted)) {
        for (const [key, value] of Object.entries(wanted)) {
          compare(observed && observed[key], value, `${location}.${key}`);
        }
        return;
      }
      const observedValue = typeof observed === "bigint" ? observed.toString() : observed;
      const wantedValue = typeof wanted === "bigint" ? wanted.toString() : wanted;
      if (stableJson(observedValue) !== stableJson(wantedValue)) {
        failures.push(`${location}: expected ${stableJson(wantedValue)}, observed ${stableJson(observedValue)}`);
      }
    }
    compare(actual, expected, prefix);
    if (failures.length) {
      throw new Error(`Live state differs from runbook report:\n${failures.join("\n")}`);
    }
  });
}

function rpow(x, n, base) {
  if (x === 0n) return n === 0n ? base : 0n;
  let z = n % 2n === 0n ? base : x;
  const half = base / 2n;
  for (n /= 2n; n > 0n; n /= 2n) {
    x = (x * x + half) / base;
    if (n % 2n === 1n) z = (z * x + half) / base;
  }
  return z;
}

function projectedAccrual(snapshot, blockTimestamp) {
  const last = bigint(snapshot.lastAccrual);
  const now = bigint(blockTimestamp);
  if (now <= last || bigint(snapshot.perSecondSavingsRate) <= RAY ||
      snapshot.rewardDistributor === "0".repeat(40) || bigint(snapshot.totalSupply) === 0n) {
    return { elapsed: now > last ? now - last : 0n, target: 0n, funded: 0n };
  }
  const economic = bigint(snapshot.totalAssets);
  const accounted = bigint(snapshot.accountedAssets);
  const reconciled = economic > accounted ? accounted : economic;
  const active = reconciled > bigint(snapshot.totalClaimableAssets)
    ? reconciled - bigint(snapshot.totalClaimableAssets)
    : 0n;
  const elapsed = now - last;
  const target = active * (rpow(bigint(snapshot.perSecondSavingsRate), elapsed, RAY) - RAY) / RAY;
  let funded = bigint(snapshot.underlying.REWARD_DISTRIBUTOR);
  const allowance = bigint(snapshot.allowances.REWARD_DISTRIBUTOR);
  if (funded > allowance) funded = allowance;
  if (funded > target) funded = target;
  return { elapsed, target, funded };
}

function ceilDiv(a, b) {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

function eventTimestampSeconds(event) {
  const value = event.block_timestamp || event.blockTimestamp || event.timestamp;
  if (/^\d+$/.test(String(value || ""))) return bigint(value);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid event block timestamp ${value}`);
  return BigInt(Math.floor(milliseconds / 1000));
}

function previewDeposit(snapshot, assets) {
  const supply = bigint(snapshot.totalSupply);
  const base = bigint(snapshot.accountedAssets) - bigint(snapshot.totalClaimableAssets);
  return supply === 0n ? assets : assets * supply / base;
}

function previewRedeem(snapshot, shares) {
  const supply = bigint(snapshot.totalSupply);
  const base = bigint(snapshot.accountedAssets) - bigint(snapshot.totalClaimableAssets);
  return supply === 0n ? shares : shares * base / supply;
}

function previewWithdraw(snapshot, assets) {
  const supply = bigint(snapshot.totalSupply);
  const base = bigint(snapshot.accountedAssets) - bigint(snapshot.totalClaimableAssets);
  return supply === 0n ? assets : ceilDiv(assets * supply, base);
}

function maxRedeemFor(snapshot, actor) {
  if (snapshot.paused) return 0n;
  const ownerShares = bigint(snapshot.shares[actor] || 0);
  const freeIdle = bigint(snapshot.freeIdleForInstantWithdrawals);
  const supply = bigint(snapshot.totalSupply);
  const base = bigint(snapshot.accountedAssets) - bigint(snapshot.totalClaimableAssets);
  const idleShares = supply === 0n || base === 0n ? freeIdle : freeIdle * supply / base;
  return ownerShares < idleShares ? ownerShares : idleShares;
}

function maxDeploy(snapshot) {
  if (snapshot.paused || bigint(snapshot.queueHead) !== 0n) return 0n;
  const freeIdle = bigint(snapshot.idle) - bigint(snapshot.totalClaimableAssets);
  const minimum = ceilDiv(
    bigint(snapshot.activeAssets) * bigint(snapshot.minIdleBps),
    10_000n
  );
  return freeIdle > minimum ? freeIdle - minimum : 0n;
}

function cloneSnapshot(snapshot) {
  return JSON.parse(stableJson(snapshot));
}

function addSnapshotValue(container, key, delta) {
  container[key] = (bigint(container[key] || 0) + bigint(delta)).toString();
}

function refreshSnapshotDerived(snapshot) {
  const idle = bigint(snapshot.underlying.VAULT_PROXY);
  const deployed = bigint(snapshot.deployedAssets);
  const claims = bigint(snapshot.totalClaimableAssets);
  const totalAssets = idle + deployed;
  const activeAssets = totalAssets > claims ? totalAssets - claims : 0n;
  const supply = bigint(snapshot.totalSupply);
  const freeQueue = idle > claims ? idle - claims : 0n;
  const accounted = bigint(snapshot.accountedAssets);
  const reconciled = totalAssets < accounted ? totalAssets : accounted;
  const reconciledActive = reconciled > claims ? reconciled - claims : 0n;
  const freeInstant = bigint(snapshot.queueHead) !== 0n ||
    reconciledActive <= deployed ? 0n : reconciledActive - deployed;
  const minimumIdle = ceilDiv(activeAssets * bigint(snapshot.minIdleBps), 10_000n);
  const deployable = !snapshot.paused && bigint(snapshot.queueHead) === 0n &&
    freeQueue > minimumIdle ? freeQueue - minimumIdle : 0n;
  snapshot.idle = idle.toString();
  snapshot.totalAssets = totalAssets.toString();
  snapshot.activeAssets = activeAssets.toString();
  snapshot.exchangeRate = (supply === 0n ? U : activeAssets * U / supply).toString();
  snapshot.freeIdleForQueueProcessing = freeQueue.toString();
  snapshot.freeIdleForInstantWithdrawals = freeInstant.toString();
  snapshot.maxDeploy = deployable.toString();
  return snapshot;
}

function exactExpectedPost(mutator) {
  return (preState, context) => {
    if (bigint(preState.perSecondSavingsRate) !== RAY) {
      throw new Error("Exact expected post-state requires the neutral RAY accrual rate");
    }
    const expected = cloneSnapshot(preState);
    mutator(expected, preState, context);
    return refreshSnapshotDerived(expected);
  };
}

function applyClaimExpected(expected, actor, amount) {
  const assets = bigint(amount);
  assertEqual(expected.totalAssets, expected.accountedAssets, `${actor} claim has no stray assets`);
  addSnapshotValue(expected.underlying, actor, assets);
  addSnapshotValue(expected.underlying, "VAULT_PROXY", -assets);
  expected.claimableAssets[actor] = "0";
  addSnapshotValue(expected, "totalClaimableAssets", -assets);
  addSnapshotValue(expected, "accountedAssets", -assets);
}

function eventForReconciliation(events, name) {
  const event = (events || []).find((candidate) => candidate.eventName === name);
  if (!event) throw new Error(`Dynamic reconciliation is missing ${name}`);
  return event;
}

function spendExpectedAllowance(expected, actor, amount) {
  const allowance = bigint(expected.allowances[actor]);
  if (allowance !== MAX_UINT256) {
    addSnapshotValue(expected.allowances, actor, -bigint(amount));
  }
}

function syncExpectedAccounted(expected) {
  expected.accountedAssets = (
    bigint(expected.underlying.VAULT_PROXY) + bigint(expected.deployedAssets)
  ).toString();
}

function reconcileDynamicCheckpoint(checkpoint) {
  return ({ preState, events }, context) => {
    const expected = cloneSnapshot(preState);
    const derived = ensureDerived(context);
    const timestampEventName = {
      "202": "CapitalReturned",
      "212": "StrategyLossReported",
      "213": "CapitalReturned",
      "300": "Withdraw",
      "400": "PerSecondSavingsRateUpdated",
      "410": "Accrued",
      "411": "PerSecondSavingsRateUpdated",
      "504": "Deposit",
      "505": "Withdraw",
      "601": "WithdrawalRequested",
      "602": "QueueProcessed",
      "605": "CapitalReturned",
      "606": "QueueProcessed",
    }[checkpoint];
    expected.lastAccrual = eventTimestampSeconds(
      eventForReconciliation(events, timestampEventName)
    ).toString();

    switch (checkpoint) {
      case "202": {
        const assets = 210n * U;
        addSnapshotValue(expected.underlying, "STRATEGY", -assets);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", assets);
        spendExpectedAllowance(expected, "STRATEGY", assets);
        addSnapshotValue(expected.strategyDebt, "STRATEGY", -200n * U);
        addSnapshotValue(expected, "deployedAssets", -200n * U);
        syncExpectedAccounted(expected);
        break;
      }
      case "212":
        addSnapshotValue(expected.strategyDebt, "STRATEGY", -20n * U);
        addSnapshotValue(expected, "deployedAssets", -20n * U);
        syncExpectedAccounted(expected);
        break;
      case "213": {
        const assets = 60n * U;
        addSnapshotValue(expected.underlying, "STRATEGY", -assets);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", assets);
        spendExpectedAllowance(expected, "STRATEGY", assets);
        addSnapshotValue(expected.strategyDebt, "STRATEGY", -assets);
        addSnapshotValue(expected, "deployedAssets", -assets);
        syncExpectedAccounted(expected);
        break;
      }
      case "300": {
        const shares = C.CAROL_REDEEM;
        const assets = 24n * U;
        addSnapshotValue(expected.shares, "CAROL", -shares);
        addSnapshotValue(expected, "totalSupply", -shares);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", -assets);
        addSnapshotValue(expected.underlying, "CAROL", assets);
        addSnapshotValue(expected, "accountedAssets", -assets);
        break;
      }
      case "400":
        expected.perSecondSavingsRate = MAX_RATE.toString();
        break;
      case "410":
      case "411": {
        const accrued = (events || []).find((event) => event.eventName === "Accrued");
        const credited = accrued
          ? bigint(eventAttributes(accrued).creditedAmount, `${checkpoint} creditedAmount`)
          : 0n;
        if (checkpoint === "410" && credited <= 0n) {
          throw new Error("Checkpoint 410 reconciliation requires positive credited accrual");
        }
        if (credited > 0n) {
          addSnapshotValue(expected.underlying, "REWARD_DISTRIBUTOR", -credited);
          addSnapshotValue(expected.underlying, "VAULT_PROXY", credited);
          spendExpectedAllowance(expected, "REWARD_DISTRIBUTOR", credited);
          addSnapshotValue(expected, "accountedAssets", credited);
        }
        if (checkpoint === "411") expected.perSecondSavingsRate = RAY.toString();
        break;
      }
      case "504": {
        const shares = bigint(derived.DAVE_SHARES);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", -C.DONATION);
        addSnapshotValue(expected.underlying, "REWARD_DISTRIBUTOR", C.DONATION);
        addSnapshotValue(expected.underlying, "DAVE", -C.DAVE_DEPOSIT);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", C.DAVE_DEPOSIT);
        spendExpectedAllowance(expected, "DAVE", C.DAVE_DEPOSIT);
        addSnapshotValue(expected.shares, "DAVE", shares);
        addSnapshotValue(expected, "totalSupply", shares);
        addSnapshotValue(expected, "accountedAssets", C.DAVE_DEPOSIT);
        break;
      }
      case "505": {
        const shares = bigint(derived.DAVE_SHARES);
        const assets = bigint(derived.DAVE_ASSETS);
        addSnapshotValue(expected.shares, "DAVE", -shares);
        addSnapshotValue(expected, "totalSupply", -shares);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", -assets);
        addSnapshotValue(expected.underlying, "DAVE", assets);
        addSnapshotValue(expected, "accountedAssets", -assets);
        break;
      }
      case "601": {
        const requestId = "4";
        addSnapshotValue(expected.shares, "ALICE", -C.NEW_QUEUE_SHARES);
        addSnapshotValue(expected.shares, "VAULT_PROXY", C.NEW_QUEUE_SHARES);
        addSnapshotValue(expected, "totalQueuedShares", C.NEW_QUEUE_SHARES);
        expected.activeRequestId.ALICE = requestId;
        expected.queueHead = requestId;
        expected.queueTail = requestId;
        expected.nextRequestId = "5";
        expected.requests[requestId] = {
          shares: C.NEW_QUEUE_SHARES.toString(),
          receiver: context.addresses.ALICE,
          next: "0",
          exists: true,
        };
        expected.requestOwner[requestId] = context.addresses.ALICE;
        break;
      }
      case "602":
      case "606": {
        const processed = eventAttributes(eventForReconciliation(events, "QueueProcessed"));
        const burned = bigint(processed.sharesBurned, `${checkpoint} sharesBurned`);
        const reserved = bigint(processed.assetsReserved, `${checkpoint} assetsReserved`);
        addSnapshotValue(expected, "totalSupply", -burned);
        addSnapshotValue(expected, "totalQueuedShares", -burned);
        addSnapshotValue(expected.shares, "VAULT_PROXY", -burned);
        addSnapshotValue(expected.claimableAssets, "ALICE", reserved);
        addSnapshotValue(expected, "totalClaimableAssets", reserved);
        if (checkpoint === "602") {
          addSnapshotValue(expected.requests["4"], "shares", -burned);
        } else {
          expected.queueHead = "0";
          expected.queueTail = "0";
          expected.activeRequestId.ALICE = "0";
          expected.requests["4"].shares = "0";
          expected.requestOwner["4"] = ZERO_ADDRESS;
        }
        break;
      }
      case "605": {
        const assets = bigint(preState.strategyDebt.STRATEGY);
        addSnapshotValue(expected.underlying, "STRATEGY", -assets);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", assets);
        spendExpectedAllowance(expected, "STRATEGY", assets);
        addSnapshotValue(expected.strategyDebt, "STRATEGY", -assets);
        addSnapshotValue(expected, "deployedAssets", -assets);
        syncExpectedAccounted(expected);
        break;
      }
      default:
        throw new Error(`No dynamic reconciliation model for checkpoint ${checkpoint}`);
    }
    return refreshSnapshotDerived(expected);
  };
}

function viewResultValue(value, label) {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return bigint(value, label);
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`${label} returned ${value.length} values`);
    return viewResultValue(value[0], label);
  }
  if (value && typeof value === "object") {
    for (const key of ["value", "v", "contents", "result", "returnValue", "0", "_0"]) {
      if (value[key] != null) return viewResultValue(value[key], label);
    }
  }
  throw new Error(`Cannot parse read-only ${label} result: ${stableJson(value)}`);
}

function pendingAccrualResult(value) {
  let result = value;
  while (result && typeof result === "object" && !Array.isArray(result)) {
    if (result.targetAmount != null && result.fundedAmount != null) {
      return {
        target: viewResultValue(result.targetAmount, "pendingAccrual.targetAmount"),
        funded: viewResultValue(result.fundedAmount, "pendingAccrual.fundedAmount"),
      };
    }
    const nested = ["result", "value", "contents", "returnValue"]
      .map((key) => result[key])
      .find((candidate) => candidate != null);
    if (nested == null) break;
    result = nested;
  }
  if (Array.isArray(result)) {
    if (result.length === 1 && (Array.isArray(result[0]) ||
        result[0] && typeof result[0] === "object")) {
      return pendingAccrualResult(result[0]);
    }
    if (result.length >= 2) {
      return {
        target: viewResultValue(result[0], "pendingAccrual.targetAmount"),
        funded: viewResultValue(result[1], "pendingAccrual.fundedAmount"),
      };
    }
  }
  if (result && typeof result === "object" && result["0"] != null && result["1"] != null) {
    return {
      target: viewResultValue(result["0"], "pendingAccrual.targetAmount"),
      funded: viewResultValue(result["1"], "pendingAccrual.fundedAmount"),
    };
  }
  if (result && typeof result === "object" && result._0 != null && result._1 != null) {
    return {
      target: viewResultValue(result._0, "pendingAccrual.targetAmount"),
      funded: viewResultValue(result._1, "pendingAccrual.fundedAmount"),
    };
  }
  throw new Error(`Cannot parse read-only pendingAccrual result: ${stableJson(value)}`);
}

async function readVaultView(context, method, args = []) {
  const url =
    `${rootNodeUrl()}/strato/v2.3/contract/YieldVault/${context.addresses.VAULT_PROXY}/call`;
  let data;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${context.actors.OWNER.token.token}` },
      params: { method, args: JSON.stringify(args.map((value) => value.toString())) },
      timeout: 30_000,
    });
    data = response.data;
  } catch (error) {
    const status = error.response && error.response.status;
    throw new Error(
      `Read-only REST view ${method} failed${status ? ` (${status})` : ""}; ` +
      "the parent STRATO integration must expose GET contract calls for the upgraded proxy"
    );
  }
  const result = data && typeof data === "object" && data[method] != null
    ? data[method]
    : data;
  return method === "pendingAccrual"
    ? pendingAccrualResult(result)
    : viewResultValue(result, method);
}

async function attachLiveViews(context, snapshot) {
  const blockBefore = await latestBlock(context.actors.OWNER.token);
  const daveShares = bigint(snapshot.shares.DAVE || 0);
  const pendingAccrualView = projectedAccrual(snapshot, blockBefore.timestamp);
  const economicAssets = bigint(snapshot.totalAssets);
  const accountedAssets = bigint(snapshot.accountedAssets);
  const reconciledAssets = snapshot.accrualInitialized && economicAssets > accountedAssets
    ? accountedAssets
    : economicAssets;
  const claims = bigint(snapshot.totalClaimableAssets);
  const reconciledActive = reconciledAssets > claims ? reconciledAssets - claims : 0n;
  const projectedActive = reconciledActive + pendingAccrualView.funded;
  const supply = bigint(snapshot.totalSupply);
  const projectedExchangeRateView = supply === 0n ? U : projectedActive * U / supply;
  const freeQueueView = bigint(snapshot.idle) > claims ? bigint(snapshot.idle) - claims : 0n;
  const freeInstantView = bigint(snapshot.queueHead) !== 0n ||
      projectedActive <= bigint(snapshot.deployedAssets)
    ? 0n
    : projectedActive - bigint(snapshot.deployedAssets);
  const previewDepositModel = (assets) =>
    supply === 0n ? assets : projectedActive === 0n ? 0n : assets * supply / projectedActive;
  const previewRedeemModel = (shares) =>
    supply === 0n ? shares : shares * projectedActive / supply;
  const maxRedeemModel = (actor) => {
    if (snapshot.paused || supply === 0n || projectedActive === 0n) return 0n;
    const ownerShares = bigint(snapshot.shares[actor] || 0);
    const idleShares = freeInstantView * supply / projectedActive;
    return ownerShares < idleShares ? ownerShares : idleShares;
  };
  const blockAfter = await latestBlock(context.actors.OWNER.token);
  Object.defineProperty(snapshot, "liveViews", {
    enumerable: false,
    value: {
      source: "derived-bloc-state",
      blockBefore,
      blockAfter,
      totalAssets: economicAssets,
      activeAssets: economicAssets > claims ? economicAssets - claims : 0n,
      exchangeRate: supply === 0n
        ? U
        : (economicAssets > claims ? economicAssets - claims : 0n) * U / supply,
      freeIdleForInstantWithdrawals: freeInstantView,
      freeIdleForQueueProcessing: freeQueueView,
      maxDeploy: maxDeploy(snapshot),
      pendingAccrual: pendingAccrualView,
      projectedExchangeRate: projectedExchangeRateView,
      previewDepositDave: previewDepositModel(C.DAVE_DEPOSIT),
      previewRedeemCarol: previewRedeemModel(C.CAROL_REDEEM),
      previewRedeemAliceQueue: previewRedeemModel(C.NEW_QUEUE_SHARES),
      previewRedeemDave: previewRedeemModel(daveShares),
      maxRedeemCarol: maxRedeemModel("CAROL"),
      maxRedeemBob: maxRedeemModel("BOB"),
    },
  });
  return snapshot;
}

function ensureDerived(context) {
  if (!context.journal.state.derived) context.journal.state.derived = {};
  if (!context.journal.state.derived.viewEvidence) {
    context.journal.state.derived.viewEvidence = {};
  }
  if (!context.journal.state.ghostLedger) {
    context.journal.state.ghostLedger = {
      initialAccounted: (450n * U).toString(),
      expectedAccounted: (450n * U).toString(),
      entries: [],
    };
  }
  if (!context.journal.state.proxyFlowLedger) {
    context.journal.state.proxyFlowLedger = {
      initialIdle: (250n * U).toString(),
      entries: [],
      queueNoMovement: [],
    };
  }
  return context.journal.state.derived;
}

function recordGhost(context, checkpoint, category, amount) {
  const ledger = context.journal.state.ghostLedger;
  if (ledger.entries.some((entry) => entry.checkpoint === checkpoint)) return;
  const signed = bigint(amount);
  ledger.expectedAccounted = (bigint(ledger.expectedAccounted) + signed).toString();
  ledger.entries.push({ checkpoint, category, amount: signed.toString() });
}

function recordProxyFlow(context, checkpoint, category, amount) {
  const ledger = context.journal.state.proxyFlowLedger;
  if (ledger.entries.some((entry) => entry.checkpoint === checkpoint &&
      entry.category === category)) return;
  const signed = bigint(amount);
  ledger.entries.push({
    checkpoint,
    category,
    direction: signed < 0n ? "outflow" : "inflow",
    amount: signed.toString(),
  });
}

function assertNoUnderlyingMovement(snapshot, result, checkpoint) {
  const expected = { ...result.preState.underlying };
  const evidence = result.feePaymentEvidence;
  if (evidence && evidence.debit !== "0") {
    expected[evidence.actor] = (
      bigint(expected[evidence.actor]) - bigint(evidence.debit)
    ).toString();
  }
  assertEqual(snapshot.underlying, expected, `${checkpoint} no economic underlying movement`);
  const records = assertionContext.journal.state.proxyFlowLedger.queueNoMovement;
  if (!records.includes(checkpoint)) records.push(checkpoint);
}

function assertStartingState(snapshot, context) {
  const { addresses } = context;
  const { _evidence, ...runbookFinalState } = context.runbook.finalSnapshot;
  assertSnapshotSubset(snapshot, runbookFinalState);
  assertSnapshot(snapshot, {
    implementation: addresses.NEW_IMPLEMENTATION,
    owner: addresses.VAULT_OWNER,
    proxyOwner: addresses.VAULT_OWNER,
    asset: addresses.ASSET,
    name: "Testnet Legacy Yield Vault",
    symbol: "tLEGACY-YV",
    decimals: 18n,
    paused: false,
    vaultInitialized: true,
    accrualInitialized: true,
    perSecondSavingsRate: RAY,
    rewardDistributor: addresses.REWARD_DISTRIBUTOR,
    accountedAssets: 450n * U,
    idle: 250n * U,
    deployedAssets: 200n * U,
    totalAssets: 450n * U,
    "strategyDebt.STRATEGY": 200n * U,
    "strategyDebt.REWARD_DISTRIBUTOR": 0n,
    "approvedStrategies.STRATEGY": true,
    totalSupply: 250n * U,
    "shares.ALICE": 80n * U,
    "shares.BOB": 70n * U,
    "shares.CAROL": 100n * U,
    "shares.SMOKE_USER": 0n,
    "shares.VAULT_PROXY": 0n,
    queueHead: 0n,
    queueTail: 0n,
    nextRequestId: 4n,
    totalQueuedShares: 0n,
    "activeRequestId.ALICE": 0n,
    "activeRequestId.BOB": 0n,
    "activeRequestId.SMOKE_USER": 0n,
    "claimableAssets.ALICE": 120n * U,
    "claimableAssets.BOB": 80n * U,
    "claimableAssets.SMOKE_USER": 0n,
    "requests.1.shares": 0n,
    "requests.1.receiver": addresses.ALICE,
    "requests.1.next": 2n,
    "requests.1.exists": true,
    "requests.2.shares": 0n,
    "requests.2.receiver": addresses.BOB,
    "requests.2.next": 3n,
    "requests.2.exists": true,
    "requests.3.shares": 0n,
    "requests.3.receiver": addresses.SMOKE_USER,
    "requests.3.next": 0n,
    "requests.3.exists": true,
    "requestOwner.1": ZERO_ADDRESS,
    "requestOwner.2": ZERO_ADDRESS,
    "requestOwner.3": ZERO_ADDRESS,
    totalClaimableAssets: 200n * U,
    activeAssets: 250n * U,
    exchangeRate: U,
    freeIdleForInstantWithdrawals: 50n * U,
    freeIdleForQueueProcessing: 50n * U,
    maxDeploy: 25n * U,
    minIdleBps: 1000n,
  }, "completed runbook handoff");
  assertAtLeast(
    snapshot.underlying.REWARD_DISTRIBUTOR,
    C.REWARD_BUDGET,
    "runbook distributor balance"
  );
  const values = ensureDerived(context);
  const distributorStart = bigint(snapshot.underlying.REWARD_DISTRIBUTOR);
  if (values.DISTRIBUTOR_START_BALANCE != null) {
    assertEqual(
      distributorStart,
      values.DISTRIBUTOR_START_BALANCE,
      "recorded distributor start balance"
    );
  } else {
    values.DISTRIBUTOR_START_BALANCE = distributorStart.toString();
  }
  assertAtLeast(
    values.DISTRIBUTOR_START_BALANCE,
    C.REWARD_BUDGET,
    "explicit distributor start budget"
  );
  assertAtLeast(
    snapshot.allowances.REWARD_DISTRIBUTOR,
    C.REWARD_BUDGET,
    "runbook distributor allowance"
  );
  assertCondition(
    bigint(snapshot.lastAccrual) > 0n,
    "runbook lastAccrual initialized",
    "Runbook lastAccrual must be positive"
  );
  assertCore(snapshot);
}

function buildSpecs(context) {
  const { addresses } = context;
  const derived = ensureDerived(context);
  return {
    "000": observed(
      "assert completed runbook handoff state",
      "OWNER",
      (snapshot) => assertStartingState(snapshot, context),
      ["live state equals completed safe-upgrade runbook handoff"]
    ),
    "100": {
      ...tx("ALICE claims runbook-preserved liability", "ALICE", "VAULT_PROXY", "YieldVault",
        "claim", { receiver: addresses.ALICE }, ["WithdrawalClaimed"]),
      expectedPostState: exactExpectedPost((expected) => {
        applyClaimExpected(expected, "ALICE", 120n * U);
      }),
      assertPost(snapshot, result) {
        assertEqual(
          actorEconomicDelta(result, snapshot, "ALICE"),
          120n * U,
          "ALICE claim receipt"
        );
        assertSnapshot(snapshot, {
          "claimableAssets.ALICE": 0n,
          "claimableAssets.BOB": 80n * U,
          totalClaimableAssets: 80n * U,
          idle: 130n * U,
          totalAssets: 330n * U,
          accountedAssets: 330n * U,
          totalSupply: 250n * U,
          exchangeRate: U,
        }, "ALICE claim");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "100", "queue claim payout", -120n * U);
        recordProxyFlow(ctx, "100", "claim", -120n * U);
      },
    },
    "101": {
      ...tx("BOB claims runbook-preserved liability", "BOB", "VAULT_PROXY", "YieldVault",
        "claim", { receiver: addresses.BOB }, ["WithdrawalClaimed"]),
      expectedPostState: exactExpectedPost((expected) => {
        applyClaimExpected(expected, "BOB", 80n * U);
      }),
      assertPost(snapshot, result) {
        assertEqual(
          actorEconomicDelta(result, snapshot, "BOB"),
          80n * U,
          "BOB claim receipt"
        );
        assertSnapshot(snapshot, {
          "claimableAssets.ALICE": 0n,
          "claimableAssets.BOB": 0n,
          totalClaimableAssets: 0n,
          idle: 50n * U,
          deployedAssets: 200n * U,
          totalAssets: 250n * U,
          accountedAssets: 250n * U,
          totalSupply: 250n * U,
          exchangeRate: U,
        }, "BOB claim");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "101", "queue claim payout", -80n * U);
        recordProxyFlow(ctx, "101", "claim", -80n * U);
      },
    },
    "102": {
      ...tx("assert repeated ALICE claim reverts atomically", "ALICE", "VAULT_PROXY",
        "YieldVault", "claim", { receiver: addresses.ALICE }),
      expectFailure: true,
      expectedFailurePattern: /nothing claimable/i,
    },
    "103": {
      ...tx("assert repeated BOB claim reverts atomically", "BOB", "VAULT_PROXY",
        "YieldVault", "claim", { receiver: addresses.BOB }),
      expectFailure: true,
      expectedFailurePattern: /nothing claimable/i,
    },
    "200": observed(
      "verify STRATEGY recovery/profit amount",
      "STRATEGY",
      (snapshot) => {
        assertAtLeast(snapshot.underlying.STRATEGY, 210n * U, "STRATEGY funded balance");
        assertCore(snapshot);
      },
      ["STRATEGY underlying >= 210 U"]
    ),
    "201": {
      ...tx("STRATEGY asset approval", "STRATEGY", "ASSET", context.assetContractName,
        "approve", { spender: addresses.VAULT_PROXY, value: MAX_UINT256 }, ["Approval"]),
      expectedPostState: exactExpectedPost((expected) => {
        expected.allowances.STRATEGY = MAX_UINT256.toString();
      }),
      assertPost(snapshot, result) {
        assertEqual(snapshot.allowances.STRATEGY, MAX_UINT256, "STRATEGY allowance");
        assertCore(snapshot);
      },
    },
    "202": {
      ...tx("return STRATEGY principal and profit", "OWNER", "VAULT_PROXY", "YieldVault",
        "returnCapital", { from: addresses.STRATEGY, assets: 210n * U }, ["CapitalReturned"],
        ONLY_OWNER),
      assertPost(snapshot, result) {
        assertSnapshot(snapshot, {
          "strategyDebt.STRATEGY": 0n,
          deployedAssets: 0n,
          idle: 260n * U,
          totalAssets: 260n * U,
          accountedAssets: 260n * U,
          totalSupply: 250n * U,
          exchangeRate: 1040000000000000000n,
        }, "strategy A return");
        assertCore(snapshot);
      },
      assertEvents(events) {
        assertEventValues(events, "CapitalReturned", {
          assetsReturned: 210n * U,
          principalRepaid: 200n * U,
          realizedProfit: 10n * U,
          strategyDebt: 0n,
          totalDeployed: 0n,
        });
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "202", "realized strategy profit", 10n * U);
        recordProxyFlow(ctx, "202", "capital return", 210n * U);
      },
    },
    "210": {
      ...tx("redeploy loss-test capital to STRATEGY", "OWNER", "VAULT_PROXY", "YieldVault",
        "deployCapital", { to: addresses.STRATEGY, assets: 80n * U }, ["CapitalDeployed"],
        ONLY_OWNER),
      expectedPostState: exactExpectedPost((expected) => {
        addSnapshotValue(expected.underlying, "VAULT_PROXY", -80n * U);
        addSnapshotValue(expected.underlying, "STRATEGY", 80n * U);
        addSnapshotValue(expected.strategyDebt, "STRATEGY", 80n * U);
        addSnapshotValue(expected, "deployedAssets", 80n * U);
      }),
      assertPost(snapshot, result) {
        assertSnapshot(snapshot, {
          "strategyDebt.STRATEGY": 80n * U,
          deployedAssets: 80n * U,
          idle: 180n * U,
          totalAssets: 260n * U,
          accountedAssets: 260n * U,
        }, "strategy redeployment");
        assertEqual(
          bigint(snapshot.underlying.STRATEGY) - bigint(result.preState.underlying.STRATEGY),
          80n * U,
          "STRATEGY redeployment balance"
        );
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordProxyFlow(ctx, "210", "deployment", -80n * U);
      },
    },
    "211": {
      ...tx("transfer STRATEGY loss to LOSS_SINK", "STRATEGY", "ASSET",
        context.assetContractName, "transfer",
        { to: addresses.LOSS_SINK, value: 20n * U }, ["Transfer"]),
      expectedPostState: exactExpectedPost((expected) => {
        addSnapshotValue(expected.underlying, "STRATEGY", -20n * U);
        addSnapshotValue(expected.underlying, "LOSS_SINK", 20n * U);
      }),
      assertPost(snapshot, result) {
        assertEqual(
          actorEconomicDelta(result, snapshot, "STRATEGY"),
          -20n * U,
          "STRATEGY physical loss"
        );
        assertEqual(
          bigint(snapshot.underlying.LOSS_SINK) - bigint(result.preState.underlying.LOSS_SINK),
          20n * U,
          "LOSS_SINK exact loss receipt"
        );
        assertCore(snapshot);
      },
    },
    "212": {
      ...tx("report STRATEGY loss", "OWNER", "VAULT_PROXY", "YieldVault",
        "reportStrategyLoss", { strategy: addresses.STRATEGY, loss: 20n * U },
        ["StrategyLossReported"], ONLY_OWNER),
      assertPost(snapshot) {
        assertSnapshot(snapshot, {
          "strategyDebt.STRATEGY": 60n * U,
          deployedAssets: 60n * U,
          idle: 180n * U,
          totalAssets: 240n * U,
          accountedAssets: 240n * U,
          totalSupply: 250n * U,
          exchangeRate: 960000000000000000n,
        }, "strategy loss");
        assertCore(snapshot);
      },
      assertEvents(events) {
        assertEventValues(events, "StrategyLossReported", {
          loss: 20n * U,
          strategyDebt: 60n * U,
          totalDeployed: 60n * U,
        });
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "212", "reported strategy loss", -20n * U);
      },
    },
    "213": {
      ...tx("return STRATEGY remaining principal", "OWNER", "VAULT_PROXY", "YieldVault",
        "returnCapital", { from: addresses.STRATEGY, assets: 60n * U }, ["CapitalReturned"],
        ONLY_OWNER),
      assertPost(snapshot) {
        assertSnapshot(snapshot, {
          "strategyDebt.STRATEGY": 0n,
          deployedAssets: 0n,
          idle: 240n * U,
          totalAssets: 240n * U,
          accountedAssets: 240n * U,
        }, "strategy return");
        assertCore(snapshot);
      },
      assertEvents(events) {
        assertEventValues(events, "CapitalReturned", {
          assetsReturned: 60n * U,
          principalRepaid: 60n * U,
          realizedProfit: 0n,
          strategyDebt: 0n,
          totalDeployed: 0n,
        });
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordProxyFlow(ctx, "213", "capital return", 60n * U);
      },
    },
    "300": {
      ...tx("CAROL exact instant redemption", "CAROL", "VAULT_PROXY", "YieldVault",
        "redeem",
        { shares: C.CAROL_REDEEM, receiver: addresses.CAROL, owner_: addresses.CAROL },
        ["Withdraw", "Transfer"]),
      assertPre(snapshot) {
        const expectedPreview = previewRedeem(snapshot, C.CAROL_REDEEM);
        const expectedMaximum = maxRedeemFor(snapshot, "CAROL");
        assertEqual(expectedPreview, 24n * U, "CAROL previewRedeem model");
        assertEqual(snapshot.liveViews.previewRedeemCarol, expectedPreview, "CAROL live previewRedeem");
        assertEqual(expectedMaximum, 100n * U, "CAROL maxRedeem model");
        assertEqual(snapshot.liveViews.maxRedeemCarol, expectedMaximum, "CAROL live maxRedeem");
        ensureDerived(context).viewEvidence["300"] = {
          previewRedeem25: snapshot.liveViews.previewRedeemCarol.toString(),
          maxRedeemCarol: snapshot.liveViews.maxRedeemCarol.toString(),
        };
      },
      assertPost(snapshot, result) {
        assertEqual(
          actorEconomicDelta(result, snapshot, "CAROL"),
          24n * U,
          "CAROL underlying payout"
        );
        assertSnapshot(snapshot, {
          "shares.CAROL": 75n * U,
          totalSupply: 225n * U,
          idle: 216n * U,
          totalAssets: 216n * U,
          accountedAssets: 216n * U,
          exchangeRate: 960000000000000000n,
        }, "CAROL redemption");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "300", "instant redemption payout", -24n * U);
        recordProxyFlow(ctx, "300", "instant exit", -24n * U);
      },
    },
    "400": {
      ...tx("enable MAX_RATE", "OWNER", "VAULT_PROXY", "YieldVault",
        "setPerSecondSavingsRate", { newRate: MAX_RATE }, ["PerSecondSavingsRateUpdated"],
        ONLY_OWNER),
      assertPost(snapshot, result) {
        assertEqual(snapshot.perSecondSavingsRate, MAX_RATE, "MAX_RATE");
        assertEqual(snapshot.idle, result.preState.idle, "flat-rate setter idle");
        assertEqual(snapshot.accountedAssets, result.preState.accountedAssets, "flat-rate setter accounted");
        assertCondition(
          bigint(snapshot.lastAccrual) > bigint(result.preState.lastAccrual),
          "rate advances lastAccrual",
          "Rate transaction did not advance lastAccrual"
        );
        assertCore(snapshot);
      },
      assertEvents(events, _receipt, _pre, post) {
        const updated = assertEventValues(events, "PerSecondSavingsRateUpdated", {
          newRate: MAX_RATE,
        });
        assertEqual(post.lastAccrual, eventTimestampSeconds(updated), "rate block timestamp");
      },
    },
    "410": {
      ...tx("wait for accrual interval and call accrue", "OWNER", "VAULT_PROXY", "YieldVault",
        "accrue", {}, ["Accrued"], ONLY_OWNER),
      asyncPrepare: true,
      assertPost(snapshot, result) {
        const y1 = bigint(snapshot.idle) - bigint(result.preState.idle);
        assertCondition(y1 > 0n, "accrual credits assets", "accrue credited no assets");
        assertEqual(
          bigint(snapshot.accountedAssets) - bigint(result.preState.accountedAssets),
          y1,
          "accrual accounted delta"
        );
        assertEqual(
          bigint(result.preState.underlying.REWARD_DISTRIBUTOR) -
            bigint(snapshot.underlying.REWARD_DISTRIBUTOR),
          y1,
          "distributor accrual delta"
        );
        assertEqual(snapshot.totalSupply, result.preState.totalSupply, "accrual supply");
        assertEqual(snapshot.deployedAssets, result.preState.deployedAssets, "accrual deployed assets");
        assertCore(snapshot);
      },
      assertEvents(events, _receipt, pre, post) {
        const y1 = bigint(post.idle) - bigint(pre.idle);
        const accrued = events.find((event) => event.eventName === "Accrued");
        const expected = projectedAccrual(pre, eventTimestampSeconds(accrued));
        assertEqual(expected.target, expected.funded, "transaction-time funded accrual");
        assertEqual(y1, expected.funded, "transaction-time accrual credit");
        assertEventValues(events, "Accrued", {
          targetAmount: expected.target,
          creditedAmount: expected.funded,
        });
      },
      afterConfirm(pre, post, _receipt, _events, ctx) {
        const y1 = bigint(post.idle) - bigint(pre.idle);
        ensureDerived(ctx).Y1 = y1.toString();
        recordGhost(ctx, "410", "funded accrual", y1);
        recordProxyFlow(ctx, "410", "funded accrual", y1);
      },
    },
    "411": {
      ...tx("restore flat RAY rate and reconcile final accrual", "OWNER", "VAULT_PROXY",
        "YieldVault", "setPerSecondSavingsRate", { newRate: RAY },
        ["PerSecondSavingsRateUpdated"], ONLY_OWNER),
      optionalEvents: ["Accrued"],
      assertPost(snapshot, result) {
        const y2 = bigint(snapshot.idle) - bigint(result.preState.idle);
        assertCondition(
          y2 >= 0n,
          "flat-rate restoration nonnegative accrual",
          "Flat-rate restoration reduced idle assets"
        );
        assertEqual(snapshot.perSecondSavingsRate, RAY, "restored RAY rate");
        assertEqual(
          bigint(snapshot.accountedAssets) - bigint(result.preState.accountedAssets),
          y2,
          "final accrual accounted delta"
        );
        assertEqual(
          bigint(result.preState.underlying.REWARD_DISTRIBUTOR) -
            bigint(snapshot.underlying.REWARD_DISTRIBUTOR),
          y2,
          "final distributor accrual delta"
        );
        const totalCredited = bigint(ensureDerived(context).Y1) + y2;
        assertEqual(snapshot.idle, 216n * U + totalCredited, "absolute post-accrual idle");
        assertEqual(
          snapshot.accountedAssets,
          216n * U + totalCredited,
          "absolute post-accrual accounted assets"
        );
        assertSnapshot(snapshot, { totalSupply: 225n * U, deployedAssets: 0n }, "flat rate restoration");
        assertCore(snapshot);
      },
      assertEvents(events, _receipt, pre, post) {
        const y2 = bigint(post.idle) - bigint(pre.idle);
        const accrued = events.find((event) => event.eventName === "Accrued");
        if (y2 === 0n) {
          assertCondition(!accrued, "zero final accrual has no event",
            "Zero final accrual unexpectedly emitted Accrued");
          return;
        }
        assertCondition(Boolean(accrued), "positive final accrual has event",
          "Positive final accrual did not emit Accrued");
        const expected = projectedAccrual(pre, eventTimestampSeconds(accrued));
        assertEqual(y2, expected.funded, "final transaction-time accrual credit");
        assertEventValues(events, "Accrued", {
          targetAmount: expected.target,
          creditedAmount: expected.funded,
        });
      },
      afterConfirm(pre, post, _receipt, _events, ctx) {
        const y2 = bigint(post.idle) - bigint(pre.idle);
        const values = ensureDerived(ctx);
        values.Y2 = y2.toString();
        values.TOTAL_CREDITED = (bigint(values.Y1) + y2).toString();
        recordGhost(ctx, "411", "funded accrual", y2);
        recordProxyFlow(ctx, "411", "funded accrual", y2);
      },
    },
    "500": observed(
      "fund DONOR",
      "DONOR",
      (snapshot) => {
        assertAtLeast(snapshot.underlying.DONOR, C.DONATION, "DONOR underlying");
        assertCore(snapshot);
      },
      ["DONOR underlying >= 5 U"]
    ),
    "501": observed(
      "fund DAVE",
      "DAVE",
      (snapshot) => {
        assertAtLeast(snapshot.underlying.DAVE, C.DAVE_DEPOSIT, "DAVE underlying");
        assertCore(snapshot);
      },
      ["DAVE underlying >= 25 U"]
    ),
    "502": {
      ...tx("DONOR transfers deliberate donation", "DONOR", "ASSET", context.assetContractName,
        "transfer", { to: addresses.VAULT_PROXY, value: C.DONATION }, ["Transfer"]),
      expectedPostState: exactExpectedPost((expected) => {
        addSnapshotValue(expected.underlying, "DONOR", -C.DONATION);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", C.DONATION);
      }),
      assertPre(snapshot) {
        const expected = previewDeposit(snapshot, C.DAVE_DEPOSIT);
        assertEqual(snapshot.liveViews.previewDepositDave, expected, "live previewDeposit before donation");
        ensureDerived(context).DAVE_SHARES_BEFORE_DONATION =
          snapshot.liveViews.previewDepositDave.toString();
        ensureDerived(context).viewEvidence["502"] = {
          previewDepositBeforeDonation: snapshot.liveViews.previewDepositDave.toString(),
        };
      },
      assertPost(snapshot) {
        assertEqual(
          bigint(snapshot.totalAssets) - bigint(snapshot.accountedAssets),
          C.DONATION,
          "unreconciled donation"
        );
        assertEqual(
          snapshot.liveViews.previewDepositDave,
          ensureDerived(context).DAVE_SHARES_BEFORE_DONATION,
          "donation-neutral live DAVE preview"
        );
        ensureDerived(context).viewEvidence["502"].previewDepositAfterDonation =
          snapshot.liveViews.previewDepositDave.toString();
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordProxyFlow(ctx, "502", "donation", C.DONATION);
      },
    },
    "503": {
      ...tx("DAVE asset approval", "DAVE", "ASSET", context.assetContractName,
        "approve", { spender: addresses.VAULT_PROXY, value: MAX_UINT256 }, ["Approval"]),
      expectedPostState: exactExpectedPost((expected) => {
        expected.allowances.DAVE = MAX_UINT256.toString();
      }),
      assertPost(snapshot) {
        assertEqual(snapshot.allowances.DAVE, MAX_UINT256, "DAVE allowance");
        assertEqual(bigint(snapshot.totalAssets) - bigint(snapshot.accountedAssets), C.DONATION, "donation remains");
      },
    },
    "504": {
      ...tx("DAVE deposit and donation reconciliation", "DAVE", "VAULT_PROXY", "YieldVault",
        "deposit", { assets: C.DAVE_DEPOSIT, receiver: addresses.DAVE },
        ["StrayAssetsRemoved", "Deposit", "Transfer"]),
      assertPre(snapshot) {
        const expected = previewDeposit(snapshot, C.DAVE_DEPOSIT);
        const shares = snapshot.liveViews.previewDepositDave;
        assertEqual(shares, expected, "DAVE live previewDeposit model");
        assertEqual(
          shares,
          ensureDerived(context).DAVE_SHARES_BEFORE_DONATION,
          "donation does not change DAVE_SHARES"
        );
        assertCondition(shares > 0n, "DAVE previewDeposit positive", "DAVE previewDeposit returned zero shares");
        derived.DAVE_SHARES = shares.toString();
        ensureDerived(context).viewEvidence["504"] = {
          previewDeposit: shares.toString(),
        };
      },
      assertPost(snapshot, result) {
        const shares = bigint(ensureDerived(context).DAVE_SHARES);
        assertEqual(snapshot.shares.DAVE, shares, "DAVE minted shares");
        assertEqual(
          actorEconomicDelta(result, snapshot, "DAVE"),
          -C.DAVE_DEPOSIT,
          "DAVE deposit debit"
        );
        assertEqual(
          bigint(snapshot.underlying.REWARD_DISTRIBUTOR) -
            bigint(result.preState.underlying.REWARD_DISTRIBUTOR),
          C.DONATION,
          "donation sent to distributor"
        );
        assertEqual(snapshot.totalAssets, snapshot.accountedAssets, "donation reconciled");
        assertEqual(
          bigint(snapshot.accountedAssets) - bigint(result.preState.accountedAssets),
          C.DAVE_DEPOSIT,
          "accounted deposit increase"
        );
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "504", "deposit received", C.DAVE_DEPOSIT);
        recordProxyFlow(ctx, "504", "deposit", C.DAVE_DEPOSIT);
        recordProxyFlow(ctx, "504", "stray removal", -C.DONATION);
      },
    },
    "505": {
      ...tx("DAVE full redemption", "DAVE", "VAULT_PROXY", "YieldVault", "redeem",
        () => ({
          shares: bigint(ensureDerived(context).DAVE_SHARES),
          receiver: addresses.DAVE,
          owner_: addresses.DAVE,
        }), ["Withdraw", "Transfer"]),
      assertPre(snapshot) {
        const expected = previewRedeem(snapshot, bigint(ensureDerived(context).DAVE_SHARES));
        const assets = snapshot.liveViews.previewRedeemDave;
        assertEqual(assets, expected, "DAVE live previewRedeem model");
        ensureDerived(context).DAVE_ASSETS = assets.toString();
        ensureDerived(context).viewEvidence["505"] = {
          previewRedeem: assets.toString(),
        };
      },
      assertPost(snapshot, result) {
        const assets = bigint(ensureDerived(context).DAVE_ASSETS);
        assertEqual(
          actorEconomicDelta(result, snapshot, "DAVE"),
          assets,
          "DAVE redemption payout"
        );
        assertSnapshot(snapshot, {
          "shares.DAVE": 0n,
          totalSupply: 225n * U,
        }, "DAVE full redemption");
        assertEqual(snapshot.totalAssets, snapshot.accountedAssets, "post-DAVE accounting");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "505", "instant redemption payout", -bigint(ensureDerived(ctx).DAVE_ASSETS));
        recordProxyFlow(
          ctx,
          "505",
          "instant exit",
          -bigint(ensureDerived(ctx).DAVE_ASSETS)
        );
      },
    },
    "600": {
      ...tx("deploy max capital to STRATEGY", "OWNER", "VAULT_PROXY", "YieldVault",
        "deployCapital",
        () => ({ to: addresses.STRATEGY, assets: bigint(ensureDerived(context).DEPLOY_AMOUNT) }),
        ["CapitalDeployed"], ONLY_OWNER),
      expectedPostState: exactExpectedPost((expected, _preState, ctx) => {
        const amount = bigint(ensureDerived(ctx).DEPLOY_AMOUNT);
        addSnapshotValue(expected.underlying, "VAULT_PROXY", -amount);
        addSnapshotValue(expected.underlying, "STRATEGY", amount);
        addSnapshotValue(expected.strategyDebt, "STRATEGY", amount);
        addSnapshotValue(expected, "deployedAssets", amount);
      }),
      assertPre(snapshot) {
        const expectedAmount = maxDeploy(snapshot);
        const amount = snapshot.liveViews.maxDeploy;
        assertEqual(amount, expectedAmount, "live maxDeploy model");
        assertCondition(
          amount > 0n && amount < bigint(snapshot.idle),
          "maxDeploy valid range",
          `Invalid maxDeploy result ${amount}`
        );
        const values = ensureDerived(context);
        values.QUEUE_ASSETS_BEFORE = snapshot.accountedAssets;
        values.QUEUE_SUPPLY_BEFORE = snapshot.totalSupply;
        const expectedQueueValue = previewRedeem(snapshot, C.NEW_QUEUE_SHARES);
        assertEqual(
          snapshot.liveViews.previewRedeemAliceQueue,
          expectedQueueValue,
          "ALICE live queue previewRedeem"
        );
        values.ALICE_QUEUE_VALUE = snapshot.liveViews.previewRedeemAliceQueue.toString();
        values.DEPLOY_AMOUNT = amount.toString();
        values.viewEvidence["600"] = {
          maxDeploy: amount.toString(),
          previewRedeem80: snapshot.liveViews.previewRedeemAliceQueue.toString(),
        };
        assertEqual(snapshot.totalSupply, 225n * U, "queue starting supply");
        assertEqual(snapshot.shares.ALICE, C.NEW_QUEUE_SHARES, "ALICE queue shares");
        assertEqual(snapshot.queueHead, "0", "empty queue");
      },
      assertPost(snapshot, result) {
        const amount = bigint(ensureDerived(context).DEPLOY_AMOUNT);
        assertEqual(
          bigint(result.preState.idle) - bigint(snapshot.idle),
          amount,
          "deployment idle delta"
        );
        assertEqual(snapshot.strategyDebt.STRATEGY, amount, "deployed strategy debt");
        assertEqual(snapshot.accountedAssets, result.preState.accountedAssets, "deployment accounting");
        const requiredReserve = ceilDiv(
          bigint(snapshot.activeAssets) * bigint(snapshot.minIdleBps),
          10_000n
        );
        assertEqual(
          bigint(snapshot.idle) - bigint(snapshot.totalClaimableAssets),
          requiredReserve,
          "deployment exact configured minimum reserve"
        );
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordProxyFlow(ctx, "600", "deployment", -bigint(ensureDerived(ctx).DEPLOY_AMOUNT));
      },
    },
    "601": {
      ...tx("ALICE redeem-or-queue request", "ALICE", "VAULT_PROXY", "YieldVault",
        "redeemOrQueue",
        { shares: C.NEW_QUEUE_SHARES, receiver: addresses.ALICE, owner_: addresses.ALICE },
        ["WithdrawalRequested", "Transfer"]),
      assertPost(snapshot, result) {
        assertSnapshot(snapshot, {
          queueHead: 4n,
          queueTail: 4n,
          totalQueuedShares: C.NEW_QUEUE_SHARES,
          "activeRequestId.ALICE": 4n,
          "shares.ALICE": 0n,
          "shares.VAULT_PROXY": C.NEW_QUEUE_SHARES,
          "requests.4.shares": C.NEW_QUEUE_SHARES,
          "requests.4.receiver": addresses.ALICE,
          "requests.4.exists": true,
          "requestOwner.4": addresses.ALICE,
        }, "ALICE queued redemption");
        assertEqual(maxRedeemFor(snapshot, "BOB"), 0n, "BOB maxRedeem model while queue exists");
        assertEqual(snapshot.liveViews.maxRedeemBob, 0n, "BOB live maxRedeem while queue exists");
        assertEqual(maxDeploy(snapshot), 0n, "maxDeploy model while queue exists");
        assertEqual(snapshot.liveViews.maxDeploy, 0n, "live maxDeploy while queue exists");
        ensureDerived(context).viewEvidence["601"] = {
          maxRedeemBob: snapshot.liveViews.maxRedeemBob.toString(),
          maxDeploy: snapshot.liveViews.maxDeploy.toString(),
        };
        assertNoUnderlyingMovement(snapshot, result, "601 queue request");
        assertCore(snapshot);
      },
    },
    "602": {
      ...tx("partially process ALICE request", "OWNER", "VAULT_PROXY", "YieldVault",
        "processQueue", { maxRequests: 1n, maxAssets: C.PARTIAL_BUDGET },
        ["QueueProcessed"], ONLY_OWNER),
      assertPost(snapshot, result) {
        const burned = bigint(result.preState.totalSupply) - bigint(snapshot.totalSupply);
        const reserved = bigint(snapshot.claimableAssets.ALICE) -
          bigint(result.preState.claimableAssets.ALICE);
        assertCondition(
          burned > 0n && burned < C.NEW_QUEUE_SHARES,
          "first burned shares range",
          `Unexpected first burned shares ${burned}`
        );
        assertCondition(
          reserved > 0n && reserved <= C.PARTIAL_BUDGET,
          "first reserved assets range",
          `Unexpected first reserved assets ${reserved}`
        );
        assertNoUnderlyingMovement(snapshot, result, "602 queue processing");
        assertEqual(
          snapshot.requests["4"].shares,
          C.NEW_QUEUE_SHARES - burned,
          "queued share remainder"
        );
        const values = ensureDerived(context);
        values.FIRST_BURNED = burned.toString();
        values.FIRST_RESERVED = reserved.toString();
        assertCore(snapshot);
      },
      assertEvents(events, _receipt, pre, post) {
        assertEventValues(events, "QueueProcessed", {
          requestId: 4n,
          sharesBurned: bigint(pre.totalSupply) - bigint(post.totalSupply),
          assetsReserved: bigint(post.claimableAssets.ALICE) - bigint(pre.claimableAssets.ALICE),
          fullyProcessed: false,
        });
      },
    },
    "603": {
      ...tx("ALICE claims first processed portion", "ALICE", "VAULT_PROXY", "YieldVault",
        "claim", { receiver: addresses.ALICE }, ["WithdrawalClaimed"]),
      expectedPostState: exactExpectedPost((expected, _preState, ctx) => {
        applyClaimExpected(expected, "ALICE", ensureDerived(ctx).FIRST_RESERVED);
      }),
      assertPost(snapshot, result) {
        const reserved = bigint(ensureDerived(context).FIRST_RESERVED);
        assertEqual(
          actorEconomicDelta(result, snapshot, "ALICE"),
          reserved,
          "first ALICE queue claim"
        );
        assertEqual(snapshot.claimableAssets.ALICE, "0", "first claim liability cleared");
        assertEqual(snapshot.requests["4"].shares, result.preState.requests["4"].shares, "queue remainder");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "603", "queue claim payout", -bigint(ensureDerived(ctx).FIRST_RESERVED));
        recordProxyFlow(ctx, "603", "claim", -bigint(ensureDerived(ctx).FIRST_RESERVED));
      },
    },
    "604": {
      ...tx("STRATEGY asset approval for debt return", "STRATEGY", "ASSET",
        context.assetContractName, "approve",
        { spender: addresses.VAULT_PROXY, value: MAX_UINT256 }, ["Approval"]),
      expectedPostState: exactExpectedPost((expected) => {
        expected.allowances.STRATEGY = MAX_UINT256.toString();
      }),
      assertPost(snapshot) {
        assertEqual(snapshot.allowances.STRATEGY, MAX_UINT256, "STRATEGY return allowance");
        assertCore(snapshot);
      },
    },
    "605": {
      ...tx("return exact STRATEGY debt", "OWNER", "VAULT_PROXY", "YieldVault",
        "returnCapital",
        (snapshot) => ({ from: addresses.STRATEGY, assets: bigint(snapshot.strategyDebt.STRATEGY) }),
        ["CapitalReturned"], ONLY_OWNER),
      assertPost(snapshot, result) {
        assertEqual(snapshot.strategyDebt.STRATEGY, "0", "returned strategy debt");
        assertEqual(snapshot.deployedAssets, "0", "returned all deployed assets");
        assertEqual(snapshot.accountedAssets, result.preState.accountedAssets, "principal return accounting");
        assertEqual(snapshot.exchangeRate, result.preState.exchangeRate, "principal return share value");
        assertCore(snapshot);
      },
      afterConfirm(pre, _post, _receipt, _events, ctx) {
        recordProxyFlow(ctx, "605", "capital return", bigint(pre.strategyDebt.STRATEGY));
      },
    },
    "606": {
      ...tx("process ALICE request remainder", "OWNER", "VAULT_PROXY", "YieldVault",
        "processQueue", { maxRequests: 1n, maxAssets: MAX_UINT256 }, ["QueueProcessed"],
        ONLY_OWNER),
      assertPost(snapshot, result) {
        const burned = bigint(result.preState.totalSupply) - bigint(snapshot.totalSupply);
        const reserved = bigint(snapshot.claimableAssets.ALICE) -
          bigint(result.preState.claimableAssets.ALICE);
        const values = ensureDerived(context);
        values.SECOND_BURNED = burned.toString();
        values.SECOND_RESERVED = reserved.toString();
        assertNoUnderlyingMovement(snapshot, result, "606 queue processing");
        assertEqual(
          bigint(values.FIRST_BURNED) + burned,
          C.NEW_QUEUE_SHARES,
          "aggregate burned shares"
        );
        assertSnapshot(snapshot, {
          totalQueuedShares: 0n,
          queueHead: 0n,
          queueTail: 0n,
          "activeRequestId.ALICE": 0n,
          "claimableAssets.ALICE": reserved,
          "requestOwner.4": "0".repeat(40),
        }, "final queue processing");
        assertCore(snapshot);
      },
      assertEvents(events, _receipt, pre, post) {
        assertEventValues(events, "QueueProcessed", {
          requestId: 4n,
          sharesBurned: bigint(pre.totalSupply) - bigint(post.totalSupply),
          assetsReserved: bigint(post.claimableAssets.ALICE) - bigint(pre.claimableAssets.ALICE),
          fullyProcessed: true,
        });
      },
    },
    "607": {
      ...tx("ALICE claims final processed portion", "ALICE", "VAULT_PROXY", "YieldVault",
        "claim", { receiver: addresses.ALICE }, ["WithdrawalClaimed"]),
      expectedPostState: exactExpectedPost((expected, _preState, ctx) => {
        applyClaimExpected(expected, "ALICE", ensureDerived(ctx).SECOND_RESERVED);
      }),
      assertPost(snapshot, result) {
        const values = ensureDerived(context);
        const second = bigint(values.SECOND_RESERVED);
        assertEqual(
          actorEconomicDelta(result, snapshot, "ALICE"),
          second,
          "second ALICE queue claim"
        );
        const aggregate = bigint(values.FIRST_RESERVED) + second;
        assertCondition(
          aggregate + 1n >= bigint(values.ALICE_QUEUE_VALUE),
          "split claims within one wei below preview",
          `Split queue claims ${aggregate} are more than one wei below preview ${values.ALICE_QUEUE_VALUE}`
        );
        assertCondition(
          aggregate <= bigint(values.ALICE_QUEUE_VALUE),
          "split claims do not exceed preview",
          `Split queue claims ${aggregate} exceed preview ${values.ALICE_QUEUE_VALUE}`
        );
        assertSnapshot(snapshot, {
          totalSupply: 145n * U,
          "shares.BOB": 70n * U,
          "shares.CAROL": 75n * U,
          "shares.VAULT_PROXY": 0n,
          totalClaimableAssets: 0n,
          deployedAssets: 0n,
          "strategyDebt.STRATEGY": 0n,
        }, "final ALICE queue claim");
        assertCore(snapshot);
      },
      afterConfirm(_pre, _post, _receipt, _events, ctx) {
        recordGhost(ctx, "607", "queue claim payout", -bigint(ensureDerived(ctx).SECOND_RESERVED));
        recordProxyFlow(ctx, "607", "claim", -bigint(ensureDerived(ctx).SECOND_RESERVED));
      },
    },
    "700": observed(
      "final accounting reconciliation and success report",
      "OWNER",
      (snapshot) => {
        assertCore(snapshot);
        const values = ensureDerived(context);
        const ledger = context.journal.state.ghostLedger;
        const flowLedger = context.journal.state.proxyFlowLedger;
        assertEqual(snapshot.accountedAssets, ledger.expectedAccounted, "ghost-ledger reconciliation");
        assertEqual(snapshot.implementation, addresses.NEW_IMPLEMENTATION, "final implementation");
        assertEqual(snapshot.totalQueuedShares, "0", "final queued shares");
        assertEqual(snapshot.totalClaimableAssets, "0", "final claim liabilities");
        assertEqual(snapshot.deployedAssets, "0", "final deployed assets");
        assertEqual(
          bigint(values.FIRST_BURNED) + bigint(values.SECOND_BURNED),
          C.NEW_QUEUE_SHARES,
          "final queue burn reconciliation"
        );
        const expectedIdle = flowLedger.entries.reduce(
          (balance, entry) => balance + bigint(entry.amount),
          bigint(flowLedger.initialIdle)
        );
        assertEqual(snapshot.idle, expectedIdle, "proxy flow-ledger reconciliation");
        const outflowIds = flowLedger.entries
          .filter((entry) => bigint(entry.amount) < 0n)
          .map((entry) => `${entry.checkpoint}:${entry.category}`)
          .sort();
        assertEqual(outflowIds, [
          "100:claim",
          "101:claim",
          "210:deployment",
          "300:instant exit",
          "504:stray removal",
          "505:instant exit",
          "600:deployment",
          "603:claim",
          "607:claim",
        ].sort(), "complete proxy outflow classifications");
        assertEqual(
          [...flowLedger.queueNoMovement].sort(),
          ["601 queue request", "602 queue processing", "606 queue processing"].sort(),
          "queue calls have no token movement"
        );
        assertEqual(
          snapshot.underlying.REWARD_DISTRIBUTOR,
          bigint(values.DISTRIBUTOR_START_BALANCE) -
            bigint(values.TOTAL_CREDITED) + C.DONATION,
          "absolute final distributor balance"
        );
      },
      ["ghost ledger and all accounting identities reconcile"]
    ),
  };
}

function validateResumeMetadata(specs) {
  for (const [checkpoint, spec] of Object.entries(specs)) {
    if (spec.noTransaction || spec.expectFailure) continue;
    if (EXACT_RESUME_CHECKPOINTS.includes(checkpoint)) {
      if (typeof spec.expectedPostState !== "function") {
        throw new Error(`Checkpoint ${checkpoint} is missing exact expectedPostState metadata`);
      }
      continue;
    }
    if (!DYNAMIC_RESUME_CHECKPOINTS[checkpoint]) {
      throw new Error(`Checkpoint ${checkpoint} has no resume exactness classification`);
    }
    if (spec.expectedPostState != null) {
      throw new Error(`Checkpoint ${checkpoint} must not fake a dynamic expectedPostState`);
    }
    spec.postRules = [
      `full post-state = reconcile(checkpoint ${checkpoint}, exact pre-state, successful receipt, required events)`,
      DYNAMIC_RESUME_CHECKPOINTS[checkpoint],
      "all unchanged fields remain byte-for-byte equal to the exact pre-state",
    ];
    spec.reconcileSubmittedPostState = reconcileDynamicCheckpoint(checkpoint);
  }
  return {
    exactExpectedPostState: [...EXACT_RESUME_CHECKPOINTS],
    receiptEventReconciledDynamic: { ...DYNAMIC_RESUME_CHECKPOINTS },
    expectedFailuresUsePreState: ["102", "103"],
  };
}

async function prepareAccrualCheckpoint(
  context,
  checkpoint,
  deadline = Date.now() + POLL_LIMIT_MS
) {
  let snapshot = await context.capture();
  const existing = context.journal.state.checkpoints[checkpoint];
  const prior = existing && existing.preparation;
  if (prior && bigint(prior.lastAccrualAnchor) !== bigint(snapshot.lastAccrual)) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      null,
      "Checkpoint 410 preparation anchor no longer matches live lastAccrual",
      { preparation: prior, liveLastAccrual: snapshot.lastAccrual }
    );
  }
  const targetTimestamp = prior
    ? bigint(prior.targetTimestamp)
    : bigint(snapshot.lastAccrual) + C.ACCRUAL_WAIT;
  const preparation = {
    status: "anchored",
    lastAccrualAnchor: snapshot.lastAccrual,
    targetTimestamp: targetTimestamp.toString(),
    equations: [
      `targetTimestamp = lastAccrualAnchor + ${C.ACCRUAL_WAIT}`,
      "credited = min(projected target at execution timestamp, distributor balance, distributor allowance)",
      "post accountedAssets = pre accountedAssets + credited",
      "post lastAccrual = Accrued execution block timestamp",
    ],
    observations: prior && prior.observations || [],
  };
  context.journal.prepared(checkpoint, preparation);
  if (typeof context.faultInjector === "function") {
    await context.faultInjector("after_preparation", { checkpoint, preparation });
  }
  let block = snapshot.liveViews.blockAfter;
  while (bigint(block.timestamp) < targetTimestamp && Date.now() < deadline) {
    await sleep(Math.min(2_000, Math.max(1, deadline - Date.now())));
    block = await latestBlock(context.actors.OWNER.token);
  }
  if (bigint(block.timestamp) < targetTimestamp) {
    throw new CheckpointStop(
      checkpoint,
      "timeout",
      null,
      `Latest block timestamp ${block.timestamp} is below accrual target ${targetTimestamp}`
    );
  }
  snapshot = await context.capture();
  const pending = snapshot.liveViews.pendingAccrual;
  const modeledBefore = projectedAccrual(snapshot, snapshot.liveViews.blockBefore.timestamp);
  const modeledAfter = projectedAccrual(snapshot, snapshot.liveViews.blockAfter.timestamp);
  assertCondition(pending.target > 0n, "live pendingAccrual positive", "pendingAccrual target is zero");
  assertCondition(
    pending.target >= modeledBefore.target && pending.target <= modeledAfter.target,
    "live pendingAccrual model range",
    `Live pendingAccrual target ${pending.target} is outside modeled range ` +
      `${modeledBefore.target}..${modeledAfter.target}`
  );
  assertEqual(pending.funded, pending.target, "fully funded live pending accrual");
  assertAtLeast(snapshot.underlying.REWARD_DISTRIBUTOR, pending.funded, "distributor balance");
  assertAtLeast(snapshot.allowances.REWARD_DISTRIBUTOR, pending.funded, "distributor allowance");
  const values = ensureDerived(context);
  values.ACCRUAL_READ_BLOCK = snapshot.liveViews.blockAfter;
  values.PENDING_TARGET = pending.target.toString();
  values.PENDING_FUNDED = pending.funded.toString();
  values.PENDING_MODEL_RANGE = {
    blockBefore: snapshot.liveViews.blockBefore,
    blockAfter: snapshot.liveViews.blockAfter,
    targetBefore: modeledBefore.target.toString(),
    targetAfter: modeledAfter.target.toString(),
  };
  preparation.status = "confirmed";
  preparation.observations.push({
    observedAt: new Date().toISOString(),
    blockBefore: snapshot.liveViews.blockBefore,
    blockAfter: snapshot.liveViews.blockAfter,
    pendingTarget: pending.target.toString(),
    pendingFunded: pending.funded.toString(),
  });
  context.journal.prepared(checkpoint, preparation);
}

async function writeReport(context, outputPath) {
  const finalSnapshot = await context.capture();
  const finalCheckpoint = context.journal.state.checkpoints["700"];
  if (!finalCheckpoint || finalCheckpoint.status !== "confirmed") {
    throw new Error("Cannot write E2E report before checkpoint 700");
  }
  const ledger = context.journal.state.ghostLedger;
  assertEqual(finalSnapshot.accountedAssets, ledger.expectedAccounted, "final ghost ledger");
  const assertionResults = context.journal.state.assertionResults || {};
  const failedAssertions = Object.entries(assertionResults)
    .filter(([, passed]) => passed !== true)
    .map(([id]) => id);
  if (failedAssertions.length) {
    throw new Error(`Cannot write success report with failed assertions: ${failedAssertions.join(", ")}`);
  }
  const report = {
    schemaVersion: 1,
    type: "yield-vault-upgrade-e2e",
    createdAt: new Date().toISOString(),
    seedManifestHash: context.seedManifestHash,
    fundingManifestHash: context.fundingEvidence.hash,
    fundingRequestedRuns: context.seedManifest.fundingRequestedRuns,
    networkIdentity: context.networkIdentity,
    runbookReportHash: context.runbookReportHash,
    oldImplementation: context.addresses.OLD_IMPLEMENTATION,
    newImplementation: context.addresses.NEW_IMPLEMENTATION,
    reviewedSourceHash: context.runbook.sourceHash,
    expectedReviewedSourceHash:
      context.journal.state.configuration.expectedReviewedSourceHash,
    externalUpgrade: {
      transactionHash: context.runbook.upgradeTransactionHash,
      governanceIssueId: context.runbook.governanceIssueId,
      transactionHashes: context.runbook.externalTransactionHashes,
      requirementAssertions: context.runbook.requirementAssertions,
    },
    smokeTransactions: context.runbook.smokeTransactions,
    snapshots: {
      seed: context.seedManifest.finalUnpausedSeedSnapshot,
      runbookFinal: context.runbook.finalSnapshot,
      e2eStart: context.journal.state.checkpoints["000"].confirmedPostState,
      e2eFinal: finalSnapshot,
    },
    derived: context.journal.state.derived,
    ghostLedger: ledger,
    proxyFlowLedger: context.journal.state.proxyFlowLedger,
    resumeCompatibility: context.resumeCompatibility,
    transactions: Object.values(context.journal.state.checkpoints)
      .filter((entry) => entry.transactionHash)
      .map((entry) => ({
        checkpointId: entry.checkpointId,
        operation: entry.operation,
        transactionHash: entry.transactionHash,
        receipt: entry.receipt,
        events: entry.observedEvents || [],
      })),
    assertions: assertionResults,
    checkpointAssertions: Object.fromEntries(CHECKPOINTS.map((id) => [
      id,
      context.journal.state.checkpoints[id] &&
        context.journal.state.checkpoints[id].status === "confirmed",
    ])),
    runState: {
      path: context.journal.path,
      schemaVersion: context.journal.state.schemaVersion,
      scriptHash: context.scriptHash,
      configHash: context.configHash,
      networkIdentity: context.journal.state.networkIdentity,
      checkpoints: context.journal.state.checkpoints,
      interruptions: context.journal.state.interruptions,
      resumeHistory: context.journal.state.resumeHistory || [],
    },
    checkpoint700Complete: true,
  };
  atomicWrite(outputPath, report);
}

async function assertCheckpointState(checkpoint, context, specs) {
  return assertResumeState(context, checkpoint, CHECKPOINTS, specs[checkpoint]);
}

function migrateUnstartedRunMetadata(context) {
  const state = context.journal.state;
  const started = Object.values(state.checkpoints || {})
    .some((entry) => entry && entry.status);
  if (started ||
      state.scriptHash === context.scriptHash &&
      state.configHash === context.configHash) {
    return false;
  }
  state.scriptHash = context.scriptHash;
  state.configHash = context.configHash;
  state.configuration = context.configuration;
  context.journal.save();
  return true;
}

function migratePreparedAccrualWait(context) {
  const state = context.journal.state;
  const entry = state.checkpoints && state.checkpoints["410"];
  const preparation = entry && entry.preparation;
  if (!entry || entry.status !== "prepared" || entry.transactionHash ||
      !preparation || preparation.status !== "anchored") {
    return false;
  }
  const anchor = bigint(preparation.lastAccrualAnchor);
  const priorTarget = bigint(preparation.targetTimestamp);
  const priorWait = priorTarget - anchor;
  if (priorWait !== 3600n || C.ACCRUAL_WAIT >= priorWait) return false;
  preparation.targetTimestamp = (anchor + C.ACCRUAL_WAIT).toString();
  preparation.equations = [
    `targetTimestamp = lastAccrualAnchor + ${C.ACCRUAL_WAIT}`,
    "credited = min(projected target at execution timestamp, distributor balance, distributor allowance)",
    "post accountedAssets = pre accountedAssets + credited",
    "post lastAccrual = Accrued execution block timestamp",
  ];
  preparation.waitMigration = {
    previousWaitSeconds: priorWait.toString(),
    waitSeconds: C.ACCRUAL_WAIT.toString(),
    migratedAt: new Date().toISOString(),
  };
  state.scriptHash = context.scriptHash;
  state.configHash = context.configHash;
  state.configuration = context.configuration;
  context.journal.save();
  return true;
}

function migrateSubmittedDonationSnapshot(context) {
  const state = context.journal.state;
  const entry = state.checkpoints && state.checkpoints["502"];
  const latest = state.interruptions && state.interruptions[state.interruptions.length - 1];
  const differences = latest && latest.latestStatus && latest.latestStatus.postStateDifferences;
  const priorConfiguration = cloneSnapshot(state.configuration || {});
  const currentConfiguration = cloneSnapshot(context.configuration || {});
  delete priorConfiguration.commonHash;
  delete currentConfiguration.commonHash;
  if (!entry || entry.status !== "submitted" || !entry.transactionHash ||
      !latest || latest.checkpointId !== "502" ||
      !Array.isArray(differences) || differences.length !== 1 ||
      differences[0].field !== "freeIdleForInstantWithdrawals" ||
      bigint(differences[0].observed) - bigint(differences[0].expected) !== C.DONATION ||
      stableJson(priorConfiguration) !== stableJson(currentConfiguration)) {
    return false;
  }
  state.snapshotDerivationMigration = {
    type: "reconciled-instant-withdrawal-liquidity",
    checkpointId: "502",
    previousScriptHash: state.scriptHash,
    previousConfigHash: state.configHash,
    migratedAt: new Date().toISOString(),
  };
  state.scriptHash = context.scriptHash;
  state.configHash = context.configHash;
  state.configuration = context.configuration;
  context.journal.save();
  return true;
}

function migrateMissingLossDeploymentFlow(context) {
  const state = context.journal.state;
  const ledger = state.proxyFlowLedger;
  const checkpoint = state.checkpoints && state.checkpoints["210"];
  if (!ledger || !Array.isArray(ledger.entries) ||
      !checkpoint || checkpoint.status !== "confirmed" ||
      ledger.entries.some((entry) => entry.checkpoint === "210")) {
    return false;
  }
  const entry = {
    checkpoint: "210",
    category: "deployment",
    direction: "outflow",
    amount: (-80n * U).toString(),
  };
  const nextIndex = ledger.entries.findIndex((candidate) => candidate.checkpoint === "213");
  if (nextIndex < 0) ledger.entries.push(entry);
  else ledger.entries.splice(nextIndex, 0, entry);
  state.proxyFlowLedgerMigration = {
    type: "missing-loss-test-deployment-outflow",
    checkpointId: "210",
    amount: entry.amount,
    previousScriptHash: state.scriptHash,
    previousConfigHash: state.configHash,
    migratedAt: new Date().toISOString(),
  };
  state.scriptHash = context.scriptHash;
  state.configHash = context.configHash;
  state.configuration = context.configuration;
  context.journal.save();
  return true;
}

async function main() {
  let args;
  try {
    args = parseArgs(
      process.argv.slice(2),
      ["seed-manifest", "funding-manifest", "runbook-report", "run-state"]
    );
  } catch (error) {
    usage();
    throw error;
  }
  if (args.help) {
    usage();
    return;
  }
  for (const required of [
    "NODE_URL", "OAUTH_URL", "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET",
    "EXPECTED_REVIEWED_SOURCE_HASH", "EXPECTED_NETWORK_ID",
  ]) {
    env(required);
  }

  const seedPath = path.resolve(args["seed-manifest"]);
  const fundingPath = path.resolve(args["funding-manifest"]);
  const runbookPath = path.resolve(args["runbook-report"]);
  const seedManifest = readJson(seedPath);
  const runbookReportRaw = readJson(runbookPath);
  const runbook = parseRunbookReport(runbookReportRaw);
  if (seedManifest.schemaVersion !== 1 || seedManifest.type !== "yield-vault-old-seed") {
    throw new Error("Seed manifest has an unsupported schema or type");
  }
  if (!seedManifest.checkpoint190Complete) {
    throw new Error("Seed manifest does not confirm checkpoint 190");
  }
  assertEqual(seedManifest.U, U.toString(), "seed U");
  assertEqual(seedManifest.assetDecimals, "18", "seed asset decimals");
  assertEqual(
    String(seedManifest.network.nodeUrl).replace(/\/$/, ""),
    rootNodeUrl(),
    "seed network"
  );

  const actors = await authenticateActors([
    "OWNER", "APPROVER", "ALICE", "BOB", "CAROL", "STRATEGY",
    "SMOKE_USER", "REWARD_DISTRIBUTOR", "DAVE", "DONOR",
  ]);
  const networkIdentity = await fetchNetworkIdentity(actors.OWNER.token);
  const seedNetworkAssertions = validateManifestNetworkIdentity(
    "seed",
    seedManifest,
    networkIdentity
  );
  const seedActors = seedManifest.actors || {};
  for (const name of ["OWNER", "ALICE", "BOB", "CAROL", "STRATEGY"]) {
    assertEqual(actors[name].address, normalizeAddress(seedActors[name], `seed ${name}`), `${name} address`);
  }
  const smokeUser = normalizeAddress(
    reportField(runbookReportRaw, ["actors.SMOKE_USER", "SMOKE_USER", "smokeUser"]),
    "SMOKE_USER"
  );
  assertEqual(actors.SMOKE_USER.address, smokeUser, "SMOKE_USER address");
  const addresses = {
    ...Object.fromEntries(Object.entries(actors).map(([name, actor]) => [name, actor.address])),
    VAULT_OWNER: normalizeAddress(env("VAULT_OWNER_ADDRESS"), "VAULT_OWNER_ADDRESS"),
    LOSS_SINK: normalizeAddress(seedActors.LOSS_SINK, "seed LOSS_SINK"),
    ASSET: normalizeAddress(seedManifest.addresses.ASSET, "seed ASSET"),
    OLD_IMPLEMENTATION: normalizeAddress(
      seedManifest.addresses.OLD_IMPLEMENTATION,
      "seed OLD_IMPLEMENTATION"
    ),
    NEW_IMPLEMENTATION: runbook.newImplementation,
    VAULT_PROXY: normalizeAddress(seedManifest.addresses.VAULT_PROXY, "seed VAULT_PROXY"),
    SMOKE_USER: smokeUser,
  };
  assertEqual(
    addresses.VAULT_OWNER,
    normalizeAddress(
      seedManifest.addresses.VAULT_OWNER || seedManifest.finalUnpausedSeedSnapshot.owner,
      "seed VAULT_OWNER"
    ),
    "VAULT_OWNER address"
  );
  if (process.env.NEW_IMPLEMENTATION) {
    assertEqual(
      addresses.NEW_IMPLEMENTATION,
      normalizeAddress(process.env.NEW_IMPLEMENTATION, "NEW_IMPLEMENTATION"),
      "configured new implementation"
    );
  }
  if (addresses.NEW_IMPLEMENTATION === addresses.OLD_IMPLEMENTATION) {
    throw new Error("NEW_IMPLEMENTATION must differ from OLD_IMPLEMENTATION");
  }
  assertDistinctAddresses({
    OWNER: addresses.OWNER,
    ALICE: addresses.ALICE,
    BOB: addresses.BOB,
    CAROL: addresses.CAROL,
    STRATEGY: addresses.STRATEGY,
    LOSS_SINK: addresses.LOSS_SINK,
    REWARD_DISTRIBUTOR: addresses.REWARD_DISTRIBUTOR,
    DAVE: addresses.DAVE,
    DONOR: addresses.DONOR,
    SMOKE_USER: addresses.SMOKE_USER,
    VAULT_PROXY: addresses.VAULT_PROXY,
  });

  const fundingEvidence = loadFundingEvidence(fundingPath);
  assertEqual(
    fundingEvidence.hash,
    seedManifest.fundingManifestHash || seedManifest.fundingEvidence && seedManifest.fundingEvidence.hash,
    "seed funding-manifest hash"
  );
  const fundingAssertions = validateFundingManifest(
    fundingEvidence,
    addresses,
    seedManifest,
    networkIdentity
  );
  let minterAdminMembership = null;
  const fundingAuthorities = fundingEvidence.manifest.authorities || {};
  if (Object.values(fundingAuthorities).some((authority) =>
    authority && authority.mode === "admin-registry")) {
    minterAdminMembership = await readAdminMembership(
      actors.OWNER.token,
      normalizeAddress(fundingEvidence.manifest.actors.MINTER, "funding MINTER"),
      ADMIN_REGISTRY
    );
    if (minterAdminMembership <= 0n) {
      throw new Error("Funding MINTER is no longer a live AdminRegistry admin");
    }
  }
  const feePolicy = reviewedPolicyForNetwork(networkIdentity.networkID);
  assertEqual(
    normalizeAddress(fundingEvidence.manifest.addresses.FEE_TOKEN, "funding fee token"),
    feePolicy.feeToken,
    "reviewed fee token"
  );
  assertEqual(
    fundingEvidence.manifest.network.transactionFeeWei,
    feePolicy.feeWei,
    "reviewed transaction fee"
  );
  const liveFeePolicyEvidence = await readFeePolicyEvidence(
    actors.OWNER.token,
    networkIdentity.networkID,
    feePolicy.feeToken
  );
  const ownerAuthority = await validateStorageOwnerAuthority(
    actors.OWNER,
    addresses.VAULT_OWNER
  );
  const approverAuthority = await validateStorageOwnerAuthority(
    actors.APPROVER,
    ADMIN_REGISTRY
  );
  if (actors.APPROVER.address === actors.OWNER.address) {
    throw new Error("APPROVER must differ from OWNER");
  }
  const assetContractName = process.env.ASSET_CONTRACT_NAME || "Token";
  const seedManifestHash = hashFile(seedPath);
  const runbookReportHash = hashFile(runbookPath);
  const context = createContext({
    scriptName: SCRIPT_NAME,
    scriptPath: __filename,
    runStatePath: args["run-state"],
    actors,
    addresses,
    ownerAuthority,
    approverAuthority,
    minterAdminMembership: minterAdminMembership == null
      ? null
      : minterAdminMembership.toString(),
    registryScope: "e2e",
    assetContractName,
    requestIds: [1, 2, 3, 4],
    seedManifest,
    seedManifestHash,
    runbook,
    runbookReportHash,
    fundingEvidence,
    networkIdentity,
    feePolicy: {
      ...feePolicy,
      feeToken: liveFeePolicyEvidence.verifiedFeeToken,
      feeWei: liveFeePolicyEvidence.verifiedFeeWei,
      liveEvidence: liveFeePolicyEvidence,
    },
    resumeCompatibility: {
      exactExpectedPostState: [...EXACT_RESUME_CHECKPOINTS],
      receiptEventReconciledDynamic: { ...DYNAMIC_RESUME_CHECKPOINTS },
      expectedFailuresUsePreState: ["102", "103"],
    },
    configuration: {
      addresses,
      ownerAuthority,
      approverAuthority,
      assetContractName,
      networkIdentity,
      expectedNetworkId: env("EXPECTED_NETWORK_ID"),
      expectedNetworkName: process.env.EXPECTED_NETWORK_NAME &&
        process.env.EXPECTED_NETWORK_NAME.trim() || null,
      seedManifestHash,
      runbookReportHash,
      expectedReviewedSourceHash: env("EXPECTED_REVIEWED_SOURCE_HASH"),
      constants: Object.fromEntries(Object.entries(C).map(([key, value]) => [key, value.toString()])),
      RAY: RAY.toString(),
      MAX_RATE: MAX_RATE.toString(),
      commonHash: hashFile(path.join(__dirname, "common.js")),
      fundingManifestHash: fundingEvidence && fundingEvidence.hash,
      feePolicy,
      resumeCompatibility: {
        exactExpectedPostState: [...EXACT_RESUME_CHECKPOINTS],
        receiptEventReconciledDynamic: { ...DYNAMIC_RESUME_CHECKPOINTS },
        expectedFailuresUsePreState: ["102", "103"],
      },
    },
  });
  const captureStorageSnapshot = context.capture.bind(context);
  context.capture = async () => attachLiveViews(context, await captureStorageSnapshot());
  context.captureCheckpointEvidence = async () => ({
    networkIdentity: context.networkIdentity,
    resumeCompatibility: context.resumeCompatibility,
  });
  assertionContext = context;

  await runWithJournal(context, async () => {
    migrateUnstartedRunMetadata(context);
    migratePreparedAccrualWait(context);
    migrateSubmittedDonationSnapshot(context);
    migrateMissingLossDeploymentFlow(context);
    context.journal.state.liveFeePolicyEvidence = liveFeePolicyEvidence;
    context.journal.state.networkIdentity = networkIdentity;
    context.journal.state.assertionResults = {
      ...(context.journal.state.assertionResults || {}),
      "seed.schemaAndType": true,
      "seed.checkpoint190Complete": true,
      "seed.unitsAndDecimals": true,
      "seed.network": true,
      "input.authenticatedActorAddresses": true,
      "input.distinctAddresses": true,
      "input.newImplementationDistinct": true,
      "input.fundingManifestHash": true,
      "network.liveMetadataValidated": true,
      "network.syncedTestnet": true,
      ...seedNetworkAssertions,
      ...runbook.assertions,
      ...fundingAssertions,
    };
    context.journal.state.resumeHistory = context.journal.state.resumeHistory || [];
    ensureDerived(context);
    const fundingManifest = fundingEvidence.manifest;
    const feeToken = normalizeAddress(fundingManifest.addresses.FEE_TOKEN, "funding fee token");
    const transactionFee = bigint(
      fundingManifest.network.transactionFeeWei,
      "funding transaction fee"
    );
    const confirmed = Object.entries(context.journal.state.checkpoints)
      .filter(([, entry]) => entry.status === "confirmed")
      .map(([id]) => id);
    const firstUnconfirmed = CHECKPOINTS.find((id) => !confirmed.includes(id));
    if (!args.checkpoint && confirmed.length && firstUnconfirmed) {
      throw new Error(`Unfinished run exists; resume with --checkpoint ${firstUnconfirmed}`);
    }
    const start = args.checkpoint || firstUnconfirmed || "700";
    const specs = buildSpecs(context);
    assertEqual(
      validateResumeMetadata(specs),
      context.resumeCompatibility,
      "resume metadata classification"
    );
    if (args.checkpoint) {
      assertionCheckpoint = `resume_${start}`;
      await assertCheckpointState(start, context, specs);
      context.journal.state.resumeHistory.push({
        checkpointId: start,
        assertedAt: new Date().toISOString(),
        scriptHash: context.scriptHash,
        configHash: context.configHash,
        network: context.journal.state.network,
        networkIdentity: context.journal.state.networkIdentity,
        checkpointStatus:
          context.journal.state.checkpoints[start] &&
          context.journal.state.checkpoints[start].status || null,
        latestInterruption:
          [...context.journal.state.interruptions].reverse()
            .find((entry) => entry.checkpointId === start) || null,
        stateMatchedSavedEvidence: true,
      });
      context.journal.save();
    }
    if (firstUnconfirmed) {
      const freshRun = Object.keys(context.journal.state.checkpoints).length === 0;
      const fundingSnapshot = await context.capture();
      const freshUnderlying = {
        STRATEGY: 210n * U,
        REWARD_DISTRIBUTOR: C.REWARD_BUDGET,
        DONOR: C.DONATION,
        DAVE: C.DAVE_DEPOSIT,
      };
      const fundingActors = [
        "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY",
        "REWARD_DISTRIBUTOR", "DAVE", "DONOR",
      ];
      const flows = { ...E2E_FUNDING_FLOWS };
      const deployAmount = ensureDerived(context).DEPLOY_AMOUNT;
      if (deployAmount != null) {
        flows["600"] = [{ actor: "STRATEGY", delta: bigint(deployAmount) }];
        flows["605"] = [{ actor: "STRATEGY", delta: -bigint(deployAmount) }];
      }
      const freshRequirements = remainingCheckpointRequirements(
        CHECKPOINTS,
        CHECKPOINTS[0],
        specs,
        { checkpoints: {} },
        flows
      );
      const remaining = freshRun
        ? {
            underlying: freshUnderlying,
            calls: freshRequirements.calls,
            included: [...CHECKPOINTS],
          }
        : remainingCheckpointRequirements(
            CHECKPOINTS,
            start,
            specs,
            context.journal.state,
            flows,
            fundingSnapshot,
            context
          );
      const feeBalances = await readTokenBalances(
        actors.OWNER.token,
        feeToken,
        Object.fromEntries(fundingActors.map((name) => [name, addresses[name]])),
        assetContractName
      );
      const liveFundingChecks = {
        checkedAt: new Date().toISOString(),
        mode: freshRun ? "fresh-full-budget" : "resume-remaining-checkpoints",
        startCheckpoint: start,
        includedCheckpoints: remaining.included,
        asset: addresses.ASSET,
        feeToken,
        underlying: {},
        fees: {},
      };
      for (const actor of fundingActors) {
        const required = remaining.underlying[actor] || 0n;
        if (required > 0n) {
          assertAtLeast(fundingSnapshot.underlying[actor], required, `${actor} live underlying`);
        }
        liveFundingChecks.underlying[actor] = {
          required: required.toString(),
          observed: fundingSnapshot.underlying[actor],
        };
        const calls = remaining.calls[actor] || 0n;
        const feeRequired = calls * transactionFee;
        const combinedRequired = feeToken === addresses.ASSET
          ? feeRequired + required
          : feeRequired;
        assertAtLeast(feeBalances[actor], combinedRequired, `${actor} live fee-token balance`);
        liveFundingChecks.fees[actor] = {
          calls: calls.toString(),
          required: feeRequired.toString(),
          combinedWithUnderlyingRequired: combinedRequired.toString(),
          observed: feeBalances[actor],
        };
      }
      context.journal.state.liveFundingChecks = liveFundingChecks;
      context.journal.save();
    } else {
      context.journal.state.liveFundingChecks = {
        checkedAt: new Date().toISOString(),
        mode: "completed-final-state-only",
        startCheckpoint: start,
        underlying: {},
        fees: {},
      };
      context.journal.save();
    }
    const startIndex = CHECKPOINTS.indexOf(start);
    if (startIndex < 0) throw new Error(`Unknown checkpoint ${start}`);
    for (let index = startIndex; index < CHECKPOINTS.length; index++) {
      const checkpoint = CHECKPOINTS[index];
      const next = CHECKPOINTS[index + 1] || "DONE";
      const checkpointDeadline = Date.now() + POLL_LIMIT_MS;
      assertionCheckpoint = checkpoint;
      if (checkpoint === "410" &&
          (!context.journal.state.checkpoints["410"] ||
           context.journal.state.checkpoints["410"].status === "prepared")) {
        await prepareAccrualCheckpoint(context, checkpoint, checkpointDeadline);
      }
      const result = await executeCheckpoint(
        context,
        checkpoint,
        next,
        specs[checkpoint],
        checkpointDeadline
      );
      context.journal.state.assertionResults[`checkpoint.${checkpoint}.confirmed`] =
        result.status === "confirmed" ||
        context.journal.state.checkpoints[checkpoint].status === "confirmed";
      if (specs[checkpoint].expectFailure) {
        context.journal.state.assertionResults[
          `checkpoint.${checkpoint}.expectedFailureAtomicity`
        ] = context.journal.state.checkpoints[checkpoint].expectedFailureConfirmed === true;
      }
      if ((specs[checkpoint].events || []).length) {
        const observed = new Set(
          (context.journal.state.checkpoints[checkpoint].observedEvents || [])
            .map((event) => event.eventName)
        );
        context.journal.state.assertionResults[`checkpoint.${checkpoint}.requiredEvents`] =
          specs[checkpoint].events.every((eventName) => observed.has(eventName));
      }
      context.journal.save();
    }

    const reportPath = process.env.E2E_REPORT_PATH ||
      `${path.resolve(args["run-state"]).replace(/\.json$/i, "")}.report.json`;
    await writeReport(context, reportPath);
    console.log(`E2E_REPORT path=${path.resolve(reportPath)}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${SCRIPT_NAME} failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHECKPOINTS,
  main,
  assertStartingState,
  projectedAccrual,
  previewDeposit,
  previewRedeem,
  previewWithdraw,
  maxDeploy,
  maxRedeemFor,
  parseRunbookReport,
  validateFundingManifest,
  fetchNetworkIdentity,
  validateManifestNetworkIdentity,
  validateSmokeTransactions,
  viewResultValue,
  pendingAccrualResult,
  attachLiveViews,
  prepareAccrualCheckpoint,
  refreshSnapshotDerived,
  exactExpectedPost,
  applyClaimExpected,
  reconcileDynamicCheckpoint,
  buildSpecs,
  migratePreparedAccrualWait,
  migrateMissingLossDeploymentFlow,
  migrateSubmittedDonationSnapshot,
  migrateUnstartedRunMetadata,
  validateResumeMetadata,
  EXACT_RESUME_CHECKPOINTS,
  DYNAMIC_RESUME_CHECKPOINTS,
};
