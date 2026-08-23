/**
 * Builds the inputs that EthLightClient.anchorBlockHeader and
 * EthBridgeIn.claim need on STRATO. Composes:
 *
 *   - {@link beaconClient.service} for LightClientFinalityUpdate,
 *     beacon headers, and beacon blocks.
 *   - The execution-layer JSON-RPC (per chain, via existing
 *     {@link rpc.config}) for receipts + state proofs.
 *
 * The frontend treats this service as a black box: it asks for
 * "anchor inputs for tx X" and "claim inputs for tx X", gets back
 * JSON the user's wallet can submit verbatim. The trust property is
 * preserved because the on-chain contracts re-verify everything;
 * this service is purely a data-fetcher.
 *
 * v1 surface — this file lays out the entry points; the heavy work
 * (parent-chain composition, MPT proof building, EPH-with-precomputed-
 * roots assembly) is filled in incrementally so we can ship the UI
 * skeleton in parallel.
 */
import {
  BeaconBlockHeader,
  BeaconBlockResponse,
  ExecutionPayloadHeader,
  LightClientFinalityUpdate,
  beaconClientFor,
} from "./beaconClient.service";
import { EthLog, EthTransactionReceipt, getBlockByNumber, getBlockReceipts, getTransactionReceipt } from "./ethRpc.service";
import { buildTrieAndProof } from "../helpers/mptBuilder.helper";
import { rlpEncode, rlpEncodeUint } from "../helpers/rlp.helper";
import {
  bufferToHex,
  hashTreeRootByteList,
  hashTreeRootByteVector,
  hexToBuffer,
} from "../helpers/ssz.helper";
import { buildExecutionPayloadProof } from "../helpers/beaconBody.helper";
import {
  StateProofResult,
  buildStateRootProof,
  SLOTS_PER_HISTORICAL_ROOT,
} from "../helpers/stateProof.helper";

// ─────────────────────────────────────────────────────────────────────
// Public types — match the Solidity struct shapes EthLightClient and
// EthBridgeIn expect on STRATO.
//
// All bytes/bytes32 values are 0x-prefixed hex strings here; the
// frontend converts to viem/wagmi `0x${string}` types when building
// the wagmi.writeContract args.
// ─────────────────────────────────────────────────────────────────────

/** Mirrors the Solidity `AnchorHeaders` struct. */
export interface AnchorHeadersJSON {
  attestedSlot: string;
  attestedProposerIndex: string;
  attestedParentRoot: string;
  attestedStateRoot: string;
  attestedBodyRoot: string;
  finalizedSlot: string;
  finalizedProposerIndex: string;
  finalizedParentRoot: string;
  finalizedStateRoot: string;
  finalizedBodyRoot: string;
  finalityBranch: string[];
}

/** Mirrors the Solidity `SyncAggregateInput` struct. */
export interface SyncAggregateJSON {
  participationBits: string; // 64 bytes
  signature: string;          // 96 bytes compressed G2
  signatureSlot: string;
}

/** Mirrors the Solidity `BeaconBlockHeaderInput` struct (parent-chain element). */
export interface BeaconBlockHeaderJSON {
  slot: string;
  proposerIndex: string;
  parentRoot: string;
  stateRoot: string;
  bodyRoot: string;
}

/** Mirrors the Solidity `ExecutionPayloadHeader` struct. */
export interface EPHJSON {
  parentHash: string;
  feeRecipient: string;
  stateRoot: string;
  receiptsRoot: string;
  logsBloomRoot: string;     // pre-hashed off-chain (this service computes it)
  prevRandao: string;
  blockNumber: string;
  gasLimit: string;
  gasUsed: string;
  timestamp: string;
  extraDataRoot: string;     // pre-hashed off-chain
  baseFeePerGas: string;
  blockHash: string;
  transactionsRoot: string;
  withdrawalsRoot: string;
  blobGasUsed: string;
  excessBlobGas: string;
}

/** Bundle the frontend submits to EthLightClient.anchorBlockHeader. */
export interface AnchorInputs {
  blockNumber: string;          // execution-layer block number being anchored
  headers: AnchorHeadersJSON;
  sync: SyncAggregateJSON;
  parentChain: BeaconBlockHeaderJSON[];
  eph: EPHJSON;
  executionBranch: string[];    // proves EPH root from target.bodyRoot (depth 4)
}

/** Bundle the frontend submits to EthBridgeIn.claim. */
export interface ClaimInputs {
  blockNumber: string;
  txIndex: string;
  logIndex: string;
  receiptValueBytes: string;     // RLP receipt (legacy) or txType||rlp(receipt) (typed)
  mptProof: string[];            // RLP-encoded trie nodes, root → leaf
}

// ─────────────────────────────────────────────────────────────────────
// State-proof anchor inputs (replaces parent-chain walk for cost)
// ─────────────────────────────────────────────────────────────────────

/** Inputs for `EthLightClient.anchorBlockHeaderViaBlockRoots`. */
export interface BlockRootsAnchorInputs {
  kind: "block_roots";
  blockNumber: string;
  headers: AnchorHeadersJSON;
  sync: SyncAggregateJSON;
  /** Full beacon header at the deposit's slot — contract recomputes its
   *  hash_tree_root and matches it against the state-proof leaf. */
  target: BeaconBlockHeaderJSON;
  /** SSZ branch from `state.block_roots[D mod 8192]` to attested.state_root. */
  blockRootsBranch: string[];
  eph: EPHJSON;
  executionBranch: string[];
}

/** Inputs for `EthLightClient.anchorBlockHeaderViaHistoricalSummaries`. */
export interface HistoricalSummariesAnchorInputs {
  kind: "historical_summaries";
  blockNumber: string;
  headers: AnchorHeadersJSON;
  sync: SyncAggregateJSON;
  target: BeaconBlockHeaderJSON;
  /** Index into `state.historical_summaries` the leaf lives under. */
  summaryIndex: string;
  /** Concatenated branch (inner block_summary_root vector + outer
   *  historical_summaries → state_root). */
  historicalBranch: string[];
  eph: EPHJSON;
  executionBranch: string[];
}

export type StateProofAnchorInputs =
  | BlockRootsAnchorInputs
  | HistoricalSummariesAnchorInputs;

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the inputs for `EthLightClient.anchorBlockHeader` for the
 * deposit landed at `srcTxHash` on `srcChainId`. Resolves the deposit
 * to its block, walks the parent chain from the current finalized
 * head down to it (if needed), and assembles the EPH + execution
 * branch.
 *
 * @throws {NotFinalizedYetError} if the deposit's EL block hasn't
 *         yet caught up to the live finalized header — UI surfaces
 *         this as "wait ~13 minutes for finality, then retry".
 * @throws {DepositTooOldError} if the deposit is more than
 *         {@link MAX_PARENT_CHAIN_HEADERS} blocks behind the live
 *         finalized header — beyond what the per-request walk will
 *         cover. Recovery: rerun once the deposit is closer to the
 *         finalized head, or raise the cap if the user-facing wait
 *         is acceptable.
 * @throws if the source RPC / beacon API can't resolve the request.
 */
export async function buildAnchorInputs(
  srcChainId: string,
  srcTxHash: string,
): Promise<AnchorInputs> {
  const beacon = beaconClientFor(srcChainId);

  // 1. Resolve the deposit's EL block via execution-layer RPC.
  const receipt = await getTransactionReceipt(srcChainId, srcTxHash);
  if (!receipt) {
    throw new Error(`buildAnchorInputs: receipt not found for tx ${srcTxHash} on chain ${srcChainId}`);
  }
  const depositBlockNumber = BigInt(receipt.blockNumber);

  // 2. Fetch the live LightClientFinalityUpdate.
  const update = await beacon.getFinalityUpdate();
  const finalizedExec = update.finalized_header.execution;
  const executionBranch = update.finalized_header.execution_branch;
  if (!finalizedExec || !executionBranch) {
    throw new Error(
      "buildAnchorInputs: LightClientFinalityUpdate.finalized_header missing execution payload " +
        "(beacon node hasn't upgraded to Capella+ format)"
    );
  }
  const finalizedBlockNumber = BigInt(finalizedExec.block_number);

  // 3. v1: only handle the case where the deposit's block IS the
  //    current finalized block. parentChain stays empty.
  if (depositBlockNumber > finalizedBlockNumber) {
    let depositBlockTimestamp: number | undefined;
    let etaSeconds: number | undefined;
    try {
      const block = await getBlockByNumber(srcChainId, receipt.blockNumber);
      if (block?.timestamp) {
        depositBlockTimestamp = parseInt(block.timestamp, 16);
        const nowSec = Math.floor(Date.now() / 1000);
        etaSeconds = Math.max(
          0,
          depositBlockTimestamp + ETHEREUM_FINALITY_LAG_SECONDS - nowSec,
        );
      }
    } catch { /* ETA is best-effort; fall through with undefined */ }
    throw new NotFinalizedYetError(
      `deposit at block ${depositBlockNumber} not yet finalized (live finalized ${finalizedBlockNumber})`,
      {
        depositBlockNumber,
        finalizedBlockNumber,
        depositBlockTimestamp,
        etaSeconds,
      },
    );
  }
  // 4. If the deposit is older than finalized, walk the parent chain.
  //    Each post-merge beacon header maps 1:1 to an EL block, so the
  //    number of hops is exactly (finalized - deposit). The contract's
  //    `parentChain` is the sequence of beacon headers from
  //    `finalizedHeader.parent_root` back to (and including) the
  //    target. The last entry is the target itself.
  const numHops = Number(finalizedBlockNumber - depositBlockNumber);
  const parentChain: BeaconBlockHeaderJSON[] = [];
  let targetBeaconRoot: string | undefined;
  let targetEph: EPHJSON | undefined;
  let targetExecutionBranch: string[] | undefined;
  let targetBlockNumber: string = finalizedExec.block_number;

  if (numHops < 0) {
    throw new Error(
      `buildAnchorInputs: invariant violation — depositBlockNumber > finalizedBlockNumber after early-return`,
    );
  }

  if (numHops > MAX_PARENT_CHAIN_HEADERS) {
    throw new DepositTooOldError(
      `deposit at block ${depositBlockNumber} is ${numHops} blocks behind live finalized ${finalizedBlockNumber}; ` +
        `parent-chain walk capped at ${MAX_PARENT_CHAIN_HEADERS}`,
    );
  }

  if (numHops > 0) {
    let nextRoot = update.finalized_header.beacon.parent_root;
    for (let i = 0; i < numHops; i++) {
      const resp = await beacon.getHeader(nextRoot);
      const m = resp.header.message;
      parentChain.push({
        slot:          m.slot,
        proposerIndex: m.proposer_index,
        parentRoot:    m.parent_root,
        stateRoot:     m.state_root,
        bodyRoot:      m.body_root,
      });
      if (i === numHops - 1) {
        targetBeaconRoot = resp.root;
      }
      nextRoot = m.parent_root;
    }

    if (!targetBeaconRoot) {
      throw new Error("buildAnchorInputs: parent chain walk produced no target root");
    }

    const targetBlock = await beacon.getBlock(targetBeaconRoot);
    const proof = await buildExecutionPayloadProof(targetBlock);
    targetEph = proof.ephJson;
    targetExecutionBranch = proof.executionBranch;
    targetBlockNumber = proof.ephJson.blockNumber;

    // Sanity check: the EPH we assembled must correspond to the
    // deposit's EL block. If lodestar derived a different block_number
    // we have a walk bug and should fail loudly rather than emit a
    // proof the contract will reject.
    if (BigInt(targetEph.blockNumber) !== depositBlockNumber) {
      throw new Error(
        `buildAnchorInputs: target block_number ${targetEph.blockNumber} != deposit ${depositBlockNumber}`,
      );
    }
  }

  // 5. Pre-compute logsBloomRoot and extraDataRoot for the
  //    finalized-as-target case (parent-chain walk produces these
  //    inside buildExecutionPayloadProof).
  const logsBloomRoot = bufferToHex(
    hashTreeRootByteVector(hexToBuffer(finalizedExec.logs_bloom), 256),
  );
  const extraDataRoot = bufferToHex(
    hashTreeRootByteList(hexToBuffer(finalizedExec.extra_data), 32),
  );

  // 6. Assemble the JSON the frontend hands to wagmi.writeContract.
  const headers: AnchorHeadersJSON = {
    attestedSlot:           update.attested_header.beacon.slot,
    attestedProposerIndex:  update.attested_header.beacon.proposer_index,
    attestedParentRoot:     update.attested_header.beacon.parent_root,
    attestedStateRoot:      update.attested_header.beacon.state_root,
    attestedBodyRoot:       update.attested_header.beacon.body_root,
    finalizedSlot:          update.finalized_header.beacon.slot,
    finalizedProposerIndex: update.finalized_header.beacon.proposer_index,
    finalizedParentRoot:    update.finalized_header.beacon.parent_root,
    finalizedStateRoot:     update.finalized_header.beacon.state_root,
    finalizedBodyRoot:      update.finalized_header.beacon.body_root,
    finalityBranch:         update.finality_branch,
  };

  const sync: SyncAggregateJSON = {
    participationBits: update.sync_aggregate.sync_committee_bits,
    signature:         update.sync_aggregate.sync_committee_signature,
    signatureSlot:     update.signature_slot,
  };

  const eph: EPHJSON = targetEph ?? {
    parentHash:        finalizedExec.parent_hash,
    feeRecipient:      finalizedExec.fee_recipient,
    stateRoot:         finalizedExec.state_root,
    receiptsRoot:      finalizedExec.receipts_root,
    logsBloomRoot,
    prevRandao:        finalizedExec.prev_randao,
    blockNumber:       finalizedExec.block_number,
    gasLimit:          finalizedExec.gas_limit,
    gasUsed:           finalizedExec.gas_used,
    timestamp:         finalizedExec.timestamp,
    extraDataRoot,
    baseFeePerGas:     finalizedExec.base_fee_per_gas,
    blockHash:         finalizedExec.block_hash,
    transactionsRoot:  finalizedExec.transactions_root,
    withdrawalsRoot:   finalizedExec.withdrawals_root,
    blobGasUsed:       finalizedExec.blob_gas_used ?? "0",
    excessBlobGas:     finalizedExec.excess_blob_gas ?? "0",
  };

  return {
    blockNumber:    targetBlockNumber,
    headers,
    sync,
    parentChain,
    eph,
    executionBranch: targetExecutionBranch ?? executionBranch,
  };
}

/**
 * Build the inputs for one of the state-proof anchor entrypoints —
 * either {EthLightClient.anchorBlockHeaderViaBlockRoots} (cheap, last
 * 8192 slots) or {anchorBlockHeaderViaHistoricalSummaries} (constant
 * cost beyond that). Picks the cheaper variant automatically based on
 * how far behind the deposit is.
 *
 * The on-chain cost is bounded — a depth-19 (block_roots) or depth-45
 * (historical_summaries) Merkle proof, vs O(N) hashTreeRootBeaconHeader
 * calls in the parent-walk path. For deposits more than ~50 slots
 * behind finalized this is a large gas win.
 *
 * Off-chain trade-off: one or two BeaconState fetches (each ~50 MB
 * SSZ on Sepolia) instead of N sequential `getHeader` calls. Single
 * round-trip latency ≪ N × per-getHeader latency.
 */
export async function buildAnchorInputsViaStateProof(
  srcChainId: string,
  srcTxHash: string,
): Promise<StateProofAnchorInputs> {
  const beacon = beaconClientFor(srcChainId);

  // 1. Resolve the deposit's EL block.
  const receipt = await getTransactionReceipt(srcChainId, srcTxHash);
  if (!receipt) {
    throw new Error(`buildAnchorInputsViaStateProof: receipt not found for tx ${srcTxHash}`);
  }
  const depositBlockNumber = BigInt(receipt.blockNumber);

  // 2. Fetch the live LightClientFinalityUpdate.
  const update = await beacon.getFinalityUpdate();
  const finalizedExec = update.finalized_header.execution;
  if (!finalizedExec) {
    throw new Error(
      "buildAnchorInputsViaStateProof: LightClientFinalityUpdate missing execution payload",
    );
  }
  const finalizedBlockNumber = BigInt(finalizedExec.block_number);

  // 3. Reject not-yet-finalized deposits with structured ETA — same
  //    contract as the legacy buildAnchorInputs.
  if (depositBlockNumber > finalizedBlockNumber) {
    let depositBlockTimestamp: number | undefined;
    let etaSeconds: number | undefined;
    try {
      const block = await getBlockByNumber(srcChainId, receipt.blockNumber);
      if (block?.timestamp) {
        depositBlockTimestamp = parseInt(block.timestamp, 16);
        const nowSec = Math.floor(Date.now() / 1000);
        etaSeconds = Math.max(
          0,
          depositBlockTimestamp + ETHEREUM_FINALITY_LAG_SECONDS - nowSec,
        );
      }
    } catch { /* best-effort */ }
    throw new NotFinalizedYetError(
      `deposit at block ${depositBlockNumber} not yet finalized (live finalized ${finalizedBlockNumber})`,
      { depositBlockNumber, finalizedBlockNumber, depositBlockTimestamp, etaSeconds },
    );
  }

  // 4. Locate the deposit's beacon block. The slot↔EL-block mapping
  //    isn't 1:1: missed slots (no proposer) bump the slot count
  //    without producing an EL block, so the gap (slot − blockNumber)
  //    grows monotonically with cumulative misses. Our initial guess
  //    assumes the deposit's slot has the same total miss count as
  //    finalized — usually wrong by however many misses landed in
  //    between, so we then walk back by `delta` until the slot we
  //    fetched produces exactly `depositBlockNumber`.
  const finalizedSlot = BigInt(update.finalized_header.beacon.slot);
  let depositSlot = finalizedSlot - (finalizedBlockNumber - depositBlockNumber);
  if (depositSlot <= 0n) {
    throw new Error(
      `buildAnchorInputsViaStateProof: depositSlot ${depositSlot} <= 0 — chain too young?`,
    );
  }

  // 5. Fetch + correct. Each iteration: skip back over any missed
  //    slots (404 from the beacon API), then nudge by the EL-block
  //    delta. Bounded so a degenerate beacon never loops forever.
  const MAX_SLOT_RESOLVE_ATTEMPTS = 64;
  let targetBlock!: BeaconBlockResponse;
  let epProof!: Awaited<ReturnType<typeof buildExecutionPayloadProof>>;
  for (let attempt = 0; attempt < MAX_SLOT_RESOLVE_ATTEMPTS; attempt++) {
    // Skip missed slots. Beacon API returns 404 for slots with no
    // block; walk back one slot at a time until we find a populated
    // one. Bound on the inner walk too — pathological but cheap.
    let walkBudget = MAX_SLOT_RESOLVE_ATTEMPTS;
    while (walkBudget-- > 0) {
      try {
        targetBlock = await beacon.getBlock(String(depositSlot));
        break;
      } catch (err: any) {
        if (err?.response?.status === 404) {
          depositSlot -= 1n;
          if (depositSlot <= 0n) {
            throw new Error(
              `buildAnchorInputsViaStateProof: walked past slot 0 looking for deposit block ${depositBlockNumber}`,
            );
          }
          continue;
        }
        throw err;
      }
    }
    if (walkBudget < 0) {
      throw new Error(
        `buildAnchorInputsViaStateProof: too many consecutive missed slots near ${depositSlot}`,
      );
    }
    epProof = await buildExecutionPayloadProof(targetBlock);
    const ephBlock = BigInt(epProof.ephJson.blockNumber);
    if (ephBlock === depositBlockNumber) break;
    if (ephBlock < depositBlockNumber) {
      // Initial guess was too low — only happens if finalized is also
      // a missed slot or our finalized→block math is off. Bail with a
      // descriptive error rather than walking forward into ambiguity.
      throw new Error(
        `buildAnchorInputsViaStateProof: EPH block ${ephBlock} < deposit ${depositBlockNumber} at slot ${depositSlot}; cannot recover`,
      );
    }
    depositSlot -= ephBlock - depositBlockNumber;
    if (depositSlot <= 0n) {
      throw new Error(
        `buildAnchorInputsViaStateProof: corrected depositSlot ${depositSlot} <= 0`,
      );
    }
    if (attempt === MAX_SLOT_RESOLVE_ATTEMPTS - 1) {
      throw new Error(
        `buildAnchorInputsViaStateProof: failed to converge on deposit block ${depositBlockNumber} after ${MAX_SLOT_RESOLVE_ATTEMPTS} attempts`,
      );
    }
  }

  // The block response carries `data.message.{slot,proposer_index,parent_root,state_root,body_root}`
  // (well, body via merkleization — body_root is computed below).
  const targetMsg = (targetBlock.data as any)?.message;
  if (!targetMsg) {
    throw new Error(`buildAnchorInputsViaStateProof: beacon block at slot ${depositSlot} has no .message`);
  }
  const target: BeaconBlockHeaderJSON = {
    slot:          targetMsg.slot,
    proposerIndex: targetMsg.proposer_index,
    parentRoot:    targetMsg.parent_root,
    stateRoot:     targetMsg.state_root,
    bodyRoot:      epProof.bodyRoot,
  };
  const expectedLeaf = epProof.beaconBlockRoot;

  // 7. Build the SSZ state-root proof. Picks block_roots vs historical_summaries.
  const attestedSlotN  = Number(BigInt(update.attested_header.beacon.slot));
  const proof: StateProofResult = await buildStateRootProof(
    srcChainId,
    beacon,
    attestedSlotN,
    targetBlock.version,    // attested header is in the same fork as the target
    Number(depositSlot),
    expectedLeaf,
    update.attested_header.beacon.state_root,
  );

  // Fork-shape sanity log. The contract recomputes the leaf gindex as
  // `(blockRootsContainerGindex << 13) | (slot % 8192)` with
  // blockRootsContainerGindex defaulting to 69 (Electra/Fulu shape:
  // ≤64 BeaconState fields → depth 6, block_roots at field index 5).
  // If a future fork bumps the field count past 64 the depth becomes 7
  // and the gindex jumps to 133 — proof on-chain then fails with the
  // misleading "block_roots proof failed". Emit lodestar's gindex so an
  // operator can call setStateProofIndices(...) to match.
  if (proof.kind === "block_roots") {
    const slotIdx = Number(depositSlot) % 8192;
    const expectedGindexFor69 = (69n << 13n) | BigInt(slotIdx);
    if (proof.gindex !== expectedGindexFor69) {
      console.warn(
        `[Trustless] block_roots gindex mismatch: lodestar=${proof.gindex.toString()}, ` +
        `contract-expected=${expectedGindexFor69.toString()} (slot=${depositSlot}, ` +
        `fork=${targetBlock.version}). Update setStateProofIndices on EthLightClient ` +
        `with blockRootsContainerGindex=${(proof.gindex >> 13n).toString()}.`,
      );
    }

  } else {
    const expectedOuterFor91 = 91n << (5n + 8n + 25n + 1n); // 91 << 39 (depth: 6 outer + 25 list + 8 list-mix + 1 inner-container)
    if (proof.outerGindex !== expectedOuterFor91) {
      console.warn(
        `[Trustless] historical_summaries outer gindex mismatch: lodestar=${proof.outerGindex.toString()}, ` +
        `contract-expected=${expectedOuterFor91.toString()} (fork=${targetBlock.version}). ` +
        `Update setStateProofIndices on EthLightClient.`,
      );
    }
  }

  // 8. Common envelope.
  const headers: AnchorHeadersJSON = {
    attestedSlot:           update.attested_header.beacon.slot,
    attestedProposerIndex:  update.attested_header.beacon.proposer_index,
    attestedParentRoot:     update.attested_header.beacon.parent_root,
    attestedStateRoot:      update.attested_header.beacon.state_root,
    attestedBodyRoot:       update.attested_header.beacon.body_root,
    finalizedSlot:          update.finalized_header.beacon.slot,
    finalizedProposerIndex: update.finalized_header.beacon.proposer_index,
    finalizedParentRoot:    update.finalized_header.beacon.parent_root,
    finalizedStateRoot:     update.finalized_header.beacon.state_root,
    finalizedBodyRoot:      update.finalized_header.beacon.body_root,
    finalityBranch:         update.finality_branch,
  };
  const sync: SyncAggregateJSON = {
    participationBits: update.sync_aggregate.sync_committee_bits,
    signature:         update.sync_aggregate.sync_committee_signature,
    signatureSlot:     update.signature_slot,
  };

  if (proof.kind === "block_roots") {
    return {
      kind: "block_roots",
      blockNumber:      epProof.ephJson.blockNumber,
      headers,
      sync,
      target,
      blockRootsBranch: proof.branch,
      eph:              epProof.ephJson,
      executionBranch:  epProof.executionBranch,
    };
  }
  return {
    kind: "historical_summaries",
    blockNumber:       epProof.ephJson.blockNumber,
    headers,
    sync,
    target,
    summaryIndex:      String(proof.summaryIndex),
    historicalBranch:  proof.branch,
    eph:               epProof.ephJson,
    executionBranch:   epProof.executionBranch,
  };
}

/** Conservative upper bound on Ethereum's finality lag from block
 *  inclusion to beacon-chain finality (2 epochs * 32 slots * 12s = 768s,
 *  plus a small buffer for the slot the deposit landed in). The UI uses
 *  this as the basis for an ETA countdown. */
export const ETHEREUM_FINALITY_LAG_SECONDS = 13 * 60;

/** Largest parent-chain walk we'll attempt off the current finalized
 *  head. 1024 ≈ ~3.4h of EL blocks (12s slot time) — well past the
 *  ~13-minute "just-finalized" floor so users can claim deposits they
 *  forgot about for hours. Each hop costs one beacon `getHeader` round-
 *  trip; the cap mainly bounds the worst-case RPC fan-out. Tunable via
 *  the {@link MAX_PARENT_CHAIN_HEADERS_ENV} env var. */
const MAX_PARENT_CHAIN_HEADERS_ENV = "MAX_PARENT_CHAIN_HEADERS";
export const MAX_PARENT_CHAIN_HEADERS: number = (() => {
  const raw = process.env[MAX_PARENT_CHAIN_HEADERS_ENV];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024;
})();

/** Caller should retry after ~13 minutes (one beacon-chain finality lag).
 *  Carries structured detail so the UI can render a friendly ETA. */
export class NotFinalizedYetError extends Error {
  depositBlockNumber: string;
  finalizedBlockNumber: string;
  depositBlockTimestamp?: number;
  etaSeconds?: number;
  finalityLagSeconds: number;
  constructor(
    msg: string,
    details: {
      depositBlockNumber: bigint | string;
      finalizedBlockNumber: bigint | string;
      depositBlockTimestamp?: number;
      etaSeconds?: number;
      finalityLagSeconds?: number;
    },
  ) {
    super(msg);
    this.name = "NotFinalizedYetError";
    this.depositBlockNumber = String(details.depositBlockNumber);
    this.finalizedBlockNumber = String(details.finalizedBlockNumber);
    this.depositBlockTimestamp = details.depositBlockTimestamp;
    this.etaSeconds = details.etaSeconds;
    this.finalityLagSeconds = details.finalityLagSeconds ?? ETHEREUM_FINALITY_LAG_SECONDS;
  }
}

/** Deposit is older than the live finalized header — needs parent-chain
 *  walk, which is a later milestone. */
export class DepositTooOldError extends Error {
  constructor(msg: string) { super(msg); this.name = "DepositTooOldError"; }
}

/**
 * Build the inputs for `EthBridgeIn.claim` for the deposit at
 * `srcTxHash`. Returns the receipt's MPT inclusion proof against the
 * receipts_root that EthLightClient.anchorBlockHeader will have
 * anchored.
 *
 * Caller is responsible for ensuring the corresponding block is
 * already anchored on STRATO before submitting the claim tx (or
 * sequencing both txs back-to-back in the wallet).
 *
 * @param depositRoutedSig — the keccak256 hash of the
 *        `DepositRouted(...)` event signature; used to identify
 *        which log in the receipt is the bridge deposit. Caller
 *        passes the value configured on EthBridgeIn.
 *
 * @throws if no log matching `depositRoutedSig` is found in the
 *         receipt — surfaces to the UI as "this tx isn't a bridge
 *         deposit".
 * @throws if the computed receipts_root doesn't match the live
 *         block's receipts_root — indicates a chain-state divergence
 *         or RPC-vs-beacon mismatch; caller should retry.
 */
export async function buildClaimInputs(
  srcChainId: string,
  srcTxHash: string,
  depositRoutedSig: string,
): Promise<ClaimInputs> {
  // 1. Fetch the deposit's receipt to find its block + log index.
  const receipt = await getTransactionReceipt(srcChainId, srcTxHash);
  if (!receipt) {
    throw new Error(`buildClaimInputs: receipt not found for tx ${srcTxHash}`);
  }
  const blockNumberHex = receipt.blockNumber;

  // 2. Identify the DepositRouted log within the receipt.
  const sigLower = depositRoutedSig.toLowerCase();
  const logIdx = receipt.logs.findIndex(
    (l: EthLog) => l.topics.length > 0 && l.topics[0].toLowerCase() === sigLower,
  );
  if (logIdx < 0) {
    throw new Error(
      `buildClaimInputs: no DepositRouted log in tx ${srcTxHash} (looked for topic[0] == ${depositRoutedSig})`,
    );
  }

  // 3. Fetch ALL receipts in the deposit's block to rebuild the trie.
  //    The receipts trie's root is in the execution payload header,
  //    so reconstructing requires the entire block's receipts in
  //    canonical order (which eth_getBlockReceipts delivers).
  const blockReceipts = await getBlockReceipts(srcChainId, blockNumberHex);
  const txIndex = parseInt(receipt.transactionIndex, 16);
  if (blockReceipts.length === 0 || txIndex >= blockReceipts.length) {
    throw new Error(`buildClaimInputs: txIndex ${txIndex} out of range (${blockReceipts.length} receipts)`);
  }

  // 4. Build the receipts trie. Each value is rlp(receipt) for legacy
  //    txs or txType||rlp(receipt) for EIP-2718 typed txs.
  const pairs: Array<[Buffer, Buffer]> = blockReceipts.map((r, i) => [
    rlpEncodeUint(i),
    encodeReceiptForTrie(r),
  ]);
  const key = rlpEncodeUint(txIndex);
  const { proof: mptProof } = await buildTrieAndProof(pairs, key);

  // 5. Extract the receiptValueBytes for the user's tx.
  const receiptValueBytes = encodeReceiptForTrie(receipt);

  return {
    blockNumber:       BigInt(blockNumberHex).toString(),
    txIndex:           txIndex.toString(),
    logIndex:          logIdx.toString(),
    receiptValueBytes: "0x" + receiptValueBytes.toString("hex"),
    mptProof:          mptProof.map((n) => "0x" + n.toString("hex")),
  };
}

/**
 * RLP-encode a receipt for inclusion in the receipts trie. Per
 * EIP-2718, typed transactions (type ≥ 1) get their type byte
 * prefixed BEFORE the RLP; legacy (type 0) is just the RLP itself.
 *
 * Mirrors the reference encoding used by every Ethereum client; we
 * verified this is byte-exact against live Sepolia receipts roots in
 * the helper's offline acid test.
 */
function encodeReceiptForTrie(r: EthTransactionReceipt): Buffer {
  // Status: 0x01 → byte 0x01; 0x0 → empty string. Pre-Byzantium
  // post-state roots aren't relevant for any chain we bridge from.
  const status = r.status === "0x1" ? new Uint8Array([1]) : new Uint8Array(0);
  const cumGas = bigEndianBytes(BigInt(r.cumulativeGasUsed));
  const bloom = Buffer.from(r.logsBloom.startsWith("0x") ? r.logsBloom.slice(2) : r.logsBloom, "hex");
  const logs = r.logs.map((l) => [
    Buffer.from(l.address.startsWith("0x") ? l.address.slice(2) : l.address, "hex"),
    l.topics.map((t) => Buffer.from(t.startsWith("0x") ? t.slice(2) : t, "hex")),
    Buffer.from(l.data.startsWith("0x") ? l.data.slice(2) : l.data, "hex"),
  ]);
  const receiptRlp = rlpEncode([status, cumGas, bloom, logs]);

  const typeNum = parseInt(r.type, 16);
  if (typeNum === 0) return receiptRlp;            // legacy
  return Buffer.concat([Buffer.from([typeNum]), receiptRlp]); // typed (EIP-2718)
}

/** Minimum-byte BE representation of a BigInt (or empty for 0). */
function bigEndianBytes(v: bigint): Buffer {
  if (v === 0n) return Buffer.alloc(0);
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  return Buffer.from(h, "hex");
}

// ─────────────────────────────────────────────────────────────────────
// Lightweight helpers exposed for the cron / admin code that
// triggers period transitions and bootstraps the LC. These do not
// fetch deposit data — they're purely about light-client maintenance.
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the current LightClientFinalityUpdate for a chain. Used by
 * the periodic anchor relayer and by the period-transition cron.
 */
export async function fetchFinalityUpdate(srcChainId: string): Promise<LightClientFinalityUpdate> {
  return beaconClientFor(srcChainId).getFinalityUpdate();
}

/**
 * Fetch a LightClientUpdate for a specific period — used to drive
 * `EthLightClient.advanceCommittee` (carries the next sync committee).
 * Returns the first/only update at that period; reverts to undefined
 * if the beacon node has aged out historical updates for that period.
 */
export async function fetchLightClientUpdateAtPeriod(
  srcChainId: string,
  period: number,
): Promise<LightClientFinalityUpdate | undefined> {
  const updates = await beaconClientFor(srcChainId).getLightClientUpdates(period, 1);
  return updates[0];
}

// ─────────────────────────────────────────────────────────────────────
// Period-transition builder — for EthLightClient.advanceCommittee
// ─────────────────────────────────────────────────────────────────────

/** Mirrors the Solidity `PeriodTransition` struct. Drives the
 *  permissionless `advanceCommittee(update)` call that anchors the
 *  next period's sync committee. */
export interface PeriodTransitionJSON {
  attestedSlot: string;
  attestedProposerIndex: string;
  attestedParentRoot: string;
  attestedStateRoot: string;
  attestedBodyRoot: string;
  participationBits: string;          // 64 bytes hex
  signature: string;                   // 96 bytes compressed G2 hex
  signatureSlot: string;
  nextPubkeys: string[];               // 512 × 48-byte compressed G1 hex
  nextAggregatePubkey: string;         // 48 bytes compressed G1 hex
  nextBranch: string[];                // depth-5 SSZ Merkle branch hex
}

/** Largest number of period catch-up advanceCommittee txs we'll bundle
 *  into a single trustless-claim batch. A typical deployment has the
 *  sync-committee chain advanced periodically by a relayer; if we
 *  need to walk more than this in one tx, the LC was clearly under-
 *  maintained and the user should ask an admin to run catchup
 *  rather than pay the gas themselves.
 *
 *  Each period ≈ 27 h, so 16 ≈ 18 days of catchup. Tunable via env
 *  for unusual maintenance windows. */
const MAX_ADVANCE_COMMITTEE_TXS_ENV = "MAX_ADVANCE_COMMITTEE_TXS";
export const MAX_ADVANCE_COMMITTEE_TXS: number = (() => {
  const raw = process.env[MAX_ADVANCE_COMMITTEE_TXS_ENV];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
})();

/**
 * Build the PeriodTransition JSON list to bring an EthLightClient from
 * `startPeriod` up to `endPeriodInclusive`. Each transition in the
 * result is signed by the committee at its own period and anchors the
 * committee at the next period — i.e. transition[i] anchors period
 * `startPeriod + i + 1`.
 *
 * Throws if the beacon node returns fewer updates than requested
 * (typically because it's aged the older periods out of its
 * historical buffer).
 */
export async function buildPeriodTransitions(
  srcChainId: string,
  startPeriod: number,
  count: number,
): Promise<PeriodTransitionJSON[]> {
  if (count <= 0) return [];
  if (count > MAX_ADVANCE_COMMITTEE_TXS) {
    throw new TooManyMissingPeriodsError(
      `light client is ${count} periods behind the deposit; admin needs to run catchup ` +
        `(cap=${MAX_ADVANCE_COMMITTEE_TXS}, raise via env ${MAX_ADVANCE_COMMITTEE_TXS_ENV})`,
    );
  }
  const updates = await beaconClientFor(srcChainId).getLightClientUpdates(startPeriod, count);
  if (updates.length < count) {
    throw new Error(
      `buildPeriodTransitions: beacon node returned ${updates.length} updates, expected ${count} ` +
        `(start_period=${startPeriod}). Some periods aged out of the beacon's historical buffer.`,
    );
  }

  return updates.map((u, i) => {
    const sc = (u as any).next_sync_committee;
    const scBranch = (u as any).next_sync_committee_branch;
    if (!sc || !Array.isArray(sc.pubkeys) || sc.pubkeys.length !== 512) {
      throw new Error(
        `buildPeriodTransitions: update ${i} (period ${startPeriod + i}) missing next_sync_committee.pubkeys (512)`,
      );
    }
    if (!Array.isArray(scBranch)) {
      throw new Error(
        `buildPeriodTransitions: update ${i} missing next_sync_committee_branch`,
      );
    }
    return {
      attestedSlot:           u.attested_header.beacon.slot,
      attestedProposerIndex:  u.attested_header.beacon.proposer_index,
      attestedParentRoot:     u.attested_header.beacon.parent_root,
      attestedStateRoot:      u.attested_header.beacon.state_root,
      attestedBodyRoot:       u.attested_header.beacon.body_root,
      participationBits:      u.sync_aggregate.sync_committee_bits,
      signature:              u.sync_aggregate.sync_committee_signature,
      signatureSlot:          u.signature_slot,
      nextPubkeys:            sc.pubkeys,
      nextAggregatePubkey:    sc.aggregate_pubkey,
      nextBranch:             scBranch,
    };
  });
}

/**
 * The 512 compressed pubkeys of the sync committee for `period`.
 *
 * A LightClientUpdate for period P-1 carries the committee that serves period
 * P as `next_sync_committee` -- the same value advanceCommittee anchors -- so
 * the committee the prover hashes is the one the light client stored.
 */
export async function committeeForPeriod(
  srcChainId: string,
  period: number,
): Promise<string[]> {
  if (period <= 0) throw new Error(`committeeForPeriod: period ${period} has no predecessor update`);
  const updates = await beaconClientFor(srcChainId).getLightClientUpdates(period - 1, 1);
  const sc = (updates?.[0] as any)?.next_sync_committee;
  if (!sc || !Array.isArray(sc.pubkeys) || sc.pubkeys.length !== 512) {
    throw new Error(
      `committeeForPeriod: no next_sync_committee (512 pubkeys) in the update for period ${period - 1}`,
    );
  }
  return sc.pubkeys as string[];
}

/** Raised when the light client is so far behind that catching up
 *  would require more advanceCommittee txs than {MAX_ADVANCE_COMMITTEE_TXS}. */
export class TooManyMissingPeriodsError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TooManyMissingPeriodsError";
  }
}
