import "../../libraries/Bridge/BLSVerify.sol";
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
    bytes  participationBits;   // 64 bytes (SSZ Bitvector[512])
    bytes  signature;           // 96 bytes IETF compressed G2
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
    // sync aggregate
    bytes  participationBits;
    bytes  signature;
    uint64 signatureSlot;
    // next_sync_committee
    bytes[]   nextPubkeys;          // 512 × 48 bytes IETF compressed
    bytes     nextAggregatePubkey;  // 48 bytes IETF compressed (used only to verify the SSZ root)
    bytes32[] nextBranch;           // proves committee SSZ root from attestedStateRoot
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

    /// Sync committees keyed by period (= slot / 8192). Stored as a
    /// single bytes[] mapping (not a struct-of-fields) — SolidVM's
    /// storage layout for nested dynamic types can cross-pollute reads
    /// in subtle ways, so we keep this as flat as possible.
    mapping(uint64 => bytes[]) committeePubkeys;
    uint64 public latestPeriod;

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
    event CommitteeAnchored(uint64 period);
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
        // ─── 1. Sync committee BLS verification ───────────────────
        // 8192 = SLOTS_PER_EPOCH (32) * EPOCHS_PER_SYNC_COMMITTEE_PERIOD (256).
        // Inlined here because SolidVM constant-folds literals more
        // reliably than uint64*uint64 multiplications.
        uint64 period = sync.signatureSlot / uint64(8192);
        require(committeePubkeys[period].length == 512, "EthLightClient: no committee for this period");

        // Aggregate the participating pubkeys from the pinned committee
        // — this is the soundness anchor. The popcount check inside
        // aggregateParticipants would already revert on zero participants;
        // here we additionally require ≥ ⅔ for the safety threshold.
        (bytes computedAggPk, uint256 participantCount) = BLSVerify.aggregateParticipants(
            committeePubkeys[period],
            sync.participationBits
        );
        require(participantCount >= MIN_PARTICIPATION, "EthLightClient: below 2/3 sync committee participation");

        bytes32 signingRoot = SSZHashTree.computeSigningRoot(
            SSZHashTree.hashTreeRootBeaconHeader(
                headers.attestedSlot, headers.attestedProposerIndex,
                headers.attestedParentRoot, headers.attestedStateRoot, headers.attestedBodyRoot
            ),
            SSZHashTree.computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot)
        );
        require(
            // computedAggPk comes back already in 128-byte EIP-2537 form,
            // so use the G1-input variant rather than re-compressing it.
            BLSVerify.verifySyncCommitteeAggregateG1(computedAggPk, signingRoot, sync.signature),
            "EthLightClient: BLS verify failed"
        );

        // ─── 2. Finality branch ───────────────────────────────────
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

        // ─── 3. Walk parent chain to determine the anchor target ──
        //
        // If parentChain is empty, the finalizedHeader IS the target.
        // Otherwise we walk: each header's hash_tree_root must equal
        // the previous header's parent_root, starting with
        // finalizedHeader.parent_root for the very first step. The
        // last header in parentChain is the target.
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

        // ─── 4. EPH root + executionBranch (against target) ───────
        bytes32 ephRoot = SSZHashTree.hashTreeRootEPH(eph);
        require(
            SSZHashTree.verifyMerkleBranch(
                ephRoot, executionBranch, executionPayloadIndex, targetBodyRoot
            ),
            "EthLightClient: execution branch verify failed"
        );

        // ─── 5. Anchor ────────────────────────────────────────────
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
        require(update.nextAggregatePubkey.length == 48, "EthLightClient: nextAggregatePubkey must be 48 bytes");

        // ─── 2. Verify BLS signature from the current committee ────
        require(
            BLSVerify.popcount(update.participationBits) >= MIN_PARTICIPATION,
            "EthLightClient: below 2/3 sync committee participation"
        );
        (bytes computedAggPk, /* count */) = BLSVerify.aggregateParticipants(
            committeePubkeys[signaturePeriod],
            update.participationBits
        );

        bytes32 signingRoot = SSZHashTree.computeSigningRoot(
            SSZHashTree.hashTreeRootBeaconHeader(
                update.attestedSlot, update.attestedProposerIndex,
                update.attestedParentRoot, update.attestedStateRoot, update.attestedBodyRoot
            ),
            SSZHashTree.computeDomain(DOMAIN_SYNC_COMMITTEE, forkVersion, genesisValidatorsRoot)
        );
        require(
            BLSVerify.verifySyncCommitteeAggregateG1(computedAggPk, signingRoot, update.signature),
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
        if (newPeriod > latestPeriod) latestPeriod = newPeriod;
        emit CommitteeAnchored(newPeriod);
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
}
