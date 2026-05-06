/**
 * Frontend orchestrator for the trustless bridge-in claim flow.
 *
 * Mirrors the OUT-side {@link proofClaim.claimWithdrawalOnExternalChain}
 * but inverted: STRATO is the destination chain, so the entire batch
 * (anchorBlockHeader + claim) lands via the standard backend tx
 * pipeline rather than wagmi.writeContract. The wallet still signs
 * each tx — the backend interceptor surfaces unsigned envelopes when
 * the user is wallet-authenticated.
 *
 * For the LP fast-finality path, callers can pre-sign a
 * ClaimAssignment via {@link signAssignment} and pass it into
 * claimTrustlessDeposit; the on-chain claim then redirects credit
 * to assignment.newRecipient.
 */
import { api } from "@/lib/axios";
import type { WalletTxProgressEvent } from "@/lib/axios";

/**
 * The per-phase signal the modal listens to. Compare to
 * `WithdrawalStep` in WithdrawalProgressModal — the trustless flow is
 * a strict subset because there's no chain-switch and no catch-up.
 *
 * The same step set serves both Eth and Base/Cannon paths; the modal
 * relabels copy per `flavor` to surface flow-specific work (parent
 * walk, dispute-game search, etc.) under the build_proof phase.
 */
export type TrustlessClaimStep =
  | "build_proof"        // Backend assembles anchor + claim inputs
  | "submit_strato"      // User wallet signs and submits the STRATO batch
  | "complete"
  | "error";

/** Tag returned by /bridge/trustlessConfig — drives UI labelling. */
export type LightClientFlavor = "eth" | "base";

export interface ClaimAssignmentInput {
  depositKey: `0x${string}`;
  newRecipient: `0x${string}`;
  deadline: string | number | bigint;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface TrustlessClaimRequest {
  externalChainId: string | number;
  externalTxHash: string;
  assignment?: ClaimAssignmentInput;
  walletAuth?: any;
  walletTxProgress?: (e: WalletTxProgressEvent) => void;
  onProgress?: (step: TrustlessClaimStep) => void;
}

export interface TrustlessClaimResult {
  status?: string;
  hashes: string[];
  /** Backend skipped the source-chain anchor tx (block already on-chain). */
  anchorSkipped: boolean;
  /** Backend skipped the L1 anchor tx (Cannon flow only; L1 already anchored). */
  l1AnchorSkipped: boolean;
  blockNumber: string;
  flavor: LightClientFlavor;
}

export interface TrustlessConfig {
  flavor: LightClientFlavor;
  bridgeIn: `0x${string}`;
  lightClient: `0x${string}`;
  depositRoutedSig: `0x${string}`;
  /** Base flavor only: the wrapped L1 EthLightClient. */
  l1LightClient?: `0x${string}`;
}

/**
 * Fetch the per-source-chain bridge-in deployment metadata. Returns
 * undefined when the trustless path is disabled (503) or the chain
 * isn't supported (400) so the UI can hide the entry point gracefully.
 */
export async function fetchTrustlessConfig(
  chainId: string | number,
): Promise<TrustlessConfig | undefined> {
  try {
    const { data } = await api.get<{ success: boolean; data: TrustlessConfig }>(
      `/bridge/trustlessConfig/${chainId}`,
    );
    return data?.data;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 503 || status === 400) return undefined;
    throw err;
  }
}

/**
 * Submit a trustless bridge-in claim. The backend builds the proof
 * and packages a 1- or 2-tx STRATO batch; this function just walks
 * the user through phase progress and returns the resulting hashes.
 *
 * Errors map back to the same semantic codes the controller emits
 * (NOT_FINALIZED_YET, DEPOSIT_TOO_OLD, NO_DEPOSIT_LOG, TRUSTLESS_DISABLED)
 * via the `code` field on the response payload, which we re-throw.
 */
export async function claimTrustlessDeposit({
  externalChainId,
  externalTxHash,
  assignment,
  walletAuth,
  walletTxProgress,
  onProgress,
}: TrustlessClaimRequest): Promise<TrustlessClaimResult> {
  const axiosConfig =
    walletAuth !== undefined || walletTxProgress !== undefined
      ? ({ walletAuth, walletTxProgress } as any)
      : undefined;

  onProgress?.("build_proof");
  // Sliding through into "submit_strato" happens once the backend's
  // proof builder finishes and the unsigned envelopes show up on the
  // axios interceptor; surfaced via walletTxProgress for finer phases.
  // For the coarse top-level signal, we transition immediately after
  // the POST starts since the proof-building latency is dominated by
  // beacon-API I/O and short relative to wallet signing.
  setTimeout(() => onProgress?.("submit_strato"), 0);

  try {
    const { data: body } = await api.post<{
      success: boolean;
      data: TrustlessClaimResult;
    }>(
      "/bridge/trustlessClaim",
      {
        externalChainId: String(externalChainId),
        externalTxHash,
        assignment: assignment
          ? {
              ...assignment,
              deadline: String(assignment.deadline),
            }
          : undefined,
      },
      axiosConfig,
    );

    if (!body?.success || !body.data) {
      throw new Error("trustlessClaim returned no data");
    }
    onProgress?.("complete");
    return body.data;
  } catch (err: any) {
    onProgress?.("error");
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// EIP-712 helper — for the LP fast-finality path. Lets a depositor sign
// a ClaimAssignment that an LP can then submit on their behalf to claim
// before finality, taking a fee.
//
// Domain matches the on-chain DOMAIN_SEPARATOR in EthBridgeIn:
//   keccak256("EthBridgeIn:v1")
// (v1 elides chainId + verifyingContract — see assignment hardening
//  TODO in EthBridgeIn.sol).
// ─────────────────────────────────────────────────────────────────────

/**
 * EIP-712 typed-data shape for ClaimAssignment. Pass to
 * `signTypedDataAsync` (wagmi/viem) on the depositor's wallet.
 */
export const CLAIM_ASSIGNMENT_TYPES = {
  ClaimAssignment: [
    { name: "depositKey", type: "bytes32" },
    { name: "newRecipient", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * The v1 domain is intentionally minimal — the contract's
 * DOMAIN_SEPARATOR is `keccak256("EthBridgeIn:v1")`, so we use a
 * domain with only `name`+`version` and let viem hash it the same
 * way. When the contract upgrades to a fully EIP-712 domain
 * (chainId + verifyingContract) update this to match.
 */
export const CLAIM_ASSIGNMENT_DOMAIN = {
  name: "EthBridgeIn",
  version: "v1",
} as const;

export interface UnsignedClaimAssignment {
  depositKey: `0x${string}`;
  newRecipient: `0x${string}`;
  deadline: bigint;
}

/**
 * Convenience: split a 65-byte signature into the (v, r, s) tuple the
 * contract expects. Viem returns signatures as `0x{r||s||v}` hex.
 */
export function splitSignature(sig: `0x${string}`): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const stripped = sig.replace(/^0x/, "");
  if (stripped.length !== 130) throw new Error(`bad sig length: ${stripped.length}`);
  const r = ("0x" + stripped.slice(0, 64)) as `0x${string}`;
  const s = ("0x" + stripped.slice(64, 128)) as `0x${string}`;
  let v = parseInt(stripped.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}
