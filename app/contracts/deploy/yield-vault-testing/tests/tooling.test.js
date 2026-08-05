#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { rest } = require("blockapps-rest");

process.env.NODE_URL = process.env.NODE_URL || "http://localhost";
process.env.OAUTH_URL = process.env.OAUTH_URL || "http://localhost/oauth";
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test";
process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "test";
process.env.EXPECTED_NETWORK_ID = "test-network";
process.env.REQUIRE_TESTNET = "true";

const { validateNetworkMetadata } = require("../scripts/runtime");
const actorGenerator = require("../scripts/generate-actors-json");
const {
  CHECKPOINTS: SEED_CHECKPOINTS,
  buildCheckpointSpecs: buildSeedCheckpointSpecs,
  selectInitializeSpec,
  defaultSeedManifestPath,
  readExternalDeploymentEvidence,
  validateFundingManifest: validateSeedFundingManifest,
} = require("../scripts/seed-yield-vault-old");
const {
  actorEconomicDelta,
  assertEventValues,
  cirrusResponseRows,
  createContext,
  eventIdentityKey,
  hashFile,
  latestBlock,
  migrateSubmittedNoOpReconciliation,
  parseJsonPreservingIntegers,
  reconcileFeeAdjustedState,
  remainingCheckpointRequirements,
  snapshotSubsetDiff,
  governanceEventMatches,
  governanceEventIsAfter,
  rawPayloadMatches,
  validateStorageOwnerAuthority,
  U,
  MAX_UINT256,
  MAX_RATE,
} = require("../scripts/common");
const {
  ECONOMIC_SMOKE_TRANSACTIONS,
  REQUIRED_MANUAL_TRANSACTIONS,
  validateManualArguments,
  validateManualTransactions,
  validatePreUnpauseSnapshot,
  validatePreservedSeedState,
  validateStructuredSmokeEvidence,
  validateUpgradeEvidence,
} = require("../scripts/generate-safe-upgrade-report");
const {
  ADMIN_REGISTRY,
  assertOrdered,
  getGlobalEvent,
  validateFailedGovernedExecution,
  validateGovernedOperation,
  validateTargetEvents,
  validateTransactionEvidence,
  verifyRawCall,
  verifyRawDeployment,
} = require("../scripts/evidence-verifier");
const { submittedSourceHash } = require("../scripts/upgrade-safety");
const {
  CHECKPOINTS: E2E_CHECKPOINTS,
  DYNAMIC_RESUME_CHECKPOINTS,
  buildSpecs,
  migrateMissingLossDeploymentFlow,
  migratePreparedAccrualWait,
  migrateSubmittedDonationSnapshot,
  migrateUnstartedRunMetadata,
  parseRunbookReport,
  prepareAccrualCheckpoint,
  projectedAccrual,
  reconcileDynamicCheckpoint,
  validateFundingManifest: validateE2EFundingManifest,
  validateResumeMetadata,
  validateSmokeTransactions,
} = require("../scripts/run-yield-vault-upgrade-e2e");
const { parseArgs: parseDisposableArgs } = require("./disposable-environment.test");
const {
  assertInitialSnapshot,
  buildAddresses,
  snapshotRequestIds,
  withSerializableLiveViews,
} = require("../scripts/capture-runbook-snapshot");
const {
  CHECKPOINTS: ONLY_OWNER_CHECKPOINTS,
  CONTRACT_METHODS: ONLY_OWNER_CONTRACT_METHODS,
  assertMarkedOnlyOwner,
  registeredCheckpoint,
} = require("../scripts/only-owner-registry");
const SCRIPTS_DIRECTORY = path.join(__dirname, "..", "scripts");
const FIXTURES_DIRECTORY = path.join(__dirname, "..", "fixtures");
const address = (value) => value.toString(16).padStart(40, "0");
const hash = (value) => value.toString(16).padStart(64, "0");

async function testNetworkRuntime() {
  const network = validateNetworkMetadata({
    networkID: "test-network",
    networkName: "helium-test",
    chainId: "7",
    isSynced: true,
  }, {
    networkID: "test-network",
    networkName: null,
    requireTestnet: true,
  });
  assert.equal(network.networkID, "test-network");
  assert.throws(
    () => validateNetworkMetadata({
      networkID: "test-network",
      networkName: "production",
      isSynced: true,
    }, {
      networkID: "test-network",
      networkName: null,
      requireTestnet: true,
    }),
    /Refusing testnet workflow/
  );
}

async function testCanonicalHashAndLatestBlock() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-runtime-"));
  const file = path.join(directory, "bytes.bin");
  const bytes = Buffer.from([0, 1, 2, 127, 128, 255]);
  fs.writeFileSync(file, bytes);
  assert.equal(hashFile(file), crypto.createHash("sha256").update(bytes).digest("hex"));
  const originalGet = axios.get;
  let requestedUrl;
  try {
    axios.get = async (url) => {
      requestedUrl = url;
      return {
        data: [{
          blockData: {
            number: "42",
            timestamp: "2026-07-28T18:00:00Z",
          },
        }],
      };
    };
    const block = await latestBlock({ token: "test" });
    assert.equal(requestedUrl, "http://localhost/strato-api/eth/v1.2/block/last/1");
    assert.equal(block.number, "42");
    assert.equal(block.timestamp, 1785261600);
  } finally {
    axios.get = originalGet;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function testIntegerPreservingJson() {
  const value = parseJsonPreservingIntegers(
    '["actor",2000000000000000000000,{"nested":115792089237316195423570985008687907853269984665640564039457584007913129639935},"123"]'
  );
  assert.equal(value[1], "2000000000000000000000");
  assert.equal(
    value[2].nested,
    "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  );
  assert.equal(value[3], "123");
  const events = cirrusResponseRows(
    '[{"newRate":1000000021979553151239153027,"event_index":4}]'
  );
  assert.equal(events[0].newRate, "1000000021979553151239153027");
  assert.equal(events[0].event_index, "4");
}

function testSnapshotSubsetEvidence() {
  const anchor = { viewEvidence: { "300": { totalAssets: "216" } } };
  const extended = {
    viewEvidence: {
      "300": { totalAssets: "216" },
      "400": { totalAssets: "216", activeAssets: "216" },
    },
  };
  assert.deepEqual(snapshotSubsetDiff(anchor, extended), []);
  assert.deepEqual(snapshotSubsetDiff(anchor, {
    viewEvidence: { "300": { totalAssets: "215" } },
  }), [{
    field: "viewEvidence.300.totalAssets",
    expected: "216",
    observed: "215",
  }]);
}

function testEventIdentityDeduplication() {
  const generic = {
    id: 586150,
    eventName: "QueueProcessed",
    event_index: 4,
    transaction_hash: hash(901),
    attributes: { requestId: "1" },
  };
  const typed = {
    id: 586150,
    eventName: "QueueProcessed",
    event_index: 4,
    transaction_hash: hash(901),
    requestId: "1",
  };
  assert.equal(eventIdentityKey(generic), eventIdentityKey(typed));
  assert.notEqual(
    eventIdentityKey({ ...typed, id: null, event_index: 5 }),
    eventIdentityKey({ ...typed, id: null, event_index: 6 })
  );
}

function testFeeAdjustedExactStates() {
  const fee = 10n;
  const asset = address(900);
  const context = {
    addresses: {
      ASSET: asset,
      STRATEGY: address(901),
      DAVE: address(902),
      ALICE: address(903),
      BOB: address(904),
    },
    feePolicy: { feeToken: asset, feeWei: fee.toString() },
  };
  const cases = [
    ["seed transfer", "STRATEGY", 100n, 80n, 70n, -20n, "fee-token"],
    ["E2E deposit", "DAVE", 100n, 75n, 65n, -25n, "fee-token"],
    ["E2E claim", "ALICE", 100n, 220n, 210n, 120n, "fee-token"],
    ["voucher claim", "BOB", 100n, 180n, 180n, 80n, "voucher"],
  ];
  for (const [name, actor, before, economicAfter, observedAfter, delta, mode] of cases) {
    const preState = { underlying: { [actor]: before.toString() }, marker: "exact" };
    const economic = {
      underlying: { [actor]: economicAfter.toString() },
      marker: "exact",
    };
    const observed = {
      underlying: { [actor]: observedAfter.toString() },
      marker: "exact",
    };
    const reconciliation = reconcileFeeAdjustedState(
      economic,
      observed,
      context,
      { name, actor },
      name
    );
    assert.equal(reconciliation.matched, true);
    assert.equal(reconciliation.feePaymentEvidence.mode, mode);
    assert.equal(
      actorEconomicDelta({
        preState,
        feePaymentEvidence: reconciliation.feePaymentEvidence,
      }, observed, actor),
      delta
    );
  }
  const invalid = reconcileFeeAdjustedState(
    { underlying: { ALICE: "220" }, marker: "exact" },
    { underlying: { ALICE: "219" }, marker: "exact" },
    context,
    { name: "invalid fee", actor: "ALICE" }
  );
  assert.equal(invalid.matched, false);
}

function testCheckpointAwareRequirements() {
  const checkpoints = ["100", "200", "300", "400"];
  const specs = {
    "100": { actor: "ALICE" },
    "200": { actor: "OWNER" },
    "300": { actor: "ALICE" },
    "400": { actor: "OWNER", noTransaction: true },
  };
  const flows = {
    "100": [{ actor: "ALICE", delta: -20n }],
    "200": [{ actor: "STRATEGY", delta: 80n }],
    "300": [{ actor: "STRATEGY", delta: -60n }],
  };
  const remaining = remainingCheckpointRequirements(
    checkpoints,
    "100",
    specs,
    { checkpoints: { "100": { status: "confirmed" }, "200": { status: "submitted" } } },
    flows
  );
  assert.deepEqual(remaining.included, ["300", "400"]);
  assert.equal(remaining.calls.ALICE, 1n);
  assert.equal(remaining.underlying.STRATEGY, 60n);
  const completed = remainingCheckpointRequirements(
    checkpoints,
    "400",
    specs,
    { checkpoints: { "400": { status: "confirmed" } } },
    flows
  );
  assert.deepEqual(completed.included, []);
}

function testActorGenerator() {
  actorGenerator.CORE_ROLES.forEach((role, index) => {
    process.env[`${role}_ADDRESS`] = address(index + 1);
  });
  const generated = actorGenerator.buildActors();
  assert.equal(generated.actors.STRATEGY, process.env.STRATEGY_ADDRESS);
  assert.equal(Object.keys(generated.actors).length, actorGenerator.CORE_ROLES.length);
}

function testArtifactWiring() {
  assert.equal(
    path.basename(defaultSeedManifestPath("/tmp/yield-vault-seed-run-state.json")),
    "yield-vault-seed-manifest.json"
  );
  assert.equal(
    path.basename(defaultSeedManifestPath("/tmp/custom.json")),
    "custom.manifest.json"
  );
}

function testInitialSnapshotActorShape() {
  const seedManifest = {
    addresses: { ASSET: address(1), VAULT_PROXY: address(2), OLD_IMPLEMENTATION: address(3) },
    finalUnpausedSeedSnapshot: {
      shares: { OWNER: "0", ALICE: "1", BOB: "2" },
      underlying: { OWNER: "0", ALICE: "3", BOB: "4", VAULT_PROXY: "5" },
      allowances: { OWNER: "0", ALICE: "0", BOB: "0" },
      requests: { "1": { exists: true }, "2": { exists: true } },
    },
  };
  const fundingManifest = {
    actors: {
      ALICE: address(11),
      BOB: address(12),
      SMOKE_USER: address(13),
      DONOR: address(14),
    },
  };
  const initial = buildAddresses(seedManifest, fundingManifest, address(10), "initial");
  assert.equal(initial.ALICE, address(11));
  assert.equal(initial.BOB, address(12));
  assert.equal(initial.SMOKE_USER, undefined);
  assert.equal(initial.DONOR, undefined);
  const later = buildAddresses(seedManifest, fundingManifest, address(10), "pre-smoke");
  assert.equal(later.SMOKE_USER, address(13));
  assert.equal(later.DONOR, address(14));
  assert.deepEqual(snapshotRequestIds(seedManifest, "initial"), [1, 2]);
  assert.deepEqual(snapshotRequestIds(seedManifest, "pre-smoke"), [1, 2, 3, 4]);
  assertInitialSnapshot(seedManifest.finalUnpausedSeedSnapshot,
    seedManifest.finalUnpausedSeedSnapshot);
  assert.throws(
    () => assertInitialSnapshot({
      ...seedManifest.finalUnpausedSeedSnapshot,
      shares: { ...seedManifest.finalUnpausedSeedSnapshot.shares, SMOKE_USER: "0" },
    }, seedManifest.finalUnpausedSeedSnapshot),
    /exactly match/
  );
  const derived = { implementation: address(15) };
  Object.defineProperty(derived, "liveViews", {
    enumerable: false,
    value: { totalAssets: 450n },
  });
  const serializable = withSerializableLiveViews(derived);
  assert.equal(serializable.liveViews.totalAssets, "450");
  assert.equal(Object.keys(serializable).includes("liveViews"), true);
}

function testStructuredSeedDeploymentEvidence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-evidence-"));
  const proxy = address(120);
  const implementation = address(121);
  const evidencePath = path.join(directory, "old-proxy.json");
  const sourceHash = hash(90);
  const proxyReceipt = {
    hash: hash(30),
    status: "Success",
    txResult: { contractsCreated: [proxy] },
  };
  const implementationReceipt = {
    hash: hash(31),
    status: "Success",
    txResult: { contractsCreated: [implementation] },
  };
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 2,
    type: "yield-vault-old-proxy-deployment",
    completed: true,
    network: {
      networkID: "test-network",
      networkName: "helium-test",
      nodeUrl: "http://localhost",
    },
    owner: address(1),
    expectedStorageOwner: address(1),
    operatorSigner: address(1),
    deploymentSigner: address(2),
    signers: {
      OWNER: { role: "OWNER", address: address(1), username: "owner-test" },
      DEPLOYER: { role: "DEPLOYER", address: address(2), username: "deployer-test" },
    },
    source: {
      proxy: {
        matched: true,
        combinedSourceHash: sourceHash,
        expectedReviewedSourceHash: sourceHash,
      },
      oldImplementation: {
        matched: true,
        combinedSourceHash: sourceHash,
        expectedReviewedSourceHash: sourceHash,
      },
    },
    proxy: { address: proxy, creationReceipt: proxyReceipt },
    implementation: { address: implementation, creationReceipt: implementationReceipt },
    activation: {
      proxyAddress: proxy,
      activationReceipt: { hash: hash(32), status: "Success" },
      confirmedImplementation: implementation,
      governance: null,
    },
    operations: {
      "deploy-proxy": {
        status: "confirmed",
        signer: { role: "DEPLOYER", address: address(2), username: "deployer-test" },
      },
      "deploy-old-implementation": {
        status: "confirmed",
        signer: { role: "DEPLOYER", address: address(2), username: "deployer-test" },
      },
      "activate-old-implementation": {
        status: "confirmed",
        signer: { role: "OWNER", address: address(1), username: "owner-test" },
      },
    },
  }));
  const previousPath = process.env.OLD_PROXY_EVIDENCE_PATH;
  const previousProxyHash = process.env.EXPECTED_PROXY_SOURCE_HASH;
  const previousOldHash = process.env.EXPECTED_OLD_REVIEWED_SOURCE_HASH;
  try {
    process.env.OLD_PROXY_EVIDENCE_PATH = evidencePath;
    process.env.EXPECTED_PROXY_SOURCE_HASH = sourceHash;
    process.env.EXPECTED_OLD_REVIEWED_SOURCE_HASH = sourceHash;
    const evidence = readExternalDeploymentEvidence({
      OWNER: address(1),
      DEPLOYER: address(2),
      VAULT_OWNER: address(1),
      VAULT_PROXY: proxy,
      OLD_IMPLEMENTATION: implementation,
    }, {
      networkID: "test-network",
      networkName: "helium-test",
    });
    assert.equal(evidence.proxyDeploymentTransactionHash, hash(30));
    assert.equal(evidence.oldImplementationDeploymentTransactionHash, hash(31));
    assert.equal(evidence.oldImplementationActivationTransactionHash, hash(32));
  } finally {
    if (previousPath == null) delete process.env.OLD_PROXY_EVIDENCE_PATH;
    else process.env.OLD_PROXY_EVIDENCE_PATH = previousPath;
    if (previousProxyHash == null) delete process.env.EXPECTED_PROXY_SOURCE_HASH;
    else process.env.EXPECTED_PROXY_SOURCE_HASH = previousProxyHash;
    if (previousOldHash == null) delete process.env.EXPECTED_OLD_REVIEWED_SOURCE_HASH;
    else process.env.EXPECTED_OLD_REVIEWED_SOURCE_HASH = previousOldHash;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function testManualEvidenceValidation() {
  const transactions = {};
  const addresses = {
    OWNER: address(1),
    REWARD_DISTRIBUTOR: address(91),
    SMOKE_USER: address(92),
    VAULT_PROXY: address(90),
    ASSET: address(93),
  };
  let index = 1;
  for (const [name, requirement] of Object.entries(REQUIRED_MANUAL_TRANSACTIONS)) {
    const transactionHash = hash(index++);
    transactions[name] = {
      actor: requirement.actor,
      contractName: requirement.contractName,
      contractAddress: addresses[requirement.contractRole],
      method: requirement.method,
      transactionHash,
      receipt: {
        hash: transactionHash,
        status: requirement.success ? "Success" : "Failure",
        txResult: { transactionHash },
      },
      events: requirement.event ? [{
        id: String(index),
        event_index: String(index),
        eventName: requirement.event,
        transaction_hash: transactionHash,
        block_timestamp: "2026-01-01T00:00:00Z",
      }] : [],
    };
  }
  validateManualTransactions(transactions, addresses);
  transactions.distributorApproval.arguments = {
    spender: "VAULT_PROXY",
    value: "30000000000000000000",
  };
  transactions.setRewardDistributor.arguments = {
    newRewardDistributor: "REWARD_DISTRIBUTOR",
  };
  transactions.setPerSecondSavingsRate.arguments = {
    newRate: "1000000000000000000000000000",
  };
  transactions.smokeUserApproval.arguments = {
    spender: "VAULT_PROXY",
    value: "10000000000000000000",
  };
  validateManualArguments(transactions, addresses);
  const smokeHash = hash(80);
  validateStructuredSmokeEvidence([{
    transactionHash: smokeHash,
    receipt: {
      hash: smokeHash,
      status: "Success",
      txResult: { transactionHash: smokeHash },
    },
    events: [{
      id: "80",
      event_index: "80",
      eventName: "Deposit",
      transaction_hash: smokeHash,
      block_timestamp: "2026-01-01T00:00:00Z",
    }],
  }]);
  transactions.pause.receipt.status = "Failure";
  assert.throws(() => validateManualTransactions(transactions), /expected success=true/);
}

function testSeedPreservationValidation() {
  const seed = {
    owner: address(1),
    shares: { ALICE: "80" },
    strategyDebt: { STRATEGY: "200" },
    requests: { "1": { shares: "70", exists: true } },
  };
  const preserved = JSON.parse(JSON.stringify(seed));
  preserved.shares.EXTRA = "0";
  validatePreservedSeedState(preserved, seed, "preserved");
  preserved.shares.ALICE = "79";
  assert.throws(
    () => validatePreservedSeedState(preserved, seed, "preserved"),
    /shares.ALICE mismatch/
  );
}

function testUpgradeEvidenceValidation() {
  const proxy = address(100);
  const implementation = address(101);
  const evidence = {
    schemaVersion: 1,
    type: "proxy-upgrade-evidence",
    completed: true,
    operatorSigner: address(102),
    deploymentSigner: address(103),
    approvalSigner: address(104),
    approvalGovernance: {
      adminRegistry: ADMIN_REGISTRY,
      adminMapMembership: "3",
      verified: true,
    },
    signers: {
      OWNER: { role: "OWNER", address: address(102), username: "owner-test" },
      DEPLOYER: { role: "DEPLOYER", address: address(103), username: "deployer-test" },
      APPROVER: { role: "APPROVER", address: address(104), username: "approver-test" },
    },
    source: {
      combinedSourceHash: hash(90),
      reviewedSourceHash: hash(90),
    },
    implementation: {
      address: implementation,
      submissionHashes: [hash(1)],
      receiptCreatedAddress: implementation,
      creationReceipt: {
        hash: hash(1),
        status: "Success",
        blockNumber: "1",
        timestamp: "2026-01-01T00:00:00Z",
        txResult: {
          transactionHash: hash(1),
          contractsCreated: [implementation],
        },
      },
    },
    operations: {
      "deploy-new-implementation": {
        status: "confirmed",
        signer: { role: "DEPLOYER", address: address(103), username: "deployer-test" },
      },
      "upgrade-pointer": {
        status: "confirmed",
        signer: { role: "OWNER", address: address(102), username: "owner-test" },
      },
    },
    upgrades: [{
      proxyAddress: proxy,
      previousImplementation: address(99),
      newImplementation: implementation,
      confirmedImplementation: implementation,
      upgradeSubmission: { submissionHashes: [hash(2)] },
    }],
  };
  const validated = validateUpgradeEvidence(
    evidence,
    proxy,
    address(99),
    hash(90)
  );
  assert.equal(validated.implementationHash, hash(1));
  assert.equal(validated.upgradeHash, hash(2));
  evidence.operations["deploy-new-implementation"].signer.role = "OWNER";
  assert.throws(
    () => validateUpgradeEvidence(evidence, proxy, address(99), hash(90)),
    /signer separation/
  );
  evidence.operations["deploy-new-implementation"].signer.role = "DEPLOYER";
  evidence.source.reviewedSourceHash = hash(91);
  assert.throws(
    () => validateUpgradeEvidence(evidence, proxy, address(99), hash(90)),
    /source evidence/
  );
}

function testPreUnpauseSafety() {
  const snapshot = {
    paused: true,
    accountedAssets: "450",
    idle: "250",
    deployedAssets: "200",
    exchangeRate: "100",
    underlying: { REWARD_DISTRIBUTOR: "30" },
    allowances: { REWARD_DISTRIBUTOR: "30" },
    liveViews: {
      pendingAccrual: { target: "20", funded: "20" },
      projectedExchangeRate: "101",
    },
  };
  validatePreUnpauseSnapshot(snapshot);
  snapshot.liveViews.pendingAccrual.funded = "31";
  assert.throws(() => validatePreUnpauseSnapshot(snapshot), /pre-unpause safety/);
  snapshot.liveViews.pendingAccrual.funded = "20";
  snapshot.accountedAssets = "449";
  assert.throws(() => validatePreUnpauseSnapshot(snapshot), /pre-unpause safety/);
}

function testExamplesParse() {
  const actors = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIRECTORY, "actors.example.json"), "utf8")
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIRECTORY, "runbook-report.example.json"), "utf8")
  );
  const manual = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIRECTORY, "manual-upgrade-evidence.example.json"), "utf8")
  );
  assert.equal(actors.schemaVersion, 2);
  assert.deepEqual(
    Object.keys(report.finalSnapshot.strategyDebt).sort(),
    ["REWARD_DISTRIBUTOR", "STRATEGY"]
  );
  assert.equal(report.finalSnapshot.strategyDebt.STRATEGY, (200n * U).toString());
  assert.deepEqual(report.finalSnapshot.approvedStrategies, { STRATEGY: true });
  assert.equal(manual.transactions.smokeUserApproval.method, "approve");
  assert.equal(manual.smokeTransactions.length, 4);
}

function testDisposableCli() {
  const parsed = parseDisposableArgs([
    "seed",
    "--actors", "./actors.json",
    "--funding-manifest", "./funding.json",
    "--seed-state", "./seed-state.json",
    "--seed-manifest", "./seed.json",
  ]);
  assert.equal(parsed.phase, "seed");
  assert.equal(parsed["funding-manifest"], path.resolve("./funding.json"));
  assert.throws(
    () => parseDisposableArgs([
      "seed",
      "--actors", "./actors.json",
      "--funding-state", "./funding-state.json",
      "--funding-manifest", "./funding.json",
      "--seed-state", "./seed-state.json",
      "--seed-manifest", "./seed.json",
    ]),
    /Unknown disposable seed argument --funding-state/
  );
  const source = fs.readFileSync(
    path.join(__dirname, "disposable-environment.test.js"),
    "utf8"
  );
  assert(source.includes("fetchExpectedTestnetNetwork(actors.OWNER.token)"));
  assert(!source.includes("config.fetchNetworkIdentity"));
  for (const file of [
    "capture-runbook-snapshot.js",
    "generate-safe-upgrade-report.js",
    "evidence-verifier.js",
  ]) {
    const localSource = fs.readFileSync(path.join(SCRIPTS_DIRECTORY, file), "utf8");
    assert(!localSource.includes("config.fetchNetworkIdentity"));
    assert(!localSource.includes("config.rootNodeUrl"));
  }
}

function testInitializeSpecPreservation() {
  const context = {
    addresses: {
      OWNER: address(1),
      ASSET: address(2),
      OLD_IMPLEMENTATION: address(3),
      VAULT_PROXY: address(4),
    },
    journal: { state: { checkpoints: {} } },
  };
  const observed = selectInitializeSpec(context, { vaultInitialized: true });
  assert.equal(observed.noTransaction, true);
  context.journal.state.checkpoints["100"] = { status: "submitted" };
  const submitted = selectInitializeSpec(context, { vaultInitialized: true });
  assert.equal(submitted.noTransaction, undefined);
  assert.equal(submitted.method, "initialize");
  context.journal.state.checkpoints["100"].status = "dispatching";
  assert.equal(
    selectInitializeSpec(context, { vaultInitialized: true }).method,
    "initialize"
  );
}

function testDynamicE2EReconciliation() {
  let metadataSaves = 0;
  const unstartedContext = {
    scriptHash: "new-script",
    configHash: "new-config",
    configuration: { version: "new" },
    journal: {
      state: {
        scriptHash: "old-script",
        configHash: "old-config",
        configuration: { version: "old" },
        checkpoints: { "000": { checkpointId: "000" } },
      },
      save() { metadataSaves += 1; },
    },
  };
  assert.equal(migrateUnstartedRunMetadata(unstartedContext), true);
  assert.equal(unstartedContext.journal.state.scriptHash, "new-script");
  assert.equal(unstartedContext.journal.state.configHash, "new-config");
  assert.deepEqual(unstartedContext.journal.state.configuration, { version: "new" });
  assert.equal(metadataSaves, 1);
  unstartedContext.journal.state.checkpoints["000"].status = "ready";
  unstartedContext.journal.state.scriptHash = "old-script";
  assert.equal(migrateUnstartedRunMetadata(unstartedContext), false);
  let accrualMigrationSaves = 0;
  const preparedAccrualContext = {
    scriptHash: "new-script",
    configHash: "new-config",
    configuration: { constants: { ACCRUAL_WAIT: "60" } },
    journal: {
      state: {
        scriptHash: "old-script",
        configHash: "old-config",
        configuration: { constants: { ACCRUAL_WAIT: "3600" } },
        checkpoints: {
          "410": {
            status: "prepared",
            preparation: {
              status: "anchored",
              lastAccrualAnchor: "1000",
              targetTimestamp: "4600",
              equations: [],
              observations: [],
            },
          },
        },
      },
      save() { accrualMigrationSaves += 1; },
    },
  };
  assert.equal(migratePreparedAccrualWait(preparedAccrualContext), true);
  assert.equal(
    preparedAccrualContext.journal.state.checkpoints["410"].preparation.targetTimestamp,
    "1060"
  );
  assert.equal(
    preparedAccrualContext.journal.state.checkpoints["410"]
      .preparation.waitMigration.previousWaitSeconds,
    "3600"
  );
  assert.equal(accrualMigrationSaves, 1);
  let donationMigrationSaves = 0;
  const submittedDonationContext = {
    scriptHash: "new-script",
    configHash: "new-config",
    configuration: { commonHash: "new-common", version: "same" },
    journal: {
      state: {
        scriptHash: "old-script",
        configHash: "old-config",
        configuration: { commonHash: "old-common", version: "same" },
        checkpoints: {
          "502": {
            status: "submitted",
            transactionHash: hash(502),
          },
        },
        interruptions: [{
          checkpointId: "502",
          latestStatus: {
            postStateDifferences: [{
              field: "freeIdleForInstantWithdrawals",
              expected: "100",
              observed: (5n * 10n ** 18n + 100n).toString(),
            }],
          },
        }],
      },
      save() { donationMigrationSaves += 1; },
    },
  };
  assert.equal(migrateSubmittedDonationSnapshot(submittedDonationContext), true);
  assert.equal(submittedDonationContext.journal.state.scriptHash, "new-script");
  assert.equal(submittedDonationContext.journal.state.configHash, "new-config");
  assert.equal(donationMigrationSaves, 1);
  let noOpMigrationSaves = 0;
  const submittedNoOpContext = {
    scriptHash: "same-script",
    configHash: "new-config",
    configuration: { commonHash: "new-common", version: "same" },
    journal: {
      state: {
        scriptHash: "same-script",
        configHash: "old-config",
        configuration: { commonHash: "old-common", version: "same" },
        checkpoints: {
          "604": {
            checkpointId: "604",
            status: "submitted",
            transactionHash: hash(604),
            accessControl: { governed: false, onlyOwner: false },
            expectedPreState: { allowances: { STRATEGY: MAX_UINT256.toString() } },
            expectedPostState: { allowances: { STRATEGY: MAX_UINT256.toString() } },
          },
        },
        interruptions: [{
          checkpointId: "604",
          reason: "pending_governance",
          latestStatus: { governanceIssueId: null },
        }],
      },
      save() { noOpMigrationSaves += 1; },
    },
  };
  assert.equal(migrateSubmittedNoOpReconciliation(submittedNoOpContext), true);
  assert.equal(submittedNoOpContext.journal.state.configHash, "new-config");
  assert.equal(
    submittedNoOpContext.journal.state.noOpReconciliationMigration.checkpointId,
    "604"
  );
  assert.equal(noOpMigrationSaves, 1);
  let flowMigrationSaves = 0;
  const flowMigrationContext = {
    scriptHash: "new-script",
    configHash: "new-config",
    configuration: { version: "same" },
    journal: {
      state: {
        scriptHash: "old-script",
        configHash: "old-config",
        configuration: { version: "same" },
        checkpoints: { "210": { status: "confirmed" } },
        proxyFlowLedger: {
          initialIdle: "250000000000000000000",
          entries: [
            { checkpoint: "202", category: "capital return", amount: "210" },
            { checkpoint: "213", category: "capital return", amount: "60" },
          ],
          queueNoMovement: [],
        },
      },
      save() { flowMigrationSaves += 1; },
    },
  };
  assert.equal(migrateMissingLossDeploymentFlow(flowMigrationContext), true);
  assert.deepEqual(
    flowMigrationContext.journal.state.proxyFlowLedger.entries.map((entry) => entry.checkpoint),
    ["202", "210", "213"]
  );
  assert.equal(
    flowMigrationContext.journal.state.proxyFlowLedger.entries[1].amount,
    (-80n * 10n ** 18n).toString()
  );
  assert.equal(flowMigrationContext.journal.state.scriptHash, "new-script");
  assert.equal(flowMigrationSaves, 1);

  const snapshot = {
    underlying: {
      VAULT_PROXY: "100",
      REWARD_DISTRIBUTOR: "20",
    },
    allowances: { REWARD_DISTRIBUTOR: "10" },
    deployedAssets: "0",
    totalClaimableAssets: "0",
    totalSupply: "100",
    queueHead: "0",
    minIdleBps: "0",
    paused: false,
    accountedAssets: "100",
    perSecondSavingsRate: "1000000021979553151239153027",
    lastAccrual: "1",
  };
  const reconciled = reconcileDynamicCheckpoint("410")({
    preState: snapshot,
    events: [{
      eventName: "Accrued",
      block_timestamp: "7",
      attributes: { targetAmount: "5", creditedAmount: "5" },
    }],
  }, { journal: { state: {} }, addresses: {} });
  assert.equal(reconciled.lastAccrual, "7");
  assert.equal(reconciled.underlying.VAULT_PROXY, "105");
  assert.equal(reconciled.underlying.REWARD_DISTRIBUTOR, "15");
  assert.equal(reconciled.allowances.REWARD_DISTRIBUTOR, "5");
  assert.equal(reconciled.accountedAssets, "105");

  const roles = [
    "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY",
    "LOSS_SINK", "SMOKE_USER", "REWARD_DISTRIBUTOR", "DAVE", "DONOR",
    "VAULT_PROXY", "ASSET", "NEW_IMPLEMENTATION", "OLD_IMPLEMENTATION",
  ];
  const addresses = Object.fromEntries(roles.map((role, index) => [role, address(200 + index)]));
  const specs = buildSpecs({
    addresses,
    assetContractName: "Token",
    journal: { state: {} },
  });
  validateResumeMetadata(specs);
  for (const checkpoint of Object.keys(DYNAMIC_RESUME_CHECKPOINTS)) {
    assert.equal(typeof specs[checkpoint].reconcileSubmittedPostState, "function");
    assert(specs[checkpoint].postRules.length >= 3);
  }
  assert.equal(specs["200"].actor, "STRATEGY");
  assert.equal(specs["201"].args.value, MAX_UINT256);
  assert.equal(specs["202"].args.assets, 210n * U);
  assert.equal(specs["210"].args.assets, 80n * U);
  assert.equal(specs["211"].actor, "STRATEGY");
  assert.equal(specs["212"].args.loss, 20n * U);
  assert.equal(specs["213"].args.assets, 60n * U);
  assert.deepEqual(
    remainingCheckpointRequirements(
      E2E_CHECKPOINTS,
      E2E_CHECKPOINTS[0],
      specs,
      { checkpoints: {} }
    ).calls,
    {
      ALICE: 5n,
      BOB: 2n,
      OWNER: 11n,
      STRATEGY: 3n,
      CAROL: 1n,
      DONOR: 1n,
      DAVE: 3n,
    }
  );

  const queuePreState = {
    underlying: { VAULT_PROXY: (200n * U).toString() },
    deployedAssets: "0",
    totalClaimableAssets: "0",
    totalSupply: (225n * U).toString(),
    accountedAssets: (200n * U).toString(),
    minIdleBps: "0",
    paused: false,
    queueHead: "0",
    queueTail: "0",
    totalQueuedShares: "0",
    nextRequestId: "4",
    lastAccrual: "1",
    shares: {
      ALICE: (80n * U).toString(),
      VAULT_PROXY: "0",
    },
    activeRequestId: { ALICE: "0" },
    requests: {},
    requestOwner: {},
  };
  const queueExpected = reconcileDynamicCheckpoint("601")({
    preState: queuePreState,
    events: [{
      eventName: "WithdrawalRequested",
      block_timestamp: "2026-07-28T18:00:00Z",
      attributes: {},
    }],
  }, { journal: { state: {} }, addresses: { ALICE: addresses.ALICE } });
  assert.equal(queueExpected.nextRequestId, "5");
}

function fundingFixture() {
  const roles = actorGenerator.CORE_ROLES;
  const actors = Object.fromEntries(roles.map((role, index) => [role, address(400 + index)]));
  const asset = address(500);
  const feeToken = address(501);
  const perRunUnderlying = {
    ALICE: 200n * U,
    BOB: 150n * U,
    CAROL: 100n * U,
    STRATEGY: 30n * U,
    SMOKE_USER: 10n * U,
    REWARD_DISTRIBUTOR: 30n * U,
    DONOR: 5n * U,
    DAVE: 25n * U,
  };
  const computedUnderlyingByRole = Object.fromEntries(
    Object.entries(perRunUnderlying).map(([role, amount]) => [role, (amount * 10n).toString()])
  );
  const computedFeeByRole = Object.fromEntries(
    roles.map((role) => [role, ((role === "OWNER" ? 10n : 2n) * U).toString()])
  );
  computedFeeByRole.LOSS_SINK = "0";
  const final = {};
  for (const [role, amount] of Object.entries(computedUnderlyingByRole)) {
    final[`${asset}:${actors[role]}`] = amount;
  }
  for (const [role, amount] of Object.entries(computedFeeByRole)) {
    final[`${feeToken}:${actors[role]}`] = amount;
  }
  const transactionHash = hash(700);
  return {
    addresses: { ...actors, ASSET: asset },
    evidence: {
      path: "/tmp/funding.json",
      hash: hash(701),
      manifest: {
        schemaVersion: 2,
        completed: true,
        allPlannedMintsConfirmed: true,
        allFinalAssertionsConfirmed: true,
        runs: 10,
        network: {
          networkID: "test-network",
          networkName: "helium-test",
          nodeUrl: "http://localhost",
          transactionFeeWei: (10n ** 16n).toString(),
        },
        addresses: { ASSET: asset, FEE_TOKEN: feeToken },
        actors,
        budgets: {
          perRunUnderlying,
          computedUnderlyingByRole,
          computedFeeByRole,
        },
        mintPlan: [{ index: 1 }],
        transactions: [{
          index: 1,
          transactionHash,
          receipt: { hash: transactionHash, status: "Success" },
        }],
        final: { balances: final },
      },
    },
  };
}

function testFundingManifestValidation() {
  const fixture = fundingFixture();
  const priorFeeToken = process.env.FEE_TOKEN_ADDRESS;
  process.env.FEE_TOKEN_ADDRESS = fixture.evidence.manifest.addresses.FEE_TOKEN;
  try {
    const network = { networkID: "test-network", networkName: "helium-test" };
    const seed = validateSeedFundingManifest(fixture.evidence, fixture.addresses, network);
    assert.equal(seed.allPlannedMintsConfirmed, true);
    const e2e = validateE2EFundingManifest(
      fixture.evidence,
      fixture.addresses,
      { fundingRequestedRuns: "10" },
      network
    );
    assert.equal(e2e["funding.allTransactionsSuccessful"], true);
    fixture.evidence.manifest.schemaVersion = 1;
    assert.throws(
      () => validateSeedFundingManifest(fixture.evidence, fixture.addresses, network),
      /schemaVersion must be 2/
    );
    assert.throws(
      () => validateE2EFundingManifest(
        fixture.evidence,
        fixture.addresses,
        { fundingRequestedRuns: "10" },
        network
      ),
      /schemaVersion must be 2/
    );
    fixture.evidence.manifest.schemaVersion = 2;
    fixture.evidence.manifest.transactions[0].receipt.status = "Failure";
    assert.throws(
      () => validateSeedFundingManifest(fixture.evidence, fixture.addresses, network),
      /not confirmed successful/
    );
    fixture.evidence.manifest.transactions[0].receipt.status = "Success";
    fixture.evidence.manifest.allFinalAssertionsConfirmed = false;
    assert.throws(
      () => validateE2EFundingManifest(
        fixture.evidence,
        fixture.addresses,
        { fundingRequestedRuns: "10" },
        network
      ),
      /completion assertions/
    );
  } finally {
    if (priorFeeToken == null) delete process.env.FEE_TOKEN_ADDRESS;
    else process.env.FEE_TOKEN_ADDRESS = priorFeeToken;
  }
}

function testSingularSeedCheckpoints() {
  assert(!SEED_CHECKPOINTS.includes("132"));
  assert(!SEED_CHECKPOINTS.includes("141"));
  const roles = [
    "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
    "VAULT_PROXY", "ASSET", "OLD_IMPLEMENTATION",
  ];
  const addresses = Object.fromEntries(roles.map((role, index) => [role, address(600 + index)]));
  const specs = buildSeedCheckpointSpecs({
    addresses,
    assetContractName: "Token",
    fundingValidation: {
      verifiedUnderlying: { ALICE: { target: 200n * U }, BOB: { target: 150n * U },
        CAROL: { target: 100n * U }, STRATEGY: { target: 30n * U } },
    },
  });
  assert.equal(specs["131"].args.strategy, addresses.STRATEGY);
  assert.equal(specs["140"].args.assets, 300n * U);
  assert.equal(specs["151"].args.value, 320n * U);
  assert.equal(specs["152"].args.assets, 320n * U);
  assert.equal(specs["160"].args.assets, 220n * U);
  assert.equal(specs["170"].args.value, 20n * U);
  assert.equal(specs["171"].args.loss, 20n * U);
  assert.deepEqual(
    remainingCheckpointRequirements(
      SEED_CHECKPOINTS,
      SEED_CHECKPOINTS[0],
      specs,
      { checkpoints: {} }
    ).calls,
    { OWNER: 7n, ALICE: 3n, BOB: 3n, CAROL: 2n, STRATEGY: 2n }
  );
}

async function testCheckpoint410PreparationRecovery() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-410-"));
  const context = createContext({
    scriptName: "checkpoint-410-test",
    scriptPath: __filename,
    runStatePath: path.join(directory, "state.json"),
    actors: { OWNER: { address: address(800), token: { token: "test" } } },
    addresses: {},
    configuration: { checkpoint: "410" },
  });
  context.journal.acquire();
  const snapshot = {
    lastAccrual: "100",
    perSecondSavingsRate: MAX_RATE.toString(),
    rewardDistributor: address(801),
    totalSupply: (100n * U).toString(),
    totalAssets: (100n * U).toString(),
    accountedAssets: (100n * U).toString(),
    totalClaimableAssets: "0",
    underlying: { REWARD_DISTRIBUTOR: (30n * U).toString() },
    allowances: { REWARD_DISTRIBUTOR: (30n * U).toString() },
    liveViews: {
      blockBefore: { number: "1", timestamp: 3700 },
      blockAfter: { number: "1", timestamp: 3700 },
    },
  };
  const pending = projectedAccrual(snapshot, 3700);
  snapshot.liveViews.pendingAccrual = pending;
  context.capture = async () => snapshot;
  context.faultInjector = async (point) => {
    if (point === "after_preparation") throw new Error("FAULT_AFTER_PREPARATION");
  };
  try {
    await assert.rejects(
      prepareAccrualCheckpoint(context, "410", Date.now() + 60_000),
      /FAULT_AFTER_PREPARATION/
    );
    assert.equal(context.journal.state.checkpoints["410"].status, "prepared");
    assert.equal(context.journal.state.checkpoints["410"].preparation.lastAccrualAnchor, "100");
    context.faultInjector = null;
    await prepareAccrualCheckpoint(context, "410", Date.now() + 60_000);
    assert.equal(context.journal.state.checkpoints["410"].preparation.status, "confirmed");
    assert.equal(context.journal.state.checkpoints["410"].preparation.observations.length, 1);
  } finally {
    context.journal.release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function testStrictSmokeEvidence() {
  const smokeUser = address(300);
  const owner = address(301);
  const definitions = [
    ["SMOKE_USER", "deposit", {
      assets: "10000000000000000000",
      receiver: "SMOKE_USER",
    }, ["Deposit", "Transfer"]],
    ["SMOKE_USER", "redeemOrQueue", {
      shares: "10000000000000000000",
      receiver: "SMOKE_USER",
      owner_: "SMOKE_USER",
    }, ["WithdrawalRequested", "Transfer"]],
    ["OWNER", "processQueue", {
      maxRequests: "3",
      maxAssets: "160000000000000000000",
    }, ["QueueProcessed"]],
    ["SMOKE_USER", "claim", {
      receiver: "SMOKE_USER",
    }, ["WithdrawalClaimed"]],
  ];
  const records = definitions.map(([actor, method, args, eventNames], index) => {
    const transactionHash = hash(100 + index);
    return {
      actor,
      method,
      arguments: args,
      transactionHash,
      receipt: {
        hash: transactionHash,
        status: "Success",
        txResult: { transactionHash },
      },
      events: eventNames.flatMap((eventName) =>
        eventName === "QueueProcessed" ? [1, 2, 3].map((requestId) => ({
          id: `${index}-${requestId}`,
          event_index: String(requestId),
          eventName,
          transaction_hash: transactionHash,
          block_timestamp: "2026-01-01T00:00:00Z",
          attributes: {
            requestId: String(requestId),
            owner: smokeUser,
            sharesBurned: "10000000000000000000",
            assetsReserved: "10000000000000000000",
            fullyProcessed: true,
          },
        })) : [{
        id: `${index}-${eventName}`,
        event_index: String(index + 1),
        eventName,
        transaction_hash: transactionHash,
        block_timestamp: "2026-01-01T00:00:00Z",
      }]),
    };
  });
  validateSmokeTransactions(records, { OWNER: owner, SMOKE_USER: smokeUser });
  records[0].receipt.hash = hash(999);
  assert.throws(
    () => validateSmokeTransactions(records, { OWNER: owner, SMOKE_USER: smokeUser }),
    /receipt evidence is incomplete/
  );
  records[0].receipt.hash = hash(100);
  delete records[2].events[0].attributes.sharesBurned;
  assert.throws(
    () => validateSmokeTransactions(records, { OWNER: owner, SMOKE_USER: smokeUser }),
    /QueueProcessed/
  );
  records[2].events[0].attributes.sharesBurned = "10000000000000000000";
  return { records, smokeUser, owner };
}

function testRunbookReportCompleteness(smoke) {
  const requiredAssertions = {
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
  const oldImplementation = address(950);
  const newImplementation = address(951);
  const sourceHash = hash(952);
  const finalSnapshot = Object.fromEntries([
    "decimals", "perSecondSavingsRate", "lastAccrual", "accountedAssets", "idle",
    "deployedAssets", "totalAssets", "activeAssets", "totalSupply", "exchangeRate",
    "freeIdleForInstantWithdrawals", "freeIdleForQueueProcessing", "maxDeploy",
    "minIdleBps", "nextRequestId", "queueHead", "queueTail", "totalQueuedShares",
    "totalClaimableAssets",
  ].map((name) => [name, "0"]));
  Object.assign(finalSnapshot, {
    implementation: newImplementation,
    owner: smoke.owner,
    proxyOwner: smoke.owner,
    asset: address(952),
    name: "Vault",
    symbol: "V",
    paused: false,
    vaultInitialized: true,
    accrualInitialized: true,
    rewardDistributor: address(953),
    shares: {
      ALICE: "0", BOB: "0", CAROL: "0", SMOKE_USER: "0", VAULT_PROXY: "0",
    },
    strategyDebt: { STRATEGY: "0", REWARD_DISTRIBUTOR: "0" },
    approvedStrategies: { STRATEGY: true },
    activeRequestId: { ALICE: "0", BOB: "0", SMOKE_USER: "0" },
    claimableAssets: { ALICE: "0", BOB: "0", SMOKE_USER: "0" },
    requests: Object.fromEntries(["1", "2", "3"].map((id) => [id, {
      shares: "0", receiver: address(0), next: "0", exists: false,
    }])),
    requestOwner: { "1": address(0), "2": address(0), "3": address(0) },
    underlying: { REWARD_DISTRIBUTOR: "0" },
    allowances: { REWARD_DISTRIBUTOR: "0" },
  });
  const report = {
    schemaVersion: 1,
    type: "yield-vault-safe-upgrade",
    completed: true,
    checksPassed: true,
    seedStatePreserved: true,
    addresses: {
      OLD_IMPLEMENTATION: oldImplementation,
      NEW_IMPLEMENTATION: newImplementation,
    },
    actors: {
      DEPLOYER: address(949),
      OWNER: smoke.owner,
      VAULT_OWNER: smoke.owner,
      SMOKE_USER: smoke.smokeUser,
    },
    signers: {
      deployment: {
        role: "DEPLOYER",
        address: address(949),
        username: "deployer-test",
      },
      pointer: {
        role: "OWNER",
        address: smoke.owner,
        username: "owner-test",
      },
    },
    reviewedSourceHash: sourceHash,
    sourceEvidence: {
      combinedSourceHash: sourceHash,
      reviewedSourceHash: sourceHash,
      independentlyExpectedSourceHash: sourceHash,
    },
    upgradeTransactionHash: hash(953),
    externalTransactionHashes: {
      implementationDeploymentSubmission: hash(954),
      implementationDeploymentExecution: null,
      pointerSubmission: hash(955),
      pointerExecution: null,
      manual: { smokeUserApproval: hash(956) },
      smoke: smoke.records.map((entry) => entry.transactionHash),
    },
    requirementAssertions: requiredAssertions,
    rollback: {
      oldImplementation,
      guardedWorkflowAvailable: true,
      drill: null,
    },
    orderedBlockEvidence: Array.from({ length: 18 }, (_, index) => ({
      label: `step-${index}`,
      blockNumber: String(index + 1),
      timestamp: index + 1,
    })),
    smokeTransactions: smoke.records,
    finalSnapshot,
  };
  const previous = process.env.EXPECTED_REVIEWED_SOURCE_HASH;
  process.env.EXPECTED_REVIEWED_SOURCE_HASH = sourceHash;
  try {
    parseRunbookReport(report);
    report.requirementAssertions.globalEventsVerified = false;
    assert.throws(() => parseRunbookReport(report), /globalEventsVerified/);
    report.requirementAssertions.globalEventsVerified = true;
    report.rollback.drill = { validation: { validated: false } };
    assert.throws(() => parseRunbookReport(report), /invalid rollback plan or drill/);
    report.rollback.drill = null;
    delete report.externalTransactionHashes.manual.smokeUserApproval;
    assert.throws(() => parseRunbookReport(report), /external transaction hashes/);
  } finally {
    if (previous == null) delete process.env.EXPECTED_REVIEWED_SOURCE_HASH;
    else process.env.EXPECTED_REVIEWED_SOURCE_HASH = previous;
  }
}

async function testRawEvidenceVerifier() {
  const addresses = {
    OWNER: address(900),
    DEPLOYER: address(906),
    APPROVER: address(907),
    EXECUTOR: address(901),
    VAULT_PROXY: address(902),
    NEW_IMPLEMENTATION: address(903),
    USER_WRAPPER: address(904),
    EVENT_EXECUTOR: address(905),
  };
  const txHash = hash(900);
  const raw = {
    hash: txHash,
    from: addresses.OWNER,
    to: addresses.VAULT_PROXY,
    cName: "YieldVault",
    funcName: "pause",
    args: [],
    blockNumber: "10",
    timestamp: "2026-01-01T00:00:10Z",
    transactionIndex: "1",
  };
  const receipt = {
    hash: txHash,
    status: "Success",
    txResult: { transactionHash: txHash },
  };
  const event = {
    event_name: "Paused",
    address: addresses.VAULT_PROXY,
    transaction_hash: txHash,
    block_number: "10",
    block_timestamp: "2026-01-01T00:00:10Z",
    event_index: "2",
    attributes: { account: addresses.OWNER },
  };
  const entry = {
    actor: "OWNER",
    contractName: "YieldVault",
    contractAddress: addresses.VAULT_PROXY,
    method: "pause",
    transactionHash: txHash,
    receipt,
    events: [{
      id: "paused-recorded",
      event_index: "2",
      eventName: "Paused",
      contractAddress: addresses.VAULT_PROXY,
      transaction_hash: txHash,
      attributes: { account: "OWNER" },
    }],
  };
  const expected = {
    name: "pause",
    actor: "OWNER",
    contractRole: "VAULT_PROXY",
    method: "pause",
    success: true,
    event: "Paused",
  };
  await validateTransactionEvidence(
    { token: "test" },
    entry,
    expected,
    addresses,
    {
      readRaw: async () => raw,
      readReceipt: async () => receipt,
      readEvent: async () => event,
    }
  );
  verifyRawCall({
    ...raw,
    to: addresses.OWNER,
    cName: "User",
    funcName: "callContract",
    args: [`"${addresses.VAULT_PROXY}"`, "\"pause\""],
  }, {
    ...expected,
    arguments: {},
    contractAddress: addresses.VAULT_PROXY,
  }, addresses, "wrapped pause");
  const deploymentSource = "contract YieldVault {}";
  const wrappedDeployment = {
    ...raw,
    from: addresses.DEPLOYER,
    to: addresses.USER_WRAPPER,
    cName: "User",
    funcName: "createContract",
    args: ["YieldVault", deploymentSource, "deadbeef"],
  };
  const deploymentExpected = {
    actor: "DEPLOYER",
    contractName: "YieldVault",
    sourceHash: submittedSourceHash(deploymentSource),
    sourceHasher: submittedSourceHash,
    constructorArgs: ["00000000000000000000000000000000deadbeef"],
  };
  assert.equal(
    verifyRawDeployment(
      wrappedDeployment,
      deploymentExpected,
      addresses,
      "wrapped deployment"
    ).shape,
    "User.createContract"
  );
  assert.equal(
    verifyRawDeployment(
      {
        ...wrappedDeployment,
        cName: undefined,
        args: ["YieldVault", deploymentSource, ["deadbeef"]],
      },
      deploymentExpected,
      addresses,
      "nested create deployment"
    ).shape,
    "User.createContract"
  );
  assert.throws(
    () => verifyRawDeployment({
      ...wrappedDeployment,
      args: ["YieldVault", `${deploymentSource} // changed`, "deadbeef"],
    }, deploymentExpected, addresses, "spoofed deployment"),
    /reviewed canonical hash/
  );
  assert.throws(
    () => verifyRawDeployment({
      ...wrappedDeployment,
      args: ["YieldVault", deploymentSource],
    }, deploymentExpected, addresses, "missing constructor deployment"),
    /direct or User\.createContract deployment/
  );
  assert.throws(
    () => verifyRawDeployment({
      ...wrappedDeployment,
      from: addresses.OWNER,
    }, deploymentExpected, addresses, "wrong deployment signer"),
    /signer mismatch/
  );
  for (const [fieldName, value, pattern] of [
    ["from", address(999), /signer/],
    ["to", address(999), /target or method/],
    ["funcName", "unpause", /target or method/],
  ]) {
    assert.throws(
      () => verifyRawCall(
        { ...raw, [fieldName]: value },
        { ...expected, arguments: {}, contractAddress: addresses.VAULT_PROXY },
        addresses,
        "spoofed"
      ),
      pattern
    );
  }
  assert.throws(
    () => verifyRawCall(
      { ...raw, funcName: "setLogicContract", args: [address(999)] },
      {
        name: "pointer",
        actor: "OWNER",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
        contractAddress: addresses.VAULT_PROXY,
      },
      addresses,
      "spoofed args"
    ),
    /argument 0 mismatch/
  );
  for (const spoof of [
    { ...event, address: address(999) },
    { ...event, transaction_hash: hash(999) },
    { ...event, block_number: "0" },
  ]) {
    await assert.rejects(
      getGlobalEvent(
        { token: "test" },
        {
          transactionHash: txHash,
          address: addresses.VAULT_PROXY,
          eventName: "Paused",
          recordedEvent: event,
        },
        { get: async () => ({ data: [spoof] }) }
      ),
      /event|block/
    );
  }
  const selectedEvent = await getGlobalEvent(
    { token: "test" },
    {
      transactionHash: txHash,
      address: addresses.VAULT_PROXY,
      eventName: "Paused",
      recordedEvent: event,
    },
    {
      get: async () => ({
        data: [
          { ...event, event_index: "1", attributes: { account: address(999) } },
          event,
        ],
      }),
    }
  );
  assert.equal(selectedEvent.event_index, "2");
  assert.doesNotThrow(
    () => assertOrdered([
      {
        label: "first", block: 10n, timestamp: 1000,
        transactionIndex: null, eventIndex: null,
      },
      {
        label: "second", block: 10n, timestamp: 1000,
        transactionIndex: null, eventIndex: null,
      },
    ])
  );
  const queueHash = hash(909);
  const queueEntry = {
    actor: "OWNER",
    contractAddress: addresses.VAULT_PROXY,
    arguments: { maxRequests: "3", maxAssets: "160000000000000000000" },
    transactionHash: queueHash,
    events: [1, 2, 3].map((requestId) => ({
      id: String(requestId),
      event_index: String(requestId),
      eventName: "QueueProcessed",
      contractAddress: addresses.VAULT_PROXY,
      transaction_hash: queueHash,
      attributes: {
        requestId: String(requestId),
        owner: addresses.OWNER,
        sharesBurned: "10",
        assetsReserved: "9",
        fullyProcessed: true,
      },
    })),
  };
  const queueEvents = queueEntry.events.map((recorded) => ({
    id: recorded.id,
    event_index: recorded.event_index,
    event_name: "QueueProcessed",
    address: addresses.VAULT_PROXY,
    transaction_hash: queueHash,
    block_number: "10",
    block_timestamp: "2026-01-01T00:00:10Z",
    attributes: recorded.attributes,
  }));
  await validateTargetEvents(
    { token: "test" },
    queueEntry,
    { name: "smokeProcessQueue", method: "processQueue", event: "QueueProcessed" },
    addresses,
    async (_token, query) => queueEvents.find((event) =>
      event.id === query.recordedEvent.id)
  );
  await assert.rejects(
    validateTargetEvents(
      { token: "test" },
      queueEntry,
      { name: "smokeProcessQueue", method: "processQueue", event: "QueueProcessed" },
      addresses,
      async (_token, query) => ({
        ...queueEvents.find((event) => event.id === query.recordedEvent.id),
        attributes: {
          ...queueEvents.find((event) => event.id === query.recordedEvent.id).attributes,
          sharesBurned: undefined,
        },
      })
    ),
    /sharesBurned/
  );

  const submissionHash = hash(910);
  const executionHash = hash(911);
  const issueId = "issue-1";
  const operation = {
    transactionHash: submissionHash,
    receipt: {
      hash: submissionHash,
      status: "Success",
      txResult: { transactionHash: submissionHash },
    },
    governanceIssueId: issueId,
    governanceExecution: { transactionHash: executionHash },
    governanceExecutionReceipt: {
      hash: executionHash,
      status: "Success",
      txResult: { transactionHash: executionHash },
    },
    governanceApproval: {
      transactionHash: executionHash,
      approver: { role: "APPROVER", address: addresses.APPROVER },
    },
  };
  const submissionRaw = {
    hash: submissionHash,
    from: addresses.OWNER,
    to: addresses.VAULT_PROXY,
    cName: "Proxy",
    funcName: "setLogicContract",
    args: [addresses.NEW_IMPLEMENTATION],
    blockNumber: "11",
    timestamp: "2026-01-01T00:00:11Z",
    transactionIndex: "1",
  };
  const executionRaw = {
    ...submissionRaw,
    hash: executionHash,
    from: addresses.APPROVER,
    blockNumber: "12",
    timestamp: "2026-01-01T00:00:12Z",
  };
  const issueBase = {
    address: ADMIN_REGISTRY,
    block_number: "11",
    block_timestamp: "2026-01-01T00:00:11Z",
    event_index: "2",
    attributes: {
      issueId,
      target: addresses.VAULT_PROXY,
      func: "setLogicContract",
      args: [addresses.NEW_IMPLEMENTATION],
      sender: addresses.USER_WRAPPER,
    },
  };
  operation.governanceIssueCreatedEvent = {
    ...issueBase,
    id: "created",
    event_name: "IssueCreated",
    transaction_hash: submissionHash,
  };
  operation.governanceExecution.row = {
    ...issueBase,
    id: "executed",
    event_index: "3",
    event_name: "IssueExecuted",
    transaction_hash: executionHash,
    block_number: "12",
    block_timestamp: "2026-01-01T00:00:12Z",
  };
  const governedResult = await validateGovernedOperation(
    { token: "test" },
    operation,
    {
      name: "pointer",
      actor: "OWNER",
      contractRole: "VAULT_PROXY",
      method: "setLogicContract",
      arguments: { _logicContract: "NEW_IMPLEMENTATION" },
    },
    addresses,
    {
      readRaw: async (_token, value) =>
        value === submissionHash ? submissionRaw : executionRaw,
      readReceipt: async (_token, value) => value === submissionHash
        ? operation.receipt
        : operation.governanceExecutionReceipt,
      readEvent: async (_token, query) => query.eventName === "IssueCreated"
        ? {
            ...issueBase,
            event_name: "IssueCreated",
            transaction_hash: submissionHash,
          }
        : {
            ...issueBase,
            event_name: "IssueExecuted",
            transaction_hash: executionHash,
            block_number: "12",
            block_timestamp: "2026-01-01T00:00:12Z",
            attributes: {
              ...issueBase.attributes,
              executor: addresses.EVENT_EXECUTOR,
            },
          },
    }
  );
  assert.equal(governedResult.submissionShape, "logical");
  assert.equal(governedResult.executionShape, "logical");
  await assert.rejects(
    validateGovernedOperation(
      { token: "test" },
      operation,
      {
        name: "pointer",
        actor: "OWNER",
        contractRole: "VAULT_PROXY",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
      },
      addresses,
      {
        readRaw: async (_token, value) => value === submissionHash
          ? submissionRaw
          : { ...executionRaw, from: addresses.EXECUTOR },
        readReceipt: async (_token, value) => value === submissionHash
          ? operation.receipt
          : operation.governanceExecutionReceipt,
        readEvent: async (_token, query) => query.eventName === "IssueCreated"
          ? operation.governanceIssueCreatedEvent
          : operation.governanceExecution.row,
      }
    ),
    /approval signer separation/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "test" },
      operation,
      {
        name: "pointer",
        actor: "OWNER",
        contractRole: "VAULT_PROXY",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
      },
      addresses,
      {
        readRaw: async (_token, value) => value === submissionHash
          ? submissionRaw
          : { ...executionRaw, args: [address(999)] },
        readReceipt: async (_token, value) => value === submissionHash
          ? operation.receipt
          : operation.governanceExecutionReceipt,
        readEvent: async (_token, query) => query.eventName === "IssueCreated"
          ? operation.governanceIssueCreatedEvent
          : operation.governanceExecution.row,
      }
    ),
    /does not exactly bind/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "test" },
      operation,
      {
        name: "pointer",
        actor: "OWNER",
        contractRole: "VAULT_PROXY",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
      },
      addresses,
      {
        readRaw: async (_token, value) => value === submissionHash
          ? submissionRaw
          : {
              ...executionRaw,
              to: ADMIN_REGISTRY,
              cName: "AdminRegistry",
              funcName: "castVoteOnIssue",
              args: [
                addresses.VAULT_PROXY,
                "setLogicContract",
                addresses.NEW_IMPLEMENTATION,
              ],
            },
        readReceipt: async (_token, value) => value === submissionHash
          ? operation.receipt
          : operation.governanceExecutionReceipt,
        readEvent: async (_token, query) => query.eventName === "IssueCreated"
          ? operation.governanceIssueCreatedEvent
          : operation.governanceExecution.row,
      }
    ),
    /must not call AdminRegistry\.castVoteOnIssue/
  );
  const deploymentSubmissionHash = hash(920);
  const deploymentExecutionHash = hash(921);
  const deploymentIssueId = "deploy-issue-1";
  const deploymentOperation = {
    transactionHash: deploymentSubmissionHash,
    receipt: {
      hash: deploymentSubmissionHash,
      status: "Success",
      txResult: { transactionHash: deploymentSubmissionHash },
    },
    governanceIssueId: deploymentIssueId,
    governanceIssueTarget: addresses.USER_WRAPPER,
    governanceIssueFunction: "createContract",
    governanceIssueArguments: ["YieldVault", deploymentSource, ["deadbeef"]],
    governancePayload: {
      target: addresses.USER_WRAPPER,
      func: "createContract",
      args: ["YieldVault", deploymentSource, ["deadbeef"]],
    },
    governanceExecution: { transactionHash: deploymentExecutionHash },
    governanceExecutionReceipt: {
      hash: deploymentExecutionHash,
      status: "Success",
      txResult: { transactionHash: deploymentExecutionHash },
    },
    governanceApproval: {
      transactionHash: deploymentExecutionHash,
      approver: { role: "APPROVER", address: addresses.APPROVER },
    },
  };
  const deploymentSubmissionRaw = {
    hash: deploymentSubmissionHash,
    from: addresses.DEPLOYER,
    to: addresses.USER_WRAPPER,
    cName: "User",
    funcName: "createContract",
    args: ["YieldVault", deploymentSource, ["deadbeef"]],
    blockNumber: "13",
    timestamp: "2026-01-01T00:00:13Z",
    transactionIndex: "1",
  };
  const deploymentExecutionRaw = {
    hash: deploymentExecutionHash,
    from: addresses.APPROVER,
    to: addresses.USER_WRAPPER,
    cName: "User",
    funcName: "createContract",
    args: ["YieldVault", deploymentSource, ["deadbeef"]],
    blockNumber: "14",
    timestamp: "2026-01-01T00:00:14Z",
    transactionIndex: "1",
  };
  const deploymentIssueBase = {
    address: ADMIN_REGISTRY,
    event_index: "2",
    attributes: {
      issueId: deploymentIssueId,
      target: addresses.USER_WRAPPER,
      func: "createContract",
      args: ["YieldVault", deploymentSource, ["deadbeef"]],
    },
  };
  deploymentOperation.governanceIssueCreatedEvent = {
    ...deploymentIssueBase,
    id: "deploy-created",
    event_name: "IssueCreated",
    transaction_hash: deploymentSubmissionHash,
    block_number: "13",
    block_timestamp: "2026-01-01T00:00:13Z",
  };
  deploymentOperation.governanceExecution.row = {
    ...deploymentIssueBase,
    id: "deploy-executed",
    event_index: "3",
    event_name: "IssueExecuted",
    transaction_hash: deploymentExecutionHash,
    block_number: "14",
    block_timestamp: "2026-01-01T00:00:14Z",
  };
  const deploymentExpectedGovernance = {
    name: "governed deployment",
    actor: "DEPLOYER",
    issueOnly: {
      target: addresses.USER_WRAPPER,
      func: "createContract",
      deployment: deploymentExpected,
    },
  };
  const deploymentDependencies = {
    readRaw: async (_token, value) =>
      value === deploymentSubmissionHash ? deploymentSubmissionRaw : deploymentExecutionRaw,
    readReceipt: async (_token, value) => value === deploymentSubmissionHash
      ? deploymentOperation.receipt
      : deploymentOperation.governanceExecutionReceipt,
    readEvent: async (_token, query) => query.eventName === "IssueCreated"
      ? deploymentOperation.governanceIssueCreatedEvent
      : deploymentOperation.governanceExecution.row,
  };
  const governedDeployment = await validateGovernedOperation(
    { token: "deployer-test" },
    deploymentOperation,
    deploymentExpectedGovernance,
    addresses,
    deploymentDependencies
  );
  assert.equal(governedDeployment.issueId, deploymentIssueId);
  await assert.rejects(
    validateGovernedOperation(
      { token: "deployer-test" },
      deploymentOperation,
      deploymentExpectedGovernance,
      addresses,
      {
        ...deploymentDependencies,
        readRaw: async (_token, value) => value === deploymentSubmissionHash
          ? { ...deploymentSubmissionRaw, to: address(999) }
          : deploymentExecutionRaw,
      }
    ),
    /governance target does not match raw User target/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "deployer-test" },
      deploymentOperation,
      deploymentExpectedGovernance,
      addresses,
      {
        ...deploymentDependencies,
        readRaw: async (_token, value) => value === deploymentSubmissionHash
          ? {
              ...deploymentSubmissionRaw,
              args: ["YieldVault", `${deploymentSource} changed`, ["deadbeef"]],
            }
          : deploymentExecutionRaw,
      }
    ),
    /reviewed canonical hash/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "deployer-test" },
      deploymentOperation,
      deploymentExpectedGovernance,
      addresses,
      {
        ...deploymentDependencies,
        readEvent: async (_token, query) => query.eventName === "IssueCreated"
          ? {
              ...deploymentOperation.governanceIssueCreatedEvent,
              attributes: {
                ...deploymentOperation.governanceIssueCreatedEvent.attributes,
                args: ["YieldVault", deploymentSource, "deadbeef"],
              },
            }
          : deploymentOperation.governanceExecution.row,
      }
    ),
    /nested constructor arguments/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "deployer-test" },
      deploymentOperation,
      deploymentExpectedGovernance,
      addresses,
      {
        ...deploymentDependencies,
        readRaw: async (_token, value) => value === deploymentSubmissionHash
          ? { ...deploymentSubmissionRaw, from: addresses.OWNER }
          : deploymentExecutionRaw,
      }
    ),
    /submission signer mismatch/
  );
  const failedExecutionReceipt = {
    hash: executionHash,
    status: "Failure",
    txResult: { transactionHash: executionHash },
  };
  const failedIssue = {
    ...operation.governanceIssueCreatedEvent,
    attributes: {
      ...operation.governanceIssueCreatedEvent.attributes,
      func: "initializeAccrual",
      args: [],
    },
  };
  const failedPrimaryRaw = {
    ...submissionRaw,
    cName: "YieldVault",
    funcName: "initializeAccrual",
    args: [],
  };
  const failedApprovalRaw = {
    ...executionRaw,
    cName: "YieldVault",
    funcName: "initializeAccrual",
    args: [],
  };
  const failedGovernedResult = await validateFailedGovernedExecution(
    { token: "test" },
    {
      transactionHash: submissionHash,
      receipt: operation.receipt,
      governanceIssueId: issueId,
      governanceIssueCreatedEvent: failedIssue,
      governanceApproval: operation.governanceApproval,
      executionTransactionHash: executionHash,
      executionReceipt: failedExecutionReceipt,
    },
    {
      name: "failed repeat",
      actor: "OWNER",
      contractRole: "VAULT_PROXY",
      method: "initializeAccrual",
      arguments: {},
    },
    addresses,
    {
      readRaw: async (_token, value) =>
        value === submissionHash ? failedPrimaryRaw : failedApprovalRaw,
      readReceipt: async (_token, value) =>
        value === submissionHash ? operation.receipt : failedExecutionReceipt,
      readEvent: async () => ({
        ...failedIssue,
        event_name: "IssueCreated",
        transaction_hash: submissionHash,
      }),
    }
  );
  assert.equal(failedGovernedResult.failedDuringGovernanceExecution, true);
  const logicalSubmissionRaw = {
    ...submissionRaw,
    to: addresses.USER_WRAPPER,
    cName: "User",
    funcName: "callContract",
    args: [
      addresses.VAULT_PROXY,
      "\"setLogicContract\"",
      addresses.NEW_IMPLEMENTATION,
    ],
  };
  const logicalResult = await validateGovernedOperation(
    { token: "test" },
    operation,
    {
      name: "pointer",
      actor: "OWNER",
      contractRole: "VAULT_PROXY",
      method: "setLogicContract",
      arguments: { _logicContract: "NEW_IMPLEMENTATION" },
    },
    addresses,
    {
      readRaw: async (_token, value) =>
        value === submissionHash ? logicalSubmissionRaw : executionRaw,
      readReceipt: async (_token, value) => value === submissionHash
        ? operation.receipt
        : operation.governanceExecutionReceipt,
      readEvent: async (_token, query) => query.eventName === "IssueCreated"
        ? {
            ...issueBase,
            event_name: "IssueCreated",
            transaction_hash: submissionHash,
          }
        : {
            ...issueBase,
            event_name: "IssueExecuted",
            transaction_hash: executionHash,
            block_number: "12",
            block_timestamp: "2026-01-01T00:00:12Z",
            attributes: {
              ...issueBase.attributes,
              executor: addresses.EVENT_EXECUTOR,
            },
          },
    }
  );
  assert.equal(logicalResult.submissionShape, "logical");
  assert.equal(logicalResult.executionShape, "logical");
  await assert.rejects(
    validateGovernedOperation(
      { token: "test" },
      operation,
      {
        name: "pointer",
        actor: "OWNER",
        contractRole: "VAULT_PROXY",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
      },
      addresses,
      {
        readRaw: async (_token, value) => value === submissionHash
          ? { ...logicalSubmissionRaw, args: [
              addresses.VAULT_PROXY,
              "\"setLogicContract\"",
              address(999),
            ] }
          : executionRaw,
        readReceipt: async (_token, value) => value === submissionHash
          ? operation.receipt
          : operation.governanceExecutionReceipt,
        readEvent: async (_token, query) => ({
          ...issueBase,
          event_name: query.eventName,
          transaction_hash: query.eventName === "IssueCreated"
            ? submissionHash
            : executionHash,
          attributes: {
            ...issueBase.attributes,
            executor: addresses.EVENT_EXECUTOR,
          },
        }),
      }
    ),
    /does not exactly bind/
  );
  await assert.rejects(
    validateGovernedOperation(
      { token: "test" },
      operation,
      {
        name: "pointer",
        actor: "OWNER",
        contractRole: "VAULT_PROXY",
        method: "setLogicContract",
        arguments: { _logicContract: "NEW_IMPLEMENTATION" },
      },
      addresses,
      {
        readRaw: async (_token, value) =>
          value === submissionHash ? submissionRaw : executionRaw,
        readReceipt: async (_token, value) => value === submissionHash
          ? operation.receipt
          : operation.governanceExecutionReceipt,
        readEvent: async (_token, query) => ({
          ...issueBase,
          event_name: query.eventName,
          transaction_hash: query.eventName === "IssueCreated"
            ? submissionHash
            : executionHash,
          attributes: {
            ...issueBase.attributes,
            target: address(999),
            executor: addresses.EVENT_EXECUTOR,
          },
        }),
      }
    ),
    /target or function mismatch/
  );
}

function testOnlyOwnerRegistryCoverage() {
  assert.deepEqual(Object.keys(ONLY_OWNER_CONTRACT_METHODS), [
    "Token", "YieldVaultOld", "YieldVault", "Proxy", "User",
  ]);
  const roles = [
    "OWNER", "VAULT_OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
    "SMOKE_USER", "REWARD_DISTRIBUTOR", "DAVE", "DONOR", "VAULT_PROXY",
    "ASSET", "NEW_IMPLEMENTATION", "OLD_IMPLEMENTATION",
  ];
  const addresses = Object.fromEntries(roles.map((role, index) => [role, address(1200 + index)]));
  const seedContext = {
    addresses,
    assetContractName: "Token",
    fundingValidation: {
      verifiedUnderlying: {
        ALICE: { target: 200n * U },
        BOB: { target: 150n * U },
        CAROL: { target: 100n * U },
        STRATEGY: { target: 30n * U },
      },
    },
    journal: { state: { checkpoints: {} } },
  };
  const seedSpecs = {
    ...buildSeedCheckpointSpecs(seedContext),
    "100": selectInitializeSpec(seedContext, { vaultInitialized: false }),
  };
  const e2eSpecs = buildSpecs({
    addresses,
    assetContractName: "Token",
    journal: { state: {} },
  });
  for (const [scope, specs] of [["seed", seedSpecs], ["e2e", e2eSpecs]]) {
    const submittedOwnerSpecs = Object.entries(specs)
      .filter(([, spec]) => spec.actor === "OWNER" && !spec.noTransaction);
    for (const [checkpoint, spec] of submittedOwnerSpecs) {
      assert.equal(assertMarkedOnlyOwner(spec, `${scope} ${checkpoint}`), true);
      assert.equal(
        registeredCheckpoint(scope, checkpoint, spec.registryContract, spec.method),
        true
      );
    }
    const expected = ONLY_OWNER_CHECKPOINTS[scope].entries;
    assert.deepEqual(
      submittedOwnerSpecs.map(([checkpoint, spec]) => ({
        checkpoint,
        contract: spec.registryContract,
        method: spec.method,
      })).sort((a, b) => a.checkpoint.localeCompare(b.checkpoint)),
      [...expected].sort((a, b) => a.checkpoint.localeCompare(b.checkpoint))
    );
  }
  for (const entry of ONLY_OWNER_CHECKPOINTS.manualRunbook.entries) {
    const expected = entry.checkpoint === "smokeProcessQueue"
      ? ECONOMIC_SMOKE_TRANSACTIONS.find((item) => item.name === entry.checkpoint)
      : REQUIRED_MANUAL_TRANSACTIONS[entry.checkpoint];
    assert(expected, `missing manual registry entry ${entry.checkpoint}`);
    assert.equal(expected.onlyOwner, true);
    assert.equal(expected.governed, true);
    assert.equal(expected.registryContract, entry.contract);
    assert.equal(expected.method, entry.method);
  }
  for (const entry of ONLY_OWNER_CHECKPOINTS.localUpgrade.entries) {
    assert.equal(
      registeredCheckpoint("localUpgrade", entry.checkpoint, entry.contract, entry.method),
      true
    );
  }
  assert.equal(
    registeredCheckpoint("funding", "mint-17", "Token", "mint"),
    true
  );
  assert.throws(
    () => assertMarkedOnlyOwner({
      name: "unmarked",
      registryContract: "YieldVault",
      method: "pause",
    }),
    /not explicitly marked governed/
  );
}

function testExactGovernanceEventMatching() {
  const target = address(1400);
  const expected = { target, func: "processQueue", args: ["1", "2"] };
  const created = {
    transaction_hash: hash(1401),
    block_number: "10",
    block_timestamp: "2026-07-28T18:00:00Z",
    event_index: "4",
    attributes: { target, func: "processQueue", args: ["1", "2"] },
  };
  const exactExecution = {
    ...created,
    transaction_hash: hash(1402),
    block_number: "11",
    event_index: "1",
  };
  assert.equal(governanceEventMatches(created, expected), true);
  assert.doesNotThrow(() => assertEventValues([
    {
      eventName: "QueueProcessed",
      attributes: { fullyProcessed: "false" },
    },
  ], "QueueProcessed", { fullyProcessed: false }));
  assert.equal(rawPayloadMatches({
    to: target,
    funcName: "setStrategyApproval",
    args: [`"${address(1404)}"`, "true"],
  }, {
    target,
    func: "setStrategyApproval",
    args: [address(1404), true],
  }), true);
  assert.equal(governanceEventMatches(
    { ...exactExecution, attributes: { ...exactExecution.attributes, args: ["1", "3"] } },
    expected
  ), false);
  assert.equal(governanceEventMatches(
    { ...exactExecution, attributes: { ...exactExecution.attributes, target: address(1403) } },
    expected
  ), false);
  assert.equal(governanceEventIsAfter(created, exactExecution), true);
  assert.equal(governanceEventIsAfter(created, {
    ...exactExecution,
    block_number: "9",
    block_timestamp: "2026-07-28T19:00:00Z",
  }), false);
  assert.equal(governanceEventIsAfter(created, {
    ...exactExecution,
    block_number: "10",
    event_index: "3",
  }), false);
}

async function testSignerStorageOwnerSeparation() {
  const signer = address(1500);
  const direct = await validateStorageOwnerAuthority(
    { address: signer, token: { token: "test" } },
    signer
  );
  assert.equal(direct.mode, "direct-owner");
  const governed = await validateStorageOwnerAuthority(
    { address: signer, token: { token: "test" } },
    ADMIN_REGISTRY,
    { readAdminMembership: async () => "3" }
  );
  assert.equal(governed.mode, "admin-registry");
  assert.equal(governed.signer, signer);
  assert.equal(governed.storageOwner, ADMIN_REGISTRY);
  await assert.rejects(
    () => validateStorageOwnerAuthority(
      { address: signer, token: { token: "test" } },
      ADMIN_REGISTRY,
      { readAdminMembership: async () => "0" }
    ),
    /not a live AdminRegistry admin/
  );
}

async function main() {
  await testNetworkRuntime();
  await testCanonicalHashAndLatestBlock();
  testIntegerPreservingJson();
  testSnapshotSubsetEvidence();
  testEventIdentityDeduplication();
  testFeeAdjustedExactStates();
  testCheckpointAwareRequirements();
  testActorGenerator();
  testArtifactWiring();
  testInitialSnapshotActorShape();
  testStructuredSeedDeploymentEvidence();
  await testManualEvidenceValidation();
  testSeedPreservationValidation();
  testUpgradeEvidenceValidation();
  testPreUnpauseSafety();
  testExamplesParse();
  testDisposableCli();
  testInitializeSpecPreservation();
  testDynamicE2EReconciliation();
  testFundingManifestValidation();
  testSingularSeedCheckpoints();
  await testCheckpoint410PreparationRecovery();
  const smoke = testStrictSmokeEvidence();
  testRunbookReportCompleteness(smoke);
  await testRawEvidenceVerifier();
  testOnlyOwnerRegistryCoverage();
  testExactGovernanceEventMatching();
  await testSignerStorageOwnerSeparation();
  console.log(
    "TOOLING_TEST_PASS network=2 actors=2 wiring=5 manual=8 preservation=2 upgrade=4 " +
    "preUnpause=3 examples=9 disposableCli=3 dynamic=26 fundingManifest=4 singularSequence=9 checkpoint410=5 " +
      "smoke=3 reportCompleteness=3 rawEvidence=14 queueFields=2 governedShapes=5 ordering=1 " +
      "runtime=4 feeExactness=13 checkpointFunding=4 initializationResume=4 " +
      "integerJson=3 onlyOwnerRegistry=54 castVoteOnIssueCalls=0"
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
