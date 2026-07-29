#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.NODE_URL = process.env.NODE_URL || "http://localhost";
process.env.OAUTH_URL = process.env.OAUTH_URL || "http://localhost/oauth";
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test";
process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "test";
process.env.EXPECTED_NETWORK_ID = "test-network";
process.env.REQUIRE_TESTNET = "true";

const {
  WorkflowStop,
  issueId,
  runDeployOldProxy,
  runSafeUpgrade,
} = require("../scripts/upgrade-safety");

const address = (value) => value.toString(16).padStart(40, "0");
const hash = (value) => value.toString(16).padStart(64, "0");
const OWNER = address(1);
const PROXY = address(2);
const OLD = address(3);
const NEW = address(4);
const ASSET = address(5);
const APPROVER = address(6);
const DEPLOYER = "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
const USER_CONTRACT = "a82340bde263c471e4714a6630deed2cd410721d";
const REGISTRY = "100c".padStart(40, "0");
const LIVE_DEPLOYMENT_ISSUE =
  "0439be6e088f51463a7f4087c5d4b8d3798ef4fc5cf9ec8e783bd385618ca9a5";
const LIVE_DEPLOYMENT_SUBMISSION =
  "1f3b768772a4104b60bc12ee5f07ceabbeb4a27c8d9aa79f754d1612e561183a";
const SOURCE = "exact reviewed combined\nsource with \"quotes\"";
const SOURCE_HASH = crypto.createHash("sha256").update(SOURCE).digest("hex");
const EMPTY = "deadbeef".padStart(40, "0");
const rawQuotedSource = (value) =>
  `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

function options(directory, overrides = {}) {
  return {
    proxyAddress: PROXY,
    expectedOldImplementation: OLD,
    expectedOwner: OWNER,
    expectedReviewedSourceHash: SOURCE_HASH,
    runState: path.join(directory, "run-state.json"),
    evidenceOutput: path.join(directory, "evidence.json"),
    deadlineMs: 60_000,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  let pointer = overrides.pointer || OLD;
  let paused = overrides.paused === undefined ? true : overrides.paused;
  let proxyOwner = overrides.proxyOwner || OWNER;
  let vaultOwner = overrides.vaultOwner || OWNER;
  let createCalls = 0;
  let callCalls = 0;
  let authCalls = 0;
  let governanceExecuted = false;
  let deploymentApproved = false;
  let sequence = 1;
  const signerUse = [];
  const receipts = {};
  const rawSubmissions = [];
  const createdAddresses = overrides.createdAddresses || [NEW];
  const dependencies = {
    combine: async () => overrides.source === undefined ? SOURCE : overrides.source,
    authenticateOwner: async (expectedOwner) => {
      authCalls++;
      return {
        address: overrides.authenticatedOwner || expectedOwner,
        username: "owner-test",
        token: { token: "SECRET_OWNER_TOKEN" },
      };
    },
    authenticateDeployer: async () => {
      authCalls++;
      return {
        address: overrides.authenticatedDeployer || DEPLOYER,
        username: "deployer-test",
        token: { token: "SECRET_DEPLOYER_TOKEN" },
      };
    },
    authenticateApprover: async () => {
      authCalls++;
      return {
        address: overrides.authenticatedApprover || APPROVER,
        username: "approver-test",
        token: { token: "SECRET_APPROVER_TOKEN" },
      };
    },
    readAdminMembership: async (_token, _registry, signer) => {
      if (overrides.adminMembershipBySigner &&
          Object.prototype.hasOwnProperty.call(overrides.adminMembershipBySigner, signer)) {
        return overrides.adminMembershipBySigner[signer];
      }
      return signer === APPROVER ? "3" : overrides.adminMembership || "0";
    },
    getMetadata: async () => ({
      networkID: "test-network",
      networkName: "helium-test",
      chainId: "7",
      isSynced: true,
    }),
    pollMs: 0,
    sleep: async () => {},
    injectFault: overrides.injectFault || (async () => {}),
    readAccountSubmissionState: async (token, signer) => {
      signerUse.push({ action: "sequence", token: token.token, signer });
      return {
      endpoint: "fixture",
      sequence: String(sequence),
      rowCount: 1,
      };
    },
    lookupRawSubmission: async (token, signer, nonce) => {
      signerUse.push({ action: "lookup", token: token.token, signer });
      const rows = rawSubmissions.filter((row) => String(row.nonce) === String(nonce));
      return {
        rows,
        queuedRows: [],
        transactionHash: rows.length === 1 ? rows[0].hash : null,
        lookupPerformed: true,
        queuedLookupPerformed: true,
      };
    },
    captureVault: async () => ({
      implementation: pointer,
      owner: vaultOwner,
      asset: ASSET,
      name: "Test Vault",
      symbol: "tVLT",
      paused,
      vaultInitialized: true,
      totalSupply: "100",
      idle: "80",
      totalAssets: "100",
      deployedAssets: "20",
      totalClaimableAssets: "10",
      accrualInitialized: pointer === OLD && overrides.postAccrual ? false : true,
      perSecondSavingsRate: pointer === OLD && overrides.postAccrual ? "0" : "100",
      lastAccrual: pointer === OLD && overrides.postAccrual ? "0" : "10",
      rewardDistributor: pointer === OLD && overrides.postAccrual
        ? "0".repeat(40)
        : address(9),
      shares: { OWNER: "90", VAULT_PROXY: "10" },
      requests: { "1": { shares: "10", exists: true } },
    }),
    rest: {
      async getState(token, contract) {
        signerUse.push({
          action: "state",
          token: token.token,
          contractName: contract.name,
          contractAddress: contract.address,
        });
        if (overrides.rejectProxy && contract.address === overrides.rejectProxy) {
          throw new Error("Proxy does not exist");
        }
        if (contract.name === "Proxy") {
          return { logicContract: pointer, _owner: proxyOwner };
        }
        if (contract.name === "YieldVault") {
          const implementationState = contract.address !== PROXY;
          return {
            _owner: implementationState ? EMPTY : vaultOwner,
            _asset: ASSET,
            _paused: paused,
            vaultInitialized: true,
            _name: "Test Vault",
            _symbol: "tVLT",
          };
        }
        throw new Error(`Unexpected getState ${contract.name}`);
      },
      async createContract(token, contractArgs, options) {
        assert.deepEqual(options.query, { username: "BlockApps" });
        signerUse.push({ action: "create", token: token.token, signer: DEPLOYER });
        createCalls++;
        const transactionHash = overrides.governedDeployment
          ? LIVE_DEPLOYMENT_SUBMISSION
          : hash(10 + createCalls);
        const created = createdAddresses[createCalls - 1] || NEW;
        rawSubmissions.push(overrides.governedDeployment
          ? {
              hash: transactionHash,
              nonce: String(sequence++),
              from: DEPLOYER,
              to: USER_CONTRACT,
              cName: "User",
              funcName: "createContract",
              args: [
                contractArgs.name,
                overrides.rawDeploymentSource || rawQuotedSource(contractArgs.source),
                ...(overrides.nestedRawDeploymentArgs
                  ? [Object.values(contractArgs.args)]
                  : Object.values(contractArgs.args)),
              ],
            }
          : {
              hash: transactionHash,
              nonce: String(sequence++),
              from: DEPLOYER,
              cName: contractArgs.name,
              args: Object.values(contractArgs.args),
              code: contractArgs.source,
            });
        receipts[transactionHash] = overrides.governedDeployment
          ? {
              hash: transactionHash,
              status: "Success",
              data: { contents: [LIVE_DEPLOYMENT_ISSUE], tag: "Call" },
              txResult: { transactionHash },
            }
          : {
              hash: transactionHash,
              status: "Success",
              txResult: { transactionHash, contractsCreated: [created] },
            };
        if (overrides.transportCreateOnce && createCalls === 1) {
          throw new Error("transport closed after dispatch");
        }
        return [{ hash: transactionHash }];
      },
      async call(token, callArguments) {
        const approval = token.token === "SECRET_APPROVER_TOKEN";
        const signer = approval ? APPROVER : OWNER;
        signerUse.push({ action: "call", token: token.token, signer });
        callCalls++;
        const isDeploymentApproval = approval && callArguments.method === "createContract";
        const transactionHash = isDeploymentApproval
          ? hash(199)
          : approval && overrides.governance
            ? hash(99)
            : hash(30 + callCalls);
        rawSubmissions.push({
          hash: transactionHash,
          nonce: String(sequence++),
          from: signer,
          to: callArguments.contract.address,
          cName: callArguments.contract.name,
          funcName: callArguments.method,
          args: isDeploymentApproval
            ? [
                callArguments.args.contractName,
                callArguments.args.contractSrc,
                ...callArguments.args.args,
              ]
            : Object.values(callArguments.args),
        });
        if (isDeploymentApproval) {
          deploymentApproved = true;
          receipts[transactionHash] = {
            hash: transactionHash,
            status: "Success",
            txResult: { transactionHash, contractsCreated: [NEW] },
          };
        } else if (approval && overrides.governance) {
          governanceExecuted = true;
          if (!overrides.staleExecutionOnly) pointer = overrides.callTarget || NEW;
          receipts[transactionHash] = {
            hash: transactionHash,
            status: "Success",
            txResult: { transactionHash },
          };
        } else {
          if (!overrides.governance) pointer = overrides.callTarget || NEW;
          receipts[transactionHash] = overrides.governance
          ? {
              hash: transactionHash,
              status: "Success",
              txResult: { transactionHash, response: { v: "issue-1" } },
            }
          : { hash: transactionHash, status: "Success",
              txResult: { transactionHash } };
        }
        return [{ hash: transactionHash }];
      },
      async getBlocResults(token, hashes) {
        const transactionHash = hashes[0].replace(/^0x/, "");
        signerUse.push({ action: "receipt", token: token.token, transactionHash });
        if (transactionHash === hash(97)) {
          return [{ hash: transactionHash, status: "Success", blockNumber: "11" }];
        }
        if (transactionHash === hash(199)) {
          return [{
            hash: transactionHash,
            status: "Success",
            txResult: { transactionHash, contractsCreated: [NEW] },
          }];
        }
        if (transactionHash === hash(99)) {
          if (governanceExecuted && !overrides.staleExecutionOnly) {
            pointer = overrides.callTarget || NEW;
          }
          return [{ hash: transactionHash, status: "Success" }];
        }
        return [receipts[transactionHash] || {
          hash: transactionHash,
          status: "Pending",
        }];
      },
    },
    axios: {
      async get(url, request = {}) {
        if (url.includes("/strato-api/eth/v1.2/transaction")) {
          return {
            data: rawSubmissions.filter((row) =>
              row.hash === String(request.params.hash).replace(/^0x/, "")),
          };
        }
        if (url.includes("IssueCreated")) {
          if (overrides.governedDeployment) {
            return {
              data: [{
                id: "deploy-created",
                event_index: "1",
                issueId: LIVE_DEPLOYMENT_ISSUE,
                target: overrides.issueTarget || USER_CONTRACT,
                func: "createContract",
                args: overrides.issueArgs ||
                  ["YieldVault", overrides.issueSource || SOURCE, [EMPTY]],
                transaction_hash: LIVE_DEPLOYMENT_SUBMISSION,
                block_number: "7",
                block_timestamp: "2026-01-01T00:00:00Z",
              }],
            };
          }
          return {
            data: overrides.governance
              ? [{
                  id: "1",
                  event_index: "1",
                  issueId: "issue-1",
                  target: PROXY,
                  func: "setLogicContract",
                  args: [NEW],
                  transaction_hash: hash(31),
                  block_number: "10",
                  block_timestamp: "2026-01-01T00:00:00Z",
                }]
              : [],
          };
        }
        if (url.includes("IssueExecuted")) {
          if (overrides.governedDeployment) {
            return {
              data: deploymentApproved ? [{
                id: "deploy-executed",
                event_index: "2",
                issueId: LIVE_DEPLOYMENT_ISSUE,
                target: overrides.issueTarget || USER_CONTRACT,
                func: "createContract",
                args: overrides.issueArgs ||
                  ["YieldVault", overrides.issueSource || SOURCE, [EMPTY]],
                transaction_hash: hash(199),
                block_number: "8",
                block_timestamp: "2026-01-01T00:00:01Z",
              }] : [],
            };
          }
          if (!overrides.governance) return { data: [] };
          if (overrides.externalExecution) {
            governanceExecuted = true;
            pointer = overrides.callTarget || NEW;
            return {
              data: [{
                issueId: "issue-1",
                id: "external-execution",
                event_index: "1",
                target: PROXY,
                func: "setLogicContract",
                args: [NEW],
                transaction_hash: hash(97),
                block_number: "11",
                block_timestamp: "2026-01-01T00:00:01Z",
              }],
            };
          }
          if (!overrides.staleExecutionOnly && !governanceExecuted) {
            return { data: [] };
          }
          if (!overrides.staleExecutionOnly) {
            pointer = overrides.callTarget || NEW;
          }
          return {
            data: overrides.staleExecutionOnly ? [{
              issueId: "issue-1",
              id: "0",
              event_index: "9",
              target: PROXY,
              func: "setLogicContract",
              args: [NEW],
              transaction_hash: hash(98),
              block_number: "9",
              block_timestamp: "2025-12-31T23:59:59Z",
            }] : [{
              issueId: "issue-1",
              id: "2",
              event_index: "2",
              target: PROXY,
              func: "setLogicContract",
              args: [NEW],
              transaction_hash: hash(99),
              block_number: "10",
              block_timestamp: "2026-01-01T00:00:00Z",
            }],
          };
        }
        return { data: [] };
      },
    },
  };
  return {
    dependencies,
    counts: () => ({ createCalls, callCalls, authCalls }),
    signerUse: () => signerUse,
    pointer: () => pointer,
    setPointer(value) {
      pointer = value;
    },
    setFault(handler) {
      dependencies.injectFault = handler;
    },
    approveDeployment() {
      deploymentApproved = true;
    },
  };
}

async function expectPreconditionFailure(directory, fixtureOptions, optionOverrides, pattern) {
  const test = fixture(fixtureOptions);
  await assert.rejects(
    runSafeUpgrade(options(directory, optionOverrides), test.dependencies),
    pattern
  );
  assert.equal(test.counts().createCalls, 0);
  assert.equal(test.counts().callCalls, 0);
}

async function testSourceMismatch(directory) {
  assert.equal(issueId("scalar-issue"), "scalar-issue");
  assert.equal(issueId(["array-issue"]), "array-issue");
  assert.equal(issueId([{ hash: hash(1), status: "Pending" }]), null);
  assert.equal(issueId({
    issueId: "must-not-be-used",
    data: { contents: { address: PROXY, name: "Proxy" }, tag: "Upload" },
    hash: hash(2),
    status: "Success",
  }), null);
  assert.equal(issueId({
    data: { contents: ["issue-one", "issue-two"], tag: "Call" },
    status: "Success",
  }), null);
  assert.equal(issueId({
    data: { contents: ["deployment-issue"], tag: "Call" },
    hash: hash(3),
    status: "Success",
  }), "deployment-issue");
  const test = fixture({ source: "different source" });
  await assert.rejects(
    runSafeUpgrade(options(directory), test.dependencies),
    /EXPECTED_REVIEWED_SOURCE_HASH mismatch/
  );
  assert.deepEqual(test.counts(), { createCalls: 0, callCalls: 0, authCalls: 0 });
}

async function testWrongPreconditions(directory) {
  await expectPreconditionFailure(
    path.join(directory, "proxy"),
    { rejectProxy: address(999) },
    { proxyAddress: address(999) },
    /Proxy does not exist/
  );
  await expectPreconditionFailure(
    path.join(directory, "implementation"),
    { pointer: address(888) },
    {},
    /Proxy logic pointer mismatch/
  );
  await expectPreconditionFailure(
    path.join(directory, "owner"),
    { proxyOwner: address(777) },
    {},
    /Owner mismatch/
  );
  await expectPreconditionFailure(
    path.join(directory, "paused"),
    { paused: false },
    {},
    /Paused state mismatch/
  );
}

async function testReadyCrash(directory) {
  let crash = true;
  const test = fixture({
    injectFault: async (point) => {
      if (point === "after_ready" && crash) throw new Error("CRASH_AFTER_READY");
    },
  });
  const args = options(directory);
  await assert.rejects(runSafeUpgrade(args, test.dependencies), /CRASH_AFTER_READY/);
  assert.equal(test.counts().createCalls, 0);
  const saved = JSON.parse(fs.readFileSync(args.runState, "utf8"));
  assert.equal(saved.checkpoints["deploy-new-implementation"].status, "ready");
  crash = false;
  await runSafeUpgrade(args, test.dependencies);
  assert.deepEqual(test.counts(), { createCalls: 1, callCalls: 1, authCalls: 6 });
}

async function testDispatchingCrash(directory) {
  let crash = true;
  const test = fixture({
    injectFault: async (point) => {
      if (point === "after_dispatching" && crash) throw new Error("CRASH_AFTER_DISPATCHING");
    },
  });
  const args = options(directory);
  await assert.rejects(runSafeUpgrade(args, test.dependencies), /CRASH_AFTER_DISPATCHING/);
  assert.equal(test.counts().createCalls, 0);
  crash = false;
  await runSafeUpgrade(args, test.dependencies);
  assert.equal(test.counts().createCalls, 1);
}

async function testSubmittedCrash(directory) {
  let crash = true;
  const test = fixture({
    injectFault: async (point) => {
      if (point === "after_submitted" && crash) throw new Error("CRASH_AFTER_SUBMITTED");
    },
  });
  const args = options(directory);
  await assert.rejects(runSafeUpgrade(args, test.dependencies), /CRASH_AFTER_SUBMITTED/);
  assert.equal(test.counts().createCalls, 1);
  crash = false;
  await runSafeUpgrade(args, test.dependencies);
  assert.equal(test.counts().createCalls, 1);
  assert.equal(test.counts().callCalls, 1);
}

async function testGovernanceResume(directory) {
  let crash = true;
  const test = fixture({
    governance: true,
    governanceIssueResponse: true,
    injectFault: async (point, details) => {
      if (point === "after_submitted" &&
          details.checkpoint === "upgrade-pointer" && crash) {
        throw new Error("CRASH_PENDING_GOVERNANCE");
      }
    },
  });
  const args = options(directory);
  await assert.rejects(
    runSafeUpgrade(args, test.dependencies),
    /CRASH_PENDING_GOVERNANCE/
  );
  crash = false;
  await runSafeUpgrade(args, test.dependencies);
  assert.equal(test.counts().createCalls, 1);
  assert.equal(test.counts().callCalls, 2);
  assert.equal(test.pointer(), NEW);
  const evidence = JSON.parse(fs.readFileSync(args.evidenceOutput, "utf8"));
  assert.equal(evidence.upgrades[0].governance.issueId, "issue-1");
  assert.equal(evidence.upgrades[0].governance.executionTransactionHash, hash(99));
  assert.deepEqual(evidence.upgrades[0].upgradeSubmission.submissionHashes, [hash(31)]);
}

async function testExternalGovernanceExecution(directory) {
  for (const savedRedundantApproval of [false, true]) {
    let crash = true;
    const test = fixture({
      governance: true,
      externalExecution: true,
      injectFault: async (point, details) => {
        if (point === "after_submitted" &&
            details.checkpoint === "upgrade-pointer" && crash) {
          throw new Error("CRASH_PENDING_EXTERNAL_GOVERNANCE");
        }
      },
    });
    const args = options(path.join(directory, savedRedundantApproval ? "journal" : "pending"));
    await assert.rejects(
      runSafeUpgrade(args, test.dependencies),
      /CRASH_PENDING_EXTERNAL_GOVERNANCE/
    );
    if (savedRedundantApproval) {
      const state = JSON.parse(fs.readFileSync(args.runState, "utf8"));
      state.checkpoints["upgrade-pointer"].governanceApproval = {
        status: "confirmed",
        transactionHash: hash(96),
        approver: { role: "APPROVER", address: APPROVER },
        target: PROXY,
        func: "setLogicContract",
        args: [NEW],
      };
      fs.writeFileSync(args.runState, JSON.stringify(state));
    }
    crash = false;
    const evidence = await runSafeUpgrade(args, test.dependencies);
    const operation = evidence.operations["upgrade-pointer"];
    assert.equal(evidence.completed, true);
    assert.equal(test.counts().createCalls, 1);
    assert.equal(test.counts().callCalls, 1);
    assert.equal(test.pointer(), NEW);
    assert.equal(operation.governanceExecution.transactionHash, hash(97));
    assert.equal(operation.governanceExecutionSource, "external_or_manual");
    if (savedRedundantApproval) {
      assert.equal(
        operation.governanceApproval.status,
        "redundant_after_external_execution"
      );
      assert.equal(
        operation.governanceCleanupRecommendation.mayHaveReopenedDeterministicIssue,
        true
      );
    }
    await runSafeUpgrade(args, test.dependencies);
    assert.equal(test.counts().callCalls, 1);
  }
}

async function testApprovalCrashRecovery(directory) {
  for (const point of [
    "after_approval_ready",
    "after_approval_dispatching",
    "after_approval_submitted",
  ]) {
    let crash = true;
    const test = fixture({
      governance: true,
      injectFault: async (observed, details) => {
        if (observed === point && details.checkpoint === "upgrade-pointer" && crash) {
          throw new Error(`CRASH_${point}`);
        }
      },
    });
    const args = options(path.join(directory, point));
    await assert.rejects(runSafeUpgrade(args, test.dependencies), new RegExp(`CRASH_${point}`));
    crash = false;
    const evidence = await runSafeUpgrade(args, test.dependencies);
    assert.equal(evidence.completed, true);
    assert.equal(test.counts().createCalls, 1);
    assert.equal(test.counts().callCalls, 2);
    assert.equal(
      evidence.operations["upgrade-pointer"].governanceApproval.transactionHash,
      hash(99)
    );
  }
}

async function testCreateContractApprovalCrashRecovery(directory) {
  let crash = true;
  const test = fixture({
    governedDeployment: true,
    injectFault: async (point, details) => {
      if (point === "after_approval_ready" &&
          details.checkpoint === "deploy-new-implementation" && crash) {
        throw new Error("CRASH_CREATE_APPROVAL_READY");
      }
    },
  });
  const args = options(directory);
  await assert.rejects(
    runSafeUpgrade(args, test.dependencies),
    /CRASH_CREATE_APPROVAL_READY/
  );
  const legacy = JSON.parse(fs.readFileSync(args.runState, "utf8"));
  delete legacy.checkpoints["deploy-new-implementation"].governanceApproval;
  legacy.configurationHash = hash(444);
  legacy.configuration.workflowCodeHash = hash(445);
  fs.writeFileSync(args.runState, JSON.stringify(legacy));
  crash = false;
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(test.counts().createCalls, 1);
  assert.equal(
    evidence.operations["deploy-new-implementation"].governanceApproval.call.contract.address,
    USER_CONTRACT
  );
  const migrated = JSON.parse(fs.readFileSync(args.runState, "utf8"));
  assert.equal(
    migrated.automaticApprovalMigration.checkpointId,
    "deploy-new-implementation"
  );
}

async function testWorkflowCodeMigrationAfterApproval(directory) {
  let crash = true;
  const test = fixture({
    governedDeployment: true,
    injectFault: async (point, details) => {
      if (point === "after_approval_submitted" &&
          details.checkpoint === "deploy-new-implementation" && crash) {
        throw new Error("CRASH_CREATE_APPROVAL_SUBMITTED");
      }
    },
  });
  const args = options(directory);
  await assert.rejects(
    runSafeUpgrade(args, test.dependencies),
    /CRASH_CREATE_APPROVAL_SUBMITTED/
  );
  const saved = JSON.parse(fs.readFileSync(args.runState, "utf8"));
  assert.equal(
    saved.checkpoints["deploy-new-implementation"].governanceApproval.transactionHash,
    hash(199)
  );
  saved.configurationHash = hash(446);
  saved.configuration.workflowCodeHash = hash(447);
  fs.writeFileSync(args.runState, JSON.stringify(saved));
  crash = false;
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(test.counts().createCalls, 1);
  const migrated = JSON.parse(fs.readFileSync(args.runState, "utf8"));
  assert.equal(migrated.workflowCodeMigration.type, "workflow-code-resume");
  assert.equal(
    migrated.workflowCodeMigration.checkpointId,
    "deploy-new-implementation"
  );
}

async function testSuccessfulUpgrade(directory) {
  const test = fixture();
  const args = options(directory);
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(evidence.implementation.address, NEW);
  assert.equal(evidence.upgrades[0].confirmedImplementation, NEW);
  assert.equal(evidence.upgrades[0].invariantsPreserved, true);
  assert.deepEqual(test.counts(), { createCalls: 1, callCalls: 1, authCalls: 3 });
  assert.equal(evidence.deploymentSigner, DEPLOYER);
  assert.equal(evidence.operatorSigner, OWNER);
  assert.equal(evidence.operations["deploy-new-implementation"].signer.role, "DEPLOYER");
  assert.equal(evidence.operations["upgrade-pointer"].signer.role, "OWNER");
  const signerUse = test.signerUse();
  assert(signerUse.some((entry) =>
    entry.action === "create" && entry.token === "SECRET_DEPLOYER_TOKEN"));
  assert(signerUse.some((entry) =>
    entry.action === "call" && entry.token === "SECRET_OWNER_TOKEN"));
  assert(signerUse.some((entry) =>
    entry.action === "receipt" && entry.transactionHash === hash(11) &&
    entry.token === "SECRET_DEPLOYER_TOKEN"));
  assert(signerUse.some((entry) =>
    entry.action === "receipt" && entry.transactionHash === hash(31) &&
    entry.token === "SECRET_OWNER_TOKEN"));
}

async function testGovernedStorageOwner(directory) {
  const test = fixture({
    proxyOwner: REGISTRY,
    vaultOwner: REGISTRY,
    authenticatedOwner: OWNER,
    adminMembership: "1",
  });
  const evidence = await runSafeUpgrade(options(directory, {
    expectedOwner: REGISTRY,
  }), test.dependencies);
  assert.equal(evidence.expectedStorageOwner, REGISTRY);
  assert.equal(evidence.operatorSigner, OWNER);
  assert.equal(evidence.operatorGovernance.adminMapMembership, "1");
  assert.equal(evidence.deploymentSigner, DEPLOYER);
  assert.equal(evidence.deploymentGovernance.adminMapMembership, "1");
}

async function testGovernedDeploymentResume(directory) {
  const test = fixture({
    governedDeployment: true,
    deploymentApprovalPending: true,
  });
  const args = options(directory, { deadlineMs: 500 });
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(test.counts().createCalls, 1);
  assert.equal(test.counts().callCalls, 2);
  const approved = evidence.operations["deploy-new-implementation"];
  assert.equal(approved.governanceApproval.approver.address, APPROVER);
  assert.equal(approved.governanceApproval.transactionHash, hash(199));
  assert.equal(approved.governanceApproval.call.contract.address, USER_CONTRACT);
  assert.equal(approved.governanceApproval.call.method, "createContract");
  assert.deepEqual(approved.governanceApproval.call.args.args, [JSON.stringify(EMPTY)]);
  assert.equal(
    evidence.operations["deploy-new-implementation"].governanceIssueId,
    LIVE_DEPLOYMENT_ISSUE
  );
  assert.equal(
    evidence.operations["deploy-new-implementation"].governanceIssueTarget,
    USER_CONTRACT
  );
  assert.deepEqual(
    evidence.operations["deploy-new-implementation"].governanceIssueArguments,
    ["YieldVault", SOURCE, [EMPTY]]
  );
  assert.equal(
    evidence.operations["deploy-new-implementation"].governanceExecution.transactionHash,
    hash(199)
  );
}

async function testGovernedDeploymentMismatches(directory) {
  for (const [name, fixtureOptions] of [
    ["target", { issueTarget: address(999) }],
    ["raw-source", { rawDeploymentSource: `${SOURCE} changed` }],
    ["event-source", { issueSource: `${SOURCE} changed` }],
    ["nested-args", { issueArgs: ["YieldVault", SOURCE, "deadbeef"] }],
  ]) {
    const test = fixture({
      governedDeployment: true,
      deploymentApprovalPending: true,
      ...fixtureOptions,
    });
    await assert.rejects(
      runSafeUpgrade(options(path.join(directory, name), { deadlineMs: 500 }), test.dependencies),
      name === "raw-source"
        ? /raw submission does not match deployment intent/
        : (error) => error instanceof WorkflowStop &&
          error.reason === "unknown_governance_creation"
    );
    assert.equal(test.counts().createCalls, 1);
    assert.equal(test.counts().callCalls, 0);
  }
}

async function testSignerRegistryRejections(directory) {
  const sameSigner = fixture({ authenticatedDeployer: OWNER });
  await assert.rejects(
    runSafeUpgrade(options(path.join(directory, "same")), sameSigner.dependencies),
    /distinct signer addresses/
  );
  assert.equal(sameSigner.counts().createCalls, 0);

  const missingDeployerAdmin = fixture({
    proxyOwner: REGISTRY,
    vaultOwner: REGISTRY,
    authenticatedOwner: OWNER,
    adminMembershipBySigner: { [OWNER]: "1", [DEPLOYER]: "0" },
  });
  await assert.rejects(
    runSafeUpgrade(options(path.join(directory, "membership"), {
      expectedOwner: REGISTRY,
    }), missingDeployerAdmin.dependencies),
    /DEPLOYER signer .* is not a live AdminRegistry admin/
  );
  assert.equal(missingDeployerAdmin.counts().createCalls, 0);
}

async function testTransportRecovery(directory) {
  const test = fixture({ transportCreateOnce: true });
  const args = options(directory);
  await assert.rejects(
    runSafeUpgrade(args, test.dependencies),
    (error) => error instanceof WorkflowStop &&
      error.reason === "ambiguous_dispatch_no_hash"
  );
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(test.counts().createCalls, 1);
}

async function testStaleExecutionRejected(directory) {
  const test = fixture({
    governance: true,
    governanceIssueResponse: true,
    staleExecutionOnly: true,
  });
  await assert.rejects(
    runSafeUpgrade(options(directory, { deadlineMs: 500 }), test.dependencies),
    (error) => error instanceof WorkflowStop &&
      error.reason === "pending_governance"
  );
  assert.equal(test.pointer(), OLD);
}

async function testExternalRollbackBeforeResume(directory) {
  let crash = true;
  const test = fixture({
    injectFault: async (point, details) => {
      if (point === "after_submitted" &&
          details.checkpoint === "upgrade-pointer" && crash) {
        throw new Error("CRASH_AFTER_POINTER_SUBMITTED");
      }
    },
  });
  const args = options(directory, { deadlineMs: 500 });
  await assert.rejects(runSafeUpgrade(args, test.dependencies), /CRASH_AFTER_POINTER_SUBMITTED/);
  test.setPointer(OLD);
  crash = false;
  await assert.rejects(
    runSafeUpgrade(args, test.dependencies),
    (error) => error instanceof WorkflowStop && error.reason === "timeout"
  );
  assert.equal(test.counts().callCalls, 1);
}

async function testGuardedRollback(directory) {
  const test = fixture({ pointer: NEW, callTarget: OLD, postAccrual: true });
  const args = options(directory, {
    rollback: true,
    expectedOldImplementation: undefined,
    implementationAddress: OLD,
    expectedCurrentImplementation: NEW,
    expectedReviewedSourceHash: undefined,
  });
  const evidence = await runSafeUpgrade(args, test.dependencies);
  assert.equal(test.counts().createCalls, 0);
  assert.equal(test.counts().callCalls, 1);
  assert.equal(test.counts().authCalls, 2);
  assert.deepEqual(Object.keys(evidence.signers), ["APPROVER", "OWNER"]);
  assert.equal(evidence.operations["rollback-pointer"].signer.role, "OWNER");
  assert.equal(evidence.rollback.guarded, true);
  assert.equal(evidence.rollback.deployedImplementation, false);
  assert.equal(evidence.upgrades[0].previousImplementation, NEW);
  assert.equal(evidence.upgrades[0].confirmedImplementation, OLD);
  assert.equal(evidence.rollback.comparison.comparedLegacyFieldsAndUnderlyingBalances, true);
  assert.equal(evidence.rollback.comparison.appendedPreRollbackValues.lastAccrual, "10");
}

async function testOldDeploymentEvidence(directory) {
  const test = fixture({
    pointer: EMPTY,
    callTarget: OLD,
    createdAddresses: [PROXY, OLD],
  });
  test.dependencies.captureVault = undefined;
  test.dependencies.rest.getState = async (_token, contract) => {
    if (contract.name === "Proxy") {
      return { logicContract: test.pointer(), _owner: OWNER };
    }
    if (contract.name === "YieldVault") {
      return {
        _owner: contract.address === PROXY ? OWNER : EMPTY,
        _asset: "0".repeat(40),
        _paused: false,
        vaultInitialized: false,
        _name: "",
        _symbol: "",
      };
    }
    throw new Error(`Unexpected getState ${contract.name}`);
  };
  const args = {
    expectedOwner: OWNER,
    expectedProxySourceHash: SOURCE_HASH,
    expectedOldSourceHash: SOURCE_HASH,
    runState: path.join(directory, "run-state.json"),
    evidenceOutput: path.join(directory, "evidence.json"),
    deadlineMs: 60_000,
  };
  const evidence = await runDeployOldProxy(args, test.dependencies);
  assert.equal(evidence.completed, true);
  assert.equal(evidence.proxy.receiptCreatedAddress, PROXY);
  assert.equal(evidence.implementation.receiptCreatedAddress, OLD);
  assert.equal(evidence.activation.confirmedImplementation, OLD);
  assert.equal(evidence.proxy.signer.role, "DEPLOYER");
  assert.equal(evidence.implementation.signer.role, "DEPLOYER");
  assert.equal(evidence.activation.signer.role, "OWNER");
  assert.equal(fs.statSync(args.runState).mode & 0o777, 0o600);
  assert.equal(fs.statSync(args.evidenceOutput).mode & 0o777, 0o600);
  const serialized = fs.readFileSync(args.evidenceOutput, "utf8");
  assert(!serialized.includes("SECRET_OWNER_TOKEN"));
  assert(!serialized.includes("SECRET_DEPLOYER_TOKEN"));
  assert(!serialized.includes(SOURCE));
  assert(serialized.includes(SOURCE_HASH));
  const repeated = await runDeployOldProxy(args, test.dependencies);
  assert.equal(repeated.completed, true);
  assert.deepEqual(test.counts(), {
    createCalls: 2,
    callCalls: 1,
    authCalls: 6,
  });
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-upgrade-safety-"));
  try {
    await testSourceMismatch(path.join(directory, "source"));
    await testWrongPreconditions(path.join(directory, "preconditions"));
    await testReadyCrash(path.join(directory, "ready"));
    await testDispatchingCrash(path.join(directory, "dispatching"));
    await testSubmittedCrash(path.join(directory, "submitted"));
    await testGovernanceResume(path.join(directory, "governance"));
    await testExternalGovernanceExecution(path.join(directory, "external-governance"));
    await testApprovalCrashRecovery(path.join(directory, "approval-recovery"));
    await testCreateContractApprovalCrashRecovery(
      path.join(directory, "create-approval-recovery")
    );
    await testWorkflowCodeMigrationAfterApproval(
      path.join(directory, "workflow-code-migration")
    );
    await testSuccessfulUpgrade(path.join(directory, "success"));
    await testGovernedStorageOwner(path.join(directory, "governed-owner"));
    await testGovernedDeploymentResume(path.join(directory, "governed-deployment"));
    await testGovernedDeploymentMismatches(path.join(directory, "governed-mismatches"));
    await testSignerRegistryRejections(path.join(directory, "signer-rejections"));
    await testTransportRecovery(path.join(directory, "transport-recovery"));
    await testStaleExecutionRejected(path.join(directory, "stale-execution"));
    await testExternalRollbackBeforeResume(path.join(directory, "external-rollback"));
    await testGuardedRollback(path.join(directory, "rollback"));
    await testOldDeploymentEvidence(path.join(directory, "old-evidence"));
    console.log(
      "UPGRADE_SAFETY_TEST_PASS sourceMismatch=1 wrongProxy=1 wrongImplementation=1 " +
      "wrongOwner=1 wrongPaused=1 readyCrash=1 dispatchingCrash=1 submittedCrash=1 " +
      "governanceResume=1 immediateGovernance=1 staleExecution=1 governedOwner=1 " +
      "externalGovernanceExecution=2 redundantApproval=1 " +
      "governedDeploymentResume=1 signerSeparation=1 registryCompleteness=1 " +
      "governedDeploymentMismatches=1 successfulUpgrade=1 transportRecovery=1 " +
      "approvalRecovery=5 externalRollback=1 postAccrualRollback=1 " +
      "completedOldFixtureReassertion=1 evidence=1 duplicateCalls=0 castVoteOnIssueCalls=0"
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
