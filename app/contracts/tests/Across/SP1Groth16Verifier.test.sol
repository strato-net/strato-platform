// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../external/across/SP1Groth16VerifierV6.sol";

/// @notice The compatibility fixture is calldata from an actual successful
/// SP1Helios.update(bytes,bytes) transaction on Tempo mainnet. Transaction:
/// 0x29a09559909561f03991adfa16a0847a169d568364f5ee6ce797055097919123.
contract Describe_SP1Groth16VerifierV6 {
    bytes32 constant PROGRAM_VKEY = bytes32(
        0x0052e51b66660cd62ad4a2b38fe53f4c5a0dbfa4876a2ebc58bb1c0e4945af03
    );

    function publicValues() internal pure returns (bytes memory) {
        return bytes(hex"000000000000000000000000000000000000000000000000000000000000002073cf76a5e89bc6863ebd182bb88a44793abdf0d279983344ab9b3a63d965b080edb927d6ba19d5267dd051afdf70aa9de1bb40891174c4c209d1851d205336fb91b4b66b01c98b97e790fa131eeb87c886ae2dfb8a1fb644cb4cc94ba2711d4f0000000000000000000000000000000000000000000000000000000000e496200e5c25dd52df5fedb67937155e632f23ff41a941effa1f3d918634ae1b78fe0c0000000000000000000000000000000000000000000000000000000000e495001a1b54d335ea5575ff4786b664a17cb3e4512dab4a3ddd6b35add71222924b801a1b54d335ea5575ff4786b664a17cb3e4512dab4a3ddd6b35add71222924b80000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000011764e67700a229d846c1f4ef4b6ccfef78da4727682fef1d64628fac828cf5fd0ed416f452a0d83284fb96096d46c57a8abd87ac04abfbd86883c52eb6a6b00e0000000000000000000000001ace3bbd69b63063f859514eca29c9bdd8310e61");
    }

    function validProof() internal pure returns (bytes memory) {
        return bytes(hex"4388a21c0000000000000000000000000000000000000000000000000000000000000000002f850ee998974d6cc00e50cd0814b098c05bfade466d28573240d057f25352000000000000000000000000000000000000000000000000000000000000000017afbcab73e912df68da756254f038607ae2f92d7a6b051b733a0847829aeb8d10fba6a17a20f8ed9ed344f0bab925765be91a527d394373c53335b0d7b657a6259d2dae09ba7cf11dbc46d488892a5687a28d8dc374d12ee8b9836ff6a27c5d0c26c48169cf64d1f2557d35f4009f4aebfd560adfeb404fb67650105a8d0ef718d1cba5e008a8e3d661b8f2aec5096900629f72691c8c91f465abf3c95eb6ea2451d3139f9c3fe26fa7d00ad21c4dbc992ab449b07c8d3ffd0e5c865b709ea004e5925402b31ae12037c628a5e0f565e306b73cf6d7fdd4215f76b8df6391880dbb528c99507e6d5cec0f986901d92ae35ff4bd10f155a56403a805ff7c44a8");
    }

    function rejected(
        SP1Groth16VerifierV6 verifier,
        bytes32 vkey,
        bytes memory values,
        bytes memory proof
    ) internal view returns (bool) {
        try verifier.verifyProof(vkey, values, proof) {
            return false;
        } catch {
            return true;
        }
    }

    function it_exposes_the_live_sp1_v6_pins() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        require(
            verifier.VERIFIER_HASH() == bytes32(0x4388a21c687fdd5f218d7e3d13190cac4c5355818d3605fd5fb811df468ee696),
            "SP1 verifier hash mismatch"
        );
        require(
            verifier.VK_ROOT() == bytes32(0x002f850ee998974d6cc00e50cd0814b098c05bfade466d28573240d057f25352),
            "SP1 recursion root mismatch"
        );
    }

    function it_verifies_a_live_across_helios_proof() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        verifier.verifyProof(PROGRAM_VKEY, publicValues(), validProof());
    }

    function it_rejects_a_corrupted_proof() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory proof = validProof();
        proof[355] = proof[355] ^ 1;
        require(rejected(verifier, PROGRAM_VKEY, publicValues(), proof), "corrupted SP1 proof accepted");
    }

    function it_rejects_the_wrong_verifier_selector() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory proof = validProof();
        proof[0] = 0;
        require(rejected(verifier, PROGRAM_VKEY, publicValues(), proof), "wrong selector accepted");
    }

    function it_rejects_a_nonzero_exit_code() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory proof = validProof();
        proof[35] = 1;
        require(rejected(verifier, PROGRAM_VKEY, publicValues(), proof), "nonzero exit code accepted");
    }

    function it_rejects_the_wrong_recursion_root() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory proof = validProof();
        proof[67] = proof[67] ^ 1;
        require(rejected(verifier, PROGRAM_VKEY, publicValues(), proof), "wrong recursion root accepted");
    }

    function it_rejects_the_wrong_program_vkey() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes32 wrongVkey = bytes32(uint(PROGRAM_VKEY) + 1);
        require(rejected(verifier, wrongVkey, publicValues(), validProof()), "wrong program vkey accepted");
    }

    function it_rejects_changed_public_values() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory values = publicValues();
        values[values.length - 1] = values[values.length - 1] ^ 1;
        require(rejected(verifier, PROGRAM_VKEY, values, validProof()), "changed public values accepted");
    }

    function it_rejects_a_truncated_proof() public {
        SP1Groth16VerifierV6 verifier = new SP1Groth16VerifierV6();
        bytes memory proof = bytes(hex"4388a21c");
        require(rejected(verifier, PROGRAM_VKEY, publicValues(), proof), "truncated SP1 proof accepted");
    }
}
