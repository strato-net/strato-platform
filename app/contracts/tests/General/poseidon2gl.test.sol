// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Parametrized Poseidon2 builtins
/// @notice poseidon2Permute / poseidon2Hash / poseidon2HashBytes take an
///         EIP-5988-shaped 38-byte params block that SELECTS a registered
///         instance (never derives one): the gnark-crypto BN254 instance
///         (t=2, x^5, 6/50, Merkle-Damgard) and the plonky2/Plonky3 Goldilocks
///         instance (t=12, x^7, 8/22, sponge). poseidon2gl / poseidon2glBytes
///         are the Goldilocks wrappers (4-element digests). Expected values
///         come from the plonky2 prover (rollup/gl/testdata/vectors.json) and
///         from rollup/perp3's DA commitment.
contract Describe_Poseidon2Parametrized {
    // [variant 2][p 32B BE][t][alpha][R_F][R_P][mode]
    bytes constant GL = hex"02000000000000000000000000000000000000000000000000ffffffff000000010c07081600";
    bytes constant BN = hex"0230644e72e131a029b85045b68181585d2833e84879b9709143e1f593f00000010205063201";

    function it_goldilocks_hash_matches_the_prover() public {
        uint256[] memory h = poseidon2gl(1);
        require(h.length == 4, "len");
        require(h[0] == 7431367281668178651 && h[1] == 8673656104435309403 && h[2] == 8585099438262764970 && h[3] == 14879537960188007193, "hash [1]");
        uint256[] memory in33 = new uint256[](33);
        uint256 i = 0;
        while (i < 33) { in33[i] = i + 1; i += 1; }
        uint256[] memory h33 = poseidon2gl(in33);
        require(h33[0] == 14548599093647915756 && h33[3] == 18130297594873324736, "hash [1..33]");
    }

    function it_parametrized_form_equals_the_wrapper() public {
        uint256[] memory in8 = new uint256[](8);
        uint256 i = 0;
        while (i < 8) { in8[i] = i + 1; i += 1; }
        uint256[] memory a = poseidon2gl(in8);
        uint256[] memory b = poseidon2Hash(GL, in8, 4);
        require(a[0] == b[0] && a[1] == b[1] && a[2] == b[2] && a[3] == b[3], "params vs wrapper");
        require(a[0] == 11038414124778337341, "hash [1..8]");
    }

    function it_bytes_hash_is_the_rollup_da_commitment() public {
        bytes memory zeros = new bytes(100);
        uint256[] memory d = poseidon2glBytes(zeros);
        // rollup/perp3 DACommit(100 zero bytes) = 75b193e5…7294 (limbs 3..0)
        require(d[0] == 0x929f8cff0a6a7294 && d[1] == 0xa15d9e6787e46580 && d[2] == 0x7f06d1d0a240dafe && d[3] == 0x75b193e52099d275, "DA commit");
        uint256[] memory e = poseidon2HashBytes(GL, zeros, 4);
        require(d[0] == e[0] && d[3] == e[3], "params bytes form");
    }

    function it_bn254_instance_matches_the_plain_builtins() public {
        uint256[] memory in2 = new uint256[](2);
        in2[0] = 1; in2[1] = 2;
        uint256[] memory h = poseidon2Hash(BN, in2, 1);
        require(h.length == 1 && h[0] == poseidon2(1, 2), "bn254 md");
        uint256[] memory st = poseidon2Permute(BN, in2);
        require(st.length == 2, "bn254 permute width");
    }

    function it_rejects_unregistered_params() public {
        bytes memory bad = hex"02000000000000000000000000000000000000000000000000ffffffff000000010c07081600";
        bad[37] = 0x01; // mode flipped -> not a registered instance
        uint256[] memory in1 = new uint256[](1);
        in1[0] = 1;
        bool failed = false;
        try { poseidon2Hash(bad, in1, 4); } catch { failed = true; }
        require(failed, "unregistered params accepted");
    }
}
