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
  {
    inputs: [],
    name: "nextSeqToProcess",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type ClaimProgress =
  | { phase: "switching-chain"; chainId: number }
  | { phase: "submitting-header" }
  | { phase: "header-submitted"; txHash: `0x${string}` }
  | { phase: "header-already-known" }
  | { phase: "claiming" }
  | { phase: "claimed"; txHash: `0x${string}` }
  // Catch-up phases: emitted only when the user's seq is ahead of the
  // vault's nextSeqToProcess and we have to anchor / submit predecessor
  // proofs before their own claim can release.
  | { phase: "catching-up"; missing: number; ownSeq: number; nextSeq: number }
  | { phase: "fetching-predecessor"; seq: number; index: number; total: number }
  | { phase: "anchoring-predecessor"; seq: number; index: number; total: number; txHash: `0x${string}` }
  | { phase: "submitting-predecessor"; seq: number; index: number; total: number; txHash: `0x${string}` }
  | { phase: "catch-up-complete"; processed: number };

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
  /**
   * Async fetcher for predecessor proofs. The catch-up flow walks the
   * `prevWithdrawalBlock` chain backwards and asks the caller (typically
   * `BridgeContext`, which proxies to the backend's
   * `/bridge/withdrawalProof/byBlock/...` endpoint) for each missing seq.
   * Required only when the user's own seq might be ahead of the vault's
   * cursor; if omitted, an out-of-order claim simply queues on-chain and
   * the user has to retry once predecessors land.
   */
  fetchProofForSeq?: (chainId: number, blockNumber: number, seq: number) => Promise<WithdrawalProof | undefined>;
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
/**
 * Anchor `proof.headerRLP` on the light client if the block isn't already
 * anchored. Returns the tx hash if a submit was made, or undefined if the
 * header was already known. Pure side-effect helper used by both the main
 * claim path and the catch-up loop.
 */
async function anchorHeaderIfMissing(
  wagmiConfig: WagmiConfig,
  deployment: BridgeDeployment,
  chainIdNum: number,
  proof: WithdrawalProof,
): Promise<`0x${string}` | undefined> {
  const tip = (await readContract(wagmiConfig, {
    address: deployment.lightClient,
    abi: STRATO_LIGHT_CLIENT_ABI,
    functionName: "tip",
    chainId: chainIdNum,
  })) as bigint;
  // For tip-advancing blocks we always submit (the header anchors the
  // receipts root and advances tip in one call). For historical blocks
  // (number <= tip), we have to ask the light client whether it's already
  // got a receipts root on file -- if yes, skip; if no, submit via the
  // historical-anchor path that the v2 light client added.
  if (tip < BigInt(proof.blockNumber)) {
    const txHash = await writeContract(wagmiConfig, {
      address: deployment.lightClient,
      abi: STRATO_LIGHT_CLIENT_ABI,
      functionName: "submitHeader",
      args: [
        proof.headerRLP as `0x${string}`,
        proof.signatures as `0x${string}`[],
      ],
      chainId: chainIdNum,
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: txHash, chainId: chainIdNum });
    return txHash;
  }
  return undefined;
}

/**
 * Walk the `prevWithdrawalBlock` chain backwards to fetch and submit every
 * predecessor proof between the vault's `nextSeqToProcess` and the user's
 * own seq, anchoring each header as needed. Once this returns, the vault's
 * cursor is at `ownProof.seq`, so the user's own claim can release
 * immediately (or queue without an intervening gap, which the on-chain
 * drain will then process).
 *
 * Bounded by the vault's MAX_DRAIN_PER_CLAIM (16) per organic claim. If
 * the gap is larger than that, this helper still submits everything and
 * the user can call `processQueue` from the UI to clear the rest.
 */
async function catchUpPredecessors(
  wagmiConfig: WagmiConfig,
  deployment: BridgeDeployment,
  chainIdNum: number,
  ownProof: WithdrawalProof,
  nextSeq: bigint,
  fetchProofForSeq: NonNullable<ClaimWithdrawalParams["fetchProofForSeq"]>,
  onProgress?: (p: ClaimProgress) => void,
): Promise<number> {
  const ownSeq = BigInt(ownProof.seq ?? 0);
  if (ownSeq <= nextSeq) return 0;
  const missing = Number(ownSeq - nextSeq);
  onProgress?.({
    phase: "catching-up",
    missing,
    ownSeq: Number(ownSeq),
    nextSeq: Number(nextSeq),
  });

  // Predecessors are walked youngest-to-oldest via prevWithdrawalBlock,
  // then submitted oldest-to-youngest so the vault's nextSeqToProcess
  // can advance one slot at a time without reverting on out-of-order
  // submission. (We could rely on the queue mechanism, but submitting in
  // order keeps the on-chain state simpler and the modal display linear.)
  const predecessors: WithdrawalProof[] = [];
  let cursorBlock = ownProof.prevWithdrawalBlock ?? 0;
  for (let seqWanted = ownSeq - 1n; seqWanted >= nextSeq; seqWanted -= 1n) {
    if (cursorBlock === 0) {
      throw new Error(
        `Catch-up walk hit an unexpected zero prevWithdrawalBlock at seq ${seqWanted}; ` +
          `chain history is broken or the indexer is behind.`,
      );
    }
    const idx = Number(ownSeq - seqWanted);
    onProgress?.({
      phase: "fetching-predecessor",
      seq: Number(seqWanted),
      index: idx,
      total: missing,
    });
    const p = await fetchProofForSeq(chainIdNum, cursorBlock, Number(seqWanted));
    if (!p) {
      throw new Error(
        `Backend has no proof for chain ${chainIdNum} seq ${seqWanted} in block ${cursorBlock}.`,
      );
    }
    predecessors.push(p);
    cursorBlock = p.prevWithdrawalBlock ?? 0;
    if (seqWanted === 0n) break; // can't go below
  }

  // Submit oldest first.
  predecessors.reverse();
  for (let i = 0; i < predecessors.length; i++) {
    const p = predecessors[i];
    const idx = i + 1;
    const headerTx = await anchorHeaderIfMissing(wagmiConfig, deployment, chainIdNum, p);
    if (headerTx) {
      onProgress?.({
        phase: "anchoring-predecessor",
        seq: p.seq ?? 0,
        index: idx,
        total: missing,
        txHash: headerTx,
      });
    }
    const claimTx = await writeContract(wagmiConfig, {
      address: deployment.vault,
      abi: BRIDGE_VAULT_ABI,
      functionName: "claimWithdrawal",
      args: [
        BigInt(p.blockNumber),
        BigInt(p.txIndex),
        BigInt(p.logIndex),
        p.mptProof as `0x${string}`[],
        p.receiptRLP as `0x${string}`,
      ],
      chainId: chainIdNum,
      gas: 800_000n,
    });
    onProgress?.({
      phase: "submitting-predecessor",
      seq: p.seq ?? 0,
      index: idx,
      total: missing,
      txHash: claimTx,
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: claimTx, chainId: chainIdNum });
  }

  onProgress?.({ phase: "catch-up-complete", processed: predecessors.length });
  return predecessors.length;
}

export async function claimWithdrawalOnExternalChain({
  wagmiConfig,
  proof,
  externalChainId,
  deployment,
  method = "claimWithdrawal",
  fetchProofForSeq,
  onProgress,
}: ClaimWithdrawalParams): Promise<{ claimTxHash: `0x${string}`; headerTxHash?: `0x${string}` }> {
  const chainIdNum = typeof externalChainId === "string" ? Number(externalChainId) : externalChainId;
  onProgress?.({ phase: "switching-chain", chainId: chainIdNum });
  await switchChain(wagmiConfig, { chainId: chainIdNum });

  // Catch up any missing predecessors BEFORE anchoring the user's own
  // header / submitting their own claim. Only meaningful for the hot path
  // (Withdrawal event with a sequence number) and only when the caller
  // wired up a fetcher.
  if (
    method === "claimWithdrawal" &&
    fetchProofForSeq !== undefined &&
    proof.seq !== undefined
  ) {
    const nextSeq = (await readContract(wagmiConfig, {
      address: deployment.vault,
      abi: BRIDGE_VAULT_ABI,
      functionName: "nextSeqToProcess",
      chainId: chainIdNum,
    })) as bigint;
    if (BigInt(proof.seq) > nextSeq) {
      await catchUpPredecessors(
        wagmiConfig,
        deployment,
        chainIdNum,
        proof,
        nextSeq,
        fetchProofForSeq,
        onProgress,
      );
    }
  }

  let headerTxHash: `0x${string}` | undefined;
  const tip = (await readContract(wagmiConfig, {
    address: deployment.lightClient,
    abi: STRATO_LIGHT_CLIENT_ABI,
    functionName: "tip",
    chainId: chainIdNum,
  })) as bigint;

  // Anchor the user's own block. With the v2 light client we can submit
  // historical headers too, so we only skip when the receipts root is
  // already on-chain (either we anchored it during catch-up or someone
  // else got there first).
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
  // Pin gas explicitly. We've seen wallets reject the tx with "gas limit too
  // high" when they try to estimate against a fresh receipts root: the
  // estimator path through the proof verifier + RLP decoder occasionally
  // returns nonsensically large values. claimWithdrawal's worst case is
  // ~300k gas (MPT walk + receipt log iteration); 800k is a safe ceiling
  // that still fits under any plausible block gas limit.
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
    gas: 800_000n,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: claimTxHash, chainId: chainIdNum });
  onProgress?.({ phase: "claimed", txHash: claimTxHash });

  return { claimTxHash, headerTxHash };
}
