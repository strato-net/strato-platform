import { NativeDepositInfo, NativeWithdrawalInfo, NativeVerificationRpc } from "../types";
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
  const [receipts, latestBlock] = await Promise.all([
    rpc.getTransactionReceiptsBatch(chainId, [transactionHash]),
    rpc.getVerificationBlockNumber(chainId),
  ]);
  const receipt = receipts.get(transactionHash);
  const blockNumber = receipt?.blockNumber;
  if (!receipt || receipt.__rpcDisagreement ||
      typeof blockNumber !== "string" || !/^0x[0-9a-f]+$/i.test(blockNumber) ||
      BigInt(blockNumber) + BigInt(confirmations) > BigInt(latestBlock)) {
    throw Object.assign(new Error("Native mint awaiting confirmations"), { issues: [processingIssue("CONFIRMATIONS_PENDING", {
      transactionHash, requiredConfirmations: String(confirmations),
      observedConfirmations: typeof blockNumber === "string" && /^0x[0-9a-f]+$/i.test(blockNumber)
        ? String(BigInt(latestBlock) > BigInt(blockNumber) ? BigInt(latestBlock) - BigInt(blockNumber) : 0n) : "0",
    })] });
  }
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
  const [receipts, latestBlock] = await Promise.all([
    rpc.getTransactionReceiptsBatch(chainId, [transactionHash]),
    rpc.getVerificationBlockNumber(chainId),
  ]);
  const receipt = receipts.get(transactionHash);
  const blockNumber = receipt?.blockNumber;
  if (
    !receipt ||
    receipt.__rpcDisagreement ||
    typeof blockNumber !== "string" ||
    !/^0x[0-9a-f]+$/i.test(blockNumber) ||
    BigInt(blockNumber) + BigInt(confirmations) > BigInt(latestBlock)
  ) {
    throw new Error("Native refund awaiting confirmations");
  }
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
  const [receipts, latestBlock] = await Promise.all([
    rpc.getTransactionReceiptsBatch(chainId, [transactionHash]),
    rpc.getVerificationBlockNumber(chainId),
  ]);
  const receipt = receipts.get(transactionHash);
  const blockNumber = receipt?.blockNumber;
  if (
    !receipt ||
    receipt.__rpcDisagreement ||
    typeof blockNumber !== "string" ||
    !/^0x[0-9a-f]+$/i.test(blockNumber) ||
    BigInt(blockNumber) + BigInt(confirmations) > BigInt(latestBlock)
  ) {
    throw new Error("Native cancellation awaiting confirmations");
  }
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
): Promise<Map<string, boolean>> => {
  const results = new Map<string, boolean>();

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
    const confirmations = rpc.getDepositConfirmationPolicy(externalChainId);
    let receipts: Map<string, any>, latestBlock: number;
    try {
      [receipts, latestBlock] = await Promise.all([
        rpc.getTransactionReceiptsBatch(externalChainId, [...new Set(chainDeposits.map((deposit) => deposit.externalTxHash))]),
        rpc.getVerificationBlockNumber(externalChainId),
      ]);
    } catch (error) {
      rpc.logError?.("NativeVerificationService", error as Error, { externalChainId });
      continue;
    }

    for (const deposit of chainDeposits) {
      try {
        const expectedBridgeAddress = deposit.externalBridge;
        if (!expectedBridgeAddress) {
          results.set(deposit.depositId, false);
          continue;
        }

        const receipt = receipts.get(deposit.externalTxHash);
        // Missing, disputed or immature evidence stays pending; it is not a failed deposit.
        if (!receipt || receipt.__rpcDisagreement ||
            typeof receipt.blockNumber !== "string" || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber) ||
            BigInt(receipt.blockNumber) + BigInt(confirmations) > BigInt(latestBlock)) continue;
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
