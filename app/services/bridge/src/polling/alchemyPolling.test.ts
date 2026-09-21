import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import {
  buildActionDepositBatchArgs,
  classifyDepositLogs,
  RawDepositLog,
} from "../services/depositEventService";
import {
  clampCursorToPending,
  hasReceiptGraceExpired,
  hasSettlementGraceExpired,
  isPendingReorgReplacement,
  resetPendingForRetry,
  shouldRecordReview,
} from "../services/depositStateService";
import { getExecutableRouteSteps } from "../utils/routeQuoteUtils";
import { RouteAction, RouteQuoteResponse } from "@strato/shared-types";

for (const name of [
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
  "TOKEN_ROUTER",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY ||= "SG.test.test";

const CHAIN_ID = 999;

// The config module exits the process on missing variables; satisfy it before importing it
for (const envVar of [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
]) {
  process.env[envVar] = process.env[envVar] || "test";
}
process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://localhost:1/unused";

import { fetch as httpClient } from "../utils/api";
import {
  getChainLogs,
  getTransactionReceiptsBatch,
} from "../services/rpcService";
import { planLogWindows } from "./alchemyPolling";

const stubPost = <T>(handler: (body: any) => any, run: () => Promise<T>) => {
  const original = (httpClient as any).post;
  (httpClient as any).post = async (_url: string, body: any) => handler(body);
  return run().finally(() => {
    (httpClient as any).post = original;
  });
};

const events = new Interface([
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint8 action, address actionToken, uint256 minFinalOut)",
]);

const token = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const target = "0x4444444444444444444444444444444444444444";
const metal = "0x5555555555555555555555555555555555555555";

const makeLog = (
  eventName: "DepositRouted" | "DepositRoutedWithAction",
  transactionHash: string,
  depositId = 1,
  action = 2,
): RawDepositLog => {
  const encoded = events.encodeEventLog(
    events.getEvent(eventName)!,
    eventName === "DepositRouted"
      ? [token, 100n, sender, recipient, target, depositId]
      : [token, 100n, sender, recipient, target, depositId, action, metal, 90n],
  );
  return {
    address: "0x6666666666666666666666666666666666666666",
    blockHash: `0x${"ff".repeat(32)}`,
    blockNumber: "0x10",
    data: encoded.data,
    logIndex: "0x0",
    topics: encoded.topics,
    transactionHash,
  };
};

test("classifies standard and action deposits from one log range", () => {
  const standardHash = `0x${"aa".repeat(32)}`;
  const actionHash = `0x${"bb".repeat(32)}`;
  const result = classifyDepositLogs(
    [
      makeLog("DepositRouted", standardHash),
      makeLog("DepositRoutedWithAction", actionHash),
    ],
    1,
  );

  assert.equal(result.standardDeposits.length, 1);
  assert.equal(result.standardDeposits[0].externalTxHash, standardHash);
  assert.equal(result.standardDeposits[0].depositId, "1");
  assert.equal(
    result.standardDeposits[0].depositRouter,
    "0x6666666666666666666666666666666666666666",
  );
  assert.equal(result.actionDeposits.length, 1);
  assert.equal(result.actionDeposits[0].action, "2");
  assert.equal(result.actionDeposits[0].actionToken, metal);
  assert.equal(result.actionDeposits[0].minFinalOut, "90");
});

test("processes multiple deposits from one transaction independently", () => {
  const transactionHash = `0x${"cc".repeat(32)}`;
  const actionLog = makeLog("DepositRoutedWithAction", transactionHash, 2);
  actionLog.logIndex = "0x1";
  const result = classifyDepositLogs(
    [makeLog("DepositRouted", transactionHash), actionLog],
    1,
  );
  assert.equal(result.standardDeposits.length, 1);
  assert.equal(result.actionDeposits.length, 1);
  assert.deepEqual(
    [
      result.standardDeposits[0].depositId,
      result.actionDeposits[0].depositId,
    ],
    ["1", "2"],
  );
});

test("deduplicates exact RPC log repeats", () => {
  const log = makeLog("DepositRouted", `0x${"cd".repeat(32)}`);
  const repeatedLog = { ...log, topics: [...log.topics] };
  const result = classifyDepositLogs([log, repeatedLog], 1);

  assert.equal(result.standardDeposits.length, 1);
  assert.equal(result.actionDeposits.length, 0);
});

test("quarantines a deposit log that cannot be ABI decoded", () => {
  const malformed = makeLog("DepositRoutedWithAction", `0x${"dd".repeat(32)}`);
  malformed.data = "0x";
  const result = classifyDepositLogs([malformed], 1);
  assert.equal(result.actionDeposits.length, 0);
  assert.equal(result.quarantinedLogs.length, 1);
  assert.match(result.quarantinedLogs[0].error, /data|buffer|overflow/i);
});

test("quarantines every deposit log when one event in the transaction is malformed", () => {
  const transactionHash = `0x${"de".repeat(32)}`;
  const valid = makeLog("DepositRouted", transactionHash);
  const malformed = makeLog("DepositRoutedWithAction", transactionHash, 2);
  malformed.logIndex = "0x1";
  malformed.data = "0x";
  const result = classifyDepositLogs([valid, malformed], 1);

  assert.equal(result.standardDeposits.length, 0);
  assert.equal(result.actionDeposits.length, 0);
  assert.equal(result.quarantinedLogs.length, 2);
});

test("quarantines duplicate deposit identities as one transaction", () => {
  const transactionHash = `0x${"df".repeat(32)}`;
  const first = makeLog("DepositRouted", transactionHash, 1);
  const duplicate = makeLog("DepositRouted", transactionHash, 1);
  duplicate.logIndex = "0x1";
  const result = classifyDepositLogs([first, duplicate], 1);

  assert.equal(result.standardDeposits.length, 0);
  assert.equal(result.quarantinedLogs.length, 2);
  assert.match(result.quarantinedLogs[0].error, /Duplicate deposit identity/);
});

test("preserves every action field in batch arguments", () => {
  const actionDeposit = classifyDepositLogs(
    [makeLog("DepositRoutedWithAction", `0x${"ee".repeat(32)}`)],
    1,
  ).actionDeposits[0];
  const args = buildActionDepositBatchArgs([actionDeposit]);

  assert.deepEqual(args.actions, ["2"]);
  assert.deepEqual(args.depositIds, ["1"]);
  assert.deepEqual(args.actionTokens, [metal]);
  assert.deepEqual(args.minFinalOuts, ["90"]);
});

test("carries event intent through quote steps into routed settlement", async () => {
  const actionDeposit = classifyDepositLogs(
    [makeLog("DepositRoutedWithAction", `0x${"ef".repeat(32)}`, 1, 4)],
    1,
  ).actionDeposits[0];
  const quote: RouteQuoteResponse = {
    tokenIn: target,
    tokenOut: metal,
    amountIn: "100",
    amountOut: "95",
    minFinalOut: "90",
    slippageBps: 0,
    deadline: 1,
    steps: [
      {
        action: RouteAction.FORGE,
        target: "0x7777777777777777777777777777777777777777",
        tokenIn: target,
        tokenOut: metal,
        minAmountOut: "95",
        parameter1: "0",
        parameter2: "0",
        direction: false,
        factoryPoolIndex: "0",
        amountIn: "100",
        amountOut: "95",
        feeAmount: "5",
        feeBps: 500,
        priceImpact: 0,
        label: "Forge",
      },
    ],
  };
  const steps = getExecutableRouteSteps(
    quote,
    actionDeposit.targetStratoToken,
    actionDeposit.actionToken,
    actionDeposit.minFinalOut,
  );
  const { attemptDepositSettlement } = await import("./alchemyPolling");

  const error = await attemptDepositSettlement(
    { ...actionDeposit, steps },
    async (deposit) => {
      assert.equal(deposit.action, "4");
      assert.equal(deposit.minFinalOut, "90");
      assert.equal(deposit.steps[0].minAmountOut, "90");
      return "0xsettled";
    },
  );
  assert.equal(error, null);
});

test("falls back only after a deterministic routed settlement failure", async () => {
  const { attemptRoutedSettlementWithFallback } = await import(
    "./alchemyPolling"
  );
  const deposit = {} as any;
  let fallbackCalls = 0;
  const deterministic = await attemptRoutedSettlementWithFallback(
    deposit,
    async () => {
      throw new Error("TR: step slippage");
    },
    async () => {
      fallbackCalls += 1;
      return "0xfallback";
    },
  );
  assert.equal(deterministic.error, null);
  assert.equal(deterministic.usedFallback, true);
  assert.equal(fallbackCalls, 1);

  const transport = await attemptRoutedSettlementWithFallback(
    deposit,
    async () => {
      throw new Error("Request timeout");
    },
    async () => {
      fallbackCalls += 1;
      return "0xunsafe";
    },
  );
  assert.match(transport.error?.message || "", /timeout/i);
  assert.equal(transport.usedFallback, false);
  assert.equal(fallbackCalls, 1);
});

test("keeps missing route dependencies and STRATO serialization errors retryable", async () => {
  const { attemptRoutedSettlementWithFallback } = await import("./alchemyPolling");
  const { isTransportRouteError } = await import("../utils/routeFailure");
  for (const message of [
    "Bridge route metadata is unavailable",
    "Forge oracle price is unavailable",
    "STRATO_APP_API_URL is not configured",
    "argValueToValue: Expected TypeEnum to be a string",
    "parse error: call arguments: expecting hexadecimal digit",
  ]) {
    const error = new Error(message);
    assert.equal(isTransportRouteError(error), true);
    const result = await attemptRoutedSettlementWithFallback({} as any,
      async () => { throw error; },
      async () => { assert.fail("An unavailable dependency must not trigger fallback"); });
    assert.equal(result.error, error);
    assert.equal(result.usedFallback, false);
  }
});

test("applies rebase only when the exact route requires it", async () => {
  const [{ getRoutedDepositAmount }, { getRouteRebaseKey }] = await Promise.all([
    import("./alchemyPolling"),
    import("../services/cirrusService"),
  ]);
  const deposit = classifyDepositLogs(
    [makeLog("DepositRouted", `0x${"ab".repeat(32)}`)],
    1,
  ).standardDeposits[0];
  const ordinaryDeposit = {
    ...deposit,
    externalToken: "0x7777777777777777777777777777777777777777",
    externalTokenAmount: "100",
  };
  const requiredRoutes = new Set([
    getRouteRebaseKey(
      deposit.externalToken,
      deposit.externalChainId,
      deposit.targetStratoToken,
    ),
  ]);

  const rebasedAmount = await getRoutedDepositAmount(
    deposit,
    18,
    async () => requiredRoutes,
    async () =>
      new Map([
        [
          deposit.targetStratoToken.replace(/^0x/, "").toLowerCase(),
          2n * 10n ** 18n,
        ],
      ]),
  );
  const ordinaryAmount = await getRoutedDepositAmount(
    ordinaryDeposit,
    18,
    async () => requiredRoutes,
    async () => new Map(),
  );

  assert.equal(rebasedAmount, 50n);
  assert.equal(ordinaryAmount, 100n);
  assert.equal(deposit.externalTokenAmount, "100");
  assert.equal(ordinaryDeposit.externalTokenAmount, "100");
  await assert.rejects(
    () =>
      getRoutedDepositAmount(
        { ...deposit, externalTokenAmount: "100" },
        18,
        async () => requiredRoutes,
        async () => new Map(),
      ),
    /Rebase factor unavailable/,
  );
});

test("uses elapsed time rather than poll count for missing receipt review", () => {
  assert.equal(hasReceiptGraceExpired(1_000, 300_000, 299_999), false);
  assert.equal(hasReceiptGraceExpired(1_000, 300_000, 301_000), true);
});

test("quarantines settlement failures only after elapsed retry grace", () => {
  assert.equal(hasSettlementGraceExpired(1_000, 900_000, 900_999), false);
  assert.equal(hasSettlementGraceExpired(1_000, 900_000, 901_000), true);
});

test("does not resubmit a review already recorded on STRATO", () => {
  assert.equal(
    shouldRecordReview({
      deposit: {} as any,
      status: "review",
      reviewReason: "RPC conflict",
      reviewRecordedOnchain: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordReview({
      deposit: {} as any,
      status: "review",
      reviewReason: "RPC conflict",
      reviewRecordLastAttemptAt: 1_000,
    }, 60_000, 60_999),
    false,
  );
  assert.equal(
    shouldRecordReview({
      deposit: {} as any,
      status: "review",
      reviewReason: "RPC conflict",
      reviewRecordLastAttemptAt: 1_000,
    }, 60_000, 61_000),
    true,
  );
});

test("clamps the cursor behind the oldest unsettled deposit", () => {
  assert.equal(clampCursorToPending(200, 150), 149);
  assert.equal(clampCursorToPending(200), 200);
});

test("replaces a reverted pending observation when its deposit ID is reused", () => {
  const oldDeposit = classifyDepositLogs(
    [makeLog("DepositRouted", `0x${"12".repeat(32)}`)],
    1,
  ).standardDeposits[0];
  const replacement = classifyDepositLogs(
    [makeLog("DepositRouted", `0x${"34".repeat(32)}`)],
    1,
  ).standardDeposits[0];
  replacement.externalBlockHash = `0x${"ab".repeat(32)}`;

  assert.equal(
    isPendingReorgReplacement(
      { deposit: oldDeposit, status: "pending" },
      replacement,
    ),
    true,
  );
});

test("resets reviewed local state after owner reuse authorization", () => {
  const deposit = classifyDepositLogs(
    [makeLog("DepositRouted", `0x${"56".repeat(32)}`)],
    1,
  ).standardDeposits[0];
  const pending = {
    deposit,
    status: "review" as const,
    reviewReason: "External receipt remained unavailable",
    reviewRecordedOnchain: true,
    reviewRecordLastAttemptAt: 1,
    settlementFirstFailedAt: 1,
  };

  resetPendingForRetry(pending, 500);

  assert.equal(pending.status, "pending");
  assert.equal(pending.reviewReason, undefined);
  assert.equal(pending.reviewRecordedOnchain, undefined);
  assert.equal(pending.reviewRecordLastAttemptAt, undefined);
  assert.equal(pending.settlementFirstFailedAt, undefined);
  assert.equal(pending.deposit.detectedAt, 500);
});

test("getChainLogs throws on a JSON-RPC error returned with HTTP 200", async () => {
  for (const code of [-32602, -32005]) {
    await stubPost(
      () => ({ jsonrpc: "2.0", id: 1, error: { code, message: "nope" } }),
      async () => {
        await assert.rejects(
          () => getChainLogs(CHAIN_ID, 1, 2, "0x00", ["0x00"]),
          new RegExp(`eth_getLogs failed on chain ${CHAIN_ID}.*${code}`),
        );
      },
    );
  }

  await stubPost(
    () => ({ jsonrpc: "2.0", id: 1, result: [] }),
    async () => {
      assert.deepEqual(await getChainLogs(CHAIN_ID, 1, 2, "0x00", ["0x00"]), []);
    },
  );
});

test("splits a catch-up range into windows below the getLogs cap", () => {
  const windows = planLogWindows(1, 5000, 800, 30);

  assert.equal(windows.length, 7);
  assert.deepEqual(windows[0], [1, 800]);
  assert.deepEqual(windows[6], [4801, 5000]);
  windows.slice(1).forEach(([from], i) => assert.equal(from, windows[i][1] + 1));

  // A gap wider than the per-tick cap is drained across ticks, never in one range
  const capped = planLogWindows(1, 1_000_000, 800, 30);
  assert.equal(capped.length, 30);
  assert.deepEqual(capped[29], [23_201, 24_000]);
});

test("keeps JSON-RPC batches within the 20-call submission limit", async () => {
  const txHashes = Array.from({ length: 21 }, (_, i) => `0x${String(i).padStart(64, "0")}`);
  const batchSizes: number[] = [];

  const receipts = await stubPost(
    (body: any[]) => {
      batchSizes.push(body.length);
      return body.map((call) => ({ id: call.id, result: { transactionHash: call.params[0] } }));
    },
    () => getTransactionReceiptsBatch(CHAIN_ID, txHashes),
  );

  assert.deepEqual(batchSizes, [20, 1]);
  assert.equal(receipts.size, 21);
  txHashes.forEach((txHash) =>
    assert.equal(receipts.get(txHash)?.transactionHash, txHash),
  );
});
