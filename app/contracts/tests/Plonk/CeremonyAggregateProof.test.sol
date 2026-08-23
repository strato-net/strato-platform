// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Plonk/PlonkVerifier.sol";
import "./CeremonyAggregateFixture.sol";

/// @notice Closes the deployment path: a proof whose setup came from a real
///         powers-of-tau ceremony, verified on-chain.
///
///         Everything else in this suite runs on gnark's unsafe test SRS,
///         which is fine for exercising the protocol but is not what a
///         deployed verifier will hold. The verifying key is derived from the
///         SRS, so a ceremony key is a different key -- and until this ran,
///         nothing had shown that one actually verifies here.
///
///         Same circuit and same witness as BridgeAggregateFixture; only the
///         setup differs. Regenerating needs the ceremony SRS:
///
///             proverd -srs <ceremony>/srs.bin -cache <dir> -warm
///             curl -s localhost:8547/vk    > vk.json
///             curl -s -XPOST --data @req.json localhost:8547/prove > proof.json
///
///         A KZG SRS is universal, not per-circuit -- that is the point of
///         PLONK over Groth16 -- so the rollup's power-23 ceremony covers this
///         circuit's 2^22 domain with room to spare.
contract Describe_CeremonyAggregateProof {
    PlonkVerifier verifier;

    function vkArray() internal returns (uint256[]) {
        uint256[] memory k = new uint256[](CeremonyAggregateFixture.VK_WORDS);
        for (uint256 i = 0; i < CeremonyAggregateFixture.VK_WORDS; i = i + 1) {
            k[i] = CeremonyAggregateFixture.vkWord(i);
        }
        return k;
    }

    function proofArray() internal returns (uint256[]) {
        uint256[] memory p = new uint256[](CeremonyAggregateFixture.PROOF_WORDS);
        for (uint256 i = 0; i < CeremonyAggregateFixture.PROOF_WORDS; i = i + 1) {
            p[i] = CeremonyAggregateFixture.proofWord(i);
        }
        return p;
    }

    function publicInputs() internal returns (uint256[]) {
        uint256[] memory pi = new uint256[](CeremonyAggregateFixture.NB_PUBLIC_INPUTS);
        for (uint256 i = 0; i < CeremonyAggregateFixture.NB_PUBLIC_INPUTS; i = i + 1) {
            pi[i] = CeremonyAggregateFixture.publicInput(i);
        }
        return pi;
    }

    function beforeAll() public {
        verifier = new PlonkVerifier();
        verifier.initialize(vkArray(), "bridge-sync-committee-aggregate");
    }

    function it_verifies_a_ceremony_backed_proof() {
        require(verifier.verifyProof(proofArray(), publicInputs()), "ceremony proof must verify");
    }

    function it_rejects_a_tampered_ceremony_proof() {
        uint256[] memory p = proofArray();
        p[12] = p[12] + 1;
        require(!verifier.verifyProof(p, publicInputs()), "tampered ceremony proof must not verify");
    }
}
