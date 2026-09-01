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
