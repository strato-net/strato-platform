import {
  NativeDepositInfo,
  NativeVerificationResults,
  NativeWithdrawalInfo,
  NativeVerificationRpc,
} from "../types";
import { AbiCoder, Interface, keccak256, ZeroAddress as ZERO_ADDRESS } from "ethers";
import {
  NATIVE_CANCELLATION_ABI,
  NATIVE_MINT_EVENT_ABI,
  NATIVE_REFUND_ABI,
} from "../config/bridgeAbi";
import { processingIssue } from "../utils/processingIssues";
import { parseNativeDepositLog } from "../utils/nativeRedemption";

const normalizeAddress = (value: string) =>
  value.toLowerCase().replace(/^0x/, "");

const mintInterface = new Interface(NATIVE_MINT_EVENT_ABI);
const refundInterface = new Interface(NATIVE_REFUND_ABI);
const cancellationInterface = new Interface(NATIVE_CANCELLATION_ABI);

const receiptBlockNumber = (receipt: any): number | undefined => {
  if (typeof receipt?.blockNumber !== "string" ||
      !/^0x[0-9a-f]+$/i.test(receipt.blockNumber)) return undefined;
  const value = Number(BigInt(receipt.blockNumber));
  return Number.isSafeInteger(value) ? value : undefined;
};

const requireFinalizedReceipt = async (
  chainId: number,
  transactionHash: string,
  receipt: any,
  confirmations: number,
  rpc: NativeVerificationRpc,
  pendingMessage: string,
): Promise<void> => {
  const blockNumber = receiptBlockNumber(receipt);
  if (receipt?.__rpcDisagreement) {
    throw Object.assign(new Error("Native receipt RPC disagreement"), {
      issues: [processingIssue("DEPENDENCY_UNAVAILABLE", { transactionHash })],
    });
  }
  if (!receipt || blockNumber === undefined ||
      !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "")) {
    throw Object.assign(new Error(pendingMessage), {
      issues: [processingIssue("CONFIRMATIONS_PENDING", {
        transactionHash,
        requiredConfirmations: String(confirmations),
      })],
    });
  }
  const [latestBlock, finalizedBlock, canonicalHash] = await Promise.all([
    rpc.getVerificationBlockNumber(chainId),
    rpc.getFinalizedBlockNumber(chainId),
    rpc.getVerifiedBlockHash(chainId, blockNumber),
  ]);
  if (canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error("Native receipt block is not canonical");
  }
  if (blockNumber + confirmations > latestBlock || blockNumber > finalizedBlock) {
    throw Object.assign(new Error(pendingMessage), {
      issues: [processingIssue("CONFIRMATIONS_PENDING", {
        transactionHash,
        observedConfirmations: String(Math.max(0, latestBlock - blockNumber)),
        requiredConfirmations: String(confirmations),
        receiptBlock: String(blockNumber),
        finalizedBlock: String(finalizedBlock),
      })],
    });
  }
};

export const verifyNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
  sourceBridge: string,
  transactionHash: string,
  rpc: NativeVerificationRpc,
): Promise<void> => {
  const chainId = Number(withdrawal.externalChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid native destination chain configuration");
  const confirmations = rpc.getDepositConfirmationPolicy(chainId);
  const receipts = await rpc.getTransactionReceiptsBatch(chainId, [transactionHash]);
  const receipt = receipts.get(transactionHash);
  await requireFinalizedReceipt(
    chainId, transactionHash, receipt, confirmations, rpc,
    "Native mint awaiting finalized confirmation",
  );
  const mintId = keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"], [sourceChainId, `0x${normalizeAddress(sourceBridge)}`, withdrawal.withdrawalId],
  ));
  const matches = String(receipt.transactionHash || "").toLowerCase() === transactionHash.toLowerCase() &&
    /^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "") && receipt.status === "0x1" && receipt.logs?.some((log: any) => {
    if (normalizeAddress(log.address || "") !== normalizeAddress(withdrawal.externalBridge) || log.removed) return false;
    try {
      const args = mintInterface.parseLog(log)?.args;
      return args && BigInt(args.sourceChainId) === sourceChainId &&
        normalizeAddress(args.sourceBridge) === normalizeAddress(sourceBridge) &&
        BigInt(args.sourceWithdrawalId) === BigInt(withdrawal.withdrawalId) &&
        normalizeAddress(args.stratoToken) === normalizeAddress(withdrawal.stratoToken) &&
        normalizeAddress(args.representationToken) === normalizeAddress(withdrawal.representationToken) &&
        normalizeAddress(args.recipient) === normalizeAddress(withdrawal.externalRecipient) &&
        BigInt(args.amount) === BigInt(withdrawal.externalTokenAmount) && args.mintId === mintId;
    } catch { return false; }
  });
  if (!matches) throw Object.assign(new Error("Native mint evidence does not match the withdrawal"), {
    issues: [processingIssue("CONFIGURATION", { transactionHash, operation: "verifyNativeMint" })],
  });
};

export const verifyNativeRedemptionRefund = async (
  deposit: NativeDepositInfo,
  transactionHash: string,
  rpc: NativeVerificationRpc,
): Promise<void> => {
  const chainId = Number(deposit.externalChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid native refund chain configuration");
  }
  const confirmations = rpc.getDepositConfirmationPolicy(chainId);
  const receipts = await rpc.getTransactionReceiptsBatch(chainId, [transactionHash]);
  const receipt = receipts.get(transactionHash);
  await requireFinalizedReceipt(
    chainId, transactionHash, receipt, confirmations, rpc,
    "Native refund awaiting finalized confirmation",
  );
  const matches =
    String(receipt.transactionHash || "").toLowerCase() ===
      transactionHash.toLowerCase() &&
    /^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "") &&
    receipt.status === "0x1" &&
    receipt.logs?.some((log: any) => {
      if (
        normalizeAddress(log.address || "") !==
          normalizeAddress(deposit.externalBridge) ||
        log.removed
      ) {
        return false;
      }
      try {
        const args = refundInterface.parseLog(log)?.args;
        return (
          args &&
          BigInt(args.redemptionId) === BigInt(deposit.externalRedemptionId) &&
          normalizeAddress(args.representationToken) ===
            normalizeAddress(deposit.representationToken) &&
          normalizeAddress(args.recipient) ===
            normalizeAddress(deposit.externalSender) &&
          BigInt(args.amount) === BigInt(deposit.stratoTokenAmount)
        );
      } catch {
        return false;
      }
    });
  if (!matches) {
    throw new Error("Native refund evidence does not match the deposit");
  }
};

export const verifyNativeMintCancellation = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
  sourceBridge: string,
  transactionHash: string,
  rpc: NativeVerificationRpc,
): Promise<void> => {
  const chainId = Number(withdrawal.externalChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid native cancellation chain configuration");
  }
  const confirmations = rpc.getDepositConfirmationPolicy(chainId);
  const receipts = await rpc.getTransactionReceiptsBatch(chainId, [transactionHash]);
  const receipt = receipts.get(transactionHash);
  await requireFinalizedReceipt(
    chainId, transactionHash, receipt, confirmations, rpc,
    "Native cancellation awaiting finalized confirmation",
  );
  const mintId = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [sourceChainId, `0x${normalizeAddress(sourceBridge)}`, withdrawal.withdrawalId],
    ),
  );
  const matches =
    String(receipt.transactionHash || "").toLowerCase() ===
      transactionHash.toLowerCase() &&
    /^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "") &&
    receipt.status === "0x1" &&
    receipt.logs?.some((log: any) => {
      if (
        normalizeAddress(log.address || "") !==
          normalizeAddress(withdrawal.externalBridge) ||
        log.removed
      ) {
        return false;
      }
      try {
        const args = cancellationInterface.parseLog(log)?.args;
        return (
          args &&
          args.mintId === mintId &&
          BigInt(args.sourceChainId) === sourceChainId &&
          normalizeAddress(args.sourceBridge) === normalizeAddress(sourceBridge) &&
          BigInt(args.sourceWithdrawalId) === BigInt(withdrawal.withdrawalId)
        );
      } catch {
        return false;
      }
    });
  if (!matches) {
    throw new Error("Native mint cancellation evidence mismatch");
  }
};

export const verifyNativeRedemptionsBatch = async (
  deposits: NativeDepositInfo[],
  rpc: NativeVerificationRpc,
): Promise<NativeVerificationResults> => {
  const results = Object.assign(new Map<string, boolean>(), {
    dependencyFailures: [],
  }) as NativeVerificationResults;

  if (deposits.length === 0) {
    return results;
  }

  const depositsByChain = new Map<number, NativeDepositInfo[]>();
  for (const deposit of deposits) {
    const externalChainId = Number(deposit.externalChainId);
    const chainDeposits = depositsByChain.get(externalChainId) || [];
    chainDeposits.push(deposit);
    depositsByChain.set(externalChainId, chainDeposits);
  }

  for (const [externalChainId, chainDeposits] of depositsByChain) {
    let confirmations: number, receipts: Map<string, any>, latestBlock: number, finalizedBlock: number;
    const canonicalHashes = new Map<number, string>();
    try {
      confirmations = rpc.getDepositConfirmationPolicy(externalChainId);
      [receipts, latestBlock, finalizedBlock] = await Promise.all([
        rpc.getTransactionReceiptsBatch(externalChainId, [...new Set(chainDeposits.map((deposit) => deposit.externalTxHash))]),
        rpc.getVerificationBlockNumber(externalChainId),
        rpc.getFinalizedBlockNumber(externalChainId),
      ]);
    } catch (error) {
      rpc.logError?.("NativeVerificationService", error as Error, { externalChainId });
      results.dependencyFailures.push({
        externalChainId,
        depositIds: chainDeposits.map((deposit) => deposit.depositId),
        error: error as Error,
      });
      continue;
    }

    const depositsByBlock = new Map<number, NativeDepositInfo[]>();
    for (const deposit of chainDeposits) {
      const receipt = receipts.get(deposit.externalTxHash);
      const blockNumber = receiptBlockNumber(receipt);
      if (receipt?.__rpcDisagreement) {
        results.dependencyFailures.push({
          externalChainId,
          depositIds: [deposit.depositId],
          externalTxHash: deposit.externalTxHash,
          error: new Error("Native receipt RPC disagreement"),
        });
      } else if (receipt && blockNumber !== undefined &&
          blockNumber + confirmations <= latestBlock && blockNumber <= finalizedBlock) {
        const blockDeposits = depositsByBlock.get(blockNumber) || [];
        blockDeposits.push(deposit);
        depositsByBlock.set(blockNumber, blockDeposits);
      }
    }
    const blocks = [...depositsByBlock.keys()];
    const canonicalReads = await Promise.allSettled(
      blocks.map((block) => rpc.getVerifiedBlockHash(externalChainId, block)),
    );
    canonicalReads.forEach((read, index) => {
      const blockNumber = blocks[index];
      if (read.status === "fulfilled") {
        canonicalHashes.set(blockNumber, read.value);
        return;
      }
      const error = read.reason instanceof Error ? read.reason : new Error(String(read.reason));
      const blockDeposits = depositsByBlock.get(blockNumber) || [];
      rpc.logError?.("NativeVerificationService", error, { externalChainId, blockNumber });
      results.dependencyFailures.push({
        externalChainId,
        depositIds: blockDeposits.map((deposit) => deposit.depositId),
        blockNumber,
        error,
      });
    });

    for (const deposit of chainDeposits) {
      try {
        const expectedBridgeAddress = deposit.externalBridge;
        if (!expectedBridgeAddress) {
          results.set(deposit.depositId, false);
          continue;
        }

        const receipt = receipts.get(deposit.externalTxHash);
        const blockNumber = receiptBlockNumber(receipt);
        // Missing, disputed or immature evidence stays pending; it is not a failed deposit.
        if (!receipt || receipt.__rpcDisagreement || blockNumber === undefined ||
            blockNumber + confirmations > latestBlock || blockNumber > finalizedBlock) continue;
        if (!canonicalHashes.has(blockNumber)) continue;
        if (canonicalHashes.get(blockNumber)?.toLowerCase() !==
            String(receipt.blockHash || "").toLowerCase()) {
          const error = new Error("Native receipt and canonical block RPC evidence disagree");
          rpc.logError?.("NativeVerificationService", error, {
            externalChainId,
            externalTxHash: deposit.externalTxHash,
            blockNumber,
          });
          results.dependencyFailures.push({
            externalChainId,
            depositIds: [deposit.depositId],
            externalTxHash: deposit.externalTxHash,
            blockNumber,
            error,
          });
          continue;
        }
        if (receipt.status !== "0x1" ||
            String(receipt.transactionHash || "").toLowerCase() !== deposit.externalTxHash.toLowerCase() ||
            !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || "")) {
          results.set(deposit.depositId, false);
          continue;
        }

        const verified = receipt.logs.some((log) => {
          if (log.removed || !log.address || normalizeAddress(log.address) !== normalizeAddress(expectedBridgeAddress)) return false;
          const event = parseNativeDepositLog(externalChainId, { ...log, transactionHash: deposit.externalTxHash });
          return event !== null &&
            normalizeAddress(event.externalBridge) === normalizeAddress(deposit.externalBridge) &&
            normalizeAddress(event.representationToken) === normalizeAddress(deposit.representationToken) &&
            normalizeAddress(event.externalSender) === normalizeAddress(deposit.externalSender) &&
            normalizeAddress(event.stratoRecipient) === normalizeAddress(deposit.stratoRecipient) &&
            BigInt(event.stratoTokenAmount) === BigInt(deposit.stratoTokenAmount) &&
            BigInt(event.externalRedemptionId) === BigInt(deposit.externalRedemptionId) &&
            normalizeAddress(event.actionToken!) === normalizeAddress(deposit.actionToken || ZERO_ADDRESS) &&
            BigInt(event.minFinalOut!) === BigInt(deposit.minFinalOut || "0");
        });

        results.set(deposit.depositId, verified);
      } catch (error) {
        rpc.logError?.("NativeVerificationService", error as Error, {
          operation: "verifyNativeRedemptionsBatch",
          externalTxHash: deposit.externalTxHash,
        });
        results.set(deposit.depositId, false);
      }
    }
  }

  return results;
};
