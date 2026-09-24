import { decodeErrorResult } from "viem";
import { message } from "antd";
import { WAD } from "@/lib/constants";
import { BRIDGE_SCOPES, DEPOSIT_ROUTER_ABI, SUPPORTED_CHAINS } from "./constants";
import type { BridgeToken, CompositeRouteQuoteResponse } from "@strato/shared-types";
import { AutoRouteQuoteBinding, BridgeError, WithdrawalPreview } from "./types";

export const ExternalBridgeStatus = {
  NONE: 0,
  INITIATED: 1,
  PENDING_REVIEW: 2,
  READY: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  REFUNDED: 6,
  ABORTED: 7,
} as const;

/**
 * Normalizes errors from various sources into a consistent BridgeError format
 */
export function normalizeError(error: any): BridgeError {
  // Handle user rejections first (before other error processing)
  const errorMessage = error?.message || error?.shortMessage || "";
  const errorName = error?.name || "";
  
  if (
    errorMessage.includes("User rejected") ||
    errorMessage.includes("User denied") ||
    errorMessage.includes("denied transaction") ||
    errorName === "UserRejectedRequestError"
  ) {
    return {
      code: "USER_REJECTED",
      message: error.message || errorMessage,
      userMessage: "Transaction cancelled. You can try again when ready.",
    };
  }

  // Handle viem errors
  if (error?.shortMessage) {
    return {
      code: error.code,
      reason: error.shortMessage,
      data: error.data,
      message: error.message,
      userMessage: getFriendlyMessage(error.shortMessage, error.data),
    };
  }

  if (error?.response) {
    const data = error.response.data;
    const message = data?.error?.message || data?.error || data?.message;
    return {
      code: "API_ERROR",
      message: typeof message === "string" ? message : errorMessage,
      userMessage: error.response.status < 500 && typeof message === "string"
        ? getFriendlyMessage(message)
        : "Something went wrong. Please try again later.",
    };
  }

  // Handle network-specific errors
  if (error?.message?.includes("network")) {
    return {
      code: "NETWORK_ERROR",
      message: error.message,
      userMessage: "Network error. Please check your connection and try again.",
    };
  }

  // Handle gas estimation errors
  if (
    error?.message?.includes("gas") ||
    error?.message?.includes("insufficient funds")
  ) {
    return {
      code: "GAS_ERROR",
      message: error.message,
      userMessage:
        "Insufficient funds for gas fees. Please add more ETH to your wallet.",
    };
  }

  // Handle contract reverts with custom errors
  if (error?.data) {
    try {
      const decoded = decodeErrorResult({
        abi: DEPOSIT_ROUTER_ABI,
        data: error.data,
      });

      return {
        code: decoded.errorName,
        reason: decoded.errorName,
        data: error.data,
        message: error.message,
        userMessage: getFriendlyMessage(decoded.errorName, error.data),
      };
    } catch {
      // Fall through to generic error handling
    }
  }

  // Generic error handling
  return {
    code: "UNKNOWN_ERROR",
    message: error?.message || "Unknown error occurred",
    userMessage: error?.message || "An unexpected error occurred. Please try again.",
  };
}

export function getQuoteErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status && status >= 500) return "Quote unavailable. Please try again.";
  const { message } = normalizeError(error);
  if (message.includes("No executable route") || message.includes("No route found")) {
    return getFriendlyMessage(message);
  }
  if (/timeout|timed out/i.test(message)) return "Quote request timed out. Please try again.";
  if (/network error/i.test(message)) return "Unable to fetch a quote. Check your connection and try again.";
  return "Quote unavailable. Please try again.";
}

/**
 * Maps error codes to user-friendly messages
 */
export function getFriendlyMessage(errorName: string, data?: `0x${string}`): string {
  if (errorName.includes("TR: unregistered")) return "The selected pool is not recognized by the trade router. Please contact support.";
  if (errorName.startsWith("Quote expired after approval")) return "Quote expired after approval. Your approval succeeded and is reusable; request a new quote. No deposit was sent.";
  if (errorName.startsWith("Quote expired")) return "Quote expired; request a new quote.";
  if (errorName.includes("No executable route") || errorName.includes("No route found")) return "No route is available for this amount. Try a different amount or token.";
  switch (errorName) {
    case "Trade details changed; review your trade again":
      return "Your trade details or receiving account changed. Review the trade again before submitting.";
    case "Contract wallet cannot receive on STRATO":
      return "This contract wallet cannot receive at the same address on STRATO. Sign in to your STRATO account or connect a key-controlled wallet before depositing.";
    case "Recipient wallet check unavailable":
      return "Unable to verify the receiving wallet. No deposit was sent. Please try again.";
    case "Deposit wallet or session changed":
      return "Your wallet or sign-in session changed. No deposit was sent. Check the receiving account and start again; any completed token approval remains reusable.";
    case "TokenNotAllowed":
      return "This token is not currently supported for bridging.";
    case "BelowMinimum":
      return "Amount is below minimum required. Please try a larger amount.";
    case "NotPermitted":
      return "This token route is not permitted for deposits.";
    case "InvalidAddress":
      return "Invalid address provided. Please check your wallet connection.";
    case "ETHTransferFailed":
      return "ETH transfer failed. Please check your balance and try again.";
    case "insufficient allowance":
      return "Insufficient token allowance. Please approve Permit2 first.";
    case "nonce":
      return "Nonce error. Please try again in a few seconds.";
    case "deadline":
      return "Transaction deadline expired. Please try again.";
    case "USER_REJECTED":
      return "Transaction cancelled by user";
    case "execution reverted":
    case "External bridge transaction reverted":
      return "Transaction reverted. Please check your inputs and try again.";
    case "insufficient funds":
      return "Insufficient funds for gas fees. Please add more ETH to your wallet.";
    case "network error":
      return "Network error. Please check your connection and try again.";
    case "timeout":
      return "Transaction timed out. Please try again.";
    default:
      return "Transaction failed. Please try again or contact support if the issue persists.";
  }
}

/**
 * Formats a transaction hash for display
 */
export function formatTxHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

/**
 * Formats a date string for display
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch (error) {
    return dateString;
  }
}

/**
 * Creates an explorer URL for a transaction
 */
export function getExplorerUrl(chainId: string, txHash: string): string {
  const chainIdNum = parseInt(chainId);

  switch (chainIdNum) {
    case 1: // Mainnet
      return `https://etherscan.io/tx/${txHash}`;
    case 11155111: // Sepolia
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case 137: // Polygon
      return `https://polygonscan.com/tx/${txHash}`;
    case 10: // Optimism
      return `https://optimistic.etherscan.io/tx/${txHash}`;
    case 8453: // Base
      return `https://basescan.org/tx/${txHash}`;
    case 84532: // Base Sepolia
      return `https://sepolia.basescan.org/tx/${txHash}`;
    case 42161: // Arbitrum
      return `https://arbiscan.io/tx/${txHash}`;
    case 56: // BSC
      return `https://bscscan.com/tx/${txHash}`;
    case 43114: // Avalanche
      return `https://snowtrace.io/tx/${txHash}`;
    case 4663: // Robinhood Chain
      return `https://robinhoodchain.blockscout.com/tx/${txHash}`;
    case 46630: // Robinhood Chain Testnet
      return `https://explorer.testnet.chain.robinhood.com/tx/${txHash}`;
    case 999: // HyperEVM
      return `https://hyperevmscan.io/tx/${txHash}`;
    default:
      return `https://etherscan.io/tx/${txHash}`;
  }
}

/**
 * Gets chain name from chain ID (supports both number and string)
 */
export function getChainName(chainId: number | string): string {
  const chainEntries = Object.entries(SUPPORTED_CHAINS);
  const chainEntry = chainEntries.find(([_, id]) => id === chainId);
  return chainEntry ? chainEntry[0] : "Unknown Chain";
}

/**
 * Bridge status options for filter dropdowns
 */
export const BRIDGE_STATUS_OPTIONS = [
  { value: 0, label: "All Statuses" },
  { value: ExternalBridgeStatus.INITIATED, label: "Initiated" },
  { value: ExternalBridgeStatus.PENDING_REVIEW, label: "Pending Review" },
  { value: ExternalBridgeStatus.READY, label: "Ready" },
  { value: ExternalBridgeStatus.COMPLETED, label: "Completed" },
  { value: ExternalBridgeStatus.CANCELLED, label: "Cancelled" },
  { value: ExternalBridgeStatus.REFUNDED, label: "Refunded" },
  { value: ExternalBridgeStatus.ABORTED, label: "Aborted" },
];

export const DEPOSIT_STATUS_OPTIONS = BRIDGE_STATUS_OPTIONS.filter(({ value }) =>
  [0, ExternalBridgeStatus.INITIATED, ExternalBridgeStatus.PENDING_REVIEW, ExternalBridgeStatus.COMPLETED, ExternalBridgeStatus.ABORTED].includes(value)
);

/**
 * Chain options for filter dropdowns
 */
export const CHAIN_OPTIONS = [
  { value: null, label: "All Chains" },
  ...Object.entries(SUPPORTED_CHAINS).map(([name, id]) => ({
    value: id,
    label: name,
  })),
];

/**
 * Handles copying text to clipboard with user feedback
 */
export const handleCopyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    message.success("Copied to clipboard");
  } catch (error) {
    message.error("Failed to copy");
  }
};

export function mergePendingDeposits(apiDeposits: any[], storageKey: string = BRIDGE_SCOPES.fund.pendingDepositsKey): {
  remaining: any[];
} {
  // Move pending Trade-New submissions recorded before the storage split.
  const fundPending = JSON.parse(localStorage.getItem(BRIDGE_SCOPES.fund.pendingDepositsKey) || '[]');
  const isTradeDeposit = (deposit: any) => !!deposit.depositRouter || deposit.routeType === "native" || deposit.type === "route";
  const tradePending = fundPending.filter(isTradeDeposit);
  if (tradePending.length) {
    const existing = JSON.parse(localStorage.getItem(BRIDGE_SCOPES.trade.pendingDepositsKey) || '[]');
    const known = new Set(existing.map((deposit: any) => `${deposit.externalChainId}:${deposit.externalTxHash}`));
    localStorage.setItem(BRIDGE_SCOPES.trade.pendingDepositsKey, JSON.stringify([
      ...existing, ...tradePending.filter((deposit: any) => !known.has(`${deposit.externalChainId}:${deposit.externalTxHash}`)),
    ]));
    localStorage.setItem(BRIDGE_SCOPES.fund.pendingDepositsKey, JSON.stringify(fundPending.filter((deposit: any) => !isTradeDeposit(deposit))));
  }
  const pendingRaw = JSON.parse(localStorage.getItem(storageKey) || '[]');
  const apiTxHashes = new Set(apiDeposits.map((tx: any) => tx?.externalTxHash));
  const remaining = pendingRaw.filter((p: any) => !apiTxHashes.has(p?.externalTxHash));
  localStorage.setItem(storageKey, JSON.stringify(remaining));
  return { remaining };
}

export function assertAutoRouteQuote(
  quote: CompositeRouteQuoteResponse,
  binding: AutoRouteQuoteBinding,
  now = Math.floor(Date.now() / 1000),
): void {
  const address = (value: string) => {
    const normalized = value.replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("Invalid quote token address");
    return normalized;
  };
  if (!Number.isSafeInteger(quote.deadline) || quote.deadline <= now) throw new Error("Quote expired; request a new quote");
  if (binding.routeType && quote.bridge.routeType !== binding.routeType) throw new Error("Quote bridge type changed");
  if (binding.routeType === "native" && (!binding.externalBridge || !quote.bridge.externalBridge ||
      BigInt(`0x${address(binding.externalBridge)}`) === 0n ||
      address(binding.externalBridge) !== address(quote.bridge.externalBridge) ||
      BigInt(quote.bridge.bridgedAmount) !== binding.externalAmount)) {
    throw new Error("Invalid native redemption quote");
  }
  if (BigInt(quote.bridge.externalChainId) !== BigInt(binding.externalChainId) ||
      address(quote.bridge.externalToken) !== address(binding.externalToken) ||
      address(quote.bridge.targetStratoToken) !== address(binding.targetStratoToken) ||
      address(quote.tokenIn) !== address(binding.targetStratoToken) ||
      address(quote.tokenOut) !== address(binding.tokenOut) ||
      address(quote.depositAction.actionToken) !== address(binding.tokenOut)) throw new Error("Quote does not match the selected route and output token");
  if (binding.externalAmount <= 0n || BigInt(quote.bridge.externalAmount) !== binding.externalAmount ||
      Number(quote.bridge.externalDecimals) !== binding.externalDecimals ||
      BigInt(quote.amountIn) !== BigInt(quote.bridge.bridgedAmount) || BigInt(quote.amountIn) <= 0n) throw new Error("Quote does not match the deposit amount");
  if (!Number.isInteger(binding.slippageBps) || binding.slippageBps < 1 || binding.slippageBps >= 10000 ||
      quote.slippageBps !== binding.slippageBps) throw new Error("Quote slippage does not match");
  const minimum = BigInt(quote.depositAction.minFinalOut);
  const output = BigInt(quote.amountOut);
  if (minimum <= 0n || minimum !== BigInt(quote.minFinalOut) || minimum > output ||
      minimum < output * BigInt(10000 - binding.slippageBps) / 10000n) throw new Error("Invalid quote minimum output");
  const plain = address(binding.targetStratoToken) === address(binding.tokenOut);
  if (quote.depositAction.action !== (plain ? 0 : 4) || (plain && (quote.steps.length !== 0 || output !== BigInt(quote.amountIn) || minimum !== output))) {
    throw new Error("Quote action does not match the selected output token");
  }
}

export function isWithdrawalRouteAvailable(route: BridgeToken): boolean {
  return route.enabled && (route.routeType === "native"
    ? !!route.externalBridge && !route.withdrawalsPaused && !route.withdrawalsDisabled
    : route.withdrawalsEnabled === true);
}

export function getWithdrawalPreview(route: BridgeToken, amount: bigint): WithdrawalPreview {
  if (!isWithdrawalRouteAvailable(route)) throw new Error("Withdrawals are unavailable for this asset.");
  if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
  const native = route.routeType === "native";
  let externalAmount = amount, escrowAmount = amount;
  if (!native) {
    const decimals = Number(route.externalDecimals);
    if (!/^\d+$/.test(String(route.externalDecimals)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error("External token decimals are unavailable.");
    }
    const scale = 10n ** BigInt(18 - decimals);
    if (route.rebaseRequired) {
      const factor = BigInt(route.rebaseFactor || "0");
      if (factor <= 0n) throw new Error("The asset conversion rate is unavailable. Try again shortly.");
      const scaledWad = scale * WAD;
      externalAmount = amount * factor / scaledWad;
      escrowAmount = (externalAmount * scaledWad + factor - 1n) / factor;
    } else {
      externalAmount = amount / scale;
      escrowAmount = externalAmount * scale;
    }
  }
  if (externalAmount <= 0n) throw new Error("Amount is below the external token's minimum unit.");
  const cap = BigInt(route.maxPerWithdrawal || "0");
  if (cap > 0n && (native ? amount : externalAmount) > cap) throw new Error("Amount exceeds the per-withdrawal limit.");
  if (native && BigInt(route.maxOutstandingWithdrawal || "0") > 0n && amount > BigInt(route.remainingOutstandingWithdrawal || "0")) {
    throw new Error("Amount exceeds the remaining bridge capacity.");
  }
  const threshold = BigInt((native ? route.instantWithdrawalThreshold : route.manualReviewThreshold) || "0");
  return {
    externalAmount: externalAmount.toString(), escrowAmount: escrowAmount.toString(),
    manualReview: native ? threshold === 0n || amount > threshold : threshold > 0n && externalAmount > threshold,
  };
}
