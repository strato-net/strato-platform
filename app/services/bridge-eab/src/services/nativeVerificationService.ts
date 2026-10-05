import { getTransactionReceiptsBatch, getVerificationBlockNumber } from "./rpcService";
import { getDepositConfirmationPolicy } from "../config";
import { NativeDepositInfo, NativeWithdrawalInfo, NativeVerificationRpc } from "../types";
import * as evidence from "../signer/nativeSettlementValidation";
import { logError } from "../utils/logger";

const rpc: NativeVerificationRpc = {
  getTransactionReceiptsBatch: (chainId, hashes) => getTransactionReceiptsBatch(chainId, hashes),
  getVerificationBlockNumber: (chainId) => getVerificationBlockNumber(chainId),
  getDepositConfirmationPolicy: (chainId) => getDepositConfirmationPolicy(chainId),
  logError,
};

export const verifyNativeMint = (withdrawal: NativeWithdrawalInfo, sourceChainId: bigint,
  sourceBridge: string, transactionHash: string): Promise<void> =>
  evidence.verifyNativeMint(withdrawal, sourceChainId, sourceBridge, transactionHash, rpc);

export const verifyNativeMintCancellation = (withdrawal: NativeWithdrawalInfo, sourceChainId: bigint,
  sourceBridge: string, transactionHash: string): Promise<void> =>
  evidence.verifyNativeMintCancellation(withdrawal, sourceChainId, sourceBridge, transactionHash, rpc);

export const verifyNativeRedemptionRefund = (deposit: NativeDepositInfo,
  transactionHash: string): Promise<void> =>
  evidence.verifyNativeRedemptionRefund(deposit, transactionHash, rpc);

export const verifyNativeRedemptionsBatch = (deposits: NativeDepositInfo[]): Promise<Map<string, boolean>> =>
  evidence.verifyNativeRedemptionsBatch(deposits, rpc);
