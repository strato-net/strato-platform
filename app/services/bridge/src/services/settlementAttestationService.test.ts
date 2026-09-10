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

test("settles with two verifiers when the third stalls until the deadline", async () => {
  const cirrusService = await import("./cirrusService");
  let threshold = 2;
  (cirrusService as any).getSettlementVerifierConfig = async () => ({
    threshold,
    count: 3,
    verifiers: [],
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
  AbortSignal.timeout = (milliseconds) => {
    assert.equal(milliseconds, 60_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("verifier deadline exceeded")), 10);
    return controller.signal;
  };
  const requests: any[] = [];
  (axios as any).post = async (url: string, payload: unknown, options: any) => {
    requests.push({ url, payload });
    assert.equal(options.timeout, 60_000);
    if (url.startsWith("https://three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    return { data: { transactionHash: url } };
  };
  try {
    await attestDepositSettlement(deposit);
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
    verifiers: [],
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
      return { data: { transactionHash: "accepted" } };
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
