import "../../libraries/Bridge/BLSVerify.sol";
import "../../concrete/Plonk/PlonkVerifier.sol";
import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/SSZHashTree.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @notice The header information from a LightClientFinalityUpdate
 *         that the contract needs. Bundled into a struct so the
 *         function signature stays manageable; the SolidVM calldata
 *         layout matches what beacon-API responses give us. Defined
 *         at file scope so other contracts (and tests) can construct
 *         it directly.
 */
struct AnchorHeaders {
    uint64  attestedSlot;
    uint64  attestedProposerIndex;
    bytes32 attestedParentRoot;
    bytes32 attestedStateRoot;
    bytes32 attestedBodyRoot;
    uint64  finalizedSlot;
    uint64  finalizedProposerIndex;
    bytes32 finalizedParentRoot;
    bytes32 finalizedStateRoot;
    bytes32 finalizedBodyRoot;
    bytes32[] finalityBranch;
}

/**
 * @notice A flat representation of one BeaconBlockHeader, used for
 *         parent-chain extension. The walk verifies a sequence of
 *         these starting just below `finalizedHeader` and ending at
 *         the user's target block — each step is checked by
 *         hash_tree_root chaining via parent_root.
 */
struct BeaconBlockHeaderInput {
    uint64  slot;
    uint64  proposerIndex;
    bytes32 parentRoot;
    bytes32 stateRoot;
    bytes32 bodyRoot;
}

/**
 * @notice Sync aggregate from finality_update.sync_aggregate. The
 *         aggregate pubkey is computed on-chain by summing committee
 *         members whose bit is set in participationBits — that's the
 *         soundness anchor; an attacker submitting a different
 *         aggregate can't satisfy the pairing.
 */
struct SyncAggregateInput {
    // 64-byte SSZ Bitvector[512], split into 2×bytes32 chunks. The
    // chunked layout is required to round-trip through SolidVM's
    // JSON-RPC ABI: variable-length `bytes` nested in a struct field
    // gets coerced to a string and never Base16-decoded, so we'd
    // otherwise receive a 128-byte ASCII payload on-chain. Fixed-size
    // bytes32 (and bytes32[]) decode correctly through the wallet-
    // wrapping path, so the chunked form is the cheapest workaround.
    bytes32[2] participationBits;
    // 96-byte IETF compressed G2 BLS signature, split into 3×bytes32.
    bytes32[3] signature;
    uint64 signatureSlot;       // determines which committee signed
}

/**
 * @notice Inputs for a sync-committee period transition. A
 *         consensus-spec LightClientUpdate at a period boundary
 *         carries this data plus a finalized_header / finality_branch
 *         we don't need for the committee-anchoring step. The
 *         reduced struct is what {EthLightClient.advanceCommittee}
 *         consumes.
 *
 *         Verification chain inside advanceCommittee:
 *           1. Sync committee for period(signatureSlot) signed
 *              attested_header (BLS pairing).
 *           2. hash_tree_root(nextCommittee) is computed on-chain
 *              from the supplied pubkeys + aggregatePubkey.
 *           3. nextSyncCommitteeBranch proves that root from
 *              attestedStateRoot at nextSyncCommitteeIndex.
 *           4. Store nextPubkeys at period(attestedSlot) + 1.
 *
 *         Notably we do NOT keep the next committee's
 *         aggregatePubkey: future verifications recompute the
 *         participating-subset aggregate on-chain from pubkeys[].
 */
struct PeriodTransition {
    // attested_header.beacon (signed by current period's sync committee)
    uint64  attestedSlot;
    uint64  attestedProposerIndex;
    bytes32 attestedParentRoot;
    bytes32 attestedStateRoot;
    bytes32 attestedBodyRoot;
    // sync aggregate — chunked layout (see SyncAggregateInput).
    bytes32[2] participationBits;
    bytes32[3] signature;
    uint64     signatureSlot;
    // next_sync_committee
    // pubkeys[] is fine as `bytes[]` because the array decoder threads
    // its element type through correctly; only `bytes` standalone in a
    // struct trips the JSON-RPC bug.
    bytes[]    nextPubkeys;            // 512 × 48 bytes IETF compressed
    // 48-byte BLS pubkey + 16-byte SSZ right-pad, packed into 2×bytes32.
    // The trailing 16 bytes of word1 must be zero per the SSZ spec; if
    // they aren't, hashTreeRootSyncCommittee yields a different root and
    // the next-committee branch verify reverts — no extra check needed.
    bytes32[2] nextAggregatePubkey;
    bytes32[]  nextBranch;             // proves committee SSZ root from attestedStateRoot
}

/**
 * @title  EthLightClient
 * @notice Trustless Ethereum light client running on STRATO. Anchors
 *         (block_number → receipts_root) pairs from
 *         LightClientFinalityUpdates so that EthBridgeIn can verify
 *         deposit log inclusion via standard MPT proofs against the
 *         receipts root.
 *
 *         Scope of this v1:
 *           - Bootstrap with an admin-supplied sync committee.
 *           - Anchor a finalized exec header from a single
 *             LightClientFinalityUpdate. Verifies sync committee BLS
 *             aggregate signature, finality Merkle branch, and direct
 *             Merkle branches from the finalized body root to
 *             receipts_root and block_number.
 *           - Read accessor for the bridge claim contract.
 *
 *         Deferred to follow-ups:
 *           - Period transitions (advanceCommittees) — needs
 *             hash_tree_root(SyncCommittee) on-chain.
 *           - Parent-chain extension — anchor blocks that aren't the
 *             current finalized head by walking parent_root pointers.
 *           - Sliding-window committee retention.
 *
 *         For now, the admin re-bootstraps when a new sync-committee
 *         period rolls over (every ~27 hours). The trust model is
 *         identical to a one-time-bootstrapped Helios light client
 *         once that's the case.
 */
contract EthLightClient is Ownable, ILightClient {

    // ─────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────

    /// SSZ-LC: domain type for sync committee signatures.
    bytes4 constant DOMAIN_SYNC_COMMITTEE = bytes4(0x07000000);

    /// SSZ-LC: 2/3 of 512-validator sync committee = 342.
    uint256 constant MIN_PARTICIPATION = 342;

    /// Slots per epoch (Phase 0 mainnet preset).
    uint64 constant SLOTS_PER_EPOCH = 32;

    /// Sync committee period in epochs (Altair).
    uint64 constant EPOCHS_PER_SYNC_COMMITTEE_PERIOD = 256;

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// Genesis validators root for the chain we're tracking
    /// (e.g. Sepolia: 0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078).
    bytes32 public genesisValidatorsRoot;

    /// Active fork version on the tracked chain. Admin updates this at
    /// each Ethereum hard fork. Used in compute_domain so signatures
    /// are bound to the correct fork.
    bytes4 public forkVersion;

    /// SSZ generalized indices, expressed as the leaf's 0-based
    /// position in its tree level (the form verifyMerkleBranch wants).
    /// These are fork-dependent; admin-updatable.
    ///
    /// Defaults below are for Electra/Fulu (the BeaconState layout
    /// shifted at Electra; Fulu inherited it). Pre-Electra clients
    /// would set finalizedRootIndex = 41 with depth 6 not 7.
    ///
    /// finalizedRootIndex      : leaf position of finalized_checkpoint.root in
    ///                           BeaconState. Electra+: position 41 in level 7.
    /// nextSyncCommitteeIndex  : leaf position of next_sync_committee in
    ///                           BeaconState. Electra+: position 23 in level 6.
    /// executionPayloadIndex   : leaf position of execution_payload in
    ///                           BeaconBlockBody. Capella+: position 9 in level 4.
    uint256 public finalizedRootIndex;
    uint256 public nextSyncCommitteeIndex;
    uint256 public executionPayloadIndex;

    /// Container gindices for the BeaconState fields used by the
    /// constant-cost state-proof anchor entrypoints
    /// ({anchorBlockHeaderViaBlockRoots} and
    /// {anchorBlockHeaderViaHistoricalSummaries}).
    ///
    /// Each value is the gindex of the FIELD (not the leaf within it):
    ///   blockRootsContainerGindex          : gindex of state.block_roots          in BeaconState
    ///   historicalSummariesContainerGindex : gindex of state.historical_summaries in BeaconState
    ///
    /// Defaults below are for Electra/Fulu (BeaconState ≈ 37 fields →
    /// padded to 64 leaves at depth 6, so field-i gindex = 64 + i).
    /// Pre-Electra these would be 32 + i (depth 5) — admin-updatable
    /// via {setStateProofIndices} for forks that restructure the
    /// container.
    uint256 public blockRootsContainerGindex;
    uint256 public historicalSummariesContainerGindex;

    /// Sync committees keyed by period (= slot / 8192). Stored as a
    /// single bytes[] mapping (not a struct-of-fields) — SolidVM's
    /// storage layout for nested dynamic types can cross-pollute reads
    /// in subtle ways, so we keep this as flat as possible.
    mapping(uint64 => bytes[]) committeePubkeys;
    uint64 public latestPeriod;

    /// The committee's `aggregate_pubkey` per period, stored in EIP-2537
    /// uncompressed form (128 bytes) so the anchoring path doesn't
    /// re-decompress it on every call.
    ///
    /// This is the sum of all 512 members, which lets
    /// {BLSVerify.aggregateByAbsence} derive the participating-subset
    /// aggregate by subtracting the non-signers instead of summing the
    /// signers. At real participation rates that is an order of magnitude
    /// less elliptic-curve work, and it is the difference between the
    /// anchor fitting a transaction's gas budget and not.
    ///
    /// Populated automatically by {advanceCommittee} (where the value
    /// arrives inside a LightClientUpdate and is verified as part of the
    /// committee's SSZ root), or by {setCommitteeAggregate} for a period
    /// installed via {bootstrap}. An unset entry is not an error — the
    /// verifier falls back to summing the signers.
    mapping(uint64 => bytes) committeeAggregate;

    /// Poseidon2 commitment over a period's committee, in exactly the form
    /// the aggregation circuit re-derives: per member, in committee order,
    /// the affine X then Y, each as two 192-bit halves (high half first
    /// within the pair the circuit writes as xlo, xhi, ylo, yhi).
    ///
    /// Zero until {buildCommitteeCommitment} has walked the whole committee.
    /// Zero is also what disables the proof path for that period, which
    /// leaves the native aggregation as the fallback.
    mapping(uint64 => uint256) public committeeCommitment;

    /// Partial state of a commitment build. The digest is a Merkle-Damgard
    /// fold, so it can be absorbed a chunk at a time and resumed: `state` is
    /// the running digest and `next` the committee index still to absorb.
    struct CommitmentBuild {
        uint256 state;
        uint256 next;
    }
    mapping(uint64 => CommitmentBuild) public commitmentBuild;

    /// Verifier for subset-aggregate proofs. Unset disables the proof path
    /// entirely.
    ///
    /// @dev Stored as a plain address rather than a typed reference, the same
    ///      way MercataBridge holds its bridgeIns. A contract-typed argument
    ///      cannot be marshalled through bloc's JSON-RPC ABI -- it resolves
    ///      the type name against the callee's definitions and fails -- so a
    ///      typed setter is not callable from a deploy script at all.
    address public aggregateVerifier;

    /// Aggregates proven by {submitAggregateProof}, keyed by
    /// (period, participation bitfield). The anchor path reads this before
    /// falling back to deriving the aggregate on-chain, which keeps the
    /// proof a separate transaction from the anchor -- they already travel
    /// as one signed batch -- and leaves all three anchor entry points and
    /// their ABI untouched.
    mapping(bytes32 => bytes) verifiedAggregate;

    /// Anchored finalized exec headers, keyed by Ethereum block number.
    /// Once anchored, EthBridgeIn (or any other consumer) can call
    /// getReceiptsRoot(blockNumber) and trust the result.
    struct AnchoredHeader {
        uint256 blockNumber;
        bytes32 receiptsRoot;
        bytes32 stateRoot;        // L1 state root — enables L1 state-proof flows (Base/Cannon, Linea, etc.)
        uint64  beaconSlot;
        uint64  timestamp;
    }
    mapping(uint256 => AnchoredHeader) public anchored;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event Bootstrapped(uint64 period, bytes32 genesisValidatorsRoot, bytes4 forkVersion);
    event ForkVersionUpdated(bytes4 oldVersion, bytes4 newVersion);
    event IndicesUpdated(uint256 finalizedRootIndex, uint256 nextSyncCommitteeIndex, uint256 executionPayloadIndex);
    event StateProofIndicesUpdated(uint256 blockRootsContainerGindex, uint256 historicalSummariesContainerGindex);
    event CommitteeAnchored(uint64 period);

    /// @notice The committee `aggregate_pubkey` for `period` was installed.
    event CommitteeAggregateSet(uint64 period);

    /// @notice A commitment build absorbed up to (but not including) `next`.
    event CommitteeCommitmentProgress(uint64 period, uint256 next);

    /// @notice The committee commitment for `period` is complete.
    event CommitteeCommitmentSet(uint64 period, uint256 commitment);

    /// @notice The subset-aggregate verifier was changed.
    event AggregateVerifierSet(address verifier);

    /// @notice A subset aggregate was proven for (period, participation).
    event AggregateProven(uint64 period, bytes32 key);
    event HeaderAnchored(uint256 blockNumber, bytes32 receiptsRoot, uint64 beaconSlot, uint64 timestamp);

    // ─────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────

    constructor(address owner_) Ownable(owner_) {
        // SSZ generalized indices for Electra/Fulu by default. Bootstrap
        // sets the rest; admin can override indices via setIndices() if
        // needed (e.g., for pre-Electra forks).
        finalizedRootIndex = 41;        // level 7 / gindex 169 (Electra+ BeaconState)
        nextSyncCommitteeIndex = 23;    // level 6 / gindex 87  (Electra+ BeaconState)
        executionPayloadIndex = 9;      // level 4 / gindex 25  (Capella+ BeaconBlockBody)
        // State-proof container gindices (Electra+ BeaconState):
        //   block_roots          = field 5  → gindex 64+5  = 69
        //   historical_summaries = field 27 → gindex 64+27 = 91
        blockRootsContainerGindex          = 69;
        historicalSummariesContainerGindex = 91;
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin: bootstrap & fork updates
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice One-time bootstrap. Sets the initial trusted sync
     *         committee and the network constants needed to verify
     *         signatures.
     *
     * @param period                     Sync-committee period this committee belongs to (= slot / 8192).
     * @param pubkeys                    The 512 compressed pubkeys (48 bytes each).
     * @param genesisValidatorsRoot_     genesis_validators_root for the tracked chain.
     * @param forkVersion_               Active fork version at bootstrap time.
     */
    function bootstrap(
        uint64 period,
        bytes[] pubkeys,
        bytes32 genesisValidatorsRoot_,
        bytes4 forkVersion_
    ) external onlyOwner {
        require(committeePubkeys[period].length == 0, "EthLightClient: already bootstrapped at period");
        require(pubkeys.length == 512, "EthLightClient: expected 512 pubkeys");
        // Sanity-check pubkey lengths so we fail at bootstrap rather than
        // at first verification.
        for (uint i = 0; i < 512; i = i + 1) {
            require(pubkeys[i].length == 48, "EthLightClient: each pubkey must be 48 bytes");
        }

        committeePubkeys[period] = pubkeys;
        if (period > latestPeriod) latestPeriod = period;
        genesisValidatorsRoot = genesisValidatorsRoot_;
        forkVersion = forkVersion_;

        emit Bootstrapped(period, genesisValidatorsRoot_, forkVersion_);
    }

    /**
     * @notice Install the `aggregate_pubkey` for a period bootstrapped by
     *         {bootstrap}.
     *
     * @dev    Periods installed by {advanceCommittee} get this for free:
     *         the update carries the aggregate, and the committee's SSZ
     *         root — which the aggregate is part of — is verified against
     *         the beacon state before anything is stored. A bootstrapped
     *         period has no such proof, so the aggregate is admin-supplied
     *         on the same trust footing as the pubkeys themselves.
     *
     *         Supplying a wrong aggregate cannot forge anything. It makes
     *         {aggregateByAbsence} produce a subset aggregate that does not
     *         match the signers, and the BLS pairing then rejects the
     *         signature. The failure mode is a stuck light client, not a
     *         false anchor.
     *
     * @param period               Period whose committee this aggregates.
     * @param aggregateCompressed  48-byte IETF compressed G1.
     */
    function setCommitteeAggregate(uint64 period, bytes aggregateCompressed) external onlyOwner {
        require(committeePubkeys[period].length == 512, "EthLightClient: no committee for this period");
        require(aggregateCompressed.length == 48, "EthLightClient: aggregate must be 48 bytes");
        committeeAggregate[period] = bls12381DecompressG1(aggregateCompressed);
        emit CommitteeAggregateSet(period);
    }

    /**
     * @notice Update active fork version. Required at every Ethereum
     *         hard fork (the signing domain changes with the version).
     */
    function setForkVersion(bytes4 newVersion) external onlyOwner {
        bytes4 old = forkVersion;
        forkVersion = newVersion;
        emit ForkVersionUpdated(old, newVersion);
    }

    /**
     * @notice Update SSZ generalized indices. Required if the
     *         BeaconState or BeaconBlockBody schema changes at a fork
     *         (e.g., the Electra fork moved finalizedRootIndex).
     */
    function setIndices(
        uint256 finalizedRootIndex_,
        uint256 nextSyncCommitteeIndex_,
        uint256 executionPayloadIndex_
    ) external onlyOwner {
        finalizedRootIndex = finalizedRootIndex_;
        nextSyncCommitteeIndex = nextSyncCommitteeIndex_;
        executionPayloadIndex = executionPayloadIndex_;
        emit IndicesUpdated(finalizedRootIndex_, nextSyncCommitteeIndex_, executionPayloadIndex_);
    }

    /**
     * @notice Update the BeaconState container gindices used by the
     *         state-proof anchor entrypoints. Needed only at forks that
     *         restructure BeaconState's field layout.
     *
     *         For Electra/Fulu (37 fields, depth-6 container):
     *           blockRootsContainerGindex          = 69   (field 5)
     *           historicalSummariesContainerGindex = 91   (field 27)
     *         For Capella/Deneb (28 fields, depth-5 container):
     *           blockRootsContainerGindex          = 37   (32+5)
     *           historicalSummariesContainerGindex = 59   (32+27)
     */
    function setStateProofIndices(
        uint256 blockRootsContainerGindex_,
        uint256 historicalSummariesContainerGindex_
    ) external onlyOwner {
        blockRootsContainerGindex          = blockRootsContainerGindex_;
        historicalSummariesContainerGindex = historicalSummariesContainerGindex_;
        emit StateProofIndicesUpdated(blockRootsContainerGindex_, historicalSummariesContainerGindex_);
    }

    // ─────────────────────────────────────────────────────────────────
    // Permissionless: anchor a finalized exec header
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a LightClientFinalityUpdate end-to-end and store
     *         (blockNumber → receiptsRoot) so EthBridgeIn can use it.
     *
     *         Verification chain:
     *           1. Sync committee BLS aggregate signature over the
     *              attested header. Signing root = sha256(
     *              hash_tree_root(attestedHeader) || domain), where
     *              domain = compute_domain(0x07000000, forkVersion,
     *              genesis_validators_root).
     *           2. finalityBranch proves finalizedHeader from
     *              attestedHeader.stateRoot at the configured finalized
     *              root index.
     *           3. receiptsRootBranch proves receiptsRoot from
     *              finalizedHeader.bodyRoot at the combined gindex
     *              for EPH.receipts_root.
     *           4. blockNumberBranch proves uint64ToLeaf(blockNumber)
     *              from finalizedHeader.bodyRoot at the combined
     *              gindex for EPH.block_number.
     *
     *         Caller-supplied participation must be ≥ ⅔ of the
     *         committee for the (signature_slot/8192)-th period.
     *
     * @return blockNumber returned for the caller's convenience; also
     *         indexes anchored[].
     */
    /**
     * @notice Verify a LightClientFinalityUpdate end-to-end and store
     *         (eph.blockNumber → eph.receiptsRoot) so EthBridgeIn can
     *         use it.
     *
     *         Verification chain:
     *           1. Sync committee BLS aggregate signature over the
     *              attested header (signing root composed via
     *              SSZHashTree.computeSigningRoot).
     *           2. finalityBranch proves finalized_header from
     *              attestedHeader.stateRoot.
     *           3. parentChain (optional) walks from finalizedHeader
     *              down to the user's target block via parent_root
     *              chaining. If empty, target = finalizedHeader.
     *              This lets callers anchor blocks older than the
     *              current finalized head — they just supply the
     *              intermediate headers from any beacon node.
     *           4. hash_tree_root(eph) is computed on-chain.
     *           5. executionBranch proves the EPH root from
     *              target.bodyRoot at executionPayloadIndex.
     *           6. eph.receiptsRoot and eph.blockNumber are read
     *              directly from the verified struct and stored.
     *
     * @param parentChain  Optional sequence of intermediate beacon
     *                     headers from finalizedHeader's parent down
     *                     to the target. Empty (length 0) means the
     *                     finalizedHeader is itself the target. The
     *                     last element of a non-empty parentChain is
     *                     the target.
     */
    function anchorBlockHeader(
        AnchorHeaders headers,
        SyncAggregateInput sync,
        BeaconBlockHeaderInput[] parentChain,
        ExecutionPayloadHeader eph,
        bytes32[] executionBranch
    ) external returns (uint256) {
        // 1. Sync-committee BLS + finality branch (shared prelude).
        _verifySyncAndFinality(headers, sync);

        // 2. Walk parent chain to determine the anchor target.
        //    If parentChain is empty, the finalizedHeader IS the target.
        //    Otherwise we walk: each header's hash_tree_root must equal
        //    the previous header's parent_root, starting with
        //    finalizedHeader.parent_root for the very first step. The
        //    last header in parentChain is the target.
        //
        //    Heads-up: this loop's gas is O(parentChain.length × cost of
        //    hashTreeRootBeaconHeader). For deposits more than ~50 slots
        //    behind finalized, prefer {anchorBlockHeaderViaBlockRoots}
        //    or {anchorBlockHeaderViaHistoricalSummaries} — those use
        //    a constant-depth state-root SSZ proof and don't hash one
        //    header per hop.
        bytes32 targetBodyRoot = headers.finalizedBodyRoot;
        uint64  targetSlot     = headers.finalizedSlot;
        if (parentChain.length > 0) {
            bytes32 expected = headers.finalizedParentRoot;
            for (uint256 i = 0; i < parentChain.length; i = i + 1) {
                bytes32 h = SSZHashTree.hashTreeRootBeaconHeader(
                    parentChain[i].slot,
                    parentChain[i].proposerIndex,
                    parentChain[i].parentRoot,
                    parentChain[i].stateRoot,
                    parentChain[i].bodyRoot
                );
                require(h == expected, "EthLightClient: parent chain mismatch");
                expected = parentChain[i].parentRoot;
            }
            BeaconBlockHeaderInput memory tgt = parentChain[parentChain.length - 1];
            targetBodyRoot = tgt.bodyRoot;
            targetSlot     = tgt.slot;
        }

        // 3. Verify execution payload against target, anchor.
        return _verifyAndAnchor(targetSlot, targetBodyRoot, eph, executionBranch);
    }

    /**
     * @notice Anchor an execution-layer block whose beacon block is in
     *         the last 8192 slots — the last ~27h of chain history.
     *         Constant on-chain cost: ~19 sha256 hashes for the state-
     *         proof + the standard sync-committee verification +
     *         execution-branch check. No parent-chain walk.
     *
     *         Verification chain:
     *           1. attested header is signed by ≥ ⅔ of the period's sync
     *              committee (same as {anchorBlockHeader}).
     *           2. finalized header is committed in attested.state_root
     *              (finality branch — same as before).
     *           3. target.slot ≤ finalized.slot (so we only anchor blocks
     *              the chain has actually finalized).
     *           4. SSZ Merkle proof: hash_tree_root(target) is at
     *              state.block_roots[target.slot mod 8192], where the
     *              state is committed by attested.state_root. The branch
     *              is composed (vector-internal 13 levels + container 6
     *              levels = 19 levels for Electra+).
     *           5. Standard execution-branch verification against
     *              target.bodyRoot, then anchor.
     *
     * @param target            Full beacon header at the deposit's slot
     *                          — slot, proposer index, parent root,
     *                          state root, body root. The contract
     *                          rebuilds its hash_tree_root and checks
     *                          it against the supplied state-proof leaf.
     * @param blockRootsBranch  19-element SSZ branch from
     *                          state.block_roots[target.slot mod 8192]
     *                          up to attested.state_root.
     */
    function anchorBlockHeaderViaBlockRoots(
        AnchorHeaders headers,
        SyncAggregateInput sync,
        BeaconBlockHeaderInput target,
        bytes32[] blockRootsBranch,
        ExecutionPayloadHeader eph,
        bytes32[] executionBranch
    ) external returns (uint256) {
        _verifySyncAndFinality(headers, sync);
        require(target.slot <= headers.finalizedSlot, "EthLightClient: target not finalized");

        // SSZ proof: target's beacon root is at state.block_roots[D mod 8192].
        bytes32 targetBeaconRoot = SSZHashTree.hashTreeRootBeaconHeader(
            target.slot, target.proposerIndex,
            target.parentRoot, target.stateRoot, target.bodyRoot
        );
        // gindex = blockRootsContainerGindex << 13 | (slot mod 8192).
        // For Electra+ with block_roots at field 5 (depth-6 container,
        // base gindex 64+5=69): top 6 bits = 1<<6|5 = 69, bottom 13 bits
        // = slot mod 8192 → 19-bit gindex. verifyMerkleBranch consumes
        // the bottom 19 bits as the path; the leading 1 of the gindex
        // isn't used.
        uint256 brIndex = (blockRootsContainerGindex << 13)
                        | (uint256(target.slot) % uint256(8192));
        require(
            SSZHashTree.verifyMerkleBranch(
                targetBeaconRoot, blockRootsBranch, brIndex, headers.attestedStateRoot
            ),
            "EthLightClient: block_roots proof failed"
        );

        return _verifyAndAnchor(target.slot, target.bodyRoot, eph, executionBranch);
    }

    /**
     * @notice Anchor an execution-layer block whose beacon block is more
     *         than 8192 slots behind the attested header. Uses the
     *         post-Capella `historical_summaries` accumulator: each
     *         summary records hash_tree_root(state.block_roots) at the
     *         end of one 8192-slot period, so we can chain a vector
     *         proof inside that summary up to attested.state_root.
     *
     *         Branch length is fork-dependent but constant per fork
     *         (~45 levels for Electra+: 13 inner vector + 1 summary
     *         container + 25 list internal + 6 outer container).
     *
     * @param target               Full beacon header at the deposit's slot.
     * @param summaryIndex         Index in `state.historical_summaries`.
     *                             Off-chain prover computes this as
     *                             `period(target.slot) − capella_first_aligned_period`.
     *                             If wrong, the proof simply won't
     *                             verify against attested.state_root.
     * @param historicalBranch     ~45-element SSZ branch from the leaf
     *                             beacon root up to attested.state_root.
     */
    function anchorBlockHeaderViaHistoricalSummaries(
        AnchorHeaders headers,
        SyncAggregateInput sync,
        BeaconBlockHeaderInput target,
        uint64 summaryIndex,
        bytes32[] historicalBranch,
        ExecutionPayloadHeader eph,
        bytes32[] executionBranch
    ) external returns (uint256) {
        _verifySyncAndFinality(headers, sync);
        require(target.slot <= headers.finalizedSlot, "EthLightClient: target not finalized");

        bytes32 targetBeaconRoot = SSZHashTree.hashTreeRootBeaconHeader(
            target.slot, target.proposerIndex,
            target.parentRoot, target.stateRoot, target.bodyRoot
        );
        // Composite gindex (Electra+):
        //   bits [0..12]   slot mod 8192   (depth-13 inner block_roots vector)
        //   bit  [13]      0               (block_summary_root is field 0 in HistoricalSummary)
        //   bits [14..37]  summaryIndex    (depth-24 list-data tree)
        //   bit  [38]      0               (data side of the List, vs length)
        //   bits [39..44]  27              (historical_summaries field in BeaconState container)
        // = (1 << 45) | (27 << 39) | (summaryIndex << 14) | (slot mod 8192).
        //
        // We store `historicalSummariesContainerGindex` = (1<<6)|27 = 91
        // for Electra+; shift by (1+24+1+13)=39 to position it.
        uint256 hsIndex = (historicalSummariesContainerGindex << 39)
                        | (uint256(summaryIndex) << 14)
                        | (uint256(target.slot) % uint256(8192));
        require(
            SSZHashTree.verifyMerkleBranch(
                targetBeaconRoot, historicalBranch, hsIndex, headers.attestedStateRoot
            ),
            "EthLightClient: historical_summaries proof failed"
        );

        return _verifyAndAnchor(target.slot, target.bodyRoot, eph, executionBranch);
    }

    // ─────────────────────────────────────────────────────────────────
    // Shared prelude / postlude for the three anchor entrypoints
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Verify the sync-committee BLS aggregate over the attested
     *      header and the finality branch tying the finalized header
     *      to attested.state_root. Reverts on any verification failure.
     *      Same logic the original {anchorBlockHeader} ran inline; the
     *      three entrypoints share it.
     */
    function _verifySyncAndFinality(
        AnchorHeaders headers,
        SyncAggregateInput sync
    ) private view {
        // 8192 = SLOTS_PER_EPOCH (32) × EPOCHS_PER_SYNC_COMMITTEE_PERIOD (256).
        uint64 period = sync.signatureSlot / uint64(8192);
        require(committeePubkeys[period].length == 512, "EthLightClient: no committee for this period");

        // Re-flatten the chunked struct fields. The chunked layout is a
        // JSON-RPC ABI workaround (see SyncAggregateInput comment);
        // BLSVerify is unchanged and still consumes flat `bytes`.
        bytes participationBitsBytes = _chunks2ToBytes(sync.participationBits);
        bytes signatureBytes         = _chunks3ToBytes(sync.signature);

        // Count first, so an under-participating update is rejected before
        // paying for any curve arithmetic.
        uint256 participantCount = BLSVerify.popcount(participationBitsBytes);
        require(participantCount >= MIN_PARTICIPATION, "EthLightClient: below 2/3 sync committee participation");

        bytes computedAggPk = _aggregateFor(period, participationBitsBytes, participantCount);

        bytes32 signingRoot = SSZHashTree.computeSigningRoot(
            SSZHashTree.hashTreeRootBeaconHeader(
                headers.attestedSlot, headers.attestedProposerIndex,
                headers.attestedParentRoot, headers.attestedStateRoot, headers.attestedBodyRoot
            ),
            SSZHashTree.computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot)
        );
        require(
            BLSVerify.verifySyncCommitteeAggregateG1(computedAggPk, signingRoot, signatureBytes),
            "EthLightClient: BLS verify failed"
        );

        bytes32 finalizedRoot = SSZHashTree.hashTreeRootBeaconHeader(
            headers.finalizedSlot, headers.finalizedProposerIndex,
            headers.finalizedParentRoot, headers.finalizedStateRoot, headers.finalizedBodyRoot
        );
        require(
            SSZHashTree.verifyMerkleBranch(
                finalizedRoot, headers.finalityBranch, finalizedRootIndex, headers.attestedStateRoot
            ),
            "EthLightClient: finality branch verify failed"
        );
    }

    /**
     * @notice Point the light client at a verifier for subset-aggregate
     *         proofs. Unset (or set to zero) leaves only the native path.
     */
    function setAggregateVerifier(address v) external onlyOwner {
        aggregateVerifier = v;
        emit AggregateVerifierSet(v);
    }

    // ─────────────────────────────────────────────────────────────────
    // Committee commitment
    // ─────────────────────────────────────────────────────────────────

    /// @dev Big-endian byte range of `blob` as an integer.
    function _beUint(bytes blob, uint256 start, uint256 len) private pure returns (uint256 v) {
        v = 0;
        for (uint256 i = 0; i < len; i = i + 1) {
            v = v * 256 + uint256(uint8(blob[start + i]));
        }
    }

    /**
     * @notice Absorb up to `count` more committee members into `period`'s
     *         commitment, resuming wherever the last call stopped.
     *
     * @dev Chunked because it costs a decompression per member -- 512 of
     *      them is several times a transaction's gas budget. The digest is a
     *      Merkle-Damgard fold over poseidon2Compress, and SolidVM's
     *      `poseidon2(x...)` is the same fold from a zero IV, so absorbing in
     *      chunks and hashing in one call agree by construction. That
     *      equivalence is asserted in tests/General/poseidon2Interop.test.sol.
     *
     *      Permissionless: it reads only committee data already anchored, and
     *      the digest is fully determined by it. The worst a caller can do is
     *      pay for progress someone else wanted.
     *
     * @param period Sync-committee period to build the commitment for.
     * @param count  How many members to absorb in this call. Callers size this
     *               to the gas budget; ~60 fits a 400,000-gas transaction.
     */
    function buildCommitteeCommitment(uint64 period, uint256 count) external {
        require(committeePubkeys[period].length == 512, "EthLightClient: no committee for this period");
        require(committeeCommitment[period] == 0, "EthLightClient: commitment already built");
        require(count > 0, "EthLightClient: zero count");

        uint256 i = commitmentBuild[period].next;
        uint256 state = commitmentBuild[period].state;
        uint256 end = i + count;
        if (end > 512) end = 512;

        while (i < end) {
            // 128-byte EIP-2537 G1: X at [16,64), Y at [80,128), each a
            // 48-byte big-endian value behind 16 bytes of zero padding.
            bytes p = bls12381DecompressG1(committeePubkeys[period][i]);
            // The circuit packs each coordinate's six 64-bit limbs into two
            // 192-bit halves, so the low half is the coordinate's last 24
            // bytes and the high half its first 24.
            state = poseidon2Compress(state, _beUint(p, 40, 24));   // x low
            state = poseidon2Compress(state, _beUint(p, 16, 24));   // x high
            state = poseidon2Compress(state, _beUint(p, 104, 24));  // y low
            state = poseidon2Compress(state, _beUint(p, 80, 24));   // y high
            i = i + 1;
        }

        commitmentBuild[period].state = state;
        commitmentBuild[period].next = i;

        if (i == 512) {
            committeeCommitment[period] = state;
            emit CommitteeCommitmentSet(period, state);
        } else {
            emit CommitteeCommitmentProgress(period, i);
        }
    }

    /**
     * @notice Install a period's committee commitment directly, skipping the
     *         chunked build.
     *
     * @dev Same footing as {bootstrap} and {setCommitteeAggregate}: a
     *      bootstrapped committee is admin-supplied to begin with, so
     *      admin-supplying its digest adds no trust. It also saves the ~9
     *      transactions {buildCommitteeCommitment} would take.
     *
     *      A wrong commitment cannot forge anything. It makes every proof
     *      against that period fail to verify, because the prover's committee
     *      would not hash to it. The failure mode is a period that cannot use
     *      the proof path, which falls back to native aggregation.
     */
    function setCommitteeCommitment(uint64 period, uint256 commitment) external onlyOwner {
        require(committeePubkeys[period].length == 512, "EthLightClient: no committee for this period");
        require(commitment != 0, "EthLightClient: zero commitment");
        committeeCommitment[period] = commitment;
        emit CommitteeCommitmentSet(period, commitment);
    }

    // ─────────────────────────────────────────────────────────────────
    // Subset-aggregate proofs
    // ─────────────────────────────────────────────────────────────────

    /// @dev Key under which a proven aggregate is cached.
    function _aggKey(uint64 period, bytes participationBits) private pure returns (bytes32) {
        return bytes32(keccak256(bytes(bytes32(uint256(period))) + participationBits));
    }

    /**
     * @dev The circuit's public inputs, in gnark's witness order: the
     *      participation bitfield packed 128 bits to a word (least
     *      significant bit first), then the claimed aggregate's X and Y as
     *      six 64-bit little-endian limbs each, then the committee
     *      commitment. Seventeen in total.
     */
    function _aggregatePublicInputs(
        bytes participationBits,
        bytes claimedAggregate,
        uint256 commitment
    ) private pure returns (uint256[]) {
        uint256[] memory pi = new uint256[](17);

        // The bitfield is little-endian by byte and by bit within a byte, so
        // word w covers bytes [16w, 16w+16) with byte 16w least significant.
        for (uint256 w = 0; w < 4; w = w + 1) {
            uint256 acc = 0;
            for (uint256 b = 0; b < 16; b = b + 1) {
                acc = acc + uint256(uint8(participationBits[w * 16 + b])) * (256 ** b);
            }
            pi[w] = acc;
        }

        // Limb k of a coordinate is its bytes [end-8(k+1), end-8k).
        for (uint256 k = 0; k < 6; k = k + 1) {
            pi[4 + k] = _beUint(claimedAggregate, 64 - 8 * (k + 1), 8);
            pi[10 + k] = _beUint(claimedAggregate, 128 - 8 * (k + 1), 8);
        }

        pi[16] = commitment;
        return pi;
    }

    /**
     * @notice Verify a proof that `claimedAggregate` is the sum of the
     *         committee members `participationBits` selects, and cache it for
     *         a subsequent anchor.
     *
     * @dev Kept separate from anchoring so the three anchor entry points keep
     *      their signatures; the two travel as one signed batch anyway. The
     *      cache is safe to leave permissionless because an entry can only be
     *      written against a verifying proof, and a wrong aggregate cannot be
     *      proven.
     */
    function submitAggregateProof(
        uint64 period,
        bytes32[2] participationBits,
        bytes claimedAggregate,
        uint256[] proof
    ) external {
        require(aggregateVerifier != address(0), "EthLightClient: no aggregate verifier");
        uint256 commitment = committeeCommitment[period];
        require(commitment != 0, "EthLightClient: no committee commitment for period");
        require(claimedAggregate.length == 128, "EthLightClient: aggregate must be 128 bytes");

        bytes bits = _chunks2ToBytes(participationBits);
        require(
            PlonkVerifier(aggregateVerifier).verifyProof(
                proof, _aggregatePublicInputs(bits, claimedAggregate, commitment)
            ),
            "EthLightClient: aggregate proof rejected"
        );

        bytes32 key = _aggKey(period, bits);
        verifiedAggregate[key] = claimedAggregate;
        emit AggregateProven(period, key);
    }

    /**
     * @dev Build the participating-subset aggregate by whichever route
     *      touches fewer points: summing the signers, or subtracting the
     *      non-signers from the committee's full aggregate.
     *
     *      Above 50% participation the second route is always the shorter
     *      one, and the two are arithmetically identical — see
     *      {BLSVerify.aggregateByAbsence}. Falls back to summing when the
     *      period has no aggregate installed, so a bootstrapped committee
     *      still verifies (expensively) until {setCommitteeAggregate}
     *      runs.
     */
    function _aggregateFor(
        uint64 period,
        bytes participationBits,
        uint256 participantCount
    ) private view returns (bytes) {
        // A proof, if one was submitted for exactly this committee and
        // bitfield, replaces the aggregation entirely.
        bytes proven = verifiedAggregate[_aggKey(period, participationBits)];
        if (proven.length == 128) {
            return proven;
        }

        bytes full = committeeAggregate[period];
        if (full.length == 128 && (512 - participantCount) < participantCount) {
            (bytes byAbsence, /* count */) = BLSVerify.aggregateByAbsence(
                committeePubkeys[period], participationBits, full
            );
            return byAbsence;
        }
        (bytes bySum, /* count */) = BLSVerify.aggregateParticipants(
            committeePubkeys[period], participationBits
        );
        return bySum;
    }

    /**
     * @dev Verify the EPH against `targetBodyRoot` via executionBranch,
     *      then anchor (blockNumber, receiptsRoot, stateRoot, beaconSlot,
     *      timestamp) and emit. Returns the anchored block number.
     */
    function _verifyAndAnchor(
        uint64 targetSlot,
        bytes32 targetBodyRoot,
        ExecutionPayloadHeader eph,
        bytes32[] executionBranch
    ) private returns (uint256) {
        bytes32 ephRoot = SSZHashTree.hashTreeRootEPH(eph);
        require(
            SSZHashTree.verifyMerkleBranch(
                ephRoot, executionBranch, executionPayloadIndex, targetBodyRoot
            ),
            "EthLightClient: execution branch verify failed"
        );

        uint256 blockNumber = uint256(eph.blockNumber);
        anchored[blockNumber] = AnchoredHeader({
            blockNumber: blockNumber,
            receiptsRoot: eph.receiptsRoot,
            stateRoot: eph.stateRoot,
            beaconSlot: targetSlot,
            timestamp: eph.timestamp
        });

        emit HeaderAnchored(blockNumber, eph.receiptsRoot, targetSlot, eph.timestamp);
        return blockNumber;
    }

    // ─────────────────────────────────────────────────────────────────
    // Permissionless: advance the sync-committee chain by one period
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor the next sync committee using a
     *         LightClientUpdate signed by the current committee.
     *
     *         Caller is permissionless: any actor (relayer, user
     *         about to claim a deposit, an LP about to advance funds)
     *         can pay the gas to advance the chain. The verification
     *         binds the new committee to the prior one via:
     *
     *           1. Sync sig from period(signatureSlot)'s committee.
     *           2. hash_tree_root(nextCommittee) computed on-chain.
     *           3. Merkle branch from that root to attested.state_root.
     *
     *         Idempotent: if period(attestedSlot) + 1 is already
     *         anchored, the call is a no-op (so two callers racing
     *         to advance don't trip each other up).
     *
     * @return newPeriod the period now anchored (= attestedSlot's
     *         period + 1). Returned as 0 in the idempotent no-op case.
     */
    function advanceCommittee(PeriodTransition update) external returns (uint64 newPeriod) {
        // ─── 1. Look up the current committee for the signing slot ──
        uint64 signaturePeriod = update.signatureSlot / uint64(8192);
        uint64 attestedPeriod = update.attestedSlot / uint64(8192);
        // The light-client spec requires signature_slot to be in the
        // same period as the attested header for non-finality updates
        // (otherwise the signing committee wouldn't match the chain
        // being attested). Enforce here.
        require(signaturePeriod == attestedPeriod, "EthLightClient: signature period != attested period");
        require(committeePubkeys[signaturePeriod].length == 512, "EthLightClient: no committee for signing period");

        newPeriod = attestedPeriod + 1;
        if (committeePubkeys[newPeriod].length == 512) {
            // Already anchored; nothing more to do. Idempotent for racing callers.
            return uint64(0);
        }
        require(update.nextPubkeys.length == 512, "EthLightClient: expected 512 next pubkeys");
        // nextAggregatePubkey is `bytes32[2]` (always 64 bytes by ABI),
        // so the prior length-48 check is no longer meaningful — the
        // SSZ root verification below enforces canonical layout.

        // Re-flatten the chunked struct fields. See SyncAggregateInput
        // comment for the JSON-RPC ABI rationale.
        bytes participationBitsBytes = _chunks2ToBytes(update.participationBits);
        bytes signatureBytes         = _chunks3ToBytes(update.signature);

        // ─── 2. Verify BLS signature from the current committee ────
        uint256 signerCount = BLSVerify.popcount(participationBitsBytes);
        require(
            signerCount >= MIN_PARTICIPATION,
            "EthLightClient: below 2/3 sync committee participation"
        );
        bytes computedAggPk = _aggregateFor(signaturePeriod, participationBitsBytes, signerCount);

        bytes32 signingRoot = SSZHashTree.computeSigningRoot(
            SSZHashTree.hashTreeRootBeaconHeader(
                update.attestedSlot, update.attestedProposerIndex,
                update.attestedParentRoot, update.attestedStateRoot, update.attestedBodyRoot
            ),
            SSZHashTree.computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot)
        );
        require(
            BLSVerify.verifySyncCommitteeAggregateG1(computedAggPk, signingRoot, signatureBytes),
            "EthLightClient: BLS verify failed"
        );

        // ─── 3. Verify nextSyncCommitteeBranch ─────────────────────
        bytes32 committeeRoot = SSZHashTree.hashTreeRootSyncCommittee(
            update.nextPubkeys, update.nextAggregatePubkey
        );
        require(
            SSZHashTree.verifyMerkleBranch(
                committeeRoot, update.nextBranch, nextSyncCommitteeIndex, update.attestedStateRoot
            ),
            "EthLightClient: next-committee branch verify failed"
        );

        // ─── 4. Anchor the next period's pubkeys ───────────────────
        committeePubkeys[newPeriod] = update.nextPubkeys;
        // The aggregate was just verified as part of committeeRoot above,
        // so it carries the same guarantee as the pubkeys. Keeping it is
        // what lets the next period anchor by absentee subtraction.
        committeeAggregate[newPeriod] = bls12381DecompressG1(
            _first48(_chunks2ToBytes(update.nextAggregatePubkey))
        );
        if (newPeriod > latestPeriod) latestPeriod = newPeriod;
        emit CommitteeAnchored(newPeriod);
        emit CommitteeAggregateSet(newPeriod);
        return newPeriod;
    }

    // ─────────────────────────────────────────────────────────────────
    // Read accessors
    // ─────────────────────────────────────────────────────────────────

    /// True iff this block number has a verified receiptsRoot anchor.
    /// We check the stored `blockNumber` field rather than receiptsRoot
    /// because mapping struct defaults can compare unexpectedly to
    /// bytes32(0) in SolidVM; the uint256 default of 0 is reliably
    /// distinguishable from any real anchored block number ≥ 1.
    function isAnchored(uint256 blockNumber) external view override returns (bool) {
        return anchored[blockNumber].blockNumber != 0;
    }

    /// Read the verified receipts root for a block. Returns bytes32(0)
    /// for un-anchored block numbers; callers should check isAnchored
    /// first or treat the zero return as "not yet verified".
    function getReceiptsRoot(uint256 blockNumber) external view override returns (bytes32) {
        return anchored[blockNumber].receiptsRoot;
    }

    /// Read the verified L1 state root for a block. Used by L1-state-anchored
    /// flows (Base/Cannon dispute-game proofs, Linea finalization-storage
    /// proofs, etc.). Returns bytes32(0) for un-anchored block numbers.
    function getStateRoot(uint256 blockNumber) external view returns (bytes32) {
        return anchored[blockNumber].stateRoot;
    }

    /// Number of validators in the period's sync committee.
    /// Returns 0 if there's no committee for the period.
    function committeeSize(uint64 period) external view returns (uint256) {
        return committeePubkeys[period].length;
    }

    /// Compute which sync-committee period a beacon slot belongs to.
    /// period = slot / (SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD).
    /// Exposed for off-chain tooling and tests.
    function periodOfSlot(uint64 slot) external pure returns (uint64) {
        return slot / uint64(8192);
    }

    // ─────────────────────────────────────────────────────────────────
    // Chunked-field flatteners
    //
    // These rebuild the flat-bytes form expected by BLSVerify from the
    // chunked layout we receive over JSON-RPC. The layout transformation
    // is a SolidVM ABI workaround (see SyncAggregateInput comment) —
    // BLSVerify itself is unchanged.
    //
    // `bytes(bytes32)` is a value cast (no copy); `+` does the actual
    // concatenation. Total work per call is one allocation + one copy
    // of the underlying bytes — much cheaper than an N-byte loop.
    // ─────────────────────────────────────────────────────────────────

    /// Concatenate `bytes32[2]` (64 bytes) into a flat `bytes`.
    function _chunks2ToBytes(bytes32[2] xs) private pure returns (bytes) {
        return bytes(xs[0]) + bytes(xs[1]);
    }

    /// Take the leading 48 bytes of a blob. `aggregate_pubkey` arrives as
    /// `bytes32[2]` because SSZ right-pads the 48-byte key to 64; the pad
    /// must be dropped before decompression.
    function _first48(bytes blob) private pure returns (bytes out) {
        require(blob.length >= 48, "EthLightClient: blob shorter than 48 bytes");
        out = new bytes(48);
        for (uint i = 0; i < 48; i = i + 1) {
            out[i] = blob[i];
        }
    }

    /// Concatenate `bytes32[3]` (96 bytes) into a flat `bytes`.
    function _chunks3ToBytes(bytes32[3] xs) private pure returns (bytes) {
        return bytes(xs[0]) + bytes(xs[1]) + bytes(xs[2]);
    }
}
