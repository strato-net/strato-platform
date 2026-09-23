import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const address = (digit: string) => `0x${digit.repeat(40)}`;

async function worker() {
  const phase = process.argv[3];
  const statePath = join(process.cwd(), "remote.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const persist = () => writeFileSync(statePath, JSON.stringify(state));
  for (const name of [
    "ALCHEMY_API_KEY", "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID",
    "OPENID_DISCOVERY_URL", "BRIDGE_ADDRESS", "EXTERNAL_ASSET_BRIDGE_ADDRESS",
    "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS",
    "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION", "RELAYER_BA_USERNAME",
    "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_ID", "RELAYER_CLIENT_SECRET",
    "RELAYER_OPENID_DISCOVERY_URL", "STRATO_NODE_URL", "VAULT_PROXY_ADDRESS",
    "VOUCHER_CONTRACT_ADDRESS",
  ]) process.env[name] = "1".repeat(40);
  process.env.SENDGRID_API_KEY = "SG.test.test";
  process.env.CHAIN_1_RPC_URL = "https://rpc.invalid";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS = address("9");
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID = "test-key";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION = "us-east-1";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = "https://one.invalid,https://two.invalid";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = "one,two";

  const { config } = await import("../config");
  config.safe.address = `0x${"1".repeat(40)}`;
  config.safe.safeProposerAddress = `0x${"2".repeat(40)}`;
  const rpc = await import("./rpcService");
  (rpc as any).getChainProvider = () => ({ getBlock: async () => ({ timestamp: phase === "expired" ? 10 ** 12 : 1000 }) });
  const safe = await import("../utils/safeHelper");
  (safe as any).initializeSafeForChain = async () => ({
    protocolKit: {
      createTransaction: async (input: any) => ({ data: { ...input.transactions[0], nonce: input.options.nonce } }),
      getTransactionHash: async (tx: any) => `0x${String(tx.data.nonce).padStart(64, "0")}`,
      signHash: async () => ({ data: "0xsigned" }),
    },
    apiKit: {
      getNextNonce: async () => { state.nonces++; persist(); return phase === "concurrent" || phase === "queued-failure" ? 1 : state.nonces; },
      getTransaction: async () => {
        if (phase === "missing") throw Object.assign(Error("Not Found"), { statusCode: 404 });
        if (phase === "outage") throw Object.assign(Error("Unavailable"), { statusCode: 503 });
        return {};
      },
      proposeTransaction: async (proposal: any) => {
        state.hashes.push(proposal.safeTxHash); persist();
        if (phase === "crash") throw Error("lost response after remote acceptance");
        if (phase === "queued-failure" && proposal.safeTransactionData.nonce === 1) throw Error("first proposal failed");
      },
    },
  });
  const { proposeWithdrawalReview } = await import("./externalWithdrawalService");
  const review = { sourceChainId: "9", sourceBridge: `0x${"3".repeat(40)}`, sourceWithdrawalId: "7",
    destinationChainId: "1", destinationVault: `0x${"4".repeat(40)}`, token: `0x${"5".repeat(40)}`,
    recipient: `0x${"6".repeat(40)}`, amount: "100" };
  if (phase === "crash" || phase === "outage" || phase === "corrupt") await assert.rejects(proposeWithdrawalReview(review));
  else if (phase === "queued-failure") {
    const first = proposeWithdrawalReview(review);
    const secondReview = { ...review, sourceWithdrawalId: "8" };
    const second = proposeWithdrawalReview(secondReview);
    assert.equal(proposeWithdrawalReview(secondReview), second, "same-review dedup must remain intact");
    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0].status, "rejected", "the failed caller must still receive its rejection");
    assert.equal(results[1].status, "fulfilled", "an earlier failure must not skip a queued review");
  } else if (phase === "concurrent") {
    await Promise.all([proposeWithdrawalReview(review), proposeWithdrawalReview({ ...review, sourceWithdrawalId: "8" })]);
  } else await Promise.all([proposeWithdrawalReview(review), proposeWithdrawalReview(review)]);
}

if (process.argv[2] === "worker") {
  worker().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  for (const phase of ["concurrent", "queued-failure"]) test(`queued Safe reviews preserve nonce reservations (${phase})`, () => {
    const directory = mkdtempSync(join(tmpdir(), "safe-concurrent-"));
    writeFileSync(join(directory, "remote.json"), JSON.stringify({ nonces: 0, hashes: [] }));
    try {
      const child = spawnSync(process.execPath, [__filename, "worker", phase], { cwd: directory, encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr + child.stdout);
      const state = JSON.parse(readFileSync(join(directory, "remote.json"), "utf8"));
      assert.equal(new Set(state.hashes).size, 2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("Safe reviews reuse persisted transactions after ambiguous submission and restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "safe-review-"));
    const statePath = join(directory, "remote.json");
    writeFileSync(statePath, JSON.stringify({ nonces: 0, hashes: [] }));
    const run = (phase: string) => {
      const child = spawnSync(process.execPath, [__filename, "worker", phase], { cwd: directory, encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr + child.stdout);
      return JSON.parse(readFileSync(statePath, "utf8"));
    };
    try {
      run("crash");
      assert.equal(run("restart").nonces, 1);
      assert.equal(run("missing").nonces, 1);
      assert.equal(run("outage").nonces, 1);
      const beforeExpiry = JSON.parse(readFileSync(statePath, "utf8"));
      assert.equal(new Set(beforeExpiry.hashes).size, 1);
      assert.equal(run("expired").nonces, 2);
      const journals = join(directory, "data", "safe-reviews");
      const journal = readdirSync(journals).find((file) => file.endsWith(".json"))!;
      const beforeCorruption = JSON.parse(readFileSync(statePath, "utf8"));
      writeFileSync(join(journals, journal), "{corrupt");
      assert.deepEqual(run("corrupt"), beforeCorruption, "corrupt journals must not produce replacement proposals");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
