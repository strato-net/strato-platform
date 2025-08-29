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
  validateAddress,
  safeToBigInt,
} from "./utils";
import { logError } from "./logger";
import { AssetInfo, PreparedWithdrawal, Withdrawal, TxType } from "../types";

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
): Promise<AssetInfo | null> {
  const cacheKey = `${stratoToken}-${externalChainId}`;
  let assetInfo = callCache.get(cacheKey);

  if (!assetInfo) {
    assetInfo = await getAssetInfo(stratoToken);

    if (
      !assetInfo ||
      assetInfo.externalChainId !== externalChainId.toString() ||
      !assetInfo.enabled
    ) {
      return null;
    }

    assetInfo = {
      externalToken: ensureHexPrefix(assetInfo.externalToken),
      externalDecimals: parseInt(assetInfo.externalDecimals) || STRATO_DECIMALS,
      enabled: assetInfo.enabled,
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
      options: { nonce: params.nonce },
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
    options: { nonce: params.nonce },
  };
}

export function validateAndGroupWithdrawals(
  withdrawals: Withdrawal[],
): Map<number, Withdrawal[]> {
  const grouped = new Map<number, Withdrawal[]>();

  for (const withdrawal of withdrawals) {
    const externalChainId = Number(withdrawal.externalChainId);
    const externalRecipient = withdrawal.externalRecipient;
    if (!externalRecipient || !validateAddress(externalRecipient)) {
      logError(
        "SafeService",
        new Error(`Invalid external recipient address: ${externalRecipient}`),
        {
          operation: "validateAndGroupWithdrawals",
          withdrawalId: withdrawal.withdrawalId,
          externalRecipient: externalRecipient,
        },
      );
      continue;
    }

    if (!grouped.has(externalChainId)) {
      grouped.set(externalChainId, []);
    }
    grouped.get(externalChainId)!.push(withdrawal);
  }

  return grouped;
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
    if (!assetInfo) {
      throw new Error(
        `No external mapping found for token ${withdrawal.stratoToken} on chain ${externalChainId}`,
      );
    }

    const isEth = assetInfo.externalToken.toLowerCase() === ZERO_ADDRESS;
    const type: TxType = isEth ? "eth" : "erc20";
    const externalToken = isEth ? ZERO_ADDRESS : assetInfo.externalToken;

    const externalTokenAmount = convertDecimals(
      withdrawal.stratoTokenAmount.toString(),
      STRATO_DECIMALS,
      assetInfo.externalDecimals,
    ).toString();

    return {
      externalTokenAmount,
      externalRecipient: withdrawal.externalRecipient,
      type,
      externalToken,
      externalChainId,
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

export async function proposeWithRetry(
  apiKit: any,
  protocolKit: any,
  descriptor: { transactions: any[]; options: { nonce: number } },
  safeAddress: string,
  relayer: string,
): Promise<{ safeTxHash: string }> {
  try {
    const safeTransaction = await protocolKit.createTransaction(descriptor);
    const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
    const signature = await protocolKit.signHash(safeTxHash);

    await apiKit.proposeTransaction({
      safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: relayer,
      senderSignature: signature.data,
    });

    return { safeTxHash };
  } catch (e: any) {
    if (!isNonceConflict(e)) throw e;

    const retryNonce: number = Number(await apiKit.getNextNonce(safeAddress));
    if (retryNonce === descriptor.options.nonce) throw e;

    const retryDescriptor = {
      ...descriptor,
      options: { nonce: retryNonce },
    };

    const retryTransaction =
    await protocolKit.createTransaction(retryDescriptor);
    const retryHash = await protocolKit.getTransactionHash(retryTransaction);
    const retrySignature = await protocolKit.signHash(retryHash);

    await apiKit.proposeTransaction({
      safeAddress,
      safeTransactionData: retryTransaction.data,
      safeTxHash: retryHash,
      senderAddress: relayer,
      senderSignature: retrySignature.data,
    });

    return { safeTxHash: retryHash };
  }
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
  let nonce: number = Number(await apiKit.getNextNonce(safeAddress));

  for (const prepared of preparedWithdrawals) {
    const descriptor = buildTxDescriptor({
      type: prepared.type,
      externalRecipient: prepared.externalRecipient,
      externalTokenAmount: prepared.externalTokenAmount,
      externalToken: prepared.type === "erc20" ? prepared.externalToken : undefined,
      nonce,
    });

    const { safeTxHash } = await proposeWithRetry(
      apiKit,
      protocolKit,
      descriptor,
      safeAddress,
      relayer,
    );
    safeTxs.push({ safeTxHash, nonce });
    nonce += 1;
  }

  return safeTxs;
}
