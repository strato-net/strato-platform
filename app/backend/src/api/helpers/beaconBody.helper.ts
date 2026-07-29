/**
 * Beacon-block-body merkleization helpers, used by buildAnchorInputs
 * when the deposit is older than the live finalized head and we have
 * to anchor via parent-chain extension.
 *
 * On-chain, EthLightClient verifies execution_branch against the
 * target beacon block's body_root at gindex 25 (= position 9 in a
 * depth-4 BeaconBlockBody container). To produce that branch off-chain
 * we need a full SSZ merkleizer for BeaconBlockBody — re-implementing
 * one per fork is fragile, so we lean on @lodestar/types + @chainsafe
 * /persistent-merkle-tree.
 *
 * Both packages are ESM-only; the backend tsconfig emits CommonJS, so
 * a plain `await import(...)` would be rewritten to `require(...)`.
 * The Function-constructor trick preserves the dynamic-import semantics
 * (Node's `import()` runtime entry point) without TS interfering.
 */
import type { BeaconBlockResponse } from "../services/beaconClient.service";
import type { EPHJSON } from "../services/bridgeProof.service";
import {
  bufferToHex,
  hashTreeRootByteList,
  hashTreeRootByteVector,
  hexToBuffer,
} from "./ssz.helper";

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as <T = unknown>(s: string) => Promise<T>;

const SUPPORTED_FORKS = [
  "bellatrix",
  "capella",
  "deneb",
  "electra",
  "fulu",
  "gloas",
] as const;
type ForkName = (typeof SUPPORTED_FORKS)[number];

function pickFork(version: string): ForkName {
  const v = String(version).toLowerCase();
  for (const name of SUPPORTED_FORKS) if (v === name) return name;
  throw new Error(`beaconBody: unsupported fork version ${version}`);
}

let _modCache: { ssz: any; tree: any } | null = null;
async function loadDeps() {
  if (_modCache) return _modCache;
  const types = await dynamicImport<any>("@lodestar/types");
  const tree = await dynamicImport<any>(
    "@chainsafe/persistent-merkle-tree",
  );
  _modCache = { ssz: types.ssz, tree };
  return _modCache;
}

/**
 * Extract the EPH JSON + the execution_branch (depth 4) for a beacon
 * block. The branch proves `hashTreeRoot(EPH) == leaf` at gindex 25
 * against the block's body_root, which is exactly what the on-chain
 * verifyMerkleBranch expects.
 *
 * Note: lodestar types use camelCase JSON keys (`parentHash` etc.)
 * while the beacon API returns snake_case. Lodestar's `fromJson` is
 * spec-compliant and accepts the snake_case form — no conversion
 * needed at the call site.
 */
export async function buildExecutionPayloadProof(
  beaconBlock: BeaconBlockResponse,
): Promise<{
  ephJson: EPHJSON;
  executionBranch: string[];
  /** hash_tree_root(BeaconBlockBody) — needed by the state-proof
   *  anchor entrypoints to fill `target.bodyRoot`. */
  bodyRoot: string;
  /** hash_tree_root(BeaconBlockHeader) for the block — used to
   *  sanity-check that the state-proof leaf addresses this block. */
  beaconBlockRoot: string;
}> {
  const { ssz, tree } = await loadDeps();
  const fork = pickFork(beaconBlock.version);

  const forkSsz = ssz[fork];
  if (!forkSsz?.BeaconBlockBody || !forkSsz?.ExecutionPayload) {
    throw new Error(`beaconBody: lodestar missing types for fork ${fork}`);
  }

  const message = (beaconBlock.data as any)?.message;
  const bodyJson = message?.body;
  if (!message || !bodyJson) {
    throw new Error("beaconBody: beacon block response missing message.body");
  }

  // 1. Deserialize body and produce the execution-payload-at-gindex-25
  //    proof off the body's tree.
  const bodyValue = forkSsz.BeaconBlockBody.fromJson(bodyJson);
  const bodyNode = forkSsz.BeaconBlockBody.value_toTree(bodyValue);
  const bodyRoot = "0x" + Buffer.from(bodyNode.root).toString("hex");
  const path = forkSsz.BeaconBlockBody.getPathInfo(["executionPayload"]);
  const proof = tree.createProof(bodyNode, {
    type: tree.ProofType.single,
    gindex: path.gindex,
  });
  const executionBranch: string[] = (proof.witnesses as Uint8Array[]).map(
    (w) => "0x" + Buffer.from(w).toString("hex"),
  );

  // hash_tree_root(BeaconBlockHeader). 5-field SSZ container; we
  // build it from message.{slot, proposer_index, parent_root, state_root}
  // plus the just-computed body_root.
  const headerValue = forkSsz.BeaconBlockHeader.fromJson({
    slot:           message.slot,
    proposer_index: message.proposer_index,
    parent_root:    message.parent_root,
    state_root:     message.state_root,
    body_root:      bodyRoot,
  });
  const beaconBlockRoot =
    "0x" + Buffer.from(forkSsz.BeaconBlockHeader.hashTreeRoot(headerValue)).toString("hex");

  // 2. EPH derives from the block's full ExecutionPayload — same
  //    fields, except transactions/withdrawals collapse to their roots
  //    (which is precisely the EPH-vs-Payload SSZ distinction).
  const exec = bodyJson.execution_payload;
  if (!exec) {
    throw new Error("beaconBody: block body missing execution_payload");
  }

  const txnsRoot = bufferToHex(
    Buffer.from(
      forkSsz.ExecutionPayload.fields.transactions.hashTreeRoot(
        forkSsz.ExecutionPayload.fields.transactions.fromJson(exec.transactions),
      ),
    ),
  );
  let withdrawalsRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  if (forkSsz.ExecutionPayload.fields.withdrawals && exec.withdrawals) {
    withdrawalsRoot = bufferToHex(
      Buffer.from(
        forkSsz.ExecutionPayload.fields.withdrawals.hashTreeRoot(
          forkSsz.ExecutionPayload.fields.withdrawals.fromJson(exec.withdrawals),
        ),
      ),
    );
  }

  // logsBloom (256-byte ByteVector) and extra_data (variable-length
  // ByteList[32]) match the on-chain pre-hashed form.
  const logsBloomRoot = bufferToHex(
    hashTreeRootByteVector(hexToBuffer(exec.logs_bloom), 256),
  );
  const extraDataRoot = bufferToHex(
    hashTreeRootByteList(hexToBuffer(exec.extra_data), 32),
  );

  const ephJson: EPHJSON = {
    parentHash: exec.parent_hash,
    feeRecipient: exec.fee_recipient,
    stateRoot: exec.state_root,
    receiptsRoot: exec.receipts_root,
    logsBloomRoot,
    prevRandao: exec.prev_randao,
    blockNumber: exec.block_number,
    gasLimit: exec.gas_limit,
    gasUsed: exec.gas_used,
    timestamp: exec.timestamp,
    extraDataRoot,
    baseFeePerGas: exec.base_fee_per_gas,
    blockHash: exec.block_hash,
    transactionsRoot: txnsRoot,
    withdrawalsRoot,
    blobGasUsed: exec.blob_gas_used ?? "0",
    excessBlobGas: exec.excess_blob_gas ?? "0",
  };

  return { ephJson, executionBranch, bodyRoot, beaconBlockRoot };
}
