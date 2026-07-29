/**
 * @file lineaProof.service.ts
 *
 * Build the trustless-claim proof bundle for Linea-flavour deposits.
 *
 * Linea is a zk-rollup whose L1 contract (`LineaRollup` at
 * 0xd19d4B5d358258f05D7B411E21A1460D11B0876F on mainnet) emits a
 * `DataFinalizedV3(startBlock, endBlock, shnarf, parentStateRoot,
 *  finalStateRoot)` log every time a batch is finalized via SNARK
 * verification. We use that log as the L1 anchor:
 *
 *   1. Find the most-recent DataFinalizedV3 log whose `endBlock`
 *      covers (i.e. ≥) the user's L2 deposit block.
 *   2. Build the L1 receipt-MPT proof for that log, against the
 *      EthLightClient-anchored L1 block.
 *   3. Fetch the endBlock's L2 header — we'll verify on-chain that
 *      `header.stateRoot == finalStateRoot` and `header.number ==
 *      endBlock`, which binds the supplied header to the L1
 *      attestation.
 *   4. Build the L2 parent walk: endBlock → endBlock-1 → … →
 *      depositBlock, each verified by `keccak(rlp(header)) ==
 *      previousChild.parentHash`.
 *
 * Step (3)+(4) are functionally identical to the Cannon path; we
 * reuse the encoding helpers from {@link baseProof.service}. What
 * differs is the L1 event semantics — no rootClaim cross-check, no
 * dispute-game search, no withdrawal-storage-root.
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
  getLogs,
  getTransactionReceipt,
} from "./ethRpc.service";
import {
  buildAnchorInputs,
  AnchorInputs,
  ClaimInputs,
  NotFinalizedYetError,
  DepositTooOldError,
} from "./bridgeProof.service";
import {
  encodeReceiptForTrie,
  hexToBuffer,
  rlpEncodeBlockHeader,
  UnsupportedL2ChainError,
  buildBaseClaimInputs,
} from "./baseProof.service";

// ─────────────────────────────────────────────────────────────────────
// Chain config
// ─────────────────────────────────────────────────────────────────────

interface LineaChainConfig {
  /** L1 chain that anchors this Linea instance (Ethereum mainnet for
   *  Linea mainnet; Sepolia for Linea Sepolia). */
  l1ChainId: string;
  /** LineaRollup proxy address on L1. */
  lineaRollup: string;
  /** keccak256("DataFinalizedV3(uint256,uint256,bytes32,bytes32,bytes32)").
   *  Configurable per chain so a future V4 deploy doesn't require a
   *  service rebuild. */
  dataFinalizedSig: string;
}

const DATA_FINALIZED_V3_SIG =
  "0xa0262dc79e4ccb71ceac8574ae906311ae338aa4a2044fd4ec4b99fad5ab60cb";

/**
 * Lookup table for the Linea networks we currently support. Adding a
 * new zkEVM rollup with the same V3-style event shape is a one-line
 * entry here.
 */
const LINEA_CHAIN_CONFIGS: Record<string, LineaChainConfig> = {
  // Linea mainnet → L1 = Ethereum mainnet
  "59144": {
    l1ChainId: "1",
    lineaRollup: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
    dataFinalizedSig: DATA_FINALIZED_V3_SIG,
  },
  // Linea Sepolia → L1 = Sepolia
  "59141": {
    l1ChainId: "11155111",
    lineaRollup: "0xB218f8A4Bc926cF1cA7b3423c154a0D627Bdb7E5",
    dataFinalizedSig: DATA_FINALIZED_V3_SIG,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Constants — DataFinalizedV3 search
// ─────────────────────────────────────────────────────────────────────

/** Search window per chunk when scanning L1 for DataFinalizedV3 events. */
const DFV3_SEARCH_CHUNK = 5_000;
/** Total span we look back across before giving up. Linea finalizes
 *  ~hourly on mainnet, so 200_000 L1 blocks ≈ 28 days of history is
 *  plenty of headroom for any practical deposit age. */
const DFV3_SEARCH_TOTAL = 200_000;
/** Wall-clock budget for the L1 scan; bails out → NoMatchingFinalizationError.
 *  Matches the pattern from {findCoveringDisputeGame}. */
const DFV3_SEARCH_BUDGET_MS = Number(process.env.TRUSTLESS_DFV3_SEARCH_BUDGET_MS ?? 20_000);

/** Mirror of {LineaLightClient.MAX_PARENT_CHAIN_LEN}. Used here only
 *  for diagnostic messages — we don't actually filter candidates by
 *  this because, unlike OP-Stack proposals, Linea's `endBlock` is
 *  always ≥ the user's deposit. The reach concern lives in the
 *  parent-walk length, not in candidate selection. */
const MAX_PARENT_CHAIN_LEN = 3000;

// ─────────────────────────────────────────────────────────────────────
// Latest-finalized helper (used by the deposits-list UI)
// ─────────────────────────────────────────────────────────────────────

const LATEST_FINALIZED_L2_TTL_MS = 20_000;

interface LatestFinalizedCacheEntry {
  blockNumber: number;
  expiresAt: number;
}
const latestFinalizedCache: Map<string, LatestFinalizedCacheEntry> = new Map();

/**
 * Highest L2 block number currently L1-finalized for the given Linea
 * chain. Used by `getFinalizedHead` so the UI's "Waiting for L1
 * finalization" / "Ready" badges can be computed without hitting the
 * full DFV3 scan per poll.
 */
export async function getLatestFinalizedLineaL2BlockNumber(
  l2ChainId: string,
): Promise<number> {
  const cfg = LINEA_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `getLatestFinalizedLineaL2BlockNumber: L2 chainId ${l2ChainId} not configured`,
    );
  }
  const now = Date.now();
  const cached = latestFinalizedCache.get(l2ChainId);
  if (cached && cached.expiresAt > now) return cached.blockNumber;

  const tip = await getBlockNumber(cfg.l1ChainId);
  const toBlock = tip;
  const fromBlock = Math.max(0, toBlock - DFV3_SEARCH_CHUNK + 1);
  let logs: EthLog[];
  try {
    logs = await getLogs(cfg.l1ChainId, {
      address: cfg.lineaRollup,
      topics: [cfg.dataFinalizedSig],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    });
  } catch {
    return 0;
  }
  // Each log's topic[2] is the indexed endBlockNumber. Take the max.
  let max = 0;
  for (const log of logs) {
    if (log.topics.length !== 4) continue;
    const end = parseInt(log.topics[2], 16);
    if (end > max) max = end;
  }
  latestFinalizedCache.set(l2ChainId, {
    blockNumber: max,
    expiresAt: now + LATEST_FINALIZED_L2_TTL_MS,
  });
  return max;
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/**
 * Bundle the frontend submits to {LineaLightClient.anchorLineaBlockChain}.
 *
 * Walks back from the L1-finalized `endBlock` of a `DataFinalizedV3`
 * event to the user's deposit block. `parentChain` is the empty array
 * iff the user's deposit is *at* the finalized endBlock (rare — only
 * happens when the deposit was the last L2 tx in a batch).
 */
export interface LineaAnchorChainInputs {
  // LineaReceiptProof fields ----------------------------------------
  l1BlockNumber: string;
  txIndex: string;
  logIndex: string;
  receiptValueBytes: string;
  mptProof: string[];

  // L2 anchor block (endBlock of the finalization).
  lineaHeaderRLP: string;

  // Walk: headers from endBlock.parent down to depositBlock.
  // Empty when anchorBlockNumber == depositBlockNumber.
  parentChain: string[];

  // Metadata ---------------------------------------------------------
  anchorBlockNumber: string;     // == endBlock from event
  depositBlockNumber: string;
  finalStateRoot: string;        // matches the event's finalStateRoot
  startBlockNumber: string;      // for UI / diagnostics
  shnarf: string;                // for UI / diagnostics

  l1Anchor: AnchorInputs;
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

/**
 * No `DataFinalizedV3` event was found on L1 within the recent search
 * window whose `endBlock` covers the user's deposit block. The user's
 * L2 block hasn't been included in any L1 finalization yet (the SNARK
 * for it hasn't been verified on L1). UI surfaces this as
 * "Waiting for L1 finalization".
 */
export class NoMatchingFinalizationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NoMatchingFinalizationError";
  }
}

// Re-export so callers can dispatch on chain id without importing
// from three services.
export { NotFinalizedYetError, DepositTooOldError };

// ─────────────────────────────────────────────────────────────────────
// Main: build anchor inputs
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the full anchor-chain bundle for a Linea deposit tx.
 *
 * Steps:
 *   1. Look up the deposit's L2 block number from its receipt.
 *   2. Find the most-recent L1 DataFinalizedV3 whose endBlock ≥
 *      depositBlockNumber. If none exists, surface
 *      {NoMatchingFinalizationError} (425 → UI shows
 *      "Waiting for L1 finalization").
 *   3. Build the L1 anchor inputs (state-proof anchor + receipts MPT
 *      proof for the DataFinalizedV3 log).
 *   4. Fetch the endBlock's L2 header and RLP-encode it.
 *   5. Build the parent walk from endBlock-1 down to depositBlock.
 */
export async function buildLineaAnchorChainInputs(
  l2ChainId: string,
  l2TxHash: string,
): Promise<LineaAnchorChainInputs> {
  const cfg = LINEA_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `buildLineaAnchorChainInputs: L2 chainId ${l2ChainId} not configured`,
    );
  }

  // 1. Deposit's L2 block number.
  const depositReceipt = await getTransactionReceipt(l2ChainId, l2TxHash);
  if (!depositReceipt) {
    throw new Error(`buildLineaAnchorChainInputs: receipt not found for tx ${l2TxHash}`);
  }
  const depositBlockNumber = parseInt(depositReceipt.blockNumber, 16);

  // 2. Find a covering finalization.
  const match = await findCoveringFinalization(cfg, depositBlockNumber);
  if (!match) {
    throw new NoMatchingFinalizationError(
      `no DataFinalizedV3 on L1 chain ${cfg.l1ChainId} covers Linea block ` +
        `${depositBlockNumber} within the last ${DFV3_SEARCH_TOTAL} L1 blocks ` +
        `(need an event with endBlock >= ${depositBlockNumber}, ` +
        `walk distance ≤ ${MAX_PARENT_CHAIN_LEN} blocks)`,
    );
  }

  // 3. L1 anchor + receipts MPT proof for the matching DataFinalizedV3.
  const l1Anchor = await buildAnchorInputs(cfg.l1ChainId, match.l1TxHash);
  const l1BlockReceipts = await getBlockReceipts(cfg.l1ChainId, match.l1BlockNumberHex);
  const l1TxIndex = parseInt(match.l1TxIndex, 16);
  if (l1TxIndex >= l1BlockReceipts.length) {
    throw new Error(
      `buildLineaAnchorChainInputs: txIndex ${l1TxIndex} out of range ` +
        `(L1 block has ${l1BlockReceipts.length} receipts)`,
    );
  }
  const pairs: Array<[Buffer, Buffer]> = l1BlockReceipts.map((r, i) => [
    rlpEncodeUint(i),
    encodeReceiptForTrie(r),
  ]);
  const key = rlpEncodeUint(l1TxIndex);
  const { proof: mptProof } = await buildTrieAndProof(pairs, key);
  const targetReceipt = l1BlockReceipts[l1TxIndex];
  const receiptValueBytes = encodeReceiptForTrie(targetReceipt);

  // 4. Find the receipt-local logIndex (block-global is what eth_getLogs
  //    gives us; the contract walks the receipt's own logs[]).
  const sigLower = cfg.dataFinalizedSig.toLowerCase();
  const rollupLower = cfg.lineaRollup.toLowerCase();
  const expectedEnd = "0x" + match.endBlockNumber.toString(16).padStart(64, "0");
  const localLogIndex = targetReceipt.logs.findIndex(
    (l) =>
      l.address.toLowerCase() === rollupLower &&
      l.topics.length === 4 &&
      l.topics[0].toLowerCase() === sigLower &&
      l.topics[2].toLowerCase() === expectedEnd.toLowerCase(),
  );
  if (localLogIndex < 0) {
    throw new Error(
      "buildLineaAnchorChainInputs: matching DataFinalizedV3 log vanished from receipt — " +
        "L1 reorg between getLogs and getBlockReceipts; retry",
    );
  }

  // 5. Anchor L2 header (endBlock).
  const anchorBlockNumber = match.endBlockNumber;
  const anchorBlock = await getBlockByNumber(
    l2ChainId,
    "0x" + anchorBlockNumber.toString(16),
  );
  const anchorHeaderRLP = rlpEncodeBlockHeader(anchorBlock);
  // Sanity: the supplied header's stateRoot must match the event.
  // If this fails the L2 RPC and L1 event disagree → reorg or
  // service bug; surface early.
  if (
    "0x" + anchorBlock.stateRoot.replace(/^0x/, "").toLowerCase() !==
    match.finalStateRoot.toLowerCase()
  ) {
    throw new Error(
      `buildLineaAnchorChainInputs: L2 block ${anchorBlockNumber} stateRoot ` +
        `${anchorBlock.stateRoot} != event finalStateRoot ${match.finalStateRoot} ` +
        `(reorg between scan and fetch?)`,
    );
  }

  // 6. Parent walk: endBlock - 1 → depositBlock.
  const parentChain: Buffer[] = [];
  for (let n = anchorBlockNumber - 1; n >= depositBlockNumber; n--) {
    const block = await getBlockByNumber(l2ChainId, "0x" + n.toString(16));
    const rlp = rlpEncodeBlockHeader(block);
    const computedHash = "0x" + keccak256(rlp).toString("hex");
    if (computedHash.toLowerCase() !== block.hash.toLowerCase()) {
      throw new Error(
        `buildLineaAnchorChainInputs: header RLP hash ${computedHash} != block.hash ${block.hash} at L2 ${n}`,
      );
    }
    parentChain.push(rlp);
  }

  return {
    l1BlockNumber: BigInt(match.l1BlockNumberHex).toString(),
    txIndex: l1TxIndex.toString(),
    logIndex: localLogIndex.toString(),
    receiptValueBytes: "0x" + receiptValueBytes.toString("hex"),
    mptProof: mptProof.map((n) => "0x" + n.toString("hex")),
    lineaHeaderRLP: "0x" + anchorHeaderRLP.toString("hex"),
    parentChain: parentChain.map((b) => "0x" + b.toString("hex")),
    anchorBlockNumber: anchorBlockNumber.toString(),
    depositBlockNumber: depositBlockNumber.toString(),
    finalStateRoot: match.finalStateRoot,
    startBlockNumber: match.startBlockNumber.toString(),
    shnarf: match.shnarf,
    l1Anchor,
  };
}

/**
 * Build the inputs for {EthBridgeIn.claim} when the source chain is
 * a Linea-flavour rollup. Identical machinery to the Eth/Base paths
 * — the receipts trie semantics are the same on every standard EVM
 * chain. Delegate to {buildBaseClaimInputs} to avoid duplicating the
 * receipt-MPT logic.
 */
export async function buildLineaClaimInputs(
  l2ChainId: string,
  l2TxHash: string,
  depositRoutedSig: string,
): Promise<ClaimInputs> {
  return buildBaseClaimInputs(l2ChainId, l2TxHash, depositRoutedSig);
}

// ─────────────────────────────────────────────────────────────────────
// Internal — DataFinalizedV3 search
// ─────────────────────────────────────────────────────────────────────

interface FinalizationMatch {
  l1BlockNumberHex: string;
  l1TxHash: string;
  l1TxIndex: string;
  startBlockNumber: number;
  endBlockNumber: number;
  shnarf: string;
  finalStateRoot: string;
}

/**
 * Walk L1 chunks newest-first looking for a DataFinalizedV3 whose
 * endBlock ≥ depositBlockNumber. We prefer the *smallest* such
 * endBlock to minimize parent-walk length, but bail out early once
 * we walk past depositBlockNumber (older chunks can't cover).
 *
 * Returns null if no covering finalization exists within the search
 * window or budget — caller surfaces as {NoMatchingFinalizationError}.
 */
async function findCoveringFinalization(
  cfg: LineaChainConfig,
  depositBlockNumber: number,
): Promise<FinalizationMatch | null> {
  const t0 = Date.now();
  const tip = await getBlockNumber(cfg.l1ChainId);
  const chunks = Math.ceil(DFV3_SEARCH_TOTAL / DFV3_SEARCH_CHUNK);
  let bestMatch: FinalizationMatch | null = null;

  for (let i = 0; i < chunks; i++) {
    if (Date.now() - t0 > DFV3_SEARCH_BUDGET_MS) return bestMatch;
    const toBlock = tip - i * DFV3_SEARCH_CHUNK;
    const fromBlock = Math.max(0, toBlock - DFV3_SEARCH_CHUNK + 1);
    let logs: EthLog[];
    try {
      logs = await getLogs(cfg.l1ChainId, {
        address: cfg.lineaRollup,
        topics: [cfg.dataFinalizedSig],
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
      });
    } catch {
      continue;
    }

    let chunkMaxEnd = Number.NEGATIVE_INFINITY;
    for (const log of logs) {
      if (log.topics.length !== 4) continue;
      const startBlockNumber = parseInt(log.topics[1], 16);
      const endBlockNumber = parseInt(log.topics[2], 16);
      const shnarf = log.topics[3];
      if (endBlockNumber > chunkMaxEnd) chunkMaxEnd = endBlockNumber;
      // Skip finalizations that don't cover the deposit.
      if (endBlockNumber < depositBlockNumber) continue;

      const data = log.data.replace(/^0x/, "");
      if (data.length < 128) continue;
      // data = parentStateRoot (64 hex) || finalStateRoot (64 hex)
      const finalStateRoot = "0x" + data.slice(64, 128);

      const candidate: FinalizationMatch = {
        l1BlockNumberHex: log.blockNumber,
        l1TxHash: log.transactionHash,
        l1TxIndex: log.transactionIndex,
        startBlockNumber,
        endBlockNumber,
        shnarf,
        finalStateRoot,
      };
      // Prefer the smallest endBlock that still covers (shortest parent
      // walk). Walking strictly newest-first means we only update when
      // we find a tighter cover.
      if (bestMatch === null || endBlockNumber < bestMatch.endBlockNumber) {
        bestMatch = candidate;
      }
    }

    // Older L1 chunks can only have older endBlocks (Linea finalizes
    // monotonically increasing L2 ranges). Once we've passed below
    // the deposit, no older chunk can produce a covering match. If
    // we already have a candidate, return it.
    if (Number.isFinite(chunkMaxEnd) && chunkMaxEnd < depositBlockNumber) {
      return bestMatch;
    }

    if (fromBlock === 0) break;
  }
  return bestMatch;
}

// ─────────────────────────────────────────────────────────────────────
// Internal — RLP uint encoder for MPT keys.
//
// Duplicated minimally rather than imported from baseProof.service to
// keep this service compilable in isolation. The encoding (BE-minimum-
// byte unsigned int) is canonical and won't drift.
// ─────────────────────────────────────────────────────────────────────

function rlpEncodeUint(v: number): Buffer {
  if (v === 0) return Buffer.alloc(0);
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  return Buffer.from(h, "hex");
}
