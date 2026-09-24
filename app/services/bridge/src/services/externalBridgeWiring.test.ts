import assert from "node:assert/strict";
import test from "node:test";
import { RouteAction } from "@strato/shared-types";
import { readFileSync } from "node:fs";
import path from "node:path";

for (const name of [
  "ALCHEMY_API_KEY",
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_KMS_KEY_ID",
  "SAFE_PROPOSER_KMS_REGION",
  "RELAYER_BA_USERNAME",
  "RELAYER_BA_PASSWORD",
  "RELAYER_CLIENT_ID",
  "RELAYER_CLIENT_SECRET",
  "RELAYER_OPENID_DISCOVERY_URL",
  "SENDGRID_API_KEY",
  "STRATO_NODE_URL",
  "VAULT_PROXY_ADDRESS",
  "VOUCHER_CONTRACT_ADDRESS",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY = "SG.test.test";

const externalBridgeAddress = process.env.EXTERNAL_ASSET_BRIDGE_ADDRESS!;
const bridgeSource = readFileSync(path.resolve(__dirname, "../../../../contracts/concrete/Bridge/ExternalAssetBridge.sol"), "utf8");
const assertSettlementArguments = (input: any) => {
  const signature = bridgeSource.match(new RegExp(`function ${input.method}\\s*\\(([^)]*)\\)`));
  assert.ok(signature, `Missing contract method ${input.method}`);
  const names = signature[1].split(",").map((argument) => argument.trim().split(/\s+/).pop());
  assert.deepEqual(Object.keys(input.args).sort(), names.sort());
};

test("normalizes Cirrus asset and deposit identity filters for ETH and mixed-case ERC-20 addresses", async (t) => {
  const { cirrus } = await import("../utils/api");
  const service = await import("./cirrusService");
  const eth = "0".repeat(40), usdc = "a".repeat(40), target = "b".repeat(40);
  t.mock.method(cirrus, "get", async (table: string, { params }: any) => {
    if (table.endsWith("-routes")) {
      if (params.offset) return [];
      assert.equal(params.key, `in.(${eth},${usdc})`);
      assert.equal(params.key2, "eq.11155111");
      assert.equal(params["value->>depositsEnabled"], "eq.true");
      return [eth, usdc].map((token) => ({ key: token, key2: 11155111, key3: target,
        value: { externalToken: token, stratoToken: target, externalChainId: "11155111",
          depositsEnabled: true, externalDecimals: token === eth ? "18" : "6" } }));
    }
    assert.equal(params.key2, `eq.${target}`);
    return [{ status: "4", stratoToken: target, stratoTokenAmount: "100" }];
  });
  const assets = await service.getAssetInfo([`0x${eth}`, `0x${usdc.toUpperCase()}`], 11155111);
  assert.equal(assets.get(`${eth}:11155111:${target}`)?.externalDecimals, 18);
  assert.equal(assets.get(`${usdc}:11155111:${target}`)?.externalDecimals, 6);
  assert.equal(await service.getDepositStatusByIdentity(11155111, `0x${target.toUpperCase()}`, "4"), "4");
  assert.equal((await service.getDepositSettlementInfoByIdentity(11155111, `0x${target.toUpperCase()}`, "4"))?.stratoTokenAmount, "100");
});

test("AUTO_ROUTE retries missing Cirrus metadata then submits a named-enum route; slippage alone permits fallback", async (t) => {
  const api = await import("../utils/api");
  const { config } = await import("../config");
  const rpc = await import("./rpcService");
  const recovery = await import("./depositRecoveryService");
  const verification = await import("./verificationService");
  const attestation = await import("./settlementAttestationService");
  const voucher = await import("./voucherService");
  const strato = await import("../utils/stratoHelper");
  const { depositStateService: state } = await import("./depositStateService");
  const { blockTrackingService: blocks } = await import("./blockTrackingService");
  const logger = await import("../utils/logger");
  const { reconcileExternalDeposits } = await import("../polling/alchemyPolling");
  const oldAppUrl = config.api.appUrl;
  config.api.appUrl = "https://app.example";
  t.after(() => { config.api.appUrl = oldAppUrl; });
  const router = "a".repeat(40), target = "b".repeat(40), output = "c".repeat(40), token = "0".repeat(40);
  const deposit = { externalChainId: 11155111, depositRouter: `0x${router}`, depositId: "4",
    externalSender: `0x${output}`, externalToken: `0x${token}`, externalTokenAmount: "100",
    observedExternalTokenAmount: "100", externalTxHash: `0x${"d".repeat(64)}`,
    externalBlockHash: `0x${"e".repeat(64)}`, externalBlockNumber: 16,
    externalBlockTimestamp: Date.now(), externalLogIndex: 0, detectedAt: Date.now(),
    stratoRecipient: `0x${output}`, targetStratoToken: `0x${target}`,
    action: "4", actionToken: `0x${output}`, minFinalOut: "90" };
  let metadataAvailable = false, reviewedMetadataAvailable = true, quotedOut = "95";
  t.mock.method(api.cirrus, "get", async (table: string, { params }: any) => {
    if (params.offset) return [];
    if (table.endsWith("-chains")) return [{ key: 11155111, value: { enabled: true, depositRouter: router, vault: output, lastProcessedBlock: "15" } }];
    if (table.endsWith("-depositRouters")) return [];
    if (table.endsWith("-routeRebaseRequired")) return [];
    if (table.endsWith("-deposits")) return params.select === "value->>status" || reviewedMetadataAvailable
      ? [{ status: "2", stratoToken: target, stratoTokenAmount: "100" }] : [];
    assert.ok(table.endsWith("-routes"), table);
    assert.equal(params.key, `in.(${token})`);
    return metadataAvailable ? [{ key: token, key2: 11155111, key3: target,
      value: { depositsEnabled: true, externalToken: token, stratoToken: target, externalDecimals: "18" } }] : [];
  });
  const quotes = t.mock.method(api.app, "get", async (_path: string, { params }: any) => {
    assert.equal(params.amount, "100");
    assert.equal(params.tokenOut, deposit.actionToken);
    return { tokenIn: target, tokenOut: output, amountIn: "100", amountOut: quotedOut,
      steps: [{ action: RouteAction.FORGE, target: router, tokenIn: target, tokenOut: output,
        amountIn: "100", amountOut: quotedOut, minAmountOut: quotedOut,
        parameter1: "0", parameter2: "0", direction: false, factoryPoolIndex: "0" }] };
  });
  t.mock.method(recovery, "reconcileRecordedDepositReviews", async () => undefined);
  t.mock.method(rpc, "isChainConfigured", () => true);
  t.mock.method(rpc, "getCurrentBlockNumber", async () => 100);
  t.mock.method(rpc, "getChainLogs", async () => []);
  t.mock.method(verification, "verifyDetectedDepositsBatch", async () => new Map([[verification.depositIdentity(deposit), { state: "verified" as const }]]));
  t.mock.method(state, "listReviews", async () => []);
  t.mock.method(state, "list", async () => [{ deposit, status: "pending" as const }]);
  t.mock.method(state, "oldestPendingBlock", async () => 16);
  t.mock.method(state, "pruneSettled", async () => undefined);
  const settled = t.mock.method(state, "markSettled", async () => undefined);
  const failed = t.mock.method(state, "markSettlementFailed", async () => undefined);
  t.mock.method(blocks, "getEffectiveLastProcessedBlock", async () => 15);
  t.mock.method(logger, "logError", async () => undefined);
  t.mock.method(attestation, "attestDepositSettlement", async () => undefined);
  t.mock.method(voucher, "mintVouchersForDeposits", async () => undefined);
  const calls: any[] = [];
  t.mock.method(strato, "execute", async (input: any) => {
    assertSettlementArguments(input);
    calls.push(strato.buildFunctionTx(input).txs[0].payload);
    return { status: "Success", hash: "settlement" };
  });
  await reconcileExternalDeposits(11155111);
  assert.equal(quotes.mock.callCount(), 0);
  assert.equal(calls.length, 0);
  assert.equal(settled.mock.callCount(), 0);
  assert.equal(failed.mock.callCount(), 1);

  metadataAvailable = true;
  await reconcileExternalDeposits(11155111);
  assert.equal(calls[0].method, "settleDepositWithRoute");
  assert.equal(calls[0].args.steps[0].action, "FORGE");
  assert.equal(calls[0].args.steps[0].minAmountOut, "90");
  assert.equal("attestationProof" in calls[0].args, false);
  assert.equal(settled.mock.callCount(), 1);

  quotedOut = "80";
  await reconcileExternalDeposits(11155111);
  assert.equal(calls[1].method, "settleDeposit");
  assert.equal(calls[1].args.action, "4");
  assert.equal(calls[1].args.minFinalOut, "90");
  assert.equal(settled.mock.callCount(), 2);

  const { confirmReviewedDeposit } = await import("./bridgeService");
  t.mock.method(state, "getByIdentity", async () => ({ deposit, status: "review" as const }));
  quotedOut = "95";
  await confirmReviewedDeposit(11155111, deposit.depositRouter, "4");
  assert.equal(calls[2].method, "confirmReviewedDepositWithRoute");
  assert.equal(calls[2].args.steps[0].action, "FORGE");
  reviewedMetadataAvailable = false;
  await assert.rejects(confirmReviewedDeposit(11155111, deposit.depositRouter, "4"), /settlement data is unavailable/);
  assert.equal(calls.length, 3);
  reviewedMetadataAvailable = true;
  quotedOut = "80";
  await confirmReviewedDeposit(11155111, deposit.depositRouter, "4");
  assert.equal(calls[3].method, "confirmReviewedDeposit");
});

test("legacy withdrawal polling can be disabled without disabling EAB polling", async (t) => {
  const { config } = await import("../config");
  const cirrus = await import("./cirrusService");
  const polling = await import("../polling/stratoPolling");
  const original = config.bridge.withdrawalPollingEnabled;
  t.after(() => { config.bridge.withdrawalPollingEnabled = original; });
  config.bridge.withdrawalPollingEnabled = false;
  const legacyQueries = t.mock.method(cirrus, "getWithdrawalsByStatus", async () => []);
  const externalQueries = t.mock.method(cirrus, "getExternalWithdrawalsByStatus", async () => []);
  const timers = t.mock.method(globalThis, "setTimeout", (() => 0) as any);

  polling.startWithdrawalRequestPolling();
  polling.startWithdrawalTxPolling();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(legacyQueries.mock.callCount(), 0);
  assert.equal(timers.mock.callCount(), 0);

  polling.startExternalWithdrawalPolling();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(externalQueries.mock.callCount(), 3);
  assert.equal(timers.mock.callCount(), 1);
});

test.before(async () => {
  const vaultService = await import("./externalWithdrawalService");
  (vaultService as any).getWithdrawalCapacity = async () => ({ available: 1000000000000000000n, retryAfterSeconds: 0n });
});

test("atomically settles non-native deposits on ExternalAssetBridge", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const settlementAttestationService = await import(
    "./settlementAttestationService"
  );
  const operatorCalls: any[] = [];
  const relayerCalls: any[] = [];
  (settlementAttestationService as any).attestDepositSettlement =
    async () => undefined;
  (settlementAttestationService as any).attestWithdrawalRelease =
    async () => undefined;
  (stratoHelper as any).execute = async (input: any) => {
    operatorCalls.push(input);
    return { status: "Success", hash: "test" };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    assertSettlementArguments(input);
    relayerCalls.push(input);
    return { status: "Success", hash: "test" };
  };

  const { settleDeposit } = await import("./bridgeService");
  await settleDeposit({
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  });

  assert.equal(
    operatorCalls.some((call) => call.method === "settleDeposit"),
    false,
  );
  assert.deepEqual(relayerCalls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "settleDeposit",
    args: {
      externalChainId: 1,
      depositRouter: "router",
      depositId: "7",
      externalSender: "sender",
      externalToken: "external-token",
      externalTokenAmount: "100",
      externalTxHash: "transaction",
      stratoRecipient: "recipient",
      stratoToken: "strato-token",
      action: "0",
      actionToken: "0000000000000000000000000000000000000000",
      minFinalOut: "0",
    },
  });
});

test("execute resolves only when every posted transaction succeeds", async () => {
  const { postAndWaitForTx } = await import("../utils/stratoHelper");
  const mixedBatch = [
    { hash: "aa", status: "Success" },
    { hash: "bb", status: "Pending" },
  ];

  // Immediate resolve=true success on the first transaction alone must not
  // short-circuit; the second transaction is polled to completion.
  let polls = 0;
  const settled = await postAndWaitForTx(
    async () => mixedBatch,
    0,
    { post: async () => { polls++; return [
      { hash: "aa", status: "Success" },
      { hash: "bb", status: "Success" },
    ]; } } as any,
  );
  assert.deepEqual(settled, { status: "Success", hash: "aa" });
  assert.ok(polls >= 1, "second transaction must be polled to completion");

  // A wait that runs out with a Pending transaction is an error, not a result.
  await assert.rejects(
    postAndWaitForTx(async () => mixedBatch, 0, { post: async () => mixedBatch } as any),
    /bb did not succeed within 0ms \(status Pending\)/,
  );

  // A failure anywhere in the immediate batch rejects with its message.
  await assert.rejects(
    postAndWaitForTx(
      async () => [
        { hash: "aa", status: "Success" },
        { hash: "bb", status: "Failure", error: "EAB: mint failed" },
      ],
      0,
      { post: async () => assert.fail("must not poll a failed batch") } as any,
    ),
    /EAB: mint failed/,
  );

  // An all-success immediate result resolves without polling.
  const immediate = await postAndWaitForTx(
    async () => [
      { hash: "aa", status: "Success" },
      { hash: "bb", status: "Success" },
    ],
    0,
    { post: async () => assert.fail("must not poll a settled batch") } as any,
  );
  assert.deepEqual(immediate, { status: "Success", hash: "aa" });
});

test("treats a duplicate identity as settled only when Cirrus confirms completion", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const { cirrus } = await import("../utils/api");
  (stratoHelper as any).execute = async () => {
    throw new Error("EAB: duplicate deposit");
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  const deposit = {
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  };
  const { settleDeposit } = await import("./bridgeService");

  (cirrus as any).get = async () => [{ status: "2" }];
  await assert.rejects(() => settleDeposit(deposit), /not completed/);

  (cirrus as any).get = async () => [{ status: "4" }];
  assert.equal(await settleDeposit(deposit), null);
});

test("confirms reviewed deposits through the bridge operator", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const { cirrus } = await import("../utils/api");
  const cirrusService = await import("./cirrusService");
  const rpcService = await import("./rpcService");
  const verificationService = await import("./verificationService");
  const { depositStateService } = await import("./depositStateService");
  const recovery = await import("./depositRecoveryService");
  const originalRecover = recovery.recoverReviewedDeposit;
  const originalGetEnabledChains = cirrusService.getEnabledChains;
  const originalGetCurrentBlockNumber = rpcService.getCurrentBlockNumber;
  const originalVerifyDetectedDepositsBatch =
    verificationService.verifyDetectedDepositsBatch;
  const originalGetByIdentity = depositStateService.getByIdentity;
  const calls: any[] = [];
  const deposit = {
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  };
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "confirm-hash" };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  (depositStateService as any).getByIdentity = async () => ({
    deposit,
    status: "review",
  });
  (cirrus as any).get = async () => [{ status: "2" }];
  (cirrusService as any).getEnabledChains = async () =>
    new Map([[1, { externalChainId: 1, vault: "vault" }]]);
  (rpcService as any).getCurrentBlockNumber = async () => 20;
  (verificationService as any).verifyDetectedDepositsBatch = async () =>
    new Map([[verificationService.depositIdentity(deposit), { state: "invalid", error: new Error("custody missing") }]]);

  const { confirmReviewedDeposit } = await import("./bridgeService");
  await assert.rejects(
    () => confirmReviewedDeposit(1, "router", "7"),
    /custody missing/,
  );
  assert.equal(calls.length, 0);

  (verificationService as any).verifyDetectedDepositsBatch = async () =>
    new Map([[verificationService.depositIdentity(deposit), { state: "verified" }]]);
  const hash = await confirmReviewedDeposit(1, "router", "7");

  assert.equal(hash, "confirm-hash");
  assert.deepEqual(calls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "confirmReviewedDeposit",
    args: {
      externalChainId: 1,
      depositRouter: "router",
      depositId: "7",
    },
  });
  let recovered = false;
  (depositStateService as any).getByIdentity = async () => undefined;
  (recovery as any).recoverReviewedDeposit = async (chainId: number, router: string, id: string) => {
    assert.deepEqual([chainId, router, id], [1, "router", "7"]);
    recovered = true;
    return { deposit, status: "review", reviewRecordedOnchain: true };
  };
  assert.equal(await confirmReviewedDeposit(1, "router", "7"), "confirm-hash");
  assert.equal(recovered, true);
  (recovery as any).recoverReviewedDeposit = originalRecover;
  (cirrusService as any).getEnabledChains = originalGetEnabledChains;
  (rpcService as any).getCurrentBlockNumber = originalGetCurrentBlockNumber;
  (verificationService as any).verifyDetectedDepositsBatch =
    originalVerifyDetectedDepositsBatch;
  (depositStateService as any).getByIdentity = originalGetByIdentity;
});

test("isolates a failed settlement from later deposits", async () => {
  const { attemptDepositSettlement } = await import("../polling/alchemyPolling");
  const deposit = {} as any;
  const first = await attemptDepositSettlement(deposit, async () => {
    throw new Error("route disabled");
  });
  let submitted = false;
  const second = await attemptDepositSettlement(deposit, async () => {
    submitted = true;
    return null;
  });

  assert.match(first?.message || "", /route disabled/);
  assert.equal(second, null);
  assert.equal(submitted, true);
});

test("reads pending deposits and vault custody from ExternalAssetBridge", async () => {
  const { cirrus } = await import("../utils/api");
  const requestedUrls: string[] = [];
  let externalDecimals = 18;
  (cirrus as any).get = async (url: string, { params }: any) => {
    requestedUrls.push(url);
    if (params.offset) return [];
    if (url.includes("-deposits")) {
      return [{
        key: "1",
        key2: "router",
        key3: "7",
        value: {
          status: 1,
          externalTxHash: "transaction",
          externalToken: "external-token",
          stratoToken: "strato-token",
          stratoRecipient: "recipient",
        },
      }];
    }
    if (url.includes("-routes")) {
      return [{
        key: "external-token",
        key2: "1",
        key3: "strato-token",
        value: {
          depositsEnabled: true,
          externalDecimals,
          externalToken: "external-token",
          stratoToken: "strato-token",
        },
      }];
    }
    if (url.includes("-chains")) {
      return [{
        key: "1",
        value: {
          chainName: "Ethereum",
          depositRouter: "router",
          enabled: true,
          lastProcessedBlock: 10,
          vault: "vault",
        },
      }];
    }
    return [];
  };

  const { getDepositsByStatus } = await import("./cirrusService");
  const deposits = await getDepositsByStatus("1");

  assert.equal(deposits[0].custodyAddress, "vault");
  assert.equal(deposits[0].bridgeStatus, 1);
  assert.equal(deposits[0].depositRouter, "router");
  assert.equal(deposits[0].depositId, "7");
  assert.ok(
    requestedUrls.every((url) => url.includes("BlockApps-ExternalAssetBridge")),
  );
  externalDecimals = 0;
  assert.equal((await getDepositsByStatus("1"))[0].externalDecimals, 0);
});

// Runs before any test that replaces getConfirmedRotationState on the module,
// so it exercises the real pinned-block reads against a mocked provider.
test("confirmed rotation state reads reservation and version at one pinned block", async () => {
  const { JsonRpcProvider, Interface } = await import("ethers");
  const vaultService = await import("./externalWithdrawalService");
  process.env.CHAIN_1_RPC_URL = "https://rpc.invalid";
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "5";
  const iface = new Interface([
    "function signerSetVersion() view returns (uint256)",
    "function reservations(bytes32) view returns (uint8,address,address,uint256,uint256,bytes32)",
  ]);
  const blockTags: any[] = [];
  const originalCall = (JsonRpcProvider.prototype as any).call;
  const originalGetBlockNumber = (JsonRpcProvider.prototype as any).getBlockNumber;
  (JsonRpcProvider.prototype as any).getBlockNumber = async () => 120;
  (JsonRpcProvider.prototype as any).call = async (tx: any) => {
    blockTags.push(tx.blockTag);
    const call = iface.parseTransaction(tx)!;
    if (call.name === "signerSetVersion") {
      return iface.encodeFunctionResult(call.name, [2]);
    }
    return iface.encodeFunctionResult(call.name, [
      1,
      `0x${"3".repeat(40)}`,
      `0x${"4".repeat(40)}`,
      100,
      2800,
      `0x${"5".repeat(64)}`,
    ]);
  };

  try {
    const state = await vaultService.getConfirmedRotationState({
      sourceChainId: "9001",
      sourceBridge: `0x${"1".repeat(40)}`,
      sourceWithdrawalId: "7",
      destinationChainId: "1",
      destinationVault: `0x${"2".repeat(40)}`,
      token: `0x${"3".repeat(40)}`,
      recipient: `0x${"4".repeat(40)}`,
      amount: "100",
      notBefore: "1000",
      deadline: "2800",
      signerSetVersion: "1",
    } as any);
    assert.equal(state.signerSetVersion, 2n);
    assert.equal(state.reserved, true);
    // Both reads must be pinned to the same confirmed block: latest minus
    // the chain's confirmation policy.
    assert.deepEqual(blockTags, [115, 115]);
  } finally {
    (JsonRpcProvider.prototype as any).call = originalCall;
    (JsonRpcProvider.prototype as any).getBlockNumber = originalGetBlockNumber;
  }
});

// Runs before any test that replaces checkWithdrawalPolicy on the module, so
// it exercises the real fan-out against a mocked HTTP boundary.
test("pre-flight requires every verifier and surfaces dissent as manual review", async () => {
  const axios = (await import("axios")).default;
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS =
    "https://check-one,https://check-two,https://check-three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS =
    "token-one,token-two,token-three";
  const authorization = {
    destinationChainId: "1",
    sourceWithdrawalId: "7",
  } as any;
  let behavior: Record<string, string> = {};
  const originalPost = axios.post;
  (axios as any).post = async (url: string, _payload: unknown, options: any) => {
    assert.match(url, /\/v1\/check-withdrawal$/);
    assert.match(options.headers.Authorization, /^Bearer token-/);
    const verifier = url.includes("one") ? "one" : url.includes("two") ? "two" : "three";
    if (behavior[verifier] === "manual_review") {
      throw {
        isAxiosError: true,
        response: { status: 409, data: { decision: "manual_review" } },
      };
    }
    if (behavior[verifier] === "down") {
      throw new Error("connect ECONNREFUSED");
    }
    return { data: { decision: "approve" } };
  };

  try {
    const { checkWithdrawalPolicy, WithdrawalManualReviewError } = await import(
      "./externalWithdrawalService"
    );

    // Unanimous approval clears the pre-flight.
    behavior = { one: "approve", two: "approve", three: "approve" };
    await checkWithdrawalPolicy(authorization);

    // A single dissent demands manual review even with two approvals.
    behavior = { one: "approve", two: "approve", three: "manual_review" };
    await assert.rejects(
      checkWithdrawalPolicy(authorization),
      WithdrawalManualReviewError,
    );

    // One unreachable verifier blocks the clock from starting; the failure
    // is NOT treated as manual review, so the withdrawal stays INITIATED
    // and is retried on the next poll.
    behavior = { one: "approve", two: "approve", three: "down" };
    const unreachable = await checkWithdrawalPolicy(authorization).then(
      () => undefined,
      (error) => error,
    );
    assert.match(unreachable.message, /ECONNREFUSED/);
    assert.ok(!(unreachable instanceof WithdrawalManualReviewError));

    // Dissent takes precedence over another verifier's outage.
    behavior = { one: "down", two: "approve", three: "manual_review" };
    await assert.rejects(
      checkWithdrawalPolicy(authorization),
      WithdrawalManualReviewError,
    );
  } finally {
    axios.post = originalPost;
  }
});

test("reserves and releases before finalizing a routine withdrawal", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (api.eth as any).get = async () => ({ networkID: "9001" });
  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    if (input.method === "finalizeWithdrawal") assertSettlementArguments(input);
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).buildWithdrawalAuthorization = async () => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "7",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "100",
    notBefore: "1000",
    deadline: "2800",
    signerSetVersion: "1",
  });
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 1000n,
    signerSetVersion: 1n, // matches the authorization: no refresh expected
  });
  (vaultService as any).checkWithdrawalPolicy = async () => {
    trace.push("verifier:check");
  };
  (vaultService as any).reserveWithdrawal = async () => {
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "1",
    custodyTxHash: "",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
  });

  assert.deepEqual(trace, [
    "verifier:check",
    "operator:markWithdrawalReady",
    "vault:reserve",
    "operator:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
  ]);
});

test("records a verifier-demanded review instead of starting the authorization clock", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (api.eth as any).get = async () => ({ networkID: "9001" });
  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).checkWithdrawalPolicy = async () => {
    throw new vaultService.WithdrawalManualReviewError(
      "Local verifier manual review required for withdrawal 9",
    );
  };
  (vaultService as any).buildWithdrawalReview = () => ({ review: true });
  (vaultService as any).proposeWithdrawalReview = async () => ({
    reviewDigest: "0xcccc",
    approvalDeadline: "9000",
    proposalHash: "0xdddd",
  });
  (vaultService as any).reserveWithdrawal = async () => {
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "1",
    custodyTxHash: "",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "9",
    vault: "vault",
  });

  // The review is recorded while the withdrawal is still INITIATED; the
  // authorization clock (markWithdrawalReady) must not start.
  assert.deepEqual(trace, ["operator:recordWithdrawalReview"]);
});

test("cancels an expired reservation before allowing governance refund", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 1,
    latestTimestamp: 3000n,
    reservationTxHash: "reserve-hash",
  });
  (vaultService as any).cancelExpiredWithdrawal = async () => {
    trace.push("vault:cancel");
    return "cancel-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  });

  assert.deepEqual(trace, [
    "strato:recordWithdrawalReservation",
    "vault:cancel",
    "strato:recordWithdrawalCancellation",
  ]);
});

test("does not re-record a cancellation on later polls", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  (vaultService as any).getReservationId = () => "reservation";
  (vaultService as any).getReservationState = async () => {
    trace.push("vault:getReservationState");
    return {
      reservationId: "reservation",
      status: 3,
      latestTimestamp: 3000n,
      reservationTxHash: "reserve-hash",
    };
  };
  (vaultService as any).cancelExpiredWithdrawal = async () => {
    trace.push("vault:cancel");
    return "cancel-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
    reservationId: "reservation",
    cancellationTxHash: "cancel-hash",
  });

  // The vault is still consulted (an already-cancelled reservation only has
  // its hash read back), but the one-shot STRATO record is not re-submitted.
  assert.deepEqual(trace, ["vault:getReservationState", "vault:cancel"]);
});

test("cancels an expired reserved vault reservation despite stale cancellation metadata", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  (vaultService as any).getReservationId = () => "reservation";
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 1, // vault still RESERVED even though STRATO carries a hash
    latestTimestamp: 3000n,
  });
  (vaultService as any).cancelExpiredWithdrawal = async () => {
    trace.push("vault:cancel");
    return "fresh-cancel-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
    reservationId: "reservation",
    cancellationTxHash: "stale-cancel-hash",
  });

  // The expired reservation must be cancelled on the vault regardless of the
  // recorded metadata — refund verifiers reject RESERVED withdrawals — while
  // the one-shot STRATO record is left untouched.
  assert.deepEqual(trace, ["vault:cancel"]);
});

test("recovers a vault release despite stale cancellation metadata", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).getReservationId = () => "reservation";
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 2, // vault actually released, whatever the STRATO metadata says
    latestTimestamp: 3000n,
  });
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
    reservationId: "reservation",
    cancellationTxHash: "cancel-hash",
  });

  // Incorrect or stale cancellation metadata must not block finalization of
  // an actual release; the vault state is authoritative.
  assert.deepEqual(trace, ["vault:release", "relayer:finalizeWithdrawal"]);
});

test("recovers a READY withdrawal through the original authorization after a sign-time review demand", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];
  let phase = "transient";
  let latestTimestamp = 2000n;
  let signedAuthorization: any;

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).checkWithdrawalPolicy = async () => {
    trace.push("verifier:check");
  };
  // Mirrors the real stored-authorization path: a READY withdrawal reuses the
  // window committed by markWithdrawalReady instead of minting a fresh one.
  (vaultService as any).buildWithdrawalAuthorization = async (w: any) => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: w.withdrawalId,
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: w.externalTokenAmount,
    notBefore: w.authorizationNotBefore,
    deadline: w.authorizationDeadline,
    signerSetVersion: w.signerSetVersion,
  });
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp,
  });
  (vaultService as any).reserveWithdrawal = async (authorization: any) => {
    if (phase === "transient") {
      throw new Error("verifier request timed out");
    }
    if (phase === "dissent") {
      // The real signWithdrawalAuthorization proposes the Safe review and
      // throws this error on a 409 manual_review (covered directly in
      // verifierPolicy.test.ts); here we assert how the poll handles it.
      throw new Error(
        "Withdrawal 12 requires an executed Safe approval before signatures are released",
      );
    }
    signedAuthorization = authorization;
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  const withdrawal = {
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "12",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  };

  // Poll 1: signing fails transiently. The withdrawal stays READY and
  // untouched on STRATO.
  await assert.rejects(processExternalWithdrawal(withdrawal), /timed out/);
  assert.deepEqual(trace, []);

  // Poll 2: a verifier's policy tightened after authorization; signing now
  // demands review. The poll surfaces the error without writing to STRATO —
  // a READY withdrawal cannot re-enter review, so the clock keeps running.
  phase = "dissent";
  await assert.rejects(processExternalWithdrawal(withdrawal), /Safe approval/);
  assert.deepEqual(trace, []);

  // Poll 3: the Safe approval executed within the window. Completion reuses
  // the ORIGINAL committed authorization (the pre-check and
  // markWithdrawalReady must not run again).
  phase = "approved";
  await processExternalWithdrawal(withdrawal);
  assert.deepEqual(trace, [
    "vault:reserve",
    "operator:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
  ]);
  assert.equal(signedAuthorization.notBefore, "1000");
  assert.equal(signedAuthorization.deadline, "2800");
  assert.equal(signedAuthorization.signerSetVersion, "1");

  // Alternative ending: no timely approval. The expired, unreserved
  // withdrawal is left alone — nothing to cancel — and waits for the
  // attested governance refund.
  trace.length = 0;
  latestTimestamp = 3000n;
  await processExternalWithdrawal(withdrawal);
  assert.deepEqual(trace, []);
});

test("refreshes a rotated signer set before reserving a READY withdrawal", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];
  const operatorCalls: any[] = [];
  let signedAuthorization: any;

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    operatorCalls.push(input);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).buildWithdrawalAuthorization = async (w: any) => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: w.withdrawalId,
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: w.externalTokenAmount,
    notBefore: w.authorizationNotBefore,
    deadline: w.authorizationDeadline,
    signerSetVersion: w.signerSetVersion,
  });
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 2000n,
    signerSetVersion: 3n, // latest head: a second, not-yet-confirmed rotation
  });
  (vaultService as any).getConfirmedRotationState = async () => ({
    signerSetVersion: 2n, // only version 2 is confirmed
    reserved: false, // rotation and non-reservation confirmed on one block
  });
  (vaultService as any).reserveWithdrawal = async (authorization: any) => {
    signedAuthorization = authorization;
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "13",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  });

  // The stale committed version is moved forward on STRATO before signing,
  // and the withdrawal completes with the current signer set — same window.
  // The CONFIRMED version (2) is committed, never the latest-head one (3):
  // the contract only moves forward, so an unconfirmed rotation that
  // reorganizes away could not be downgraded and would strand the withdrawal.
  assert.deepEqual(trace, [
    "operator:refreshWithdrawalSignerSet",
    "vault:reserve",
    "operator:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
  ]);
  assert.deepEqual(operatorCalls[0].args, {
    withdrawalId: "13",
    signerSetVersion: "2",
  });
  assert.equal(signedAuthorization.signerSetVersion, "2");
  assert.equal(signedAuthorization.notBefore, "1000");
  assert.equal(signedAuthorization.deadline, "2800");
});

test("mixed-head reads never refresh over an externally reserved authorization", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];
  let confirmed = { signerSetVersion: 1n, reserved: true };

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  // Latest-head reads mix blocks: the reservation read misses a mined
  // version-1 reservation while the version read already sees the rotation.
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 2000n,
    signerSetVersion: 2n,
  });
  (vaultService as any).getConfirmedRotationState = async () => confirmed;
  (vaultService as any).reserveWithdrawal = async () => {
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  const withdrawal = {
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "14",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  };

  // The confirmed block shows a version-1 reservation: the committed
  // authorization must be preserved so release/refund verifiers can match
  // its digest; the reservation is recovered normally on a later poll.
  await processExternalWithdrawal(withdrawal);
  assert.deepEqual(trace, []);

  // The confirmed block shows no rotation yet: defer rather than trust the
  // mixed latest-head version read.
  confirmed = { signerSetVersion: 1n, reserved: false };
  await processExternalWithdrawal(withdrawal);
  assert.deepEqual(trace, []);

  // The rotation IS confirmed, but so is a reservation: the reservation
  // guard alone must defer the refresh — the reservation binds the original
  // version-1 authorization digest even though version 2 is now current.
  confirmed = { signerSetVersion: 2n, reserved: true };
  await processExternalWithdrawal(withdrawal);
  assert.deepEqual(trace, []);
});


test("leaves an expired unreserved withdrawal for governance refund", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 3000n,
  });

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  });

  assert.deepEqual(trace, []);
});

test("queues large withdrawals for Safe review", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];

  (api.eth as any).get = async () => ({ networkID: "9001" });
  (vaultService as any).buildWithdrawalReview = () => ({ review: true });
  (vaultService as any).proposeWithdrawalReview = async () => ({
    reviewDigest: "0xaaaa",
    approvalDeadline: "9000",
    proposalHash: "0xbbbb",
  });
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "record-review-hash" };
  };

  const { queueExternalWithdrawalReview } = await import("./bridgeService");
  await queueExternalWithdrawalReview({
    bridgeStatus: "1",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
  });

  assert.equal(calls[0].method, "recordWithdrawalReview");
  assert.deepEqual(calls[0].args, {
    withdrawalId: "8",
    reviewDigest: "0xaaaa",
    approvalDeadline: "9000",
    proposalHash: "0xbbbb",
  });
});

test("releases a large withdrawal only after Safe approval", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (nativeMintService as any).getNativeMintProposalExecution = async () => ({
    status: "executed",
    txHash: "approval-hash",
  });
  (vaultService as any).getExternalChainLatestTimestamp = async () => 1000n;
  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).buildWithdrawalAuthorization = async () => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "8",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "501",
    notBefore: "1000",
    deadline: "2800",
    signerSetVersion: "1",
  });
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 1000n,
  });
  (vaultService as any).reserveWithdrawal = async () => {
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.deepEqual(trace, [
    "strato:markWithdrawalReady",
    "vault:reserve",
    "strato:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
  ]);
});

test("refunds escrow when Safe rejects a large withdrawal", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];

  (nativeMintService as any).getNativeMintProposalExecution = async () => ({
    status: "rejected",
  });
  (vaultService as any).getExternalChainLatestTimestamp = async () => 1000n;
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "rejection-hash" };
  };

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.equal(calls[0].method, "rejectWithdrawalReview");
  assert.deepEqual(calls[0].args, { withdrawalId: "8" });
});

test("expires stale Safe reviews before release authorization", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];
  let checkedSafe = false;

  (vaultService as any).getExternalChainLatestTimestamp = async () => 9001n;
  (nativeMintService as any).getNativeMintProposalExecution = async () => {
    checkedSafe = true;
    return { status: "executed" };
  };
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "expiry-hash" };
  };

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.equal(checkedSafe, false);
  assert.equal(calls[0].method, "expireWithdrawalReview");
});

test("restores ready withdrawal authorization state from Cirrus", async () => {
  const { cirrus } = await import("../utils/api");
  (cirrus as any).get = async (url: string, { params }: any) => {
    if (params.offset) return [];
    if (url.includes("-withdrawals")) {
      return [{
        key: "7",
        value: {
          status: 3,
          externalChainId: 1,
          authorizationDeadline: "2800",
        },
      }];
    }
    if (url.includes("-withdrawalAuthorizations")) {
      return [{
        key: "7",
        value: {
          notBefore: "1000",
          deadline: "2800",
          signerSetVersion: "4",
        },
      }];
    }
    if (url.includes("-withdrawalManualReviews")) {
      return [{
        key: "7",
        value: {
          approvalDeadline: "9000",
          reviewDigest: "0xaaaa",
          proposalHash: "0xbbbb",
        },
      }];
    }
    if (url.includes("-chains")) {
      return [{
        key: "1",
        value: {
          chainName: "Ethereum",
          depositRouter: "router",
          enabled: true,
          lastProcessedBlock: 10,
          vault: "vault",
        },
      }];
    }
    return [];
  };

  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const withdrawals = await getExternalWithdrawalsByStatus("3");

  assert.equal(withdrawals[0].authorizationNotBefore, "1000");
  assert.equal(withdrawals[0].authorizationDeadline, "2800");
  assert.equal(withdrawals[0].signerSetVersion, "4");
  assert.equal(withdrawals[0].reviewApprovalDeadline, "9000");
  assert.equal(withdrawals[0].reviewDigest, "0xaaaa");
  assert.equal(withdrawals[0].reviewProposalHash, "0xbbbb");
});

test("collects valid signatures when one signer stalls until the deadline", async () => {
  const { Wallet } = await import("ethers");
  const axios = (await import("axios")).default;
  const signerOne = new Wallet(`0x${"31".repeat(32)}`);
  const signerTwo = new Wallet(`0x${"32".repeat(32)}`);
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS =
    "https://signer-one,https://signer-two,https://signer-three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS =
    "token-one,token-two,token-three";

  const authorization = {
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "7",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "100",
    notBefore: "1000",
    deadline: "1100",
    signerSetVersion: "1",
  };
  const types = {
    WithdrawalAuthorization: [
      { name: "sourceChainId", type: "uint256" },
      { name: "sourceBridge", type: "address" },
      { name: "sourceWithdrawalId", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "destinationVault", type: "address" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "notBefore", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signerSetVersion", type: "uint256" },
    ],
  };
  const originalPost = axios.post;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    assert.equal(milliseconds, 60_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("verifier deadline exceeded")), 10);
    return controller.signal;
  };
  (axios as any).post = async (url: string, _payload: unknown, options: any) => {
    assert.equal(options.timeout, 60_000);
    if (url.includes("three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    const signer = url.includes("one") ? signerOne : signerTwo;
    return {
      data: {
        authorizationSigner: signer.address,
        signature: await signer.signTypedData(
          {
            name: "ExternalBridgeVault",
            version: "1",
            chainId: 1,
            verifyingContract: authorization.destinationVault,
          },
          types,
          authorization,
        ),
      },
    };
  };

  try {
    const { signWithdrawalAuthorization } = await import(
      "./externalWithdrawalService"
    );
    const signatures = await signWithdrawalAuthorization(authorization);
    assert.equal(signatures.length, 2);
  } finally {
    axios.post = originalPost;
    AbortSignal.timeout = originalTimeout;
  }
});

test("requires workload-identity KMS for the external vault executor", async () => {
  const { validateExternalBridgeExecutorConfig } = await import(
    "../utils/configValidator"
  );
  const privateKey = `0x${"44".repeat(32)}`;

  const production = validateExternalBridgeExecutorConfig(
    1,
    undefined,
    privateKey,
    true,
  );
  assert.match(
    production.errors.join("\n"),
    /requires .*KMS_KEY_ID.*KMS_REGION/,
  );

  const development = validateExternalBridgeExecutorConfig(
    1,
    undefined,
    privateKey,
    false,
  );
  assert.match(
    development.errors.join("\n"),
    /requires .*KMS_KEY_ID.*KMS_REGION/,
  );
});

test("validates external vault executor workload-identity KMS config", async () => {
  const { validateExternalBridgeExecutorConfig } = await import(
    "../utils/configValidator"
  );
  const address = "0x5555555555555555555555555555555555555555";

  const incomplete = validateExternalBridgeExecutorConfig(
    1,
    { address, keyId: "", region: "" },
    undefined,
    true,
  );
  assert.match(incomplete.errors.join("\n"), /KMS_KEY_ID/);
  assert.match(incomplete.errors.join("\n"), /KMS_REGION/);

  const complete = validateExternalBridgeExecutorConfig(
    1,
    { address, keyId: "alias/eab-executor", region: "us-east-1" },
    undefined,
    true,
  );
  assert.deepEqual(complete.errors, []);
});

test("requires HTTPS for every external verifier service", async () => {
  const { validateExternalBridgeVerifierUrls } = await import(
    "../utils/configValidator"
  );
  assert.deepEqual(
    validateExternalBridgeVerifierUrls([
      "https://verifier-one.example",
      "https://verifier-two.example",
    ]),
    [],
  );
  assert.match(
    validateExternalBridgeVerifierUrls([
      "http://verifier-one.example",
      "not-a-url",
    ]).join("\n"),
    /must use HTTPS.*Invalid external bridge verifier URL/s,
  );
});

test("isolates disabled-chain withdrawals and resumes them when re-enabled", async () => {
  const { cirrus } = await import("../utils/api");
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const originalGet = cirrus.get;
  let disabledChainEnabled = false;
  let noEnabledChains = false;
  let enrichmentCalls = 0;
  (cirrus as any).get = async (url: string, { params }: any) => {
    if (url.includes("-withdrawals?")) {
      if (params.offset) return [];
      return [1, 2].map((chainId) => ({
        key: String(chainId),
        value: { externalChainId: chainId, status: params["value->>status"].slice(3) },
      }));
    }
    if (url.endsWith("-chains")) {
      assert.equal(params["value->>enabled"], "eq.true");
      return noEnabledChains ? [] : [1, ...(disabledChainEnabled ? [2] : [])].map((chainId) => ({
        key: String(chainId), value: { enabled: true, vault: `vault-${chainId}` },
      }));
    }
    if (url.endsWith("-depositRouters")) return [];
    assert.ok(url.endsWith("-withdrawalAuthorizations") || url.endsWith("-withdrawalManualReviews"));
    enrichmentCalls++;
    assert.equal(params.key, disabledChainEnabled ? "in.(1,2)" : "in.(1)");
    return [];
  };
  try {
    for (const status of ["1", "2", "3"]) {
      const withdrawals = await getExternalWithdrawalsByStatus(status);
      assert.deepEqual(withdrawals.map((row) => [row.withdrawalId, row.vault, row.bridgeStatus]), [
        ["1", "vault-1", status],
      ]);
    }
    disabledChainEnabled = true;
    const resumed = await getExternalWithdrawalsByStatus("3");
    assert.deepEqual(resumed.map((row) => [row.withdrawalId, row.vault]), [
      ["1", "vault-1"], ["2", "vault-2"],
    ]);
    noEnabledChains = true;
    const before = enrichmentCalls;
    assert.deepEqual(await getExternalWithdrawalsByStatus("3"), []);
    assert.equal(enrichmentCalls, before);
  } finally {
    cirrus.get = originalGet;
  }
});

test("recovers withdrawal events in bounded ranges from the authorization time", async () => {
  const { getEventTransactionHash } = await import("./externalWithdrawalService");
  const { Interface } = await import("ethers");
  const vault = `0x${"1".repeat(40)}`;
  const reservationId = `0x${"2".repeat(64)}`;
  const iface = new Interface([
    "event WithdrawalReserved(bytes32 indexed reservationId,bytes32 indexed authorizationDigest,uint256 indexed sourceWithdrawalId,address token,address recipient,uint256 amount,uint256 deadline)",
    "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
    "event WithdrawalCancelled(bytes32 indexed reservationId)",
  ]);
  for (const eventName of ["WithdrawalReserved", "WithdrawalReleased", "WithdrawalCancelled"] as const) {
    const successfulRanges: Array<[number, number]> = [];
    let rejectedRanges = 0;
    const provider = {
      getBlock: async (number: number | string) => {
        const block = number === "latest" ? 5000 : Number(number);
        return { number: block, timestamp: block * 12 };
      },
      getLogs: async (filter: any) => {
        assert.equal(filter.address, vault);
        assert.deepEqual(filter.topics, iface.encodeFilterTopics(eventName, [reservationId]));
        assert.equal(typeof filter.toBlock, "number");
        assert.ok(filter.fromBlock >= 1000);
        if (filter.toBlock - filter.fromBlock + 1 > 200) {
          rejectedRanges++;
          throw new Error("RPC block range limit exceeded");
        }
        successfulRanges.push([filter.fromBlock, filter.toBlock]);
        return filter.fromBlock === 1000 ? [{ transactionHash: "recovered-hash" }] : [];
      },
    } as any;
    assert.equal(await getEventTransactionHash(provider, vault, eventName, reservationId, "12000"), "recovered-hash");
    assert.ok(rejectedRanges > 0);
    assert.equal(successfulRanges[0][1], 5000);
    assert.equal(successfulRanges.at(-1)![0], 1000);
    for (let index = 1; index < successfulRanges.length; index++) {
      assert.equal(successfulRanges[index][1], successfulRanges[index - 1][0] - 1);
    }
    provider.getLogs = async () => [];
    await assert.rejects(getEventTransactionHash(provider, vault, eventName, reservationId, "12000"), /event not found/);
  }
});

test("waits for capacity before authorizing either withdrawal path and leaves recovery unblocked", async (t) => {
  const vaultService = await import("./externalWithdrawalService");
  const { processExternalWithdrawal } = await import("./bridgeService");
  const requested: string[] = [];
  t.mock.method(vaultService, "getWithdrawalCapacity", async (withdrawal: any) => {
    requested.push(withdrawal.bridgeStatus);
    return { available: 99n, retryAfterSeconds: 1n };
  });
  t.mock.method(vaultService, "buildWithdrawalAuthorization", async () => {
    throw new Error("authorization reached");
  });
  for (const bridgeStatus of ["1", "2"]) {
    await processExternalWithdrawal({ bridgeStatus, withdrawalId: "7", externalTokenAmount: "100" } as any, true);
  }
  assert.deepEqual(requested, ["1", "2"]);
  await assert.rejects(processExternalWithdrawal({ bridgeStatus: "3" } as any), /authorization reached/);
  assert.deepEqual(requested, ["1", "2"], "already-authorized recovery must bypass the capacity wait");
});


test("app quote client never forwards operator credentials", async (t) => {
  const axios = (await import("axios")).default;
  const { app } = await import("../utils/api");
  t.mock.method(axios, "request", async (request: any) => {
    assert.equal(request.headers.Authorization, undefined);
    return { data: { quote: true } } as any;
  });
  assert.deepEqual(await app.get("/api/trade/route/quote"), { quote: true });
});

test("prefixes bare-hex cirrus addresses so ethers never treats them as ENS names", async () => {
  const { cirrus } = await import("../utils/api");
  const { getEnabledChains } = await import("./cirrusService");
  const originalGet = cirrus.get;
  const vault = "bb2af432802602ced9369e219a7b7329eac4e273";
  const router = "48e52ebbf02a144c31bdce5ff29bb10547cca7d4";
  const extraRouter = "411b8d466da0af8e79140a4d42efc647fea7e6fc";
  (cirrus as any).get = async (url: string) => {
    if (url.endsWith("-chains")) {
      return [{ key: "11155111", value: { enabled: true, vault, depositRouter: router, chainName: "sepolia", lastProcessedBlock: "11685462" } }];
    }
    if (url.endsWith("-depositRouters")) return [{ key: "11155111", key2: extraRouter, value: true }];
    throw new Error(`unexpected cirrus call ${url}`);
  };
  try {
    const chain = (await getEnabledChains()).get(11155111)!;
    assert.equal(chain.vault, `0x${vault}`);
    assert.equal(chain.depositRouter, `0x${router}`);
    assert.deepEqual(chain.depositRouters, [`0x${router}`, `0x${extraRouter}`]);
    assert.equal(chain.chainName, "sepolia");
    assert.equal(chain.lastProcessedBlock, 11685462);
    assert.equal(chain.custody, undefined);
  } finally {
    (cirrus as any).get = originalGet;
  }
});
