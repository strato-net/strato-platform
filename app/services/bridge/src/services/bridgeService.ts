import {
  config,
  getChainRpcUrl,
  getNativeRepresentationBridgeAddress,
} from "../config";
import { JsonRpcProvider } from "ethers";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, WithdrawalInfo, NativeWithdrawalInfo, DepositArgs, ActionDepositArgs, NativeDepositArgs, ConfirmDepositArgs, ConfirmNativeDepositArgs, SafeTransactionData } from "../types";
import { createSafeTransactions, proposeSafeTransactions } from "./safeService";
import { logInfo, logError } from "../utils/logger";
import { mintVouchersForDeposits } from "./voucherService";
import { eth } from "../utils/api";
import {
  buildNativeMintRequest,
  executeNativeMint,
  getExistingNativeMintTxHash,
  getNativeMintProposalExecution,
  proposeNativeMint,
} from "./nativeMintService";
import { buildActionDepositBatchArgs } from "./depositEventService";

let cachedStratoNetworkId: bigint | null = null;
const announcedManualNativeWithdrawals = new Map<string, string | null>();
const pendingNativeInstantWithdrawalTxHashes = new Map<string, string>();
const inFlightSafeProposalWithdrawals = new Set<string>();

const normalizeOptionalHash = (value?: string | null): string | null => {
  const normalized = value?.trim();
  if (!normalized) return null;
  const withoutPrefix = normalized.replace(/^0x/i, "");
  return /^0+$/.test(withoutPrefix) ? null : normalized;
};

const getStratoNetworkId = async (): Promise<bigint> => {
  if (cachedStratoNetworkId != null) {
    return cachedStratoNetworkId;
  }

  const metadata: any = await eth.get("/metadata");
  const networkId = metadata?.networkID;
  if (networkId == null) {
    throw new Error("Network ID not found in STRATO metadata");
  }

  cachedStratoNetworkId = BigInt(networkId.toString());
  return cachedStratoNetworkId;
};

const getNativeMintRequest = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
) => {
  const bridgeAddress = getNativeRepresentationBridgeAddress(
    Number(withdrawal.externalChainId),
  );
  if (!bridgeAddress) {
    throw new Error(
      `CHAIN_${Number(withdrawal.externalChainId)}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS is not configured`,
    );
  }
  return buildNativeMintRequest(
    withdrawal,
    sourceChainId,
    config.nativeBridge.address!,
    bridgeAddress,
  );
};

const submitNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return executeNativeMint(payload);
};

const getDestinationChainLatestTimestamp = async (
  externalChainId: string | number,
): Promise<bigint | null> => {
  const provider = new JsonRpcProvider(getChainRpcUrl(BigInt(externalChainId)));
  const latestBlock = await provider.getBlock("latest");
  return latestBlock ? BigInt(latestBlock.timestamp) : null;
};

const isDestinationMintReady = async (
  withdrawal: NativeWithdrawalInfo,
): Promise<boolean> => {
  const notBefore = BigInt(withdrawal.nativeMintNotBefore || 0);
  if (notBefore <= 0n) {
    return true;
  }

  const latestTimestamp = await getDestinationChainLatestTimestamp(
    withdrawal.externalChainId,
  );
  if (latestTimestamp == null || latestTimestamp >= notBefore) {
    return true;
  }

  logInfo(
    "BridgeService",
    `Native withdrawal ${withdrawal.withdrawalId} destination chain is not ready for mint; latest block timestamp ${latestTimestamp.toString()} is before notBefore ${notBefore.toString()}`,
  );
  return false;
};

const findExistingNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string | null> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return getExistingNativeMintTxHash(payload);
};

const proposeManualNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string> => {
  const payload = await getNativeMintRequest(withdrawal, sourceChainId);
  return proposeNativeMint(payload);
};

const syncManualNativeMintProposal = async (
  withdrawal: NativeWithdrawalInfo,
  proposalReference: string | null,
): Promise<boolean> => {
  if (!proposalReference) {
    return false;
  }

  const result = await getNativeMintProposalExecution(
    proposalReference,
    withdrawal.externalChainId,
  );

  if (result.status === "pending") {
    return true;
  }

  if (result.status === "rejected") {
    await execute({
      contractName: "StratoNativeBridge",
      contractAddress: config.nativeBridge.address!,
      method: "abortWithdrawal",
      args: {
        id: Number(withdrawal.withdrawalId),
      },
    });
    announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
    return true;
  }

  if (!result.txHash) {
    return true;
  }

  const finalizeResult = await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "finalizeWithdrawal",
    args: {
      id: Number(withdrawal.withdrawalId),
      externalTxHash: result.txHash,
      nativeMintProposalHash: proposalReference,
    },
  });
  if (finalizeResult.status !== "Success") {
    return true;
  }
  announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
  return true;
};

const recordNativeWithdrawalProposal = async (
  withdrawalId: string,
  proposalReference: string,
) => {
  await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "recordWithdrawalProposal",
    args: {
      id: Number(withdrawalId),
      nativeMintProposalHash: proposalReference,
    },
  });
};

const isDuplicateDepositError = (error: unknown): boolean => {
  const message = (error as Error).message;
  return (
    message.includes("MB: dup key") ||
    message.includes("MB: duplicate deposit")
  );
};

const recordStandardDeposit = async (deposit: DepositArgs) => {
  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "deposit",
    args: {
      externalChainId: deposit.externalChainId,
      externalSender: deposit.externalSender,
      externalToken: deposit.externalToken,
      externalTokenAmount: deposit.externalTokenAmount,
      externalTxHash: deposit.externalTxHash,
      stratoRecipient: deposit.stratoRecipient,
      targetStratoToken: deposit.targetStratoToken,
    },
  });
};

const recordActionDeposit = async (deposit: ActionDepositArgs) => {
  await execute({
    contractName: "MercataBridge",
    contractAddress: config.bridge.address!,
    method: "depositWithAction",
    args: {
      externalChainId: deposit.externalChainId,
      externalSender: deposit.externalSender,
      externalToken: deposit.externalToken,
      externalTokenAmount: deposit.externalTokenAmount,
      externalTxHash: deposit.externalTxHash,
      stratoRecipient: deposit.stratoRecipient,
      targetStratoToken: deposit.targetStratoToken,
      action: deposit.action,
      actionToken: deposit.actionToken,
      minFinalOut: deposit.minFinalOut,
    },
  });
};

const recoverMixedDuplicateBatch = async <T extends DepositArgs>(
  deposits: NonEmptyArray<T>,
  recordOne: (deposit: T) => Promise<void>,
) => {
  for (const deposit of deposits) {
    try {
      await recordOne(deposit);
    } catch (error) {
      if (!isDuplicateDepositError(error)) throw error;
      logInfo(
        "BridgeService",
        `Deposit already recorded: ${deposit.externalTxHash}`,
      );
    }
  }
};

export const depositBatch = async (depositArgs: NonEmptyArray<DepositArgs>) => {
  const externalChainIds = depositArgs.map((deposit) => deposit.externalChainId);
  const externalSenders = depositArgs.map((deposit) => deposit.externalSender);
  const externalTokens = depositArgs.map((deposit) => deposit.externalToken);
  const externalTokenAmounts = depositArgs.map((deposit) => deposit.externalTokenAmount);
  const externalTxHashes = depositArgs.map((deposit) => deposit.externalTxHash);
  const stratoRecipients = depositArgs.map((deposit) => deposit.stratoRecipient);
  const targetStratoTokens = depositArgs.map((deposit) => deposit.targetStratoToken);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "depositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
        externalTokens,
        externalTokenAmounts,
        stratoRecipients,
        externalSenders,
        targetStratoTokens,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully deposited ${depositArgs.length} deposits`,
    );
  } catch (error) {
    if (isDuplicateDepositError(error)) {
      logInfo(
        "BridgeService",
        `Standard deposit batch contained an existing deposit; recovering item-by-item`,
      );
      await recoverMixedDuplicateBatch(depositArgs, recordStandardDeposit);
      return;
    }
    throw error;
  }
};

export const depositBatchWithAction = async (
  depositArgs: NonEmptyArray<ActionDepositArgs>,
) => {
  const args = buildActionDepositBatchArgs(depositArgs);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "depositBatchWithAction",
      args,
    });
    logInfo(
      "BridgeService",
      `Successfully recorded ${depositArgs.length} action deposits`,
    );
  } catch (error) {
    if (isDuplicateDepositError(error)) {
      logInfo(
        "BridgeService",
        `Action deposit batch contained an existing deposit; recovering item-by-item`,
      );
      await recoverMixedDuplicateBatch(depositArgs, recordActionDeposit);
      return;
    }
    throw error;
  }
};

export const recordNativeDepositBatch = async (
  depositArgs: NonEmptyArray<NativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  try {
    const result = await execute(
      depositArgs.map((deposit) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "recordDeposit",
        args: {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
          externalSender: deposit.externalSender,
          externalTxHash: deposit.externalTxHash,
          representationToken: deposit.representationToken,
          stratoRecipient: deposit.stratoRecipient,
          stratoTokenAmount: deposit.stratoTokenAmount,
        },
      }))
    );

    if (result.status !== "Success") {
      throw new Error(
        `Native deposit record still ${result.status}; will retry`,
      );
    }

    logInfo(
      "BridgeService",
      `Successfully recorded ${depositArgs.length} native deposits`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (
      errorMessage.includes("SNB: duplicate deposit")
    ) {
      logInfo(
        "BridgeService",
        `Native deposits already processed by another server: ${depositArgs.length} deposits (${depositArgs.map((d) => `${d.externalBridge}:${d.externalRedemptionId}`).join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const confirmDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);

  try {
    const result = await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "confirmDepositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
      },
    });

    if (result.status !== "Success") {
      logInfo(
        "BridgeService",
        `Deposit confirmation still ${result.status}; skipping voucher mint for ${deposits.length} deposits`,
      );
      return;
    }

    logInfo(
      "BridgeService",
      `Successfully confirmed ${deposits.length} deposits`,
    );

    await mintVouchersForDeposits(stratoRecipients);
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers confirm same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already confirmed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already confirmed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const confirmNativeDepositBatch = async (
  deposits: NonEmptyArray<ConfirmNativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const depositIds = deposits.map((deposit) => deposit.depositId);
  const stratoRecipients = deposits.map((deposit) => deposit.stratoRecipient);

  try {
    const result = await execute(
      deposits.map((deposit) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "confirmDeposit",
        args: {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
        },
      }))
    );

    if (result.status !== "Success") {
      logInfo(
        "BridgeService",
        `Native deposit confirmation still ${result.status}; skipping voucher mint for ${deposits.length} native deposits`,
      );
      return;
    }

    logInfo(
      "BridgeService",
      `Successfully confirmed ${deposits.length} native deposits`,
    );

    await mintVouchersForDeposits(stratoRecipients);
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: bad state")) {
      logInfo(
        "BridgeService",
        `Native deposits already confirmed by another server: ${deposits.length} deposits (${depositIds.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const reviewDepositBatch = async (deposits: NonEmptyArray<ConfirmDepositArgs>) => {
  const externalChainIds = deposits.map((deposit) => deposit.externalChainId);
  const externalTxHashes = deposits.map((deposit) => deposit.externalTxHash);

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "reviewDepositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully set ${deposits.length} deposits to pending review`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers review same deposits)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Deposits already reviewed by another server: ${deposits.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle already reviewed deposits
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const reviewNativeDepositBatch = async (
  deposits: NonEmptyArray<ConfirmNativeDepositArgs>
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const depositIds = deposits.map((deposit) => deposit.depositId);

  try {
    await execute(
      deposits.map((deposit) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "reviewDeposit",
        args: {
          externalChainId: deposit.externalChainId,
          externalBridge: deposit.externalBridge,
          externalRedemptionId: deposit.externalRedemptionId,
        },
      }))
    );

    logInfo(
      "BridgeService",
      `Successfully set ${deposits.length} native deposits to pending review`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: bad state")) {
      logInfo(
        "BridgeService",
        `Native deposits already reviewed by another server: ${deposits.length} deposits (${depositIds.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const confirmWithdrawalBatch = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  const eligibleWithdrawals = withdrawals.filter((withdrawal) => {
    const withdrawalId = String(withdrawal.withdrawalId);
    if (inFlightSafeProposalWithdrawals.has(withdrawalId)) {
      logInfo(
        "BridgeService",
        `Skipping withdrawal ${withdrawalId}; Safe proposal is already in progress`,
      );
      return false;
    }
    inFlightSafeProposalWithdrawals.add(withdrawalId);
    return true;
  });

  if (eligibleWithdrawals.length === 0) return;

  try {
    await confirmEligibleWithdrawalBatch(
      eligibleWithdrawals as NonEmptyArray<WithdrawalInfo>,
    );
  } finally {
    for (const withdrawal of eligibleWithdrawals) {
      inFlightSafeProposalWithdrawals.delete(String(withdrawal.withdrawalId));
    }
  }
};

const confirmEligibleWithdrawalBatch = async (
  withdrawals: NonEmptyArray<WithdrawalInfo>,
) => {
  const transactionProposals = await createSafeTransactions(withdrawals);

  if (transactionProposals && transactionProposals.length > 0) {
    const withdrawalIds = withdrawals.map((w) => w.withdrawalId);
    const custodyTxHashes = transactionProposals.map((tx) => tx.safeTxHash);

    try {
      logInfo("BridgeService", "Confirming non-native withdrawals on STRATO", {
        withdrawalIds,
        custodyTxHashes,
      });
      await execute({
        contractName: "MercataBridge",
        contractAddress: config.bridge.address!,
        method: "confirmWithdrawalBatch",
        args: {
          ids: withdrawalIds,
          custodyTxHashes,
        },
      });
      await proposeSafeTransactions(transactionProposals as NonEmptyArray<SafeTransactionData>);
    } catch (executeError) {
      const errorMessage = (executeError as Error).message;
      if (errorMessage.includes("MB: bad state")) {
        logInfo(
          "BridgeService",
          `Withdrawals already confirmed by another server: ${withdrawals.length} withdrawals (${withdrawalIds.join(", ")})`,
        );
        return;
      }
      throw executeError;
    }

    const emailPromises = transactionProposals.map(async (proposal) => {
      try {
        await sendEmail(proposal.safeTxHash, proposal.externalChainId);
        return "success";
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          safeTxHash: proposal.safeTxHash,
        });
        return "failed";
      }
    });

    const emailResults = await Promise.all(emailPromises);
    const successCount = emailResults.filter((r) => r === "success").length;
    const failureCount = emailResults.filter((r) => r === "failed").length;
    logInfo(
      "BridgeService",
      `Email notifications: ${successCount} sent, ${failureCount} failed for batch of ${withdrawals.length} withdrawals`,
    );
  }
};

export const finaliseWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {
  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "finaliseWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully finalized ${ids.length} withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a bad state error (expected when multiple servers finalize same withdrawals)
    if (errorMessage.includes("MB: bad state")) {
      logInfo(
        "BridgeService",
        `Withdrawals already finalized by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already finalized withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

export const handleRejectedWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {

  try {
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "abortWithdrawalBatch",
      args: {
        ids,
      },
    });

    logInfo(
      "BridgeService",
      `Successfully aborted ${ids.length} rejected withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Check if this is a not abortable error (expected when multiple servers abort same withdrawals)
    if (errorMessage.includes("MB: not abortable")) {
      logInfo(
        "BridgeService",
        `Withdrawals already aborted by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return; // Gracefully handle already aborted withdrawals
    }
    
    // Re-throw other errors
    throw error;
  }
};

const ensureNativeWithdrawalPending = async (
  withdrawal: NativeWithdrawalInfo,
): Promise<boolean> => {
  if (String(withdrawal.bridgeStatus) === "2") {
    return true;
  }

  await execute({
    contractName: "StratoNativeBridge",
    contractAddress: config.nativeBridge.address!,
    method: "markWithdrawalPending",
    args: {
      id: Number(withdrawal.withdrawalId),
    },
  });
  return false;
};

const getNativeInstantWithdrawalDelayRemaining = (
  withdrawal: NativeWithdrawalInfo,
): number => {
  const notBefore = BigInt(withdrawal.nativeMintNotBefore || 0);
  if (notBefore <= 0n) {
    return 0;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  return notBefore > now ? Number(notBefore - now) : 0;
};

export const finalizeNativeWithdrawalBatch = async (
  withdrawals: NonEmptyArray<NativeWithdrawalInfo>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const sourceChainId = await getStratoNetworkId();
  const failures: Array<{ withdrawalId: string; message: string }> = [];
  let successful = 0;

  for (const withdrawal of withdrawals) {
    if (!withdrawal.useInstantPath) {
      failures.push({
        withdrawalId: withdrawal.withdrawalId,
        message: "native withdrawal is not instant-eligible",
      });
      continue;
    }

    try {
      const alreadyPending = await ensureNativeWithdrawalPending(withdrawal);
      if (!alreadyPending) {
        logInfo(
          "BridgeService",
          `Native instant withdrawal ${withdrawal.withdrawalId} moved to pending review`,
        );
        continue;
      }

      const delayRemaining = getNativeInstantWithdrawalDelayRemaining(withdrawal);
      if (delayRemaining > 0) {
        logInfo(
          "BridgeService",
          `Native instant withdrawal ${withdrawal.withdrawalId} is pending review for ${delayRemaining}s before destination mint`,
        );
        continue;
      }

      if (!(await isDestinationMintReady(withdrawal))) {
        continue;
      }

      let externalTxHash =
        pendingNativeInstantWithdrawalTxHashes.get(withdrawal.withdrawalId) ||
        await findExistingNativeMint(withdrawal, sourceChainId);
      if (!externalTxHash) {
        externalTxHash = await submitNativeMint(withdrawal, sourceChainId);
      }
      pendingNativeInstantWithdrawalTxHashes.set(
        withdrawal.withdrawalId,
        externalTxHash,
      );

      const result = await execute({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "finalizeWithdrawal",
        args: {
          id: Number(withdrawal.withdrawalId),
          externalTxHash,
          nativeMintProposalHash: "",
        },
      });

      if (result.status !== "Success") {
        logInfo(
          "BridgeService",
          `Native withdrawal ${withdrawal.withdrawalId} destination mint succeeded but STRATO finalize is still ${result.status}`,
        );
        continue;
      }

      pendingNativeInstantWithdrawalTxHashes.delete(withdrawal.withdrawalId);
      successful += 1;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (
        errorMessage.includes("SNB: bad state") ||
        errorMessage.includes("SNB: tx hash already set")
      ) {
        pendingNativeInstantWithdrawalTxHashes.delete(withdrawal.withdrawalId);
        logInfo(
          "BridgeService",
          `Native withdrawal already finalized by another server: ${withdrawal.withdrawalId}`,
        );
        continue;
      }

      failures.push({
        withdrawalId: withdrawal.withdrawalId,
        message: errorMessage,
      });
      logError("BridgeService", error as Error, {
        operation: "finalizeNativeWithdrawalBatch",
        withdrawalId: withdrawal.withdrawalId,
        externalChainId: withdrawal.externalChainId,
      });
    }
  }

  if (successful > 0) {
    logInfo(
      "BridgeService",
      `Successfully finalized ${successful} native withdrawals`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to finalize ${failures.length} native withdrawals: ${failures
        .map((failure) => `${failure.withdrawalId} (${failure.message})`)
        .join(", ")}`,
    );
  }
};

export const queueManualNativeWithdrawalBatch = async (
  withdrawals: NonEmptyArray<NativeWithdrawalInfo>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  const sourceChainId = await getStratoNetworkId();

  for (const withdrawal of withdrawals) {
    if (withdrawal.useInstantPath) {
      continue;
    }

    const recordedProposalReference = normalizeOptionalHash(
      withdrawal.nativeMintProposalHash,
    );
    const existingProposalReference =
      recordedProposalReference ||
      normalizeOptionalHash(
        announcedManualNativeWithdrawals.get(withdrawal.withdrawalId),
      );

    if (existingProposalReference) {
      try {
        if (!recordedProposalReference) {
          await recordNativeWithdrawalProposal(
            withdrawal.withdrawalId,
            existingProposalReference,
          );
        }
        await syncManualNativeMintProposal(
          withdrawal,
          existingProposalReference,
        );
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (
          errorMessage.includes("SNB: bad state") ||
          errorMessage.includes("SNB: tx hash already set")
        ) {
          announcedManualNativeWithdrawals.delete(withdrawal.withdrawalId);
          continue;
        }
        logError("BridgeService", error as Error, {
          operation: "syncManualNativeMintProposal",
          withdrawalId: withdrawal.withdrawalId,
          externalChainId: withdrawal.externalChainId,
        });
      }
      continue;
    }

    try {
      const alreadyPending = await ensureNativeWithdrawalPending(withdrawal);
      if (!alreadyPending) {
        logInfo(
          "BridgeService",
          `Native withdrawal ${withdrawal.withdrawalId} moved to pending review before manual proposal`,
        );
        continue;
      }
      const proposalReference = await proposeManualNativeMint(
        withdrawal,
        sourceChainId,
      );
      announcedManualNativeWithdrawals.set(
        withdrawal.withdrawalId,
        proposalReference,
      );
      await recordNativeWithdrawalProposal(withdrawal.withdrawalId, proposalReference);

      try {
        await sendEmail(proposalReference, withdrawal.externalChainId);
      } catch (emailError) {
        logError("BridgeService", emailError as Error, {
          operation: "sendEmail",
          safeTxHash: proposalReference,
          withdrawalId: withdrawal.withdrawalId,
        });
      }

      const baseMessage =
        `Native withdrawal ${withdrawal.withdrawalId} exceeds the instant threshold and remains pending manual approval/execution`;
      const suffix = proposalReference
        ? ` (reference: ${proposalReference})`
        : "";
      logInfo("BridgeService", `${baseMessage}${suffix}`);
    } catch (error) {
      logError("BridgeService", error as Error, {
        operation: "queueManualNativeWithdrawalBatch",
        withdrawalId: withdrawal.withdrawalId,
        externalChainId: withdrawal.externalChainId,
      });
    }
  }
};
