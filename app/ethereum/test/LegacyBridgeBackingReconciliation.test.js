const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ethers } = require("ethers");
const { reconcileBacking } = require("../scripts/lib/legacyBridgeBacking");
const { collectBackingEvidence } = require("../scripts/lib/legacyBridgeBackingEvidence");
const { exitCodeFor, parseArgs, runReconciliation } = require("../scripts/reconcileLegacyBridgeBacking");

const BRIDGE = "0x1000000000000000000000000000000000000000";
const SAFE = "0x2000000000000000000000000000000000000000";
const ROUTER = "0x3000000000000000000000000000000000000000";
const TOKEN = "0x4000000000000000000000000000000000000000";
const STRATO_TOKEN = "0x5000000000000000000000000000000000000000";
const USER = "0x6000000000000000000000000000000000000000";
const DEPOSIT_TX = `0x${"a".repeat(64)}`;
const SAFE_TX = `0x${"b".repeat(64)}`;
const WITHDRAWAL_TX = `0x${"c".repeat(64)}`;

test("calculates exact all-chain backing and reports excess without losing the proposed amount", () => {
  const result = reconcileBacking({
    deposits: [
      { id: "d1", chainId: "1", externalToken: TOKEN, amount: "9007199254740993000000" },
      { id: "d2", chainId: "1", externalToken: TOKEN, amount: "1000000" },
      { id: "d3", chainId: "8453", externalToken: TOKEN, amount: "200" },
    ],
    withdrawals: [{ id: "w1", chainId: "1", externalToken: TOKEN, amount: "2000000" }],
    balances: [
      { chainId: "1", externalToken: TOKEN, mainSafe: "9007199254740992000000", hotSafe: "0", retained: "0" },
      { chainId: "8453", externalToken: TOKEN, mainSafe: "225", hotSafe: "0", retained: "5" },
    ],
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.routes.map(route => [route.chainId, route.proposedMigrationAmount]), [
    ["1", "9007199254740992000000"],
    ["8453", "200"],
  ]);
  assert.equal(result.routes[1].unexplainedDelta, "20");
});

test("fails on custody deficits, negative backing, missing balances and invalid decimal strings", () => {
  const result = reconcileBacking({
    deposits: [{ id: "d1", chainId: "1", externalToken: TOKEN, amount: "100" }],
    withdrawals: [{ id: "w1", chainId: "8453", externalToken: TOKEN, amount: "2" }],
    balances: [{ chainId: "1", externalToken: TOKEN, mainSafe: "90", hotSafe: "0", retained: "0" }],
  });
  assert.equal(result.status, "FAILED");
  assert.ok(result.violations.some(item => item.code === "CUSTODY_DEFICIT"));
  assert.ok(result.violations.some(item => item.code === "NEGATIVE_EXPECTED_BACKING"));
  assert.ok(result.violations.some(item => item.code === "CUSTODY_BALANCE_MISSING"));
  assert.throws(() => reconcileBacking({
    deposits: [{ id: "bad", chainId: "1", externalToken: TOKEN, amount: "1.5" }],
    withdrawals: [], balances: [],
  }), /unsigned decimal string/);
});

test("collects multi-deposit, action, withdrawal, Safe, custody and checkpoint evidence", async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "backing-evidence-"));
  await Promise.all([
    fs.writeFile(path.join(dataDirectory, "lastProcessedBlocks.json"), JSON.stringify({ "1": 100 })),
    fs.writeFile(path.join(dataDirectory, "depositDeadLetters.json"), "{}"),
    fs.writeFile(path.join(dataDirectory, "withdrawalProposals.json"), "{}"),
  ]);
  const input = {
    version: 1,
    stratoNodeUrl: "https://strato.example",
    mercataBridge: BRIDGE,
    stratoCutoffBlock: "500",
    dataDirectory,
    chains: {
      "1": {
        cutoffBlock: "100",
        confirmations: 10,
        safeTransactionServiceUrl: "https://safe.example",
      },
    },
  };
  const tables = {
    "BlockApps-MercataBridge-chains": [{
      key: "1",
      value: { custody: SAFE, hotWallet: ethers.ZeroAddress, depositRouter: ROUTER, lastProcessedBlock: "100", enabled: true },
    }],
    "BlockApps-MercataBridge-assets": [{
      key: TOKEN, key2: "1", value: { stratoToken: STRATO_TOKEN, externalDecimals: "6" },
    }],
    "BlockApps-MercataBridge-deposits": [{
      key: "1", key2: `${DEPOSIT_TX}#1`,
      value: { bridgeStatus: "3", externalToken: TOKEN, stratoRecipient: USER, stratoToken: STRATO_TOKEN },
    }, {
      key: "1", key2: `${DEPOSIT_TX}#2`,
      value: { bridgeStatus: "3", externalToken: TOKEN, stratoRecipient: USER, stratoToken: STRATO_TOKEN },
    }],
    "BlockApps-MercataBridge-withdrawals": [{
      key: "7",
      value: { bridgeStatus: "3", externalChainId: "1", externalToken: TOKEN,
        externalTokenAmount: "400", externalRecipient: USER, custodyTxHash: SAFE_TX, useHotWallet: false },
    }],
    "BlockApps-MercataBridge": [{ depositsPaused: true, withdrawalsPaused: true, withdrawalCounter: "7" }],
  };
  for (const rows of Object.values(tables)) {
    for (const row of rows) row.block_number = "500";
  }
  const depositEvents = new ethers.Interface([
    "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
    "event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)",
  ]);
  const transfers = new ethers.Interface([
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    "function balanceOf(address account) view returns (uint256)",
  ]);
  const eventLog = (address, encoded) => ({ address, topics: encoded.topics, data: encoded.data });
  const standard = depositEvents.encodeEventLog(depositEvents.getEvent("DepositRouted"),
    [TOKEN, 1000n, USER, USER, STRATO_TOKEN, 1n]);
  const action = depositEvents.encodeEventLog(depositEvents.getEvent("DepositRoutedWithAction"),
    [TOKEN, 500n, USER, USER, STRATO_TOKEN, 2n, 3, TOKEN, 450n]);
  const firstDepositTransfer = transfers.encodeEventLog(transfers.getEvent("Transfer"), [USER, SAFE, 1000n]);
  const secondDepositTransfer = transfers.encodeEventLog(transfers.getEvent("Transfer"), [USER, SAFE, 500n]);
  const withdrawalTransfer = transfers.encodeEventLog(transfers.getEvent("Transfer"), [SAFE, USER, 400n]);
  let depositLogs = [
    eventLog(TOKEN, firstDepositTransfer), eventLog(ROUTER, standard),
    eventLog(TOKEN, secondDepositTransfer), eventLog(ROUTER, action),
  ];
  let traces = [];
  let safeHistory = [];
  let safeNonce = 2;
  let safePage;
  let rpcChainId = "0x1";
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/metadata")) return new Response(JSON.stringify({ networkID: "114784819836269" }));
    if (value.includes("/block/last/1")) return new Response(JSON.stringify([{ blockData: { number: "500" } }]));
    if (value === "https://safe.example/api/v1/safes/0x2000000000000000000000000000000000000000/") {
      return new Response(JSON.stringify({ nonce: safeNonce }));
    }
    if (value.includes("/multisig-transactions/?")) {
      return new Response(JSON.stringify(safePage || { results: safeHistory, next: null }));
    }
    if (value.includes(`/multisig-transactions/${SAFE_TX}/`)) {
      return new Response(JSON.stringify({ isExecuted: true, isSuccessful: true, transactionHash: WITHDRAWAL_TX }));
    }
    const table = Object.keys(tables).find(name => value.includes(`/cirrus/search/${name}?`));
    assert.ok(table, `unexpected URL ${value}`);
    return new Response(JSON.stringify(Number(new URL(value).searchParams.get("offset")) === 0 ? tables[table] : []));
  };
  const provider = {
    getNetwork: async () => ({ chainId: 1n }),
    getBlockNumber: async () => 200,
    getTransactionReceipt: async hash => hash === DEPOSIT_TX
      ? { status: 1, blockNumber: 90, logs: depositLogs }
      : { status: 1, blockNumber: 95, logs: [eventLog(TOKEN, withdrawalTransfer)] },
    getBalance: async () => 1100n,
    send: async method => {
      if (method === "eth_chainId") return rpcChainId;
      if (method === "trace_transaction") return traces;
      assert.equal(method, "eth_call");
      return transfers.encodeFunctionResult("balanceOf", [1100n]);
    },
  };
  const evidence = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.equal(evidence.violations.length, 0);
  assert.deepEqual(evidence.deposits.map(item => item.amount), ["1000", "500"]);
  assert.deepEqual(evidence.withdrawals.map(item => item.amount), ["400"]);
  assert.equal(evidence.balances[0].mainSafe, "1100");

  tables["BlockApps-MercataBridge"][0].depositsPaused = "false";
  const active = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(active.violations.some(item => item.code === "LEGACY_BRIDGE_NOT_PAUSED"));
  tables["BlockApps-MercataBridge"][0].depositsPaused = true;

  safePage = {};
  const incompleteSafe = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(incompleteSafe.violations.some(item => item.code === "SAFE_QUEUE_UNAVAILABLE"));
  safePage = undefined;
  safeNonce = undefined;
  const missingSafeNonce = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(missingSafeNonce.violations.some(item => item.code === "SAFE_QUEUE_UNAVAILABLE"));
  safeNonce = 2;

  safeHistory = [{
    safeTxHash: `0x${"d".repeat(64)}`,
    nonce: 2,
    isExecuted: true,
    isSuccessful: null,
    origin: JSON.stringify({ bridge: BRIDGE, withdrawalId: "7" }),
  }];
  const unknownSafeOutcome = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(unknownSafeOutcome.violations.some(item => item.code === "SAFE_QUEUE_UNAVAILABLE"));
  safeHistory = [];

  rpcChainId = "0x2";
  await assert.rejects(collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider }), /wrong chain ID/);
  rpcChainId = "0x1";

  for (const [expected, code] of [
    ["1000", "WITHDRAWAL_PAYOUT_AMOUNT_MISMATCH"],
    ["300", "WITHDRAWAL_PAYOUT_AMOUNT_MISMATCH"],
    [undefined, "WITHDRAWAL_EXPECTED_AMOUNT_INVALID"],
  ]) {
    tables["BlockApps-MercataBridge-withdrawals"][0].value.externalTokenAmount = expected;
    const inaccurate = await collectBackingEvidence(input, {
      ACCESS_TOKEN: "test",
      CHAIN_1_RPC_URL: "https://rpc.example",
    }, { fetchImpl, providerFor: () => provider });
    assert.equal(inaccurate.withdrawals[0].observedAmount, "400");
    assert.equal(inaccurate.withdrawals[0].expectedAmount, expected || null);
    assert.ok(inaccurate.violations.some(item => item.code === code));
    assert.equal(reconcileBacking({
      deposits: inaccurate.deposits,
      withdrawals: inaccurate.withdrawals,
      balances: inaccurate.balances,
      violations: inaccurate.violations,
    }).status, "FAILED");
  }
  tables["BlockApps-MercataBridge-withdrawals"][0].value.externalTokenAmount = "100";
  tables["BlockApps-MercataBridge-withdrawals"][0].value.externalToken = ethers.ZeroAddress;
  traces = [
    { type: "call", traceAddress: [], action: { callType: "call", from: SAFE, to: USER, value: "0x64" } },
    { type: "call", traceAddress: [0], error: "Reverted", action: { callType: "call", from: SAFE, to: USER, value: "0x384" } },
    { type: "call", traceAddress: [1], error: "Reverted", action: { callType: "call", from: SAFE, to: ROUTER, value: "0x0" } },
    { type: "call", traceAddress: [1, 0], action: { callType: "call", from: SAFE, to: USER, value: "0x2bc" } },
    { type: "call", traceAddress: [2], action: { callType: "delegatecall", from: SAFE, to: USER, value: "0x64" } },
  ];
  const native = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.equal(native.withdrawals[0].observedAmount, "100");
  assert.ok(!native.violations.some(item => item.code === "WITHDRAWAL_PAYOUT_AMOUNT_MISMATCH"));
  tables["BlockApps-MercataBridge-withdrawals"][0].value.externalTokenAmount = "400";
  tables["BlockApps-MercataBridge-withdrawals"][0].value.externalToken = TOKEN;

  depositLogs = [
    eventLog(TOKEN, firstDepositTransfer), eventLog(ROUTER, standard),
    eventLog(ROUTER, action),
  ];
  const incomplete = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(incomplete.violations.some(item =>
    item.code === "DEPOSIT_EVIDENCE_INCOMPLETE"
      && item.detail.includes("no unconsumed custody movement")));

  safeHistory = ["d", "e"].map(character => ({
    safeTxHash: `0x${character.repeat(64)}`,
    nonce: 2,
    isExecuted: true,
    isSuccessful: true,
    origin: JSON.stringify({ bridge: BRIDGE, withdrawalId: "7" }),
  }));
  const duplicatePayout = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(duplicatePayout.violations.some(item => item.code === "DUPLICATE_EXECUTED_SAFE_PAYOUTS"));

  await fs.rm(path.join(dataDirectory, "withdrawalProposals.json"));
  const missingArchive = await collectBackingEvidence(input, {
    ACCESS_TOKEN: "test",
    CHAIN_1_RPC_URL: "https://rpc.example",
  }, { fetchImpl, providerFor: () => provider });
  assert.ok(missingArchive.violations.some(item =>
    item.code === "PERSISTENT_STATE_FILE_MISSING"
      && item.detail.includes("withdrawalProposals.json")));
});

test("requires reviewed inputs for every discovered legacy chain", async () => {
  const input = {
    version: 1, stratoNodeUrl: "https://strato.example", mercataBridge: BRIDGE,
    stratoCutoffBlock: "1", chains: {},
  };
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/metadata")) return new Response(JSON.stringify({ networkID: "1" }));
    if (value.includes("/block/last/1")) return new Response(JSON.stringify([{ blockData: { number: "1" } }]));
    const firstPage = Number(new URL(value).searchParams.get("offset")) === 0;
    const rows = firstPage && value.includes("BlockApps-MercataBridge-chains")
      ? [{ key: "1", value: { custody: SAFE, hotWallet: ethers.ZeroAddress,
        depositRouter: ROUTER, lastProcessedBlock: "1", enabled: true }, block_number: "1" }]
      : firstPage && value.includes("BlockApps-MercataBridge?")
        ? [{ depositsPaused: true, withdrawalsPaused: true, block_number: "1" }] : [];
    return new Response(JSON.stringify(rows));
  };
  await assert.rejects(() => collectBackingEvidence(input, { ACCESS_TOKEN: "test" }, { fetchImpl }),
    /exactly match MercataBridge chains/);
});

test("CLI is read-only and writes a stable credential-free report", async () => {
  assert.throws(() => parseArgs(["--execute"]), /read-only/);
  assert.throws(() => parseArgs(["--input", "input.json"]), /--output is required/);
  assert.deepEqual(["PASSED", "REVIEW_REQUIRED", "FAILED"].map(exitCodeFor), [0, 2, 1]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "backing-cli-"));
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "output.json");
  await fs.writeFile(inputPath, JSON.stringify({
    version: 1, stratoNodeUrl: "https://strato.example", mercataBridge: BRIDGE,
    stratoCutoffBlock: "100",
    chains: { "1": { cutoffBlock: "200", confirmations: 12, safeTransactionServiceUrl: "https://safe.example" } },
  }));
  const collectEvidence = async () => ({
    stratoNetworkId: "114784819836269", stratoObservedBlock: "100",
    chains: [{ chainId: "1", custody: SAFE, hotWallet: ethers.ZeroAddress,
      custodyAddresses: [SAFE], hotWalletAddresses: [], depositRouter: ROUTER,
      lastProcessedBlock: "200", enabled: true }],
    assets: [], deposits: [{ id: "d1", chainId: "1", externalToken: TOKEN, amount: "1000" }],
    withdrawals: [{ id: "w1", chainId: "1", externalToken: TOKEN, amount: "400" }],
    balances: [{ chainId: "1", externalToken: TOKEN, mainSafe: "600", hotSafe: "0", retained: "0" }],
    openDeposits: [], openWithdrawals: [], violations: [],
    sources: { deadLetterCount: 0, withdrawalJournalCount: 0 },
  });
  const report = await runReconciliation({ input: inputPath, output: outputPath }, {
    ACCESS_TOKEN: "secret-token", CHAIN_1_RPC_URL: "https://secret-rpc.example",
  }, { collectEvidence, now: () => new Date("2026-10-12T00:00:00.000Z") });
  const raw = await fs.readFile(outputPath, "utf8");
  assert.equal(report.status, "PASSED");
  assert.equal(report.routes[0].proposedMigrationAmount, "600");
  assert.equal(report.custodyBalanceEvidence[0].mainSafe, "600");
  assert.doesNotMatch(raw, /secret-token|secret-rpc/);
  await assert.rejects(() => runReconciliation({ input: inputPath, output: outputPath }, {}, { collectEvidence }),
    /already exists/);
});
