import {
  config,
  getNativeRepresentationBridgeAddress,
  ERC20_ABI,
  ZERO_ADDRESS,
} from "../config";
import { execute } from "../utils/stratoHelper";
import sendEmail from "./emailService";
import { NonEmptyArray, WithdrawalInfo, NativeWithdrawalInfo, DepositArgs, NativeDepositArgs, ConfirmDepositArgs, ConfirmNativeDepositArgs, SafeTransactionData } from "../types";
import { createSafeTransactions, proposeSafeTransactions } from "./safeService";
import { logInfo, logError } from "../utils/logger";
import { mintVouchersForDeposits } from "./voucherService";
import { ensureHexPrefix } from "../utils/utils";
import { eth } from "../utils/api";
import axios from "axios";

let cachedStratoNetworkId: bigint | null = null;
const announcedManualNativeWithdrawals = new Map<string, string | null>();

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

const buildNativeMintRequest = (
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

  return {
    idempotencyKey: [
      sourceChainId,
      ensureHexPrefix(config.nativeBridge.address!),
      withdrawal.withdrawalId,
    ].join(":"),
    sourceChainId: sourceChainId.toString(),
    sourceBridge: ensureHexPrefix(config.nativeBridge.address!),
    sourceWithdrawalId: withdrawal.withdrawalId,
    externalChainId: String(withdrawal.externalChainId),
    representationBridge: ensureHexPrefix(bridgeAddress),
    stratoToken: ensureHexPrefix(withdrawal.stratoToken),
    recipient: ensureHexPrefix(withdrawal.externalRecipient),
    amount: String(withdrawal.externalTokenAmount),
  };
};

const nativeExecutorHeaders = () => ({
  ...(config.nativeBridge.mintExecutorToken
    ? { Authorization: `Bearer ${config.nativeBridge.mintExecutorToken}` }
    : {}),
});

const getNativeMintExecutorUrl = (): string => {
  const url = config.nativeBridge.mintExecutorUrl;
  if (!url) {
    throw new Error(
      "NATIVE_MINT_EXECUTOR_URL is required for instant native outbound minting",
    );
  }
  return url.replace(/\/$/, "");
};

const submitNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string> => {
  const payload = buildNativeMintRequest(withdrawal, sourceChainId);
  const response = await axios.post(
    `${getNativeMintExecutorUrl()}/native-mints/execute`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        ...nativeExecutorHeaders(),
      },
      timeout: config.api.defaults.timeout,
    },
  );

  const txHash = response.data?.txHash;
  if (!txHash || typeof txHash !== "string") {
    throw new Error("Native mint executor response missing txHash");
  }

  return txHash;
};

const proposeManualNativeMint = async (
  withdrawal: NativeWithdrawalInfo,
  sourceChainId: bigint,
): Promise<string | null> => {
  const payload = buildNativeMintRequest(withdrawal, sourceChainId);
  const proposalUrl = config.nativeBridge.mintProposerUrl;
  if (!proposalUrl) {
    return null;
  }

  const response = await axios.post(
    `${proposalUrl.replace(/\/$/, "")}/native-mints/propose`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        ...nativeExecutorHeaders(),
      },
      timeout: config.api.defaults.timeout,
    },
  );

  const proposalReference =
    response.data?.proposalId ||
    response.data?.reference ||
    response.data?.url ||
    null;

  return proposalReference && typeof proposalReference === "string"
    ? proposalReference
    : null;
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
    const errorMessage = (error as Error).message;
    
    // Check if this is a duplicate key error (expected when multiple servers process same deposits)
    if (
      errorMessage.includes("MB: dup key") ||
      errorMessage.includes("MB: duplicate deposit")
    ) {
      logInfo(
        "BridgeService",
        `Deposits already processed by another server: ${depositArgs.length} deposits (${externalTxHashes.join(", ")})`,
      );
      return; // Gracefully handle duplicate deposits
    }
    
    // Re-throw other errors
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
    await execute(
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
    await execute({
      contractName: "MercataBridge",
      contractAddress: config.bridge.address!,
      method: "confirmDepositBatch",
      args: {
        externalChainIds,
        externalTxHashes,
      },
    });

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
    await execute(
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
  const transactionProposals = await createSafeTransactions(withdrawals as NonEmptyArray<WithdrawalInfo>);

  if (transactionProposals && transactionProposals.length > 0) {
    const withdrawalIds = withdrawals.map((w) => w.withdrawalId);
    const custodyTxHashes = transactionProposals.map((tx) => tx.safeTxHash);

    try {
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

export const confirmNativeWithdrawalBatch = async (
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
      const externalTxHash = await submitNativeMint(withdrawal, sourceChainId);

      await execute({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "confirmWithdrawal",
        args: {
          id: Number(withdrawal.withdrawalId),
          externalTxHash,
        },
      });

      successful += 1;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes("SNB: bad state")) {
        logInfo(
          "BridgeService",
          `Native withdrawal already confirmed by another server: ${withdrawal.withdrawalId}`,
        );
        continue;
      }

      failures.push({
        withdrawalId: withdrawal.withdrawalId,
        message: errorMessage,
      });
      logError("BridgeService", error as Error, {
        operation: "confirmNativeWithdrawalBatch",
        withdrawalId: withdrawal.withdrawalId,
        externalChainId: withdrawal.externalChainId,
      });
    }
  }

  if (successful > 0) {
    logInfo(
      "BridgeService",
      `Successfully confirmed ${successful} native withdrawals`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to confirm ${failures.length} native withdrawals: ${failures
        .map((failure) => `${failure.withdrawalId} (${failure.message})`)
        .join(", ")}`,
    );
  }
};

export const queueManualNativeWithdrawalBatch = async (
  withdrawals: NonEmptyArray<NativeWithdrawalInfo>,
) => {
  const sourceChainId = await getStratoNetworkId();

  for (const withdrawal of withdrawals) {
    if (withdrawal.useInstantPath) {
      continue;
    }

    if (announcedManualNativeWithdrawals.has(withdrawal.withdrawalId)) {
      continue;
    }

    try {
      const proposalReference = await proposeManualNativeMint(
        withdrawal,
        sourceChainId,
      );
      announcedManualNativeWithdrawals.set(
        withdrawal.withdrawalId,
        proposalReference,
      );

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

export const finaliseNativeWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  try {
    await execute(
      ids.map((id) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "finaliseWithdrawal",
        args: { id },
      }))
    );

    logInfo(
      "BridgeService",
      `Successfully finalized ${ids.length} native withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: bad state")) {
      logInfo(
        "BridgeService",
        `Native withdrawals already finalized by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};

export const handleRejectedNativeWithdrawalBatch = async (
  ids: NonEmptyArray<Number>,
) => {
  if (!config.nativeBridge.address) {
    throw new Error("Native bridge address not configured");
  }

  try {
    await execute(
      ids.map((id) => ({
        contractName: "StratoNativeBridge",
        contractAddress: config.nativeBridge.address!,
        method: "abortWithdrawal",
        args: { id },
      }))
    );

    logInfo(
      "BridgeService",
      `Successfully aborted ${ids.length} rejected native withdrawals`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes("SNB: not abortable")) {
      logInfo(
        "BridgeService",
        `Native withdrawals already aborted by another server: ${ids.length} withdrawals (${ids.join(", ")})`,
      );
      return;
    }

    throw error;
  }
};
