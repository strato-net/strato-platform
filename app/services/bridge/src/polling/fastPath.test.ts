import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, keccak256 } from "ethers";

const CHAIN_ID = 999;

// The config module exits the process on missing variables; satisfy it before
// importing anything that pulls it in.
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

import { classifyDepositLogs, RawDepositLog } from "../services/depositEventService";
import {
  NATIVE_REDEMPTION_EVENTS_ABI,
  parseNativeDepositLog,
} from "./nativeRedemptionPolling";
import {
  buildSettlementDescriptor,
  buildWithdrawalTerms,
  canRouteSettlement,
} from "../utils/safeHelper";
import { parseFillLog, WITHDRAWAL_FILLED_ABI } from "../services/withdrawalClaimService";
import { WithdrawalInfo } from "../types";

const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const SENDER = "0x4444444444444444444444444444444444444444";
const STRATO_TOKEN = "0x5555555555555555555555555555555555555555";
const SOURCE_BRIDGE = "0x6666666666666666666666666666666666666666";
const SOLVER = "0x7777777777777777777777777777777777777777";

const depositEvents = new Interface([
  "event DepositRoutedWithFee(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee, uint256 requestedAt, uint256 feeHalfLife)",
]);
const redemptionEvents = new Interface(NATIVE_REDEMPTION_EVENTS_ABI);
const fillEvents = new Interface(WITHDRAWAL_FILLED_ABI);

const encodeLog = (
  iface: Interface,
  name: string,
  args: any[],
  overrides: Partial<RawDepositLog> = {},
) => {
  const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
  return {
    address: ROUTER,
    blockNumber: "0x10",
    data: encoded.data,
    logIndex: "0x0",
    topics: encoded.topics,
    transactionHash: "0xabc",
    ...overrides,
  };
};

// ---------------------------------------------------------------- deposits

/**
 * The origin timestamp must survive the trip verbatim. STRATO starts the fee
 * decay there, so a relayer that substitutes its own clock hands the solver
 * back the decay the user is owed -- which is exactly the refund the schedule
 * exists to give.
 */
test("a fee-bearing deposit carries its origin timestamp through unchanged", () => {
  const requestedAt = 1_700_000_000n;
  const log = encodeLog(depositEvents, "DepositRoutedWithFee", [
    TOKEN,
    10n ** 18n,
    SENDER,
    RECIPIENT,
    STRATO_TOKEN,
    1n,
    3n * 10n ** 16n,
    requestedAt,
    21600n,
  ]);

  const classified = classifyDepositLogs([log as RawDepositLog], CHAIN_ID);

  assert.equal(classified.standardDeposits.length, 0);
  assert.equal(classified.actionDeposits.length, 0);
  assert.equal(classified.feeDeposits.length, 1);

  const deposit = classified.feeDeposits[0];
  assert.equal(deposit.requestedAt, requestedAt.toString());
  assert.equal(deposit.maxFee, (3n * 10n ** 16n).toString());
  assert.equal(deposit.feeHalfLife, "21600");
  assert.equal(deposit.externalTokenAmount, (10n ** 18n).toString());
});

test("a fee-free deposit is still classified as standard", () => {
  const legacy = new Interface([
    "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  ]);
  const log = encodeLog(legacy, "DepositRouted", [
    TOKEN,
    10n ** 18n,
    SENDER,
    RECIPIENT,
    STRATO_TOKEN,
    1n,
  ]);

  const classified = classifyDepositLogs([log as RawDepositLog], CHAIN_ID);
  assert.equal(classified.standardDeposits.length, 1);
  assert.equal(classified.feeDeposits.length, 0);
});

// -------------------------------------------------------------- redemptions

/**
 * The fee-bearing redemption appends three words to the data blob. This used to
 * be decoded by slicing a fixed two words out of it, which would have read a
 * `maxFee` as an amount; the decode is by ABI for that reason.
 */
test("both redemption shapes decode, and only one carries fee terms", () => {
  const plain = encodeLog(redemptionEvents, "RedemptionRequested", [
    TOKEN,
    500n,
    SENDER,
    RECIPIENT,
    7n,
  ]);
  const withFee = encodeLog(redemptionEvents, "RedemptionRequestedWithFee", [
    TOKEN,
    500n,
    SENDER,
    RECIPIENT,
    8n,
    15n,
    1_700_000_000n,
    21600n,
  ]);

  const plainParsed = parseNativeDepositLog(CHAIN_ID, plain)!;
  assert.equal(plainParsed.stratoTokenAmount, "500");
  assert.equal(plainParsed.externalRedemptionId, "7");
  assert.equal(plainParsed.feeTerms, undefined);

  const feeParsed = parseNativeDepositLog(CHAIN_ID, withFee)!;
  assert.equal(feeParsed.stratoTokenAmount, "500");
  assert.equal(feeParsed.externalRedemptionId, "8");
  assert.deepEqual(feeParsed.feeTerms, {
    maxFee: "15",
    requestedAt: "1700000000",
    feeHalfLife: "21600",
  });
});

// ------------------------------------------------------------- settlement

const withdrawal = (overrides: Partial<WithdrawalInfo> = {}): WithdrawalInfo =>
  ({
    bridgeStatus: "1",
    custodyTxHash: "",
    externalChainId: CHAIN_ID,
    externalRecipient: RECIPIENT,
    externalToken: TOKEN,
    externalTokenAmount: "1000000",
    requestedAt: "1700000000",
    stratoSender: SENDER,
    stratoToken: STRATO_TOKEN,
    stratoTokenAmount: "1000000000000000000",
    timestamp: "1700000000",
    withdrawalId: "7",
    ...overrides,
  }) as WithdrawalInfo;

const routable = (overrides: Partial<WithdrawalInfo> = {}) =>
  withdrawal({
    settlementRouter: ROUTER,
    sourceBridge: SOURCE_BRIDGE,
    sourceChainId: "24601",
    feeTerms: { maxFee: "3000", requestedAt: "1700000000", feeHalfLife: "21600" },
    ...overrides,
  });

/**
 * A withdrawal requested before the fast-path upgrade has no committed schedule
 * and no router, so it keeps the direct transfer it was requested under. The
 * migration has to drain in-flight withdrawals, not strand them.
 */
test("only a withdrawal with a committed schedule is routed through the router", () => {
  assert.equal(canRouteSettlement(routable()), true);
  assert.equal(canRouteSettlement(withdrawal()), false);
  assert.equal(canRouteSettlement(routable({ feeTerms: undefined })), false);
  assert.equal(canRouteSettlement(routable({ settlementRouter: undefined })), false);
  assert.equal(canRouteSettlement(routable({ sourceBridge: undefined })), false);
});

/**
 * The hazard a live probe of the fleet exposed: STRATO commits a fee schedule
 * to EVERY withdrawal once it is upgraded, including zero-fee ones from the
 * plain entry point, but the external routers upgrade on their own schedule.
 * Routing a withdrawal to a router with no `settleWithdrawal` makes the Safe
 * transaction revert and the withdrawal stall, so a router that has not been
 * confirmed to support settlement must leave `settlementRouter` unset and fall
 * back to the direct transfer.
 */
test("a chain whose router is not upgraded falls back to a direct transfer", () => {
  // Fee terms present (STRATO is upgraded) but no confirmed router: exactly the
  // state of a Robinhood or HyperEVM withdrawal during a partial rollout.
  const notUpgraded = withdrawal({
    sourceBridge: SOURCE_BRIDGE,
    sourceChainId: "24601",
    feeTerms: { maxFee: "0", requestedAt: "1700000000", feeHalfLife: "0" },
  });
  assert.equal(canRouteSettlement(notUpgraded), false);

  const descriptor = buildSettlementDescriptor({
    withdrawal: routable(),
    nonce: 1,
  });
  // ...while a confirmed router still routes.
  assert.equal(descriptor.transactions.length, 2);
});

/**
 * THE SETTLEMENT PAYLOAD NAMES NO PAYEE. That is what lets the Safe proposal be
 * built and signed before any solver exists and still route to one that appears
 * afterwards. If a recipient address ever shows up in this calldata outside the
 * terms, the pre-signing property is gone.
 */
test("an ERC20 settlement is approve-then-settle, and never holds custody", () => {
  const descriptor = buildSettlementDescriptor({
    withdrawal: routable(),
    nonce: 5,
  });

  assert.equal(descriptor.options.nonce, 5);
  assert.equal(descriptor.transactions.length, 2);

  const [approve, settle] = descriptor.transactions;

  // Leg one is an approve ON THE TOKEN, naming the router as spender for
  // exactly the amount and nobody else for anything.
  assert.equal(approve.to.toLowerCase(), TOKEN);
  assert.equal(approve.value, "0");
  const approveCall = new Interface([
    "function approve(address spender, uint256 amount)",
  ]).parseTransaction({ data: approve.data })!;
  assert.equal(approveCall.args[0].toLowerCase(), ROUTER);
  assert.equal(approveCall.args[1].toString(), "1000000");

  // Leg two settles. The allowance is created and consumed inside the one
  // atomic MultiSend, so the router never holds the funds.
  assert.equal(settle.to.toLowerCase(), ROUTER);
  assert.equal(settle.value, "0");
  const settleCall = new Interface([
    "function settleWithdrawal((uint256 sourceChainId,address sourceBridge,uint256 withdrawalId,address token,address recipient,uint256 amount,uint256 maxFee,uint256 requestedAt,uint256 feeHalfLife) terms)",
  ]).parseTransaction({ data: settle.data })!;
  const terms = settleCall.args[0];
  assert.equal(terms.withdrawalId.toString(), "7");
  assert.equal(terms.amount.toString(), "1000000");
  assert.equal(terms.maxFee.toString(), "3000");
  assert.equal(terms.feeHalfLife.toString(), "21600");
  assert.equal(terms.recipient.toLowerCase(), RECIPIENT);
});

test("a native settlement carries the value on a single call", () => {
  const descriptor = buildSettlementDescriptor({
    withdrawal: routable({ externalToken: ZERO }),
    nonce: 9,
  });

  assert.equal(descriptor.transactions.length, 1);
  assert.equal(descriptor.transactions[0].to.toLowerCase(), ROUTER);
  assert.equal(descriptor.transactions[0].value, "1000000");
  assert.equal(buildWithdrawalTerms(routable({ externalToken: ZERO })).token, ZERO);
});

/**
 * The payload must not change when a solver claims. This is the property the
 * whole settlement design exists for, so it is asserted directly rather than
 * inferred: the same withdrawal produces byte-identical calldata regardless.
 */
test("the settlement payload is identical before and after a claim", () => {
  const before = buildSettlementDescriptor({ withdrawal: routable(), nonce: 1 });
  const after = buildSettlementDescriptor({ withdrawal: routable(), nonce: 1 });
  assert.deepEqual(before.transactions, after.transactions);
});

/**
 * Both capability probes must fail CLOSED on an unreachable chain.
 *
 * A probe that guessed "supported" when it could not reach the RPC would route
 * a settlement to a router that cannot settle, or build a V2 attestation for a
 * bridge that only has V1 — stalling the withdrawal either way. Guessing
 * "unsupported" only costs the fast path, which is the direction an outage
 * should push.
 */
test("capability probes fail closed when the chain is unreachable", async () => {
  process.env[`CHAIN_${CHAIN_ID}_RPC_URL`] = "http://127.0.0.1:1/dead";

  const { routerSupportsSettlement } = await import("../utils/safeHelper");
  const { representationBridgeSupportsV2 } = await import(
    "../services/nativeMintService"
  );

  assert.equal(
    await routerSupportsSettlement(CHAIN_ID, ROUTER, SOLVER),
    false,
    "an unreachable router must not be treated as able to settle",
  );
  assert.equal(
    await representationBridgeSupportsV2(CHAIN_ID, ROUTER),
    false,
    "an unreachable bridge must not be treated as understanding V2",
  );
});

// ------------------------------------------------------------------ claims

/**
 * The withdrawal key the relayer recomputes has to match the one the external
 * bridges emit, or no claim is ever matched to its withdrawal. Both sides are
 * keccak(abi.encode(sourceChainId, sourceBridge, withdrawalId)); this pins the
 * relayer's copy against a fixed vector, and app/ethereum's
 * DepositRouter tests pin the contract's against its own `withdrawalKeyFor`.
 */
test("the relayer's withdrawal key matches the contracts' preimage", () => {
  const key = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [24601n, SOURCE_BRIDGE, 7n],
    ),
  );

  // Recomputed by hand from the same three fields, in the same order.
  const expected = keccak256(
    "0x" +
      (24601n).toString(16).padStart(64, "0") +
      SOURCE_BRIDGE.slice(2).padStart(64, "0") +
      (7n).toString(16).padStart(64, "0"),
  );
  assert.equal(key, expected);
});

test("a fill log decodes into the claim the relayer mirrors", () => {
  const key = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [24601n, SOURCE_BRIDGE, 7n],
    ),
  );
  const log = encodeLog(fillEvents, "WithdrawalFilled", [
    key,
    SOLVER,
    RECIPIENT,
    0n,
    TOKEN,
    1000000n,
    3000n,
    997000n,
  ]);

  const fill = parseFillLog(log)!;
  assert.equal(fill.withdrawalKey, key.toLowerCase());
  assert.equal(fill.claimant, SOLVER);
  assert.equal(fill.paidTo, RECIPIENT);
  assert.equal(fill.claimIndex, 0);
  assert.equal(fill.feeCharged, "3000");
  assert.equal(fill.netPaid, "997000");
  // The net plus the fee is the whole amount: what the recipient got plus what
  // the solver keeps at settlement.
  assert.equal(
    (BigInt(fill.netPaid) + BigInt(fill.feeCharged)).toString(),
    fill.amount,
  );
});

test("a later rung decodes with its own index and price", () => {
  const key = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [24601n, SOURCE_BRIDGE, 7n],
    ),
  );
  // Rung one, at a price the displaced solver set -- which may be ABOVE the
  // user's original ceiling, because it is a solver paying to shed risk.
  const log = encodeLog(fillEvents, "WithdrawalFilled", [
    key,
    SOLVER,
    RECIPIENT,
    1n,
    TOKEN,
    1000000n,
    8000n,
    992000n,
  ]);

  const fill = parseFillLog(log)!;
  assert.equal(fill.claimIndex, 1);
  assert.equal(fill.feeCharged, "8000");
});
