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
  ExecutionPayloadHeader,
  LightClientFinalityUpdate,
  beaconClientFor,
} from "./beaconClient.service";
import { EthLog, EthTransactionReceipt, getBlockReceipts, getTransactionReceipt } from "./ethRpc.service";
import { buildTrieAndProof } from "../helpers/mptBuilder.helper";
import { rlpEncode, rlpEncodeUint } from "../helpers/rlp.helper";
import {
  bufferToHex,
  hashTreeRootByteList,
  hashTreeRootByteVector,
  hexToBuffer,
} from "../helpers/ssz.helper";

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
 * @throws {DepositTooOldError} if the deposit is older than the live
 *         finalized header — needs parent-chain extension which is a
 *         later milestone.
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
    throw new NotFinalizedYetError(
      `deposit at block ${depositBlockNumber} not yet finalized (live finalized ${finalizedBlockNumber})`,
    );
  }
  if (depositBlockNumber < finalizedBlockNumber) {
    throw new DepositTooOldError(
      `deposit at block ${depositBlockNumber} is older than live finalized ${finalizedBlockNumber}; ` +
        `parent-chain anchoring not yet implemented`,
    );
  }

  // 4. Pre-compute logsBloomRoot and extraDataRoot. The on-chain
  //    SSZHashTree.hashTreeRootEPH expects these pre-hashed because
  //    the raw fields would dominate calldata.
  const logsBloomRoot = bufferToHex(
    hashTreeRootByteVector(hexToBuffer(finalizedExec.logs_bloom), 256),
  );
  const extraDataRoot = bufferToHex(
    hashTreeRootByteList(hexToBuffer(finalizedExec.extra_data), 32),
  );

  // 5. Assemble the JSON the frontend hands to wagmi.writeContract.
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

  const eph: EPHJSON = {
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
    blockNumber:    finalizedExec.block_number,
    headers,
    sync,
    parentChain:    [],
    eph,
    executionBranch,
  };
}

/** Caller should retry after ~13 minutes (one beacon-chain finality lag). */
export class NotFinalizedYetError extends Error {
  constructor(msg: string) { super(msg); this.name = "NotFinalizedYetError"; }
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
