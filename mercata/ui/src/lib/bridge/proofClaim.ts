import {
  switchChain,
  writeContract,
  readContract,
  waitForTransactionReceipt,
  type Config as WagmiConfig,
} from "wagmi/actions";
import type { WithdrawalProof } from "@mercata/shared-types";

/**
 * Per-chain deployment addresses for the proof-based bridge contracts. The
 * frontend needs both: STRATOLightClient to submit the STRATO header (so the
 * vault can trust the receipts root), and BridgeVault to actually claim.
 *
 * Sourced from the on-chain MercataBridge `chains[externalChainId]` mapping
 * (set via `setChain`); surfaced to the UI as
 * `chainInfo.bridgeVault` / `chainInfo.stratoLightClient` in NetworkConfig.
 */
export interface BridgeDeployment {
  vault: `0x${string}`;
  lightClient: `0x${string}`;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000".toLowerCase();

function isLikelyAddress(addr: unknown): addr is string {
  if (typeof addr !== "string") return false;
  const a = addr.toLowerCase();
  if (a === ZERO_ADDR) return false;
  // Accept either 0x-prefixed 40-char hex, or 40-char hex without prefix.
  return /^(0x)?[0-9a-f]{40}$/.test(a);
}

function ensureHex(addr: string): `0x${string}` {
  return (addr.startsWith("0x") ? addr : `0x${addr}`) as `0x${string}`;
}

/**
 * Build a BridgeDeployment from the chain config the backend returned, or
 * null if the chain doesn't have proof-bridge contracts wired up yet.
 */
export function deploymentFromChainInfo(info: {
  bridgeVault: string;
  stratoLightClient: string;
}): BridgeDeployment | null {
  if (!isLikelyAddress(info.bridgeVault) || !isLikelyAddress(info.stratoLightClient)) {
    return null;
  }
  return {
    vault: ensureHex(info.bridgeVault),
    lightClient: ensureHex(info.stratoLightClient),
  };
}

/**
 * Minimal ABI subset used by the proof-claim flow. Full ABIs live in the
 * Hardhat artifacts; we only encode the methods the UI actually calls.
 */
export const STRATO_LIGHT_CLIENT_ABI = [
  {
    inputs: [],
    name: "tip",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "headerRLP", type: "bytes" },
      { name: "signatures", type: "bytes[]" },
    ],
    name: "submitHeader",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const BRIDGE_VAULT_ABI = [
  {
    inputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "txIndex", type: "uint256" },
      { name: "logIndex", type: "uint256" },
      { name: "mptProof", type: "bytes[]" },
      { name: "receiptRLP", type: "bytes" },
    ],
    name: "claimWithdrawal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "blockNumber", type: "uint256" },
      { name: "txIndex", type: "uint256" },
      { name: "logIndex", type: "uint256" },
      { name: "mptProof", type: "bytes[]" },
      { name: "receiptRLP", type: "bytes" },
    ],
    name: "submitProof",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type ClaimProgress =
  | { phase: "switching-chain"; chainId: number }
  | { phase: "submitting-header" }
  | { phase: "header-submitted"; txHash: `0x${string}` }
  | { phase: "header-already-known" }
  | { phase: "claiming" }
  | { phase: "claimed"; txHash: `0x${string}` };

export interface ClaimWithdrawalParams {
  wagmiConfig: WagmiConfig;
  proof: WithdrawalProof;
  externalChainId: string | number;
  /** Vault + light-client addresses on the external chain. */
  deployment: BridgeDeployment;
  /**
   * For 'small' withdrawals (Withdrawal event), call `claimWithdrawal` -- funds
   * release atomically. For 'large' withdrawals (WithdrawalRequestedV2 event)
   * use `submitProof`, which records the proof and waits for admin approval.
   * The frontend distinguishes by inspecting which log the proof points at;
   * for now, default to claimWithdrawal -- callers can override.
   */
  method?: "claimWithdrawal" | "submitProof";
  onProgress?: (p: ClaimProgress) => void;
}

/**
 * Drive the external-chain bridge claim with a STRATO inclusion proof.
 *
 * Steps:
 *  1. Ensure the wallet is on the external chain.
 *  2. If the light client's tip is below the proof's blockNumber, submit the
 *     STRATO header so the vault can trust the receipts root. If the header
 *     was already submitted, skip (anyone can have submitted it).
 *  3. Call BridgeVault.claimWithdrawal (or submitProof) with the proof bytes.
 *
 * Throws on user rejection or contract revert; the caller is responsible
 * for surfacing the error.
 */
export async function claimWithdrawalOnExternalChain({
  wagmiConfig,
  proof,
  externalChainId,
  deployment,
  method = "claimWithdrawal",
  onProgress,
}: ClaimWithdrawalParams): Promise<{ claimTxHash: `0x${string}`; headerTxHash?: `0x${string}` }> {
  const chainIdNum = typeof externalChainId === "string" ? Number(externalChainId) : externalChainId;
  onProgress?.({ phase: "switching-chain", chainId: chainIdNum });
  await switchChain(wagmiConfig, { chainId: chainIdNum });

  let headerTxHash: `0x${string}` | undefined;
  const tip = (await readContract(wagmiConfig, {
    address: deployment.lightClient,
    abi: STRATO_LIGHT_CLIENT_ABI,
    functionName: "tip",
    chainId: chainIdNum,
  })) as bigint;

  if (tip < BigInt(proof.blockNumber)) {
    onProgress?.({ phase: "submitting-header" });
    headerTxHash = await writeContract(wagmiConfig, {
      address: deployment.lightClient,
      abi: STRATO_LIGHT_CLIENT_ABI,
      functionName: "submitHeader",
      args: [
        proof.headerRLP as `0x${string}`,
        proof.signatures as `0x${string}`[],
      ],
      chainId: chainIdNum,
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: headerTxHash, chainId: chainIdNum });
    onProgress?.({ phase: "header-submitted", txHash: headerTxHash });
  } else {
    onProgress?.({ phase: "header-already-known" });
  }

  onProgress?.({ phase: "claiming" });
  const claimTxHash = await writeContract(wagmiConfig, {
    address: deployment.vault,
    abi: BRIDGE_VAULT_ABI,
    functionName: method,
    args: [
      BigInt(proof.blockNumber),
      BigInt(proof.txIndex),
      BigInt(proof.logIndex),
      proof.mptProof as `0x${string}`[],
      proof.receiptRLP as `0x${string}`,
    ],
    chainId: chainIdNum,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: claimTxHash, chainId: chainIdNum });
  onProgress?.({ phase: "claimed", txHash: claimTxHash });

  return { claimTxHash, headerTxHash };
}
