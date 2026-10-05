import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

for (const name of [
  "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS", "STRATO_NATIVE_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "STRATO_NODE_URL",
  "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID",
  "RELAYER_OPENID_DISCOVERY_URL", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION",
]) process.env[name] = "1".repeat(40);
process.env.SENDGRID_API_KEY = "SG.test.test";

const originalCwd = process.cwd();
const directory = mkdtempSync(path.join(tmpdir(), "bridge-reviews-"));
process.chdir(directory);
after(() => { process.chdir(originalCwd); rmSync(directory, { recursive: true, force: true }); });
const address = "1".repeat(40);
const hash = "0x" + "a".repeat(64);
const amount = "9007199254740993123456789";
const deposit = { key: "11155111", key2: address, key3: "7", value: {
  status: "2", stratoToken: address, stratoTokenAmount: amount, stratoRecipient: address,
  externalSender: address, externalToken: address, externalTokenAmount: "100", externalTxHash: hash,
} };
const withdrawal = (id: string, status = "3") => ({ key: id, value: {
  status, externalChainId: "11155111", stratoToken: address, stratoTokenAmount: amount, stratoSender: address,
  externalToken: address, externalTokenAmount: "100", externalRecipient: address,
  authorizationDeadline: "1", externalTxHash: "0".repeat(64), reservationId: "0".repeat(64), cancellationTxHash: "",
} });
const authorization = { destinationVault: address, notBefore: "0", deadline: "1", signerSetVersion: "1" };
const empty = () => ({ deposits: [], withdrawals: [], reviews: [], authorizations: [], nativeDeposits: [], nativeWithdrawals: [], legacyDeposits: [], legacyWithdrawals: [] } as any);

async function setup(t: any, records: any) {
  const cirrus = await import("./cirrusService");
  const bridge = await import("./bridgeService");
  const { cirrus: client } = await import("../utils/api");
  t.mock.method(client, "get", async () => { throw new Error("Unexpected network request"); });
  t.mock.method(cirrus, "getBridgeReviewRecords", async () => records);
  t.mock.method(cirrus, "getDepositReviewApproval", async () => undefined);
  t.mock.method(bridge, "getStratoNetworkId", async () => 10n ** 60n);
  return { cirrus, bridge, service: await import("./bridgeReviewService") };
}

test("review queue preserves large values and excludes unexpired and already-paid withdrawals", async t => {
  const records = empty();
  records.deposits = [deposit];
  records.withdrawals = [withdrawal("1", "2"), withdrawal("2"),
    { ...withdrawal("3"), value: { ...withdrawal("3").value, authorizationDeadline: "99999999999" } },
    { ...withdrawal("4"), value: { ...withdrawal("4").value, externalTxHash: hash } }];
  records.reviews = [{ key: "1", value: { proposalHash: hash } }];
  records.nativeWithdrawals = [{ key: "5", value: { ...withdrawal("5").value, nativeMintProposalHash: hash } }];
  const { service } = await setup(t, records);
  const queue = await service.getBridgeReviewQueue();
  assert.deepEqual(queue.map(item => item.kind), ["deposit_review", "withdrawal_review", "withdrawal_refund", "withdrawal_review"]);
  assert.equal(queue[0].amount, amount);
  assert.equal(queue[1].safeProposalHash, hash);
  assert.match(queue[2].reason, /verifier proof/);
  assert.deepEqual(queue[2].actions, ["refund"]);
});

test("persisted sign-time reviews are matched to the exact withdrawal and expire", async t => {
  await setup(t, empty());
  const { config } = await import("../config");
  const { getPendingWithdrawalReview, getWithdrawalReviewDigest } = await import("./externalWithdrawalService");
  const review = { sourceChainId: "1", sourceBridge: `0x${address}`, sourceWithdrawalId: "3", destinationChainId: "11155111",
    destinationVault: `0x${address}`, token: `0x${address}`, recipient: `0x${address}`, amount: "100" };
  const digest = getWithdrawalReviewDigest(review);
  const journal = path.join(directory, "data", "safe-reviews", `11155111-${config.safe.address!.toLowerCase()}-${digest}.json`);
  await fs.mkdir(path.dirname(journal), { recursive: true });
  const saved = { reviewDigest: digest, approvalDeadline: "99999999999", proposal: { safeAddress: config.safe.address, safeTxHash: hash } };
  await fs.writeFile(journal, JSON.stringify(saved));
  assert.equal(await getPendingWithdrawalReview(review), hash);
  assert.equal(await getPendingWithdrawalReview({ ...review, sourceWithdrawalId: "4" }), undefined);
  await fs.writeFile(journal, JSON.stringify({ ...saved, approvalDeadline: "1" }));
  assert.equal(await getPendingWithdrawalReview(review), undefined);
  await fs.writeFile(journal, JSON.stringify({ ...saved, reviewDigest: "wrong" }));
  await assert.rejects(getPendingWithdrawalReview(review), /Invalid persisted/);
});

test("READY sign-time Safe reviews are visible without enabling withdrawal rejection", async t => {
  const records = empty();
  records.withdrawals = [{ ...withdrawal("2"), value: { ...withdrawal("2").value, authorizationDeadline: "99999999999" } }];
  records.authorizations = [{ key: "2", value: authorization }];
  const { service } = await setup(t, records);
  const external = await import("./externalWithdrawalService");
  t.mock.method(external, "getPendingWithdrawalReview", async () => hash);
  const [item] = await service.getBridgeReviewQueue();
  assert.equal(item.kind, "withdrawal_review");
  assert.equal(item.safeProposalHash, hash);
  assert.deepEqual(item.actions, []);
  await assert.rejects(service.prepareBridgeOperation(item.id, "reject"), /Unsupported/);
});

test("bridge operations cannot prepare governance votes and reject stale settlements", async t => {
  const records = empty(); records.deposits = [deposit];
  const { service, bridge } = await setup(t, records);
  let settlements = 0;
  t.mock.method(bridge, "confirmReviewedDeposit", async () => { settlements++; return hash; });
  const id = `eab:deposit:11155111:${address}:7`;
  for (const action of ["approve", "reject", "settle"]) await assert.rejects(service.prepareBridgeOperation(id, action), /Unsupported/);
  assert.equal(settlements, 0);
  records.deposits = [];
  await assert.rejects(service.prepareBridgeOperation(id, "settle"), /Unsupported/);
  assert.equal(settlements, 0);
});

test("refund votes require indexed attestations; subsequent voters reuse the same quorum", async t => {
  const records = empty(); records.withdrawals = [withdrawal("2")];
  const { service, cirrus } = await setup(t, records);
  const attestations = await import("./settlementAttestationService");
  t.mock.method(cirrus, "getWithdrawalRefundEvidence", async () => ({ withdrawal: withdrawal("2").value, authorization, verifierVersion: "3" }));
  t.mock.method(cirrus, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: [address] }));
  const { rpc } = await import("../utils/api");
  const digest = "0xbe620f2a844e6b18a371d579311e6e4c28075c0b7292146b43954623110fde7f";
  t.mock.method(rpc, "post", async (_path: string, request: any) => {
    assert.equal(request.method, "eth_call");
    assert.equal(request.params[0].data, "0x49a7c4f5" + "2".padStart(64, "0"));
    return { result: digest };
  });
  let count = 0, requests = 0, rejected = true;
  t.mock.method(cirrus, "getSettlementAttestationCount", async () => count);
  t.mock.method(attestations, "attestWithdrawalRefund", async (_authorization: any, digest: string) => {
    requests++;
    assert.match(digest, /^0x[0-9a-f]{64}$/);
    if (rejected) throw new Error("external payment already occurred");
  });
  await assert.rejects(service.prepareBridgeOperation("eab:withdrawal:2", "refund"), /payment already occurred/);
  rejected = false;
  await assert.rejects(service.prepareBridgeOperation("eab:withdrawal:2", "refund"), (error: any) => {
    assert.match(error.message, /not indexed/);
    assert.equal(error.issues[0].code, "INDEXING_PENDING");
    assert.equal(error.issues[0].retryable, true);
    assert.deepEqual(error.issues[0].details, { available: "0", required: "2" });
    return true;
  });
  count = 2;
  const vote = await service.prepareBridgeOperation("eab:withdrawal:2", "refund");
  assert.ok("digest" in vote);
  assert.equal(vote.digest, digest);
  assert.equal("func" in vote, false, "the operator never constructs governance votes");
  assert.equal(requests, 2, "existing quorum must not spend more attestor fees");
});

test("refund preparation runs independently, isolates failures, and skips paid or unexpired withdrawals", async t => {
  const records = empty();
  records.withdrawals = [withdrawal("20"), withdrawal("21"),
    { ...withdrawal("22"), value: { ...withdrawal("22").value, authorizationDeadline: "99999999999" } },
    { ...withdrawal("23"), value: { ...withdrawal("23").value, externalTxHash: hash } }, withdrawal("24", "2")];
  const { service, cirrus, bridge } = await setup(t, records);
  const { ProcessingIssueService, processingIssueService } = await import("./processingIssueService");
  const isolated = new ProcessingIssueService(path.join(directory, "refund-issues.json"));
  for (const method of ["due", "record", "resolve"] as const) {
    t.mock.method(processingIssueService, method, isolated[method].bind(isolated) as any);
  }
  const settlements = t.mock.method(bridge, "confirmReviewedDeposit", async () => { throw new Error("No settlement or governance action expected"); });
  t.mock.method(cirrus, "getWithdrawalRefundEvidence", async (id: string) => ({ withdrawal: withdrawal(id).value, authorization, verifierVersion: "3" }));
  t.mock.method(cirrus, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: [address] }));
  const { rpc } = await import("../utils/api");
  t.mock.method(rpc, "post", async (_path: string, request: any) => {
    assert.equal(request.method, "eth_call");
    return { result: "0x" + request.params[0].data.slice(-64) };
  });
  const accepted = new Set<string>(), attempts: string[] = [];
  t.mock.method(cirrus, "getSettlementAttestationCount", async (digest: string) => accepted.has(digest) ? 2 : 0);
  const attestation = await import("./settlementAttestationService");
  t.mock.method(attestation, "attestWithdrawalRefund", async (auth: any, digest: string) => {
    attempts.push(auth.sourceWithdrawalId);
    if (auth.sourceWithdrawalId === "20") throw new Error("external payment already occurred");
    accepted.add(digest);
  });
  await service.preparePendingWithdrawalRefunds();
  assert.deepEqual(attempts, ["20", "21"], "one failed refund must not prevent the next from gathering attestations");
  await service.preparePendingWithdrawalRefunds();
  assert.deepEqual(attempts, ["20", "21"], "failures back off and existing quorums do not submit duplicate attestations");
  const issues = Object.values((await isolated.snapshot()).records);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].context.reference, "20");
  assert.equal(issues[0].context.stage, "withdrawal-refund");
  assert.equal(settlements.mock.callCount(), 0);
});

test("email journal deduplicates, retries failed delivery, and never resolves items on a failed scan", async t => {
  const records = empty(); records.deposits = [deposit];
  const { service, cirrus } = await setup(t, records);
  const email = await import("./emailService");
  const sends: boolean[] = [];
  let fail = true;
  t.mock.method(email, "sendBridgeReviewEmail", async (_item: any, resolved = false) => {
    if (fail) throw new Error("mail unavailable");
    sends.push(resolved);
  });
  await assert.rejects(service.notifyBridgeReviews(), /delivery failed/);
  fail = false;
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.deepEqual(sends, [false]);
  const journal = path.join(directory, "data", "bridgeReviewNotifications.json");
  assert.equal(Object.keys(JSON.parse(await fs.readFile(journal, "utf8"))).length, 1);
  const reader = t.mock.method(cirrus, "getBridgeReviewRecords", async () => { throw new Error("Cirrus unavailable"); });
  await assert.rejects(service.notifyBridgeReviews(), /Cirrus unavailable/);
  assert.deepEqual(sends, [false]);
  reader.mock.restore();
  records.deposits = [];
  let outcome: "delivered" | undefined;
  t.mock.method(cirrus, "getBridgeReviewOutcome", async () => outcome);
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.deepEqual(sends, [false], "disappearance alone cannot resolve a funds recovery alert");
  outcome = "delivered";
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.deepEqual(sends, [false], "confirmed delivery cleans the journal without an outcome email");
  assert.equal(Object.keys(JSON.parse(await fs.readFile(journal, "utf8"))).length, 0);
  await fs.writeFile(journal, "null");
  await assert.rejects(service.notifyBridgeReviews(), /Invalid.*journal/);
});

test("rejection retains a recovery alert and reopening never sends a premature cleared email", async t => {
  await fs.rm(path.join(directory, "data", "bridgeReviewNotifications.json"), { force: true });
  const records = empty();
  records.deposits = [{ ...deposit, value: { ...deposit.value } }];
  const { service, cirrus } = await setup(t, records);
  const email = await import("./emailService");
  const sent: any[] = [];
  t.mock.method(email, "sendBridgeReviewEmail", async (item, resolved = false) => { sent.push({ item, resolved }); });
  t.mock.method(cirrus, "getBridgeReviewOutcome", async () => undefined);
  await service.notifyBridgeReviews();
  records.deposits[0].value.status = "7";
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].item.kind, "deposit_recovery");
  assert.equal(sent[1].resolved, false);
  records.deposits[0].value.status = "0".repeat(40);
  await service.notifyBridgeReviews();
  records.deposits = [];
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 2, "neither reopening nor absent indexing proves delivery");
  const saved = JSON.parse(await fs.readFile(path.join(directory, "data", "bridgeReviewNotifications.json"), "utf8"));
  assert.equal(Object.values(saved).length, 1);
  assert.equal((Object.values(saved)[0] as any).recoveryStatus, "reopened");
});

test("review notifications wait for refund quorum and Safe proposals and stop requesting approved deposits", async t => {
  await fs.rm(path.join(directory, "data", "bridgeReviewNotifications.json"), { force: true });
  const records = empty();
  records.deposits = [deposit]; records.withdrawals = [withdrawal("2")];
  records.nativeWithdrawals = [{ key: "3", value: { ...withdrawal("3").value } }];
  const { service, cirrus } = await setup(t, records);
  const { rpc } = await import("../utils/api");
  const email = await import("./emailService");
  const attestation = await import("./settlementAttestationService");
  const submit = t.mock.method(attestation, "attestWithdrawalRefund", async () => { throw new Error("Notifications must not submit attestations"); });
  let count = 0, fail = false, approval: string | undefined;
  t.mock.method(rpc, "post", async () => ({ result: hash }));
  t.mock.method(cirrus, "getSettlementAttestationCount", async () => { if (fail) throw new Error("index unavailable"); return count; });
  t.mock.method(cirrus, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: [address] }));
  t.mock.method(cirrus, "getDepositReviewApproval", async () => approval);
  const sent: Array<{ id: string; resolved: boolean }> = [];
  t.mock.method(email, "sendBridgeReviewEmail", async (item, resolved = false) => { sent.push({ id: item.id, resolved }); });
  await service.notifyBridgeReviews();
  assert.deepEqual(sent.map(s => s.id), [`eab:deposit:11155111:${address}:7`]);
  count = 2; records.nativeWithdrawals[0].value.nativeMintProposalHash = hash;
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.deepEqual(sent.map(s => s.id), [`eab:deposit:11155111:${address}:7`, "eab:withdrawal:2", "native:withdrawal:3"]);
  fail = true;
  await assert.rejects(service.notifyBridgeReviews(), /delivery failed/);
  assert.equal(sent.length, 3, "a failed readiness check cannot send a recovery email");
  fail = false; approval = hash;
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 3, "approval is silent and must not keep asking for approval");
  count = 0; delete records.nativeWithdrawals[0].value.nativeMintProposalHash;
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 3, "readiness loss alone is not completion or recovery");
  assert.equal(submit.mock.callCount(), 0);
});

test("review emails use existing recipients and contain no URL links", async t => {
  const { config } = await import("../config");
  const { default: sgMail } = await import("@sendgrid/mail");
  const { sendBridgeReviewEmail } = await import("./emailService");
  const previousRecipients = config.email.approverEmails;
  config.email.approverEmails = ["reviewer@example.com"];
  const sent: any[] = [];
  const cirrus = await import("./cirrusService");
  const lookup = t.mock.method(cirrus, "getBridgeEmailTokens", async () => new Map([[address, { symbol: "TEST", decimals: 6 }]]));
  t.mock.method(sgMail, "send", async (message: any) => { sent.push(message); return [] as any; });
  const item = { id: "eab:withdrawal:2", source: "eab" as const, kind: "withdrawal_review" as const,
    chainId: "11155111", reference: "2", token: address, amount, account: address,
    scenario: "EAB withdrawal Safe approval", reason: "Review required", actions: [], safeProposalHash: hash };
  try {
    await sendBridgeReviewEmail(item);
    assert.equal(sent.length, 1);
    for (const message of sent) {
      assert.deepEqual(message.to, ["reviewer@example.com"]);
      assert.match(message.text, /Reference: eab:withdrawal:2/);
      assert.doesNotMatch(message.text, /https?:\/\//);
    }
    assert.match(sent[0].text, /Review in Safe/);
    assert.match(sent[0].text, /Amount: 9007199254740993123\.456789 TEST/);
    lookup.mock.mockImplementation(async () => { throw new Error("metadata unavailable"); });
    await sendBridgeReviewEmail(item);
    assert.match(sent[1].text, /raw token units; decimals unavailable/);
    lookup.mock.mockImplementation(async () => new Map([[address, { symbol: "TEST", decimals: 255 }]]));
    await sendBridgeReviewEmail(item);
    assert.match(sent[2].text, /raw token units; decimals unavailable/);
    config.email.approverEmails = [];
    await assert.rejects(sendBridgeReviewEmail(item), /TRANSACTION_APPROVER_EMAILS/);
    assert.equal(sent.length, 3);
  } finally { config.email.approverEmails = previousRecipients; }
});

test("deposit refund processing is quiet until a Safe action or confirmed refund exists", async t => {
  await fs.rm(path.join(directory, "data", "bridgeReviewNotifications.json"), { force: true });
  const records = empty();
  records.deposits = [{ ...deposit, value: { ...deposit.value, status: "7" } }];
  const { service, cirrus } = await setup(t, records);
  const email = await import("./emailService");
  const sent: any[] = [];
  t.mock.method(email, "sendBridgeReviewEmail", async (item, resolved = false) => { sent.push({ item, resolved }); });
  await service.notifyBridgeReviews();
  records.deposits[0].value.status = "8";
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 1, "automatic return processing needs no fresh action email");
  records.deposits = [];
  t.mock.method(cirrus, "getBridgeReviewOutcome", async () => "refunded");
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 1, "confirmed refund sends no outcome email");
  records.nativeDeposits = [{ key: "e".repeat(64), value: { ...deposit.value, bridgeStatus: "7", refundProposalHash: hash } }];
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 2); assert.equal(sent[1].item.safeProposalHash, hash); assert.equal(sent[1].resolved, false);
  records.nativeDeposits[0].value.refundEvidenceHash = hash;
  await service.notifyBridgeReviews();
  await service.notifyBridgeReviews();
  assert.equal(sent.length, 3, "governance confirmation gets one new action email");
  assert.equal(sent[2].item.safeProposalHash, undefined);
  assert.equal(sent[2].item.refundEvidenceHash, hash);
  assert.deepEqual(sent[2].item.actions, ["confirm_refund"]);
  assert.equal(sent[2].resolved, false);

});
