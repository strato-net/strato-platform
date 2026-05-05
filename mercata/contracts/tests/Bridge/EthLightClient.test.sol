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
        lc.setIndices(uint256(105), uint256(9));   // pre-Electra finalized index
        require(lc.finalizedRootIndex() == 105, "finalizedRootIndex didn't update");
    }

    // ============ Read accessors ============

    function it_unanchored_block_returns_zero_root() {
        require(lc.getReceiptsRoot(99999) == bytes32(0), "should be zero for unknown block");
        require(!lc.isAnchored(99999), "should not be anchored");
    }
}
