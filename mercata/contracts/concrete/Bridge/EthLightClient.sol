import "../../libraries/Bridge/BLSVerify.sol";
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
contract EthLightClient is Ownable {

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
    /// finalizedRootIndex   : leaf position of finalized_checkpoint.root in
    ///                        BeaconState. Electra+: position 41 in level 7.
    /// executionPayloadIndex: leaf position of execution_payload in
    ///                        BeaconBlockBody. Capella+: position 9 in level 4.
    uint256 public finalizedRootIndex;
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
        uint64  beaconSlot;
        uint64  timestamp;
    }
    mapping(uint256 => AnchoredHeader) public anchored;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event Bootstrapped(uint64 period, bytes32 genesisValidatorsRoot, bytes4 forkVersion);
    event ForkVersionUpdated(bytes4 oldVersion, bytes4 newVersion);
    event IndicesUpdated(uint256 finalizedRootIndex, uint256 executionPayloadIndex);
    event HeaderAnchored(uint256 blockNumber, bytes32 receiptsRoot, uint64 beaconSlot, uint64 timestamp);

    // ─────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────

    constructor(address owner_) Ownable(owner_) {
        // SSZ generalized indices for Electra/Fulu by default. Bootstrap
        // sets the rest; admin can override indices via setIndices() if
        // needed (e.g., for pre-Electra forks).
        finalizedRootIndex = 41;     // leaf position in level 7 (gindex 169 in Electra+ BeaconState)
        executionPayloadIndex = 9;   // leaf position in level 4 (gindex 25 in Capella+ BeaconBlockBody)
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
        uint256 executionPayloadIndex_
    ) external onlyOwner {
        finalizedRootIndex = finalizedRootIndex_;
        executionPayloadIndex = executionPayloadIndex_;
        emit IndicesUpdated(finalizedRootIndex_, executionPayloadIndex_);
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
     *           3. hash_tree_root(eph) is computed on-chain.
     *           4. executionBranch proves the EPH root from
     *              finalizedHeader.bodyRoot at executionPayloadIndex.
     *           5. eph.receiptsRoot and eph.blockNumber are read
     *              directly from the verified struct and stored.
     */
    function anchorBlockHeader(
        AnchorHeaders headers,
        SyncAggregateInput sync,
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

        // ─── 3. EPH root + executionBranch ────────────────────────
        bytes32 ephRoot = SSZHashTree.hashTreeRootEPH(eph);
        require(
            SSZHashTree.verifyMerkleBranch(
                ephRoot, executionBranch, executionPayloadIndex, headers.finalizedBodyRoot
            ),
            "EthLightClient: execution branch verify failed"
        );

        // ─── 4. Anchor ────────────────────────────────────────────
        uint256 blockNumber = uint256(eph.blockNumber);
        anchored[blockNumber] = AnchoredHeader({
            blockNumber: blockNumber,
            receiptsRoot: eph.receiptsRoot,
            beaconSlot: headers.finalizedSlot,
            timestamp: eph.timestamp
        });

        emit HeaderAnchored(blockNumber, eph.receiptsRoot, headers.finalizedSlot, eph.timestamp);
        return blockNumber;
    }

    // ─────────────────────────────────────────────────────────────────
    // Read accessors
    // ─────────────────────────────────────────────────────────────────

    /// True iff this block number has a verified receiptsRoot anchor.
    /// We check the stored `blockNumber` field rather than receiptsRoot
    /// because mapping struct defaults can compare unexpectedly to
    /// bytes32(0) in SolidVM; the uint256 default of 0 is reliably
    /// distinguishable from any real anchored block number ≥ 1.
    function isAnchored(uint256 blockNumber) external view returns (bool) {
        return anchored[blockNumber].blockNumber != 0;
    }

    /// Read the verified receipts root for a block. Returns bytes32(0)
    /// for un-anchored block numbers; callers should check isAnchored
    /// first or treat the zero return as "not yet verified".
    function getReceiptsRoot(uint256 blockNumber) external view returns (bytes32) {
        return anchored[blockNumber].receiptsRoot;
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
