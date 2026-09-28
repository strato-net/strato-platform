import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

for (const name of [
  "ALCHEMY_API_KEY",
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
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

const deposit = {
  externalChainId: 1,
  depositRouter: "router",
  depositId: "7",
  externalSender: "sender",
  externalToken: "external-token",
  externalTokenAmount: "100",
  observedExternalTokenAmount: "100",
  externalTxHash: "transaction",
  externalBlockHash: "block",
  externalBlockNumber: 10,
  externalBlockTimestamp: 1,
  externalLogIndex: 2,
  detectedAt: 1,
  stratoRecipient: "recipient",
  targetStratoToken: "strato-token",
  action: "4",
  actionToken: "final-token",
  minFinalOut: "90",
};

test("settles before a stalled verifier deadline and cancels the remaining request", async () => {
  const cirrusService = await import("./cirrusService");
  let threshold = 2;
  (cirrusService as any).getSettlementVerifierConfig = async () => ({
    threshold,
    count: 3,
    verifiers: ["one", "two", "three"],
  });
  const { attestDepositSettlement } = await import(
    "./settlementAttestationService"
  );
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS =
    "https://one,https://two,https://three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS =
    "token-one,token-two,token-three";
  const originalPost = axios.post;
  const originalTimeout = AbortSignal.timeout;
  let deadlineFired = false;
  let cancelled = false;
  AbortSignal.timeout = (milliseconds) => {
    assert.equal(milliseconds, 60_000);
    const controller = new AbortController();
    setTimeout(() => { deadlineFired = true; controller.abort(new Error("verifier deadline exceeded")); }, 10);
    return controller.signal;
  };
  const requests: any[] = [];
  (axios as any).post = async (url: string, payload: unknown, options: any) => {
    requests.push({ url, payload });
    assert.equal(options.timeout, 60_000);
    if (url.startsWith("https://three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => { cancelled = true; reject(options.signal.reason); }, { once: true });
      });
    }
    return { data: { transactionHash: url, settlementAttestor: url.split("/")[2] } };
  };
  try {
    await attestDepositSettlement(deposit);
    assert.equal(deadlineFired, false);
    assert.equal(cancelled, true);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0].payload, {
      externalChainId: "1",
      depositRouter: "router",
      depositId: "7",
      externalSender: "sender",
      externalToken: "external-token",
      externalTokenAmount: "100",
      externalTxHash: "transaction",
      externalBlockHash: "block",
      externalLogIndex: 2,
      stratoRecipient: "recipient",
      stratoToken: "strato-token",
      action: "4",
      actionToken: "final-token",
      minFinalOut: "90",
    });

    threshold = 3;
    await assert.rejects(
      () => attestDepositSettlement(deposit),
      /2\/3/,
    );
  } finally {
    axios.post = originalPost;
    AbortSignal.timeout = originalTimeout;
  }
});

test("reports verifier manual review when automatic threshold is not reached", async () => {
  const cirrusService = await import("./cirrusService");
  (cirrusService as any).getSettlementVerifierConfig = async () => ({
    threshold: 2,
    count: 3,
    verifiers: ["one", "two", "three"],
  });
  const {
    attestDepositSettlement,
    SettlementVerifierManualReviewRequired,
  } = await import("./settlementAttestationService");
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS =
    "https://one,https://two,https://three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS =
    "token-one,token-two,token-three";
  const originalPost = axios.post;
  (axios as any).post = async (url: string) => {
    if (url.startsWith("https://one")) {
      return { data: { transactionHash: "accepted", settlementAttestor: "one" } };
    }
    const error: any = new Error("manual review");
    error.isAxiosError = true;
    error.response = {
      status: 409,
      data: { decision: "manual_review" },
    };
    throw error;
  };
  try {
    await assert.rejects(
      () => attestDepositSettlement(deposit),
      (error) => error instanceof SettlementVerifierManualReviewRequired,
    );
  } finally {
    axios.post = originalPost;
  }
});

test("duplicate identities cannot trigger early quorum; a later distinct verifier can", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  let finishThird!: (value: any) => void;
  const third = new Promise((resolve) => { finishThird = resolve; });
  t.mock.method(axios, "post", async (url: string) => url.startsWith("https://three")
    ? third : { data: { transactionHash: "tx", settlementAttestor: "one" } });
  let completed = false;
  const pending = attestDepositSettlement(deposit).then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  finishThird({ data: { transactionHash: "tx-three", settlementAttestor: "three" } });
  await pending;
  assert.equal(completed, true);
});

test("ignores unregistered identities and preserves a late manual-review decision without quorum", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement, SettlementVerifierManualReviewRequired } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  let rejectThird!: (error: any) => void;
  const third = new Promise((_, reject) => { rejectThird = reject; });
  t.mock.method(axios, "post", async (url: string) => {
    if (url.startsWith("https://three")) return third;
    return { data: { transactionHash: "tx", settlementAttestor: url.startsWith("https://one") ? "one" : "unregistered" } };
  });
  let completed = false;
  const pending = attestDepositSettlement(deposit).finally(() => { completed = true; });
  const rejected = assert.rejects(pending, (error) => error instanceof SettlementVerifierManualReviewRequired);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  const error: any = new Error("manual review");
  error.isAxiosError = true;
  error.response = { status: 409, data: { decision: "manual_review" } };
  rejectThird(error);
  await rejected;
});


test("a mixed quorum authorizes fallback only; duplicate or malformed votes cannot complete it", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = "https://one,https://two,https://three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = "token-one,token-two,token-three";
  let mode: unknown = true;
  let duplicate = false;
  t.mock.method(axios, "post", async (url: string) => {
    if (url.startsWith("https://three")) throw new Error("offline");
    return { data: { transactionHash: "tx", settlementAttestor: duplicate ? "one" : url.split("/")[2],
      fallbackOnly: url.startsWith("https://two") ? mode : false } };
  });
  assert.equal(await attestDepositSettlement(deposit), true);
  mode = false;
  assert.equal(await attestDepositSettlement(deposit), false);
  mode = "true";
  await assert.rejects(attestDepositSettlement(deposit), /1\/2/);
  mode = true;
  duplicate = true;
  await assert.rejects(attestDepositSettlement(deposit), /1\/2/);
});

test("prefers a full quorum in every arrival order of two full and one fallback approval", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  for (const order of [
    ["one", "two", "three"], ["two", "one", "three"],
    ["one", "three", "two"], ["two", "three", "one"],
    ["three", "one", "two"], ["three", "two", "one"],
  ]) {
    await t.test(order.join(", "), async (t) => {
      const responses = new Map<string, (value: any) => void>();
      t.mock.method(axios, "post", (url: string, _payload: unknown, options: any) => new Promise((resolve, reject) => {
        responses.set(url.split("/")[2], resolve);
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }));
      let completed = false;
      const pending = attestDepositSettlement(deposit).then((fallbackOnly) => {
        completed = true;
        return fallbackOnly;
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (let i = 0; i < order.length; i++) {
        const attestor = order[i];
        responses.get(attestor)!({ data: { transactionHash: `tx-${attestor}`, settlementAttestor: attestor, fallbackOnly: attestor === "two" } });
        await new Promise((resolve) => setImmediate(resolve));
        const received = order.slice(0, i + 1);
        assert.equal(completed, received.includes("one") && received.includes("three"));
      }
      assert.equal(await pending, false);
    });
  }
});

test("uses fallback immediately when a full quorum is impossible and cancels the remaining request", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  let cancelled = false;
  t.mock.method(axios, "post", async (url: string, _payload: unknown, options: any) => {
    if (url.startsWith("https://three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => { cancelled = true; reject(options.signal.reason); }, { once: true });
      });
    }
    return { data: { transactionHash: url, settlementAttestor: url.split("/")[2], fallbackOnly: true } };
  });
  assert.equal(await attestDepositSettlement(deposit), true);
  assert.equal(cancelled, true);
});

test("waits for the existing deadline before using a mixed quorum when the last verifier stalls", async (t) => {
  const cirrusService = await import("./cirrusService");
  const { attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  const deadlines: AbortController[] = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 60_000);
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  t.mock.method(axios, "post", async (url: string, _payload: unknown, options: any) => {
    if (url.startsWith("https://three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    return { data: { transactionHash: url, settlementAttestor: url.split("/")[2], fallbackOnly: url.startsWith("https://two") } };
  });
  let completed = false;
  const pending = attestDepositSettlement(deposit).then((fallbackOnly) => {
    completed = true;
    return fallbackOnly;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(deadlines.length, 3);
  for (const deadline of deadlines) deadline.abort(new Error("verifier deadline exceeded"));
  assert.equal(await pending, true);
});

test("release confirmation waits stay pending without hiding real verifier failures", async (t) => {
  const cirrusService = await import("./cirrusService");
  const logger = await import("../utils/logger");
  const { WithdrawalReleasePendingError } = await import("../types");
  const { attestWithdrawalRelease, attestDepositSettlement } = await import("./settlementAttestationService");
  t.mock.method(cirrusService, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = "https://one,https://two,https://three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = "token-one,token-two,token-three";
  const errors = t.mock.method(logger, "logError", () => undefined);
  const authorization = { destinationChainId: "1" } as any;
  let mode = "pending";
  t.mock.method(axios, "post", async (url: string) => {
    const identity = url.split("/")[2];
    if (mode === "accepted" && identity !== "three") {
      return { data: { transactionHash: `tx-${identity}`, settlementAttestor: identity } };
    }
    const error: any = new Error("verifier response");
    error.isAxiosError = true;
    error.response = identity === "one"
      ? { status: 409, data: { decision: "pending_confirmations" } }
      : { status: 422, data: { error: "Withdrawal release has insufficient confirmations" } };
    if (mode === "failure" && identity === "three") {
      error.response = { status: 422, data: { error: "Withdrawal release event does not match settlement" } };
    }
    throw error;
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(attestWithdrawalRelease(authorization, "reservation", "tx"), WithdrawalReleasePendingError);
  }
  assert.equal(errors.mock.callCount(), 0);
  mode = "failure";
  await assert.rejects(attestWithdrawalRelease(authorization, "reservation", "tx"), (error) =>
    error instanceof Error && !(error instanceof WithdrawalReleasePendingError) && /threshold not reached/.test(error.message));
  assert.equal(errors.mock.callCount(), 1);
  mode = "pending";
  await assert.rejects(attestDepositSettlement(deposit), /threshold not reached/);
  assert.equal(errors.mock.callCount(), 4);
  mode = "accepted";
  await attestWithdrawalRelease(authorization, "reservation", "tx");
});

test("refund quorum requires matching digests from distinct eligible attestors", async t => {
  const cirrus = await import("./cirrusService");
  const logger = await import("../utils/logger");
  const { attestWithdrawalRefund } = await import("./settlementAttestationService");
  t.mock.method(logger, "logError", () => undefined);
  t.mock.method(cirrus, "getSettlementVerifierConfig", async () => ({ threshold: 2, count: 3, verifiers: ["one", "two", "three"] }));
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = "https://one,https://two,https://three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = "one,two,three";
  const digest = "0x" + "a".repeat(64);
  let mode = "stale";
  t.mock.method(axios, "post", async (url: string) => {
    assert.ok(url.endsWith("/v1/attest-refund"));
    const identity = url.split("/")[2];
    return { data: { transactionHash: `tx-${identity}`, settlementAttestor: mode === "duplicate" ? "one" : identity,
      digest: mode === "stale" && identity !== "one" ? "0x" + "b".repeat(64) : mode === "missing" ? undefined : digest } };
  });
  for (mode of ["stale", "missing", "duplicate"]) {
    await assert.rejects(attestWithdrawalRefund({ destinationChainId: "1" } as any, digest), /threshold not reached/);
  }
  mode = "valid";
  await attestWithdrawalRefund({ destinationChainId: "1" } as any, digest);
});
