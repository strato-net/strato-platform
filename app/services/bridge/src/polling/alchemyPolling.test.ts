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
  "EXTERNAL_BRIDGE_SIGNER_API_TOKEN",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
  "TOKEN_ROUTER",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY ||= "SG.test.test";

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
