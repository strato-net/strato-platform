import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { cirrus } from "../../utils/appApiHelper";
import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { getAdminBridgePolicies, getAdminBridgeReviews, prepareAdminBridgeReview } from "./bridgeReview.service";
import { parseBridgePolicyJson, buildBridgePolicyRows, buildBridgeDigestCall, parseBridgeDigest, parseBridgeReviewIssue } from "../helpers/bridge.helper";

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
      "/BlockApps-ExternalAssetBridge-chains": [{ key: "11155111", value: { vault: address } }],
      "/BlockApps-ExternalAssetBridge-withdrawals": [withdrawal("1", "2"), withdrawal("2")],
      "/BlockApps-ExternalAssetBridge-withdrawalManualReviews": [{ key: "1", value: { proposalHash: hash } }],
    } as Record<string, any[]> };
  t.mock.method(cirrus, "get", async (_token: string, table: string, { params }: any) => {
    state.reads.push({ table, params });
    if (table.endsWith("-depositReviewApprovals")) {
      assert.equal(params.address, `eq.${address}`);
      assert.match(params.or, /key\.eq\.11155111/);
      assert.match(params.or, new RegExp(`key2\\.eq\\.${address}`));
      if (state.approvalReadFails) throw new Error("Cirrus unavailable");
      return { data: params.offset ? [] : [{ key: "11155111", key2: address, key3: depositId, value: state.approval }] };
    }
    assert.ok(params.address, "all reads must be scoped to the configured contract");
    if (table === "/BlockApps-ExternalAssetBridge") return { data: state.tables[table] || [{ settlementVerifierThreshold: state.threshold }] };
    if (table.endsWith("-settlementAttestationCounts")) return { data: [{ value: state.count }] };
    let rows = state.tables[table] || [];
    for (const field of ["status", "bridgeStatus", "useInstantPath"]) {
      const filter = params[`value->>${field}`];
      if (filter?.startsWith("eq.")) rows = rows.filter(row => String(row.value[field]) === filter.slice(3));
      if (filter?.startsWith("in.(")) rows = rows.filter(row => filter.slice(4, -1).split(",").includes(String(row.value[field])));
    }
    for (const field of ["key", "key2", "key3"]) {
      if (params[field]?.startsWith("eq.")) rows = rows.filter(row => String(row[field]) === params[field].slice(3));
    }
    if (params.key?.startsWith("in.(")) rows = rows.filter(row => params.key.slice(4, -1).split(",").includes(row.key));
    if ([`/${constants.AdminRegistry}`, `/${constants.StratoNativeBridge}`, `/${constants.StratoNativeCustodyVault}`].includes(table)) return { data: rows };
    assert.ok(params.order);
    return { data: rows.slice(params.offset, params.offset + Math.min(2, params.limit)) };
  });
  t.mock.method(axios, "post", async (url: string, body: any) => {
    assert.ok(url.endsWith("/rpc"));
    assert.equal(body.method, "eth_call");
    assert.equal(body.params[0].to, `0x${address}`);
    state.rpcCalls++;
    return { data: { result: state.digest } };
  });
  const operations = t.mock.method(axios, "request", async () => { throw new Error("bridge offline"); });
  return { state, operations };
}

test("on-chain reviews and pending Safe approvals remain visible with bridge operations offline", async t => {
  const { state, operations } = setup(t);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = Array.from({ length: 5 }, (_, i) => ({ ...deposit, key3: String(i) }));
  state.tables["/BlockApps-StratoNativeBridge-withdrawals"] = [false, true].map((useInstantPath, i) => ({ key: String(i), value: { ...withdrawal("0").value, bridgeStatus: "2", useInstantPath, nativeMintProposalHash: hash } }));
  const items = await getAdminBridgeReviews("token");
  assert.equal(items.filter(item => item.kind === "deposit_review").length, 5, "server row caps must not truncate reviews");
  assert.equal(state.reads.filter(read => read.table.endsWith("-depositReviewApprovals")).length, 2,
    "all deposit approvals are fetched in one paginated batch");
  assert.equal(items.filter(item => item.source === "native").length, 2);
  const instant = items.find(item => item.id === "native:withdrawal:1")!;
  assert.deepEqual(instant.actions, ["cancel_withdrawal"], "instant withdrawals remain available for governance cancellation");
  assert.equal(instant.scenario, "Blocked instant withdrawal");
  assert.equal(instant.useInstantPath, true);
  assert.ok(state.reads.every(read => !read.table.includes("MercataBridge")), "legacy bridge records do not belong in the action queue");
  const review = items.find(item => item.id === "eab:withdrawal:1")!;
  assert.equal(review.kind, "withdrawal_review");
  assert.equal(review.safeProposalHash, hash);
  assert.deepEqual(review.actions, [], "Safe decisions stay in Safe");
  assert.equal(operations.mock.callCount(), 0);
  assert.equal(state.rpcCalls, 1, "only the refund needs a digest read");
  assert.ok(items.filter(item => item.kind === "deposit_review").every(item => item.actions.every(action => action === "approve" || action === "refund" || action === "reject")));
});

test("rejected and reopened deposits remain visible until recovery completes", async t => {
  const { state, operations } = setup(t);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = ["7", "0", "0".repeat(40), "4"].map((status, i) => ({
    ...deposit, key3: String(i), value: { ...deposit.value, status, externalTxHash: hash },
  }));
  state.tables["/BlockApps-StratoNativeBridge-deposits"] = ["2", "4", "3"].map((bridgeStatus, i) => ({
    key: String(i), value: { ...deposit.value, bridgeStatus },
  }));
  const items = await getAdminBridgeReviews("token");
  const deposits = items.filter(item => item.kind.startsWith("deposit"));
  assert.equal(deposits.length, 5);
  assert.equal(deposits.filter(item => item.kind === "deposit_recovery").length, 4);
  assert.equal(deposits.filter(item => item.recoveryStatus === "reopened").length, 2);
  assert.ok(deposits.filter(item => item.recoveryStatus === "reopened").every(item => !item.actions.length));
  assert.ok(deposits.filter(item => item.recoveryStatus === "rejected").every(item => item.actions.includes("approve") && item.actions.includes("refund")));
  assert.equal(operations.mock.callCount(), 0);
});

test("deposit governance uses the contract digest and never calls the bridge", async t => {
  const { state, operations } = setup(t);
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "approve"), {
    target: address, func: "approveReviewedDeposit", args: ["11155111", `0x${address}`, depositId, digest],
  });
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "refund"), {
    target: address, func: "requestDepositRefund", args: ["11155111", `0x${address}`, depositId, `0x${address}`],
  });
  assert.equal(state.rpcCalls, 1, "point preparation reads only the selected deposit digest");
  assert.ok(state.reads.every(read => !read.table.endsWith("-withdrawals") && !read.table.endsWith("-withdrawalManualReviews")),
    "deposit vote preparation must not rebuild unrelated queues");
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

test("refunds wait for indexed attestations without calling the bridge", async t => {
  const { state, operations } = setup(t);
  state.count = 0;
  let item = (await getAdminBridgeReviews("token")).find(item => item.id === "eab:withdrawal:2")!;
  assert.equal(item.refundStatus, "pending");
  await assert.rejects(prepareAdminBridgeReview("token", item.id, "refund"), /Awaiting verifier attestations/);
  assert.equal(operations.mock.callCount(), 0);
  state.count = 2;
  item = (await getAdminBridgeReviews("token")).find(item => item.id === "eab:withdrawal:2")!;
  assert.equal(item.refundStatus, "ready");
  assert.equal((await prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund")).func, "refundWithdrawal");
  state.threshold = 0;
  assert.equal((await getAdminBridgeReviews("token")).find(item => item.id === "eab:withdrawal:2")!.refundStatus, "unavailable");
  await assert.rejects(prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund"), /unavailable/);
});

test("approved deposits retain their approval status but never expose manual settlement", async t => {
  const { state, operations } = setup(t);
  for (const approval of ["0x" + "0".repeat(64), hash, "invalid", digest]) {
    state.approval = approval;
    const item = (await getAdminBridgeReviews("token")).find(item => item.id === depositKey)!;
    assert.deepEqual(item.actions, ["approve", "refund", "reject"]);
    assert.equal(item.approvalStatus, approval === digest ? "approved" : "pending");
    await assert.rejects(prepareAdminBridgeReview("token", depositKey, "settle"), /automatically/);
  }
  state.approvalReadFails = true;
  assert.equal((await getAdminBridgeReviews("token")).find(item => item.id === depositKey)!.approvalStatus, "unavailable");
  assert.equal(operations.mock.callCount(), 0);
});

test("refund preparation rejects evidence that changes before returning governance arguments", async t => {
  const { state, operations } = setup(t);
  let calls = 0;
  t.mock.method(axios, "post", async () => ({ data: { result: ++calls < 2 ? state.digest : hash } }));
  await assert.rejects(prepareAdminBridgeReview("token", "eab:withdrawal:2", "refund"), /evidence changed/);
  assert.equal(operations.mock.callCount(), 0);
});

test("contract digest ABI calls preserve full identifiers and reject malformed results", () => {
  const word = BigInt(depositId).toString(16).padStart(64, "0");
  assert.equal(buildBridgeDigestCall("getWithdrawalRefundDigest(uint256)", [depositId]), `0x49a7c4f5${word}`);
  assert.equal(buildBridgeDigestCall("getReviewedDepositDigest(uint256,address,uint256)", ["1", `0x${address}`, depositId]),
    `0x636ae02a${"1".padStart(64, "0")}${address.padStart(64, "0")}${word}`);
  assert.throws(() => buildBridgeDigestCall("depositReviewApprovals(uint256,address,uint256)", ["1", `0x${address}`, depositId]), /Invalid/);
  assert.throws(() => buildBridgeDigestCall("refundWithdrawal(uint256)", ["1"]), /Invalid/);
  assert.throws(() => buildBridgeDigestCall("getWithdrawalRefundDigest(uint256)", [(1n << 256n).toString()]), /Invalid/);
  for (const result of [undefined, "0x", "0x1234", "z".repeat(66)]) assert.throws(() => parseBridgeDigest({ result }), /Unable to read/);
  assert.throws(() => parseBridgeDigest({ result: digest, error: { message: "reverted" } }), /Unable to read/);
  assert.equal(parseBridgeDigest({ result: digest }), digest);
});

test("bridge governance parses exact large identifiers and rejects malformed arguments", () => {
  assert.deepEqual(parseBridgeReviewIssue("approveReviewedDeposit", `[11155111,"0x${address}",${depositId},"${digest}"]`), { id: depositKey, action: "approve", digest });
  assert.deepEqual(parseBridgeReviewIssue("refundWithdrawal", `[${depositId}]`), { id: `eab:withdrawal:${depositId}`, action: "refund" });
  assert.throws(() => parseBridgeReviewIssue("refundWithdrawal", [Number(depositId)]), /Invalid/);
  assert.throws(() => parseBridgeReviewIssue("approveReviewedDeposit", ["1", address, "2"]), /arguments/);
  assert.equal(parseBridgeReviewIssue("setOwner", "[]"), undefined);
});

test("review progress reads current votes, exact deposit digest, and per-function thresholds", async t => {
  const { state, operations } = setup(t);
  const registry = `/${constants.AdminRegistry}`;
  const issueId = "c".repeat(64), oldId = "d".repeat(64), refundId = "e".repeat(64);
  state.tables[registry] = [{ defaultVotingThresholdBps: 6000 }];
  state.tables[`${registry}-admins`] = [address, "2".repeat(40), "3".repeat(40), "0".repeat(40), { length: 3 }].map((value, i) => ({ key: String(i), value }));
  state.tables[`${registry}-votingThresholds`] = [{ key: address, key2: "approveReviewedDeposit", value: "0" }, { key: address, key2: "refundWithdrawal", value: "10000" }];
  state.tables[`${registry}-currentIssues`] = [issueId, oldId, refundId].map(key => ({ key, value: true }));
  state.tables[`${registry}-IssueCreated`] = [
    { issueId, target: address, func: "approveReviewedDeposit", args: `[11155111,"${address}",${depositId},"${digest}"]` },
    { issueId: oldId, target: address, func: "approveReviewedDeposit", args: `[11155111,"${address}",${depositId},"${hash}"]` },
    { issueId: refundId, target: address, func: "refundWithdrawal", args: "[2]" },
  ];
  state.tables[`${registry}-votes`] = [
    { key: issueId, key2: "0", value: address }, { key: issueId, key2: "1", value: "4".repeat(40) },
    { key: issueId, key2: "length", value: { length: 2 } }, { key: oldId, key2: "0", value: "3".repeat(40) },
    { key: refundId, key2: "0", value: "2".repeat(40) },
  ];
  let items = await getAdminBridgeReviews("token", `0x${address}`);
  let reviewed = items.find(item => item.id === depositKey)!;
  assert.equal(reviewed.governanceStatus, "available");
  assert.deepEqual(reviewed.governance?.approve, { issueId, votesCast: 2, votesRequired: 2, hasVoted: true });
  assert.equal(reviewed.approvalStatus, "pending", "quorum alone cannot claim execution or approval");
  assert.equal(items.find(item => item.id === "eab:withdrawal:2")?.governance?.refund?.votesRequired, 3);
  assert.equal(operations.mock.callCount(), 0);
  assert.equal(state.rpcCalls, 2, "approval and vote matching share one digest read, plus the refund digest");
  state.approval = digest;
  items = await getAdminBridgeReviews("token", "3".repeat(40));
  reviewed = items.find(item => item.id === depositKey)!;
  assert.equal(reviewed.approvalStatus, "approved");
  assert.equal(reviewed.governance?.approve?.hasVoted, false, "vote state is personalized");
  state.tables[registry] = [];
  reviewed = (await getAdminBridgeReviews("token", address)).find(item => item.id === depositKey)!;
  assert.equal(reviewed.governanceStatus, "unavailable");
  assert.equal(reviewed.governance, undefined);
  assert.equal(reviewed.approvalStatus, "approved", "governance metadata failure cannot hide verified approval");
});

test("policy overview reads only Cirrus, paginates all routes, and uses the custody address in storage", async t => {
  const { state, operations } = setup(t);
  const token = "6".repeat(40), custody = "7".repeat(40);
  state.tables["/BlockApps-ExternalAssetBridge"] = [{ depositsPaused: false, withdrawalsPaused: true }];
  state.tables["/BlockApps-ExternalAssetBridge-routes"] = Array.from({ length: 3 }, (_, i) => ({ key: String(i).repeat(40), key2: "11155111", key3: token, value: {
    depositsEnabled: true, withdrawalsEnabled: false, externalSymbol: "USDC", externalDecimals: "6", maxPerWithdrawal: "2000000", manualReviewThreshold: "1000000",
  } }));
  state.tables["/BlockApps-ExternalAssetBridge-chains"] = [{ key: "11155111", value: { enabled: true } }];
  state.tables["/BlockApps-ExternalAssetBridge-mintPolicies"] = [{ key: token, value: { capacity: depositId, consumed: "1", refillRate: "100", lastRefillAt: "1000" } }];
  state.tables["/BlockApps-ExternalAssetBridge-nativeAutoRouteEnabled"] = [{ key: "11155111", key2: token, value: true }];
  state.tables["/BlockApps-StratoNativeBridge"] = [{ depositsPaused: false, withdrawalsPaused: false, custodyVault: `0x${custody}` }];
  state.tables["/BlockApps-StratoNativeBridge-assets"] = [{ key: token, key2: 11155111, value: { enabled: true, representationToken: address, externalSymbol: "USDST", maxPerWithdrawal: "0", instantWithdrawalThreshold: "50" } }];
  state.tables["/BlockApps-StratoNativeBridge-tokenBridgeConfigs"] = [{ key: token, value: { depositsDisabled: false, withdrawalsDisabled: true, maxOutstandingWithdrawal: "100" } }];
  state.tables["/BlockApps-StratoNativeCustodyVault"] = [{ paused: false }];
  state.tables["/BlockApps-StratoNativeCustodyVault-lockedBalance"] = [{ key: token, value: "80" }];
  state.tables["/BlockApps-Token"] = [{ address: token, _symbol: "USDST", customDecimals: "18" }];
  const overview = await getAdminBridgePolicies("token");
  assert.equal(overview.items.length, 5);
  assert.equal(overview.items.filter(item => item.source === "eab" && item.kind === "Route").length, 3);
  const field = (item: any, label: string) => item.fields.find((entry: any) => entry.label === label);
  const mint = overview.items.find(item => item.kind === "Mint policy")!;
  assert.equal(field(mint, "Remaining at last refill").value, (BigInt(depositId) - 1n).toString(), "do not extrapolate accrual from local time");
  const eth = overview.items.find(item => item.externalToken === "0".repeat(40))!;
  assert.equal(field(eth, "Auto-route configured").value, "Yes", "native ETH uses its distinct EAB routing mapping");
  assert.equal(field(eth, "Maximum per withdrawal").decimals, 6);
  assert.equal(field(eth, "Maximum per withdrawal").unit, "USDC");
  const native = overview.items.find(item => item.source === "native")!;
  assert.equal(native.chainId, "11155111");
  assert.equal(field(native, "Remaining aggregate allowance").value, "20");
  assert.equal(field(native, "Maximum per withdrawal").value, "No route cap");
  assert.ok(state.reads.filter(read => read.table.includes("CustodyVault")).every(read => read.params.address === `eq.${custody}`));
  assert.equal(state.rpcCalls, 0);
  assert.equal(operations.mock.callCount(), 0);
});

test("policy projection distinguishes unconfigured, zero allowance, unknown units, and missing custody state", () => {
  const base: any = { eab: {}, native: {}, routes: [], chains: [], mintPolicies: [], actions: [], ethAutoRoute: [], nativeConfigs: [], nativeAutoRoute: [], locked: [], tokens: [],
    nativeAssets: [{ key: address, key2: "1", value: { enabled: false, representationToken: address, maxPerWithdrawal: "0", instantWithdrawalThreshold: "0" } }] };
  const fields = (records: any) => new Map(buildBridgePolicyRows(records).find(row => row.source === "native")!.fields.map(field => [field.label, field]));
  let result = fields(base);
  assert.equal(result.get("Locked balance (all networks)")!.value, null, "an absent custody vault must not claim zero usage");
  assert.equal(result.get("Instant withdrawal threshold")!.value, "Instant withdrawals disabled");
  assert.equal(result.get("Remaining aggregate allowance")!.value, "No aggregate cap");
  result = fields({ ...base, custody: { paused: false }, nativeConfigs: [{ key: address, value: { maxOutstandingWithdrawal: "100" } }], locked: [{ key: address, value: "101" }] });
  assert.equal(result.get("Remaining aggregate allowance")!.value, "0", "zero remaining does not mean uncapped");
  assert.equal(result.get("Outstanding limit (shared across networks)")!.decimals, undefined, "missing metadata must show raw units");
  result = fields({ ...base, nativeConfigs: [{ key: address, value: { maxOutstandingWithdrawal: Number.MAX_SAFE_INTEGER + 1 } }] });
  assert.equal(result.get("Outstanding limit (shared across networks)")!.value, null);
  const unconfiguredMint = buildBridgePolicyRows({ ...base, routes: [{ key: address, key2: "1", key3: address, value: {} }] }).find(row => row.kind === "Mint policy")!;
  assert.equal(unconfiguredMint.fields[0].value, "Not configured — minting blocked");
});


test("Cirrus policy JSON preserves integer precision before projecting limits", () => {
  const parsed: any = parseBridgePolicyJson('[{"key":11155111,"value":{"capacity":9007199254740993123456789}}]');
  assert.equal(parsed[0].key, 11155111);
  assert.equal(parsed[0].value.capacity, depositId);
});

test("deposit recovery votes offer delivery or an irreversible return and disappear after refund completion", async t => {
  const { state, operations } = setup(t);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = [{ ...deposit, value: { ...deposit.value, status: "7", externalTxHash: hash } }];
  const nativeId = "d".repeat(64);
  state.tables["/BlockApps-StratoNativeBridge-deposits"] = [{ key: nativeId, value: { ...deposit.value, bridgeStatus: "4", externalChainId: "11155111" } }];
  assert.equal((await prepareAdminBridgeReview("token", depositKey, "approve")).func, "authorizeDepositDelivery");
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "refund"), {
    target: address, func: "requestDepositRefund", args: ["11155111", `0x${address}`, depositId, `0x${address}`],
  });
  const nativeKey = `native:deposit:${nativeId}:`;
  assert.deepEqual(await prepareAdminBridgeReview("token", nativeKey, "approve"), { target: address, func: "reopenDeposit", args: [nativeId] });
  assert.deepEqual(await prepareAdminBridgeReview("token", nativeKey, "refund"), { target: address, func: "requestDepositRefund", args: [nativeId] });
  state.tables["/BlockApps-ExternalAssetBridge-deposits"][0].value.status = "8";
  state.tables["/BlockApps-StratoNativeBridge-deposits"][0].value.bridgeStatus = "7";
  state.tables["/BlockApps-StratoNativeBridge-depositRefundProposals"] = [{ key: nativeId, value: hash }];
  const items = await getAdminBridgeReviews("token");
  assert.ok(items.filter(item => item.kind === "deposit_recovery").every(item => item.recoveryStatus === "refund_pending" && !item.actions.length));
  assert.equal(items.find(item => item.id === nativeKey)?.safeProposalHash, hash);
  await assert.rejects(prepareAdminBridgeReview("token", depositKey, "approve"), /unavailable/);
  await assert.rejects(prepareAdminBridgeReview("token", nativeKey, "approve"), /unavailable/);
  state.tables["/BlockApps-ExternalAssetBridge-deposits"][0].value.status = "6";
  state.tables["/BlockApps-StratoNativeBridge-deposits"][0].value.bridgeStatus = "8";
  assert.ok(!(await getAdminBridgeReviews("token")).some(item => item.id === nativeKey || item.id === depositKey));
  assert.equal(operations.mock.callCount(), 0);
});

test("recovery vote parsing binds the correct contract shape and preserves large identities", () => {
  assert.deepEqual(parseBridgeReviewIssue("authorizeDepositDelivery", ["11155111", address, depositId]), { id: depositKey, action: "approve" });
  assert.deepEqual(parseBridgeReviewIssue("requestDepositRefund", ["11155111", address, depositId, address]), { id: depositKey, action: "refund", vault: address });
  assert.throws(() => parseBridgeReviewIssue("authorizeDepositDelivery", ["1", address, Number(depositId)]), /Invalid/);
  assert.throws(() => parseBridgeReviewIssue("reopenDeposit", ["1", address, "1"]), /arguments/);
  assert.throws(() => parseBridgeReviewIssue("authorizeDepositDelivery", ["a".repeat(64)]), /arguments/);
});

test("native refund confirmation requires recorded evidence and tracks votes for that exact hash", async t => {
  const { state, operations } = setup(t);
  const id = "e".repeat(64), key = `native:deposit:${id}:`;
  state.tables["/BlockApps-StratoNativeBridge-deposits"] = [{ key: id, value: {
    bridgeStatus: "7", externalChainId: "11155111", stratoToken: address,
    stratoTokenAmount: "100", stratoRecipient: address, externalSender: address, representationToken: address,
    externalBridge: address, externalRedemptionId: "9007199254740993123456789",
  } }];
  await assert.rejects(prepareAdminBridgeReview("token", key, "confirm_refund"), /unavailable/);
  state.tables["/BlockApps-StratoNativeBridge-depositRefundEvidence"] = [{ key: id, value: hash }];
  const vote = await prepareAdminBridgeReview("token", key, "confirm_refund");
  assert.deepEqual(vote, { target: address, func: "finalizeDepositRefund", args: [id, hash] });
  assert.deepEqual(parseBridgeReviewIssue(vote.func, vote.args), { id: key, action: "confirm_refund", refundEvidenceHash: hash.slice(2) });
  assert.throws(() => parseBridgeReviewIssue(vote.func, [id, "0x1234"]), /Invalid/);
  assert.throws(() => parseBridgeReviewIssue(vote.func, [id, "0".repeat(64)]), /Invalid/);
  const registry = `/${constants.AdminRegistry}`, issueId = "f".repeat(64);
  state.tables[registry] = [{ defaultVotingThresholdBps: 10000 }];
  state.tables[`${registry}-admins`] = [{ key: "0", value: address }];
  state.tables[`${registry}-currentIssues`] = [{ key: issueId, value: true }];
  state.tables[`${registry}-IssueCreated`] = [{ issueId, target: address, func: vote.func, args: vote.args }];
  state.tables[`${registry}-votes`] = [{ key: issueId, key2: "0", value: address }];
  let item = (await getAdminBridgeReviews("token", address)).find(item => item.id === key)!;
  assert.equal(item.governance?.confirm_refund?.hasVoted, true);
  assert.equal(item.refundRedemptionId, "9007199254740993123456789");
  assert.equal(item.refundBridge, address);
  assert.equal(item.recoveryStatus, "refund_pending", "votes are not proof of completed finalization");
  state.tables["/BlockApps-StratoNativeBridge-depositRefundEvidence"][0].value = digest;
  item = (await getAdminBridgeReviews("token", address)).find(item => item.id === key)!;
  assert.equal(item.governance?.confirm_refund?.votesCast, 0, "old proof votes cannot approve a new hash");
  state.tables["/BlockApps-StratoNativeBridge-deposits"][0].value.bridgeStatus = "8";
  await assert.rejects(prepareAdminBridgeReview("token", key, "confirm_refund"), /unavailable/);
  assert.equal(operations.mock.callCount(), 0, "preparation must not submit transactions");
});

test("no-funds rejection uses a distinct governance method and closes both bridge queues", async t => {
  const { state } = setup(t);
  assert.deepEqual(await prepareAdminBridgeReview("token", depositKey, "reject"), {
    target: address, func: "rejectDepositNoFunds", args: ["11155111", `0x${address}`, depositId],
  });
  assert.deepEqual(parseBridgeReviewIssue("rejectDepositNoFunds", ["11155111", address, depositId]), { id: depositKey, action: "reject" });
  const nativeId = "c".repeat(64);
  state.tables["/BlockApps-StratoNativeBridge-deposits"] = [{ key: nativeId, value: { ...deposit.value, bridgeStatus: "2" } }];
  assert.deepEqual(await prepareAdminBridgeReview("token", `native:deposit:${nativeId}:`, "reject"), {
    target: address, func: "rejectDepositNoFunds", args: [nativeId],
  });
  assert.deepEqual(parseBridgeReviewIssue("rejectDepositNoFunds", [nativeId]), { id: `native:deposit:${nativeId}:`, action: "reject" });
  state.tables["/BlockApps-ExternalAssetBridge-deposits"] = [{ ...deposit, value: { ...deposit.value, status: "9" } }];
  state.tables["/BlockApps-StratoNativeBridge-deposits"] = [{ key: nativeId, value: { ...deposit.value, bridgeStatus: "9" } }];
  assert.ok(!(await getAdminBridgeReviews("token")).some(item => item.kind.startsWith("deposit")));
  for (const action of ["approve", "refund", "reject"]) await assert.rejects(prepareAdminBridgeReview("token", depositKey, action), /unavailable/);
});

test("native cancellation queue waits for evidence and binds the final refund vote to its hash", async t => {
  const { state } = setup(t);
  const key = "native:withdrawal:17";
  const w = { key: "17", value: { ...withdrawal("17").value, bridgeStatus: "2", useInstantPath: false, nativeMintProposalHash: hash } };
  state.tables["/BlockApps-StratoNativeBridge-withdrawals"] = [w];
  assert.deepEqual(await prepareAdminBridgeReview("token", key, "cancel_withdrawal"), { target: address, func: "requestWithdrawalCancellation", args: ["17"] });
  w.value.bridgeStatus = "10";
  await assert.rejects(prepareAdminBridgeReview("token", key, "confirm_cancellation"), /unavailable/);
  Object.assign(w.value, { cancellationTxHash: hash });
  assert.deepEqual(await prepareAdminBridgeReview("token", key, "confirm_cancellation"), { target: address, func: "refundCanceledWithdrawal", args: ["17", hash] });
  assert.deepEqual(parseBridgeReviewIssue("refundCanceledWithdrawal", ["17", hash]), { id: key, action: "confirm_cancellation", refundEvidenceHash: hash.replace(/^0x/, "") });
  await assert.rejects(prepareAdminBridgeReview("token", key, "refund"), /unavailable/);
});
