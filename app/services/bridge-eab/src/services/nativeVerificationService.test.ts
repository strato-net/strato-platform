import { mkdtempSync as issueTempDir, rmSync as removeIssueDir } from "node:fs";
import { tmpdir as issueTmpdir } from "node:os";
import { join as issuePath } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, keccak256 } from "ethers";
for (const name of [
  "ALCHEMY_API_KEY",
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "STRATO_NATIVE_BRIDGE_ADDRESS",
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

test("native mint recovery shrinks capped log ranges without skipping matching mints", async t => {
  const rpcUrl = process.env.CHAIN_11155111_RPC_URL;
  process.env.CHAIN_11155111_RPC_URL = "https://rpc.test";
  t.after(() => { if (rpcUrl === undefined) delete process.env.CHAIN_11155111_RPC_URL; else process.env.CHAIN_11155111_RPC_URL = rpcUrl; });
  const { JsonRpcProvider } = await import("ethers");
  const { NATIVE_MINT_EVENT_ABI } = await import("../config/bridgeAbi");
  const { getExistingNativeMintTxHash } = await import("./nativeMintService");
  const mintInterface = new Interface(NATIVE_MINT_EVENT_ABI);
  const w: any = { externalChainId: "11155111", externalBridge: address("5"), withdrawalId: "17",
    stratoToken: address("1"), representationToken: address("2"), externalRecipient: address("3"),
    externalTokenAmount: "100", requestedAt: "15600" };
  const event = mintInterface.encodeEventLog(mintInterface.getEvent("RepresentationMinted")!,
    [2001, address("4"), 17, w.stratoToken, w.representationToken, w.externalRecipient, 100, `0x${"a".repeat(64)}`]);
  t.mock.method(JsonRpcProvider.prototype, "getBlock", async (tag: any) => {
    const number = tag === "latest" ? 3000 : Number(tag);
    return { number, timestamp: number * 12 } as any;
  });
  let present = true, unavailable = false;
  const covered = new Set<number>();
  const ranges: number[][] = [];
  t.mock.method(JsonRpcProvider.prototype, "getLogs", async (filter: any) => {
    const from = Number(filter.fromBlock), to = Number(filter.toBlock);
    ranges.push([from, to]);
    assert.equal(filter.address.toLowerCase(), w.externalBridge);
    assert.deepEqual(filter.topics, mintInterface.encodeFilterTopics("RepresentationMinted", [null, address("4"), 17, w.stratoToken]));
    if (unavailable || to - from + 1 > 100) throw new Error("RPC range limit");
    for (let n = from; n <= to; n++) covered.add(n);
    return present && from <= 1500 && to >= 1500 ? [{ ...event, transactionHash: "mint-hash" }] as any : [];
  });
  assert.equal(await getExistingNativeMintTxHash(w, 2001n, address("4")), "mint-hash");
  assert.equal(ranges[0][1] - ranges[0][0] + 1, 1000);
  present = false; covered.clear();
  assert.equal(await getExistingNativeMintTxHash(w, 2001n, address("4")), null);
  assert.equal(covered.size, 2001);
  assert.equal(Math.min(...covered), 1000, "search begins one hour before requestedAt");
  assert.equal(Math.max(...covered), 3000);
  unavailable = true;
  await assert.rejects(getExistingNativeMintTxHash(w, 2001n, address("4")), /RPC range limit/);
  assert.equal(ranges.at(-1)![0], ranges.at(-1)![1], "single-block failures propagate instead of reporting no mint");
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

test("native mint completion requires independent finality and every committed withdrawal field", async t => {
  const rpc = await import("./rpcService");
  const { verifyNativeMint } = await import("./nativeVerificationService");
  const { NATIVE_MINT_EVENT_ABI } = await import("../config/bridgeAbi");
  const mint = new Interface(NATIVE_MINT_EVENT_ABI);
  const sourceChain = 9007199254740993123n;
  const sourceBridge = address("1");
  const txHash = `0x${"a".repeat(64)}`;
  const withdrawal = {
    withdrawalId: "7", externalChainId: "1", externalBridge: address("2"),
    stratoToken: address("3"), representationToken: address("4"), externalRecipient: address("5"),
    externalTokenAmount: "100", bridgeStatus: "2", externalTxHash: "", requestedAt: "1",
    stratoSender: address("6"), stratoTokenAmount: "100", timestamp: "1",
  };
  const mintId = keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"], [sourceChain, sourceBridge, 7],
  ));
  const fields = [sourceChain, sourceBridge, 7, address("3"), address("4"), address("5"), 100, mintId];
  const event = (values = fields) => ({ address: address("2"),
    ...mint.encodeEventLog(mint.getEvent("RepresentationMinted")!, values) });
  const valid = { status: "0x1", blockNumber: "0x64", blockHash: `0x${"b".repeat(64)}`, transactionHash: txHash, logs: [event()] };
  let receipt: any = valid, head = 111;
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  t.mock.method(rpc, "getVerificationBlockNumber", async () => head);
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => new Map([[txHash, receipt]]));
  const verify = () => verifyNativeMint(withdrawal, sourceChain, sourceBridge, txHash);
  const pending = (error: any) => error.issues?.[0]?.code === "CONFIRMATIONS_PENDING";
  await assert.rejects(verify(), pending);
  head = 112;
  await verify();
  for (const incomplete of [undefined, { ...valid, __rpcDisagreement: true },
    { ...valid, blockNumber: "invalid" }, { ...valid, blockNumber: "0xffff" }]) {
    receipt = incomplete;
    await assert.rejects(verify(), pending);
  }
  for (let index = 0; index < fields.length; index++) {
    const values = [...fields];
    values[index] = [0, 2, 6].includes(index) ? 999 : index === 7 ? `0x${"f".repeat(64)}` : address("9");
    receipt = { ...valid, logs: [event(values)] };
    await assert.rejects(verify(), /does not match/);
  }
  for (const bad of [{ ...valid, status: "0x0" }, { ...valid, logs: [] },
    { ...valid, transactionHash: `0x${"c".repeat(64)}` }, { ...valid, blockHash: undefined },
    { ...valid, logs: [{ ...event(), address: address("9") }] },
    { ...valid, logs: [{ ...event(), removed: true }] }]) {
    receipt = bad;
    await assert.rejects(verify(), /does not match/);
  }
  receipt = valid;
  await verify();
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => { throw new Error("RPC unavailable"); });
  await assert.rejects(verify(), /RPC unavailable/);
});

test("native instant retries reuse submitted mints and Safe execution cannot bypass verification", async t => {
  const { config } = await import("../config");
  const api = await import("../utils/api");
  const strato = await import("../utils/stratoHelper");
  const mint = await import("./nativeMintService");
  const verification = await import("./nativeVerificationService");
  const attestations = await import("./settlementAttestationService");
  const bridge = await import("./bridgeService");
  const { JsonRpcProvider } = await import("ethers");
  const source = config.nativeBridge.address;
  config.nativeBridge.address = address("1");
  t.after(() => { config.nativeBridge.address = source; });
  process.env.CHAIN_1_RPC_URL = "https://rpc.test";
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("9");
  t.mock.method(api.eth, "get", async () => ({ networkID: "9007199254740993123" }));
  t.mock.method(JsonRpcProvider.prototype, "getBlock", async () => ({ timestamp: 1000 } as any));
  const record = {
    withdrawalId: "501", externalChainId: "1", externalBridge: address("2"),
    stratoToken: address("3"), representationToken: address("4"), externalRecipient: address("5"),
    externalTokenAmount: "100", bridgeStatus: "2", externalTxHash: "", requestedAt: "1",
    stratoSender: address("6"), stratoTokenAmount: "100", timestamp: "1", nativeMintNotBefore: "1", useInstantPath: true,
  };
  const cirrus = await import("./cirrusService");
  t.mock.method(cirrus, "getNativeWithdrawalById", async () => record);
  t.mock.method(mint, "buildNativeMintRequest", async (withdrawal, _chain, _source, destination) => {
    assert.equal(destination, record.externalBridge, "use the committed bridge, not mutable environment routing");
    return { idempotencyKey: withdrawal.withdrawalId } as any;
  });
  t.mock.method(mint, "getExistingNativeMintTxHash", async () => null);
  const submitted = t.mock.method(mint, "executeNativeMint", async () => "mint-hash");
  let confirmed = false;
  const verified: string[] = [];
  t.mock.method(verification, "verifyNativeMint", async (_withdrawal, chain, source, hash) => {
    assert.equal(chain, 9007199254740993123n);
    assert.equal(source, address("1"));
    verified.push(hash);
    if (!confirmed) throw new Error("Native mint awaiting confirmations");
  });
  t.mock.method(attestations, "attestNativeWithdrawal", async () => undefined);
  const calls: any[] = [];
  t.mock.method(strato, "executeAsRelayer", async (call: any) => { calls.push(call); return {} as any; });
  await assert.rejects(bridge.finalizeNativeWithdrawalBatch([record]), /awaiting confirmations/);
  assert.equal(calls.length, 0);
  confirmed = true;
  await bridge.finalizeNativeWithdrawalBatch([record]);
  assert.equal(submitted.mock.callCount(), 1, "confirmation polling must not submit another mint");
  assert.deepEqual(verified, ["mint-hash", "mint-hash"]);
  assert.equal(calls[0].method, "finalizeWithdrawal");
  assert.equal(calls[0].args.externalTxHash, "mint-hash");
  calls.length = 0;
  t.mock.method(mint, "getNativeMintProposalExecution", async () => ({ status: "executed", txHash: "safe-hash" }));
  const manual = { ...record, withdrawalId: "502", useInstantPath: false, nativeMintProposalHash: "a".repeat(64) };
  confirmed = false;
  await bridge.queueManualNativeWithdrawalBatch([manual]);
  assert.equal(calls.length, 0, "Safe API success alone must not finalize custody accounting");
  confirmed = true;
  await bridge.queueManualNativeWithdrawalBatch([manual]);
  assert.equal(calls[0].method, "finalizeWithdrawal");
  assert.equal(calls[0].args.externalTxHash, "safe-hash");
  const processing = await import("./processingIssueService");
  let current: any = { bridgeStatus: "3", externalTxHash: "0xMINT-HASH" };
  t.mock.method(cirrus, "getNativeWithdrawalById", async () => current);
  t.mock.method(strato, "executeAsRelayer", async () => { throw new Error("SNB: bad state"); });
  t.mock.method(mint, "getExistingNativeMintTxHash", async () => "mint-hash");
  assert.equal(await bridge.finalizeNativeWithdrawalBatch([record]), true, "matching completed mint is success");
  for (const state of [undefined, { bridgeStatus: "4", externalTxHash: "mint-hash" }, { bridgeStatus: "3", externalTxHash: "other-hash" }, { bridgeStatus: "2", externalTxHash: "mint-hash" }]) {
    current = state;
    await assert.rejects(bridge.finalizeNativeWithdrawalBatch([record]), /SNB: bad state/);
  }
  current = { bridgeStatus: "3", externalTxHash: "0xMINT-HASH" };
  t.mock.method(strato, "executeAsRelayer", async () => { throw new Error("SNB: tx hash already set"); });
  assert.equal(await bridge.finalizeNativeWithdrawalBatch([record]), true);
  const failures: unknown[] = [];
  t.mock.method(processing.processingIssueService, "record", async (_context, error) => { failures.push(error); return {} as any; });
  t.mock.method(processing.processingIssueService, "resolve", async () => {});
  current = { bridgeStatus: "3", externalTxHash: "0xSAFE-HASH" };
  await bridge.queueManualNativeWithdrawalBatch([manual]);
  assert.equal(failures.length, 0, "matching Safe completion must not create a processing failure");
  current = { bridgeStatus: "4", externalTxHash: "safe-hash" };
  await bridge.queueManualNativeWithdrawalBatch([manual]);
  assert.equal(failures.length, 1, "Safe abort must not be treated as completion");

});

test("verification binds every native route intent field and selects the correct redemption in multi-log receipts", async (t) => {
  const rpc = await import("./rpcService");
  const { parseNativeDepositLog } = await import("../utils/nativeRedemption");
  const { verifyNativeRedemptionsBatch } = await import("./nativeVerificationService");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  const event = log(true, 2);
  let receipt: any = { status: "0x1", blockNumber: "0x64", transactionHash: event.transactionHash, blockHash: `0x${"b".repeat(64)}`, logs: [log(false), event] };
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  t.mock.method(rpc, "getVerificationBlockNumber", async () => 112);
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
  const attestations = await import("./settlementAttestationService");
  const service = await import("./bridgeService");
  const calls: any[] = [], recipients: string[][] = [];
  t.mock.method(strato, "execute", async (input: any) => { calls.push(...input); return { status: "Success", hash: "settled" } as any; });
  t.mock.method(vouchers, "mintVouchersForDeposits", async (users: string[]) => { recipients.push(users); });
  let attestationError = "";
  t.mock.method(attestations, "attestNativeDeposit", async () => {
    if (attestationError) throw new Error(attestationError);
  });
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
  attestationError = "native verifier quorum unavailable";
  await assert.rejects(
    service.confirmNativeDepositBatch([deposit]),
    /native verifier quorum unavailable/,
  );
  assert.equal(calls.length, 1, "custody cannot move before verifier quorum");
  attestationError = "";
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

test("native verification defers disputed, missing and immature receipts without manual review", async t => {
  const rpc = await import("./rpcService");
  const { verifyNativeRedemptionsBatch } = await import("./nativeVerificationService");
  const { parseNativeDepositLog } = await import("../utils/nativeRedemption");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  const event = log(true, 2);
  const deposit = { ...parseNativeDepositLog(1, event)!, depositId: "native:2", bridgeStatus: "1",
    stratoToken: address("7"), requestedAt: "1", timestamp: "1" };
  const valid = { status: "0x1", blockNumber: "0x64", transactionHash: event.transactionHash, blockHash: `0x${"b".repeat(64)}`, logs: [event] };
  let receipt: any = valid, head = 111;
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => new Map([[event.transactionHash, receipt]]));
  t.mock.method(rpc, "getVerificationBlockNumber", async () => head);
  assert.equal((await verifyNativeRedemptionsBatch([deposit])).has(deposit.depositId), false);
  head = 112;
  assert.equal((await verifyNativeRedemptionsBatch([deposit])).get(deposit.depositId), true);
  for (const pending of [undefined, { ...valid, __rpcDisagreement: true },
    { ...valid, blockNumber: undefined }, { ...valid, blockNumber: "invalid" }, { ...valid, blockNumber: "0xffff" }]) {
    receipt = pending;
    assert.equal((await verifyNativeRedemptionsBatch([deposit])).has(deposit.depositId), false);
  }
  receipt = { ...valid, status: "0x0" };
  assert.equal((await verifyNativeRedemptionsBatch([deposit])).get(deposit.depositId), false);
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "0";
  await assert.rejects(verifyNativeRedemptionsBatch([deposit]), /Invalid deposit confirmation policy/);
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
});

test("native confirmation head uses the slowest RPC and fails closed on bad heads", async t => {
  const { getVerificationBlockNumber } = await import("./rpcService");
  const { fetch } = await import("../utils/api");
  process.env.CHAIN_1_RPC_URL = "https://first.test";
  process.env.CHAIN_1_VERIFICATION_RPC_URLS = "https://second.test";
  let second: any = { result: "0x6e" };
  t.mock.method(fetch, "post", async (url: string) => url.includes("first") ? { result: "0x70" } : second);
  assert.equal(await getVerificationBlockNumber(1), 110);
  for (const bad of [{ error: { message: "unavailable" } }, { result: null }, { result: "invalid" },
    { result: "0x20000000000000" }]) {
    second = bad;
    await assert.rejects(getVerificationBlockNumber(1));
  }
});

test("native polling neither settles nor sends immature evidence to review", async t => {
  const cirrus = await import("./cirrusService");
  const verification = await import("./nativeVerificationService");
  const bridge = await import("./bridgeService");
  const { startNativeDepositInitiatedPolling } = await import("../polling/stratoPolling");
  const settled: string[] = [], reviewed: string[] = [];
  const entries = ["pending", "valid", "invalid"].map(depositId => ({ depositId, bridgeStatus: "1", externalChainId: "1" }));
  t.mock.method(cirrus, "getNativeDepositsByStatus", async (status: string) => status === "1" ? entries as any : []);
  t.mock.method(verification, "verifyNativeRedemptionsBatch", async () => new Map([["valid", true], ["invalid", false]]));
  t.mock.method(bridge, "confirmNativeDepositBatch", async rows => { settled.push(...rows.map(row => row.depositId)); });
  t.mock.method(bridge, "reviewNativeDepositBatch", async rows => { reviewed.push(...rows.map(row => row.depositId)); });
  const finished = new Promise<void>(resolve => t.mock.method(globalThis, "setTimeout", (() => { resolve(); return 0; }) as any));
  startNativeDepositInitiatedPolling();
  await finished;
  assert.deepEqual(settled, ["valid"]);
  assert.deepEqual(reviewed, ["invalid"]);
});

test("native discovery scans and advances only through the confirmed head", async t => {
  const rpc = await import("./rpcService");
  const cirrus = await import("./cirrusService");
  const { nativeBlockTrackingService: cursor } = await import("./nativeBlockTrackingService");
  const { startNativeRedemptionPolling } = await import("../polling/nativeRedemptionPolling");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  t.mock.method(cirrus, "getEnabledChains", async () => new Map([[1, { externalChainId: 1 } as any]]));
  t.mock.method(rpc, "isChainConfigured", () => true);
  t.mock.method(rpc, "getVerificationBlockNumber", async () => 112);
  t.mock.method(cursor, "getCheckpoint", async () => ({ block: 98, reconciliationBlock: 0 }));
  t.mock.method(rpc, "getVerifiedBlockHash", async () => "0x" + "a".repeat(64));
  t.mock.method(cirrus, "getRecordedNativeRedemptions", async () => []);
  const logs = t.mock.method(rpc, "getVerifiedNativeLogs", async (_chain, from, to) => { assert.ok(from === 35 || from === 0); assert.equal(to, 100); return []; });
  const updates = t.mock.method(cursor, "saveCheckpoint", async (_chain, state) => { assert.equal(state.block, 100); });
  t.mock.method(globalThis, "setTimeout", (() => 0) as any);
  startNativeRedemptionPolling();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(logs.mock.callCount(), 2);
  assert.equal(updates.mock.callCount(), 1);
});

test("native recording isolates blocked deposits without advancing the cursor past them", async t => {
  const rpc = await import("./rpcService");
  const cirrus = await import("./cirrusService");
  const bridge = await import("./bridgeService");
  const { nativeBlockTrackingService: cursor } = await import("./nativeBlockTrackingService");
  const { startNativeRedemptionPolling } = await import("../polling/nativeRedemptionPolling");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  t.mock.method(cirrus, "getEnabledChains", async () => new Map([[1, { externalChainId: 1 } as any]]));
  t.mock.method(rpc, "isChainConfigured", () => true);
  t.mock.method(rpc, "getVerificationBlockNumber", async () => 112);
  t.mock.method(cursor, "getCheckpoint", async () => ({ block: 98, reconciliationBlock: 0 }));
  t.mock.method(rpc, "getVerifiedBlockHash", async () => "0x" + "a".repeat(64));
  t.mock.method(cirrus, "getRecordedNativeRedemptions", async () => []);
  t.mock.method(rpc, "getVerifiedNativeLogs", async () => [log(false, 1), log(true, 2)].map(l => ({ ...l, blockNumber: "0x64", blockHash: "0x" + "a".repeat(64) })));
  const updates = t.mock.method(cursor, "saveCheckpoint", async () => undefined);
  const recorded: string[] = [];
  let blocked = true;
  t.mock.method(bridge, "recordNativeDepositBatch", async rows => {
    const id = rows[0].externalRedemptionId;
    recorded.push(id);
    if (blocked && id === "1") throw new Error("low account balance");
  });
  let rerun!: () => Promise<void>;
  const finished = new Promise<void>(resolve => t.mock.method(globalThis, "setTimeout", ((run: any) => {
    rerun = run; resolve(); return 0;
  }) as any));
  startNativeRedemptionPolling();
  await finished;
  assert.deepEqual(recorded, ["1", "2"]);
  assert.equal(updates.mock.callCount(), 0);
  blocked = false;
  await rerun();
  assert.deepEqual(recorded, ["1", "2", "2"]);
  assert.equal(updates.mock.callCount(), 0, "skipping a blocked deposit must hold the cursor");
  const retryTime = Date.now() + 5 * 60_000;
  t.mock.method(Date, "now", () => retryTime);
  await rerun();
  assert.deepEqual(recorded, ["1", "2", "2", "1", "2", "1", "2"]);
  assert.equal(updates.mock.callCount(), 1);
});

// Exercise real persistence with a fresh journal for each test.
test.beforeEach(async (t: any) => {
  const { ProcessingIssueService, processingIssueService } = await import("../services/processingIssueService");
  const directory = issueTempDir(issuePath(issueTmpdir(), "processing-test-"));
  const isolated = new ProcessingIssueService(issuePath(directory, "issues.json"));
  for (const method of ["snapshot", "due", "record", "resolve"] as const) {
    t.mock.method(processingIssueService, method, isolated[method].bind(isolated) as any);
  }
  t.after(() => removeIssueDir(directory, { recursive: true, force: true }));
});

test("native journal migrates numeric cursors, survives restart and rejects corruption", async t => {
  const { NativeBlockTrackingService } = await import("./nativeBlockTrackingService");
  const { writeFile, readFile } = await import("node:fs/promises");
  const dir = issueTempDir(issuePath(issueTmpdir(), "native-cursor-"));
  t.after(() => removeIssueDir(dir, { recursive: true, force: true }));
  const file = issuePath(dir, "cursor.json");
  await writeFile(file, '{"1":98}');
  const service = new NativeBlockTrackingService(file);
  assert.deepEqual(await service.getCheckpoint(1), { block: 98, reconciliationBlock: 0 });
  const checkpoint = { block: 100, hash: "0x" + "a".repeat(64), reconciliationBlock: 20, bridge: address("5") };
  await Promise.all([service.saveCheckpoint(1, checkpoint), service.saveCheckpoint(2, { ...checkpoint, block: 200 })]);
  const restarted = new NativeBlockTrackingService(file);
  assert.deepEqual(await restarted.getCheckpoint(1), checkpoint);
  assert.equal((await restarted.getCheckpoint(2)).block, 200);
  assert.equal(Object.keys(JSON.parse(await readFile(file, "utf8"))).length, 2);
  await writeFile(file, '{broken');
  await assert.rejects(new NativeBlockTrackingService(file).getCheckpoint(1));
});

test("native RPC log agreement detects omitted events, accepts ordering differences, and checks block hashes", async t => {
  const rpc = await import("./rpcService");
  const { fetch } = await import("../utils/api");
  const config = await import("../config");
  t.mock.method(config, "getChainRpcUrls", () => ["https://one.test", "https://two.test"]);
  const entry = { ...log(false), blockNumber: "0x64", blockHash: "0x" + "a".repeat(64), logIndex: "0x0" };
  let omitted = true, mismatch = false, malformed = false;
  t.mock.method(fetch, "post", async (url: string, body: any) => {
    if (body.method === "eth_getBlockByNumber") return { result: { number: "0x64", hash: "0x" + (mismatch && url.includes("two") ? "b" : "a").repeat(64) } };
    if (malformed) return { result: null };
    const rows = [entry, { ...entry, logIndex: "0x1" }];
    return { result: url.includes("two") ? omitted ? [] : rows.reverse() : rows };
  });
  const scan = () => rpc.getVerifiedNativeLogs(1, 99, 100, address("5"), [entry.topics[0]]);
  await assert.rejects(scan(), /log disagreement/);
  omitted = false;
  assert.equal((await scan()).length, 2);
  assert.equal(await rpc.getVerifiedBlockHash(1, 100), entry.blockHash);
  mismatch = true;
  await assert.rejects(rpc.getVerifiedBlockHash(1, 100), /block disagreement/);
  malformed = true;
  await assert.rejects(scan(), /Invalid native scan logs/);
});

test("native sweep recovers old omissions, avoids recorded payouts and detects reorgs", async t => {
  const rpc = await import("./rpcService");
  const cirrus = await import("./cirrusService");
  const bridgeService = await import("./bridgeService");
  const { nativeBlockTrackingService: cursor } = await import("./nativeBlockTrackingService");
  const { pollChainNativeRedemptions } = await import("../polling/nativeRedemptionPolling");
  const { parseNativeDepositLog } = await import("../utils/nativeRedemption");
  process.env.CHAIN_1_NATIVE_REPRESENTATION_BRIDGE_ADDRESS = address("5");
  process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
  t.mock.method(rpc, "isChainConfigured", () => true);
  t.mock.method(rpc, "getVerificationBlockNumber", async () => 5012);
  let state = { block: 5000, hash: "0x" + "a".repeat(64), reconciliationBlock: 0, bridge: address("5") };
  t.mock.method(cursor, "getCheckpoint", async () => state);
  const save = t.mock.method(cursor, "saveCheckpoint", async (_chain, next) => { state = next as typeof state; });
  let hash = state.hash, changing = false, hashReads = 0;
  t.mock.method(rpc, "getVerifiedBlockHash", async () => { hashReads++; return changing && hashReads > 2 ? "0x" + "c".repeat(64) : hash; });
  const ranges: number[][] = [];
  const entry = { ...log(true), blockNumber: "0x64", blockHash: hash };
  t.mock.method(rpc, "getVerifiedNativeLogs", async (_chain, from, to) => {
    ranges.push([from, to]);
    return from <= 100 && to >= 100 ? [{ ...entry, blockHash: hash }] : [];
  });
  let known: any[] = [];
  t.mock.method(cirrus, "getRecordedNativeRedemptions", async () => known);
  const record = t.mock.method(bridgeService, "recordNativeDepositBatch", async () => { known = [parseNativeDepositLog(1, entry)]; });
  await pollChainNativeRedemptions(1);
  assert.ok(ranges.some(([from, to]) => from === 0 && to === 1999), "old history is swept even without head advancement");
  assert.equal(record.mock.callCount(), 1);
  assert.equal(state.reconciliationBlock, 2000);
  state.reconciliationBlock = 0;
  await pollChainNativeRedemptions(1);
  assert.equal(record.mock.callCount(), 1, "already indexed redemption spends no additional transaction fees");
  hash = "0x" + "b".repeat(64);
  ranges.length = 0;
  await pollChainNativeRedemptions(1);
  assert.equal(ranges[0][0], 0, "deep reorg resets discovery to genesis");
  assert.equal(state.block, 1999);
  hashReads = 0; changing = true;
  const count = save.mock.callCount();
  await assert.rejects(pollChainNativeRedemptions(1), /reorg|canonical/);
  assert.equal(save.mock.callCount(), count, "unstable chain cannot advance checkpoint");
});

test("native cancellation recovers Safe proposals and records only confirmed, matching cancellation evidence", async t => {
  const rpcService = await import("./rpcService");
  const safeQueue = await import("./safeProposalService");
  const external = await import("./externalWithdrawalService");
  const strato = await import("../utils/stratoHelper");
  const attestations = await import("./settlementAttestationService");
  const { config } = await import("../config");
  const { NATIVE_CANCELLATION_ABI } = await import("../config/bridgeAbi");
  const { verifyNativeMintCancellation } = await import("./nativeVerificationService");
  const { processNativeMintCancellation } = await import("./nativeMintService");
  process.env.CHAIN_11155111_DEPOSIT_CONFIRMATIONS = "12";
  const cancellation = new Interface(NATIVE_CANCELLATION_ABI);
  const source = `0x${config.nativeBridge.address!.replace(/^0x/i, "")}`;
  const w: any = { bridgeStatus: "10", externalChainId: "11155111", externalBridge: address("5"), withdrawalId: "17", requestedAt: "1" };
  const mintId = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "uint256"], [2001, source, 17]));
  const hash = `0x${"a".repeat(64)}`;
  let canceled = false, minted = false, role = true, head = 1000000, saved: any, published = 0;
  const calls: any[] = [];
  const event = cancellation.encodeEventLog(cancellation.getEvent("NativeMintCanceled")!, [mintId, 2001, source, 17]);
  let receipt: any = { status: "0x1", blockNumber: "0x1", blockHash: `0x${"b".repeat(64)}`, transactionHash: hash,
    logs: [{ ...event, address: w.externalBridge }] };
  t.mock.method(rpcService, "getChainProvider", () => ({ call: async (tx: any) => {
    const name = cancellation.parseTransaction(tx)!.name;
    return cancellation.encodeFunctionResult(name, [name === "canceledMints" ? canceled : name === "processedMints" ? minted : role]);
  } }) as any);
  t.mock.method(rpcService, "getTransactionReceiptsBatch", async () => new Map([[hash, receipt]]));
  t.mock.method(rpcService, "getVerificationBlockNumber", async () => head);
  t.mock.method(external, "getEventTransactionHash", async () => hash);
  t.mock.method(strato, "execute", async (call: any) => { calls.push(call); });
  t.mock.method(strato, "executeAsRelayer", async (call: any) => { calls.push(call); });
  let cancellationAttestationError = "";
  const attestCancellation = t.mock.method(
    attestations,
    "attestNativeCancellation",
    async () => {
      if (cancellationAttestationError) {
        throw new Error(cancellationAttestationError);
      }
    },
  );
  t.mock.method(safeQueue, "withSafeProposalQueue", async (_chain: number, _key: string, work: any) => work({
    apiKit: { getNextNonce: async () => "4", getTransaction: async () => { throw { status: 404 }; },
      proposeTransaction: async (p: any) => { saved = p; published++; } },
    protocolKit: { getNonce: async () => 4, createTransaction: async ({ transactions, options }: any) => ({ data: { ...transactions[0], nonce: options.nonce } }),
      getTransactionHash: async () => hash, signHash: async () => ({ data: "signature" }) },
  }, saved));
  await verifyNativeMintCancellation(w, 2001n, source, hash);
  await assert.rejects(processNativeMintCancellation({ ...w, bridgeStatus: "2" }, "2001"), /not requested/);
  role = false;
  await assert.rejects(processNativeMintCancellation(w, "2001"), /configured Safe/);
  role = true;
  await processNativeMintCancellation(w, "2001");
  assert.equal(calls.pop().method, "recordWithdrawalCancellationProposal");
  const original = saved;
  await processNativeMintCancellation(w, "2001");
  assert.equal(saved, original, "restart republishes the same durable proposal");
  assert.equal(published, 2);
  calls.length = 0; minted = true;
  await assert.rejects(processNativeMintCancellation(w, "2001"), /already executed/);
  assert.equal(calls.length, 0);
  minted = false; canceled = true; head = 1;
  await assert.rejects(processNativeMintCancellation(w, "2001"), /awaits confirmations/);
  head = 1000000; receipt.__rpcDisagreement = true;
  await assert.rejects(processNativeMintCancellation(w, "2001"), /disagreement/);
  delete receipt.__rpcDisagreement;
  receipt.logs[0].address = address("6");
  await assert.rejects(processNativeMintCancellation(w, "2001"), /evidence mismatch/);
  assert.equal(calls.length, 0);
  receipt.logs[0].address = w.externalBridge;
  await processNativeMintCancellation(w, "2001");
  assert.equal(calls.pop().method, "recordWithdrawalCancellationEvidence");
  cancellationAttestationError = "native cancellation quorum unavailable";
  await assert.rejects(
    processNativeMintCancellation({ ...w, cancellationTxHash: hash }, "2001"),
    /native cancellation quorum unavailable/,
  );
  assert.equal(calls.length, 0, "escrow cannot unlock before verifier quorum");
  cancellationAttestationError = "";
  await processNativeMintCancellation({ ...w, cancellationTxHash: hash }, "2001");
  assert.equal(calls.pop().method, "refundCanceledWithdrawal");
  assert.equal(attestCancellation.mock.callCount(), 2);
  assert.equal(calls.length, 0, "indexed evidence is not recorded twice");
});

test("native cancellation recovery finalizes a verified winning mint instead of proposing a refund", async t => {
  const mint = await import("./nativeMintService");
  const verification = await import("./nativeVerificationService");
  const attestations = await import("./settlementAttestationService");
  const strato = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const { recoverNativeWithdrawalCancellation } = await import("./bridgeService");
  t.mock.method(api.eth, "get", async () => ({ networkID: "2001" }));
  t.mock.method(mint, "buildNativeMintRequest", async () => ({} as any));
  let hash: string | null = "mint-hash";
  t.mock.method(mint, "getExistingNativeMintTxHash", async () => hash);
  let verified = false;
  t.mock.method(verification, "verifyNativeMint", async () => { if (!verified) throw new Error("awaiting confirmations"); });
  t.mock.method(attestations, "attestNativeWithdrawal", async () => undefined);
  const calls: any[] = [];
  t.mock.method(strato, "executeAsRelayer", async call => { calls.push(call); });
  const cancel = t.mock.method(mint, "processNativeMintCancellation", async () => {});
  const w: any = { withdrawalId: "917", bridgeStatus: "10", externalBridge: address("5") };
  await assert.rejects(recoverNativeWithdrawalCancellation(w), /awaiting confirmations/);
  assert.equal(calls.length, 0);
  assert.equal(cancel.mock.callCount(), 0);
  verified = true;
  await recoverNativeWithdrawalCancellation(w);
  assert.equal(calls[0].method, "finalizeWithdrawal");
  assert.equal(cancel.mock.callCount(), 0);
  hash = null;
  await recoverNativeWithdrawalCancellation(w);
  assert.equal(cancel.mock.callCount(), 1);
});
