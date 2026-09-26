import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";

for (const name of [
  "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL",
  "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID",
  "RELAYER_OPENID_DISCOVERY_URL", "BRIDGE_ADDRESS", "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION", "TOKEN_ROUTER",
]) process.env[name] ||= "1111111111111111111111111111111111111111";
process.env.SENDGRID_API_KEY ||= "SG.test.test";

const { HealthMonitor, healthMonitor } = require("./healthMonitor") as typeof import("./healthMonitor");
const { HEALTH_POLL_TIMEOUT_MS } = require("../config") as typeof import("../config");
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("readiness requires startup and completed polling, including empty queues", () => {
  const health = new HealthMonitor();
  assert.equal(health.snapshot().status, false);
  health.markReady();
  assert.equal(health.snapshot().status, false);
  health.beginPoll("deposits", 1000);
  assert.equal(health.snapshot().checks.deposits, "starting");
  health.finishPoll("deposits");
  assert.equal(health.snapshot().status, true);
});

test("a failed poll stays unhealthy until that poll succeeds; other successes cannot clear it", () => {
  const health = new HealthMonitor();
  health.markReady();
  health.beginPoll("deposits", 1000);
  health.failPoll("deposits");
  health.finishPoll("deposits");
  health.beginPoll("withdrawals", 1000);
  health.finishPoll("withdrawals");
  assert.equal(health.snapshot().status, false);
  health.beginPoll("deposits", 1000);
  assert.equal(health.snapshot().checks.deposits, "failed");
  health.finishPoll("deposits");
  assert.equal(health.snapshot().status, true);
});

test("hung polls, missing scheduled polls, and websocket chain work become unhealthy", (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const health = new HealthMonitor();
  health.markReady();
  health.beginPoll("deposits", 1000);
  health.finishPoll("deposits");
  health.beginPoll("deposits", 1000);
  now = HEALTH_POLL_TIMEOUT_MS + 1;
  assert.equal(health.beginPoll("deposits", 1000), false);
  assert.equal(health.snapshot().checks.deposits, "stalled");
  health.finishPoll("deposits");
  assert.equal(health.snapshot().status, true);
  now += 1000 + HEALTH_POLL_TIMEOUT_MS + 1;
  assert.equal(health.snapshot().checks.deposits, "stalled");
  health.beginPoll("deposits", 1000);
  health.finishPoll("deposits");
  health.beginOperation("externalDepositChain:1");
  now += HEALTH_POLL_TIMEOUT_MS + 1;
  health.beginPoll("deposits", 1000);
  health.finishPoll("deposits");
  assert.equal(health.snapshot().checks["externalDepositChain:1"], "stalled");
  assert.equal(health.snapshot().status, false);
  health.finishOperation("externalDepositChain:1");
  assert.equal(health.snapshot().status, true);
});

test("a logged policy rejection and historical error file preserve healthy polling", async (t) => {
  const writes: string[] = [];
  t.mock.method(fs, "appendFile", async (_file, content) => { writes.push(String(content)); });
  t.mock.method(fs, "stat", async () => ({ size: 59925 }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  healthMonitor.markReady();
  healthMonitor.beginPoll("test", 1000);
  healthMonitor.finishPoll("test");
  const { logError } = await import("./logger");
  logError("SettlementAttestation", new Error("Local verifier policy rejects the deposit action"), { depositId: "14" });
  await flush();
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).error.data.depositId, "14");
  assert.equal(await healthMonitor.errorFileExists(), true);
  assert.equal(healthMonitor.snapshot().status, true);
});

test("external withdrawal polling reports query failures and isolates item rejection on recovery", async (t) => {
  const cirrus = await import("../services/cirrusService");
  const bridge = await import("../services/bridgeService");
  const logger = await import("./logger");
  const { startExternalWithdrawalPolling } = await import("../polling/stratoPolling");
  const retries: (() => Promise<void>)[] = [];
  t.mock.method(global, "setTimeout", (callback) => { retries.push(callback); return {} as NodeJS.Timeout; });
  t.mock.method(logger, "logError", () => {});
  let available = false;
  t.mock.method(cirrus, "getExternalWithdrawalsByStatus", async (status) => {
    if (!available) throw new Error("Cirrus unavailable");
    return status === "1" ? [{ withdrawalId: "14", requiresManualReview: false }] as any : [];
  });
  t.mock.method(bridge, "processExternalWithdrawal", async () => { throw new Error("policy rejection"); });
  startExternalWithdrawalPolling();
  await flush();
  assert.equal(healthMonitor.snapshot().checks.startExternalWithdrawalPolling, "failed");
  available = true;
  await retries.shift()!();
  assert.equal(healthMonitor.snapshot().checks.startExternalWithdrawalPolling, "ok");
});

test("external deposit polling exposes query failure and recovers with no enabled chains", async (t) => {
  const cirrus = await import("../services/cirrusService");
  const logger = await import("./logger");
  const { startMultiChainDepositPolling } = await import("../polling/alchemyPolling");
  let poll: () => Promise<void>;
  t.mock.method(global, "setInterval", (callback) => { poll = callback; return {} as NodeJS.Timeout; });
  t.mock.method(logger, "logError", () => {});
  t.mock.method(logger, "logInfo", async () => {});
  let available = false;
  t.mock.method(cirrus, "getEnabledChains", async () => {
    if (!available) throw new Error("Cirrus unavailable");
    return new Map();
  });
  t.mock.method(cirrus, "getBridgeInfo", async () => ({} as any));
  startMultiChainDepositPolling();
  await flush();
  assert.equal(healthMonitor.snapshot().checks.externalDeposits, "failed");
  available = true;
  await poll!();
  assert.equal(healthMonitor.snapshot().checks.externalDeposits, "ok");
});

test("native redemption polling exposes query failure and recovers", async (t) => {
  const cirrus = await import("../services/cirrusService");
  const logger = await import("./logger");
  const { startNativeRedemptionPolling } = await import("../polling/nativeRedemptionPolling");
  const retries: (() => Promise<void>)[] = [];
  t.mock.method(global, "setTimeout", (callback) => { retries.push(callback); return {} as NodeJS.Timeout; });
  t.mock.method(logger, "logError", () => {});
  t.mock.method(logger, "logInfo", async () => {});
  let available = false;
  t.mock.method(cirrus, "getEnabledChains", async () => {
    if (!available) throw new Error("Cirrus unavailable");
    return new Map();
  });
  startNativeRedemptionPolling();
  await flush();
  assert.equal(healthMonitor.snapshot().checks.nativeRedemptions, "failed");
  available = true;
  await retries.shift()!();
  assert.equal(healthMonitor.snapshot().checks.nativeRedemptions, "ok");
});

test("a rejected external chain scan makes the polling health fail", async (t) => {
  const cirrus = await import("../services/cirrusService");
  const recovery = await import("../services/depositRecoveryService");
  const { depositStateService } = await import("../services/depositStateService");
  const logger = await import("./logger");
  const { startMultiChainDepositPolling } = await import("../polling/alchemyPolling");
  t.mock.method(global, "setInterval", () => ({} as NodeJS.Timeout));
  t.mock.method(logger, "logError", () => {});
  t.mock.method(cirrus, "getEnabledChains", async () => new Map([[999, {
    externalChainId: 999, depositRouter: "1".repeat(40), lastProcessedBlock: 1, enabled: true, chainName: "test",
  }]]));
  t.mock.method(cirrus, "getBridgeInfo", async () => ({} as any));
  t.mock.method(recovery, "reconcileRecordedDepositReviews", async () => {});
  t.mock.method(depositStateService, "listReviews", async () => { throw new Error("deposit state unavailable"); });
  startMultiChainDepositPolling();
  await flush();
  assert.equal(healthMonitor.snapshot().checks.externalDeposits, "failed");
});

test("native deposit query errors caught inside a STRATO poll still affect health", async (t) => {
  const cirrus = await import("../services/cirrusService");
  const logger = await import("./logger");
  const { startNativeDepositInitiatedPolling } = await import("../polling/stratoPolling");
  const retries: (() => Promise<void>)[] = [];
  t.mock.method(global, "setTimeout", (callback) => { retries.push(callback); return {} as NodeJS.Timeout; });
  t.mock.method(logger, "logError", () => {});
  let available = false;
  t.mock.method(cirrus, "getNativeDepositsByStatus", async () => {
    if (!available) throw new Error("Cirrus unavailable");
    return [];
  });
  startNativeDepositInitiatedPolling();
  await flush();
  assert.equal(healthMonitor.snapshot().checks.startNativeDepositInitiatedPolling, "failed");
  available = true;
  await retries.shift()!();
  assert.equal(healthMonitor.snapshot().checks.startNativeDepositInitiatedPolling, "ok");
});
