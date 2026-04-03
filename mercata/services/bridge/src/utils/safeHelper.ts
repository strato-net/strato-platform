import { Interface, JsonRpcProvider } from "ethers";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import {
  config,
  ZERO_ADDRESS,
  ERC20_ABI,
  WAD,
  getChainRpcUrl,
  getChainVaultAddress,
  getChainRepBridgeAddress,
} from "../config";
import {
  ensureHexPrefix,
  safeChecksum,
  safeToBigInt,
} from "./utils";
import { logError, logInfo } from "./logger";
import { getRebaseFactors, getAssetInfo } from "../services/cirrusService";
import { WithdrawalInfo, SafeTransactionData, NonEmptyArray } from "../types";
import { retry } from "./api";

// Constants
const NONCE_CONFLICT_CODES = [409, 422];
const NONCE_CONFLICT_PATTERNS = /nonce|already exists|conflict/i;

// Module-scope ABI interfaces
const vaultInterface = new Interface([
  "function release(address token, address recipient, uint256 amount)",
  "function releaseETH(address payable recipient, uint256 amount)",
]);

const repBridgeInterface = new Interface([
  "function mintRepresentation(address stratoToken, address recipient, uint256 amount)",
]);

export function buildTxDescriptor(params: {
  type: "eth" | "erc20";
  isNative: boolean;
  externalRecipient: string;
  externalTokenAmount: string;
  externalToken?: string;
  stratoToken?: string;
  vaultAddress: string;
  repBridgeAddress?: string;
  nonce: number;
}): { transactions: MetaTransactionData[]; options: { nonce: number } } {

  // STRATO-canonical: call StratoRepresentationBridge.mintRepresentation
  if (params.isNative) {
    if (!params.repBridgeAddress) {
      throw new Error("repBridgeAddress is required for STRATO-canonical (isNative) withdrawals");
    }
    if (!params.stratoToken) {
      throw new Error("stratoToken is required for STRATO-canonical (isNative) withdrawals");
    }
    return {
      transactions: [
        {
          to: safeChecksum(params.repBridgeAddress),
          value: "0",
          data: repBridgeInterface.encodeFunctionData("mintRepresentation", [
            safeChecksum(params.stratoToken),
            safeChecksum(params.externalRecipient),
            params.externalTokenAmount,
          ]),
          operation: OperationType.Call,
        },
      ],
      options: { nonce: params.nonce },
    };
  }

  // External-canonical ETH: call ExternalBridgeVault.releaseETH
  if (params.type === "eth") {
    return {
      transactions: [
        {
          to: safeChecksum(params.vaultAddress),
          value: "0",
          data: vaultInterface.encodeFunctionData("releaseETH", [
            safeChecksum(params.externalRecipient),
            params.externalTokenAmount,
          ]),
          operation: OperationType.Call,
        },
      ],
      options: { nonce: params.nonce },
    };
  }

  // External-canonical ERC-20: call ExternalBridgeVault.release
  const externalToken = params.externalToken!;
  if (ensureHexPrefix(externalToken) === ZERO_ADDRESS) {
    throw new Error(
      "ERC20 release requested with ZERO_ADDRESS token; use 'eth' type instead",
    );
  }

  return {
    transactions: [
      {
        to: safeChecksum(params.vaultAddress),
        value: "0",
        data: vaultInterface.encodeFunctionData("release", [
          safeChecksum(externalToken),
          safeChecksum(params.externalRecipient),
          params.externalTokenAmount,
        ]),
        operation: OperationType.Call,
      },
    ],
    options: { nonce: params.nonce },
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

  // Initialize hot wallet protocol kit once if any hot transactions exist
  const hotSafeAddress = transactions.find(t => t.isHot)?.safeAddress;
  let hotProtocolKit: Awaited<ReturnType<typeof initializeSafeForChain>>["protocolKit"] | undefined;
  if (hotSafeAddress) {
    const hotSafe = await initializeSafeForChain(chainId, hotSafeAddress);
    hotProtocolKit = hotSafe.protocolKit;
  }

  let successful = 0;
  let failed = 0;

  for (const txData of transactions) {
    const { isHot, ...tx } = txData;
    try {
      await retry(
        () => apiKit.proposeTransaction(tx),
        { logPrefix: "SafeService" }
      );

      // Execute hot wallet transactions on-chain immediately
      if (isHot && hotProtocolKit) {
        try {
          const confirmedTx = await retry(
            () => apiKit.getTransaction(tx.safeTxHash),
            { logPrefix: "SafeService" }
          );
          const result = await hotProtocolKit.executeTransaction(confirmedTx);
          logInfo("SafeService", `Executed hot wallet tx on-chain: ${tx.safeTxHash}, txHash: ${result.hash}`);
        } catch (execError) {
          logError("SafeService", execError as Error, {
            operation: "executeHotWalletTransaction",
            safeTxHash: tx.safeTxHash,
            nonce: tx.nonce,
            chainId,
          });
        }
      }

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

export async function initializeSafeForChain(chainId: number, safeAddress?: string) {
  const rpcUrl = getChainRpcUrl(chainId);
  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: config.safe.safeProposerPrivateKey || "",
    safeAddress: safeAddress || config.safe.address || "",
  });
  const apiKit = new SafeApiKit({ chainId: safeToBigInt(chainId), apiKey: config.safe.apiKey });

  return { protocolKit, apiKit };
}

async function getHotWalletBalance(
  rpcUrl: string,
  hotWalletAddress: string,
  tokenAddress: string,
): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const isEth = ensureHexPrefix(tokenAddress) === ZERO_ADDRESS;

  if (isEth) {
    return provider.getBalance(hotWalletAddress);
  }

  const erc20 = new Interface(ERC20_ABI.concat([
    "function balanceOf(address account) view returns (uint256)",
  ]));
  const data = erc20.encodeFunctionData("balanceOf", [safeChecksum(hotWalletAddress)]);
  const result = await provider.call({
    to: safeChecksum(tokenAddress),
    data,
  });
  return BigInt(result);
}

export async function createWithdrawalProposals(
  externalChainId: number,
  withdrawals: NonEmptyArray<WithdrawalInfo>
): Promise<SafeTransactionData[]> {
  const safeAddress = config.safe.address || "";
  const safeHotWalletAddress = config.safe.hotWalletAddress || "";
  const hasHotWallet = !!safeHotWalletAddress;
  const rpcUrl = getChainRpcUrl(externalChainId);

  // Resolve vault and rep bridge addresses for this chain
  const vaultAddress = getChainVaultAddress(externalChainId);
  const repBridgeAddress = getChainRepBridgeAddress(externalChainId);

  // Look up asset info to determine isNative per withdrawal
  const externalTokenAddresses = [...new Set(withdrawals.map(w => ensureHexPrefix(w.externalToken)))] as NonEmptyArray<string>;
  const assetInfoMap = await getAssetInfo(externalTokenAddresses, externalChainId);

  // Apply rebase multiplier for xStock withdrawals (multiply to get external rebasing amount)
  const stratoTokens = [...new Set(withdrawals.map(w => w.stratoToken).filter(Boolean))];
  if (stratoTokens.length > 0) {
    const factors = await getRebaseFactors(stratoTokens);
    for (const withdrawal of withdrawals) {
      const factor = factors.get(withdrawal.stratoToken);
      if (factor) {
        const original = BigInt(withdrawal.externalTokenAmount);
        const adjusted = (original * factor) / WAD;
        logInfo("SafeHelper", `Rebasing withdrawal ${withdrawal.withdrawalId}: ${original} → ${adjusted} (factor=${factor})`);
        withdrawal.externalTokenAmount = adjusted.toString();
      }
    }
  }

  // Check which withdrawals can actually use the hot wallet (balance check)
  if (hasHotWallet) {
    // Group hot wallet withdrawals by token to check balances
    const hotWalletWithdrawals = withdrawals.filter(w => w.useHotWallet);
    if (hotWalletWithdrawals.length > 0) {
      // Track remaining balance per token
      const tokenBalances = new Map<string, bigint>();
      for (const withdrawal of hotWalletWithdrawals) {
        const token = ensureHexPrefix(withdrawal.externalToken);
        if (!tokenBalances.has(token)) {
          try {
            const balance = await getHotWalletBalance(rpcUrl, safeHotWalletAddress, withdrawal.externalToken);
            tokenBalances.set(token, balance);
          } catch (error) {
            logError("SafeService", error as Error, {
              operation: "getHotWalletBalance",
              token,
              hotWalletAddress: safeHotWalletAddress,
            });
            tokenBalances.set(token, 0n);
          }
        }

        const remainingBalance = tokenBalances.get(token)!;
        const withdrawalAmount = BigInt(withdrawal.externalTokenAmount);
        if (withdrawalAmount > remainingBalance) {
          logInfo("SafeService", `Hot wallet insufficient balance for withdrawal ${withdrawal.withdrawalId} (need ${withdrawalAmount}, have ${remainingBalance}). Falling back to main safe.`);
          withdrawal.useHotWallet = false;
        } else {
          tokenBalances.set(token, remainingBalance - withdrawalAmount);
        }
      }
    }
  } else {
    // No hot wallet configured — force all to main safe
    for (const withdrawal of withdrawals) {
      if (withdrawal.useHotWallet) {
        logInfo("SafeService", `Hot wallet not configured. Falling back to main safe for withdrawal ${withdrawal.withdrawalId}.`);
        withdrawal.useHotWallet = false;
      }
    }
  }

  const needsHotWallet = withdrawals.some(w => w.useHotWallet);

  const { protocolKit, apiKit } = await initializeSafeForChain(externalChainId, safeAddress);

  // Only initialize hot wallet Safe if actually needed
  let hotProtocolKit: Awaited<ReturnType<typeof initializeSafeForChain>>["protocolKit"] | undefined;
  let hotApiKit: Awaited<ReturnType<typeof initializeSafeForChain>>["apiKit"] | undefined;
  if (needsHotWallet) {
    const hotSafe = await initializeSafeForChain(externalChainId, safeHotWalletAddress);
    hotProtocolKit = hotSafe.protocolKit;
    hotApiKit = hotSafe.apiKit;
  }

  const transactionProposals: SafeTransactionData[] = [];
  const relayer = config.safe.safeProposerAddress || "";
  let currentNonce = Number(await retry(
    () => apiKit.getNextNonce(safeAddress),
    { logPrefix: "SafeService" }
  ));
  let currentHotWalletNonce = needsHotWallet
    ? Number(await retry(
        () => hotApiKit!.getNextNonce(safeHotWalletAddress),
        { logPrefix: "SafeService" }
      ))
    : 0;

  for (const withdrawal of withdrawals) {
    let nonce;
    let toAddress;
    let protocolKitForWithdrawal;
    if (withdrawal.useHotWallet) {
      toAddress = safeHotWalletAddress;
      nonce = currentHotWalletNonce++;
      protocolKitForWithdrawal = hotProtocolKit!;
    } else {
      toAddress = safeAddress;
      nonce = currentNonce++;
      protocolKitForWithdrawal = protocolKit;
    }
    const assetKey = `${ensureHexPrefix(withdrawal.externalToken)}:${externalChainId}`;
    const asset = assetInfoMap.get(assetKey);
    const isNative = asset?.isNative ?? false;

    const descriptor = buildTxDescriptor({
      type: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? "eth" : "erc20",
      isNative,
      externalRecipient: withdrawal.externalRecipient,
      externalTokenAmount: withdrawal.externalTokenAmount,
      externalToken: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? undefined : withdrawal.externalToken,
      stratoToken: isNative ? withdrawal.stratoToken : undefined,
      vaultAddress,
      repBridgeAddress,
      nonce,
    });

    const safeTransaction = await protocolKitForWithdrawal.createTransaction(descriptor);
    const safeTxHash = await protocolKitForWithdrawal.getTransactionHash(safeTransaction);
    const signature = await protocolKitForWithdrawal.signHash(safeTxHash);

    logInfo("SafeService", `Created tx proposal: nonce ${nonce}, withdrawalId ${withdrawal.withdrawalId}, hot: ${!!withdrawal.useHotWallet}`);

    transactionProposals.push({
      safeAddress: toAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: relayer,
      senderSignature: signature.data,
      nonce,
      externalChainId: Number(withdrawal.externalChainId as string),
      isHot: withdrawal.useHotWallet || false,
    });
  }

  return transactionProposals;
}
