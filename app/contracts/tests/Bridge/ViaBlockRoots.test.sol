// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Bridge/EthLightClient.sol";
import "./EthLightClientAnchor.test.sol";
import "./BlockRootsFixture.sol";
import "./BlockRootsProofFixture.sol";
import "../../concrete/Plonk/PlonkVerifier.sol";

/// @notice Coverage for anchorBlockHeaderViaBlockRoots -- the path production
///         takes for any deposit whose beacon block is not the freshly
///         finalized one, which is most of them.
///
///         The block_roots proof is verified against the ATTESTED state root,
///         and the sync committee signs that, so this cannot reuse the real
///         Sepolia attested header: building a branch under a root you did not
///         construct is a sha256 preimage. The committee, attested header and
///         beacon state come from app/circuits/cmd/blockroots; the target is
///         the real finalized header, and its execution payload, execution
///         branch, block number and receipts root are the real ones.
///
///         Nothing about the verification is weakened by that. The contract
///         checks a real BLS aggregate over a real SSZ signing root, a real
///         7-level finality branch and a real 19-level block_roots branch --
///         only the keys behind them are ours.
contract Describe_ViaBlockRoots is Describe_EthLightClientAnchor {
    EthLightClient brc;

    function _boot() internal {
        brc = new EthLightClient(address(this));
        brc.bootstrap(
            _bootstrapPeriod(), BlockRootsFixture.committee(), _gvr(), _forkVersion()
        );
        // Without this the verifier sums 470 signers, several times the gas a
        // transaction gets.
        brc.setCommitteeAggregate(_bootstrapPeriod(), BlockRootsFixture.committeeAggregate());
    }

    function _brHeaders() internal returns (AnchorHeaders) {
        return _brHeadersFinalizedAt(uint64(10182848));
    }

    function _brHeadersFinalizedAt(uint64 finalizedSlot) internal returns (AnchorHeaders) {
        return AnchorHeaders({
            attestedSlot:           uint64(10182912),
            attestedProposerIndex:  uint64(1446),
            attestedParentRoot:     bytes32(hex"900fee03dc258712f7da869abffcd8a6858a2e1f38cd304243bfab9ec90e4d5f"),
            attestedStateRoot:      BlockRootsFixture.attestedStateRoot(),
            attestedBodyRoot:       bytes32(hex"29f9342b67f92ba2fe69832cafe1a5d384cbd0f68a4808c863a0d47636e23d49"),
            finalizedSlot:          finalizedSlot,
            finalizedProposerIndex: uint64(5),
            finalizedParentRoot:    bytes32(hex"909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7"),
            finalizedStateRoot:     bytes32(hex"e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09"),
            finalizedBodyRoot:      bytes32(hex"71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28"),
            finalityBranch:         BlockRootsFixture.finalityBranch()
        });
    }

    function _brSync() internal returns (SyncAggregateInput) {
        return SyncAggregateInput({
            participationBits: BlockRootsFixture.participationBits(),
            signature:         BlockRootsFixture.signature(),
            signatureSlot:     uint64(10182913)
        });
    }

    /// The target is the real finalized header, which is what the state's
    /// block_roots[slot mod 8192] entry commits to.
    function _target() internal returns (BeaconBlockHeaderInput) {
        return _targetAtSlot(uint64(10182848));
    }

    /// SolidVM treats the fields of a returned struct as immutable, so the
    /// variants below are built rather than edited.
    function _targetAtSlot(uint64 slot) internal returns (BeaconBlockHeaderInput) {
        return BeaconBlockHeaderInput({
            slot:          slot,
            proposerIndex: uint64(5),
            parentRoot:    bytes32(hex"909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7"),
            stateRoot:     bytes32(hex"e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09"),
            bodyRoot:      bytes32(hex"71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28")
        });
    }

    /// Sanity: the generator's target root really is the hash tree root of
    /// the header the test passes, so a mismatch shows up here rather than as
    /// an opaque branch failure.
    function it_targets_the_real_finalized_header() {
        BeaconBlockHeaderInput t = _target();
        require(
            SSZHashTree.hashTreeRootBeaconHeader(
                t.slot, t.proposerIndex, t.parentRoot, t.stateRoot, t.bodyRoot
            ) == BlockRootsFixture.targetBeaconRoot(),
            "fixture target root does not match the header"
        );
    }

    /// The happy path: 19-level block_roots proof, real signature, anchors the
    /// real execution block.
    function it_anchors_via_the_block_roots_proof() {
        _boot();
        uint256 anchored = brc.anchorBlockHeaderViaBlockRoots(
            _brHeaders(), _brSync(), _target(),
            BlockRootsFixture.blockRootsBranch(), _eph(), _executionBranch()
        );
        require(anchored == 10790533, "anchored block number mismatch");
        require(brc.isAnchored(10790533), "isAnchored should be true");
        require(
            brc.getReceiptsRoot(10790533) ==
                bytes32(hex"079d81c599aef8f01e94e08348c67147eff4d4319cea20fd488d5ed6a5fd1eaa"),
            "receiptsRoot mismatch"
        );
    }

    /// The gindex packs the container field into the high bits and the slot
    /// into the low 13; getting that wrong is the likeliest bug on this path,
    /// and it shows up as a branch that does not reach the state root.
    function it_rejects_a_branch_for_the_wrong_slot_bucket() {
        _boot();
        // Same block_roots bucket (slot mod 8192 is unchanged), different
        // slot: the branch still lands in the right place, but the leaf no
        // longer matches the header.
        bool reverted = false;
        try {
            brc.anchorBlockHeaderViaBlockRoots(
                _brHeadersFinalizedAt(uint64(10191040)), _brSync(), _targetAtSlot(uint64(10191040)),
                BlockRootsFixture.blockRootsBranch(), _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "a target at a different slot must not verify");
    }

    function it_rejects_a_tampered_block_roots_branch() {
        _boot();
        bytes32[] br = BlockRootsFixture.blockRootsBranch();
        br[0] = bytes32(uint256(br[0]) ^ 1);
        bool reverted = false;
        try {
            brc.anchorBlockHeaderViaBlockRoots(
                _brHeaders(), _brSync(), _target(), br, _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "a tampered branch must not verify");
    }

    /// Only finalized blocks may be anchored, or the light client would vouch
    /// for state the chain can still reorg.
    function it_refuses_a_target_past_the_finalized_slot() {
        _boot();
        bool reverted = false;
        try {
            brc.anchorBlockHeaderViaBlockRoots(
                _brHeadersFinalizedAt(uint64(10182847)), _brSync(), _target(),
                BlockRootsFixture.blockRootsBranch(), _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "an unfinalized target must be refused");
    }

    // ---- the same path, driven by a proof instead of on-chain aggregation ----

    /// Production anchors an older deposit through block_roots AND takes the
    /// aggregate from a proof. Neither half had covered the other until here.
    function it_anchors_via_block_roots_from_a_proven_aggregate() {
        _boot();

        PlonkVerifier v = new PlonkVerifier();
        uint256[] memory k = new uint256[](BlockRootsProofFixture.VK_WORDS);
        for (uint256 i = 0; i < BlockRootsProofFixture.VK_WORDS; i = i + 1) {
            k[i] = BlockRootsProofFixture.vkWord(i);
        }
        v.initialize(k, "bridge-sync-committee-aggregate");
        brc.setAggregateVerifier(address(v));
        brc.setCommitteeCommitment(
            _bootstrapPeriod(),
            0x092ae0caf9288970aaad9df4e9a5dac059e109c5937e6f05a1af0c1a93e83e72
        );

        uint256[] memory proof = new uint256[](BlockRootsProofFixture.PROOF_WORDS);
        for (uint256 i = 0; i < BlockRootsProofFixture.PROOF_WORDS; i = i + 1) {
            proof[i] = BlockRootsProofFixture.proofWord(i);
        }
        brc.submitAggregateProof(
            _bootstrapPeriod(), BlockRootsFixture.participationBits(),
            hex"000000000000000000000000000000000f8b005b3f52b702c8124c8d3513c78cdf5e149d5309d280984cdccd807ba1a9ae924010ceed7d182434338d675befcb00000000000000000000000000000000027aa49d7a3db09d391a9b7762344b76fc377d0ba1d29da643e091fd1f8f497be1cbc2d4cbee681fb7034b5618ec3575",
            proof
        );

        uint256 anchored = brc.anchorBlockHeaderViaBlockRoots(
            _brHeaders(), _brSync(), _target(),
            BlockRootsFixture.blockRootsBranch(), _eph(), _executionBranch()
        );
        require(anchored == 10790533, "anchored block number mismatch");
        require(
            brc.getReceiptsRoot(10790533) ==
                bytes32(hex"079d81c599aef8f01e94e08348c67147eff4d4319cea20fd488d5ed6a5fd1eaa"),
            "receiptsRoot mismatch"
        );
    }
}
