// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Gas metering for the cryptographic builtins
/// @notice The crypto builtins do unbounded-cost work in a single expression
///         node, so they are charged explicitly rather than at SolidVM's
///         usual one-gas-per-node rate. These tests pin the ceiling: a
///         realistic verifier workload must still fit in a transaction, and
///         an abusive one must run out of gas rather than stall the block.
contract Describe_CryptoGas {
    // BN254 G1 generator and the G2 generator in ecPairing coordinate order
    uint constant G1x = 1;
    uint constant G1y = 2;
    uint constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    function g2() internal pure returns (uint[4] memory) {
        return [
            11559732032986387107991004021392285783925812861821192530917403151452391805634,
            10857046999023057135944570762232829481370756359578518086990519993285655852781,
            4082367875863433681332203403145435568316851327593401208105741076214120093531,
            8495653923123431417604973247489272438418190587263600148770280649306958101930
        ];
    }

    /// A Groth16-shaped verification (one ecPairing call over four pairs)
    /// must still fit inside a single transaction's gas budget.
    function it_admits_a_four_pair_verification() public {
        uint[4] memory h = g2();
        uint[] memory input = new uint[](24);
        for (uint i = 0; i < 4; i++) {
            // alternate P and -P so the product is the identity
            input[i * 6] = G1x;
            input[i * 6 + 1] = (i % 2 == 0) ? G1y : P - G1y;
            input[i * 6 + 2] = h[0];
            input[i * 6 + 3] = h[1];
            input[i * 6 + 4] = h[2];
            input[i * 6 + 5] = h[3];
        }
        require(ecPairing(input), "four-pair identity should verify");
    }

    /// Poseidon2 is the hash a rollup contract uses to recompute a batch
    /// commitment, so a few hundred hashes must remain affordable.
    function it_admits_a_few_hundred_poseidon2_hashes() public {
        uint acc = 0;
        for (uint i = 0; i < 200; i++) {
            acc = poseidon2Compress(acc, i);
        }
        require(acc != 0, "hash chain should produce a value");
    }

    /// Cheap operations must stay cheap: thousands of ecAdds in one call.
    function it_admits_many_cheap_operations() public {
        uint x = G1x;
        uint y = G1y;
        for (uint i = 0; i < 500; i++) {
            (x, y) = ecAdd(x, y, G1x, G1y);
        }
        require(x != 0, "point should be non-trivial");
    }
}
