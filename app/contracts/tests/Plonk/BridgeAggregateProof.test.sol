// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Plonk/PlonkVerifier.sol";
import "./BridgeAggregateFixture.sol";

/// @notice End-to-end: a real PLONK proof from the bridge's sync-committee
///         aggregation circuit (app/circuits), verified on-chain by the same
///         PlonkVerifier the rollup uses.
///
///         The two halves were built independently -- the circuit in gnark,
///         the verifier by hand in SolidVM against a Go reference -- so this
///         is the test that catches a format mismatch between them. In
///         particular the circuit's emulated BLS12-381 arithmetic uses range
///         checks, which go through gnark's Committer API and put one Bsb22
///         commitment in the proof; the key grows three words and the proof
///         grows three, and every challenge has to pick up its commitment
///         term in the right place.
///
///         Regenerate the fixture with:
///             cd app/circuits && go run ./cmd/emit 512 470 /tmp/e2e
///             cd <lambdachin>/rollup/plonkgen && go run . import \
///                 /tmp/e2e BridgeAggregateFixture BridgeAggregateFixture.sol gt.json
contract Describe_BridgeAggregateProof {
    PlonkVerifier verifier;

    function beforeAll() public {
        verifier = new PlonkVerifier();
        verifier.initialize(vkArray(), "bridge-sync-committee-aggregate");
    }

    function vkArray() internal returns (uint256[]) {
        uint256[] memory k = new uint256[](BridgeAggregateFixture.VK_WORDS);
        for (uint256 i = 0; i < BridgeAggregateFixture.VK_WORDS; i = i + 1) {
            k[i] = BridgeAggregateFixture.vkWord(i);
        }
        return k;
    }

    function proofArray() internal returns (uint256[]) {
        uint256[] memory p = new uint256[](BridgeAggregateFixture.PROOF_WORDS);
        for (uint256 i = 0; i < BridgeAggregateFixture.PROOF_WORDS; i = i + 1) {
            p[i] = BridgeAggregateFixture.proofWord(i);
        }
        return p;
    }

    function publicInputs() internal returns (uint256[]) {
        uint256[] memory pi = new uint256[](BridgeAggregateFixture.NB_PUBLIC_INPUTS);
        for (uint256 i = 0; i < BridgeAggregateFixture.NB_PUBLIC_INPUTS; i = i + 1) {
            pi[i] = BridgeAggregateFixture.publicInput(i);
        }
        return pi;
    }

    // ---- shape ----

    /// The circuit is 512 committee slots over a 2^22 domain, and the packed
    /// bitfield keeps the public input count at 17 rather than 500-odd. That
    /// matters on-chain: the verifier does a modular inversion per public
    /// input.
    function it_has_the_expected_key_shape() {
        require(BridgeAggregateFixture.vkWord(0) == 4194304, "domain should be 2^22");
        require(BridgeAggregateFixture.NB_PUBLIC_INPUTS == 17, "expected 17 public inputs");
        require(verifier.nbCommitments() == 1, "emulated range checks should give one Bsb22 commitment");
        require(verifier.proofLength() == BridgeAggregateFixture.PROOF_WORDS, "proof length disagrees with the key");
    }

    // ---- the thing itself ----

    function it_verifies_a_real_aggregation_proof() {
        require(verifier.verifyProof(proofArray(), publicInputs()), "aggregation proof must verify");
    }

    // ---- stage pins, so a break names itself ----

    function it_derives_the_reference_challenges() {
        (uint256 g, uint256 b, uint256 a, uint256 z) =
            verifier.challenges(proofArray(), publicInputs());
        require(g == BridgeAggregateFixture.EXP_GAMMA, "gamma mismatch");
        require(b == BridgeAggregateFixture.EXP_BETA, "beta mismatch");
        require(a == BridgeAggregateFixture.EXP_ALPHA, "alpha mismatch");
        require(z == BridgeAggregateFixture.EXP_ZETA, "zeta mismatch");
    }

    function it_evaluates_the_vanishing_polynomial() {
        require(
            verifier.vanishing(BridgeAggregateFixture.EXP_ZETA) == BridgeAggregateFixture.EXP_ZH,
            "Z_H(zeta) mismatch"
        );
    }

    /// PI(zeta) is where the packed bitfield and the commitment term meet;
    /// if the Bsb22 wiring were off by an index this is what would move.
    function it_computes_the_public_input_contribution() {
        uint256 pi = verifier.publicInputContribution(
            BridgeAggregateFixture.EXP_ZETA, BridgeAggregateFixture.EXP_ZH, publicInputs());
        uint256 c = verifier.commitmentContribution(
            BridgeAggregateFixture.EXP_ZETA, BridgeAggregateFixture.EXP_ZH, proofArray());
        require(addmod(pi, c, 21888242871839275222246405745257275088548364400416034343698204186575808495617)
                == BridgeAggregateFixture.EXP_PI, "PI(zeta) mismatch");
    }

    // ---- negative controls ----

    function it_rejects_a_tampered_proof() {
        uint256[] memory p = proofArray();
        p[12] = p[12] + 1; // L(zeta)
        require(!verifier.verifyProof(p, publicInputs()), "a tampered proof must not verify");
    }

    /// The aggregate is public input, so claiming a different one is exactly
    /// the forgery the circuit exists to prevent.
    function it_rejects_a_different_claimed_aggregate() {
        uint256[] memory pi = publicInputs();
        pi[4] = pi[4] + 1;
        require(!verifier.verifyProof(proofArray(), pi), "a different aggregate must not verify");
    }

    function it_rejects_a_tampered_participation_bitfield() {
        uint256[] memory pi = publicInputs();
        pi[0] = pi[0] ^ 1; // flip participation of committee member 0
        require(!verifier.verifyProof(proofArray(), pi), "a flipped participation bit must not verify");
    }
}
