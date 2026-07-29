/**
 * Off-chain builder for the SSZ Merkle proofs that
 * {EthLightClient.anchorBlockHeaderViaBlockRoots} and
 * {EthLightClient.anchorBlockHeaderViaHistoricalSummaries} consume.
 *
 * Replaces the parent-chain walk: instead of sending N beacon headers
 * and re-hashing each on-chain (one hashTreeRootBeaconHeader per hop,
 * which dominates gas at moderate N), we send a single state-root
 * proof that's constant-depth (~19 levels for block_roots, ~45 for
 * historical_summaries).
 *
 * Strategy:
 *   - depositSlot ≥ attestedSlot - 8192     → block_roots proof
 *   - depositSlot <  attestedSlot - 8192    → historical_summaries proof
 *
 * The historical_summaries case requires fetching TWO BeaconStates:
 *   1. attested-slot state (for the outer Merkle path).
 *   2. period-end state (for the inner block_roots vector — the only
 *      place state.block_roots is fully populated for that period).
 * The two proofs are concatenated (inner branch, then state_summary_root
 * sibling, then outer branch) into one path the contract walks straight
 * up to attested.state_root.
 *
 * Like the existing buildExecutionPayloadProof helper, this loads
 * @lodestar/types and @chainsafe/persistent-merkle-tree dynamically
 * because they ship ESM-only.
 */
import type { BeaconClient } from "../services/beaconClient.service";

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as <T = unknown>(s: string) => Promise<T>;

const SUPPORTED_FORKS = [
  "capella",
  "deneb",
  "electra",
  "fulu",
  "gloas",
] as const;
type ForkName = (typeof SUPPORTED_FORKS)[number];

/** Slots-per-period and slots-per-historical-root constants. Identical
 *  by spec (8192) and unlikely to change, but exported here so the
 *  on-chain `slot mod 8192` and the off-chain proof construction never
 *  drift apart. */
export const SLOTS_PER_HISTORICAL_ROOT = 8192;

let _modCache: { ssz: any; tree: any } | null = null;
async function loadDeps() {
  if (_modCache) return _modCache;
  const types = await dynamicImport<any>("@lodestar/types");
  const tree = await dynamicImport<any>("@chainsafe/persistent-merkle-tree");
  _modCache = { ssz: types.ssz, tree };
  return _modCache;
}

/**
 * The first historical-summaries-aligned period per source chain — the
 * period at which `state.historical_summaries[0]` was first appended
 * (= the period the Capella fork epoch falls into, since Capella
 * always lands on a period boundary on the chains we bridge from).
 *
 *   summary_index_in_list = period(depositSlot) − this constant.
 *
 * The contract doesn't need this (it just verifies whatever index the
 * off-chain prover supplies via the proof path); only the prover does,
 * to address the right element of state.historical_summaries.
 */
const CAPELLA_FIRST_ALIGNED_PERIOD: Record<string, number> = {
  // Mainnet: Capella fork at epoch 194048 = period 758.
  "1":        758,
  // Sepolia: Capella fork at epoch 56832 = period 222.
  "11155111": 222,
};

/** Pick a ForkName from the version string returned by the beacon API. */
function pickFork(version: string): ForkName {
  const v = String(version).toLowerCase();
  for (const name of SUPPORTED_FORKS) if (v === name) return name;
  throw new Error(`stateProof: unsupported fork version ${version}`);
}

export interface BlockRootsProofResult {
  kind: "block_roots";
  /** SSZ proof witnesses, leaf → state_root, depth 19 (Electra+). */
  branch: string[];
  /** Off-chain-computed leaf, for sanity-checking on the caller side
   *  (the contract will recompute this from the supplied target header). */
  leaf: string;
  /** Generalized index lodestar produced for the leaf. The contract
   *  recomputes this as `(blockRootsContainerGindex << 13) | (slot %
   *  8192)`; if the two disagree (e.g. a fork added enough state fields
   *  to bump the container depth) the on-chain proof verify fails with
   *  a misleading "block_roots proof failed". Surface it so the
   *  orchestrator can sanity-check before sending the tx. */
  gindex: bigint;
}

export interface HistoricalSummariesProofResult {
  kind: "historical_summaries";
  /** Index into state.historical_summaries the contract must reach. */
  summaryIndex: number;
  /** Concatenated branch: inner (block_summary_root vector) +
   *  state_summary_root sibling + outer (historical_summaries → state_root). */
  branch: string[];
  /** As above — sanity check. */
  leaf: string;
  /** Outer-path gindex (historicalSummaries[s].blockSummaryRoot from
   *  state_root) — same fork-shape sanity-check use as
   *  BlockRootsProofResult.gindex. */
  outerGindex: bigint;
}

export type StateProofResult = BlockRootsProofResult | HistoricalSummariesProofResult;

/**
 * Build an SSZ proof anchoring `target` (a beacon block header at
 * `depositSlot`) to `attested.state_root`. Picks the cheapest variant
 * automatically based on how far back `depositSlot` is.
 *
 * @param srcChainId       Source chain id ("1" or "11155111").
 * @param beacon           BeaconClient already configured for srcChainId.
 * @param attestedSlot     Slot of the attested header (light-client update).
 * @param attestedFork     Fork name reported by the beacon API for the
 *                         attested header — used to pick the right SSZ
 *                         schema (Electra/Fulu have different gindices
 *                         than Capella/Deneb).
 * @param depositSlot      Slot of the deposit's beacon block (the leaf
 *                         the proof will end at).
 * @param expectedLeaf     hash_tree_root of the deposit's beacon header,
 *                         used as a sanity-check that the off-chain
 *                         proof landed at the right address.
 */
export async function buildStateRootProof(
  srcChainId: string,
  beacon: BeaconClient,
  attestedSlot: number,
  attestedFork: string,
  depositSlot: number,
  expectedLeaf: string,
  attestedStateRoot: string,
): Promise<StateProofResult> {
  const fork = pickFork(attestedFork);
  const { ssz, tree } = await loadDeps();
  const StateSchema = ssz[fork]?.BeaconState;
  if (!StateSchema) {
    throw new Error(`stateProof: lodestar missing BeaconState schema for fork ${fork}`);
  }

  const lookback = attestedSlot - depositSlot;
  if (lookback <= 0) {
    throw new Error(
      `stateProof: depositSlot ${depositSlot} is not behind attestedSlot ${attestedSlot}`,
    );
  }

  // Block_roots branch covers the trailing 8192 slots of the attested
  // state — anything within `lookback < 8192` lives there.
  if (lookback < SLOTS_PER_HISTORICAL_ROOT) {
    return await _buildBlockRootsProof(
      beacon, attestedSlot, depositSlot, StateSchema, tree, expectedLeaf, attestedStateRoot,
    );
  }

  // Older deposit — fall through to historical_summaries.
  const capellaPeriod = CAPELLA_FIRST_ALIGNED_PERIOD[srcChainId];
  if (capellaPeriod === undefined) {
    throw new Error(
      `stateProof: chain ${srcChainId} has no historical_summaries config; only block_roots is supported`,
    );
  }
  return await _buildHistoricalSummariesProof(
    beacon, attestedSlot, depositSlot, capellaPeriod, StateSchema, tree, expectedLeaf, attestedStateRoot,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

async function _buildBlockRootsProof(
  beacon: BeaconClient,
  attestedSlot: number,
  depositSlot: number,
  StateSchema: any,
  tree: any,
  expectedLeaf: string,
  attestedStateRoot: string,
): Promise<BlockRootsProofResult> {
  // Fetch state at attested slot. attested.state_root commits to this
  // exact state, so its block_roots vector covers [attestedSlot - 8192,
  // attestedSlot - 1] and we read the depositSlot's entry directly.
  const stateBytes = await beacon.getStateSSZ(String(attestedSlot));
  const stateView = StateSchema.deserializeToViewDU(stateBytes);

  // The state we just fetched MUST hash to the attested header's
  // state_root — otherwise the on-chain verifyMerkleBranch (which
  // anchors against headers.attestedStateRoot) will fail with a
  // misleading "proof failed" even though the proof is correct against
  // some _other_ state. This typically means the beacon node served us
  // a different state for that slot (re-org, partial-sync, etc).
  const stateRoot = "0x" + Buffer.from(stateView.node.root).toString("hex");
  if (stateRoot.toLowerCase() !== attestedStateRoot.toLowerCase()) {
    throw new Error(
      `stateProof(block_roots): state.hash_tree_root mismatch at slot ${attestedSlot}.\n` +
        `  expected (attested.state_root): ${attestedStateRoot}\n` +
        `  got (fetched state.hashTreeRoot):  ${stateRoot}\n` +
        `Possible causes: beacon node re-org since the LightClient update was issued, ` +
        `or the node serves states from a different head than its finality update.`,
    );
  }

  const slotIndex = depositSlot % SLOTS_PER_HISTORICAL_ROOT;
  const path = StateSchema.getPathInfo(["blockRoots", slotIndex]);

  const proof = tree.createProof(stateView.node, {
    type: tree.ProofType.single,
    gindex: path.gindex,
  });

  const leaf = "0x" + Buffer.from(proof.leaf).toString("hex");
  if (leaf.toLowerCase() !== expectedLeaf.toLowerCase()) {
    throw new Error(
      `stateProof(block_roots): leaf mismatch — proof is for a different block at slot ${depositSlot}.\n` +
        `  expected: ${expectedLeaf}\n  got:      ${leaf}`,
    );
  }

  return {
    kind: "block_roots",
    branch: (proof.witnesses as Uint8Array[]).map(
      (w) => "0x" + Buffer.from(w).toString("hex"),
    ),
    leaf,
    gindex: BigInt(path.gindex),
  };
}

async function _buildHistoricalSummariesProof(
  beacon: BeaconClient,
  attestedSlot: number,
  depositSlot: number,
  capellaFirstPeriod: number,
  StateSchema: any,
  tree: any,
  expectedLeaf: string,
  attestedStateRoot: string,
): Promise<HistoricalSummariesProofResult> {
  // 1. Locate the historical_summaries entry that covers depositSlot.
  const depositPeriod = Math.floor(depositSlot / SLOTS_PER_HISTORICAL_ROOT);
  const summaryIndex = depositPeriod - capellaFirstPeriod;
  if (summaryIndex < 0) {
    throw new Error(
      `stateProof(historical_summaries): depositSlot ${depositSlot} is pre-Capella for this chain ` +
        `(period ${depositPeriod} < first aligned ${capellaFirstPeriod})`,
    );
  }

  // 2. Fetch the attested-slot state for the OUTER proof. Inside that
  //    state, build the partial proof from `historical_summaries[s].
  //    block_summary_root` up to state_root.
  const attestedStateBytes = await beacon.getStateSSZ(String(attestedSlot));
  const attestedView = StateSchema.deserializeToViewDU(attestedStateBytes);

  // Same state-root sanity check as in _buildBlockRootsProof — see
  // its comment for the rationale.
  const stateRoot = "0x" + Buffer.from(attestedView.node.root).toString("hex");
  if (stateRoot.toLowerCase() !== attestedStateRoot.toLowerCase()) {
    throw new Error(
      `stateProof(historical_summaries): state.hash_tree_root mismatch at slot ${attestedSlot}.\n` +
        `  expected (attested.state_root): ${attestedStateRoot}\n` +
        `  got (fetched state.hashTreeRoot):  ${stateRoot}`,
    );
  }

  const outerPath = StateSchema.getPathInfo([
    "historicalSummaries", summaryIndex, "blockSummaryRoot",
  ]);
  const outerProof = tree.createProof(attestedView.node, {
    type: tree.ProofType.single,
    gindex: outerPath.gindex,
  });

  // The leaf of the outer proof IS block_summary_root for this period.
  // We'll tie the inner proof to it.
  const blockSummaryRoot = Buffer.from(outerProof.leaf);

  // The sibling of block_summary_root in the HistoricalSummary
  // container is state_summary_root. lodestar emits sibling order
  // bottom-up in `outerProof.witnesses`, so it's at index 0 of the
  // witnesses array (that's the sibling at the deepest level of the
  // outer path — which is the HistoricalSummary container's other
  // field).
  if (!Array.isArray(outerProof.witnesses) || outerProof.witnesses.length === 0) {
    throw new Error(
      `stateProof(historical_summaries): outer proof has no witnesses — ` +
        `summaryIndex ${summaryIndex} likely out of range`,
    );
  }

  // 3. Fetch the period-end state for the INNER proof. The state at
  //    slot (depositPeriod + 1) * 8192 - 1 still has state.block_roots
  //    fully populated for `depositPeriod` (the next slot's transition
  //    is when historical_summaries gets appended). That state's
  //    hash_tree_root(state.block_roots) IS block_summary_root.
  const periodEndSlot = (depositPeriod + 1) * SLOTS_PER_HISTORICAL_ROOT - 1;
  if (periodEndSlot >= attestedSlot) {
    // Shouldn't happen — caller routed us to historical_summaries only
    // when depositSlot < attestedSlot - 8192. But guard against it.
    throw new Error(
      `stateProof(historical_summaries): period-end slot ${periodEndSlot} is >= attested slot ` +
        `${attestedSlot}; should have used block_roots path`,
    );
  }
  const periodStateBytes = await beacon.getStateSSZ(String(periodEndSlot));
  const periodView = StateSchema.deserializeToViewDU(periodStateBytes);

  // 3a. Sanity check: the period-end state's block_roots vector should
  //     hash to block_summary_root we got out of the attested state. If
  //     not, the period-end state we fetched isn't the right snapshot
  //     (which can happen if the beacon node holds a re-orged variant).
  const blockRootsView = periodView.blockRoots;
  const blockRootsTreeRoot = Buffer.from(blockRootsView.node.root);
  if (!blockRootsTreeRoot.equals(blockSummaryRoot)) {
    throw new Error(
      `stateProof(historical_summaries): period-end state.block_roots root mismatch — ` +
        `attested historical_summaries[${summaryIndex}].block_summary_root=` +
        `0x${blockSummaryRoot.toString("hex")}, period-end state hashed to ` +
        `0x${blockRootsTreeRoot.toString("hex")}`,
    );
  }

  // 3b. Build the inner branch: leaf at slot mod 8192 → block_summary_root.
  const slotIndex = depositSlot % SLOTS_PER_HISTORICAL_ROOT;
  const innerPath = StateSchema.fields.blockRoots.getPathInfo([slotIndex]);
  const innerProof = tree.createProof(blockRootsView.node, {
    type: tree.ProofType.single,
    gindex: innerPath.gindex,
  });

  const leaf = "0x" + Buffer.from(innerProof.leaf).toString("hex");
  if (leaf.toLowerCase() !== expectedLeaf.toLowerCase()) {
    throw new Error(
      `stateProof(historical_summaries): leaf mismatch at slot ${depositSlot}.\n` +
        `  expected: ${expectedLeaf}\n  got:      ${leaf}`,
    );
  }

  // 4. Concatenate: inner witnesses (depth 13, leaf → block_summary_root)
  //    + outer witnesses (depth 32 in Electra: 1 container + 25 list +
  //    6 outer container — the +1 for block_summary_root vs state_summary_root
  //    sibling is the deepest witness in outerProof.witnesses[0]).
  //
  //    lodestar emits witnesses[0] as the leaf-level sibling and
  //    witnesses[len-1] as the topmost. The contract's verifyMerkleBranch
  //    consumes them the same way (bottom-up). So concatenating
  //    [inner..., outer...] gives the full path leaf → state_root.
  const innerWitnesses = (innerProof.witnesses as Uint8Array[]).map(
    (w) => "0x" + Buffer.from(w).toString("hex"),
  );
  const outerWitnesses = (outerProof.witnesses as Uint8Array[]).map(
    (w) => "0x" + Buffer.from(w).toString("hex"),
  );

  return {
    kind: "historical_summaries",
    summaryIndex,
    branch: [...innerWitnesses, ...outerWitnesses],
    leaf,
    outerGindex: BigInt(outerPath.gindex),
  };
}
