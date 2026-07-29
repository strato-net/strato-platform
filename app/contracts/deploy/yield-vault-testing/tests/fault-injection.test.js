#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_URL = process.env.NODE_URL || "http://localhost";
process.env.OAUTH_URL = process.env.OAUTH_URL || "http://localhost/oauth";
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test";
process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "test";

const axios = require("axios");
const { rest } = require("blockapps-rest");
const {
  createContext,
  executeCheckpoint,
  assertResumeState,
  lookupRawSubmission,
  migratePendingGovernanceApproval,
  stableJson,
  runWithJournal,
} = require("../scripts/common");

const ACTOR = "1".padStart(40, "0");
const APPROVER = "3".padStart(40, "0");
const CONTRACT = "2".padStart(40, "0");
const TX = "a".repeat(64);
const EXECUTION_TX = "b".repeat(64);
const EXTERNAL_EXECUTION_TX = "c".repeat(64);
const REDUNDANT_APPROVAL_TX = "d".repeat(64);

function contextFor(directory, capture, faultInjector) {
  const context = createContext({
    scriptName: "fault-injection",
    scriptPath: __filename,
    runStatePath: path.join(directory, "run-state.json"),
    actors: { USER: { address: ACTOR, token: { token: "test-token" } } },
    addresses: { CONTRACT },
    configuration: { test: true },
  });
  context.journal.acquire();
  context.capture = capture;
  context.faultInjector = faultInjector;
  return context;
}

function specFor(options = {}) {
  return {
    name: options.name || "change value",
    actor: "USER",
    contract: "CONTRACT",
    contractName: "TestContract",
    method: "change",
    args: {},
    events: options.events || [],
    expectedPostState: options.expectedPostState,
    reconcileSubmittedPostState: options.reconcileSubmittedPostState,
    assertPost(state) {
      assert.equal(state.value, "1");
    },
  };
}

async function withMocks(callback) {
  const originalCall = rest.call;
  const originalResults = rest.getBlocResults;
  const originalAxiosGet = axios.get;
  try {
    await callback({
      setCall(handler) {
        rest.call = handler;
      },
      setResults(handler) {
        rest.getBlocResults = handler;
      },
      setGet(handler) {
        axios.get = handler;
      },
    });
  } finally {
    rest.call = originalCall;
    rest.getBlocResults = originalResults;
    axios.get = originalAxiosGet;
  }
}

async function testReadyCrash(directory) {
  let live = { value: "0" };
  let calls = 0;
  let crash = true;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_ready" && crash) throw new Error("FAULT_AFTER_READY");
    }
  );
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      live = { value: "1" };
      return [{ hash: TX }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "1" }]);
    mock.setGet(async () => ({ data: [] }));
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_AFTER_READY/
    );
    assert.equal(context.journal.state.checkpoints["100"].status, "ready");
    assert.equal(calls, 0);
    crash = false;
    await assertResumeState(context, "100", ["100"], spec);
    await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(calls, 1);
    assert.equal(context.journal.state.checkpoints["100"].status, "confirmed");
  });
}

async function testSuccessfulSubmissionCrash(directory) {
  let live = { value: "0" };
  let calls = 0;
  let crash = true;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_submitted" && crash) throw new Error("FAULT_AFTER_SUBMITTED");
    }
  );
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      live = { value: "1" };
      return [{ hash: TX }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "2" }]);
    mock.setGet(async () => ({ data: [] }));
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_AFTER_SUBMITTED/
    );
    assert.equal(context.journal.state.checkpoints["100"].status, "submitted");
    crash = false;
    await assertResumeState(context, "100", ["100"], spec);
    await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(calls, 1);
    assert.equal(context.journal.state.checkpoints["100"].status, "confirmed");
  });
}

async function testDispatchingCrash(directory) {
  let live = { value: "0" };
  let calls = 0;
  let crash = true;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_dispatching" && crash) throw new Error("FAULT_DISPATCHING");
    }
  );
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      live = { value: "1" };
      return [{ hash: TX }];
    });
    mock.setGet(async () => ({ data: [] }));
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_DISPATCHING/
    );
    assert.equal(context.journal.state.checkpoints["100"].status, "dispatching");
    crash = false;
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /Submission outcome is ambiguous/
    );
    assert.equal(calls, 0);
  });
}

async function testPendingGovernance(
  directory,
  scope = "e2e",
  approvalFault = "after_approval_ready",
  options = {}
) {
  const isSeed = scope === "seed";
  const checkpoint = isSeed ? "130" : "410";
  const method = isSeed ? "setMinIdleBps" : "accrue";
  const args = isSeed ? { minIdleBps_: "1000" } : {};
  const positionalArgs = isSeed ? ["1000"] : [];
  let live = { value: "0" };
  let calls = 0;
  let crash = true;
  let approvalCalls = 0;
  let externalExecutionReady = false;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      const fault = options.externalExecution ? "after_submitted" : approvalFault;
      if (point === fault && crash) throw new Error("FAULT_GOVERNANCE");
    }
  );
  context.actors.OWNER = context.actors.USER;
  context.actors.APPROVER = {
    address: APPROVER,
    username: "approver-test",
    token: { token: "approver-token" },
  };
  context.approverAuthority = {
    signer: APPROVER,
    adminRegistry: "000000000000000000000000000000000000100c",
    adminMapMembership: "3",
    verified: true,
  };
  context.registryScope = scope;
  context.ownerAuthority = {
    mode: "admin-registry",
    signer: ACTOR,
    storageOwner: "000000000000000000000000000000000000100c",
    verified: true,
  };
  const spec = {
    ...specFor({
      events: ["Changed"],
      expectedPostState: () => ({ value: "1" }),
    }),
    actor: "OWNER",
    contractName: "YieldVault",
    method,
    args,
    onlyOwner: true,
    governed: true,
    registryContract: isSeed ? "YieldVaultOld" : "YieldVault",
  };
  await withMocks(async (mock) => {
    mock.setCall(async (tokenObj) => {
      if (tokenObj.token === "approver-token") {
        approvalCalls++;
        return [{ hash: EXECUTION_TX }];
      }
      calls++;
      return [{ hash: TX }];
    });
    mock.setResults(async (_token, hashes) =>
      [EXECUTION_TX, EXTERNAL_EXECUTION_TX].includes(hashes[0])
      ? [{ hash: hashes[0], status: "Success", blockNumber: "4" }]
      : [{
          hash: TX,
          status: "Success",
          blockNumber: "3",
          txResult: { response: { v: "issue-1" } },
        }]);
    mock.setGet(async (url, options) => {
      if (url.includes("IssueCreated")) {
        return { data: [{
          issueId: "issue-1",
          transaction_hash: TX,
          block_number: "3",
          block_timestamp: "2026-01-01T00:00:00Z",
          event_index: "1",
          attributes: {
            issueId: "issue-1",
            target: CONTRACT,
            func: method,
            args: positionalArgs,
          },
        }] };
      }
      if (url.includes("IssueExecuted")) {
        const executionHash = externalExecutionReady
          ? EXTERNAL_EXECUTION_TX
          : approvalCalls
            ? EXECUTION_TX
            : null;
        if (!executionHash) return { data: [] };
        live = { value: "1" };
        return {
          data: [{
            issueId: "issue-1",
            transaction_hash: executionHash,
            block_number: "4",
            block_timestamp: "2026-01-01T00:00:01Z",
            event_index: "1",
            attributes: {
              issueId: "issue-1",
              target: CONTRACT,
              func: method,
              args: positionalArgs,
            },
          }],
        };
      }
      if (url.endsWith("/strato-api/eth/v1.2/account")) {
        return { data: [{ address: APPROVER, nonce: "8" }] };
      }
      if (url.endsWith("/strato-api/eth/v1.2/transaction")) {
        const wanted = String(options.params.hash || "").replace(/^0x/, "");
        const executionHash = externalExecutionReady
          ? EXTERNAL_EXECUTION_TX
          : EXECUTION_TX;
        return {
          data: wanted === executionHash ? [{
            hash: executionHash,
            from: APPROVER,
            to: CONTRACT,
            cName: "YieldVault",
            funcName: method,
            args: positionalArgs,
          }] : [],
        };
      }
      if (url.endsWith("/cirrus/search/event") &&
          [EXECUTION_TX, EXTERNAL_EXECUTION_TX].some((hash) =>
            options.params.transaction_hash === `eq.${hash}`)) {
        return {
          data: [{
            address: CONTRACT,
            event_name: "Changed",
            transaction_hash: externalExecutionReady
              ? EXTERNAL_EXECUTION_TX
              : EXECUTION_TX,
            block_timestamp: "2026-01-01T00:00:00Z",
          }],
        };
      }
      return { data: [] };
    });
    await assert.rejects(
      executeCheckpoint(context, checkpoint, "DONE", spec),
      /FAULT_GOVERNANCE/
    );
    crash = false;
    externalExecutionReady = options.externalExecution === true;
    if (options.savedRedundantApproval) {
      context.journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          status: "confirmed",
          transactionHash: REDUNDANT_APPROVAL_TX,
          approver: { role: "APPROVER", address: APPROVER },
          target: CONTRACT,
          func: method,
          args: positionalArgs,
        },
      });
    }
    await assertResumeState(context, checkpoint, [checkpoint], spec);
    await executeCheckpoint(context, checkpoint, "DONE", spec);
    assert.equal(calls, 1);
    assert.equal(approvalCalls, options.externalExecution ? 0 : 1);
    assert.equal(
      context.journal.state.checkpoints[checkpoint].governanceExecutionTransactionHash,
      options.externalExecution ? EXTERNAL_EXECUTION_TX : EXECUTION_TX
    );
    if (options.savedRedundantApproval) {
      assert.equal(
        context.journal.state.checkpoints[checkpoint].governanceApproval.status,
        "redundant_after_external_execution"
      );
      assert.equal(
        context.journal.state.checkpoints[checkpoint].governanceCleanupRecommendation
          .mayHaveReopenedDeterministicIssue,
        true
      );
    }
  });
}

async function testDynamicEventReconciliation(directory) {
  let live = { value: "0", lastAccrual: "0" };
  let calls = 0;
  let crash = true;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_submitted" && crash) throw new Error("FAULT_DYNAMIC");
    }
  );
  const spec = specFor({
    events: ["Changed"],
    reconcileSubmittedPostState({ events }) {
      const event = events.find((candidate) => candidate.eventName === "Changed");
      assert(event);
      return { value: "1", lastAccrual: "7" };
    },
  });
  spec.assertPost = (state) => {
    assert.deepEqual(state, { value: "1", lastAccrual: "7" });
  };
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      live = { value: "1", lastAccrual: "7" };
      return [{ hash: TX }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "7" }]);
    mock.setGet(async (url) => url.endsWith("/cirrus/search/event")
      ? {
          data: [{
            address: CONTRACT,
            event_name: "Changed",
            transaction_hash: TX,
            block_timestamp: "7",
          }],
        }
      : { data: [] });
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_DYNAMIC/
    );
    crash = false;
    await assertResumeState(context, "100", ["100"], spec);
    await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(calls, 1);
    assert.equal(context.journal.state.checkpoints["100"].status, "confirmed");
  });
}

async function testLockReloadsAfterAcquire(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const runStatePath = path.join(directory, "run-state.json");
  fs.writeFileSync(runStatePath, JSON.stringify({ stale: true, checkpoints: {}, interruptions: [] }));
  const context = createContext({
    scriptName: "lock-race",
    scriptPath: __filename,
    runStatePath,
    actors: {},
    addresses: {},
    configuration: { test: "lock-race" },
  });
  fs.writeFileSync(runStatePath, JSON.stringify({
    stale: false,
    marker: "written-before-lock",
    checkpoints: {},
    interruptions: [],
  }));
  await runWithJournal(context, async () => {
    assert.equal(context.journal.state.stale, false);
    assert.equal(context.journal.state.marker, "written-before-lock");
  });
}

async function testNoHashExactPostRecovery(directory) {
  let live = { value: "0" };
  let calls = 0;
  let lookupEnabled = false;
  const context = contextFor(directory, async () => JSON.parse(stableJson(live)));
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      live = { value: "1" };
      return [{ status: "Pending", nonce: "7" }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "8" }]);
    mock.setGet(async (url) => {
      if (url.includes("/account")) return { data: [{ nonce: "7" }] };
      if (url.includes("/transaction") && lookupEnabled) {
        return { data: [{ hash: TX, nonce: "7", from: ACTOR }] };
      }
      return { data: [] };
    });
    await assert.rejects(executeCheckpoint(context, "100", "DONE", spec), /No transaction hash/);
    lookupEnabled = true;
    await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(calls, 1);
    assert.equal(context.journal.state.checkpoints["100"].status, "confirmed");
    assert.equal(
      context.journal.state.checkpoints["100"].recoveredSubmissionEvidence.source,
      "raw-transaction-nonce"
    );
  });
}

async function testDispatchingExactPostRecovery(directory) {
  let live = { value: "0" };
  let crash = true;
  let calls = 0;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_dispatching" && crash) throw new Error("FAULT_DISPATCH_EXACT_POST");
    }
  );
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      return [{ hash: TX }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "9" }]);
    mock.setGet(async (url) => {
      if (url.includes("/account")) return { data: [{ nonce: "7" }] };
      if (url.includes("/transaction")) return { data: [{ hash: TX, nonce: "7", from: ACTOR }] };
      return { data: [] };
    });
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_DISPATCH_EXACT_POST/
    );
    live = { value: "1" };
    crash = false;
    await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(calls, 0);
    assert.equal(context.journal.state.checkpoints["100"].status, "confirmed");
  });
}

async function testNonceAbsenceReplacement(directory, sequenceAfter, shouldReplace) {
  let live = { value: "0" };
  let calls = 0;
  const context = contextFor(directory, async () => JSON.parse(stableJson(live)));
  const spec = specFor({ expectedPostState: () => ({ value: "1" }) });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      calls++;
      if (calls === 1) return [{ status: "Pending", nonce: "7" }];
      live = { value: "1" };
      return [{ hash: TX, nonce: "7" }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "10" }]);
    mock.setGet(async (url) => {
      if (url.includes("/account")) {
        return { data: [{ nonce: calls === 0 ? "7" : String(sequenceAfter) }] };
      }
      if (url.includes("/transaction")) return { data: [] };
      return { data: [] };
    });
    await assert.rejects(executeCheckpoint(context, "100", "DONE", spec), /No transaction hash/);
    if (shouldReplace) {
      await executeCheckpoint(context, "100", "DONE", spec);
      assert.equal(calls, 2);
      assert.equal(context.journal.state.checkpoints["100"].replacementCount, 1);
    } else {
      await assert.rejects(
        executeCheckpoint(context, "100", "DONE", spec),
        /Submission outcome is ambiguous/
      );
      assert.equal(calls, 1);
    }
  });
}

async function testSupportedNonceRecoveryQuery() {
  const calls = [];
  await withMocks(async (mock) => {
    mock.setGet(async (url, options = {}) => {
      calls.push({ url, params: options.params });
      if (url.endsWith("/transaction/last/queued")) {
        return { data: [{ hash: TX, nonce: "7", from: ACTOR }] };
      }
      return {
        data: [
          { hash: "c".repeat(64), nonce: "6", from: ACTOR },
          { hash: "d".repeat(64), nonce: "7", from: CONTRACT },
        ],
      };
    });
    const result = await lookupRawSubmission({ token: "test" }, ACTOR, "7");
    assert.equal(result.transactionHash, TX);
    assert.equal(result.rows.length, 0);
    assert.equal(result.queuedRows.length, 1);
    assert.equal(result.queuedLookupPerformed, true);
    assert.equal(calls[0].params.from, ACTOR);
    assert.equal(calls[0].params.nonce, undefined);
    assert.equal(calls[0].params.limit, "100");
    assert.equal(calls[0].params.offset, "0");
  });
}

async function testSameTokenExactPersistence(directory) {
  let live = { value: "0", underlying: { USER: "100" } };
  let crash = true;
  const context = contextFor(
    directory,
    async () => JSON.parse(stableJson(live)),
    async (point) => {
      if (point === "after_submitted" && crash) throw new Error("FAULT_SAME_TOKEN_SUBMITTED");
    }
  );
  context.addresses.ASSET = "9".padStart(40, "0");
  context.addresses.USER = ACTOR;
  context.feePolicy = { feeToken: context.addresses.ASSET, feeWei: "10" };
  const spec = specFor({
    name: "same-token deposit",
    expectedPostState: () => ({ value: "1", underlying: { USER: "80" } }),
  });
  await withMocks(async (mock) => {
    mock.setCall(async () => {
      live = { value: "1", underlying: { USER: "70" } };
      return [{ hash: TX, nonce: "7" }];
    });
    mock.setResults(async () => [{ hash: TX, status: "Success", blockNumber: "12" }]);
    mock.setGet(async (url) => {
      if (url.includes("/account")) return { data: [{ nonce: "7" }] };
      return { data: [] };
    });
    await assert.rejects(
      executeCheckpoint(context, "100", "DONE", spec),
      /FAULT_SAME_TOKEN_SUBMITTED/
    );
    assert.equal(context.journal.state.checkpoints["100"].expectedPostState, null);
    await assertResumeState(context, "100", ["100"], spec);
    crash = false;
    const result = await executeCheckpoint(context, "100", "DONE", spec);
    assert.equal(result.feePaymentEvidence.mode, "fee-token");
    assert.equal(result.feePaymentEvidence.debit, "10");
    assert.equal(result.expectedPostState.underlying.USER, "70");
    assert.deepEqual(result.confirmedPostState, live);
  });
}

function testPendingGovernanceMetadataMigration(directory) {
  const context = contextFor(directory, async () => ({}), async () => {});
  try {
    context.journal.state.scriptHash = "old-script";
    context.journal.state.configHash = "old-config";
    context.journal.state.configuration = { test: true, commonHash: "old-common" };
    context.journal.state.checkpoints["410"] = {
      checkpointId: "410",
      status: "submitted",
      governanceIssueId: "pending-issue",
      governanceIssueCreatedEvent: { id: "created" },
      accessControl: { governed: true },
    };
    context.journal.save();
    assert.equal(migratePendingGovernanceApproval(context), true);
    assert.equal(context.journal.state.scriptHash, context.scriptHash);
    assert.equal(context.journal.state.configHash, context.configHash);
    assert.equal(
      context.journal.state.automaticApprovalMigration.checkpointId,
      "410"
    );
  } finally {
    context.journal.release();
  }
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-faults-"));
  try {
    await testReadyCrash(path.join(directory, "ready"));
    await testDispatchingCrash(path.join(directory, "dispatching"));
    await testSuccessfulSubmissionCrash(path.join(directory, "submitted"));
    await testPendingGovernance(path.join(directory, "governance-e2e"), "e2e");
    await testPendingGovernance(path.join(directory, "governance-seed"), "seed");
    await testPendingGovernance(
      path.join(directory, "governance-approval-dispatching"),
      "e2e",
      "after_approval_dispatching"
    );
    await testPendingGovernance(
      path.join(directory, "governance-approval-submitted"),
      "e2e",
      "after_approval_submitted"
    );
    await testPendingGovernance(
      path.join(directory, "governance-external-execution"),
      "e2e",
      "after_approval_ready",
      { externalExecution: true }
    );
    await testPendingGovernance(
      path.join(directory, "governance-redundant-approval"),
      "e2e",
      "after_approval_ready",
      { externalExecution: true, savedRedundantApproval: true }
    );
    await testDynamicEventReconciliation(path.join(directory, "dynamic"));
    await testLockReloadsAfterAcquire(path.join(directory, "lock-race"));
    await testNoHashExactPostRecovery(path.join(directory, "no-hash-post"));
    await testDispatchingExactPostRecovery(path.join(directory, "dispatching-post"));
    await testNonceAbsenceReplacement(path.join(directory, "nonce-safe"), "7", true);
    await testNonceAbsenceReplacement(path.join(directory, "nonce-closed"), "8", false);
    await testSupportedNonceRecoveryQuery();
    await testSameTokenExactPersistence(path.join(directory, "same-token"));
    testPendingGovernanceMetadataMigration(path.join(directory, "approval-migration"));
    console.log(
      "FAULT_INJECTION_PASS ready=1 dispatching=1 submitted=1 governance=6 " +
      "approvalReady=2 approvalDispatching=1 approvalSubmitted=1 dynamic=1 " +
      "externalExecution=2 redundantApproval=1 " +
      "lockRace=1 exactPostNoHash=1 exactPostDispatching=1 nonceSafeReplacement=1 " +
      "nonceFailClosed=1 nonceQuery=8 sameTokenExact=4 pendingMigration=4 " +
      "duplicateCalls=0 castVoteOnIssueCalls=0"
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
