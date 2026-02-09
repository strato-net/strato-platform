# poseidon-hash

A pure Haskell implementation of the Poseidon hash function for ZK-SNARKs.

## Overview

Poseidon is a hash function designed for efficient computation inside zero-knowledge proof circuits. Unlike traditional hash functions (SHA256, Keccak), Poseidon uses only field arithmetic operations, making it approximately 100x more efficient in ZK-SNARK circuits.

This implementation uses the BN254 (alt_bn128) scalar field, which is compatible with:
- Ethereum's pairing precompiles
- Most ZK-SNARK implementations (circom, snarkjs, etc.)
- Railgun and other privacy protocols

## Usage

```haskell
import Crypto.Hash.Poseidon

-- Hash two field elements
let result = poseidon [toF 1, toF 2]
-- result is a field element

-- Get the integer value
let value = fromF result
-- 7853200120776062878684798364095072458815029376092732009249414926327459813530

-- Hash with hex inputs
let result2 = poseidon [fromHex "0x1234", fromHex "0x5678"]
```

## Supported Input Sizes

This implementation supports 1-8 inputs (t = 2 to 9). This covers all common use cases including:
- Merkle tree hashing (2 inputs)
- Commitment schemes (2-4 inputs)
- Nullifier derivation (2 inputs)

## Test Vectors

Test vectors are taken from the reference circomlibjs implementation to ensure compatibility.

## References

- [Poseidon paper](https://eprint.iacr.org/2019/458.pdf)
- [circomlibjs](https://github.com/iden3/circomlibjs) - Reference implementation
- [Filecoin's neptune](https://github.com/filecoin-project/neptune) - Rust implementation
