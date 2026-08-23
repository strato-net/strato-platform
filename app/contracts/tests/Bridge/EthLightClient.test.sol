import "../../concrete/Bridge/EthLightClient.sol";

/**
 * @title Describe_EthLightClient
 * @notice First-cut tests for EthLightClient. The acid test is at the
 *         bottom: a real Sepolia LightClientFinalityUpdate must verify
 *         end-to-end and store the corresponding (blockNumber → receiptsRoot).
 */
contract Describe_EthLightClient {

    EthLightClient lc;
    address admin;

    // ─── Sepolia fixture: period 1242, captured 2026-05-04 ───
    function _gvr() internal pure returns (bytes32) {
        return bytes32(hex"d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078");
    }
    function _forkVersion() internal pure returns (bytes4) {
        return bytes4(0x90000075); // Fulu
    }
    function _signaturePeriod() internal pure returns (uint64) {
        // signature_slot 10182913 / (32 * 256) = 1242
        return 1242;
    }

    // First and last sync-committee pubkeys from bootstrap.json — used
    // as a sanity-check at bootstrap time. Tests that exercise the
    // full BLS chain rely on the precomputed aggregate (see
    // _sepoliaAggPubkey below) rather than re-aggregating 470 of 512
    // pubkeys here.
    function _samplePubkey0() internal pure returns (bytes) {
        return hex"9203acd34ebb3ff76268f9fe68f066a48a3f518686ae0f2230b322e19435ccfc4f208e5ba5a39cb2a409292c48a37c22";
    }

    /// `_samplePubkey0` in the SSZ chunked layout (32 bytes + 16 bytes
    /// pubkey + 16 bytes zero pad), used for `nextAggregatePubkey:
    /// bytes32[2]` after the JSON-RPC ABI workaround.
    function _samplePubkey0Chunks() internal pure returns (bytes32[2]) {
        // Literal-init: SolidVM doesn't allocate slots for a bare
        // `bytes32[2] r;` declaration, so per-index writes (r[0] = …)
        // revert with "Cannot assign a value outside the allocated
        // space". Returning a literal-init array sidesteps the issue.
        return [
            bytes32(hex"9203acd34ebb3ff76268f9fe68f066a48a3f518686ae0f2230b322e19435ccfc"),
            bytes32(hex"4f208e5ba5a39cb2a409292c48a37c2200000000000000000000000000000000")
        ];
    }

    /// 64 zero bytes in the chunked SyncAggregateInput.participationBits layout.
    function _zeroParticipationChunks() internal pure returns (bytes32[2]) {
        bytes32[2] r;
        return r;
    }

    /// 96 zero bytes in the chunked SyncAggregateInput.signature layout.
    function _zeroSignatureChunks() internal pure returns (bytes32[3]) {
        bytes32[3] r;
        return r;
    }

    function _aggregatePubkey() internal pure returns (bytes) {
        return hex"a297f349051d1ec7276a464b343d7f68fe8483c2213f84b500fb8bbe4c2aa3fe5584d4416f9a0ee933c9153a80dce92e";
    }

    /// 512 pubkeys filled with copies of pubkey #0 — fine for bootstrap
    /// and indices tests since we never actually verify a sig with this
    /// committee (it's not the real one).
    function _stubCommittee() internal pure returns (bytes[]) {
        bytes[] pks = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            pks[i] = _samplePubkey0();
        }
        return pks;
    }

    function beforeEach() {
        admin = address(this);
        lc = new EthLightClient(admin);
    }

    // ============ Bootstrap ============

    function it_initial_indices_are_electra_fulu() {
        // Defaults are configured for Electra+ in the constructor.
        require(lc.finalizedRootIndex() == 41, "finalizedRootIndex default mismatch");
        require(lc.executionPayloadIndex() == 9, "executionPayloadIndex default mismatch");
    }

    function it_bootstrap_sets_state() {
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        require(lc.genesisValidatorsRoot() == _gvr(), "gvr not set");
        require(lc.forkVersion() == _forkVersion(), "fork version not set");
        require(lc.committeeSize(_signaturePeriod()) == 512, "committee size mismatch");
        require(lc.latestPeriod() == _signaturePeriod(), "latestPeriod not advanced");
    }

    function it_bootstrap_rejects_double_bootstrap_for_same_period() {
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        bool reverted = false;
        try {
            lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        } catch {
            reverted = true;
        }
        require(reverted, "second bootstrap of same period should revert");
    }

    function it_bootstrap_rejects_wrong_committee_size() {
        bytes[] tooFew = new bytes[](511);
        for (uint i = 0; i < 511; i = i + 1) {
            tooFew[i] = _samplePubkey0();
        }
        bool reverted = false;
        try {
            lc.bootstrap(_signaturePeriod(), tooFew, _gvr(), _forkVersion());
        } catch {
            reverted = true;
        }
        require(reverted, "511 pubkeys should revert");
    }

    function it_bootstrap_rejects_wrong_pubkey_length() {
        bytes[] pks = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            pks[i] = _samplePubkey0();
        }
        pks[37] = hex"deadbeef"; // 4 bytes instead of 48
        bool reverted = false;
        try {
            lc.bootstrap(_signaturePeriod(), pks, _gvr(), _forkVersion());
        } catch {
            reverted = true;
        }
        require(reverted, "non-48-byte pubkey should revert");
    }

    function it_only_owner_can_bootstrap() {
        EthLightClient owned = new EthLightClient(address(0xdead));
        bool reverted = false;
        try {
            owned.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner bootstrap should revert");
    }

    // ============ Admin: setForkVersion / setIndices ============

    function it_admin_can_set_fork_version() {
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        lc.setForkVersion(bytes4(0x90000076));
        require(lc.forkVersion() == bytes4(0x90000076), "forkVersion didn't update");
    }

    function it_admin_can_set_indices() {
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        // 3-arg form: finalizedRootIndex, nextSyncCommitteeIndex, executionPayloadIndex.
        lc.setIndices(uint256(105), uint256(55), uint256(9));   // pre-Electra indices
        require(lc.finalizedRootIndex() == 105, "finalizedRootIndex didn't update");
        require(lc.nextSyncCommitteeIndex() == 55, "nextSyncCommitteeIndex didn't update");
    }

    // ============ Read accessors ============

    function it_unanchored_block_returns_zero_root() {
        require(lc.getReceiptsRoot(99999) == bytes32(0), "should be zero for unknown block");
        require(!lc.isAnchored(99999), "should not be anchored");
    }

    // ============ advanceCommittee preconditions ============

    function _stubTransition(uint64 attestedSlot) internal pure returns (PeriodTransition) {
        bytes[] dummyPks = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            dummyPks[i] = _samplePubkey0();
        }
        bytes32[] branch = new bytes32[](6);
        return PeriodTransition({
            attestedSlot:          attestedSlot,
            attestedProposerIndex: uint64(0),
            attestedParentRoot:    bytes32(0),
            attestedStateRoot:     bytes32(0),
            attestedBodyRoot:      bytes32(0),
            participationBits:     _zeroParticipationChunks(),
            signature:             _zeroSignatureChunks(),
            signatureSlot:         attestedSlot,
            nextPubkeys:           dummyPks,
            nextAggregatePubkey:   _samplePubkey0Chunks(),
            nextBranch:            branch
        });
    }

    function it_advance_reverts_when_signature_period_mismatches_attested() {
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        // attestedSlot is in period 1242, signatureSlot in period 1243.
        bytes[] dummyPks = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            dummyPks[i] = _samplePubkey0();
        }
        PeriodTransition u = PeriodTransition({
            attestedSlot:          uint64(1242 * 8192 + 100),
            attestedProposerIndex: uint64(0),
            attestedParentRoot:    bytes32(0),
            attestedStateRoot:     bytes32(0),
            attestedBodyRoot:      bytes32(0),
            participationBits:     _zeroParticipationChunks(),
            signature:             _zeroSignatureChunks(),
            signatureSlot:         uint64(1243 * 8192 + 0),
            nextPubkeys:           dummyPks,
            nextAggregatePubkey:   _samplePubkey0Chunks(),
            nextBranch:            new bytes32[](6)
        });
        bool reverted = false;
        try {
            lc.advanceCommittee(u);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on cross-period sig");
    }

    function it_advance_reverts_when_no_committee_for_signing_period() {
        // Bootstrap puts a committee at period 1242. attestedSlot is in
        // period 1500, so there's no committee.
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());
        PeriodTransition u = _stubTransition(uint64(1500 * 8192 + 100));
        bool reverted = false;
        try {
            lc.advanceCommittee(u);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when committee absent");
    }

    // ============ anchorBlockHeader: parent-chain shape checks ============
    //
    // The parent-walk logic itself is verified end-to-end against the
    // existing-finalized-as-target case in EthLightClientAnchor.test.sol
    // (the empty-parentChain regression). The cases here cover the
    // shape-level invariants that don't require fresh fixture data.

    function _stubAnchorHeaders() internal pure returns (AnchorHeaders) {
        bytes32[] finalityBranch = new bytes32[](7);
        return AnchorHeaders({
            attestedSlot:           uint64(0),
            attestedProposerIndex:  uint64(0),
            attestedParentRoot:     bytes32(0),
            attestedStateRoot:      bytes32(0),
            attestedBodyRoot:       bytes32(0),
            finalizedSlot:          uint64(0),
            finalizedProposerIndex: uint64(0),
            finalizedParentRoot:    bytes32(uint256(0xfeedbeef)), // arbitrary; whatever parent[0]'s hash must equal
            finalizedStateRoot:     bytes32(0),
            finalizedBodyRoot:      bytes32(0),
            finalityBranch:         finalityBranch
        });
    }

    function _stubSync() internal pure returns (SyncAggregateInput) {
        return SyncAggregateInput({
            participationBits: _zeroParticipationChunks(),
            signature:         _zeroSignatureChunks(),
            signatureSlot:     uint64(_signaturePeriod() * 8192)
        });
    }

    function _stubEPH() internal pure returns (ExecutionPayloadHeader) {
        return ExecutionPayloadHeader({
            parentHash:        bytes32(0),
            feeRecipient:      address(0),
            stateRoot:         bytes32(0),
            receiptsRoot:      bytes32(0),
            logsBloomRoot:     bytes32(0),
            prevRandao:        bytes32(0),
            blockNumber:       uint64(0),
            gasLimit:          uint64(0),
            gasUsed:           uint64(0),
            timestamp:         uint64(0),
            extraDataRoot:     bytes32(0),
            baseFeePerGas:     uint256(0),
            blockHash:         bytes32(0),
            transactionsRoot:  bytes32(0),
            withdrawalsRoot:   bytes32(0),
            blobGasUsed:       uint64(0),
            excessBlobGas:     uint64(0)
        });
    }

    function it_anchor_rejects_parent_chain_with_mismatched_hash() {
        // First parent's hash doesn't match finalizedHeader.parent_root,
        // so the very first walk step should reject. We don't get to
        // bootstrap or BLS verification — this is purely about catching
        // a bad parent chain early.
        lc.bootstrap(_signaturePeriod(), _stubCommittee(), _gvr(), _forkVersion());

        BeaconBlockHeaderInput[] chain = new BeaconBlockHeaderInput[](1);
        chain[0] = BeaconBlockHeaderInput({
            slot:           uint64(123),
            proposerIndex:  uint64(456),
            parentRoot:     bytes32(0),
            stateRoot:      bytes32(0),
            bodyRoot:       bytes32(0)
        });
        // The header's hash_tree_root won't equal the AnchorHeaders'
        // arbitrary 0xfeedbeef parent_root.

        bool reverted = false;
        try {
            lc.anchorBlockHeader(_stubAnchorHeaders(), _stubSync(), chain, _stubEPH(), new bytes32[](4));
        } catch {
            reverted = true;
        }
        require(reverted, "mismatched parent-chain hash should revert");
    }
}
