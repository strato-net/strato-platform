import { ethers } from "ethers";
import { getChainRpcUrl, getChainVaultAddress, getChainRepBridgeAddress } from "../config";
import { logInfo, logError } from "../utils/logger";
import { ExecutionResult } from "../types";

const LOG_CTX = "VaultService";

// =============================================================================
// ABIs (human-readable, ethers v6)
// =============================================================================

const VAULT_ABI = [
  "function release(address token, address recipient, uint256 amount) external",
  "function releaseETH(address payable recipient, uint256 amount) external",
  "function remainingRateLimit(address token) external view returns (uint256)",
];

const REP_BRIDGE_ABI = [
  "function mintRepresentation(address stratoToken, address recipient, uint256 amount) external",
  "function burnRepresentation(address stratoToken, address from, uint256 amount) external",
  "function getRepresentationToken(address stratoToken) external view returns (address)",
  "function remainingMintLimit(address stratoToken) external view returns (uint256)",
  "function remainingBurnLimit(address stratoToken) external view returns (uint256)",
];

const ERC20_BALANCE_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

// =============================================================================
// Helpers
// =============================================================================

function getSignerForChain(chainId: number): ethers.Wallet {
  const pk = process.env.ACROSS_SIGNER_PRIVATE_KEY;
  if (!pk) {
    throw new Error("ACROSS_SIGNER_PRIVATE_KEY (relayer EOA) is not configured");
  }
  const rpcUrl = getChainRpcUrl(chainId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
}

function getProviderForChain(chainId: number): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(getChainRpcUrl(chainId));
}

// =============================================================================
// ExternalBridgeVault Operations
// =============================================================================

/**
 * Release ERC-20 tokens from ExternalBridgeVault to a recipient.
 * Used for external-canonical withdrawal execution.
 */
export async function releaseFromVault(
  chainId: number,
  token: string,
  recipient: string,
  amount: string,
): Promise<ExecutionResult> {
  try {
    const vaultAddress = getChainVaultAddress(chainId);
    const signer = getSignerForChain(chainId);
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);

    logInfo(LOG_CTX, "Releasing from vault", {
      chainId,
      token,
      recipient,
      amount,
      vault: vaultAddress,
    });

    const tx = await vault.release(token, recipient, amount);
    const receipt = await tx.wait();

    logInfo(LOG_CTX, "Vault release confirmed", {
      txHash: receipt.hash,
      chainId,
    });

    return { success: true, txHash: receipt.hash };
  } catch (error: any) {
    logError(LOG_CTX, error, { operation: "releaseFromVault", chainId, token });
    return { success: false, error: error.message };
  }
}

/**
 * Release native ETH from ExternalBridgeVault to a recipient.
 */
export async function releaseETHFromVault(
  chainId: number,
  recipient: string,
  amount: string,
): Promise<ExecutionResult> {
  try {
    const vaultAddress = getChainVaultAddress(chainId);
    const signer = getSignerForChain(chainId);
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);

    logInfo(LOG_CTX, "Releasing ETH from vault", {
      chainId,
      recipient,
      amount,
      vault: vaultAddress,
    });

    const tx = await vault.releaseETH(recipient, amount);
    const receipt = await tx.wait();

    logInfo(LOG_CTX, "Vault ETH release confirmed", {
      txHash: receipt.hash,
      chainId,
    });

    return { success: true, txHash: receipt.hash };
  } catch (error: any) {
    logError(LOG_CTX, error, { operation: "releaseETHFromVault", chainId });
    return { success: false, error: error.message };
  }
}

// =============================================================================
// StratoRepresentationBridge Operations
// =============================================================================

/**
 * Mint representation tokens on an external chain.
 * Used for STRATO-canonical outbound (STRATO -> external).
 */
export async function mintRepresentation(
  chainId: number,
  stratoToken: string,
  recipient: string,
  amount: string,
): Promise<ExecutionResult> {
  try {
    const repBridgeAddress = getChainRepBridgeAddress(chainId);
    if (!repBridgeAddress) {
      return {
        success: false,
        error: `No StratoRepresentationBridge configured for chain ${chainId}`,
      };
    }

    const signer = getSignerForChain(chainId);
    const repBridge = new ethers.Contract(repBridgeAddress, REP_BRIDGE_ABI, signer);

    logInfo(LOG_CTX, "Minting representation", {
      chainId,
      stratoToken,
      recipient,
      amount,
    });

    const tx = await repBridge.mintRepresentation(stratoToken, recipient, amount);
    const receipt = await tx.wait();

    logInfo(LOG_CTX, "Representation mint confirmed", {
      txHash: receipt.hash,
      chainId,
    });

    return { success: true, txHash: receipt.hash };
  } catch (error: any) {
    logError(LOG_CTX, error, {
      operation: "mintRepresentation",
      chainId,
      stratoToken,
    });
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Balance Queries
// =============================================================================

/**
 * Get the ERC-20 balance of a token held in the ExternalBridgeVault.
 */
export async function getVaultBalance(
  chainId: number,
  token: string,
): Promise<bigint> {
  const vaultAddress = getChainVaultAddress(chainId);
  const provider = getProviderForChain(chainId);
  const erc20 = new ethers.Contract(token, ERC20_BALANCE_ABI, provider);
  return erc20.balanceOf(vaultAddress);
}

/**
 * Get the native ETH balance of the ExternalBridgeVault.
 */
export async function getVaultETHBalance(chainId: number): Promise<bigint> {
  const vaultAddress = getChainVaultAddress(chainId);
  const provider = getProviderForChain(chainId);
  return provider.getBalance(vaultAddress);
}

/**
 * Get remaining rate limit capacity for a token on a vault.
 */
export async function getVaultRateLimit(
  chainId: number,
  token: string,
): Promise<bigint> {
  const vaultAddress = getChainVaultAddress(chainId);
  const provider = getProviderForChain(chainId);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
  return vault.remainingRateLimit(token);
}

/**
 * Get remaining mint rate limit for a STRATO token on the StratoRepresentationBridge.
 */
export async function getRepBridgeMintLimit(
  chainId: number,
  stratoToken: string,
): Promise<bigint> {
  const repBridgeAddress = getChainRepBridgeAddress(chainId);
  if (!repBridgeAddress) return 0n;
  const provider = getProviderForChain(chainId);
  const repBridge = new ethers.Contract(repBridgeAddress, REP_BRIDGE_ABI, provider);
  return repBridge.remainingMintLimit(stratoToken);
}
