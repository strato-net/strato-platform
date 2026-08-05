"use strict";

const assert = require("assert");

const {
  RAY,
  U,
} = require("../scripts/common");
const {
  migrateSolidVmQueueRetention,
  prepareSpecs,
  reconcileSmokeClaim,
  reconcileSmokeDeposit,
  reconcileSmokeQueue,
  reconcileSmokeRequest,
} = require("../scripts/runbook-smoke-operations");

const address = (value) => value.toString(16).padStart(40, "0");

function event(eventName, attributes, eventIndex = "1") {
  return {
    eventName,
    event_index: eventIndex,
    block_timestamp: "2026-01-01T00:01:40Z",
    attributes,
  };
}

function snapshot() {
  return {
    paused: false,
    accrualInitialized: true,
    rewardDistributor: address(4),
    perSecondSavingsRate: RAY.toString(),
    lastAccrual: "50",
    minIdleBps: "0",
    accountedAssets: (450n * U).toString(),
    deployedAssets: (200n * U).toString(),
    totalAssets: (450n * U).toString(),
    activeAssets: (400n * U).toString(),
    idle: (250n * U).toString(),
    totalSupply: (400n * U).toString(),
    totalQueuedShares: (150n * U).toString(),
    totalClaimableAssets: (50n * U).toString(),
    queueHead: "1",
    queueTail: "2",
    nextRequestId: "3",
    freeIdleForQueueProcessing: (200n * U).toString(),
    freeIdleForInstantWithdrawals: "0",
    maxDeploy: "0",
    exchangeRate: U.toString(),
    underlying: {
      ALICE: "0",
      BOB: "0",
      SMOKE_USER: (100n * U).toString(),
      REWARD_DISTRIBUTOR: (300n * U).toString(),
      VAULT_PROXY: (250n * U).toString(),
    },
    allowances: {
      ALICE: "0",
      BOB: "0",
      SMOKE_USER: (10n * U).toString(),
      REWARD_DISTRIBUTOR: (30n * U).toString(),
      VAULT_PROXY: "0",
    },
    shares: {
      ALICE: (80n * U).toString(),
      BOB: (70n * U).toString(),
      SMOKE_USER: "0",
      VAULT_PROXY: (150n * U).toString(),
    },
    activeRequestId: {
      ALICE: "1",
      BOB: "2",
      SMOKE_USER: "0",
    },
    claimableAssets: {
      ALICE: (50n * U).toString(),
      BOB: "0",
      SMOKE_USER: "0",
    },
    requests: {
      "1": {
        shares: (70n * U).toString(),
        receiver: address(1),
        next: "2",
        exists: true,
      },
      "2": {
        shares: (80n * U).toString(),
        receiver: address(2),
        next: "0",
        exists: true,
      },
      "3": {
        shares: "0",
        receiver: address(0),
        next: "0",
        exists: false,
      },
      "4": {
        shares: "0",
        receiver: address(0),
        next: "0",
        exists: false,
      },
    },
    requestOwner: {
      "1": address(1),
      "2": address(2),
      "3": address(0),
      "4": address(0),
    },
  };
}

function testPreparationOperations() {
  const context = {
    assetContractName: "Token",
    addresses: {
      REWARD_DISTRIBUTOR: address(4),
      VAULT_PROXY: address(5),
      SMOKE_USER: address(3),
    },
  };
  const specs = prepareSpecs(context);
  assert.deepEqual(Object.keys(specs), ["distributorApproval", "smokeUserApproval"]);
  const preState = snapshot();
  preState.paused = true;
  assert.doesNotThrow(() => specs.distributorApproval.assertPre(preState));
}

function testSmokeFlowReconciliation() {
  const context = {
    addresses: {
      ALICE: address(1),
      BOB: address(2),
      SMOKE_USER: address(3),
      REWARD_DISTRIBUTOR: address(4),
      VAULT_PROXY: address(5),
      ASSET: address(6),
      VAULT_OWNER: address(7),
      OLD_IMPLEMENTATION: address(8),
    },
  };
  const deposited = reconcileSmokeDeposit({
    preState: snapshot(),
    events: [event("Deposit", {
      sender: address(3),
      owner: address(3),
      assets: (10n * U).toString(),
      shares: (10n * U).toString(),
    })],
  });
  assert.equal(deposited.underlying.SMOKE_USER, (90n * U).toString());
  assert.equal(deposited.allowances.SMOKE_USER, "0");
  assert.equal(deposited.shares.SMOKE_USER, (10n * U).toString());
  assert.equal(deposited.totalSupply, (410n * U).toString());
  assert.equal(deposited.accountedAssets, (460n * U).toString());

  const requested = reconcileSmokeRequest({
    preState: deposited,
    events: [event("WithdrawalRequested", {
      requestId: "3",
      owner: address(3),
      receiver: address(3),
      shares: (10n * U).toString(),
    })],
  }, context);
  assert.equal(requested.queueTail, "3");
  assert.equal(requested.requests["2"].next, "3");
  assert.equal(requested.activeRequestId.SMOKE_USER, "3");
  assert.equal(requested.totalQueuedShares, (160n * U).toString());

  const processed = reconcileSmokeQueue({
    preState: requested,
    events: [
      event("QueueProcessed", {
        requestId: "1",
        owner: address(1),
        sharesBurned: (70n * U).toString(),
        assetsReserved: (70n * U).toString(),
        fullyProcessed: "true",
      }, "1"),
      event("QueueProcessed", {
        requestId: "2",
        owner: address(2),
        sharesBurned: (80n * U).toString(),
        assetsReserved: (80n * U).toString(),
        fullyProcessed: "true",
      }, "2"),
      event("QueueProcessed", {
        requestId: "3",
        owner: address(3),
        sharesBurned: (10n * U).toString(),
        assetsReserved: (10n * U).toString(),
        fullyProcessed: "true",
      }, "3"),
    ],
  }, context);
  assert.equal(processed.queueHead, "0");
  assert.equal(processed.queueTail, "0");
  assert.equal(processed.totalQueuedShares, "0");
  assert.equal(processed.totalSupply, (250n * U).toString());
  assert.equal(processed.claimableAssets.SMOKE_USER, (10n * U).toString());
  assert.equal(processed.requests["1"].shares, "0");
  assert.equal(processed.requests["1"].exists, true);
  assert.equal(processed.requests["1"].next, "2");
  assert.equal(processed.requests["3"].receiver, address(3));
  assert.equal(processed.requestOwner["3"], address(0));

  const claimed = reconcileSmokeClaim({
    preState: processed,
    events: [event("WithdrawalClaimed", {
      owner: address(3),
      receiver: address(3),
      assets: (10n * U).toString(),
    })],
  });
  assert.equal(claimed.claimableAssets.SMOKE_USER, "0");
  assert.equal(claimed.underlying.SMOKE_USER, (100n * U).toString());
  assert.equal(claimed.accountedAssets, (450n * U).toString());
  assert.equal(claimed.totalClaimableAssets, (200n * U).toString());
}

function testQueueRetentionMigration() {
  let saves = 0;
  const entry = {
    status: "submitted",
    economicExpectedPostState: { requests: {} },
    expectedPostState: { requests: {} },
    postStateDifferences: [{
      field: "requests.1.exists",
      expected: false,
      observed: true,
    }],
    latestObservedPostState: {
      queueHead: "0",
      queueTail: "0",
      requests: { "1": { shares: "0", exists: true } },
      requestOwner: { "1": address(0) },
    },
  };
  const context = {
    journal: {
      state: { checkpoints: { smokeProcessQueue: entry } },
      save() {
        saves++;
      },
    },
  };
  assert.equal(migrateSolidVmQueueRetention(context), true);
  assert.equal(entry.economicExpectedPostState, undefined);
  assert.equal(entry.reconciliationModelMigration.type, "solidvm-cleared-request-retention");
  assert.equal(saves, 1);
}

function main() {
  testPreparationOperations();
  testSmokeFlowReconciliation();
  testQueueRetentionMigration();
  console.log(
    "RUNBOOK_SMOKE_OPERATIONS_TEST_PASS preparation=2 deposit=1 request=1 queue=2 claim=1"
  );
}

if (require.main === module) main();

module.exports = { main };

