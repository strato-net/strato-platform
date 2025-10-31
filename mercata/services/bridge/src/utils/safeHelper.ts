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
import { AssetInfo, PreparedWithdrawal, WithdrawalInfo, TxType, SafeTransactionData, NonEmptyArray } from "../types";
import { retry } from "./api";

// Constants
const NONCE_CONFLICT_CODES = [409, 422];
const NONCE_CONFLICT_PATTERNS = /nonce|already exists|conflict/i;

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
}): { transactions: MetaTransactionData[]; options: { nonce: number } } {
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
        nonce: params.nonce
      },
    };
  }

  const externalToken = params.externalToken!;
  if (ensureHexPrefix(externalToken) === ZERO_ADDRESS) {
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
      nonce: params.nonce
    },
  };
}

export function groupByChain<T extends { externalChainId: number | string }>(
  items: T[],
): Map<number, T[]> {
  return items.reduce((grouped, item) => {
    const externalChainId = Number(item.externalChainId);
    if (!grouped.has(externalChainId)) {
      grouped.set(externalChainId, []);
    }
    grouped.get(externalChainId)!.push(item);
    return grouped;
  }, new Map<number, T[]>());
}

export function isNonceConflict(err: any): boolean {
  const msg = String(err?.message ?? "");
  const code = Number(err?.response?.status ?? 0);
  return (
    NONCE_CONFLICT_CODES.includes(code) || NONCE_CONFLICT_PATTERNS.test(msg)
  );
}

export async function proposeTransactions(
  transactions: SafeTransactionData[],
  chainId: number,
): Promise<void> {
  const { apiKit } = await initializeSafeForChain(chainId);
  
  let successful = 0;
  let failed = 0;
  
  for (const tx of transactions) {
    try {
      await retry(
        () => apiKit.proposeTransaction(tx),
        { logPrefix: "SafeService" }
      );
      successful++;
    } catch (error) {
      logError("SafeService", error as Error, {
        operation: "proposeTransaction",
        safeTxHash: tx.safeTxHash,
        nonce: tx.nonce,
        chainId,
      });
      failed++;
    }
  }
  
  logInfo("SafeService", `Proposed transactions for chain ${chainId}: ${successful} successful, ${failed} failed out of ${transactions.length} total`);
}

export async function initializeSafeForChain(chainId: number) {
  const rpcUrl = getChainRpcUrl(chainId);
  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: config.safe.safeProposerPrivateKey || "",
    safeAddress: config.safe.address || "",
  });
  const apiKit = new SafeApiKit({ chainId: safeToBigInt(chainId), apiKey: config.safe.apiKey });

  return { protocolKit, apiKit };
}

export async function createWithdrawalProposals(
  externalChainId: number,
  withdrawals: NonEmptyArray<WithdrawalInfo>
): Promise<SafeTransactionData[]> {
  const { protocolKit, apiKit } = await initializeSafeForChain(externalChainId);

  const transactionProposals: SafeTransactionData[] = [];
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeProposerAddress || "";
  let currentNonce = Number(await retry(
    () => apiKit.getNextNonce(safeAddress),
    { logPrefix: "SafeService" }
  ));

  for (const withdrawal of withdrawals) {
    const nonce = currentNonce++;
    const descriptor = buildTxDescriptor({
      type: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? "eth" : "erc20",
      externalRecipient: withdrawal.externalRecipient,
      externalTokenAmount: withdrawal.externalTokenAmount,
      externalToken: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? undefined : withdrawal.externalToken,
      nonce,
    });

    const safeTransaction = await protocolKit.createTransaction(descriptor);
    const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
    const signature = await protocolKit.signHash(safeTxHash);

    logInfo("SafeService", `Created tx proposal: nonce ${nonce}, withdrawalId ${withdrawal.withdrawalId}`);

    transactionProposals.push({
      safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: relayer,
      senderSignature: signature.data,
      nonce,
      externalChainId: Number(withdrawal.externalChainId as string),
    });
  }

  return transactionProposals;
}
