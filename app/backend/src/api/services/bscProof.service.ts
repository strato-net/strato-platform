/**
 * @file bscProof.service.ts
 *
 * Build the trustless-claim proof bundle for BSC-flavour deposits.
 *
 * BSC is fundamentally different from Eth / Base / Linea: there is no
 * separate L1 anchor. BSC has its own consensus light-client primitive
 * (BEP-126 VoteAttestations) — a supermajority of the active validator
 * set BLS-signs a vote over each block's (source/target) tuple, and
 * the aggregated signature lives in the *child* block's `extraData`.
 *
 * So the on-chain dance for a BSC deposit is:
 *
 *   1. (Maybe) advance the BscLightClient's epoch chain forward, by
 *      having the OLD epoch's validators sign each new epoch-boundary
 *      block. Exactly analogous to advancing Ethereum's sync-committee
 *      chain on EthLightClient before an anchor.
 *
 *   2. {BscLightClient.anchorBscBlockChain}(target, voting, parentChain)
 *      — verifies the target's IMMEDIATE child's vote attestation against
 *      target's epoch validators, then anchors target plus any
 *      ancestors supplied in parentChain.
 *
 *   3. {EthBridgeIn.claim} — the regular claim, with a receipts-MPT
 *      proof against the now-anchored target.
 *
 * This service produces the inputs for steps 1-3; the orchestrator
 * ({@link trustlessBridge.service}) packs them into a STRATO tx batch.
 *
 * Voting-header strategy: BSC blocks (post-Luban) carry a vote
 * attestation in their extraData targeting some earlier block (almost
 * always the immediate parent). We default to `votingHeader = deposit + 1`,
 * which lets us anchor the deposit directly with parentChain = []. If
 * the immediate child's attestation doesn't target the deposit (rare —
 * happens during chain quirks or finality gaps), we scan forward a few
 * slots looking for any block whose attestation targets the deposit.
 *
 * Rotation strategy: we need every epoch from `latestPinnedEpoch + 1`
 * up through the deposit's epoch. Each rotation is permissionless and
 * uses the OLD epoch's validator set signing over the NEW boundary
 * block — which always happens because (a) the boundary block exists
 * and (b) the boundary+1 block carries an attestation from the still-
 * incumbent OLD set (turnLength keeps them signing for a few blocks
 * past the boundary).
 */

import { rlpEncode } from "../helpers/rlp.helper";
import { buildTrieAndProof } from "../helpers/mptBuilder.helper";
import { keccak256 } from "../helpers/keccak.helper";
import {
  EthLog,
  EthTransactionReceipt,
  getBlockByNumber,
  getBlockNumber,
  getBlockReceipts,
  getTransactionReceipt,
} from "./ethRpc.service";
import {
  ClaimInputs,
} from "./bridgeProof.service";
import {
  encodeReceiptForTrie,
  rlpEncodeBlockHeader,
  UnsupportedL2ChainError,
  buildBaseClaimInputs,
} from "./baseProof.service";

// ─────────────────────────────────────────────────────────────────────
// Chain config
// ─────────────────────────────────────────────────────────────────────

interface BscChainConfig {
  /** Epoch length in blocks. BSC mainnet is 1000 post-Lorentz; older
   *  forks used 200. Must match the on-chain {BscLightClient.epochLength}. */
  epochLength: number;
}

const BSC_CHAIN_CONFIGS: Record<string, BscChainConfig> = {
  // BSC mainnet
  "56": { epochLength: 1000 },
  // BSC testnet (Chapel) — same epoch length post-Lorentz
  "97": { epochLength: 1000 },
};

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/** How many child slots to scan when looking for a voting header whose
 *  attestation targets the deposit. The first slot (deposit + 1) is the
 *  overwhelming-likelihood case; anything past the first 4-5 indicates
 *  a finality gap that's better surfaced as a "wait" error than walked
 *  blindly. */
const MAX_VOTING_HEADER_SCAN = 8;

/** Mirror of {BscLightClient.MAX_PARENT_CHAIN_LEN}. We don't currently
 *  use parent chains (anchor = deposit), but it's the contract's hard
 *  cap if we ever need to add one. */
const MAX_PARENT_CHAIN_LEN = 1024;

// ─────────────────────────────────────────────────────────────────────
// Latest-finalized helper (used by the deposits-list UI)
// ─────────────────────────────────────────────────────────────────────

const LATEST_FINALIZED_BSC_TTL_MS = 15_000;

interface LatestFinalizedCacheEntry {
  blockNumber: number;
  expiresAt: number;
}
const latestFinalizedCache: Map<string, LatestFinalizedCacheEntry> = new Map();

/**
 * Highest BSC block currently fast-finalized (the deposit needs an
 * attestation in its child, and finality requires the child's child to
 * carry that vote — practically, anything ≥ ~2 slots back from the tip).
 * UI uses this to gate "ready" vs "waiting for finality".
 */
export async function getLatestFinalizedBscBlockNumber(
  l2ChainId: string,
): Promise<number> {
  const cfg = BSC_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `getLatestFinalizedBscBlockNumber: chainId ${l2ChainId} not configured`,
    );
  }
  const now = Date.now();
  const cached = latestFinalizedCache.get(l2ChainId);
  if (cached && cached.expiresAt > now) return cached.blockNumber;

  // Many BSC RPCs honor `finalized` per BEP-126; the rest return tip-2
  // as a conservative approximation.
  let finalized = 0;
  try {
    const block = await getBlockByNumber(l2ChainId, "finalized");
    if (block?.number) finalized = parseInt(block.number, 16);
  } catch {
    // RPC didn't recognize the tag — fall back to tip - 3 (one slot
    // past the typical 2-slot finality lag).
    try {
      const tip = await getBlockNumber(l2ChainId);
      finalized = Math.max(0, tip - 3);
    } catch {
      finalized = 0;
    }
  }
  latestFinalizedCache.set(l2ChainId, {
    blockNumber: finalized,
    expiresAt: now + LATEST_FINALIZED_BSC_TTL_MS,
  });
  return finalized;
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/**
 * Inputs to {BscLightClient.rotateValidatorSet}.
 *
 * One per epoch needed to advance the LC from its current `latestEpoch`
 * up to (and including) the deposit's epoch. The orchestrator submits
 * these as a prefix to the anchor tx.
 */
export interface BscEpochRotationInputs {
  newEpoch: string;                // decimal
  newEpochHeaderRLP: string;       // 0x-prefixed
  votingHeaderRLP: string;         // 0x-prefixed
}

/**
 * Bundle the frontend submits to {BscLightClient.anchorBscBlockChain}.
 *
 * For v1 we anchor exactly at the deposit block (parentChain empty);
 * the voting header is the immediate child unless we had to scan
 * forward to find a usable attestation.
 */
export interface BscAnchorChainInputs {
  targetHeaderRLP: string;     // 0x-prefixed
  votingHeaderRLP: string;     // 0x-prefixed
  parentChain: string[];       // empty when anchor == deposit

  // Metadata --------------------------------------------------------
  anchorBlockNumber: string;   // == deposit (no parent walk in v1)
  depositBlockNumber: string;
  votingBlockNumber: string;
  epochNumber: string;         // = floor(deposit / epochLength)
}

/**
 * Combined bundle for one BSC deposit: the epoch rotations needed plus
 * the anchor inputs. Either piece may be empty if the LC already covers
 * the deposit's epoch / the anchor already exists (orchestrator decides).
 */
export interface BscAnchorBundle {
  rotations: BscEpochRotationInputs[];
  anchor: BscAnchorChainInputs;
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

/**
 * BSC produced the deposit block, but no descendant block within the
 * scan window carries a vote attestation targeting it. Either the
 * chain is mid-finality-gap or our scan is too short — UI surfaces as
 * "Waiting for finality" (same panel as the other flavors' analogous
 * errors).
 */
export class NoVoteAttestationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NoVoteAttestationError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main: build anchor + rotation bundle
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the complete on-chain BSC anchor bundle for a deposit tx.
 *
 * @param l2ChainId         BSC chain id (56 or 97)
 * @param l2TxHash          deposit tx hash on BSC
 * @param latestPinnedEpoch BscLightClient.latestEpoch (from cirrus)
 * @param epochLength       BscLightClient.epochLength (from cirrus,
 *                          falls back to BSC_CHAIN_CONFIGS[].epochLength)
 */
export async function buildBscAnchorBundle(
  l2ChainId: string,
  l2TxHash: string,
  latestPinnedEpoch: number,
  epochLength?: number,
): Promise<BscAnchorBundle> {
  const cfg = BSC_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `buildBscAnchorBundle: chainId ${l2ChainId} not configured`,
    );
  }
  const eL = epochLength ?? cfg.epochLength;

  // 1. Deposit's L2 block number.
  const receipt = await getTransactionReceipt(l2ChainId, l2TxHash);
  if (!receipt) {
    throw new Error(`buildBscAnchorBundle: receipt not found for tx ${l2TxHash}`);
  }
  const depositBlockNumber = parseInt(receipt.blockNumber, 16);
  const depositEpoch = Math.floor(depositBlockNumber / eL);

  // 2. Build rotations: latestPinnedEpoch + 1 → depositEpoch (inclusive).
  //    Each rotation needs (newEpochHeader, votingHeader); votingHeader
  //    is the immediate child of the boundary, signed by the OLD set
  //    (turnLength keeps them incumbent for a few blocks past the
  //    boundary, which is what makes the rotation provable).
  const rotations: BscEpochRotationInputs[] = [];
  for (let e = latestPinnedEpoch + 1; e <= depositEpoch; e++) {
    const boundaryBlockNum = e * eL;
    const boundaryBlock = await getBlockByNumber(
      l2ChainId,
      "0x" + boundaryBlockNum.toString(16),
    );
    const boundaryRLP = rlpEncodeBlockHeader(boundaryBlock);
    const computedBoundaryHash = "0x" + keccak256(boundaryRLP).toString("hex");
    if (computedBoundaryHash.toLowerCase() !== boundaryBlock.hash.toLowerCase()) {
      throw new Error(
        `buildBscAnchorBundle: epoch boundary header RLP hash ${computedBoundaryHash} != block.hash ${boundaryBlock.hash} at block ${boundaryBlockNum}`,
      );
    }
    // Voting header for the rotation: the boundary's immediate child.
    // Its vote attestation targets the boundary (parent), and is
    // signed by the OLD (e-1) set — which is what the contract
    // verifies against.
    const rotVote = await findVotingHeaderForTarget(
      l2ChainId,
      boundaryBlockNum,
      boundaryBlock.hash,
    );
    rotations.push({
      newEpoch: e.toString(),
      newEpochHeaderRLP: "0x" + boundaryRLP.toString("hex"),
      votingHeaderRLP: "0x" + rotVote.votingHeaderRLP.toString("hex"),
    });
  }

  // 3. Anchor at the deposit block. Find a voting header whose vote
  //    attestation targets it.
  const targetBlock = await getBlockByNumber(
    l2ChainId,
    "0x" + depositBlockNumber.toString(16),
  );
  const targetRLP = rlpEncodeBlockHeader(targetBlock);
  const computedTargetHash = "0x" + keccak256(targetRLP).toString("hex");
  if (computedTargetHash.toLowerCase() !== targetBlock.hash.toLowerCase()) {
    throw new Error(
      `buildBscAnchorBundle: target header RLP hash ${computedTargetHash} != block.hash ${targetBlock.hash}`,
    );
  }
  const anchorVote = await findVotingHeaderForTarget(
    l2ChainId,
    depositBlockNumber,
    targetBlock.hash,
  );

  return {
    rotations,
    anchor: {
      targetHeaderRLP: "0x" + targetRLP.toString("hex"),
      votingHeaderRLP: "0x" + anchorVote.votingHeaderRLP.toString("hex"),
      parentChain: [],
      anchorBlockNumber: depositBlockNumber.toString(),
      depositBlockNumber: depositBlockNumber.toString(),
      votingBlockNumber: anchorVote.votingBlockNumber.toString(),
      epochNumber: depositEpoch.toString(),
    },
  };
}

/**
 * Build the {EthBridgeIn.claim} inputs for a BSC-flavour deposit.
 * Receipts trie semantics are the same on every EVM chain — delegate
 * to the Base helper to avoid duplicating the MPT code.
 */
export async function buildBscClaimInputs(
  l2ChainId: string,
  l2TxHash: string,
  depositRoutedSig: string,
): Promise<ClaimInputs> {
  return buildBaseClaimInputs(l2ChainId, l2TxHash, depositRoutedSig);
}

// ─────────────────────────────────────────────────────────────────────
// Internal — extract & match vote attestation
// ─────────────────────────────────────────────────────────────────────

/**
 * Decode a BSC header's `extraData` into:
 *   - vanity (32 bytes)
 *   - optional epoch-block validators (N×68 bytes) + turnLength byte
 *   - vote attestation RLP (variable; possibly empty)
 *   - extraSeal (65 bytes)
 *
 * Returns the vote-attestation slice as raw bytes (still RLP-encoded
 * — the caller decodes the [bitmap, sig, voteData, extra] list).
 */
function extractVoteAttestationRLP(
  extraDataHex: string,
  isEpochBoundary: boolean,
): Buffer {
  const buf = Buffer.from(
    extraDataHex.startsWith("0x") ? extraDataHex.slice(2) : extraDataHex,
    "hex",
  );
  const VANITY = 32;
  const SEAL = 65;
  const VAL_ENTRY = 68;
  if (buf.length < VANITY + SEAL) {
    throw new Error(
      `extractVoteAttestationRLP: extraData too short (${buf.length} < ${VANITY + SEAL})`,
    );
  }
  let start = VANITY;
  if (isEpochBoundary) {
    if (buf.length <= start) {
      throw new Error("extractVoteAttestationRLP: epoch extraData truncated");
    }
    const n = buf[start];
    start += 1;
    const valBytes = n * VAL_ENTRY;
    if (buf.length < start + valBytes + 1 + SEAL) {
      throw new Error(
        "extractVoteAttestationRLP: epoch validator entries truncated",
      );
    }
    start += valBytes;
    // skip turnLength
    start += 1;
  }
  const endExclusive = buf.length - SEAL;
  if (endExclusive <= start) return Buffer.alloc(0);
  return buf.slice(start, endExclusive);
}

/**
 * Lightweight RLP head parser — just enough to read the first two
 * items of a vote attestation list ([bitmap, aggSig, voteData, extra])
 * and pull out voteData.targetHash. We don't need a full RLP decoder
 * here; the contract does the strict decode.
 *
 * Returns `null` if the blob isn't a well-shaped vote attestation
 * (which we treat the same as "no attestation present" for matching
 * purposes).
 */
function readVoteTarget(attRLP: Buffer): { targetNumber: number; targetHash: string } | null {
  if (attRLP.length === 0) return null;
  try {
    let off = 0;
    // Outer list header.
    const listHdr = readListHeader(attRLP, off);
    if (!listHdr) return null;
    off += listHdr.headerLen;
    // Skip bitmap.
    const bm = readItem(attRLP, off);
    if (!bm) return null;
    off += bm.headerLen + bm.payloadLen;
    // Skip aggSig.
    const sig = readItem(attRLP, off);
    if (!sig) return null;
    off += sig.headerLen + sig.payloadLen;
    // voteData = [srcNum, srcHash, tgtNum, tgtHash]
    const vdHdr = readListHeader(attRLP, off);
    if (!vdHdr) return null;
    let vdOff = off + vdHdr.headerLen;
    // skip srcNum
    const srcNum = readItem(attRLP, vdOff);
    if (!srcNum) return null;
    vdOff += srcNum.headerLen + srcNum.payloadLen;
    // skip srcHash
    const srcHash = readItem(attRLP, vdOff);
    if (!srcHash) return null;
    vdOff += srcHash.headerLen + srcHash.payloadLen;
    // read tgtNum
    const tn = readItem(attRLP, vdOff);
    if (!tn) return null;
    const tgtNumBytes = attRLP.slice(
      vdOff + tn.headerLen,
      vdOff + tn.headerLen + tn.payloadLen,
    );
    vdOff += tn.headerLen + tn.payloadLen;
    // read tgtHash (must be 32 bytes after the leading 0xa0 prefix)
    const th = readItem(attRLP, vdOff);
    if (!th || th.payloadLen !== 32) return null;
    const targetHashBuf = attRLP.slice(
      vdOff + th.headerLen,
      vdOff + th.headerLen + 32,
    );
    let targetNumber = 0;
    for (const b of tgtNumBytes) targetNumber = (targetNumber << 8) | b;
    return {
      targetNumber,
      targetHash: "0x" + targetHashBuf.toString("hex"),
    };
  } catch {
    return null;
  }
}

function readItem(
  buf: Buffer,
  off: number,
): { headerLen: number; payloadLen: number } | null {
  if (off >= buf.length) return null;
  const b0 = buf[off];
  if (b0 < 0x80) return { headerLen: 0, payloadLen: 1 };
  if (b0 < 0xb8) return { headerLen: 1, payloadLen: b0 - 0x80 };
  if (b0 < 0xc0) {
    const ll = b0 - 0xb7;
    if (off + 1 + ll > buf.length) return null;
    let pl = 0;
    for (let i = 0; i < ll; i++) pl = (pl << 8) | buf[off + 1 + i];
    return { headerLen: 1 + ll, payloadLen: pl };
  }
  if (b0 < 0xf8) return { headerLen: 1, payloadLen: b0 - 0xc0 };
  const ll = b0 - 0xf7;
  if (off + 1 + ll > buf.length) return null;
  let pl = 0;
  for (let i = 0; i < ll; i++) pl = (pl << 8) | buf[off + 1 + i];
  return { headerLen: 1 + ll, payloadLen: pl };
}

function readListHeader(
  buf: Buffer,
  off: number,
): { headerLen: number; payloadLen: number } | null {
  const h = readItem(buf, off);
  if (!h || h.headerLen === 0) return null;
  if (buf[off] < 0xc0) return null;
  return h;
}

/**
 * Scan forward from `target.number + 1` looking for the first block
 * whose vote attestation targets (target.number, target.hash). Most
 * BSC blocks vote on their immediate parent, so the search almost
 * always terminates at slot+1.
 */
async function findVotingHeaderForTarget(
  l2ChainId: string,
  targetNumber: number,
  targetHash: string,
): Promise<{ votingBlockNumber: number; votingHeaderRLP: Buffer }> {
  const cfg = BSC_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `findVotingHeaderForTarget: chainId ${l2ChainId} not configured`,
    );
  }
  for (let i = 1; i <= MAX_VOTING_HEADER_SCAN; i++) {
    const candidateNum = targetNumber + i;
    const candidate = await getBlockByNumber(
      l2ChainId,
      "0x" + candidateNum.toString(16),
    );
    if (!candidate) continue;
    const isEpoch = candidateNum % cfg.epochLength === 0;
    const attRLP = extractVoteAttestationRLP(candidate.extraData, isEpoch);
    const vote = readVoteTarget(attRLP);
    if (
      vote &&
      vote.targetNumber === targetNumber &&
      vote.targetHash.toLowerCase() === targetHash.toLowerCase()
    ) {
      const candidateRLP = rlpEncodeBlockHeader(candidate);
      const computedHash = "0x" + keccak256(candidateRLP).toString("hex");
      if (computedHash.toLowerCase() !== candidate.hash.toLowerCase()) {
        throw new Error(
          `findVotingHeaderForTarget: voting header RLP hash ${computedHash} != block.hash ${candidate.hash} at ${candidateNum}`,
        );
      }
      return { votingBlockNumber: candidateNum, votingHeaderRLP: candidateRLP };
    }
  }
  throw new NoVoteAttestationError(
    `no vote attestation targeting BSC block ${targetNumber} (${targetHash}) found within ${MAX_VOTING_HEADER_SCAN} child slots — chain may be mid-finality-gap`,
  );
}
