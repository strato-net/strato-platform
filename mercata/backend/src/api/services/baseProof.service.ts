/**
 * Base (OP-Stack) bridge-in proof builder for the Cannon (post-fault-proof)
 * path. Sister of {@link bridgeProof.service} — same input/output shape,
 * different mechanics:
 *
 *   - The L1 anchor uses the existing Ethereum {@link buildAnchorInputs}
 *     under the hood (Base's L1 is whatever the source chain's L1 is —
 *     mainnet for Base mainnet, Sepolia for Base Sepolia).
 *
 *   - The "bridge proof" emitted on L1 is a `DisputeGameCreated` log
 *     from the OP-Stack DisputeGameFactory, not an `OutputProposed`
 *     log on the legacy L2OutputOracle. The contract reads the
 *     rootClaim from topic[3] and the rest of the verification
 *     (outputRoot decomposition + Base header binding) is identical.
 *
 *   - The Base block's `withdrawalStorageRoot` (the storage root of
 *     the L2ToL1MessagePasser predeploy) is fetched off-chain via
 *     `eth_getProof`. We don't verify it directly; the on-chain
 *     outputRoot recomputation catches any mismatch.
 *
 * v1 limitation — this builder requires the source-chain proposer to
 * have already created a dispute game whose `rootClaim` matches the
 * user's deposit block's actual outputRoot. In practice that means
 * the user must wait for the next dispute game whose claimed
 * l2BlockNumber covers their deposit. A follow-up will add Base
 * parent-chain extension (anchor a later block + walk back via
 * parentHash) to remove this constraint.
 */
import {
  AnchorInputs,
  ClaimInputs,
  DepositTooOldError,
  NotFinalizedYetError,
  buildAnchorInputs,
} from "./bridgeProof.service";
import {
  EthLog,
  EthTransactionReceipt,
  getBlockByNumber,
  getBlockNumber,
  getBlockReceipts,
  getLogs,
  getProof,
  getTransactionByHash,
  getTransactionReceipt,
} from "./ethRpc.service";
import { keccak256 } from "../helpers/keccak.helper";
import { rlpEncode, rlpEncodeUint } from "../helpers/rlp.helper";
import { buildTrieAndProof } from "../helpers/mptBuilder.helper";

// ─────────────────────────────────────────────────────────────────────
// Per-source-chain configuration
// ─────────────────────────────────────────────────────────────────────

interface BaseChainCannonConfig {
  /** L1 chain that anchors this rollup's finality (Sepolia / mainnet). */
  l1ChainId: string;
  /** OP-Stack DisputeGameFactory address on the L1 chain. */
  disputeGameFactory: string;
  /** keccak256("DisputeGameCreated(address,uint32,bytes32)"). */
  disputeGameCreatedSig: string;
}

/**
 * Lookup table for the Base networks we currently support. Adding a
 * new OP-Stack rollup is a one-line entry here (assuming its L1
 * uses the standard DisputeGameFactory event shape).
 */
const BASE_CHAIN_CONFIGS: Record<string, BaseChainCannonConfig> = {
  // Base mainnet → L1 = Ethereum mainnet
  "8453": {
    l1ChainId: "1",
    disputeGameFactory: "0x43edB88C4B80fDD2AdFF2412A7BebF9dF42cB40e",
    disputeGameCreatedSig:
      "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35",
  },
  // Base Sepolia → L1 = Sepolia
  "84532": {
    l1ChainId: "11155111",
    disputeGameFactory: "0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1",
    disputeGameCreatedSig:
      "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35",
  },
};

/** Predeploy address; same on every OP-Stack chain. */
const L2_TO_L1_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";

/** Search window per chunk when scanning L1 for DGC events. */
const DGC_SEARCH_CHUNK = 5_000;
/** Total span we look back across before giving up. */
const DGC_SEARCH_TOTAL = 200_000;
/** Wall-clock budget for the DGC scan. If no covering game is found in
 *  this window, we surface {NoMatchingDisputeGameError} → UI shows the
 *  "Waiting for L1 anchor" panel instead of the request 504'ing. */
const DGC_SEARCH_BUDGET_MS = Number(process.env.TRUSTLESS_DGC_SEARCH_BUDGET_MS ?? 20_000);
/** Mirror of {BaseLightClient.MAX_PARENT_CHAIN_LEN}. Anchor blocks
 *  more than this many slots ahead of the deposit aren't usable —
 *  the contract would reject them at the first iteration past 256. */
const MAX_PARENT_CHAIN_LEN = 256;

// ─────────────────────────────────────────────────────────────────────
// Latest-anchored-L2 helper (used by the deposits-list UI)
// ─────────────────────────────────────────────────────────────────────

/** TTL for the cached latest-anchored-L2 result. UI polls /finalizedHead
 *  every few seconds; the L1 DGC scan is ~50-500ms, so caching avoids
 *  hammering the upstream while still surfacing new anchors within the
 *  TTL window. */
const LATEST_ANCHORED_L2_TTL_MS = 20_000;

interface LatestAnchoredL2CacheEntry {
  blockNumber: number;
  expiresAt: number;
}
const latestAnchoredL2Cache: Map<string, LatestAnchoredL2CacheEntry> = new Map();

/**
 * Highest L2 block number currently claimed by any L1 DisputeGameCreated
 * log in the most recent {DGC_SEARCH_CHUNK} L1 blocks. Used as the
 * "finalized head" for Base flavors in the pending-deposits UI: a
 * deposit at block D is considered claimable iff D <= this number.
 *
 * Returns 0 if no DGCs are found in the recent window (proposer is
 * very far behind or the chain has been quiet) — the UI will then
 * show every deposit as "Waiting for L1 anchor".
 */
export async function getLatestAnchoredL2BlockNumber(
  l2ChainId: string,
): Promise<number> {
  const cfg = BASE_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `getLatestAnchoredL2BlockNumber: L2 chainId ${l2ChainId} not configured`,
    );
  }
  const now = Date.now();
  const cached = latestAnchoredL2Cache.get(l2ChainId);
  if (cached && cached.expiresAt > now) return cached.blockNumber;

  const tip = await getBlockNumber(cfg.l1ChainId);
  const toBlock = tip;
  const fromBlock = Math.max(0, toBlock - DGC_SEARCH_CHUNK + 1);
  let logs: EthLog[];
  try {
    logs = await getLogs(cfg.l1ChainId, {
      address: cfg.disputeGameFactory,
      topics: [cfg.disputeGameCreatedSig],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    });
  } catch {
    return 0;
  }

  let max = 0;
  for (const log of logs) {
    if (log.topics.length !== 4) continue;
    try {
      const tx = await getTransactionByHash(cfg.l1ChainId, log.transactionHash);
      if (!tx) continue;
      const n = decodeL2BlockNumberFromCreateCalldata(tx.input);
      if (n > max) max = n;
    } catch {
      continue;
    }
  }
  latestAnchoredL2Cache.set(l2ChainId, {
    blockNumber: max,
    expiresAt: now + LATEST_ANCHORED_L2_TTL_MS,
  });
  return max;
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/**
 * Bundle the frontend submits to {BaseLightClient.anchorBaseBlockChainViaCannon}.
 * Same as {BaseAnchorInputs} below, but the L2 anchor is a *future*
 * block whose claimed outputRoot is on L1; the deposit's actual
 * Base block is reached via `parentChain[]` (anchor.parent → ... →
 * depositBlock).
 *
 * `parentChain` is the empty array iff anchor.number == depositBlock,
 * in which case the contract behaves identically to
 * {anchorBaseBlockViaCannon}.
 */
export interface BaseAnchorChainInputs {
  // OutputReceiptProof fields ---------------------------------------
  l1BlockNumber: string;
  txIndex: string;
  logIndex: string;
  receiptValueBytes: string;
  mptProof: string[];

  // Anchor block (the one bound by the DGC's rootClaim).
  anchorHeaderRLP: string;
  withdrawalStorageRoot: string;

  // Walk: headers from anchor.parent down to the deposit block.
  // chain[0]   = anchor.parent
  // chain[N-1] = depositBlock
  // Empty when anchorBlockNumber == depositBlockNumber.
  parentChain: string[];

  // Metadata --------------------------------------------------------
  anchorBlockNumber: string;
  depositBlockNumber: string;
  anchorOutputRoot: string;     // matches the DGC's rootClaim
  disputeProxy: string;
  gameType: number;

  l1Anchor: AnchorInputs;
}

/**
 * Bundle the frontend submits to {BaseLightClient.anchorBaseBlockViaCannon}.
 * Mirrors the {OutputReceiptProof, baseHeaderRLP, withdrawalStorageRoot}
 * tuple plus enough metadata for the UI to label phases / link to
 * explorers.
 */
export interface BaseAnchorInputs {
  // OutputReceiptProof fields ---------------------------------------
  l1BlockNumber: string;          // decimal string
  txIndex: string;
  logIndex: string;
  receiptValueBytes: string;      // 0x-prefixed
  mptProof: string[];             // 0x-prefixed each

  // Base-side commitments -------------------------------------------
  baseHeaderRLP: string;
  withdrawalStorageRoot: string;

  // Metadata --------------------------------------------------------
  baseBlockNumber: string;
  expectedOutputRoot: string;
  disputeProxy: string;
  gameType: number;

  // The L1 anchor caller still needs to anchor `l1BlockNumber` on
  // EthLightClient before invoking anchorBaseBlockViaCannon. We bundle
  // the inputs here so the frontend orchestrator can issue both txs
  // in the same wallet flow.
  l1Anchor: AnchorInputs;
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

/**
 * No DisputeGameCreated event was found on L1 within the recent
 * search window whose `rootClaim` matches the user's deposit block's
 * actual outputRoot. The proposer hasn't claimed this block (or hasn't
 * claimed it correctly) yet. UI surfaces this as "wait until the
 * next batch is finalized; typically every few hours on testnet,
 * less on mainnet."
 */
export class NoMatchingDisputeGameError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NoMatchingDisputeGameError";
  }
}

/**
 * The L2 chain id isn't configured for the Cannon path (no
 * BASE_CHAIN_CONFIGS entry). Either we haven't onboarded that
 * rollup yet or the caller passed a non-OP-Stack chain id.
 */
export class UnsupportedL2ChainError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UnsupportedL2ChainError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the inputs for {BaseLightClient.anchorBaseBlockViaCannon}.
 *
 *   1. Resolve the deposit's Base block and extract its header.
 *   2. Fetch the L2ToL1MessagePasser storage root for that block.
 *   3. Compute the canonical OP-Stack outputRoot preimage.
 *   4. Search L1 for a DisputeGameCreated log whose rootClaim matches.
 *   5. Build the L1 anchor (existing Ethereum LC flow) for the L1 block
 *      that emitted the matching DGC.
 *   6. Build the receipts MPT proof for that DGC's L1 receipt.
 */
export async function buildBaseAnchorInputsViaCannon(
  l2ChainId: string,
  l2TxHash: string,
): Promise<BaseAnchorInputs> {
  const cfg = BASE_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `buildBaseAnchorInputsViaCannon: L2 chainId ${l2ChainId} not configured for Cannon path`,
    );
  }

  // 1. Resolve the deposit's Base block.
  const baseReceipt = await getTransactionReceipt(l2ChainId, l2TxHash);
  if (!baseReceipt) {
    throw new Error(`buildBaseAnchorInputsViaCannon: receipt not found for tx ${l2TxHash}`);
  }
  const baseBlockNumberHex = baseReceipt.blockNumber;
  const baseBlockNumber = parseInt(baseBlockNumberHex, 16);

  // 2. Fetch the Base block header and verify our RLP encoding round-trips.
  const baseBlock = await getBlockByNumber(l2ChainId, baseBlockNumberHex);
  const baseHeaderRLP = rlpEncodeBlockHeader(baseBlock);
  const computedHash = "0x" + keccak256(baseHeaderRLP).toString("hex");
  if (computedHash.toLowerCase() !== baseBlock.hash.toLowerCase()) {
    // This is a bug in our encoder — surface loudly.
    throw new Error(
      `buildBaseAnchorInputsViaCannon: header RLP hash ${computedHash} != block.hash ${baseBlock.hash}`,
    );
  }

  // 3. Storage root of L2ToL1MessagePasser at this Base block.
  const proofResp = await getProof(
    l2ChainId,
    L2_TO_L1_MESSAGE_PASSER,
    [],
    baseBlockNumberHex,
  );
  const withdrawalStorageRoot = proofResp.storageHash;

  // 4. Canonical OP-Stack outputRoot preimage:
  //    keccak256(0x00 || stateRoot || withdrawalStorageRoot || blockHash)
  const expectedOutputRoot =
    "0x" +
    keccak256(
      Buffer.concat([
        Buffer.from([0x00]),
        hexToBuffer(baseBlock.stateRoot),
        hexToBuffer(withdrawalStorageRoot),
        hexToBuffer(baseBlock.hash),
      ]),
    ).toString("hex");

  // 5. Find a matching DGC on L1.
  const match = await findMatchingDisputeGameCreated(cfg, expectedOutputRoot);
  if (!match) {
    throw new NoMatchingDisputeGameError(
      `no DisputeGameCreated log on L1 chain ${cfg.l1ChainId} matches ` +
        `Base block ${baseBlockNumber}'s outputRoot ${expectedOutputRoot} ` +
        `within the last ${DGC_SEARCH_TOTAL} blocks`,
    );
  }

  // 6. Build L1 anchor for the L1 block where the DGC fired.
  //    The existing Ethereum buildAnchorInputs handles finality
  //    + execution-payload header proof; we hand it the L1 chain
  //    id and the L1 tx hash.
  const l1Anchor = await buildAnchorInputs(cfg.l1ChainId, match.l1TxHash);

  // 7. Build the receipts MPT proof for the matching DGC receipt.
  const l1BlockReceipts = await getBlockReceipts(cfg.l1ChainId, match.l1BlockNumberHex);
  const txIndex = parseInt(match.l1TxIndex, 16);
  if (txIndex >= l1BlockReceipts.length) {
    throw new Error(
      `buildBaseAnchorInputsViaCannon: txIndex ${txIndex} out of range ` +
        `(L1 block has ${l1BlockReceipts.length} receipts)`,
    );
  }
  const pairs: Array<[Buffer, Buffer]> = l1BlockReceipts.map((r, i) => [
    rlpEncodeUint(i),
    encodeReceiptForTrie(r),
  ]);
  const key = rlpEncodeUint(txIndex);
  const { proof: mptProof } = await buildTrieAndProof(pairs, key);
  const targetReceipt = l1BlockReceipts[txIndex];
  const receiptValueBytes = encodeReceiptForTrie(targetReceipt);

  // 8. Determine the receipt-local logIndex (DGC log's position
  //    within targetReceipt.logs). eth_getLogs's logIndex is
  //    block-global; the contract walks the receipt's own logs[].
  const sigLower = cfg.disputeGameCreatedSig.toLowerCase();
  const factoryLower = cfg.disputeGameFactory.toLowerCase();
  const expectedRcLower = expectedOutputRoot.toLowerCase();
  const localLogIndex = targetReceipt.logs.findIndex(
    (l) =>
      l.address.toLowerCase() === factoryLower &&
      l.topics.length === 4 &&
      l.topics[0].toLowerCase() === sigLower &&
      l.topics[3].toLowerCase() === expectedRcLower,
  );
  if (localLogIndex < 0) {
    throw new Error(
      "buildBaseAnchorInputsViaCannon: matching DGC log vanished from receipt — " +
        "L1 reorg between getLogs and getBlockReceipts; retry",
    );
  }

  return {
    l1BlockNumber: BigInt(match.l1BlockNumberHex).toString(),
    txIndex: txIndex.toString(),
    logIndex: localLogIndex.toString(),
    receiptValueBytes: "0x" + receiptValueBytes.toString("hex"),
    mptProof: mptProof.map((n) => "0x" + n.toString("hex")),
    baseHeaderRLP: "0x" + baseHeaderRLP.toString("hex"),
    withdrawalStorageRoot,
    baseBlockNumber: baseBlockNumber.toString(),
    expectedOutputRoot,
    disputeProxy: "0x" + match.disputeProxyTopic.slice(26),
    gameType: parseInt(match.gameTypeTopic, 16),
    l1Anchor,
  };
}

/**
 * Build the inputs for {BaseLightClient.anchorBaseBlockChainViaCannon}.
 *
 * Strategy:
 *   1. Resolve the deposit's Base block N_user.
 *   2. Find a DGC on L1 whose claimed l2BlockNumber N_anchor satisfies
 *      `N_user ≤ N_anchor ≤ N_user + MAX_PARENT_CHAIN_LEN`. We prefer
 *      the smallest such N_anchor (shortest parent walk).
 *   3. Verify the DGC's rootClaim equals the canonical outputRoot we
 *      compute for N_anchor — guards against proposers who claimed an
 *      outputRoot the actual chain didn't produce. (For unresolved
 *      games the rootClaim is just a *claim*; we accept it iff it's
 *      currently correct, which is the v1 trust model — same as the
 *      single-block path.)
 *   4. Fetch Base headers from N_anchor down to N_user, RLP-encode
 *      each, verify each round-trips to its `block.hash`.
 *   5. Build the L1 anchor + L1 receipts MPT proof for the matching
 *      DGC.
 *
 * When N_anchor == N_user the result is structurally identical to
 * what {buildBaseAnchorInputsViaCannon} would have produced, except
 * `parentChain` is empty.
 */
export async function buildBaseAnchorChainInputsViaCannon(
  l2ChainId: string,
  l2TxHash: string,
): Promise<BaseAnchorChainInputs> {
  const cfg = BASE_CHAIN_CONFIGS[l2ChainId];
  if (!cfg) {
    throw new UnsupportedL2ChainError(
      `buildBaseAnchorChainInputsViaCannon: L2 chainId ${l2ChainId} not configured for Cannon path`,
    );
  }

  // 1. Deposit block.
  const depositReceipt = await getTransactionReceipt(l2ChainId, l2TxHash);
  if (!depositReceipt) {
    throw new Error(`buildBaseAnchorChainInputsViaCannon: receipt not found for tx ${l2TxHash}`);
  }
  const depositBlockNumber = parseInt(depositReceipt.blockNumber, 16);

  // 2. Find a covering DGC + its anchor block. The matcher does a
  //    decode-each-candidate's-extraData walk to find the smallest
  //    in-range N_anchor that matches the proposer's claim against
  //    Base RPC ground truth.
  const match = await findCoveringDisputeGame(cfg, l2ChainId, depositBlockNumber);
  if (!match) {
    throw new NoMatchingDisputeGameError(
      `no DisputeGameCreated on L1 chain ${cfg.l1ChainId} covers Base block ` +
        `${depositBlockNumber} (anchor must be in [${depositBlockNumber}, ` +
        `${depositBlockNumber + MAX_PARENT_CHAIN_LEN}] and have a correct rootClaim) ` +
        `within the last ${DGC_SEARCH_TOTAL} L1 blocks`,
    );
  }
  // 3. Anchor block details (already verified during the search, but
  //    we re-fetch since the search returned only metadata). We could
  //    plumb these through the match struct — but a re-fetch keeps the
  //    matcher cheap to skip-past on misses.
  const anchorBlockNumber = match.l2BlockNumber;
  const anchorBlock = await getBlockByNumber(l2ChainId, "0x" + anchorBlockNumber.toString(16));
  const anchorHeaderRLP = rlpEncodeBlockHeader(anchorBlock);
  const proofResp = await getProof(
    l2ChainId,
    L2_TO_L1_MESSAGE_PASSER,
    [],
    anchorBlock.number,
  );
  const withdrawalStorageRoot = proofResp.storageHash;

  // 4. Build the parent walk: anchor.parent → ... → depositBlock.
  //    Sequential by necessity — each block needs hash-chain validation
  //    against the next. Rate-limited L2 endpoints make this the
  //    likeliest bottleneck when claiming far-from-anchor deposits.
  const parentChain: Buffer[] = [];
  for (let n = anchorBlockNumber - 1; n >= depositBlockNumber; n--) {
    const block = await getBlockByNumber(l2ChainId, "0x" + n.toString(16));
    const rlp = rlpEncodeBlockHeader(block);
    const computedHash = "0x" + keccak256(rlp).toString("hex");
    if (computedHash.toLowerCase() !== block.hash.toLowerCase()) {
      throw new Error(
        `buildBaseAnchorChainInputsViaCannon: header RLP hash ${computedHash} != block.hash ${block.hash} at L2 ${n}`,
      );
    }
    parentChain.push(rlp);
  }

  // 5. L1 anchor + receipts MPT proof for the matching DGC. Same
  //    machinery as buildBaseAnchorInputsViaCannon — we just have a
  //    fully-verified `match` already.
  const l1Anchor = await buildAnchorInputs(cfg.l1ChainId, match.l1TxHash);
  const l1BlockReceipts = await getBlockReceipts(cfg.l1ChainId, match.l1BlockNumberHex);
  const txIndex = parseInt(match.l1TxIndex, 16);
  if (txIndex >= l1BlockReceipts.length) {
    throw new Error(
      `buildBaseAnchorChainInputsViaCannon: txIndex ${txIndex} out of range ` +
        `(L1 block has ${l1BlockReceipts.length} receipts)`,
    );
  }
  const pairs: Array<[Buffer, Buffer]> = l1BlockReceipts.map((r, i) => [
    rlpEncodeUint(i),
    encodeReceiptForTrie(r),
  ]);
  const key = rlpEncodeUint(txIndex);
  const { proof: mptProof } = await buildTrieAndProof(pairs, key);
  const targetReceipt = l1BlockReceipts[txIndex];
  const receiptValueBytes = encodeReceiptForTrie(targetReceipt);

  // 6. Find the receipt-local logIndex (block-global is what eth_getLogs
  //    gives; the contract walks the receipt's own logs[]).
  const sigLower = cfg.disputeGameCreatedSig.toLowerCase();
  const factoryLower = cfg.disputeGameFactory.toLowerCase();
  const expectedRcLower = match.expectedOutputRoot.toLowerCase();
  const localLogIndex = targetReceipt.logs.findIndex(
    (l) =>
      l.address.toLowerCase() === factoryLower &&
      l.topics.length === 4 &&
      l.topics[0].toLowerCase() === sigLower &&
      l.topics[3].toLowerCase() === expectedRcLower,
  );
  if (localLogIndex < 0) {
    throw new Error(
      "buildBaseAnchorChainInputsViaCannon: matching DGC log vanished from receipt — " +
        "L1 reorg between getLogs and getBlockReceipts; retry",
    );
  }

  return {
    l1BlockNumber: BigInt(match.l1BlockNumberHex).toString(),
    txIndex: txIndex.toString(),
    logIndex: localLogIndex.toString(),
    receiptValueBytes: "0x" + receiptValueBytes.toString("hex"),
    mptProof: mptProof.map((n) => "0x" + n.toString("hex")),
    anchorHeaderRLP: "0x" + anchorHeaderRLP.toString("hex"),
    withdrawalStorageRoot,
    parentChain: parentChain.map((b) => "0x" + b.toString("hex")),
    anchorBlockNumber: anchorBlockNumber.toString(),
    depositBlockNumber: depositBlockNumber.toString(),
    anchorOutputRoot: match.expectedOutputRoot,
    disputeProxy: "0x" + match.disputeProxyTopic.slice(26),
    gameType: parseInt(match.gameTypeTopic, 16),
    l1Anchor,
  };
}

/**
 * Build the inputs for {EthBridgeIn.claim} when the source chain is
 * a Base-flavoured rollup. Identical shape to the Eth path — the
 * receipts trie semantics are the same on every EVM chain. Re-using
 * the export keeps the frontend trivially chain-agnostic.
 */
export async function buildBaseClaimInputs(
  l2ChainId: string,
  l2TxHash: string,
  depositRoutedSig: string,
): Promise<ClaimInputs> {
  const receipt = await getTransactionReceipt(l2ChainId, l2TxHash);
  if (!receipt) {
    throw new Error(`buildBaseClaimInputs: receipt not found for tx ${l2TxHash}`);
  }
  const blockNumberHex = receipt.blockNumber;

  const sigLower = depositRoutedSig.toLowerCase();
  const logIdx = receipt.logs.findIndex(
    (l) => l.topics.length > 0 && l.topics[0].toLowerCase() === sigLower,
  );
  if (logIdx < 0) {
    throw new Error(
      `buildBaseClaimInputs: no DepositRouted log in tx ${l2TxHash} ` +
        `(looked for topic[0] == ${depositRoutedSig})`,
    );
  }

  const blockReceipts = await getBlockReceipts(l2ChainId, blockNumberHex);
  const txIndex = parseInt(receipt.transactionIndex, 16);
  const pairs: Array<[Buffer, Buffer]> = blockReceipts.map((r, i) => [
    rlpEncodeUint(i),
    encodeReceiptForTrie(r),
  ]);
  const key = rlpEncodeUint(txIndex);
  const { proof: mptProof } = await buildTrieAndProof(pairs, key);
  const receiptValueBytes = encodeReceiptForTrie(receipt);

  return {
    blockNumber: BigInt(blockNumberHex).toString(),
    txIndex: txIndex.toString(),
    logIndex: logIdx.toString(),
    receiptValueBytes: "0x" + receiptValueBytes.toString("hex"),
    mptProof: mptProof.map((n) => "0x" + n.toString("hex")),
  };
}

// Re-export so callers can dispatch on chain id without importing
// from two services.
export { NotFinalizedYetError, DepositTooOldError };

// ─────────────────────────────────────────────────────────────────────
// Internal — DGC search
// ─────────────────────────────────────────────────────────────────────

interface DisputeGameMatch {
  l1BlockNumberHex: string;
  l1TxHash: string;
  l1TxIndex: string;
  /** Topic[1] padded address; caller can slice(26) for the address. */
  disputeProxyTopic: string;
  gameTypeTopic: string;
}

/**
 * Walk recent L1 blocks in DGC_SEARCH_CHUNK windows looking for a
 * DisputeGameCreated log whose `topics[3]` (rootClaim) equals the
 * user's expected outputRoot. Returns the first hit (or null).
 *
 * We search backwards from the L1 tip because newer DGCs are far
 * more likely to match a fresh deposit; older history would need a
 * historical-archive search that public RPCs typically rate-limit.
 */
async function findMatchingDisputeGameCreated(
  cfg: BaseChainCannonConfig,
  expectedOutputRoot: string,
): Promise<DisputeGameMatch | null> {
  const tip = await getBlockNumber(cfg.l1ChainId);
  const expectedLower = expectedOutputRoot.toLowerCase();
  const chunks = Math.ceil(DGC_SEARCH_TOTAL / DGC_SEARCH_CHUNK);

  for (let i = 0; i < chunks; i++) {
    const toBlock = tip - i * DGC_SEARCH_CHUNK;
    const fromBlock = Math.max(0, toBlock - DGC_SEARCH_CHUNK + 1);
    let logs: EthLog[];
    try {
      logs = await getLogs(cfg.l1ChainId, {
        address: cfg.disputeGameFactory,
        topics: [cfg.disputeGameCreatedSig],
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
      });
    } catch (err) {
      // Public RPCs sometimes 429 / 503 on wide ranges; keep walking.
      continue;
    }

    for (const log of logs) {
      if (log.topics.length !== 4) continue;
      if (log.topics[3].toLowerCase() !== expectedLower) continue;
      return {
        l1BlockNumberHex: log.blockNumber,
        l1TxHash: log.transactionHash,
        l1TxIndex: log.transactionIndex,
        disputeProxyTopic: log.topics[1],
        gameTypeTopic: log.topics[2],
      };
    }

    if (fromBlock === 0) break;
  }
  return null;
}

/** A DisputeGameMatch enriched with the anchor block info we verified
 *  against Base RPC. {findCoveringDisputeGame} returns this so the
 *  caller can skip a re-fetch of the anchor's outputRoot. */
interface CoveringDisputeGameMatch extends DisputeGameMatch {
  l2BlockNumber: number;
  expectedOutputRoot: string;     // == log.topics[3], also == computed outputRoot for L2 block
}

/**
 * Find a DisputeGameCreated log on L1 whose claimed l2BlockNumber
 * covers the deposit's Base block. "Covers" means
 * `depositBlock ≤ l2BlockNumber ≤ depositBlock + MAX_PARENT_CHAIN_LEN`,
 * i.e. the user's deposit is reachable from the anchor via a parent
 * walk that fits the contract's per-call cap.
 *
 * We walk recent L1 chunks newest-first, decoding each candidate's
 * extraData to read the proposer's claimed L2 block. For each in-range
 * candidate we verify the proposer's rootClaim against the actual
 * outputRoot for that L2 block (computed off-chain). The first
 * candidate that matches is our anchor.
 *
 * Why bother with the rootClaim verification: an unresolved DGC just
 * carries a *claim* — until the dispute window passes, the claim might
 * be wrong. By cross-checking against current Base state, we accept
 * only DGCs the chain has actually realized (i.e. the proposer was
 * correct). For permissioned proposers (Base today) this is the same
 * trust posture as the single-block path. Future hardening adds a
 * resolution-status storage proof.
 */
async function findCoveringDisputeGame(
  cfg: BaseChainCannonConfig,
  l2ChainId: string,
  depositBlockNumber: number,
): Promise<CoveringDisputeGameMatch | null> {
  const dgcT0 = Date.now();
  const tip = await getBlockNumber(cfg.l1ChainId);
  const chunks = Math.ceil(DGC_SEARCH_TOTAL / DGC_SEARCH_CHUNK);
  const upperBound = depositBlockNumber + MAX_PARENT_CHAIN_LEN;

  // Within each chunk, we may see multiple in-range candidates; pick
  // the smallest L2 block (shortest parent walk) before deciding.
  // Across chunks: as soon as we have any verified candidate we
  // return it — newer chunks have already been checked.
  for (let i = 0; i < chunks; i++) {
    // Wall-clock safety net so the request always returns within the
    // gateway window even if the L1 upstream is wedged.
    if (Date.now() - dgcT0 > DGC_SEARCH_BUDGET_MS) return null;
    const toBlock = tip - i * DGC_SEARCH_CHUNK;
    const fromBlock = Math.max(0, toBlock - DGC_SEARCH_CHUNK + 1);
    let logs: EthLog[];
    try {
      logs = await getLogs(cfg.l1ChainId, {
        address: cfg.disputeGameFactory,
        topics: [cfg.disputeGameCreatedSig],
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + toBlock.toString(16),
      });
    } catch {
      continue;
    }

    // Pre-decode each log's claimed L2 block; keep only in-range ones.
    // Track chunkMaxL2 so we can early-exit once we've walked past the
    // deposit (older L1 chunks can only have older L2 claims).
    interface Candidate {
      log: EthLog;
      l2BlockNumber: number;
    }
    const candidates: Candidate[] = [];
    let chunkMaxL2 = Number.NEGATIVE_INFINITY;
    for (const log of logs) {
      if (log.topics.length !== 4) continue;
      // Decode the originating tx's calldata to read claimed l2BlockNumber.
      let l2BlockNumber: number;
      try {
        const tx = await getTransactionByHash(cfg.l1ChainId, log.transactionHash);
        if (!tx) continue;
        l2BlockNumber = decodeL2BlockNumberFromCreateCalldata(tx.input);
      } catch {
        continue;
      }
      if (l2BlockNumber > chunkMaxL2) chunkMaxL2 = l2BlockNumber;
      if (l2BlockNumber < depositBlockNumber) continue;
      if (l2BlockNumber > upperBound) continue;
      candidates.push({ log, l2BlockNumber });
    }
    candidates.sort((a, b) => a.l2BlockNumber - b.l2BlockNumber);

    // Verify the smallest in-range candidate's rootClaim against the
    // actual L2 outputRoot. If it matches, we have our anchor.
    for (const c of candidates) {
      try {
        const block = await getBlockByNumber(l2ChainId, "0x" + c.l2BlockNumber.toString(16));
        const proofResp = await getProof(
          l2ChainId,
          L2_TO_L1_MESSAGE_PASSER,
          [],
          block.number,
        );
        const computed =
          "0x" +
          keccak256(
            Buffer.concat([
              Buffer.from([0x00]),
              hexToBuffer(block.stateRoot),
              hexToBuffer(proofResp.storageHash),
              hexToBuffer(block.hash),
            ]),
          ).toString("hex");
        if (computed.toLowerCase() !== c.log.topics[3].toLowerCase()) continue;
        return {
          l1BlockNumberHex: c.log.blockNumber,
          l1TxHash: c.log.transactionHash,
          l1TxIndex: c.log.transactionIndex,
          disputeProxyTopic: c.log.topics[1],
          gameTypeTopic: c.log.topics[2],
          l2BlockNumber: c.l2BlockNumber,
          expectedOutputRoot: computed,
        };
      } catch {
        continue;
      }
    }

    // Older L1 chunks can only produce older L2 claims. Once we've
    // walked back far enough that every observed claim in this chunk
    // is below the deposit's L2 block, no future chunk can cover it.
    if (Number.isFinite(chunkMaxL2) && chunkMaxL2 < depositBlockNumber) return null;

    if (fromBlock === 0) break;
  }
  return null;
}

/**
 * Decode the proposer-claimed `l2BlockNumber` from a
 * DisputeGameFactory.create-style L1 tx calldata.
 *
 * OP-Stack's canonical signature is
 * `create(GameType gameType, Claim rootClaim, bytes extraData)`,
 * but Base / Optimism deployments use minor variants (e.g. Base
 * Sepolia's `0x1011f377` carries a 4th static arg). All variants
 * have:
 *
 *   - selector(4)
 *   - arg0: gameType (uint32, padded to 32 bytes) at calldata[4..]
 *   - arg1: rootClaim (bytes32) at calldata[36..]
 *   - arg2_offset: dynamic-data start (uint256) at calldata[68..]
 *   - …possibly more static args…
 *   - dynamic data starts at calldata[4 + arg2_offset]:
 *       length(32) + payload
 *
 * The first 32 bytes of the payload is `l2BlockNumber` — it's how
 * every fault-proof game's `extraData` starts. We read the offset
 * out of the calldata at the canonical position regardless of how
 * many static args follow it.
 */
export function decodeL2BlockNumberFromCreateCalldata(input: string): number {
  const cd = (input.startsWith("0x") ? input.slice(2) : input).toLowerCase();
  if (cd.length < 8 + 64 * 4) {
    throw new Error("decodeL2BlockNumberFromCreateCalldata: calldata too short");
  }
  // arg2_offset (the dynamic-data offset) lives at args byte 64..95
  // (= calldata bytes 68..99 = hex chars 136..199).
  const offset = parseInt(cd.slice(8 + 64 * 2, 8 + 64 * 3), 16);
  // Dynamic data starts at args byte = offset (relative to args, not
  // to selector); convert to hex char position in calldata.
  const dynStart = 8 + offset * 2;
  // Skip the 32-byte length prefix.
  const valueHex = cd.slice(dynStart + 64, dynStart + 64 + 64);
  if (valueHex.length !== 64) {
    throw new Error(
      `decodeL2BlockNumberFromCreateCalldata: payload truncated at offset ${offset}`,
    );
  }
  // l2BlockNumber is uint256 but realistic values fit in JS number.
  // BigInt the parse to be safe, then convert.
  return Number(BigInt("0x" + valueHex));
}

// ─────────────────────────────────────────────────────────────────────
// Internal — RLP helpers
// ─────────────────────────────────────────────────────────────────────

function hexToBuffer(h: string): Buffer {
  return Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex");
}

/**
 * Encode a JSON-RPC `eth_getBlockByNumber` block as the canonical
 * Ethereum block header RLP. Round-tripping `keccak256(rlp(header))`
 * to `block.hash` is the integrity check; we assert it at the call
 * site to catch encoder bugs early.
 */
function rlpEncodeBlockHeader(b: import("./ethRpc.service").EthBlockHeader): Buffer {
  const intToBuf = (h: string | undefined): Uint8Array | null => {
    if (h === undefined || h === null) return null;
    if (h === "0x" || h === "0x0") return new Uint8Array(0);
    let s = h.startsWith("0x") ? h.slice(2) : h;
    if (s.length === 0) return new Uint8Array(0);
    if (s.length % 2) s = "0" + s;
    const buf = Buffer.from(s, "hex");
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    return buf.slice(i);
  };
  const bytesField = (h: string | undefined): Uint8Array | null =>
    h !== undefined && h !== null ? hexToBuffer(h) : null;

  const fields: Array<Uint8Array | null> = [
    bytesField(b.parentHash),
    bytesField(b.sha3Uncles),
    bytesField(b.miner),
    bytesField(b.stateRoot),
    bytesField(b.transactionsRoot),
    bytesField(b.receiptsRoot),
    bytesField(b.logsBloom),
    intToBuf(b.difficulty),
    intToBuf(b.number),
    intToBuf(b.gasLimit),
    intToBuf(b.gasUsed),
    intToBuf(b.timestamp),
    bytesField(b.extraData),
    bytesField(b.mixHash),
    bytesField(b.nonce),
    intToBuf(b.baseFeePerGas),
  ];
  if (b.withdrawalsRoot !== undefined) fields.push(bytesField(b.withdrawalsRoot));
  if (b.blobGasUsed !== undefined) fields.push(intToBuf(b.blobGasUsed));
  if (b.excessBlobGas !== undefined) fields.push(intToBuf(b.excessBlobGas));
  if (b.parentBeaconBlockRoot !== undefined) fields.push(bytesField(b.parentBeaconBlockRoot));
  if (b.requestsHash !== undefined) fields.push(bytesField(b.requestsHash));

  return rlpEncode(fields.filter((f) => f !== null) as Uint8Array[]);
}

/**
 * RLP-encode a receipt for the receipts trie. Standard EIP-2718 typed
 * receipts get the type byte prefixed; legacy receipts are pure RLP.
 *
 * **OP-Stack deposit receipts (type 0x7E)** carry extra fields beyond
 * the standard 4-tuple:
 *
 *     0x7E || rlp([status, cumGasUsed, logsBloom, logs,
 *                   depositNonce,                     // post-Regolith
 *                   depositReceiptVersion])           // post-Canyon
 *
 * Without these the reconstructed receiptsRoot won't match the chain's
 * commitment for any block containing a deposit tx — which is *every*
 * Base block, since the L1Block info update is a deposit at index 0.
 *
 * Kept private here rather than shared with {@link bridgeProof.service}
 * because the encodings legitimately differ per source chain (Eth has
 * no deposit type; future Linea / BSC may have their own quirks).
 */
const OP_STACK_DEPOSIT_TX_TYPE = 0x7e;

interface OpStackDepositReceiptExtras {
  depositNonce?: string;
  depositReceiptVersion?: string;
}

function encodeReceiptForTrie(
  r: EthTransactionReceipt & OpStackDepositReceiptExtras,
): Buffer {
  const status = r.status === "0x1" ? new Uint8Array([1]) : new Uint8Array(0);
  const cumGas = bigEndianBytes(BigInt(r.cumulativeGasUsed));
  const bloom = hexToBuffer(r.logsBloom);
  const logs = r.logs.map((l) => [
    hexToBuffer(l.address),
    l.topics.map((t) => hexToBuffer(t)),
    hexToBuffer(l.data),
  ]);

  const typeNum = parseInt(r.type, 16);

  if (typeNum === OP_STACK_DEPOSIT_TX_TYPE) {
    // OP-Stack deposit receipt — append depositNonce (Regolith+) and
    // optionally depositReceiptVersion (Canyon+). Both are uint64.
    const fields: Array<Uint8Array | Array<Array<Uint8Array | Array<Uint8Array>>>> = [
      status,
      cumGas,
      bloom,
      logs as any,
    ];
    if (r.depositNonce !== undefined) {
      fields.push(bigEndianBytes(BigInt(r.depositNonce)));
      if (r.depositReceiptVersion !== undefined) {
        fields.push(bigEndianBytes(BigInt(r.depositReceiptVersion)));
      }
    }
    const receiptRlp = rlpEncode(fields as any);
    return Buffer.concat([Buffer.from([OP_STACK_DEPOSIT_TX_TYPE]), receiptRlp]);
  }

  const receiptRlp = rlpEncode([status, cumGas, bloom, logs]);
  if (typeNum === 0) return receiptRlp;
  return Buffer.concat([Buffer.from([typeNum]), receiptRlp]);
}

function bigEndianBytes(v: bigint): Buffer {
  if (v === 0n) return Buffer.alloc(0);
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  return Buffer.from(h, "hex");
}
