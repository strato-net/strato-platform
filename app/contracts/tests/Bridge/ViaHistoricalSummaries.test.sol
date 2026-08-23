// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Bridge/EthLightClient.sol";
import "../../concrete/Plonk/PlonkVerifier.sol";
import "./EthLightClientAnchor.test.sol";
import "./HistoricalFixture.sol";
import "./BlockRootsProofFixture.sol";

/// @notice Coverage for anchorBlockHeaderViaHistoricalSummaries -- the path for
///         deposits older than the 8192-slot block_roots window, about 27
///         hours. Its branch is 45 levels and threads five trees:
///
///           bits [0..12]  slot mod 8192  inner block_roots vector   (13)
///           bit  [13]     0              block_summary_root         (1)
///           bits [14..37] summaryIndex   summaries List data        (24)
///           bit  [38]     0              data side of the List      (1)
///           bits [39..44] 27             field in the BeaconState   (6)
///
///         Committee, attested header and beacon state come from
///         app/circuits/cmd/historical; the branch is verified against the
///         attested state root, which the committee signs, so it has to be a
///         state we built. The target is the real finalized header, and its
///         execution payload, execution branch, block number and receipts root
///         are the real ones.
contract Describe_ViaHistoricalSummaries is Describe_EthLightClientAnchor {
    EthLightClient hc;

    function _boot() internal {
        hc = new EthLightClient(address(this));
        hc.bootstrap(_bootstrapPeriod(), HistoricalFixture.committee(), _gvr(), _forkVersion());
        // Otherwise the verifier sums 470 signers, several times a
        // transaction's gas.
        hc.setCommitteeAggregate(_bootstrapPeriod(), HistoricalFixture.committeeAggregate());
    }

    function _hcHeaders() internal returns (AnchorHeaders) {
        return _hcHeadersFinalizedAt(uint64(10182848));
    }

    /// SolidVM treats the fields of a returned struct as immutable, so the
    /// variants are built rather than edited.
    function _hcHeadersFinalizedAt(uint64 finalizedSlot) internal returns (AnchorHeaders) {
        return AnchorHeaders({
            attestedSlot:           uint64(10182912),
            attestedProposerIndex:  uint64(1446),
            attestedParentRoot:     bytes32(hex"900fee03dc258712f7da869abffcd8a6858a2e1f38cd304243bfab9ec90e4d5f"),
            attestedStateRoot:      HistoricalFixture.attestedStateRoot(),
            attestedBodyRoot:       bytes32(hex"29f9342b67f92ba2fe69832cafe1a5d384cbd0f68a4808c863a0d47636e23d49"),
            finalizedSlot:          finalizedSlot,
            finalizedProposerIndex: uint64(5),
            finalizedParentRoot:    bytes32(hex"909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7"),
            finalizedStateRoot:     bytes32(hex"e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09"),
            finalizedBodyRoot:      bytes32(hex"71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28"),
            finalityBranch:         HistoricalFixture.finalityBranch()
        });
    }

    function _hcSync() internal returns (SyncAggregateInput) {
        return SyncAggregateInput({
            participationBits: HistoricalFixture.participationBits(),
            signature:         HistoricalFixture.signature(),
            signatureSlot:     uint64(10182913)
        });
    }

    function _target() internal returns (BeaconBlockHeaderInput) {
        return BeaconBlockHeaderInput({
            slot:          uint64(10182848),
            proposerIndex: uint64(5),
            parentRoot:    bytes32(hex"909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7"),
            stateRoot:     bytes32(hex"e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09"),
            bodyRoot:      bytes32(hex"71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28")
        });
    }

    function it_uses_a_forty_five_level_branch() {
        require(HistoricalFixture.historicalBranch().length == 45, "branch should be 45 levels");
    }

    function it_anchors_via_the_historical_summaries_proof() {
        _boot();
        uint256 anchored = hc.anchorBlockHeaderViaHistoricalSummaries(
            _hcHeaders(), _hcSync(), _target(), HistoricalFixture.summaryIndex(),
            HistoricalFixture.historicalBranch(), _eph(), _executionBranch()
        );
        require(anchored == 10790533, "anchored block number mismatch");
        require(hc.isAnchored(10790533), "isAnchored should be true");
        require(
            hc.getReceiptsRoot(10790533) ==
                bytes32(hex"079d81c599aef8f01e94e08348c67147eff4d4319cea20fd488d5ed6a5fd1eaa"),
            "receiptsRoot mismatch"
        );
    }

    /// The summary index occupies bits 14..37 of the composite gindex. Nothing
    /// on-chain cross-checks it against the slot -- a wrong one simply fails to
    /// reach the state root, and that is the guarantee worth pinning.
    function it_rejects_a_wrong_summary_index() {
        _boot();
        bool reverted = false;
        try {
            hc.anchorBlockHeaderViaHistoricalSummaries(
                _hcHeaders(), _hcSync(), _target(), HistoricalFixture.summaryIndex() + 1,
                HistoricalFixture.historicalBranch(), _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "a wrong summary index must not verify");
    }

    /// A branch element from deep inside the List tree: the levels above the
    /// summary are the easiest to get wrong and the least likely to be
    /// exercised by a shallower proof.
    function it_rejects_a_tampered_list_level() {
        _boot();
        bytes32[] br = HistoricalFixture.historicalBranch();
        br[30] = bytes32(uint256(br[30]) ^ 1);
        bool reverted = false;
        try {
            hc.anchorBlockHeaderViaHistoricalSummaries(
                _hcHeaders(), _hcSync(), _target(), HistoricalFixture.summaryIndex(),
                br, _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "a tampered branch must not verify");
    }

    function it_refuses_a_target_past_the_finalized_slot() {
        _boot();
        bool reverted = false;
        try {
            hc.anchorBlockHeaderViaHistoricalSummaries(
                _hcHeadersFinalizedAt(uint64(10182847)), _hcSync(), _target(),
                HistoricalFixture.summaryIndex(), HistoricalFixture.historicalBranch(),
                _eph(), _executionBranch()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "an unfinalized target must be refused");
    }

    /// The deepest path, driven by a proof. The committee matches
    /// cmd/blockroots, so its proof applies here unchanged -- an aggregate
    /// proof is over the committee and the bitfield, not over any header.
    function it_anchors_via_historical_summaries_from_a_proven_aggregate() {
        _boot();

        PlonkVerifier v = new PlonkVerifier();
        uint256[] memory k = new uint256[](BlockRootsProofFixture.VK_WORDS);
        for (uint256 i = 0; i < BlockRootsProofFixture.VK_WORDS; i = i + 1) {
            k[i] = BlockRootsProofFixture.vkWord(i);
        }
        v.initialize(k, "bridge-sync-committee-aggregate");
        hc.setAggregateVerifier(v);
        hc.setCommitteeCommitment(
            _bootstrapPeriod(),
            0x092ae0caf9288970aaad9df4e9a5dac059e109c5937e6f05a1af0c1a93e83e72
        );

        uint256[] memory proof = new uint256[](BlockRootsProofFixture.PROOF_WORDS);
        for (uint256 i = 0; i < BlockRootsProofFixture.PROOF_WORDS; i = i + 1) {
            proof[i] = BlockRootsProofFixture.proofWord(i);
        }
        hc.submitAggregateProof(
            _bootstrapPeriod(), HistoricalFixture.participationBits(),
            hex"000000000000000000000000000000000f8b005b3f52b702c8124c8d3513c78cdf5e149d5309d280984cdccd807ba1a9ae924010ceed7d182434338d675befcb00000000000000000000000000000000027aa49d7a3db09d391a9b7762344b76fc377d0ba1d29da643e091fd1f8f497be1cbc2d4cbee681fb7034b5618ec3575",
            proof
        );

        uint256 anchored = hc.anchorBlockHeaderViaHistoricalSummaries(
            _hcHeaders(), _hcSync(), _target(), HistoricalFixture.summaryIndex(),
            HistoricalFixture.historicalBranch(), _eph(), _executionBranch()
        );
        require(anchored == 10790533, "anchored block number mismatch");
        require(
            hc.getReceiptsRoot(10790533) ==
                bytes32(hex"079d81c599aef8f01e94e08348c67147eff4d4319cea20fd488d5ed6a5fd1eaa"),
            "receiptsRoot mismatch"
        );
    }
}
