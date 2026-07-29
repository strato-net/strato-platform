#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { rest } = require("blockapps-rest");
const {
  config,
  fetchExpectedTestnetNetwork,
  rootNodeUrl,
} = require("./runtime");
const {
  RAY,
  atomicWrite,
  authenticateActors,
  bigint,
  field,
  latestBlock,
  normalizeAddress,
  readJson,
  readVaultSnapshot,
  stableJson,
  validateStorageOwnerAuthority,
} = require("./common");
const {
  assertStartingState,
  attachLiveViews,
  parseRunbookReport,
  validateManifestNetworkIdentity,
  validateSmokeTransactions,
} = require("./run-yield-vault-upgrade-e2e");
const {
  ADMIN_REGISTRY,
  assertOrdered,
  dedupeOrderedPoints,
  getGlobalEvent,
  getRawTransaction,
  hash: normalizeHash,
  orderedPoint,
  validateGovernedOperation,
  validateFailedGovernedExecution,
  validateReceipt,
  validateTargetEvents,
  validateTransactionEvidence,
  verifyRawDeployment,
} = require("./evidence-verifier");
const { submittedSourceHash } = require("./upgrade-safety");

const TX_HASH_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const REQUIRED_MANUAL_TRANSACTIONS = {
  pause: {
    actor: "OWNER", contractName: "YieldVault", method: "pause",
    contractRole: "VAULT_PROXY", success: true, event: "Paused",
    onlyOwner: true, governed: true, registryContract: "YieldVault",
    adminOrderIndependent: true, allowCastVoteOnIssue: true,
  },
  initializeAccrual: {
    actor: "OWNER",
    contractName: "YieldVault",
    method: "initializeAccrual",
    contractRole: "VAULT_PROXY",
    success: true,
    event: "AccrualInitialized",
    onlyOwner: true,
    governed: true,
    registryContract: "YieldVault",
    adminOrderIndependent: true,
    allowCastVoteOnIssue: true,
  },
  initializeAccrualRepeat: {
    actor: "OWNER",
    contractName: "YieldVault",
    method: "initializeAccrual",
    contractRole: "VAULT_PROXY",
    success: false,
    onlyOwner: true,
    governed: true,
    registryContract: "YieldVault",
    adminOrderIndependent: true,
    allowCastVoteOnIssue: true,
  },
  distributorApproval: {
    actor: "REWARD_DISTRIBUTOR",
    contractName: "Token",
    method: "approve",
    contractRole: "ASSET",
    success: true,
    event: "Approval",
  },
  setRewardDistributor: {
    actor: "OWNER",
    contractName: "YieldVault",
    method: "setRewardDistributor",
    contractRole: "VAULT_PROXY",
    success: true,
    event: "RewardDistributorUpdated",
    onlyOwner: true,
    governed: true,
    registryContract: "YieldVault",
    adminOrderIndependent: true,
    allowCastVoteOnIssue: true,
  },
  setPerSecondSavingsRate: {
    actor: "OWNER",
    contractName: "YieldVault",
    method: "setPerSecondSavingsRate",
    contractRole: "VAULT_PROXY",
    success: true,
    event: "PerSecondSavingsRateUpdated",
    onlyOwner: true,
    governed: true,
    registryContract: "YieldVault",
    adminOrderIndependent: true,
    allowCastVoteOnIssue: true,
  },
  smokeUserApproval: {
    actor: "SMOKE_USER",
    contractName: "Token",
    method: "approve",
    contractRole: "ASSET",
    success: true,
    event: "Approval",
  },
  unpause: {
    actor: "OWNER", contractName: "YieldVault", method: "unpause",
    contractRole: "VAULT_PROXY", success: true, event: "Unpaused",
    onlyOwner: true, governed: true, registryContract: "YieldVault",
    adminOrderIndependent: true, allowCastVoteOnIssue: true,
  },
};
const ECONOMIC_SMOKE_TRANSACTIONS = [
  {
    name: "smokeDeposit", actor: "SMOKE_USER", contractName: "YieldVault",
    contractRole: "VAULT_PROXY", method: "deposit", success: true, event: "Deposit",
  },
  {
    name: "smokeRedeemOrQueue", actor: "SMOKE_USER", contractName: "YieldVault",
    contractRole: "VAULT_PROXY", method: "redeemOrQueue", success: true,
    event: "WithdrawalRequested",
  },
  {
    name: "smokeProcessQueue", actor: "OWNER", contractName: "YieldVault",
    contractRole: "VAULT_PROXY", method: "processQueue", success: true,
    event: "QueueProcessed", onlyOwner: true, governed: true,
    registryContract: "YieldVault",
  },
  {
    name: "smokeClaim", actor: "SMOKE_USER", contractName: "YieldVault",
    contractRole: "VAULT_PROXY", method: "claim", success: true,
    event: "WithdrawalClaimed",
  },
];
const PRESERVED_SEED_FIELDS = [
  "owner", "proxyOwner", "asset", "name", "symbol", "minIdleBps", "deployedAssets",
  "idle", "totalAssets", "activeAssets", "exchangeRate",
  "totalSupply", "nextRequestId", "queueHead", "queueTail",
  "totalQueuedShares", "totalClaimableAssets", "underlying.VAULT_PROXY",
  "shares", "strategyDebt", "approvedStrategies", "activeRequestId",
  "claimableAssets", "requests", "requestOwner",
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: node generate-safe-upgrade-report.js " +
        "--seed-manifest <path> --funding-manifest <path> " +
        "--upgrade-evidence <path> --manual-evidence <path> " +
        "[--rollback-drill <path>] --output <path>"
      );
    }
    parsed[key.slice(2)] = path.resolve(value);
  }
  const envDefaults = {
    "seed-manifest": process.env.SEED_MANIFEST_PATH,
    "funding-manifest": process.env.YIELD_VAULT_FUNDING_MANIFEST,
    "upgrade-evidence": process.env.UPGRADE_EVIDENCE_PATH,
    "manual-evidence": process.env.MANUAL_UPGRADE_EVIDENCE_PATH,
    "rollback-drill": process.env.ROLLBACK_DRILL_EVIDENCE_PATH,
    output: process.env.RUNBOOK_REPORT_PATH,
  };
  for (const [key, value] of Object.entries(envDefaults)) {
    if (!parsed[key] && value) parsed[key] = path.resolve(value);
  }
  for (const key of [
    "seed-manifest",
    "funding-manifest",
    "upgrade-evidence",
    "manual-evidence",
    "output",
  ]) {
    if (!parsed[key]) throw new Error(`Missing required argument --${key}`);
  }
  return parsed;
}

async function validateRollbackDrill(
  tokenObj,
  artifact,
  proxyAddress,
  newImplementation,
  oldImplementation,
  addresses
) {
  if (!artifact || artifact.type !== "proxy-upgrade-evidence" ||
      artifact.mode !== "rollback" || artifact.completed !== true) {
    throw new Error("Rollback drill evidence is incomplete or unsupported");
  }
  const rollback = (artifact.upgrades || [])[0];
  const operation = artifact.operations && artifact.operations["rollback-pointer"];
  if (!rollback || !operation || operation.status !== "confirmed" ||
      normalizeAddress(rollback.proxyAddress) !== proxyAddress ||
      normalizeAddress(rollback.previousImplementation) !== newImplementation ||
      normalizeAddress(rollback.newImplementation) !== oldImplementation ||
      normalizeAddress(rollback.confirmedImplementation) !== oldImplementation) {
    throw new Error("Rollback drill does not prove the expected pointer restoration");
  }
  if (normalizeAddress(artifact.operatorSigner, "rollback operator signer") !==
        addresses.OWNER ||
      !operation.signer || operation.signer.role !== "OWNER" ||
      normalizeAddress(operation.signer.address, "rollback operation signer") !==
        addresses.OWNER) {
    throw new Error("Rollback drill is not exclusively signed by OWNER");
  }
  const expected = {
    name: "rollback drill pointer",
    actor: "OWNER",
    contractRole: "VAULT_PROXY",
    method: "setLogicContract",
    arguments: { _logicContract: "OLD_IMPLEMENTATION" },
    success: true,
  };
  const live = operation.governanceIssueId
    ? await validateGovernedOperation(tokenObj, operation, expected, addresses)
    : await validateTransactionEvidence(tokenObj, {
        ...operation,
        arguments: expected.arguments,
        contractAddress: proxyAddress,
        events: [],
      }, expected, addresses);
  return {
    validated: true,
    submissionTransactionHash: live.submissionHash || live.transactionHash,
    executionTransactionHash: live.executionHash || null,
    comparison: operation.result && operation.result.rollbackComparison || null,
  };
}

function assertSubset(actual, expected, label) {
  function compare(observed, wanted, location) {
    if (wanted && typeof wanted === "object" && !Array.isArray(wanted)) {
      for (const [key, value] of Object.entries(wanted)) {
        compare(observed && observed[key], value, `${location}.${key}`);
      }
      return;
    }
    if (stableJson(observed) !== stableJson(wanted)) {
      throw new Error(
        `${location} mismatch: expected ${stableJson(wanted)}, observed ${stableJson(observed)}`
      );
    }
  }
  compare(actual, expected, label);
}

function chainOrder(points) {
  return [...points].sort((left, right) => {
    if (left.block !== right.block) return left.block < right.block ? -1 : 1;
    if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1;
    const leftIndex = left.eventIndex == null ? left.transactionIndex : left.eventIndex;
    const rightIndex = right.eventIndex == null ? right.transactionIndex : right.eventIndex;
    if (leftIndex != null && rightIndex != null && leftIndex !== rightIndex) {
      return leftIndex < rightIndex ? -1 : 1;
    }
    return 0;
  });
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce(
    (current, key) => current == null ? undefined : current[key],
    object
  );
}

function validatePreservedSeedState(snapshot, seedSnapshot, label) {
  for (const field of PRESERVED_SEED_FIELDS) {
    const actual = valueAt(snapshot, field);
    const expected = valueAt(seedSnapshot, field);
    assertSubset(actual, expected, `${label}.${field}`);
  }
}

function receiptSucceeded(receipt) {
  return receipt && receipt.status === "Success";
}

function transactionHashOf(value) {
  return value && (
    value.transaction_hash || value.transactionHash || value.txHash || value.hash
  );
}

function timestampOf(value) {
  return value && (
    value.block_timestamp || value.blockTimestamp || value.timestamp
  );
}

function resolveSnapshot(manualEvidence, name, evidencePath) {
  if (manualEvidence[name] && typeof manualEvidence[name] === "object") {
    return manualEvidence[name];
  }
  const snapshotFile = manualEvidence[`${name}File`];
  if (!snapshotFile) return null;
  return readJson(path.resolve(path.dirname(evidencePath), snapshotFile));
}

function validateManualTransactions(transactions, addresses) {
  if (!transactions || typeof transactions !== "object" || Array.isArray(transactions)) {
    throw new Error("Manual evidence must contain a transactions object");
  }
  for (const [name, expected] of Object.entries(REQUIRED_MANUAL_TRANSACTIONS)) {
    const entry = transactions[name];
    if (!entry || entry.method !== expected.method) {
      throw new Error(`Manual transaction ${name} must call ${expected.method}`);
    }
    if (entry.actor !== expected.actor) {
      throw new Error(`Manual transaction ${name} must use actor ${expected.actor}`);
    }
    if (entry.contractName !== expected.contractName) {
      throw new Error(
        `Manual transaction ${name} must use contract ${expected.contractName}`
      );
    }
    if (!entry.contractAddress) {
      throw new Error(`Manual transaction ${name} is missing contractAddress`);
    }
    if (addresses &&
        normalizeAddress(entry.contractAddress, `${name} contractAddress`) !==
          addresses[expected.contractRole]) {
      throw new Error(`Manual transaction ${name} contractAddress does not match`);
    }
    const hash = entry.executionTransactionHash || entry.transactionHash;
    if (!TX_HASH_RE.test(String(hash || ""))) {
      throw new Error(`Manual transaction ${name} has no valid transaction hash`);
    }
    const receipt = entry.executionReceipt || entry.receipt;
    validateReceipt(receipt, hash, expected.success, `manual transaction ${name}`);
    if (expected.success && (!Array.isArray(entry.events) || entry.events.length === 0)) {
      throw new Error(`Manual transaction ${name} must include observed events`);
    }
    const eventNames = (entry.events || []).map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error(`Manual transaction ${name} events must be structured records`);
      }
      const eventHash = transactionHashOf(event);
      if (String(eventHash || "").replace(/^0x/i, "").toLowerCase() !==
          String(hash).replace(/^0x/i, "").toLowerCase() ||
          !timestampOf(event) ||
          field(event, ["id", "event_index", "eventIndex"], null) == null) {
        throw new Error(`Manual transaction ${name} event evidence is incomplete`);
      }
      return event.eventName || event.event_name || event.name;
    });
    if (expected.event && !eventNames.includes(expected.event)) {
      throw new Error(`Manual transaction ${name} is missing ${expected.event}`);
    }
  }
}

function validateStructuredSmokeEvidence(smokeTransactions) {
  for (const [index, entry] of (smokeTransactions || []).entries()) {
    const hash = entry &&
      (entry.executionTransactionHash || entry.transactionHash || entry.hash);
    if (!TX_HASH_RE.test(String(hash || ""))) {
      throw new Error(`Smoke transaction ${index + 1} has no valid hash`);
    }
    validateReceipt(
      entry.executionReceipt || entry.receipt,
      hash,
      true,
      `smoke transaction ${index + 1}`
    );
    if (!Array.isArray(entry.events) || entry.events.length === 0) {
      throw new Error(`Smoke transaction ${index + 1} requires structured events`);
    }
    for (const event of entry.events) {
      if (!event || typeof event !== "object" || Array.isArray(event) ||
          String(transactionHashOf(event) || "").replace(/^0x/i, "").toLowerCase() !==
            String(hash).replace(/^0x/i, "").toLowerCase() ||
          !timestampOf(event) ||
          field(event, ["id", "event_index", "eventIndex"], null) == null) {
        throw new Error(`Smoke transaction ${index + 1} event evidence is incomplete`);
      }
    }
    if (entry.method === "processQueue") {
      const queueEvents = entry.events.filter((event) =>
        field(event, ["eventName", "event_name", "name"], null) === "QueueProcessed");
      if (queueEvents.length !== 3 ||
          queueEvents.some((event) => field(event, ["event_index", "eventIndex"], null) == null)) {
        throw new Error("Smoke processQueue requires three indexed QueueProcessed events");
      }
    }
  }
}

async function getLiveReceipt(tokenObj, transactionHash) {
  const results = await rest.getBlocResults(
    tokenObj,
    [transactionHash],
    { config, isAsync: true }
  );
  return Array.isArray(results) ? results[0] : results;
}

function matchesRole(value, role, addresses) {
  if (String(value || "").toUpperCase() === role) return true;
  try {
    return normalizeAddress(value) === addresses[role];
  } catch (_) {
    return false;
  }
}

function validateManualArguments(transactions, addresses) {
  const approval = transactions.distributorApproval.arguments || {};
  if (!matchesRole(approval.spender, "VAULT_PROXY", addresses) ||
      bigint(approval.value || 0) < 30n * 10n ** 18n) {
    throw new Error("Distributor approval must authorize VAULT_PROXY for at least 30 underlying");
  }
  const smokeApproval = transactions.smokeUserApproval.arguments || {};
  if (!matchesRole(smokeApproval.spender, "VAULT_PROXY", addresses) ||
      bigint(smokeApproval.value || 0) < 10n * 10n ** 18n) {
    throw new Error("Smoke user approval must authorize VAULT_PROXY for at least 10 underlying");
  }
  const distributor = transactions.setRewardDistributor.arguments || {};
  if (!matchesRole(distributor.newRewardDistributor, "REWARD_DISTRIBUTOR", addresses)) {
    throw new Error("setRewardDistributor arguments do not match REWARD_DISTRIBUTOR");
  }
  const rate = transactions.setPerSecondSavingsRate.arguments || {};
  if (bigint(rate.newRate || 0) !== RAY) {
    throw new Error("Manual migration rate must remain neutral RAY");
  }
}

function createdAddresses(receipt) {
  const value = receipt && receipt.txResult && receipt.txResult.contractsCreated;
  const values = Array.isArray(value) ? value.flat(Infinity) : [value];
  return values.filter(Boolean).map((item) => normalizeAddress(item));
}

function validateUpgradeEvidence(
  upgradeEvidence,
  proxyAddress,
  expectedOldImplementation,
  expectedSourceHash = process.env.EXPECTED_REVIEWED_SOURCE_HASH
) {
  if (upgradeEvidence.schemaVersion !== 1 ||
      upgradeEvidence.type !== "proxy-upgrade-evidence" ||
      upgradeEvidence.completed !== true) {
    throw new Error("Upgrade evidence is incomplete or unsupported");
  }
  const upgrade = (upgradeEvidence.upgrades || []).find(
    (entry) => normalizeAddress(entry.proxyAddress) === proxyAddress
  );
  if (!upgrade) throw new Error(`Upgrade evidence does not contain proxy ${proxyAddress}`);
  if (normalizeAddress(upgrade.proxyAddress) !== proxyAddress ||
      expectedOldImplementation &&
      normalizeAddress(upgrade.previousImplementation) !== expectedOldImplementation) {
    throw new Error("Upgrade evidence old/proxy addresses do not match the seed manifest");
  }
  if (normalizeAddress(upgrade.confirmedImplementation) !==
      normalizeAddress(upgrade.newImplementation)) {
    throw new Error("Upgrade evidence does not confirm the new implementation");
  }
  const implementationHash = upgradeEvidence.implementation &&
    upgradeEvidence.implementation.submissionHashes &&
    upgradeEvidence.implementation.submissionHashes[0] ||
    upgradeEvidence.implementation &&
    upgradeEvidence.implementation.governance &&
    upgradeEvidence.implementation.governance.executionTransactionHash;
  const upgradeHash = upgrade.upgradeSubmission &&
    upgrade.upgradeSubmission.submissionHashes &&
    upgrade.upgradeSubmission.submissionHashes[0];
  if (!TX_HASH_RE.test(String(implementationHash || "")) ||
      !TX_HASH_RE.test(String(upgradeHash || ""))) {
    throw new Error("Upgrade evidence is missing deployment or upgrade transaction hashes");
  }
  const source = upgradeEvidence.source || {};
  const combined = String(source.combinedSourceHash || "").toLowerCase();
  const reviewed = String(source.reviewedSourceHash || "").toLowerCase();
  const independentlyExpected = String(expectedSourceHash || "").toLowerCase()
    .replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(combined) ||
      combined !== reviewed ||
      combined !== independentlyExpected) {
    throw new Error(
      "Upgrade source evidence must bind combinedSourceHash, reviewedSourceHash, " +
      "and EXPECTED_REVIEWED_SOURCE_HASH"
    );
  }
  const implementationAddress = normalizeAddress(upgradeEvidence.implementation.address);
  if (implementationAddress !== normalizeAddress(upgrade.newImplementation) ||
      normalizeAddress(upgradeEvidence.implementation.receiptCreatedAddress) !==
        implementationAddress) {
    throw new Error("Upgrade implementation address evidence is inconsistent");
  }
  const creationReceipt = upgradeEvidence.implementation.creationReceipt;
  if (!createdAddresses(creationReceipt).includes(implementationAddress)) {
    throw new Error("Implementation creation receipt does not contain the new address");
  }
  validateReceipt(creationReceipt, transactionHashOf(creationReceipt), true,
    "implementation creation");
  const deployOperation = upgradeEvidence.operations &&
    upgradeEvidence.operations["deploy-new-implementation"];
  const pointerOperation = upgradeEvidence.operations &&
    upgradeEvidence.operations["upgrade-pointer"];
  if (!deployOperation || deployOperation.status !== "confirmed" ||
      !pointerOperation || pointerOperation.status !== "confirmed") {
    throw new Error("Upgrade evidence is missing confirmed local workflow operations");
  }
  const deploymentSigner = normalizeAddress(
    upgradeEvidence.deploymentSigner,
    "upgrade deployment signer"
  );
  const pointerSigner = normalizeAddress(
    upgradeEvidence.operatorSigner,
    "upgrade pointer signer"
  );
  const recordedDeployer = upgradeEvidence.signers && upgradeEvidence.signers.DEPLOYER;
  const recordedOwner = upgradeEvidence.signers && upgradeEvidence.signers.OWNER;
  const recordedApprover = upgradeEvidence.signers && upgradeEvidence.signers.APPROVER;
  const approvalSigner = normalizeAddress(
    upgradeEvidence.approvalSigner,
    "upgrade approval signer"
  );
  if (deploymentSigner === pointerSigner ||
      approvalSigner === deploymentSigner || approvalSigner === pointerSigner ||
      !recordedDeployer || recordedDeployer.role !== "DEPLOYER" ||
      normalizeAddress(recordedDeployer.address, "recorded DEPLOYER signer") !==
        deploymentSigner ||
      !recordedOwner || recordedOwner.role !== "OWNER" ||
      normalizeAddress(recordedOwner.address, "recorded OWNER signer") !== pointerSigner ||
      !recordedApprover || recordedApprover.role !== "APPROVER" ||
      normalizeAddress(recordedApprover.address, "recorded APPROVER signer") !==
        approvalSigner ||
      !deployOperation.signer || deployOperation.signer.role !== "DEPLOYER" ||
      normalizeAddress(deployOperation.signer.address, "deployment operation signer") !==
        deploymentSigner ||
      !pointerOperation.signer || pointerOperation.signer.role !== "OWNER" ||
      normalizeAddress(pointerOperation.signer.address, "pointer operation signer") !==
        pointerSigner) {
    throw new Error("Upgrade evidence does not preserve DEPLOYER/OWNER/APPROVER signer separation");
  }
  return {
    upgrade,
    implementationHash: normalizeHash(implementationHash),
    upgradeHash: normalizeHash(upgradeHash),
    deployOperation,
    pointerOperation,
    sourceHash: combined,
    deploymentSigner,
    pointerSigner,
    approvalSigner,
  };
}

function governanceOperation(entry) {
  if (!entry.governanceIssueId) return null;
  return {
    ...entry,
    governanceExecution: entry.governanceExecution || {
      transactionHash: entry.executionTransactionHash,
    },
    governanceExecutionReceipt: entry.governanceExecutionReceipt ||
      entry.executionReceipt,
  };
}

async function validateLiveEntry(tokenObj, entry, expected, addresses) {
  const governed = governanceOperation(entry);
  const requiresGovernance = expected.onlyOwner === true &&
    addresses.VAULT_OWNER === ADMIN_REGISTRY;
  if (requiresGovernance && !governed) {
    throw new Error(`${expected.name} must include exact governed evidence`);
  }
  if (requiresGovernance && expected.success === false &&
      governed && (!entry.governanceExecution || !entry.governanceExecution.row) &&
      (entry.executionTransactionHash || entry.executionReceipt)) {
    return validateFailedGovernedExecution(
      tokenObj,
      governed,
      expected,
      addresses
    );
  }
  if (!governed) {
    return validateTransactionEvidence(tokenObj, entry, expected, addresses);
  }
  const governance = await validateGovernedOperation(
    tokenObj,
    governed,
    expected,
    addresses
  );
  const targetEntry = {
    ...entry,
    executionTransactionHash: governance.executionHash,
    executionReceipt: governed.governanceExecutionReceipt,
  };
  const events = await validateTargetEvents(
    tokenObj,
    targetEntry,
    expected,
    addresses
  );
  return {
    transactionHash: governance.executionHash,
    point: governance.executionPoint,
    events,
    governance,
  };
}

async function validateUpgradeOnChain(
  tokens,
  validated,
  addresses
) {
  const deployment = validated.deployOperation;
  let deploymentEvidence;
  if (deployment.governanceIssueId) {
    deploymentEvidence = await validateGovernedOperation(
      tokens.DEPLOYER,
      deployment,
      {
        name: "implementation deployment",
        actor: "DEPLOYER",
        issueOnly: {
          target: normalizeAddress(
            deployment.governanceIssueTarget,
            "implementation deployment governance target"
          ),
          func: "createContract",
          deployment: {
            contractName: "YieldVault",
            sourceHash: validated.sourceHash,
            sourceHasher: submittedSourceHash,
            constructorArgs: ["00000000000000000000000000000000deadbeef"],
          },
        },
      },
      addresses
    );
  } else {
    const raw = await getRawTransaction(tokens.DEPLOYER, validated.implementationHash);
    const verifiedDeployment = verifyRawDeployment(raw, {
      actor: "DEPLOYER",
      contractName: "YieldVault",
      sourceHash: validated.sourceHash,
      sourceHasher: submittedSourceHash,
      constructorArgs: ["00000000000000000000000000000000deadbeef"],
    }, addresses, "implementation deployment");
    const liveReceipt = await getLiveReceipt(tokens.DEPLOYER, validated.implementationHash);
    validateReceipt(
      liveReceipt,
      validated.implementationHash,
      true,
      "live implementation deployment"
    );
    deploymentEvidence = {
      submissionHash: validated.implementationHash,
      executionHash: null,
      submissionPoint: orderedPoint(raw, "implementation deployment"),
      receipt: liveReceipt,
      rawShape: verifiedDeployment.shape,
    };
  }

  const pointer = validated.pointerOperation;
  const pointerExpected = {
    name: "proxy pointer upgrade",
    actor: "OWNER",
    contractRole: "VAULT_PROXY",
    method: "setLogicContract",
    arguments: { _logicContract: "NEW_IMPLEMENTATION" },
    success: true,
  };
  const pointerEvidence = pointer.governanceIssueId
    ? await validateGovernedOperation(tokens.OWNER, pointer, pointerExpected, addresses)
    : await validateTransactionEvidence(
        tokens.OWNER,
        {
          ...pointer,
          arguments: pointerExpected.arguments,
          contractAddress: addresses.VAULT_PROXY,
          receipt: pointer.receipt,
          events: [],
        },
        pointerExpected,
        addresses
      );
  return { deployment: deploymentEvidence, pointer: pointerEvidence };
}

function validatePreUnpauseSnapshot(snapshot) {
  const views = snapshot && snapshot.liveViews;
  if (!views ||
      snapshot.paused !== true ||
      bigint(snapshot.accountedAssets) !== bigint(snapshot.idle) + bigint(snapshot.deployedAssets) ||
      bigint(views.pendingAccrual.target) < 0n ||
      bigint(views.pendingAccrual.funded) < 0n ||
      bigint(views.pendingAccrual.funded) > bigint(views.pendingAccrual.target) ||
      bigint(views.pendingAccrual.funded) >
        bigint(snapshot.underlying.REWARD_DISTRIBUTOR) ||
      bigint(views.pendingAccrual.funded) >
        bigint(snapshot.allowances.REWARD_DISTRIBUTOR) ||
      bigint(views.projectedExchangeRate) < bigint(snapshot.exchangeRate)) {
    throw new Error("Pre-smoke snapshot does not prove the required pre-unpause safety");
  }
  return true;
}

async function generateReport(args) {
  const seedManifest = readJson(args["seed-manifest"]);
  const fundingManifest = readJson(args["funding-manifest"]);
  const upgradeEvidence = readJson(args["upgrade-evidence"]);
  const manualEvidence = readJson(args["manual-evidence"]);

  if (manualEvidence.schemaVersion !== 1 ||
      manualEvidence.type !== "yield-vault-manual-upgrade-evidence") {
    throw new Error("Manual evidence has an unsupported schema or type");
  }
  validateStructuredSmokeEvidence(manualEvidence.smokeTransactions);
  const initialSnapshot = resolveSnapshot(
    manualEvidence,
    "initialSnapshot",
    args["manual-evidence"]
  );
  const postInitializationSnapshot = resolveSnapshot(
    manualEvidence,
    "postInitializationSnapshot",
    args["manual-evidence"]
  );
  const preSmokeSnapshot = resolveSnapshot(
    manualEvidence,
    "preSmokeSnapshot",
    args["manual-evidence"]
  );

  const seedSnapshot = seedManifest.finalUnpausedSeedSnapshot;
  if (!seedSnapshot) throw new Error("Seed manifest is missing finalUnpausedSeedSnapshot");
  if (!initialSnapshot || !postInitializationSnapshot || !preSmokeSnapshot) {
    throw new Error(
      "Manual evidence requires initialSnapshot, postInitializationSnapshot, and preSmokeSnapshot"
    );
  }
  const initialComparable = { ...initialSnapshot };
  delete initialComparable._evidence;
  if (stableJson(initialComparable) !== stableJson(seedSnapshot)) {
    throw new Error("Initial snapshot does not exactly match the seed manifest");
  }

  const proxyAddress = normalizeAddress(seedManifest.addresses.VAULT_PROXY);
  const expectedOldImplementation = normalizeAddress(
    seedManifest.addresses.OLD_IMPLEMENTATION
  );
  const validatedUpgrade = validateUpgradeEvidence(
    upgradeEvidence,
    proxyAddress,
    expectedOldImplementation
  );
  const { upgrade, implementationHash, upgradeHash } = validatedUpgrade;
  const newImplementation = normalizeAddress(upgrade.newImplementation);
  if (normalizeAddress(preSmokeSnapshot.implementation) !== newImplementation) {
    throw new Error("Pre-smoke snapshot does not use the upgraded implementation");
  }
  validatePreservedSeedState(
    postInitializationSnapshot,
    seedSnapshot,
    "postInitializationSnapshot"
  );
  if (normalizeAddress(postInitializationSnapshot.implementation) !==
      newImplementation ||
      postInitializationSnapshot.accrualInitialized !== true ||
      postInitializationSnapshot.paused !== true ||
      normalizeAddress(postInitializationSnapshot.rewardDistributor) !==
        "0".repeat(40) ||
      String(postInitializationSnapshot.perSecondSavingsRate) !== RAY.toString() ||
      bigint(postInitializationSnapshot.accountedAssets) !==
        bigint(postInitializationSnapshot.idle) +
          bigint(postInitializationSnapshot.deployedAssets)) {
    throw new Error("Post-initialization snapshot does not prove the expected migration state");
  }
  validatePreservedSeedState(preSmokeSnapshot, seedSnapshot, "preSmokeSnapshot");
  const fundedDistributor = fundingManifest.actors.REWARD_DISTRIBUTOR;
  const fundedDistributorAddress = normalizeAddress(
    typeof fundedDistributor === "object" ? fundedDistributor.address : fundedDistributor
  );
  if (preSmokeSnapshot.accrualInitialized !== true ||
      String(preSmokeSnapshot.perSecondSavingsRate) !== RAY.toString() ||
      preSmokeSnapshot.paused !== true ||
      normalizeAddress(preSmokeSnapshot.rewardDistributor) !==
        fundedDistributorAddress ||
      bigint(preSmokeSnapshot.underlying.REWARD_DISTRIBUTOR || 0) < 30n * 10n ** 18n ||
      bigint(preSmokeSnapshot.allowances.REWARD_DISTRIBUTOR || 0) < 30n * 10n ** 18n) {
    throw new Error("Pre-smoke snapshot does not prove neutral initialized accrual");
  }

  const fundingActors = fundingManifest.actors || {};
  const actors = await authenticateActors(["OWNER", "APPROVER", "DEPLOYER"]);
  const addresses = {
    ...Object.fromEntries(
      Object.entries(fundingActors).map(([name, value]) => [
        name,
        normalizeAddress(typeof value === "object" ? value.address : value),
      ])
    ),
    OWNER: actors.OWNER.address,
    APPROVER: actors.APPROVER.address,
    DEPLOYER: actors.DEPLOYER.address,
    VAULT_OWNER: normalizeAddress(seedSnapshot.owner, "seed storage owner"),
    ASSET: normalizeAddress(seedManifest.addresses.ASSET),
    VAULT_PROXY: proxyAddress,
    OLD_IMPLEMENTATION: normalizeAddress(seedManifest.addresses.OLD_IMPLEMENTATION),
    NEW_IMPLEMENTATION: newImplementation,
  };
  const configuredVaultOwner = process.env.VAULT_OWNER_ADDRESS;
  if (configuredVaultOwner &&
      normalizeAddress(configuredVaultOwner, "VAULT_OWNER_ADDRESS") !== addresses.VAULT_OWNER) {
    throw new Error("VAULT_OWNER_ADDRESS does not match seed storage owner");
  }
  const ownerAuthority = await validateStorageOwnerAuthority(
    actors.OWNER,
    addresses.VAULT_OWNER
  );
  const deployerAuthority = addresses.VAULT_OWNER === ADMIN_REGISTRY
    ? await validateStorageOwnerAuthority(actors.DEPLOYER, ADMIN_REGISTRY)
    : null;
  const approverAuthority = await validateStorageOwnerAuthority(
    actors.APPROVER,
    ADMIN_REGISTRY
  );
  if (addresses.APPROVER === addresses.OWNER ||
      addresses.APPROVER === addresses.DEPLOYER) {
    throw new Error("APPROVER must differ from OWNER and DEPLOYER");
  }
  if (normalizeAddress(upgradeEvidence.operatorSigner, "upgrade operator signer") !==
      addresses.OWNER ||
      normalizeAddress(upgradeEvidence.deploymentSigner, "upgrade deployment signer") !==
        addresses.DEPLOYER ||
      normalizeAddress(upgradeEvidence.approvalSigner, "upgrade approval signer") !==
        addresses.APPROVER ||
      normalizeAddress(upgradeEvidence.expectedStorageOwner, "upgrade storage owner") !==
        normalizeAddress(seedSnapshot.owner, "seed storage owner")) {
    throw new Error("Upgrade evidence does not bind deployment, pointer, and storage identities");
  }
  if (!upgradeEvidence.approvalGovernance ||
      upgradeEvidence.approvalGovernance.verified !== true ||
      normalizeAddress(upgradeEvidence.approvalGovernance.adminRegistry) !== ADMIN_REGISTRY ||
      bigint(upgradeEvidence.approvalGovernance.adminMapMembership) <= 0n ||
      approverAuthority.mode !== "admin-registry") {
    throw new Error("APPROVER signer lacks recorded and live AdminRegistry membership");
  }
  if (addresses.OWNER !== addresses.VAULT_OWNER) {
    const governance = upgradeEvidence.operatorGovernance;
    if (!governance || governance.verified !== true ||
        normalizeAddress(governance.adminRegistry) !== ADMIN_REGISTRY ||
        bigint(governance.adminMapMembership) <= 0n ||
        ownerAuthority.mode !== "admin-registry") {
      throw new Error("Separate OWNER signer lacks recorded and live AdminRegistry membership");
    }
    const deployerGovernance = upgradeEvidence.deploymentGovernance;
    if (!deployerGovernance || deployerGovernance.verified !== true ||
        normalizeAddress(deployerGovernance.adminRegistry) !== ADMIN_REGISTRY ||
        bigint(deployerGovernance.adminMapMembership) <= 0n ||
        !deployerAuthority || deployerAuthority.mode !== "admin-registry") {
      throw new Error("DEPLOYER signer lacks recorded and live AdminRegistry membership");
    }
  }
  validateManualTransactions(manualEvidence.transactions, addresses);
  validateManualArguments(manualEvidence.transactions, addresses);
  const networkIdentity = await fetchExpectedTestnetNetwork(actors.OWNER.token);
  validateManifestNetworkIdentity("seed", seedManifest, networkIdentity);
  validateManifestNetworkIdentity("funding", fundingManifest, networkIdentity);
  validateManifestNetworkIdentity("upgrade", upgradeEvidence, networkIdentity);
  const upgradeLiveEvidence = await validateUpgradeOnChain(
    { DEPLOYER: actors.DEPLOYER.token, OWNER: actors.OWNER.token },
    validatedUpgrade,
    addresses
  );
  let rollbackDrill = null;
  if (args["rollback-drill"]) {
    const rollbackArtifact = readJson(args["rollback-drill"]);
    rollbackDrill = {
      artifactHash: hashFile(args["rollback-drill"]),
      validation: await validateRollbackDrill(
        actors.OWNER.token,
        rollbackArtifact,
        proxyAddress,
        newImplementation,
        expectedOldImplementation,
        addresses
      ),
      artifact: rollbackArtifact,
    };
  }
  const manualLiveEvidence = {};
  for (const [name, expected] of Object.entries(REQUIRED_MANUAL_TRANSACTIONS)) {
    manualLiveEvidence[name] = await validateLiveEntry(
      actors.OWNER.token,
      manualEvidence.transactions[name],
      { ...expected, name },
      addresses
    );
  }
  if (!Array.isArray(manualEvidence.smokeTransactions) ||
      manualEvidence.smokeTransactions.length !== ECONOMIC_SMOKE_TRANSACTIONS.length) {
    throw new Error("Manual evidence requires exactly four economic smoke transactions");
  }
  const smokeLiveEvidence = [];
  for (let index = 0; index < ECONOMIC_SMOKE_TRANSACTIONS.length; index++) {
    const entry = manualEvidence.smokeTransactions[index];
    const expected = ECONOMIC_SMOKE_TRANSACTIONS[index];
    if (entry.contractName !== expected.contractName ||
        normalizeAddress(entry.contractAddress) !== addresses[expected.contractRole]) {
      throw new Error(`${expected.name} contract name/address mismatch`);
    }
    smokeLiveEvidence.push(await validateLiveEntry(
      actors.OWNER.token,
      entry,
      expected,
      addresses
    ));
  }

  validatePreUnpauseSnapshot(preSmokeSnapshot);

  const upgradePoint = upgradeLiveEvidence.pointer.executionPoint ||
    upgradeLiveEvidence.pointer.point;
  const unpausePoint = manualLiveEvidence.unpause.point;
  const strayResponse = await axios.get(`${rootNodeUrl()}/cirrus/search/event`, {
    headers: {
      Authorization: `Bearer ${actors.OWNER.token.token}`,
      Accept: "application/json",
    },
    params: {
      address: `eq.${addresses.VAULT_PROXY}`,
      event_name: "eq.StrayAssetsRemoved",
      and: `(block_number.gte.${upgradePoint.block.toString()},` +
        `block_number.lte.${unpausePoint.block.toString()})`,
      order: "block_number.asc",
      limit: "2",
    },
  });
  const unexpectedStray = Array.isArray(strayResponse.data) ? strayResponse.data : [];
  if (unexpectedStray.length) {
    throw new Error("Unexpected StrayAssetsRemoved occurred between upgrade and unpause");
  }

  const finalSnapshot = await readVaultSnapshot({
    actors,
    addresses,
    assetContractName: process.env.ASSET_CONTRACT_NAME || "Token",
    requestIds: [1, 2, 3],
  });
  await attachLiveViews({ actors, addresses }, finalSnapshot);
  const finalBlock = await latestBlock(actors.OWNER.token);
  finalSnapshot._evidence = {
    phase: "final",
    capturedAt: new Date().toISOString(),
    network: networkIdentity,
    block: finalBlock,
  };
  if (finalSnapshot.implementation !== newImplementation) {
    throw new Error("Live proxy no longer points to the upgrade implementation");
  }
  validateSmokeTransactions(manualEvidence.smokeTransactions, {
    OWNER: addresses.OWNER,
    SMOKE_USER: addresses.SMOKE_USER,
  });

  const snapshotPoint = (snapshot, name) => orderedPoint({
    ...snapshot && snapshot._evidence && snapshot._evidence.block,
    kind: "snapshot",
    capturedAt: snapshot && snapshot._evidence && snapshot._evidence.capturedAt,
  }, name);
  const orderedPoints = dedupeOrderedPoints([
    snapshotPoint(initialSnapshot, "initial snapshot"),
    manualLiveEvidence.pause.point,
    upgradeLiveEvidence.deployment.submissionPoint,
    upgradeLiveEvidence.deployment.executionPoint,
    upgradeLiveEvidence.pointer.submissionPoint || upgradeLiveEvidence.pointer.point,
    upgradeLiveEvidence.pointer.executionPoint,
    manualLiveEvidence.initializeAccrual.point,
    snapshotPoint(postInitializationSnapshot, "post-initialization snapshot"),
    manualLiveEvidence.setRewardDistributor.point,
    ...chainOrder([
      manualLiveEvidence.setPerSecondSavingsRate.point,
      manualLiveEvidence.distributorApproval.point,
    ]),
    manualLiveEvidence.smokeUserApproval.point,
    snapshotPoint(preSmokeSnapshot, "pre-smoke snapshot"),
    manualLiveEvidence.unpause.point,
    ...smokeLiveEvidence.map((evidence) => evidence.point),
    snapshotPoint(finalSnapshot, "final snapshot"),
  ].filter(Boolean));
  assertOrdered(orderedPoints);

  const reviewedSourceHash = validatedUpgrade.sourceHash;
  const requirementAssertions = {
    schemaComplete: true,
    sourceBoundToReviewedHash: true,
    implementationDeploymentVerified: true,
    proxyPointerGovernanceVerified: true,
    manualRawTransactionsVerified: true,
    globalEventsVerified: true,
    smokeApprovalVerified: true,
    fourEconomicSmokeTransactionsVerified: true,
    preUnpauseSafetyVerified: true,
    noUnexpectedStrayAssetsRemoved: true,
    chronologicalOrderVerified: true,
    seedStatePreserved: true,
    liveFinalSnapshotCaptured: true,
    rollbackPlanAvailable: true,
  };
  const report = {
    schemaVersion: 1,
    type: "yield-vault-safe-upgrade",
    completed: true,
    checksPassed: true,
    seedStatePreserved: true,
    createdAt: new Date().toISOString(),
    network: networkIdentity,
    addresses: {
      VAULT_PROXY: proxyAddress,
      OLD_IMPLEMENTATION: expectedOldImplementation,
      NEW_IMPLEMENTATION: newImplementation,
    },
    actors: {
      DEPLOYER: addresses.DEPLOYER,
      OWNER: addresses.OWNER,
      APPROVER: addresses.APPROVER,
      VAULT_OWNER: addresses.VAULT_OWNER,
      SMOKE_USER: addresses.SMOKE_USER,
    },
    signers: {
      deployment: upgradeEvidence.signers.DEPLOYER,
      pointer: upgradeEvidence.signers.OWNER,
      approval: upgradeEvidence.signers.APPROVER,
    },
    ownerAuthority,
    deployerAuthority,
    approverAuthority,
    reviewedSourceHash,
    upgradeTransactionHash: upgradeHash,
    governanceIssueId: upgrade.governance && upgrade.governance.issueId || null,
    implementationDeploymentTransactionHash: implementationHash,
    implementationDeploymentExecutionTransactionHash:
      upgradeLiveEvidence.deployment.executionHash,
    pointerSubmissionTransactionHash:
      upgradeLiveEvidence.pointer.submissionHash ||
        upgradeLiveEvidence.pointer.transactionHash,
    pointerExecutionTransactionHash:
      upgradeLiveEvidence.pointer.executionHash || null,
    smokeTransactions: manualEvidence.smokeTransactions,
    finalSnapshot,
    snapshots: {
      seed: seedSnapshot,
      initial: initialSnapshot,
      postInitialization: postInitializationSnapshot,
      preSmoke: preSmokeSnapshot,
      final: finalSnapshot,
    },
    transactions: manualEvidence.transactions,
    orderedBlockEvidence: orderedPoints.map((point) => ({
      label: point.label,
      blockNumber: point.block.toString(),
      timestamp: point.timestamp,
      transactionIndex: point.transactionIndex == null
        ? null
        : point.transactionIndex.toString(),
      eventIndex: point.eventIndex == null ? null : point.eventIndex.toString(),
    })),
    externalTransactionHashes: {
      implementationDeploymentSubmission: implementationHash,
      implementationDeploymentExecution:
        upgradeLiveEvidence.deployment.executionHash || null,
      pointerSubmission: upgradeLiveEvidence.pointer.submissionHash ||
        upgradeLiveEvidence.pointer.transactionHash,
      pointerExecution: upgradeLiveEvidence.pointer.executionHash || null,
      manual: Object.fromEntries(Object.entries(manualLiveEvidence)
        .map(([name, evidence]) => [name, evidence.transactionHash])),
      smoke: smokeLiveEvidence.map((evidence) => evidence.transactionHash),
    },
    sourceEvidence: {
      combinedSourceHash: reviewedSourceHash,
      reviewedSourceHash,
      independentlyExpectedSourceHash: reviewedSourceHash,
    },
    rollback: {
      oldImplementation: expectedOldImplementation,
      guardedWorkflowAvailable: true,
      drill: rollbackDrill,
    },
    externalEvidence: {
      seedManifestHash: hashFile(args["seed-manifest"]),
      fundingManifestHash: hashFile(args["funding-manifest"]),
      upgradeEvidenceHash: hashFile(args["upgrade-evidence"]),
      manualEvidenceHash: hashFile(args["manual-evidence"]),
      rollbackDrillEvidenceHash: args["rollback-drill"]
        ? hashFile(args["rollback-drill"])
        : null,
      upgradeEvidence,
    },
    checks: requirementAssertions,
    requirementAssertions,
  };
  assertStartingState(finalSnapshot, {
    addresses,
    runbook: { finalSnapshot },
    journal: { state: {} },
  });
  parseRunbookReport(report);
  atomicWrite(args.output, report);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await generateReport(args);
  console.log(
    `RUNBOOK_REPORT path=${args.output} implementation=${report.addresses.NEW_IMPLEMENTATION}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`RUNBOOK_REPORT_FAILED reason=${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ECONOMIC_SMOKE_TRANSACTIONS,
  REQUIRED_MANUAL_TRANSACTIONS,
  parseArgs,
  assertSubset,
  validatePreservedSeedState,
  validateManualTransactions,
  validateManualArguments,
  validateStructuredSmokeEvidence,
  validateUpgradeEvidence,
  validateRollbackDrill,
  validatePreUnpauseSnapshot,
  generateReport,
  main,
};
