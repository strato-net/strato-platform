import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Interface } from "ethers";

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


test("reconstructs recorded reviews after cache loss without authorizing settlement", async () => {
  const oldCwd = process.cwd();
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "deposit-recovery-")));
  process.chdir(directory);
  const { cirrus } = await import("../utils/api");
  const rpc = await import("./rpcService");
  const { depositStateService: state } = await import("./depositStateService");
  const { recoverReviewedDeposit, reconcileRecordedDepositReviews } = await import("./depositRecoveryService");
  const originalGet = cirrus.get;
  const originalReceipts = rpc.getTransactionReceiptsBatch;
  const router = "1".repeat(40), sender = "2".repeat(40), token = "3".repeat(40);
  const recipient = "4".repeat(40), target = "5".repeat(40), actionToken = "6".repeat(40);
  const txHash = `0x${"a".repeat(64)}`;
  const blockHash = `0x${"b".repeat(64)}`;
  const value = {
    externalTxHash: txHash, externalSender: sender, externalToken: token,
    externalTokenAmount: "100", stratoRecipient: recipient, stratoToken: target,
  };
  const intent = { action: "4", actionToken, minFinalOut: "90" };
  const iface = new Interface([
    "event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)",
  ]);
  const receipt = {
    status: "0x1", transactionHash: txHash, blockHash, blockNumber: "0xa",
    logs: [1, 2].map((id) => ({
      address: `0x${router}`, logIndex: `0x${id}`,
      ...iface.encodeEventLog(iface.getEvent("DepositRoutedWithAction")!, [
        `0x${token}`, 100n, `0x${sender}`, `0x${recipient}`, `0x${target}`, id,
        4, `0x${actionToken}`, 90n,
      ]),
    })),
  };
  let receiptAvailable = true;
  let rpcCalls = 0;
  let sourceReviewed = true;
  (cirrus as any).get = async (table: string, { params }: any) => {
    assert.equal(params.key, "eq.1");
    if (table.endsWith("-deposits")) {
      assert.equal(params["value->>status"], "eq.2");
      assert.equal(params.offset, 0);
      if (params.key2) assert.equal(params.key2, `eq.${router}`);
      return sourceReviewed ? [{ key2: router, key3: "2", value }] : [];
    }
    assert.ok(table.endsWith("-depositActions"));
    assert.equal(params.or, `(and(key2.eq.${router},key3.eq.2))`);
    return [{ key2: router, key3: "2", value: intent }];
  };
  (rpc as any).getTransactionReceiptsBatch = async (chainId: number, hashes: string[]) => {
    assert.equal(chainId, 1);
    assert.deepEqual(hashes, [txHash]);
    rpcCalls++;
    return receiptAvailable ? new Map([[txHash, receipt]]) : new Map();
  };
  const statePath = path.join(directory, "data/pendingExternalDeposits.json");
  try {
    await reconcileRecordedDepositReviews(1);
    const restored = await state.getByIdentity(1, router, "2");
    assert.equal(restored?.status, "review");
    assert.equal(restored?.reviewRecordedOnchain, true);
    assert.equal(restored?.deposit.externalLogIndex, 2);
    assert.equal((restored?.deposit as any).minFinalOut, "90");
    assert.equal((await state.list(1)).length, 0);
    assert.equal(await state.oldestPendingBlock(1), undefined);
    await reconcileRecordedDepositReviews(1);
    assert.equal(rpcCalls, 1);

    await fs.unlink(statePath);
    const recovered = await recoverReviewedDeposit(1, `0x${router}`, "2");
    assert.equal(recovered.status, "review");
    assert.equal(recovered.deposit.depositId, "2");
    await fs.unlink(statePath);
    receipt.transactionHash = `0x${"c".repeat(24)}${"a".repeat(40)}`;
    await assert.rejects(recoverReviewedDeposit(1, router, "2"), /receipt is missing/);
    receipt.transactionHash = txHash;
    intent.minFinalOut = "91";
    await assert.rejects(recoverReviewedDeposit(1, router, "2"), /amount or action do not match/);
    intent.minFinalOut = "90";
    value.externalSender = "7".repeat(40);
    await assert.rejects(recoverReviewedDeposit(1, router, "2"), /fields, amount or action do not match/);
    value.externalSender = sender;
    receiptAvailable = false;
    await assert.rejects(recoverReviewedDeposit(1, router, "2"), /receipt is missing/);
    await reconcileRecordedDepositReviews(1);
    assert.equal((await state.listReviews(1)).length, 0);
    receiptAvailable = true;
    await reconcileRecordedDepositReviews(1);
    assert.equal((await state.listReviews(1)).length, 1);
    sourceReviewed = false;
    await assert.rejects(recoverReviewedDeposit(1, router, "2"), /pending review is unavailable/);
  } finally {
    cirrus.get = originalGet;
    (rpc as any).getTransactionReceiptsBatch = originalReceipts;
    process.chdir(oldCwd);
  }
});
