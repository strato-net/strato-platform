// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Plonk/PlonkVerifier.sol";
import "./EthLightClientAnchor.test.sol";
import "./SepoliaAggregateFixture.sol";

/// @notice The whole proof path, on real data: a PLONK proof that the claimed
///         aggregate is the sum of the Sepolia period-1243 members the real
///         participation bitfield selects, verified on-chain, then used to
///         anchor a real finalized header against the real sync-committee
///         signature.
///
///         This is what the design was for. Deriving that aggregate natively
///         costs ~4.2M gas by summing the 470 signers, or ~510k by subtracting
///         the 42 absentees; here the contract does neither and takes the
///         aggregate from a proof instead.
///
///         Nothing about the aggregate is trusted. It is public input to the
///         proof, and the BLS pairing downstream still has to accept it
///         against the real signature -- so a wrong aggregate fails twice.
contract Describe_ProofAnchoredSepolia is Describe_EthLightClientAnchor {
    PlonkVerifier verifier;

    /// The subset aggregate, EIP-2537 uncompressed. Byte-identical to
    /// BLSVerify.test.sol's precomputed _sepoliaAggPubkey once the
    /// compression flags are masked off.
    function _aggregateUncompressed() internal pure returns (bytes) {
        return hex"000000000000000000000000000000001335746c5e693cee9f751fadf029ea18f9d53f3d0f76877d0f64b5324f0b69aa3e8c52865f647d1bb4d41df0cfae8b5e000000000000000000000000000000000b4f7f93c90b815570da2e94b248d3a4530a445c23b2e02852ff38ab9e95caa7e25c137be55b492b80387d5231b96150";
    }

    function _committeeCommitment() internal pure returns (uint256) {
        return 0x1e8042c24f811689ee3b93217ebee2b7e570d579297ff9053f05ddc578db46ad;
    }

    function _vkArray() internal returns (uint256[]) {
        uint256[] memory k = new uint256[](SepoliaAggregateFixture.VK_WORDS);
        for (uint256 i = 0; i < SepoliaAggregateFixture.VK_WORDS; i = i + 1) {
            k[i] = SepoliaAggregateFixture.vkWord(i);
        }
        return k;
    }

    function _proofArray() internal returns (uint256[]) {
        uint256[] memory p = new uint256[](SepoliaAggregateFixture.PROOF_WORDS);
        for (uint256 i = 0; i < SepoliaAggregateFixture.PROOF_WORDS; i = i + 1) {
            p[i] = SepoliaAggregateFixture.proofWord(i);
        }
        return p;
    }

    function _wire() internal {
        verifier = new PlonkVerifier();
        verifier.initialize(_vkArray(), "bridge-sync-committee-aggregate");
        lc.setAggregateVerifier(verifier);
        // Installed directly rather than built in ~9 chunked transactions.
        // CommitteeCommitment.test.sol pins the chunked build against the
        // same digest.
        lc.setCommitteeCommitment(_bootstrapPeriod(), _committeeCommitment());
    }

    /// The commitment the prover hashed is the one the contract builds.
    function it_agrees_with_the_on_chain_commitment_build() {
        lc.buildCommitteeCommitment(_bootstrapPeriod(), 64);
        (uint256 state, /* next */) = lc.commitmentBuild(_bootstrapPeriod());
        require(
            state == 0x16447b138b551d7c220a6d1333e969d77e1df7797570e81798c298b1269b3ae5,
            "chunked build diverges from the prover's committee"
        );
    }

    function it_accepts_a_proof_for_the_real_committee() {
        _wire();
        lc.submitAggregateProof(
            _bootstrapPeriod(), _participationBits(), _aggregateUncompressed(), _proofArray()
        );
    }

    /// The payoff: anchor without summing a single committee member.
    function it_anchors_a_real_header_from_a_proven_aggregate() {
        _wire();
        lc.submitAggregateProof(
            _bootstrapPeriod(), _participationBits(), _aggregateUncompressed(), _proofArray()
        );

        SyncAggregateInput sync = SyncAggregateInput({
            participationBits: _participationBits(),
            signature:         _signature(),
            signatureSlot:     uint64(10182913)
        });
        BeaconBlockHeaderInput[] noParents = new BeaconBlockHeaderInput[](0);
        uint256 anchored = lc.anchorBlockHeader(_headers(), sync, noParents, _eph(), _executionBranch());
        require(anchored == 10790533, "anchored block number mismatch");
        require(
            lc.getReceiptsRoot(10790533) ==
                bytes32(hex"079d81c599aef8f01e94e08348c67147eff4d4319cea20fd488d5ed6a5fd1eaa"),
            "receiptsRoot mismatch"
        );
    }

    /// A proof is bound to its bitfield: replaying it under a different one
    /// must not verify, or a prover could reuse one aggregate for any subset.
    function it_rejects_a_proof_against_a_different_bitfield() {
        _wire();
        bytes32[2] memory bits = _participationBits();
        bits[0] = bytes32(uint256(bits[0]) ^ 1);
        bool reverted = false;
        try {
            lc.submitAggregateProof(_bootstrapPeriod(), bits, _aggregateUncompressed(), _proofArray());
        } catch {
            reverted = true;
        }
        require(reverted, "a proof must not verify against a different bitfield");
    }

    /// And to its committee: the commitment is public input, so a period whose
    /// committee hashes differently cannot borrow this proof.
    function it_rejects_a_proof_against_a_different_commitment() {
        _wire();
        lc.setCommitteeCommitment(_bootstrapPeriod(), _committeeCommitment() + 1);
        bool reverted = false;
        try {
            lc.submitAggregateProof(
                _bootstrapPeriod(), _participationBits(), _aggregateUncompressed(), _proofArray()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "a proof must not verify against a different committee");
    }

    function it_refuses_a_proof_with_no_commitment_installed() {
        verifier = new PlonkVerifier();
        verifier.initialize(_vkArray(), "bridge-sync-committee-aggregate");
        lc.setAggregateVerifier(verifier);
        bool reverted = false;
        try {
            lc.submitAggregateProof(
                _bootstrapPeriod(), _participationBits(), _aggregateUncompressed(), _proofArray()
            );
        } catch {
            reverted = true;
        }
        require(reverted, "should refuse a period with no commitment");
    }
}
