import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
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


const address = (digit: string) => `0x${digit.repeat(40)}`;
const iface = new Interface([
  "event RedemptionRequested(address indexed representationToken,uint256 amount,address indexed sender,address indexed stratoRecipient,uint96 redemptionId)",
  "event RedemptionRequestedWithRoute(address indexed representationToken,uint256 amount,address indexed sender,address indexed stratoRecipient,uint96 redemptionId,address actionToken,uint256 minFinalOut)",
]);
const log = (routed: boolean, id = 1) => ({
  ...iface.encodeEventLog(iface.getEvent(routed ? "RedemptionRequestedWithRoute" : "RedemptionRequested")!,
    [address("1"), 100, address("2"), address("3"), id, ...(routed ? [address("4"), 95] : [])]),
  address: address("5"), transactionHash: `0x${"6".repeat(64)}`,
});

test("native polling decoder distinguishes plain and routed events and rejects incomplete intent", async () => {
  const { parseNativeDepositLog } = await import("../utils/nativeRedemption");
  const routed = parseNativeDepositLog(1, log(true))!;
  assert.equal(routed.actionToken, address("4"));
  assert.equal(routed.minFinalOut, "95");
  assert.equal(routed.stratoTokenAmount, "100");
  assert.equal(routed.stratoRecipient, address("3"));
  assert.equal(parseNativeDepositLog(1, log(false))!.minFinalOut, "0");
  assert.throws(() => parseNativeDepositLog(1, { ...log(true), data: log(false).data }), /Invalid native/);
  assert.equal(parseNativeDepositLog(1, { ...log(true), topics: ["0xother"] }), null);
});

test("verification binds every native route intent field and selects the correct redemption in multi-log receipts", async (t) => {
  const rpc = await import("./rpcService");
  const { parseNativeDepositLog } = await import("../utils/nativeRedemption");
  const { verifyNativeRedemptionsBatch } = await import("./nativeVerificationService");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  const event = log(true, 2);
  let receipt: any = { status: "0x1", logs: [log(false), event] };
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => new Map([[event.transactionHash, receipt]]));
  const deposit = { ...parseNativeDepositLog(1, event)!, depositId: "native:2", bridgeStatus: "1", stratoToken: address("7"), requestedAt: "1", timestamp: "1" };
  assert.equal((await verifyNativeRedemptionsBatch([deposit])).get(deposit.depositId), true);
  for (const mutation of [
    { actionToken: address("8") }, { minFinalOut: "94" }, { stratoRecipient: address("8") },
    { stratoTokenAmount: "101" }, { externalRedemptionId: "3" }, { representationToken: address("8") },
    { externalSender: address("8") }, { externalBridge: address("8") }, { actionToken: undefined, minFinalOut: undefined },
  ]) {
    assert.equal((await verifyNativeRedemptionsBatch([{ ...deposit, ...mutation }])).get(deposit.depositId), false);
  }
  receipt = { ...receipt, status: "0x0" };
  assert.equal((await verifyNativeRedemptionsBatch([deposit])).get(deposit.depositId), false);
});


test("native settlement uses verified intent for fresh steps, retries transport failures and falls back only on deterministic quote failure", async (t) => {
  const { config } = await import("../config");
  const previous = config.nativeBridge.address;
  config.nativeBridge.address = address("9");
  t.after(() => { config.nativeBridge.address = previous; });
  const strato = await import("../utils/stratoHelper");
  const quotes = await import("./routeQuoteService");
  const vouchers = await import("./voucherService");
  const service = await import("./bridgeService");
  const calls: any[] = [], recipients: string[][] = [];
  t.mock.method(strato, "execute", async (input: any) => { calls.push(...input); return { status: "Success", hash: "settled" } as any; });
  t.mock.method(vouchers, "mintVouchersForDeposits", async (users: string[]) => { recipients.push(users); });
  let failure = "";
  const steps = [{ action: "SAVE", target: address("4"), tokenIn: address("7"), tokenOut: address("4"), minAmountOut: "95", parameter1: "0", parameter2: "0", direction: false, factoryPoolIndex: "0" }];
  t.mock.method(quotes, "fetchRouteSteps", async (input: any) => {
    assert.deepEqual(input, { tokenIn: address("7"), tokenOut: address("4"), amountIn: "100", minFinalOut: "95" });
    if (failure) throw new Error(failure);
    return steps;
  });
  const parsed = (await import("../utils/nativeRedemption")).parseNativeDepositLog(1, log(true))!;
  await service.recordNativeDepositBatch([parsed]);
  assert.equal(calls[0].method, "recordDepositWithRoute");
  assert.equal(calls[0].args.actionToken, address("4"));
  assert.equal(calls[0].args.minFinalOut, "95");
  const deposit = { ...parsed, depositId: "native1", stratoToken: address("7"), verified: true };
  await service.confirmNativeDepositBatch([deposit]);
  assert.equal(calls[1].method, "confirmDepositWithRoute");
  assert.deepEqual(calls[1].args.steps, steps);
  failure = "network timeout";
  await assert.rejects(service.confirmNativeDepositBatch([deposit]), /network timeout/);
  assert.equal(calls.length, 2);
  assert.equal(recipients.length, 1);
  failure = "No executable route";
  await service.confirmNativeDepositBatch([deposit]);
  assert.equal(calls[2].method, "confirmDepositWithRoute");
  assert.deepEqual(calls[2].args.steps, []);
  await service.confirmNativeDepositBatch([{ ...deposit, actionToken: address("0"), minFinalOut: "0" }]);
  assert.equal(calls[3].method, "confirmDeposit");
  assert.equal(calls[3].args.steps, undefined);
});
