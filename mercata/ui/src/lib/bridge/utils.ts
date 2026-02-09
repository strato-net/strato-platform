import { decodeErrorResult } from "viem";
import { message } from "antd";
import { DEPOSIT_ROUTER_ABI, SUPPORTED_CHAINS } from "./constants";
import { BridgeError } from "./types";

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

/**
 * Maps error codes to user-friendly messages
 */
function getFriendlyMessage(errorName: string, data?: `0x${string}`): string {
  switch (errorName) {
    case "TokenNotAllowed":
      return "This token is not currently supported for bridging.";
    case "BelowMinimum":
      return "Amount is below minimum required. Please try a larger amount.";
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
  { value: 1, label: "Initiated" },
  { value: 2, label: "Pending Review" },
  { value: 3, label: "Completed" },
  { value: 4, label: "Aborted" },
];

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
