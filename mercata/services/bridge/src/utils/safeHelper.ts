import { Interface } from "ethers";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import {
  config,
  ZERO_ADDRESS,
  ERC20_ABI,
  STRATO_DECIMALS,
  getChainRpcUrl,
} from "../config";
import { getAssetInfo } from "../services/cirrusService";
import {
  convertDecimals,
  ensureHexPrefix,
  safeChecksum,
  safeToBigInt,
} from "./utils";
import { logError, logInfo } from "./logger";
import { AssetInfo, PreparedWithdrawal, Withdrawal, TxType } from "../types";

// Constants
const NONCE_CONFLICT_CODES = [409, 422];
const NONCE_CONFLICT_PATTERNS = /nonce|already exists|conflict/i;

// Check if withdrawal is already pending in Safe by checking transaction metadata
async function isWithdrawalPending(
  apiKit: any,
  safeAddress: string,
  withdrawalId: string,
  externalChainId: number
): Promise<boolean> {
  try {
    // Get pending transactions from Safe
    const pendingTxs = await apiKit.getPendingTransactions(safeAddress);
    
    // Look for transactions with matching withdrawalId in metadata
    for (const tx of pendingTxs.results || []) {
      if (tx.metadata && typeof tx.metadata === 'object') {
        const metadata = tx.metadata as Record<string, any>;
        
        // Check if this transaction has our withdrawalId in metadata
        if (metadata.withdrawalId === withdrawalId && 
            metadata.externalChainId === externalChainId) {
          logInfo("SafeService", `Found pending withdrawal ${withdrawalId} in transaction ${tx.safeTxHash}`);
          return true;
        }
      }
    }
    
    logInfo("SafeService", `No pending withdrawal found for ${withdrawalId} (${pendingTxs.results?.length || 0} pending txs checked)`);
    return false;
  } catch (error) {
    // If we can't check pending transactions, assume it's not pending
    logError("SafeService", error as Error, {
      operation: "isWithdrawalPending",
      withdrawalId,
      externalChainId,
    });
    return false;
  }
}

// Module-scope heavy objects
const erc20Interface = new Interface(ERC20_ABI);

// Simple in-memory cache for single function call
// Caches asset info within a single createSafeTransactionsForWithdrawals call
// Multiple withdrawals for the same chain often use the same tokens
export class CallCache {
  private cache = new Map<string, any>();

  get(key: string): any | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: any): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

export async function getAssetInfoForChain(
  stratoToken: string,
  externalChainId: number,
  callCache: CallCache,
): Promise<AssetInfo> {
  const cacheKey = `${stratoToken}-${externalChainId}`;
  let assetInfo = callCache.get(cacheKey);

  if (!assetInfo) {
    assetInfo = await getAssetInfo(stratoToken);

    if (
      !assetInfo ||
      assetInfo.externalChainId !== externalChainId.toString() ||
      assetInfo.permissions === 0
    ) {
      throw new Error(
        `getAssetInfoForChain failed: No external mapping found for token ${stratoToken} on chain ${externalChainId}`
      );
    }

    assetInfo = {
      externalToken: ensureHexPrefix(assetInfo.externalToken),
      externalDecimals: parseInt(assetInfo.externalDecimals) || STRATO_DECIMALS,
      permissions: assetInfo.permissions,
      externalChainId: assetInfo.externalChainId,
    };

    callCache.set(cacheKey, assetInfo);
  }

  return assetInfo;
}

export function buildTxDescriptor(params: {
  type: "eth" | "erc20";
  externalRecipient: string;
  externalTokenAmount: string;
  externalToken?: string;
  nonce: number;
  metadata: Record<string, any>;
}): { transactions: MetaTransactionData[]; options: { nonce: number; metadata: Record<string, any> } } {
  if (params.type === "eth") {
    return {
      transactions: [
        {
          to: safeChecksum(params.externalRecipient),
          value: params.externalTokenAmount,
          data: "0x",
          operation: OperationType.Call,
        },
      ],
      options: { 
        nonce: params.nonce,
        metadata: params.metadata
      },
    };
  }

  const externalToken = params.externalToken!;
  if (externalToken.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      "ERC20 transfer requested with ZERO_ADDRESS token; use 'eth' type instead",
    );
  }

  return {
    transactions: [
      {
        to: safeChecksum(externalToken),
        value: "0",
        data: erc20Interface.encodeFunctionData("transfer", [
          safeChecksum(params.externalRecipient),
          params.externalTokenAmount,
        ]),
        operation: OperationType.Call,
      },
    ],
    options: { 
      nonce: params.nonce,
      metadata: params.metadata
    },
  };
}

export function groupWithdrawalsByChain(
  withdrawals: Withdrawal[],
): Map<number, Withdrawal[]> {
  return withdrawals.reduce((grouped, withdrawal) => {
    const externalChainId = Number(withdrawal.externalChainId);
    if (!grouped.has(externalChainId)) {
      grouped.set(externalChainId, []);
    }
    grouped.get(externalChainId)!.push(withdrawal);
    return grouped;
  }, new Map<number, Withdrawal[]>());
}

export async function prepareWithdrawals(
  externalChainId: number,
  withdrawals: Withdrawal[],
  callCache: CallCache,
): Promise<PreparedWithdrawal[]> {
  const preparationPromises = withdrawals.map(async (withdrawal) => {
    const assetInfo = await getAssetInfoForChain(
      withdrawal.stratoToken,
      externalChainId,
      callCache,
    );

    const isEth = assetInfo.externalToken.toLowerCase() === ZERO_ADDRESS;
    const externalTokenAmount = convertDecimals(
      withdrawal.stratoTokenAmount.toString(),
      STRATO_DECIMALS,
      assetInfo.externalDecimals,
    ).toString();

    return {
      externalTokenAmount,
      externalRecipient: withdrawal.externalRecipient,
      type: (isEth ? "eth" : "erc20") as TxType,
      externalToken: isEth ? ZERO_ADDRESS : assetInfo.externalToken,
      externalChainId,
      withdrawalId: withdrawal.withdrawalId!,
    };
  });

  const results = await Promise.allSettled(preparationPromises);
  const preparedWithdrawals: PreparedWithdrawal[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      preparedWithdrawals.push(result.value);
    } else {
      // Log the error but don't fail the entire batch
      logError("SafeService", result.reason as Error, {
        operation: "prepareWithdrawals",
        withdrawalId: withdrawals[index].withdrawalId,
        token: withdrawals[index].stratoToken,
        externalChainId,
      });
    }
  });

  return preparedWithdrawals;
}

export function isNonceConflict(err: any): boolean {
  const msg = String(err?.message ?? "");
  const code = Number(err?.response?.status ?? 0);
  return (
    NONCE_CONFLICT_CODES.includes(code) || NONCE_CONFLICT_PATTERNS.test(msg)
  );
}

export async function proposeTransaction(
  apiKit: any,
  protocolKit: any,
  descriptor: { transactions: any[]; options: { nonce: number; metadata: Record<string, any> } },
  safeAddress: string,
  relayer: string,
): Promise<{ safeTxHash: string }> {
  const safeTransaction = await protocolKit.createTransaction(descriptor);
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: relayer,
    senderSignature: signature.data,
    metadata: descriptor.options.metadata,
  });

  return { safeTxHash };
}

export async function initializeSafeForChain(chainId: number) {
  const rpcUrl = getChainRpcUrl(chainId);
  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: config.safe.safeOwnerPrivateKey || "",
    safeAddress: config.safe.address || "",
  });
  const apiKit = new SafeApiKit({ chainId: safeToBigInt(chainId) });

  return { protocolKit, apiKit };
}

export async function processChainWithdrawals(
  externalChainId: number,
  withdrawals: Withdrawal[],
  callCache: CallCache,
): Promise<{ safeTxHash: string; nonce: number }[]> {
  const { protocolKit, apiKit } = await initializeSafeForChain(externalChainId);
  const preparedWithdrawals = await prepareWithdrawals(
    externalChainId,
    withdrawals,
    callCache,
  );

  return await proposeChainTransactions(
    protocolKit,
    apiKit,
    preparedWithdrawals,
  );
}

export async function proposeChainTransactions(
  protocolKit: any,
  apiKit: any,
  preparedWithdrawals: PreparedWithdrawal[],
): Promise<{ safeTxHash: string; nonce: number }[]> {
  const safeTxs: { safeTxHash: string; nonce: number }[] = [];
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeOwnerAddress || "";

  for (const prepared of preparedWithdrawals) {
    const result = await proposeWithdrawalWithRetry(apiKit, protocolKit, prepared, safeAddress, relayer);
    if (result) {
      safeTxs.push(result);
    }
  }

  return safeTxs;
}

async function proposeWithdrawalWithRetry(
  apiKit: any,
  protocolKit: any,
  prepared: PreparedWithdrawal,
  safeAddress: string,
  relayer: string,
  retryCount: number = 0,
): Promise<{ safeTxHash: string; nonce: number } | null> {
  const maxRetries = 5;
  
  // Check if already pending (check on every attempt)
  if (await isWithdrawalPending(apiKit, safeAddress, prepared.withdrawalId, prepared.externalChainId)) {
    logInfo("SafeService", `Withdrawal ${prepared.withdrawalId} already pending${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}, skipping`);
    return null;
  }

  // Get nonce
  const nonce = Number(await apiKit.getNextNonce(safeAddress));
  const descriptor = buildTxDescriptor({
    type: prepared.type,
    externalRecipient: prepared.externalRecipient,
    externalTokenAmount: prepared.externalTokenAmount,
    externalToken: prepared.type === "erc20" ? prepared.externalToken : undefined,
    nonce,
    metadata: {
      withdrawalId: prepared.withdrawalId,
      externalChainId: prepared.externalChainId,
    },
  });

  try {
    const { safeTxHash } = await proposeTransaction(apiKit, protocolKit, descriptor, safeAddress, relayer);
    logInfo("SafeService", `Proposed withdrawal ${prepared.withdrawalId} with nonce ${nonce}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
    return { safeTxHash, nonce };
  } catch (error) {
    if (!isNonceConflict(error)) throw error;

    // Check if we've exhausted retries
    if (retryCount >= maxRetries) {
      logError("SafeService", error as Error, {
        operation: "proposeWithdrawalWithRetry",
        withdrawalId: prepared.withdrawalId,
        retryCount,
        maxRetries,
      });
      return null;
    }

    // Recursive retry with incremented counter
    logInfo("SafeService", `Nonce conflict for withdrawal ${prepared.withdrawalId}, retrying (${retryCount + 1}/${maxRetries})`);
    return proposeWithdrawalWithRetry(apiKit, protocolKit, prepared, safeAddress, relayer, retryCount + 1);
  }
}
