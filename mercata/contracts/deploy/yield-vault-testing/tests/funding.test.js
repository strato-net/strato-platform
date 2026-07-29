#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { rest } = require("blockapps-rest");
const auth = require("../../auth");

process.env.NODE_URL = process.env.NODE_URL || "http://localhost";
process.env.OAUTH_URL = process.env.OAUTH_URL || "http://localhost/oauth";
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test";
process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "test";
process.env.EXPECTED_NETWORK_ID = "114784819836269";
process.env.REQUIRE_TESTNET = "true";
delete process.env.DEPLOY_ENV_FILE;
delete process.env.EXPECTED_NETWORK_NAME;

const { atomicWriteJson, validateNetworkMetadata } = require("../scripts/runtime");
const {
  REVIEWED_FEE_POLICIES,
  parseFeePolicyEvidence,
  parseStoredAddress,
  reviewedPolicyForNetwork,
} = require("../scripts/fee-policy");
const actorGenerator = require("../scripts/generate-actors-json");
const {
  REQUIRED_ROLES,
  assertDirectMintAuthority,
  assertMintAuthority,
  assertFinalState,
  authenticateMinter,
  buildMintPlan,
  buildTargets,
  deriveFeePayment,
  loadActors,
  parseArgs,
  pollMintCompletion,
  fundingRunStatePath,
  FundingJournal,
  executeMint,
} = require("../scripts/fund-yield-vault-test-actors");
const { ADMIN_REGISTRY } = require("../scripts/common");

const U = 10n ** 18n;
const address = (value) => value.toString(16).padStart(40, "0");
const txHash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function actors(minterEqualsOwner = false) {
  const result = Object.fromEntries(
    REQUIRED_ROLES.map((role, index) => [role, address(index + 1)])
  );
  if (minterEqualsOwner) result.OWNER = result.MINTER;
  return result;
}

function validFeeRows() {
  const policy = REVIEWED_FEE_POLICIES["114784819836269"];
  return {
    storage: [{
      address: policy.stateAddress,
      key: "currentFeeContract",
      value: `address(${policy.feeContract})`,
    }],
    account: [{ address: policy.feeContract, codeHash: policy.codeHash }],
  };
}

function testTargetArithmetic() {
  const ten = buildTargets(actors(), 10);
  assert.equal(ten.underlyingByRole.ALICE, 2000n * U);
  assert.equal(ten.underlyingByRole.STRATEGY, 300n * U);
  assert.equal(ten.feeByRole.OWNER, 10n * U);
  assert.equal(ten.feeByRole.MINTER, 2n * U);

  const eleven = buildTargets(actors(), 11);
  assert.equal(eleven.feeByRole.OWNER, 11n * U);
  assert.equal(eleven.feeByRole.MINTER, 22n * U / 10n);

  const shared = buildTargets(actors(true), 10);
  assert.equal(shared.feeByRole.MINTER, 0n);
  assert.equal(shared.feeByAddress[actors(true).MINTER].amount, 10n * U);
}

function testAggregationAndOrdering() {
  const actorSet = actors();
  const asset = address(100);
  const feeToken = address(101);
  const distinct = buildMintPlan(asset, feeToken, actorSet, 10);
  assert.equal(distinct.expectedUnderlying, 5500n * U);
  assert.equal(distinct.plan[0].token, feeToken);
  assert.equal(distinct.plan[0].recipient, actorSet.MINTER);
  assert.equal(distinct.plan[0].amount, 2n * U);
  assert.equal(distinct.plan.length, 18);
  assert(distinct.plan.slice(0, 10).every((entry) => entry.token === feeToken));
  assert(distinct.plan.slice(10).every((entry) => entry.token === asset));

  const sameToken = buildMintPlan(feeToken, feeToken, actorSet, 10);
  assert.equal(sameToken.plan.length, 10);
  assert.equal(sameToken.plan[0].recipient, actorSet.MINTER);
  const alice = sameToken.plan.find((entry) => entry.recipient === actorSet.ALICE);
  assert.equal(alice.amount, 2002n * U);
  assert.deepEqual(alice.contributions.map((item) => item.kind), ["fee", "underlying"]);
}

function testFullMintRerunSemantics() {
  const actorSet = actors();
  const first = buildMintPlan(address(100), address(101), actorSet, 10).plan;
  const second = buildMintPlan(address(100), address(101), actorSet, 10).plan;
  assert.deepEqual(
    second.map((entry) => entry.amount),
    first.map((entry) => entry.amount)
  );
  assert.equal(first.find((entry) => entry.recipient === actorSet.ALICE && entry.token === address(100)).amount, 2000n * U);
}

function testDirectAuthority() {
  const minter = address(1);
  assert.equal(
    assertDirectMintAuthority({ address: address(90), owner: minter }, minter).mode,
    "direct-owner"
  );
  assert.throws(
    () => assertDirectMintAuthority({ address: address(90), owner: address(2) }, minter),
    /not direct mint authority/
  );
  const governed = assertMintAuthority(
    { address: address(91), owner: ADMIN_REGISTRY },
    minter,
    "2"
  );
  assert.equal(governed.mode, "admin-registry");
  assert.equal(governed.adminMapMembership, 2n);
  assert.throws(
    () => assertMintAuthority(
      { address: address(91), owner: ADMIN_REGISTRY },
      minter,
      "0"
    ),
    /not a live AdminRegistry admin/
  );
  assert.equal(
    fundingRunStatePath("/tmp/funding.json"),
    "/tmp/funding.json.run-state.json"
  );
}

function testFeePaymentAccounting() {
  const reviewedFee = 10n ** 16n;
  const grossMint = 2n * U;
  const before = 5n * U;
  const voucher = deriveFeePayment(before, before + grossMint, grossMint, reviewedFee);
  assert.equal(voucher.mode, "voucher");
  assert.equal(voucher.debit, 0n);

  const feeToken = deriveFeePayment(
    before,
    before + grossMint - reviewedFee,
    grossMint,
    reviewedFee
  );
  assert.equal(feeToken.mode, "fee-token");
  assert.equal(feeToken.debit, reviewedFee);

  const otherRecipient = deriveFeePayment(before, before - reviewedFee, 0n, reviewedFee);
  assert.equal(otherRecipient.mode, "fee-token");
  assert.equal(otherRecipient.debit, reviewedFee);
  assert.throws(
    () => deriveFeePayment(before, before - 1n, 0n, reviewedFee),
    /must be zero or reviewed fee/
  );

  const minter = address(1);
  const alice = address(2);
  const token = address(90);
  const plan = [
    { token, recipient: minter, amount: grossMint },
    { token, recipient: alice, amount: 2n * U },
  ];
  const initial = {
    balances: {
      [`${token}:${minter}`]: before,
      [`${token}:${alice}`]: 0n,
    },
    tokens: { [token]: { totalSupply: 100n * U } },
  };
  const final = {
    balances: {
      [`${token}:${minter}`]: before + grossMint - reviewedFee,
      [`${token}:${alice}`]: 2n * U,
    },
    tokens: { [token]: { totalSupply: 104n * U } },
  };
  const summary = assertFinalState(
    plan,
    initial,
    final,
    [token],
    minter,
    token,
    [voucher, otherRecipient]
  );
  assert.equal(summary.feePayments.totalFeeTokenDebit, reviewedFee);
  assert.equal(summary.feePayments.grossFeeTokenMintedToMinter, grossMint);
  assert.deepEqual(summary.feePayments.modes, { voucher: 1, "fee-token": 1 });
  const persistedInitial = JSON.parse(
    JSON.stringify(initial, (_key, value) => typeof value === "bigint" ? value.toString() : value)
  );
  assert.doesNotThrow(() => assertFinalState(
    plan,
    persistedInitial,
    final,
    [token],
    minter,
    token,
    [voucher, otherRecipient]
  ));
}

function testFeePolicyParsing() {
  const policy = reviewedPolicyForNetwork("114784819836269");
  const rows = validFeeRows();
  const evidence = parseFeePolicyEvidence(
    policy.networkID,
    rows.storage,
    rows.account,
    policy.feeToken
  );
  assert.equal(evidence.verifiedFeeWei, "10000000000000000");
  assert.equal(evidence.observed.feeContract, policy.feeContract);
  assert.equal(parseStoredAddress(`address(0x${policy.feeContract})`), policy.feeContract);

  assert.throws(() => reviewedPolicyForNetwork("unknown"), /No reviewed fee policy/);
  assert.throws(
    () => parseFeePolicyEvidence(
      policy.networkID,
      [{ ...rows.storage[0], value: `address(${address(77)})` }],
      rows.account,
      policy.feeToken
    ),
    /Active fee contract mismatch/
  );
  assert.throws(
    () => parseFeePolicyEvidence(
      policy.networkID,
      rows.storage,
      [{ ...rows.account[0], codeHash: "0".repeat(64) }],
      policy.feeToken
    ),
    /code hash mismatch/
  );
  assert.throws(
    () => parseFeePolicyEvidence(policy.networkID, rows.storage, rows.account, address(88)),
    /Fee token mismatch/
  );
}

function testNetworkValidation() {
  const expected = {
    networkID: "114784819836269",
    networkName: null,
    requireTestnet: true,
  };
  const network = validateNetworkMetadata({
    networkID: "114784819836269",
    networkName: "helium",
    chainId: "7",
    isSynced: true,
  }, expected);
  assert.equal(network.networkID, "114784819836269");
  assert.throws(
    () => validateNetworkMetadata({
      networkID: "114784819836269",
      networkName: "helium",
      isSynced: false,
    }, expected),
    /not synced/
  );
  assert.throws(
    () => validateNetworkMetadata({
      networkID: "114784819836269",
      networkName: "production",
      isSynced: true,
    }, expected),
    /Refusing testnet workflow/
  );
}

function testCanonicalCliAndActorGenerator() {
  const canonical = [
    "--asset", address(1),
    "--fee-token", address(2),
    "--runs", "10",
    "--actors", "actors.json",
    "--output", "manifest.json",
  ];
  assert.equal(parseArgs(canonical).runs, 10);
  assert.throws(
    () => parseArgs(canonical.map((value) => value === "10" ? "9" : value)),
    /safe integer >= 10/
  );
  assert.throws(
    () => parseArgs([
      "--asset", address(1),
      "--fee-token", address(2),
      "--runs", "10",
      "--actors", "actors.json",
      "--run-state", "state.json",
      "--output", "manifest.json",
    ]),
    /Unknown argument: --run-state/
  );
  actorGenerator.CORE_ROLES.forEach((role, index) => {
    process.env[`${role}_ADDRESS`] = address(index + 1);
  });
  const generated = actorGenerator.buildActors();
  assert.deepEqual(Object.keys(generated.actors), REQUIRED_ROLES);
  assert.equal(generated.actors.STRATEGY, process.env.STRATEGY_ADDRESS);
  assert.equal(generated.actors.STRATEGY_A, undefined);
}

function testAtomicSecretSafeWrite() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-funding-"));
  try {
    const output = path.join(directory, "manifest.json");
    atomicWriteJson(output, { amount: 1n });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), { amount: "1" });
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function testActorManifestSchema() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-actors-"));
  try {
    const file = path.join(directory, "actors.json");
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 2,
      expectedNetworkID: "114784819836269",
      actors: actors(),
    }));
    assert.equal(loadActors(file).expectedNetworkID, "114784819836269");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, actors: actors() }));
    assert.throws(() => loadActors(file), /schemaVersion must be 2/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2, actors: actors() }));
    assert.throws(() => loadActors(file), /expectedNetworkID/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function testMintPostStatePolling() {
  let reads = 0;
  const result = await pollMintCompletion(async () => ({
    complete: ++reads === 3,
    phase: "cirrus-post-state",
  }), { intervalMs: 1, timeoutMs: 100 });
  assert.equal(reads, 3);
  assert.equal(result.complete, true);
}

async function testGovernedFundingResume() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-governed-funding-"));
  const output = path.join(directory, "funding.json");
  const runState = fundingRunStatePath(output);
  const minter = address(1);
  const approver = address(4);
  const token = address(90);
  const feeToken = reviewedPolicyForNetwork("114784819836269").feeToken;
  const recipients = [address(2), address(3)];
  const balances = new Map([
    [`${feeToken}:${minter}`, 10n * U],
    [`${token}:${recipients[0]}`, 0n],
    [`${token}:${recipients[1]}`, 0n],
  ]);
  let supply = 100n * U;
  let primaryCallCount = 0;
  let approvalCallCount = 0;
  let crashAfterApprovalReady = true;
  const submissions = new Map();
  const rawTransactions = new Map();
  const executed = new Set();
  const originalCall = rest.call;
  const originalResults = rest.getBlocResults;
  const originalGet = axios.get;
  const policyRows = validFeeRows();
  const journal = new FundingJournal(runState, output, { test: "governed-resume" });
  journal.acquire();
  try {
    rest.call = async (tokenObj, call) => {
      const isApproval = tokenObj.token === "approver";
      if (isApproval) {
        approvalCallCount++;
        const submission = [...submissions.values()].find((candidate) =>
          candidate.target === call.contract.address &&
          candidate.recipient === call.args.to &&
          candidate.amount === BigInt(call.args.amount));
        if (!submission) throw new Error("Approval did not match a primary mint");
        const hashValue = txHash(`approval-${submission.issueId}`);
        submission.approvalHash = hashValue;
        rawTransactions.set(hashValue, {
          hash: hashValue,
          nonce: "11",
          from: approver,
          to: call.contract.address,
          cName: "Token",
          funcName: "mint",
          args: [call.args.to, call.args.amount],
        });
        return [{ hash: hashValue }];
      }
      primaryCallCount++;
      const hashValue = txHash(`submission-${primaryCallCount}`);
      const issueId = `issue-${primaryCallCount}`;
      const submission = {
        issueId,
        target: call.contract.address,
        recipient: call.args.to,
        amount: BigInt(call.args.amount),
      };
      submissions.set(hashValue, submission);
      rawTransactions.set(hashValue, {
        hash: hashValue,
        nonce: "7",
        from: minter,
        to: call.contract.address,
        cName: "Token",
        funcName: "mint",
        args: [call.args.to, call.args.amount],
      });
      return [{ hash: hashValue }];
    };
    rest.getBlocResults = async (_tokenObj, hashes) => [{
      hash: hashes[0],
      status: "Success",
      txResult: { transactionHash: hashes[0] },
    }];
    axios.get = async (url, options = {}) => {
      const params = options.params || {};
      if (url.includes("/storage")) return { data: policyRows.storage };
      if (url.endsWith("/account")) {
        if (params.address === policyRows.account[0].address) {
          return { data: policyRows.account };
        }
        return {
          data: [{
            address: params.address,
            nonce: params.address === approver ? "11" : "7",
          }],
        };
      }
      if (url.endsWith("/transaction")) {
        const row = rawTransactions.get(String(params.hash).replace(/^0x/, ""));
        return { data: row ? [row] : [] };
      }
      if (url.includes("BlockApps-Token-_balances")) {
        const tokenAddress = String(params.address).replace(/^eq\./, "");
        const recipient = String(params.key).replace(/^eq\./, "");
        const value = balances.get(`${tokenAddress}:${recipient}`) || 0n;
        return { data: [{ balance: value.toString() }] };
      }
      if (url.endsWith("/cirrus/search/event")) {
        const transactionHash = String(params.transaction_hash).replace(/^eq\./, "");
        const submission = [...submissions.values()].find((item) =>
          item.executionHash === transactionHash);
        return {
          data: submission ? [{
            address: submission.target,
            event_name: "Transfer",
            attributes: {
              from: address(0),
              to: submission.recipient,
              value: submission.amount.toString(),
            },
            transaction_hash: transactionHash,
          }] : [],
        };
      }
      if (url.includes("BlockApps-Token")) {
        return {
          data: [{
            _owner: ADMIN_REGISTRY,
            _name: "Test",
            _symbol: "T",
            customDecimals: 18,
            _totalSupply: supply.toString(),
          }],
        };
      }
      if (url.includes("IssueCreated")) {
        const submissionHash = String(params.transaction_hash).replace(/^eq\./, "");
        const submission = submissions.get(submissionHash);
        return {
          data: submission ? [{
            id: `${submission.issueId}-created`,
            event_index: "1",
            transaction_hash: submissionHash,
            block_number: "10",
            block_timestamp: "2026-07-28T18:00:00Z",
            attributes: {
              issueId: submission.issueId,
              target: submission.target,
              func: "mint",
              args: [submission.recipient, submission.amount.toString()],
            },
          }] : [],
        };
      }
      if (url.includes("IssueExecuted")) {
        const issueId = String(params.issueId).replace(/^eq\./, "");
        const submission = [...submissions.values()].find((item) => item.issueId === issueId);
        if (!submission || (!submission.approvalHash && !submission.externalExecutionHash)) {
          return { data: [] };
        }
        if (!executed.has(issueId)) {
          executed.add(issueId);
          balances.set(
            `${submission.target}:${submission.recipient}`,
            (balances.get(`${submission.target}:${submission.recipient}`) || 0n) +
              submission.amount
          );
          supply += submission.amount;
        }
        const executionHash = submission.externalExecutionHash || submission.approvalHash;
        submission.executionHash = executionHash;
        return {
          data: [{
            id: `${issueId}-executed`,
            event_index: "1",
            transaction_hash: executionHash,
            block_number: "11",
            block_timestamp: "2026-07-28T18:00:01Z",
            attributes: {
              issueId,
              target: submission.target,
              func: "mint",
              args: [submission.recipient, submission.amount.toString()],
            },
          }],
        };
      }
      throw new Error(`Unexpected governed funding URL ${url}`);
    };
    const context = {
      tokenObj: { token: "test" },
      network: {
        networkID: "114784819836269",
        feeToken,
      },
      minter,
      approver: {
        address: approver,
        username: "approver-test",
        token: { token: "approver" },
      },
      approverAuthority: {
        signer: approver,
        adminRegistry: ADMIN_REGISTRY,
        adminMapMembership: "3",
        verified: true,
      },
      journal,
      governed: true,
      deadlineMs: 1000,
      faultInjector: async (point) => {
        if (point === "after_approval_ready" && crashAfterApprovalReady) {
          throw new Error("CRASH_AFTER_APPROVAL_READY");
        }
      },
    };
    const first = {
      index: 1,
      token,
      recipient: recipients[0],
      amount: 5n * U,
      contributions: [],
    };
    await assert.rejects(() => executeMint(context, first), /CRASH_AFTER_APPROVAL_READY/);
    assert.equal(primaryCallCount, 1);
    assert.equal(approvalCallCount, 0);
    assert.equal(journal.state.checkpoints["mint-1"].governanceIssueId, "issue-1");
    crashAfterApprovalReady = false;
    const resumed = await executeMint({ ...context, deadlineMs: 1000 }, first);
    assert.equal(primaryCallCount, 1);
    assert.equal(approvalCallCount, 1);
    assert.equal(resumed.deltas.totalSupply, first.amount);
    assert.equal(resumed.governanceExecution.transactionHash, resumed.governanceApproval?.transactionHash);
    const second = {
      index: 2,
      token,
      recipient: recipients[1],
      amount: 7n * U,
      contributions: [],
    };
    await executeMint({ ...context, deadlineMs: 1000 }, second);
    assert.equal(primaryCallCount, 2);
    assert.equal(approvalCallCount, 2);
    const third = {
      index: 3,
      token,
      recipient: recipients[0],
      amount: 2n * U,
      contributions: [],
    };
    crashAfterApprovalReady = true;
    await assert.rejects(
      () => executeMint({ ...context, deadlineMs: 1000 }, third),
      /CRASH_AFTER_APPROVAL_READY/
    );
    const thirdSubmission = [...submissions.values()].find((item) => item.issueId === "issue-3");
    thirdSubmission.externalExecutionHash = txHash("external-issue-3");
    const lateApprovalHash = txHash("late-approval-issue-3");
    journal.transition("mint-3", "submitted", {
      governanceApproval: {
        ...journal.state.checkpoints["mint-3"].governanceApproval,
        status: "confirmed",
        transactionHash: lateApprovalHash,
      },
    });
    crashAfterApprovalReady = false;
    const externallyExecuted = await executeMint({ ...context, deadlineMs: 1000 }, third);
    assert.equal(primaryCallCount, 3);
    assert.equal(approvalCallCount, 2);
    assert.equal(externallyExecuted.deltas.totalSupply, third.amount);
    assert.equal(
      externallyExecuted.governanceExecution.transactionHash,
      thirdSubmission.externalExecutionHash
    );
    assert.equal(
      externallyExecuted.governanceApproval.status,
      "redundant_after_external_execution"
    );
    assert.equal(
      journal.state.checkpoints["mint-3"].governanceCleanupRecommendation
        .mayHaveReopenedDeterministicIssue,
      true
    );
    assert.equal(journal.state.checkpoints["mint-1"].status, "confirmed");
    assert.equal(journal.state.checkpoints["mint-2"].status, "confirmed");
    assert.equal(journal.state.checkpoints["mint-3"].status, "confirmed");
  } finally {
    rest.call = originalCall;
    rest.getBlocResults = originalResults;
    axios.get = originalGet;
    journal.release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function testMinterAuthenticationUsesLiveKey() {
  const expected = address(77);
  const originalToken = auth.getUserToken;
  const originalUserInfo = auth.getUserInfo;
  const originalGetKey = rest.getKey;
  const originalEnv = {
    username: process.env.MINTER_USERNAME,
    password: process.env.MINTER_PASSWORD,
    address: process.env.MINTER_ADDRESS,
  };
  process.env.MINTER_USERNAME = "minter";
  process.env.MINTER_PASSWORD = "password";
  process.env.MINTER_ADDRESS = expected;
  auth.getUserToken = async () => "token";
  auth.getUserInfo = async () => {
    throw new Error("deprecated getUserInfo must not be called");
  };
  rest.getKey = async () => expected;
  try {
    const authenticated = await authenticateMinter(expected);
    assert.equal(authenticated.address, expected);
    assert.deepEqual(authenticated.token, { token: "token" });
  } finally {
    auth.getUserToken = originalToken;
    auth.getUserInfo = originalUserInfo;
    rest.getKey = originalGetKey;
    for (const [name, value] of Object.entries({
      MINTER_USERNAME: originalEnv.username,
      MINTER_PASSWORD: originalEnv.password,
      MINTER_ADDRESS: originalEnv.address,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function testPendingRunStateApproverMigration() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yield-vault-funding-migration-"));
  const output = path.join(directory, "funding.json");
  const runState = fundingRunStatePath(output);
  const legacyConfiguration = {
    asset: address(90),
    feeToken: address(91),
    runs: 10,
    scriptHash: txHash(1),
  };
  const legacy = new FundingJournal(runState, output, legacyConfiguration);
  try {
    legacy.acquire();
    legacy.transition("mint-1", "submitted", {
      transactionHash: txHash(2),
      governanceIssueId: "pending-issue",
    });
    const previousHash = legacy.configurationHash;
    legacy.release();
    const migrated = new FundingJournal(runState, output, {
      ...legacyConfiguration,
      scriptHash: txHash(3),
      approver: address(4),
      approverAuthority: {
        signer: address(4),
        adminMapMembership: "3",
        verified: true,
      },
    });
    migrated.acquire();
    assert.equal(migrated.state.checkpoints["mint-1"].transactionHash, txHash(2));
    assert.equal(migrated.state.checkpoints["mint-1"].governanceIssueId, "pending-issue");
    assert.equal(
      migrated.state.configurationMigration.type,
      "automatic-governance-approver"
    );
    assert.equal(migrated.state.configurationMigration.previousConfigurationHash, previousHash);
    assert.notEqual(migrated.state.configurationHash, previousHash);
    migrated.release();
  } finally {
    legacy.release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  testTargetArithmetic();
  testAggregationAndOrdering();
  testFullMintRerunSemantics();
  testDirectAuthority();
  testFeePaymentAccounting();
  testFeePolicyParsing();
  testNetworkValidation();
  testCanonicalCliAndActorGenerator();
  testAtomicSecretSafeWrite();
  testActorManifestSchema();
  await testMintPostStatePolling();
  await testGovernedFundingResume();
  await testMinterAuthenticationUsesLiveKey();
  testPendingRunStateApproverMigration();
  console.log(
    "FUNDING_TEST_PASS arithmetic=8 aggregation=11 rerun=2 authority=2 " +
      "feeAccounting=10 feePolicy=8 network=3 canonical=6 atomic=2 actorSchema=3 " +
      "mintPolling=2 minterAuth=2 governedApproval=8 pendingMigration=5 duplicateCalls=0 " +
      "castVoteOnIssueCalls=0"
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
