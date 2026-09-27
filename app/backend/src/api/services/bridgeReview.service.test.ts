import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { cirrus } from "../../utils/appApiHelper";
import * as config from "../../config/config";
import { constants } from "../../config/constants";
import * as bridge from "./bridge.service";
import { getAdminBridgeReviews, prepareAdminBridgeReview } from "./bridgeReview.service";
import { buildBridgeDigestCall, parseBridgeDigest } from "../helpers/bridge.helper";

const address = "1".repeat(40), hash = "0x" + "a".repeat(64), digest = "0x" + "b".repeat(64);
const depositId = "9007199254740993123456789";
const depositKey = `eab:deposit:11155111:${address}:${depositId}`;
const deposit = { key: "11155111", key2: address, key3: depositId, value: { status: "2", stratoToken: address, stratoTokenAmount: depositId, stratoRecipient: address } };
const withdrawal = (key: string, status = "3") => ({ key, value: { status, externalChainId: "11155111", stratoToken: address, stratoSender: address, stratoTokenAmount: "100", authorizationDeadline: "1", externalTxHash: "0".repeat(64) } });

function setup(t: any) {
  const previousNodeUrl = config.nodeUrl;
  (config as any).nodeUrl = "https://strato.test";
  t.after(() => { (config as any).nodeUrl = previousNodeUrl; });
  t.mock.getter(constants, "externalAssetBridge", () => address);
  t.mock.getter(constants, "stratoNativeBridge", () => address);
  const state = { count: 2, threshold: 2, digest, approval: "0x" + "0".repeat(64), approvalReadFails: false, rpcCalls: 0, reads: [] as any[],
    tables: {
      "/BlockApps-ExternalAssetBridge-deposits": [deposit],
      "/BlockApps-ExternalAssetBridge-withdrawals": [withdrawal("1", "2"), withdrawal("2")],
      "/BlockApps-ExternalAssetBridge-withdrawalManualReviews": [{ key: "1", value: { proposalHash: hash } }],
    } as Record<string, any[]> };
  t.mock.method(cirrus, "get", async (_token: string, table: string, { params }: any) => {
    state.reads.push({ table, params });
    assert.ok(params.address, "all reads must be scoped to the configured contract");
    if (table === "/BlockApps-ExternalAssetBridge") return { data: [{ settlementVerifierThreshold: state.threshold }] };
    if (table.endsWith("-settlementAttestationCounts")) return { data: [{ value: state.count }] };
    let rows = state.tables[table] || [];
    for (const field of ["status", "bridgeStatus", "useInstantPath"]) {
      const filter = params[`value->>${field}`];
      if (filter?.startsWith("eq.")) rows = rows.filter(row => String(row.value[field]) === filter.slice(3));
      if (filter?.startsWith("in.(")) rows = rows.filter(row => filter.slice(4, -1).split(",").includes(String(row.value[field])));
    }
    if (params.key?.startsWith("in.(")) rows = rows.filter(row => params.key.slice(4, -1).split(",").includes(row.key));
    assert.ok(params.order);
    return { data: rows.slice(params.offset, params.offset + Math.min(2, params.limit)) };
  });
  t.mock.method(axios, "post", async (url: string, body: any) => {
    assert.ok(url.endsWith("/rpc"));
    assert.equal(body.method, "eth_call");
    assert.equal(body.params[0].to, `0x${address}`);
    state.rpcCalls++;
    if (body.params[0].data.startsWith("0x32ad8ee4")) {
      assert.equal(body.params[0].data, buildBridgeDigestCall("depositReviewApprovals(uint256,address,uint256)", ["11155111", `0x${address}`, BigInt("0x" + body.params[0].data.slice(-64)).toString()]));
      if (state.approvalReadFails) throw new Error("RPC unavailable");
      return { data: { result: state.approval } };
    }
    return { data: { result: state.digest } };
  });
  const operations = t.mock.method(bridge, "requestBridgeOperation", async () => { throw new Error("bridge offline"); });
  return { state, operations };
}

test("on-chain reviews and pending Safe approvals remain visible with bridge operations offline", async t => {
  const { state, operations } = setup(t);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = Array.from({ length: 5 }, (_, i) => ({ ...deposit, key3: String(i) }));
  state.tables["/BlockApps-StratoNativeBridge-withdrawals"] = [false, true].map((useInstantPath, i) => ({ key: String(i), value: { ...withdrawal("0").value, bridgeStatus: "2", useInstantPath, nativeMintProposalHash: hash } }));
  const items = await getAdminBridgeReviews("token");
  assert.equal(items.filter(item => item.kind === "deposit_review").length, 5, "server row caps must not truncate reviews");
  assert.equal(items.filter(item => item.source === "native").length, 1);
  const review = items.find(item => item.id === "eab:withdrawal:1")!;
  assert.equal(review.kind, "withdrawal_review");
  assert.equal(review.safeProposalHash, hash);
  assert.deepEqual(review.actions, [], "Safe decisions stay in Safe");
  assert.equal(operations.mock.callCount(), 0);
  assert.equal(state.rpcCalls, 5, "each pending deposit checks its on-chain approval");
  assert.ok(items.filter(item => item.kind === "deposit_review").every(item => !item.actions.includes("settle")));
});

test("deposit governance uses the contract digest and never calls the bridge", async t => {
  const { state, operations } = setup(t);
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "approve"), {
    target: address, func: "approveReviewedDeposit", args: ["11155111", `0x${address}`, depositId, digest],
  });
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "reject"), {
    target: address, func: "abortDeposit", args: ["11155111", `0x${address}`, depositId],
  });
  assert.equal(state.rpcCalls, 3);
  assert.equal(operations.mock.callCount(), 0);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = [];
  await assert.rejects(prepareAdminBridgeReview("token", depositKey, "approve"), /unavailable/);
});

test("refund votes reuse indexed quorum while the bridge service is offline", async t => {
  const { operations } = setup(t);
  assert.deepEqual(await prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund"), {
    target: address, func: "refundWithdrawal", args: ["2"],
  });
  assert.equal(operations.mock.callCount(), 0);
  await assert.rejects(prepareAdminBridgeReview("token", "eab:withdrawal:1", "reject"), /unavailable/);
});

test("only missing attestations and operator settlement contact the bridge; changed evidence blocks voting", async t => {
  const { state, operations } = setup(t);
  state.approval = digest;
  state.count = 0;
  await assert.rejects(prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund"), /bridge offline/);
  await assert.rejects(prepareAdminBridgeReview("token", depositKey, "settle"), /bridge offline/);
  assert.equal(operations.mock.callCount(), 2);
  operations.mock.mockImplementation(async () => { state.count = 2; return { digest }; });
  assert.equal((await prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund") as any).func, "refundWithdrawal");
  state.count = 0;
  operations.mock.mockImplementation(async () => { state.count = 2; state.digest = hash; return { digest }; });
  await assert.rejects(prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund"), /evidence changed/);
});

test("settlement requires a current digest-matched approval and rechecks after displaying the queue", async t => {
  const { state, operations } = setup(t);
  for (const approval of ["0x" + "0".repeat(64), hash, "invalid"]) {
    state.approval = approval;
    const item = (await getAdminBridgeReviews("token")).find(item => item.id === depositKey)!;
    assert.deepEqual(item.actions, ["approve", "reject"]);
    await assert.rejects(prepareAdminBridgeReview("token", depositKey, "settle"), /matching governance approval/);
  }
  state.approval = digest;
  state.approvalReadFails = true;
  assert.ok(!(await getAdminBridgeReviews("token")).find(item => item.id === depositKey)!.actions.includes("settle"));
  await assert.rejects(prepareAdminBridgeReview("token", depositKey, "settle"), /matching governance approval/);
  state.approvalReadFails = false;
  assert.ok((await getAdminBridgeReviews("token")).find(item => item.id === depositKey)!.actions.includes("settle"));
  state.digest = hash;
  await assert.rejects(prepareAdminBridgeReview("token", depositKey, "settle"), /matching governance approval/);
  assert.equal(operations.mock.callCount(), 0, "unapproved or changed deposits must not invoke the bridge");
  state.approval = hash;
  operations.mock.mockImplementation(async () => ({ transactionHash: "settled-tx" }));
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "settle"), { transactionHash: "settled-tx" });
  assert.equal(operations.mock.callCount(), 1);
});

test("contract digest ABI calls preserve full identifiers and reject malformed results", () => {
  const word = BigInt(depositId).toString(16).padStart(64, "0");
  assert.equal(buildBridgeDigestCall("getWithdrawalRefundDigest(uint256)", [depositId]), `0x49a7c4f5${word}`);
  assert.equal(buildBridgeDigestCall("getReviewedDepositDigest(uint256,address,uint256)", ["1", `0x${address}`, depositId]),
    `0x636ae02a${"1".padStart(64, "0")}${address.padStart(64, "0")}${word}`);
  assert.equal(buildBridgeDigestCall("depositReviewApprovals(uint256,address,uint256)", ["1", `0x${address}`, depositId]),
    `0x32ad8ee4${"1".padStart(64, "0")}${address.padStart(64, "0")}${word}`);
  assert.throws(() => buildBridgeDigestCall("refundWithdrawal(uint256)", ["1"]), /Invalid/);
  assert.throws(() => buildBridgeDigestCall("getWithdrawalRefundDigest(uint256)", [(1n << 256n).toString()]), /Invalid/);
  for (const result of [undefined, "0x", "0x1234", "z".repeat(66)]) assert.throws(() => parseBridgeDigest({ result }), /Unable to read/);
  assert.throws(() => parseBridgeDigest({ result: digest, error: { message: "reverted" } }), /Unable to read/);
  assert.equal(parseBridgeDigest({ result: digest }), digest);
});
