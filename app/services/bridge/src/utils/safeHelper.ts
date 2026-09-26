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
} from "../config";
import {
  ensureHexPrefix,
  safeChecksum,
  safeToBigInt,
} from "./utils";
import { logError, logInfo } from "./logger";
import { getRebaseFactors } from "../services/cirrusService";
import { WithdrawalInfo, SafeTransactionData, NonEmptyArray } from "../types";
import { retry } from "./api";
import { buildWithdrawalOrigin } from "./withdrawalOrigin";

// Constants
const NONCE_CONFLICT_CODES = [409, 422];
const NONCE_CONFLICT_PATTERNS = /nonce|already exists|conflict/i;

// Module-scope heavy objects
const erc20Interface = new Interface(ERC20_ABI.concat([
  "function approve(address spender, uint256 amount) public returns (bool)",
]));

const SETTLEMENT_ABI = [
  "function settleWithdrawal((uint256 sourceChainId,address sourceBridge,uint256 withdrawalId,address token,address recipient,uint256 amount,uint256 maxFee,uint256 requestedAt,uint256 feeHalfLife) terms) payable returns (address)",
];
const settlementInterface = new Interface(SETTLEMENT_ABI);

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

/**
 * The withdrawal terms the external-chain router settles against. Every field
 * is fixed when the user made the request, which is the whole point: the
 * payload below names the withdrawal, never a payee, so signers can sign it
 * before any solver exists and it still routes correctly once one appears.
 */
export function buildWithdrawalTerms(withdrawal: WithdrawalInfo) {
  return {
    sourceChainId: withdrawal.sourceChainId!,
    sourceBridge: safeChecksum(withdrawal.sourceBridge!),
    withdrawalId: String(withdrawal.withdrawalId),
    token: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS
      ? ZERO_ADDRESS
      : safeChecksum(withdrawal.externalToken),
    recipient: safeChecksum(withdrawal.externalRecipient),
    amount: withdrawal.externalTokenAmount,
    maxFee: withdrawal.feeTerms?.maxFee ?? "0",
    requestedAt: withdrawal.feeTerms?.requestedAt ?? "0",
    feeHalfLife: withdrawal.feeTerms?.feeHalfLife ?? "0",
  };
}

/**
 * Whether this withdrawal can be settled through the router.
 *
 * `settlementRouter` is only set once the router has been CONFIRMED to support
 * routed settlement (see {routerSupportsSettlement}), so this stays a cheap
 * synchronous check at proposal time.
 *
 * A withdrawal that cannot be routed keeps the direct transfer it was requested
 * under. That covers two cases which both have to keep working: one requested
 * before the fast-path upgrade, and one bound for a chain whose router has not
 * been upgraded yet. The migration has to drain in-flight withdrawals and serve
 * un-upgraded chains, not strand either.
 */
export function canRouteSettlement(withdrawal: WithdrawalInfo): boolean {
  return Boolean(
    withdrawal.settlementRouter &&
      withdrawal.sourceBridge &&
      withdrawal.sourceChainId &&
      withdrawal.feeTerms,
  );
}

// Per chain+router+settler, cached for the process: a router's implementation
// only changes on an upgrade, and a stale "no" costs a slow withdrawal while a
// stale "yes" costs a stalled one.
const settlementSupport = new Map<string, boolean>();

/**
 * Whether `router` can route a payout for `settler` on this chain.
 *
 * ASKED ON CHAIN, NEVER ASSUMED. STRATO commits a fee schedule to every
 * withdrawal once it is upgraded, including zero-fee ones, but the external
 * routers upgrade independently and on their own schedule -- Robinhood and
 * HyperEVM will still be on the old implementation when Sepolia and Base
 * Sepolia are new. Proposing a `settleWithdrawal` to a router that has no such
 * function makes the Safe transaction revert and the withdrawal stall, so the
 * capability is probed rather than inferred from a version number or a config
 * flag someone has to remember to set.
 *
 * `payoutSettlers` answers the whole question in one call: the selector only
 * exists on the new implementation, and a `true` also means this wallet is
 * allowed to call it. Anything else -- old implementation, settler not seeded,
 * unreachable RPC -- reads as "not yet", and the withdrawal takes the direct
 * transfer it would have taken anyway.
 */
export async function routerSupportsSettlement(
  chainId: number,
  router: string,
  settler: string,
): Promise<boolean> {
  const key = `${chainId}:${router.toLowerCase()}:${settler.toLowerCase()}`;
  const cached = settlementSupport.get(key);
  if (cached !== undefined) return cached;

  let supported = false;
  // Destroyed in `finally`: a JsonRpcProvider keeps a live poller, and a probe
  // that leaves one behind leaks a handle per chain and stops a process from
  // exiting on its own.
  let provider;
  try {
    provider = new JsonRpcProvider(getChainRpcUrl(chainId));
    const probe = new Interface([
      "function payoutSettlers(address) view returns (bool)",
    ]);
    const result = await provider.call({
      to: safeChecksum(router),
      data: probe.encodeFunctionData("payoutSettlers", [safeChecksum(settler)]),
    });
    supported = probe.decodeFunctionResult("payoutSettlers", result)[0] === true;
  } catch {
    supported = false;
  } finally {
    provider?.destroy();
  }

  if (!supported) {
    logInfo(
      "SafeService",
      `Router ${router} on chain ${chainId} is not routing settlements for ${settler}; ` +
        `withdrawals there stay on the direct transfer`,
    );
  }
  settlementSupport.set(key, supported);
  return supported;
}

/**
 * The STATIC settlement payload: the Safe calls the router, and the router pays
 * whoever holds the claim -- the recipient if nobody does, the last solver in
 * the ladder if one does.
 *
 * CUSTODY NEVER RESTS IN THE ROUTER. For an ERC20 this is a MultiSend of
 * [approve(router, amount), settleWithdrawal(terms)], so the allowance is
 * created and consumed inside one atomic transaction and the router only ever
 * directs a transfer it does not hold. For the native asset the settlement call
 * carries the value directly.
 */
export function buildSettlementDescriptor(params: {
  withdrawal: WithdrawalInfo;
  nonce: number;
}): { transactions: MetaTransactionData[]; options: { nonce: number } } {
  const { withdrawal, nonce } = params;
  const router = safeChecksum(withdrawal.settlementRouter!);
  const terms = buildWithdrawalTerms(withdrawal);
  const isNative = ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS;

  const settle: MetaTransactionData = {
    to: router,
    value: isNative ? withdrawal.externalTokenAmount : "0",
    data: settlementInterface.encodeFunctionData("settleWithdrawal", [terms]),
    operation: OperationType.Call,
  };

  if (isNative) {
    return { transactions: [settle], options: { nonce } };
  }

  return {
    transactions: [
      {
        to: safeChecksum(withdrawal.externalToken),
        value: "0",
        data: erc20Interface.encodeFunctionData("approve", [
          router,
          withdrawal.externalTokenAmount,
        ]),
        operation: OperationType.Call,
      },
      settle,
    ],
    options: { nonce },
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

// Returns the safeTxHashes the Safe transaction service accepted
export async function proposeTransactions(
  transactions: SafeTransactionData[],
  chainId: number,
): Promise<string[]> {
  const { apiKit } = await initializeSafeForChain(chainId);

  // Initialize hot wallet protocol kit once if any hot transactions exist
  const hotSafeAddress = transactions.find(t => t.isHot)?.safeAddress;
  let hotProtocolKit: Awaited<ReturnType<typeof initializeSafeForChain>>["protocolKit"] | undefined;
  if (hotSafeAddress) {
    const hotSafe = await initializeSafeForChain(chainId, hotSafeAddress);
    hotProtocolKit = hotSafe.protocolKit;
  }

  const proposed: string[] = [];
  let failed = 0;

  for (const txData of transactions) {
    const { isHot, withdrawalId, ...tx } = txData;
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

      proposed.push(tx.safeTxHash);
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

  logInfo("SafeService", `Proposed transactions for chain ${chainId}: ${proposed.length} successful, ${failed} failed out of ${transactions.length} total`);
  return proposed;
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
    // A fast-path withdrawal is settled through the router, so that a solver
    // who claims it AFTER this proposal is signed is still the one paid. A
    // pre-upgrade withdrawal has no router and keeps the direct transfer.
    const descriptor = canRouteSettlement(withdrawal)
      ? buildSettlementDescriptor({ withdrawal, nonce })
      : buildTxDescriptor({
          type: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? "eth" : "erc20",
          externalRecipient: withdrawal.externalRecipient,
          externalTokenAmount: withdrawal.externalTokenAmount,
          externalToken: ensureHexPrefix(withdrawal.externalToken) === ZERO_ADDRESS ? undefined : withdrawal.externalToken,
          nonce,
        });

    const safeTransaction = await protocolKitForWithdrawal.createTransaction(descriptor);
    const safeTxHash = await protocolKitForWithdrawal.getTransactionHash(safeTransaction);
    const signature = await protocolKitForWithdrawal.signHash(safeTxHash);

    logInfo(
      "SafeService",
      `Created tx proposal: nonce ${nonce}, withdrawalId ${withdrawal.withdrawalId}, ` +
        `hot: ${!!withdrawal.useHotWallet}, routed: ${canRouteSettlement(withdrawal)}`,
    );

    transactionProposals.push({
      withdrawalId: String(withdrawal.withdrawalId),
      origin: buildWithdrawalOrigin(config.bridge.address!, String(withdrawal.withdrawalId)),
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
