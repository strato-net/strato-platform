import assert from "node:assert/strict";
import test from "node:test";
import { Interface, JsonRpcProvider } from "ethers";
import {
  DepositSettlementAttestation,
  validateDepositSettlement,
  validateWithdrawalRelease,
} from "./settlementValidation";

const router = `0x${"11".repeat(20)}`;
const vault = `0x${"22".repeat(20)}`;
const token = `0x${"33".repeat(20)}`;
const sender = `0x${"44".repeat(20)}`;
const recipient = `0x${"55".repeat(20)}`;
const stratoToken = `0x${"66".repeat(20)}`;
const txHash = `0x${"77".repeat(32)}`;
const blockHash = `0x${"88".repeat(32)}`;
const reservationId = `0x${"99".repeat(32)}`;

const depositInterface = new Interface([
  "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)",
]);
const transferInterface = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const vaultInterface = new Interface([
  "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
]);

const log = (
  contract: string,
  encoded: { data: string; topics: string[] },
  index: number,
) => ({ address: contract, ...encoded, index });

test("independently verifies an exact ERC-20 deposit and custody transfer", async () => {
  const receipt = {
    status: 1,
    blockHash,
    blockNumber: 10,
    logs: [
      log(
        token,
        transferInterface.encodeEventLog(
          transferInterface.getEvent("Transfer")!,
          [sender, vault, 100n],
        ),
        1,
      ),
      log(
        router,
        depositInterface.encodeEventLog(
          depositInterface.getEvent("DepositRoutedWithAction")!,
          [
            token,
            100n,
            sender,
            recipient,
            stratoToken,
            7n,
            4,
            stratoToken,
            90n,
          ],
        ),
        2,
      ),
    ],
  };
  const provider = {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 20,
  } as unknown as JsonRpcProvider;
  const request: DepositSettlementAttestation = {
    externalChainId: "1",
    depositRouter: router,
    depositId: "7",
    externalSender: sender,
    externalToken: token,
    externalTokenAmount: "100",
    externalTxHash: txHash,
    externalBlockHash: blockHash,
    externalLogIndex: 2,
    stratoRecipient: recipient,
    stratoToken,
    action: "4",
    actionToken: stratoToken,
    minFinalOut: "90",
  };

  await validateDepositSettlement(provider, request, vault, [router], 5);
  await assert.rejects(
    () =>
      validateDepositSettlement(
        provider,
        { ...request, externalTokenAmount: "101" },
        vault,
        [router],
        5,
      ),
    /does not match/,
  );
});

test("independently verifies the exact vault release event", async () => {
  const receipt = {
    status: 1,
    to: vault,
    blockNumber: 10,
    logs: [
      log(
        vault,
        vaultInterface.encodeEventLog(
          vaultInterface.getEvent("WithdrawalReleased")!,
          [reservationId, token, recipient, 100n],
        ),
        1,
      ),
    ],
  };
  const provider = {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 20,
  } as unknown as JsonRpcProvider;

  await validateWithdrawalRelease(
    provider,
    {
      withdrawalId: "7",
      reservationId,
      externalTxHash: txHash,
      token,
      recipient,
      amount: "100",
    },
    vault,
    5,
  );
  await assert.rejects(
    () =>
      validateWithdrawalRelease(
        provider,
        {
          withdrawalId: "7",
          reservationId,
          externalTxHash: txHash,
          token,
          recipient,
          amount: "101",
        },
        vault,
        5,
      ),
    /does not match/,
  );
});

test("accepts wrapper releases only with a confirmed, unique matching vault event", async () => {
  const releaseLog = log(
    vault,
    vaultInterface.encodeEventLog(
      vaultInterface.getEvent("WithdrawalReleased")!,
      [reservationId, token, recipient, 100n],
    ),
    1,
  );
  const receipt = { status: 1, to: sender, blockNumber: 10, logs: [releaseLog] };
  const provider = {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 15,
  } as unknown as JsonRpcProvider;
  const request = {
    withdrawalId: "7", reservationId, externalTxHash: txHash,
    token, recipient, amount: "100",
  };
  await validateWithdrawalRelease(provider, request, vault, 5);
  await assert.rejects(
    validateWithdrawalRelease(provider, request, vault, 6),
    /insufficient confirmations/,
  );
  for (const mismatch of [
    { reservationId: txHash }, { token: sender }, { recipient: sender }, { amount: "101" },
  ]) {
    await assert.rejects(
      validateWithdrawalRelease(provider, { ...request, ...mismatch }, vault, 5),
      /event does not match/,
    );
  }
  for (const logs of [[], [{ ...releaseLog, address: sender }], [releaseLog, { ...releaseLog, index: 2 }]]) {
    receipt.logs = logs;
    await assert.rejects(
      validateWithdrawalRelease(provider, request, vault, 5),
      /event does not match/,
    );
  }
  receipt.logs = [releaseLog];
  receipt.status = 0;
  await assert.rejects(
    validateWithdrawalRelease(provider, request, vault, 5),
    /receipt is missing or failed/,
  );
  const missingReceiptProvider = {
    getTransactionReceipt: async () => null,
  } as unknown as JsonRpcProvider;
  await assert.rejects(
    validateWithdrawalRelease(missingReceiptProvider, request, vault, 5),
    /receipt is missing or failed/,
  );
});

test("verifies smart-wallet ETH deposits by invocation, including equal-sized batches", async () => {
  const nativeToken = `0x${"00".repeat(20)}`;
  const receipt = {
    status: 1, blockHash, blockNumber: 10,
    logs: [1, 2].map((id) => log(router, depositInterface.encodeEventLog(
      depositInterface.getEvent("DepositRouted")!,
      [nativeToken, 100n, sender, recipient, stratoToken, BigInt(id)],
    ), id)),
  };
  const pair = (index: number) => [
    { type: "call", traceAddress: [index], action: { from: sender, to: router, value: "0x64" } },
    { type: "call", traceAddress: [index, 0], action: { from: router, to: vault, value: "0x64" } },
  ];
  let traces: any[] = [...pair(0), ...pair(1)];
  const provider = {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 20,
    send: async (method: string, params: string[]) => {
      assert.equal(method, "trace_transaction");
      assert.deepEqual(params, [txHash]);
      return traces;
    },
  } as unknown as JsonRpcProvider;
  const request = {
    externalChainId: "1", depositRouter: router, depositId: "1",
    externalSender: sender, externalToken: nativeToken, externalTokenAmount: "100",
    externalTxHash: txHash, externalBlockHash: blockHash, externalLogIndex: 1,
    stratoRecipient: recipient, stratoToken, action: "0", actionToken: nativeToken, minFinalOut: "0",
  };
  await validateDepositSettlement(provider, request, vault, [router], 5);
  await validateDepositSettlement(provider, { ...request, depositId: "2", externalLogIndex: 2 }, vault, [router], 5);
  for (const invalid of [
    pair(0),
    [...pair(0), { ...pair(1)[0], action: { from: recipient, to: router } }, pair(1)[1]],
    [...pair(0), pair(1)[0], { ...pair(1)[1], action: { from: router, to: vault, value: "0x63" } }],
    [...pair(0), { ...pair(1)[0], error: "Reverted" }, pair(1)[1]],
    [...pair(0), pair(1)[0], { ...pair(1)[1], error: "Reverted" }],
    [...pair(0), ...pair(1), ...pair(2)],
  ]) {
    traces = invalid;
    await assert.rejects(validateDepositSettlement(provider, request, vault, [router], 5), /ETH custody/);
  }
  receipt.logs = receipt.logs.slice(0, 1);
  traces = pair(0);
  await validateDepositSettlement(provider, request, vault, [router], 5);
});
