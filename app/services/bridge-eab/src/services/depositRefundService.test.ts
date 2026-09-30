import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Interface, Wallet, keccak256, toUtf8Bytes } from "ethers";

for (const name of ["BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL", "EXTERNAL_ASSET_BRIDGE_ADDRESS", "STRATO_NATIVE_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "SENDGRID_API_KEY", "STRATO_NODE_URL", "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD",
  "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID", "RELAYER_OPENID_DISCOVERY_URL", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION"])
  process.env[name] ||= "1".repeat(40);
process.env.SENDGRID_API_KEY = "SG.test.test";
process.env.CHAIN_1_DEPOSIT_CONFIRMATIONS = "12";
const addr = (n: string) => `0x${n.repeat(40)}`;
const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`;

test("EAB restart recovers the external refund and waits for verifier proof before finalizing", async t => {
  const rpc = await import("./rpcService"), cirrus = await import("./cirrusService"), event = await import("./depositEventService");
  const bridge = await import("./bridgeService"), attestation = await import("./settlementAttestationService"), strato = await import("../utils/stratoHelper");
  const { DEPOSIT_REFUND_ABI } = await import("../config/bridgeAbi");
  const { recoverExternalDepositRefund } = await import("./depositRefundService");
  const iface = new Interface(DEPOSIT_REFUND_ABI);
  const record = { externalTxHash: blockHash, externalToken: addr("3"), externalSender: addr("4"), externalTokenAmount: "100" };
  t.mock.method(cirrus, "getRecordedDepositReviews", async () => [record] as any);
  t.mock.method(cirrus, "getDepositRefundVault", async () => addr("2"));
  t.mock.method(event, "recoverDepositObservation", () => ({ ...record, externalChainId: 1, depositRouter: addr("5"), depositId: "7", targetStratoToken: addr("6") }) as any);
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => new Map([[blockHash, {}]]) as any);
  t.mock.method(bridge, "getStratoNetworkId", async () => 90071992547409939999n);
  let logs = [{ transactionHash: hash }];
  const provider = { getBlock: async () => ({ timestamp: 1000, number: 112 }), getLogs: async () => logs,
    call: async ({ data }: any) => {
      const name = iface.parseTransaction({ data })!.name;
      const values: Record<string, any> = { signerSetVersion: 1, maxAuthorizationValiditySeconds: 1800, depositRefundId: blockHash, refundedDeposits: true };
      return iface.encodeFunctionResult(name, [values[name]]);
    } };
  t.mock.method(rpc, "getChainProvider", () => provider as any);
  let confirmed = false;
  t.mock.method(attestation, "requestVerifierQuorum", async (_chain, route, payload: any) => {
    assert.equal(route, "/v1/attest-deposit-refund"); assert.equal(payload.refundTxHash, hash);
    assert.equal(payload.authorization.recipient, record.externalSender);
    if (!confirmed) throw new Error("confirmations pending");
    return {} as any;
  });
  const execute = t.mock.method(strato, "execute", async (call: any) => {
    assert.equal(call.method, "finalizeDepositRefund"); assert.equal(call.args.refundTxHash, hash); return "finalized";
  });
  await assert.rejects(recoverExternalDepositRefund(1, addr("5"), "7"), /confirmations pending/);
  assert.equal(execute.mock.callCount(), 0);
  confirmed = true;
  await recoverExternalDepositRefund(1, addr("5"), "7");
  assert.equal(execute.mock.callCount(), 1);
  logs = [];
  await assert.rejects(recoverExternalDepositRefund(1, addr("5"), "7"), /event not found/);
  assert.equal(execute.mock.callCount(), 1, "a replay flag alone is not refund evidence");
});

test("native Safe refunds survive restart, deduplicate proposals, replace stale nonces and verify completion", async t => {
  const rpc = await import("./rpcService"), cirrus = await import("./cirrusService"), bridgeService = await import("./bridgeService");
  const native = await import("./nativeVerificationService"), configModule = await import("../config");
  const helper = await import("../utils/safeHelper"), strato = await import("../utils/stratoHelper");
  const { NATIVE_REFUND_ABI } = await import("../config/bridgeAbi");
  const { recoverNativeDepositRefund } = await import("./depositRefundService");
  const directory = await mkdtemp(path.join(tmpdir(), "native-refund-test-")), cwd = process.cwd();
  process.chdir(directory); t.after(async () => { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); });
  const wallet = Wallet.createRandom();
  t.mock.method(configModule, "getNativeBridgePrivateKeys", () => [{ privateKey: wallet.privateKey, address: wallet.address }] as any);
  t.mock.method(bridgeService, "getStratoNetworkId", async () => 90071992547409939999n);
  let originalVerified = true;
  const d: any = { depositId: "d".repeat(64), bridgeStatus: "7", externalChainId: "1", externalBridge: addr("2"),
    externalRedemptionId: "7", representationToken: addr("3"), externalSender: addr("4"), stratoTokenAmount: "100" };
  t.mock.method(native, "verifyNativeRedemptionsBatch", async () => new Map([[d.depositId, originalVerified]]));
  const iface = new Interface(NATIVE_REFUND_ABI);
  let refunded = false, timestamp = 1000, head = 111, currentNonce = 0, recorded: string | undefined;
  const provider = { getBlock: async () => ({ timestamp, number: 112 }), getLogs: async () => [{ transactionHash: hash }],
    call: async ({ data }: any) => {
      const parsed = iface.parseTransaction({ data })!;
      const value = parsed.name === "hasRole" ? parsed.args[1].toLowerCase() === addr("1")
        : parsed.name === "refundedRedemptions" ? refunded : 1800;
      return iface.encodeFunctionResult(parsed.name, [value]);
    } };
  t.mock.method(rpc, "getChainProvider", () => provider as any);
  const published = new Set<string>(); let proposals = 0;
  t.mock.method(helper, "initializeSafeForChain", async () => ({
    apiKit: { getNextNonce: async () => currentNonce, getTransaction: async (id: string) => {
      if (!published.has(id)) throw Object.assign(new Error("Not found"), { status: 404 }); return {};
    }, proposeTransaction: async ({ safeTxHash }: any) => { proposals++; published.add(safeTxHash); } },
    protocolKit: { getNonce: async () => currentNonce,
      createTransaction: async ({ transactions, options }: any) => ({ data: { ...transactions[0], nonce: options.nonce } }),
      getTransactionHash: async ({ data }: any) => keccak256(toUtf8Bytes(JSON.stringify(data))),
      signHash: async () => ({ data: "safe-signature" }) },
  }) as any);
  t.mock.method(cirrus, "getNativeDepositRefundProposal", async () => recorded);
  let evidenceRecords = 0, records = 0, evidence: string | undefined;
  t.mock.method(cirrus, "getNativeDepositRefundEvidence", async () => evidence);
  t.mock.method(strato, "execute", async ({ method, args }: any) => {
    if (method === "recordDepositRefundProposal") { records++; recorded = args.proposalHash; }
    else { assert.equal(method, "recordDepositRefundEvidence"); assert.equal(args.refundTxHash, hash); evidence = args.refundTxHash; evidenceRecords++; }
    return "done";
  });
  const refundEvent = { address: d.externalBridge, ...iface.encodeEventLog(iface.getEvent("RedemptionRefunded")!, [7, d.representationToken, d.externalSender, 100]) };
  let receipt: any = { transactionHash: hash, blockHash, status: "0x1", blockNumber: "0x64", logs: [refundEvent] };
  t.mock.method(rpc, "getTransactionReceiptsBatch", async () => new Map([[hash, receipt]]));
  t.mock.method(rpc, "getVerificationBlockNumber", async () => head);
  originalVerified = false;
  await assert.rejects(recoverNativeDepositRefund(d), /original burn/); assert.equal(proposals, 0);
  originalVerified = true;
  await recoverNativeDepositRefund(d);
  await recoverNativeDepositRefund(d);
  assert.equal(proposals, 1); assert.equal(records, 1); assert.equal(evidenceRecords, 0);
  currentNonce = 1;
  await recoverNativeDepositRefund(d); assert.equal(proposals, 2);
  timestamp = 3000;
  await recoverNativeDepositRefund(d); assert.equal(proposals, 3);
  const journal = path.join(directory, "data/native-refunds", `1-${d.externalBridge}-7.json`);
  const saved = await readFile(journal, "utf8"), tampered = JSON.parse(saved);
  tampered.data.value = "1"; await writeFile(journal, JSON.stringify(tampered));
  await assert.rejects(recoverNativeDepositRefund(d), /Invalid native refund proposal journal/);
  await writeFile(journal, saved);
  refunded = true;
  await assert.rejects(recoverNativeDepositRefund(d), (e: any) => e.issues?.[0]?.code === "CONFIRMATIONS_PENDING");
  assert.equal(evidenceRecords, 0);
  head = 112; receipt = { ...receipt, logs: [] };
  await assert.rejects(recoverNativeDepositRefund(d), /does not match/);
  receipt = { ...receipt, logs: [refundEvent] };
  await recoverNativeDepositRefund(d);
  assert.equal(evidenceRecords, 1); assert.equal(proposals, 3);
  await recoverNativeDepositRefund(d);
  assert.equal(evidenceRecords, 1, "retries do not re-record evidence or finalize without governance");
});
