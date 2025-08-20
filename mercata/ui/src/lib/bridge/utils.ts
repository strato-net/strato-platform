import { decodeErrorResult } from "viem";
import { DEPOSIT_ROUTER_ABI } from "./constants";
import { BridgeError } from "./types";

/**
 * Normalizes errors from various sources into a consistent BridgeError format
 */
export function normalizeError(error: any): BridgeError {
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

  // Handle user rejections
  if (error?.message?.includes("User rejected")) {
    return {
      code: "USER_REJECTED",
      message: error.message,
      userMessage: "Transaction cancelled by user",
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
    userMessage: "An unexpected error occurred. Please try again.",
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
