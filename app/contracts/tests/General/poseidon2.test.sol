// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Poseidon2 builtin tests
/// @notice Poseidon2 over the BN254 scalar field with gnark-crypto's default
///         parameters (t=2, rF=6, rP=50): poseidon2(...) is the Merkle-Damgard
///         hash matching gnark's std/hash/poseidon2 gadget, poseidon2Compress
///         is the raw 2-to-1 node function for Merkle trees.
///         Expected values generated from gnark-crypto v0.20.1.
contract Describe_Poseidon2 {
    function it_hashes_a_single_element() public {
        uint h = poseidon2(1);
        require(h == 12157562999385135173166708316607836110878334226144932937475223226141207470306, "poseidon2(1) mismatch");
    }

    function it_hashes_two_elements() public {
        uint h = poseidon2(1, 2);
        require(h == 4443443265955166080716935670700081889283598504231460571509928329665379862364, "poseidon2(1,2) mismatch");
    }

    function it_hashes_an_array() public {
        uint[] memory xs = new uint[](4);
        xs[0] = 1;
        xs[1] = 2;
        xs[2] = 3;
        xs[3] = 4;
        uint h = poseidon2(xs);
        require(h == 5402851635480781446751342346210135834226319730389436212287936564310709451361, "poseidon2(array) mismatch");
    }

    function it_compresses_two_elements() public {
        uint h = poseidon2Compress(1, 2);
        require(h == 1313337560616139085277676701856612540166622156368305732529371734734451176752, "poseidon2Compress(1,2) mismatch");
    }

    function it_agrees_with_merkle_damgard_composition() public {
        // poseidon2(a, b) == compress(compress(0, a), b) by construction
        uint md = poseidon2(7, 11);
        uint composed = poseidon2Compress(poseidon2Compress(0, 7), 11);
        require(md == composed, "Merkle-Damgard composition mismatch");
    }
}
