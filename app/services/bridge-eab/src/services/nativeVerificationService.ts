import { getTransactionReceiptsBatch, getVerificationBlockNumber } from "./rpcService";
import { getDepositConfirmationPolicy, ZERO_ADDRESS } from "../config";
import { NativeDepositInfo, NativeWithdrawalInfo } from "../types";
import { AbiCoder, Interface, keccak256 } from "ethers";
import { NATIVE_MINT_EVENT_ABI } from "../config/bridgeAbi";
import { processingIssue } from "../utils/processingIssues";
import { parseNativeDepositLog } from "../utils/nativeRedemption";
import { logError } from "../utils/logger";

const normalizeAddress = (value: string) =>
  value.toLowerCase().replace(/^0x/, "");

const mintInterface = new Interface(NATIVE_MINT_EVENT_ABI);

export const verifyNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
  sourceBridge: string,
  transactionHash: string,
): Promise<void> => {
  const chainId = Number(withdrawal.externalChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid native destination chain configuration");
  const confirmations = getDepositConfirmationPolicy(chainId);
  const [receipts, latestBlock] = await Promise.all([
    getTransactionReceiptsBatch(chainId, [transactionHash]),
    getVerificationBlockNumber(chainId),
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

export const verifyNativeRedemptionsBatch = async (
  deposits: NativeDepositInfo[],
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
    const confirmations = getDepositConfirmationPolicy(externalChainId);
    let receipts: Map<string, any>, latestBlock: number;
    try {
      [receipts, latestBlock] = await Promise.all([
        getTransactionReceiptsBatch(externalChainId, [...new Set(chainDeposits.map((deposit) => deposit.externalTxHash))]),
        getVerificationBlockNumber(externalChainId),
      ]);
    } catch (error) {
      logError("NativeVerificationService", error as Error, { externalChainId });
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
        if (receipt.status !== "0x1") {
          results.set(deposit.depositId, false);
          continue;
        }

        const verified = receipt.logs.some((log) => {
          if (!log.address || normalizeAddress(log.address) !== normalizeAddress(expectedBridgeAddress)) return false;
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
        logError("NativeVerificationService", error as Error, {
          operation: "verifyNativeRedemptionsBatch",
          externalTxHash: deposit.externalTxHash,
        });
        results.set(deposit.depositId, false);
      }
    }
  }

  return results;
};
