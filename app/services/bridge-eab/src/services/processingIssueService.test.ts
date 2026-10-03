import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessingContext, ProcessingRecord } from "../types";
import { classifyProcessingError, processingIssue, processingKey, verifierFailureDetails } from "../utils/processingIssues";

for (const name of [
  "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS", "STRATO_NATIVE_BRIDGE_ADDRESS", "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "STRATO_NODE_URL", "RELAYER_BA_USERNAME",
  "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID", "RELAYER_OPENID_DISCOVERY_URL",
  "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION",
]) process.env[name] = "1".repeat(40);
process.env.SENDGRID_API_KEY = "SG.test.test";

const context = (reference = "1"): ProcessingContext => ({ source: "native", chainId: "11155111",
  bridge: "1".repeat(40), reference, stage: "withdrawal-processing", token: "2".repeat(40) });
const issue = (code: Parameters<typeof processingIssue>[0], details = {}) => ({ issues: [processingIssue(code, details)] });

async function fixture(t: any) {
  const { ProcessingIssueService } = await import("./processingIssueService");
  const logger = await import("../utils/logger");
  const logs = t.mock.method(logger, "logInfo", () => undefined);
  const directory = mkdtempSync(join(tmpdir(), "processing-issues-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "issues.json");
  let now = 1_000_000;
  const open = () => new ProcessingIssueService(file, () => now, () => 0.5);
  const sent: Array<{ records: ProcessingRecord[]; resolved: boolean }> = [];
  const send = async (records: ProcessingRecord[], resolved: boolean) => { sent.push({ records, resolved }); };
  return { file, open, service: open(), advance: (ms: number) => { now += ms; }, sent, send, logs };
}

test("retry schedules survive restart, isolate transfers, and bypass backoff for recovery", async t => {
  const f = await fixture(t);
  const calls: string[] = [];
  const fail = async () => { calls.push("failed"); throw new Error("ETIMEDOUT"); };
  assert.equal(await f.service.run(context(), fail), false);
  assert.equal(await f.open().run(context(), fail), false);
  assert.equal(await f.service.run(context("2"), async () => { calls.push("other"); }), true);
  assert.deepEqual(calls, ["failed", "other"]);
  assert.equal(await f.service.run(context(), async () => false, true), false);
  assert.equal((await f.service.snapshot()).records[processingKey(context())].resolvedAt, undefined,
    "a no-op wait must not report recovery");
  f.advance(30_000);
  assert.equal(await f.open().run(context(), fail), false);
  assert.equal(calls.length, 3);
  assert.equal(await f.service.run(context(), async () => { calls.push("recover"); }, true), true);
  const record = (await f.open().snapshot()).records[processingKey(context())];
  assert.equal(record.outcome, "processing_resumed", "normal return is not transfer completion");
  assert.ok(record.resolvedAt);
});

test("concurrent records persist atomically and repeated failures log only their transition", async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => f.service.record(context(String(i)), issue("FUNDING_REQUIRED"))));
  await f.service.record(context(), issue("FUNDING_REQUIRED"));
  const snapshot = await f.open().snapshot();
  assert.equal(Object.keys(snapshot.records).length, 12);
  assert.equal(snapshot.records[processingKey(context())].attempts, 2);
  assert.equal(f.logs.mock.callCount(), 12);
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  writeFileSync(f.file, "null");
  await assert.rejects(f.open().due(context()), /Invalid processing issue journal/);
  await assert.rejects(f.open().record(context(), issue("UNKNOWN")), /Invalid processing issue journal/);
});

test("grouped alerts and reminders survive restarts; recovery waits until every operation clears", async t => {
  const f = await fixture(t);
  await Promise.all(["1", "2"].map(id => f.service.record({ ...context(id), token: id.repeat(40) }, issue("FUNDING_REQUIRED", { account: "executor" }))));
  await f.service.notify(f.send);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].records.length, 2);
  f.advance(60 * 60_000);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 2);
  await f.service.resolve(context());
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 2, "one blocked operation remains");
  await f.service.resolve(context("2"), "completed");
  await f.open().notify(f.send);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, false, true]);
  assert.equal(f.sent[2].records.length, 2, "recovery identifies every alerted operation");
  await f.service.record(context(), issue("FUNDING_REQUIRED", { account: "executor" }));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 4, "a new incident must alert again");
});

test("transient grace, failed delivery, and recovery delivery retain durable pending notifications", async t => {
  const f = await fixture(t);
  await f.service.record(context(), issue("DEPENDENCY_UNAVAILABLE"));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 0);
  f.advance(5 * 60_000);
  await f.service.record(context(), issue("DEPENDENCY_UNAVAILABLE"));
  const fail = async () => { throw new Error("mail unavailable"); };
  await assert.rejects(f.service.notify(fail), /delivery failed/);
  await f.open().notify(f.send);
  await f.service.resolve(context());
  await assert.rejects(f.open().notify(fail), /delivery failed/);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, true]);
});

test("progress clears the old alert while normal confirmation waits stay quiet across restart", async t => {
  const f = await fixture(t);
  const processing = context("6");
  const confirmations = { ...processing, stage: "release-confirmations" };
  await f.service.run(processing, async () => { throw new Error("bridge configuration mismatch"); });
  await f.service.notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false]);
  f.advance(60_000);
  await f.service.record(confirmations, issue("CONFIRMATIONS_PENDING", { observedConfirmations: "2", requiredConfirmations: "12" }));
  await f.service.resolve(processing);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, true]);
  assert.equal(f.sent[1].records[0].outcome, "processing_resumed");
  assert.equal((await f.open().snapshot()).records[processingKey(confirmations)].resolvedAt, undefined);
  f.advance(120_000);
  await f.open().record(confirmations, issue("CONFIRMATIONS_PENDING", { observedConfirmations: "10", requiredConfirmations: "12" }));
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 2, "expected confirmations do not trigger an attention email");
  await f.service.resolve(confirmations);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 2, "an unalerted confirmation wait needs no recovery email");
});

test("normal indexing and confirmation waits send neither attention nor recovery emails across restarts", async t => {
  const f = await fixture(t);
  for (const code of ["INDEXING_PENDING", "CONFIRMATIONS_PENDING"] as const) {
    const waiting = { ...context(code), stage: code === "INDEXING_PENDING" ? "withdrawal-refund" : "release-confirmations" };
    await f.service.run(waiting, async () => { throw issue(code, { available: "0", required: "2" }); });
    await f.open().notify(f.send);
    assert.equal(await f.open().due(waiting), false);
    f.advance(60_000);
    assert.equal(await f.open().due(waiting), true);
    await f.open().record(waiting, issue(code, { available: "1", required: "2" }));
    await f.open().notify(f.send);
    f.advance(60_000);
    await f.open().run(waiting, async () => {});
    await f.open().notify(f.send);
    assert.ok((await f.open().snapshot()).records[processingKey(waiting)].resolvedAt);
  }
  assert.equal(f.sent.length, 0);
});

test("stalled indexing alerts after grace and sends recovery only for an alerted wait", async t => {
  const f = await fixture(t);
  const waiting = { ...context(), stage: "withdrawal-refund" };
  await f.service.record(waiting, issue("INDEXING_PENDING", { available: "0", required: "2" }));
  f.advance(5 * 60_000 - 1);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 0);
  f.advance(1);
  await f.open().record(waiting, issue("INDEXING_PENDING", { available: "0", required: "2" }));
  await f.open().notify(f.send);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false]);
  await f.open().resolve(waiting);
  await f.open().notify(f.send);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, true]);
});

test("an expected wait does not suppress an accompanying actionable failure", async t => {
  const f = await fixture(t);
  await f.service.record(context(), { issues: [processingIssue("INDEXING_PENDING"), processingIssue("FUNDING_REQUIRED")] });
  await f.service.notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false]);
});

test("progress suppresses alerts and reminders without resetting incident age or accepting oscillation as progress", async t => {
  const f = await fixture(t);
  const waiting = { ...context(), stage: "release-confirmations" };
  const pending = (count: string) => issue("CONFIRMATIONS_PENDING", { observedConfirmations: count, requiredConfirmations: "100", verifier: "1" });
  await f.service.record(waiting, pending("1"));
  const firstSeen = (await f.service.snapshot()).records[processingKey(waiting)].firstSeenAt;
  for (const count of ["2", "3", "4"]) {
    f.advance(4 * 60_000);
    await f.open().record(waiting, pending(count));
    await f.open().notify(f.send);
  }
  assert.equal(f.sent.length, 0, "ongoing progress remains quiet beyond the grace period");
  assert.equal((await f.open().snapshot()).records[processingKey(waiting)].firstSeenAt, firstSeen);
  f.advance(3 * 60_000);
  await f.open().record(waiting, pending("3"));
  f.advance(2 * 60_000);
  await f.open().record(waiting, pending("4"));
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 1, "returning to the previous high-water mark is not progress");
  f.advance(60 * 60_000);
  await f.open().record(waiting, pending("5"));
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 1, "new progress suppresses a due reminder");
  await f.open().resolve(waiting);
  await f.open().notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, true]);
});

test("a single unknown failure or stale journal entry cannot trigger an alert", async t => {
  const f = await fixture(t);
  await f.service.record(context(), issue("UNKNOWN"));
  f.advance(5 * 60_000);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 0);
  await f.open().record(context(), issue("UNKNOWN"));
  f.advance(11 * 60_000);
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 0, "stale observations require a fresh failed retry");
  await f.open().record(context(), issue("UNKNOWN"));
  await f.open().notify(f.send);
  assert.equal(f.sent.length, 1);
});

test("reclassification does not send a false recovery email for an unresolved transfer", async t => {
  const f = await fixture(t);
  await f.service.record(context(), issue("FUNDING_REQUIRED"));
  await f.service.notify(f.send);
  await f.service.record(context(), issue("CONFIGURATION"));
  await f.service.notify(f.send);
  assert.deepEqual(f.sent.map(s => s.resolved), [false, false]);
});

test("policy changes alert immediately and governance review uses its existing notification channel", async t => {
  const f = await fixture(t);
  await f.service.record(context(), issue("POLICY_RESTRICTED", { policyVersion: "1", limit: "10" }));
  await f.service.notify(f.send);
  await f.service.record(context(), issue("POLICY_RESTRICTED", { policyVersion: "2", limit: "20" }));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 2);
  await f.service.record(context("2"), issue("MANUAL_REVIEW"));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 2);
});

test("retry delays are bounded and history pruning never drops active blockers", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 15; i++) {
    await f.service.record(context(), issue("DEPENDENCY_UNAVAILABLE"));
    const r = (await f.service.snapshot()).records[processingKey(context())];
    assert.ok(r.nextRetryAt - r.lastSeenAt <= 5 * 60_000);
    f.advance(5 * 60_000);
  }
  await f.service.record(context("2"), issue("UNKNOWN"));
  await f.service.resolve(context("2"));
  f.advance(8 * 24 * 60 * 60_000);
  await f.service.record(context("3"), issue("UNKNOWN"));
  const records = (await f.service.snapshot()).records;
  assert.ok(records[processingKey(context())]);
  assert.equal(records[processingKey(context("2"))], undefined);
});

test("verifier diagnostics are sanitized, backward compatible, and do not trust remote retryable flags", () => {
  const error = { response: { status: 422, data: { code: "FUNDING_REQUIRED", retryable: false,
    details: { account: "attestor", available: "9007199254740993123456", apiToken: "secret", token: "https://rpc/?key=secret" },
    policyVersion: "v2", policyDigest: "ab12", error: "raw private details" } } };
  assert.deepEqual(classifyProcessingError(error), [processingIssue("FUNDING_REQUIRED", {
    account: "attestor", available: "9007199254740993123456", policyVersion: "v2", policyDigest: "ab12",
  })]);
  assert.equal(classifyProcessingError({ response: { status: 409, data: { decision: "manual_review" } } })[0].code, "MANUAL_REVIEW");
  assert.equal(classifyProcessingError(new Error("EAB: mint limit exceeded"))[0].code, "MINT_CAPACITY");
  assert.equal(classifyProcessingError(Object.assign(new Error("EAB: mint limit exceeded"), {
    shortMessage: "execution reverted",
  }))[0].code, "MINT_CAPACITY");
  assert.equal(classifyProcessingError(new Error("Deposit block hash changed"))[0].retryable, false);
  assert.equal(classifyProcessingError({ response: { status: 503 } })[0].code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(classifyProcessingError({ response: { data: { code: "future-code", retryable: true } } })[0].retryable, false);
  const a: any = {}, b = { cause: a }; a.cause = b;
  assert.equal(classifyProcessingError(a)[0].code, "UNKNOWN");
  assert.equal(verifierFailureDetails(new Error("low account balance"), "v1", "digest").policyVersion, "v1");
});

test("unknown diagnostics retain the cause without credentials, URLs, or serialized payloads", async t => {
  const f = await fixture(t);
  const previousSecret = process.env.CLIENT_SECRET;
  process.env.CLIENT_SECRET = "unlabelled-secret-value";
  t.after(() => { process.env.CLIENT_SECRET = previousSecret; });
  const hash = "0x" + "a".repeat(64);
  const error = Object.assign(new Error('Vault release reverted at https://rpc.example/private-api-key?key=hidden Bearer bearer-secret password="password-secret" unlabelled-secret-value (request={"privateKey":"payload-secret"})'), {
    code: "CALL_EXCEPTION", action: "sendTransaction", transactionHash: hash,
    response: { status: 422 },
  });
  await f.service.run(context(), async () => { throw Object.assign(new Error("wrapped"), { cause: error }); });
  const record = (await f.open().snapshot()).records[processingKey(context())];
  assert.equal(record.issues[0].retryable, true);
  assert.equal(record.nextRetryAt - record.lastSeenAt, 30_000);
  assert.match(record.issues[0].details.reason, /^Vault release reverted/);
  assert.equal(record.issues[0].details.errorCode, "CALL_EXCEPTION");
  assert.equal(record.issues[0].details.httpStatus, "422");
  assert.equal(record.issues[0].details.operation, "sendTransaction");
  assert.equal(record.issues[0].details.transactionHash, hash);
  assert.doesNotMatch(JSON.stringify(record), /rpc\.example|private-api-key|bearer-secret|password-secret|unlabelled-secret-value|payload-secret|request=/);
  const oldVerifier = classifyProcessingError({ response: { status: 422, data: {
    code: "UNKNOWN", details: {}, error: "Release event not found", retryable: false,
  } } })[0];
  assert.equal(oldVerifier.details.reason, "Release event not found");
  assert.equal(oldVerifier.retryable, false, "unclassified evidence must still take the deposit review path");
  const nested = classifyProcessingError({ response: { status: 422, data: {
    error: { message: 'Execution reverted {"headers":{"Authorization":"secret"}}' },
  } } })[0];
  assert.equal(nested.details.reason, "Execution reverted");
  const credentials = classifyProcessingError(new Error('Release failed access_token=remote-secret apiKey=remote-key response=raw-response-secret'))[0];
  assert.doesNotMatch(JSON.stringify(credentials), /remote-secret|remote-key|raw-response-secret/);
  assert.ok(classifyProcessingError(new Error("x".repeat(500)))[0].details.reason.length <= 240);
  assert.equal(classifyProcessingError({ response: { data: { payload: "do-not-serialize" } } })[0].details.reason, undefined);
});

test("terminal reconciliation requires matching on-chain identities and paginates through row caps", async t => {
  const { cirrus } = await import("../utils/api");
  const { getCompletedProcessingContexts } = await import("./cirrusService");
  const inputs: ProcessingContext[] = Array.from({ length: 25 }, (_, i) => ({ ...context(String(i)), source: "eab" }));
  inputs.push({ ...context("a".repeat(40) + ":18"), source: "eab", stage: "deposit-settlement" });
  const offsets: number[] = [];
  t.mock.method(cirrus, "get", async (table: string, { params }: any) => {
    offsets.push(params.offset);
    if (params.offset) return [];
    assert.ok(params.or.length < 2000);
    if (table.endsWith("-deposits")) return [
      { key: "999", key2: "a".repeat(40), key3: "18", value: { status: "4" } },
      { key: "11155111", key2: "a".repeat(40), key3: "18", value: { status: "2" } },
    ];
    return [{ key: params.or.includes("key.eq.20") ? "20" : "1", value: { status: "4" } }];
  });
  const completed = await getCompletedProcessingContexts(inputs);
  assert.deepEqual(completed.map(c => c.reference), ["1", "20"]);
  assert.deepEqual(offsets, [0, 1, 0, 1, 0, 2]);
});

test("mint diagnostics preserve raw integers and are explicitly indexed snapshots", async t => {
  const { cirrus } = await import("../utils/api");
  const { getMintPolicyDiagnostics } = await import("./cirrusService");
  t.mock.method(cirrus, "get", async () => [{ value: { capacity: "9007199254740993123456", consumed: "1", refillRate: "10", lastRefillAt: "123" } }]);
  const details = await getMintPolicyDiagnostics("2".repeat(40));
  assert.equal(details.available, "9007199254740993123455");
  assert.equal(details.observedAt, "123");
  assert.equal(details.units, "indexed-strato-token-base-units");
});

test("the HTTP retry helper preserves diagnostics and avoids repeated deterministic failures", async () => {
  const { retry } = await import("../utils/api");
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("EAB: mint limit exceeded"); }, { maxAttempts: 3 }), error => {
    assert.equal(classifyProcessingError(error)[0].code, "MINT_CAPACITY");
    return true;
  });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("ETIMEDOUT"); }, { maxAttempts: 3 }), /ETIMEDOUT/);
  assert.equal(calls, 3, "transport retries remain unchanged");
});

test("processing emails use existing recipients and distinguish recovery from completion", async t => {
  const f = await fixture(t);
  const { config } = await import("../config");
  const { default: mail } = await import("@sendgrid/mail");
  const { sendProcessingIssueEmail } = await import("./emailService");
  const previous = config.email.approverEmails;
  config.email.approverEmails = ["reviewer@example.com"];
  t.after(() => { config.email.approverEmails = previous; });
  const sent: any[] = [];
  const cirrus = await import("./cirrusService");
  t.mock.method(cirrus, "getBridgeEmailTokens", async () => new Map([["2".repeat(40), { symbol: "ETH", decimals: 18 }]]));
  t.mock.method(mail, "send", async (message: any) => { sent.push(message); return [] as any; });
  await f.service.record(context(), issue("FUNDING_REQUIRED", { account: "operator", available: "0" }));
  const records = Object.values((await f.service.snapshot()).records);
  await sendProcessingIssueEmail(records, false);
  await sendProcessingIssueEmail(records, true);
  assert.deepEqual(sent[0].to, ["reviewer@example.com"]);
  assert.match(sent[0].text, /FUNDING_REQUIRED/);
  assert.match(sent[1].text, /Processing may still be in progress/);
  assert.match(sent[1].subject, /Previously reported issue resolved/);
  assert.doesNotMatch(sent[1].subject, /funding needed|Action required/);
  assert.match(sent[1].text, /Previous issue code: FUNDING_REQUIRED/);
  assert.match(sent[0].text, /Withdrawal #1 — ETH/);
  assert.match(sent[0].subject, /Operations check needed/);
  assert.match(sent[0].text, /Who acts next\nPlatform operations team/);
  assert.match(sent[0].text, /Next steps\nFund/);
  assert.doesNotMatch(sent[1].text, /needs funding/);
  await f.service.record(context("2"), issue("UNKNOWN"));
  await sendProcessingIssueEmail([(await f.service.snapshot()).records[processingKey(context("2"))]], true);
  assert.match(sent[2].text, /Previous issue code: UNKNOWN/);
  assert.doesNotMatch(sent[2].text, /needs operator investigation|\{\}/);
  assert.doesNotMatch(sent[0].text + sent[1].text, /https?:\/\//);
  assert.doesNotMatch(sent[0].text + sent[1].text, /\{"|\{\}/);
});

test("confirmation alerts report observed counts and assign investigation without asserting an indexing or chain failure", async t => {
  const f = await fixture(t);
  const { config } = await import("../config");
  const { default: mail } = await import("@sendgrid/mail");
  const { sendProcessingIssueEmail } = await import("./emailService");
  const cirrus = await import("./cirrusService");
  const previous = config.email.approverEmails;
  config.email.approverEmails = ["reviewer@example.com"];
  t.after(() => { config.email.approverEmails = previous; });
  t.mock.method(cirrus, "getBridgeEmailTokens", async () => new Map());
  const sent: any[] = [];
  t.mock.method(mail, "send", async (message: any) => { sent.push(message); return [] as any; });
  const waiting = { ...context(), source: "eab" as const, stage: "withdrawal-refund" };
  await f.service.record(waiting, issue("INDEXING_PENDING", { available: "1", required: "2" }));
  const records = Object.values((await f.service.snapshot()).records);
  await sendProcessingIssueEmail(records, false);
  assert.match(sent[0].subject, /Operations check needed — Verifier confirmations still pending/);
  assert.match(sent[0].text, /does not establish whether STRATO transaction processing or Cirrus indexing is delayed/);
  assert.match(sent[0].text, /Who acts next\nPlatform operations team/);
  assert.match(sent[0].text, /Check whether the verifiers' attestation transactions succeeded/);
  assert.match(sent[0].text, /Verifier confirmations visible in Cirrus: 1 of 2/);
  assert.match(sent[0].text, /bridge continues scheduled retries/);
  assert.match(sent[0].text, /user should not resubmit/);
  assert.match(sent[0].text, /operations check, not an admin vote/);
  assert.doesNotMatch(sent[0].text + sent[0].subject, /has stopped progressing|have stopped progressing|0 of 2/);

  await sendProcessingIssueEmail(records, true);
  assert.match(sent[1].text, /Previously observed: 1 of 2/);
  assert.match(sent[1].text, /Processing may still be in progress/);
  assert.doesNotMatch(sent[1].text + sent[1].subject, /Operations check needed|Who acts next|Next steps|continues scheduled retries|Verifier confirmations visible in Cirrus/);

  await f.service.record(waiting, issue("INDEXING_PENDING"));
  await sendProcessingIssueEmail(Object.values((await f.service.snapshot()).records), false);
  assert.doesNotMatch(sent[2].text, /Verifier confirmations visible in Cirrus:|undefined/);

  await f.service.record(waiting, issue("CONFIRMATIONS_PENDING", { observedConfirmations: "10", requiredConfirmations: "12" }));
  await sendProcessingIssueEmail(Object.values((await f.service.snapshot()).records), false);
  assert.match(sent[3].subject, /Operations check needed — External confirmations still pending/);
  assert.match(sent[3].text, /does not by itself establish that the external network has stalled/);
  assert.match(sent[3].text, /Check the external transaction receipt and current block height/);
  assert.doesNotMatch(sent[3].text + sent[3].subject, /have stopped progressing|has stopped progressing/);
});

test("admin listing paginates active and cleared records without exposing notification state or changing retries", async t => {
  const f = await fixture(t);
  await f.service.record(context("1"), issue("FUNDING_REQUIRED"));
  f.advance(1_000);
  await f.service.record(context("2"), issue("PAUSED"));
  f.advance(1_000);
  await f.service.record(context("3"), issue("DEPENDENCY_UNAVAILABLE"));
  await f.service.resolve(context("2"));
  const before = await f.service.snapshot();
  const first = await f.open().list("active", 0, 1);
  assert.equal(first.total, 2);
  assert.equal(first.items[0].context.reference, "3");
  assert.equal((await f.service.list("active", 1, 1)).items[0].context.reference, "1");
  assert.equal((await f.service.list("active", 2, 1)).items.length, 0);
  const cleared = await f.service.list("cleared", 0, 25);
  assert.equal(cleared.total, 1);
  assert.equal(cleared.items[0].outcome, "processing_resumed");
  assert.equal("notifications" in first, false);
  assert.equal("version" in first, false);
  assert.deepEqual(await f.service.snapshot(), before, "reading cannot change retry or email state");
  for (const [offset, limit] of [[-1, 1], [0, 101], [0, 0], [1.5, 10]]) {
    await assert.rejects(f.service.list("active", offset, limit), /pagination/);
  }
  writeFileSync(f.file, "null");
  await assert.rejects(f.open().list("active", 0, 25), /Invalid processing issue journal/);
});


test("refilling capacity stays quiet while progressing; impossible capacity alerts immediately", async t => {
  const f = await fixture(t);
  await f.service.record(context(), issue("WITHDRAWAL_CAPACITY", { available: "1", retryAfterSeconds: "600" }));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 0);
  f.advance(6 * 60_000);
  await f.service.record(context(), issue("WITHDRAWAL_CAPACITY", { available: "2", retryAfterSeconds: "240" }));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 0);
  f.advance(6 * 60_000);
  await f.service.record(context(), issue("WITHDRAWAL_CAPACITY", { available: "2", retryAfterSeconds: "240" }));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 1);
  await f.service.record({ ...context("2"), token: "3".repeat(40) }, issue("WITHDRAWAL_CAPACITY"));
  await f.service.notify(f.send);
  assert.equal(f.sent.length, 2);
});

test("unknown funding account is not guessed from withdrawal stage", async t => {
  const f = await fixture(t);
  const issues = await f.service.record({ ...context(), source: "eab" }, issue("FUNDING_REQUIRED"));
  assert.equal(issues[0].details.account, undefined);
  const known = await f.service.record({ ...context(), source: "eab" }, issue("FUNDING_REQUIRED", { account: "relayer", feeAsset: "USDST-or-vouchers" }));
  assert.equal(known[0].details.account, "relayer");
});

test("refund reconciliation accepts historical EAB references and native refunded status", async t => {
  const { cirrus } = await import("../utils/api");
  const { getCompletedProcessingContexts } = await import("./cirrusService");
  const router = "a".repeat(40);
  const inputs = [
    { ...context(`${router}:18`), source: "eab" as const, stage: "deposit-refund" },
    { ...context(`11155111:${router}:18`), source: "eab" as const, stage: "deposit-refund" },
    { ...context("42"), stage: "deposit-refund" },
  ];
  t.mock.method(cirrus, "get", async (table: string, { params }: any) => {
    if (params.offset) return [];
    if (table.includes("ExternalAssetBridge")) return [{ key: "11155111", key2: router, key3: "18", value: { status: "6" } }];
    assert.match(params["value->>bridgeStatus"], /8/);
    return [{ key: "42", value: { bridgeStatus: "8" } }];
  });
  assert.equal((await getCompletedProcessingContexts(inputs)).length, 3);
});


test("mint refill eligibility requires enough maximum capacity", async () => {
  const { capacityCanRefill } = await import("../utils/processingIssues");
  assert.equal(capacityCanRefill(processingIssue("MINT_CAPACITY", { required: "100", capacity: "100", refillRate: "1" })), true);
  assert.equal(capacityCanRefill(processingIssue("MINT_CAPACITY", { required: "101", capacity: "100", refillRate: "1" })), false);
  assert.equal(capacityCanRefill(processingIssue("MINT_CAPACITY", { required: "100", capacity: "100", refillRate: "0" })), false);
});
