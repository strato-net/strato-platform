# Baby JubJub

A Haskell implementation of the Baby JubJub elliptic curve and EdDSA signature scheme,
compatible with [circom](https://github.com/iden3/circom) and [snarkjs](https://github.com/iden3/snarkjs).

## Overview

Baby JubJub is a twisted Edwards curve defined over the scalar field of BN254 (alt_bn128).
It is widely used in zkSNARK applications, including:

- [Railgun](https://railgun.org/) - Privacy-preserving transactions
- [Semaphore](https://semaphore.appliedzkp.org/) - Anonymous signaling
- [Tornado Cash](https://tornado.cash/) - Private transactions

## Curve Parameters

Baby JubJub is defined by the equation: `ax² + y² = 1 + dx²y²`

Where:
- **Field (p)**: 21888242871839275222246405745257275088548364400416034343698204186575808495617
- **a**: 168700
- **d**: 168696
- **Subgroup order (l)**: 2736030358979909402780800718157159386076813972158567259200215660948447373041
- **Cofactor (h)**: 8

## Usage

### Curve Operations

```haskell
import Crypto.Curve.BabyJubJub

-- Create a point from coordinates
let point = mkPoint x y

-- Scalar multiplication
let result = scalarMult scalar basePoint

-- Point addition
let sum = pointAdd p1 p2
```

### EdDSA Signatures

```haskell
import Crypto.Curve.BabyJubJub.EdDSA

-- Generate a key pair from a private key
let (pubKey, privKey) = generateKeyPair secretKey

-- Sign a message
let signature = sign privKey message

-- Verify a signature
let isValid = verify pubKey message signature
```

## CLI Tool

The package includes a CLI tool for testing:

```bash
# Generate a key pair
baby-jubjub-cli keygen --secret <hex>

# Sign a message
baby-jubjub-cli sign --secret <hex> --message <hex>

# Verify a signature
baby-jubjub-cli verify --pubkey <hex> --message <hex> --signature <hex>
```

## Compatibility

This implementation is tested against the reference implementations in:
- [circomlib](https://github.com/iden3/circomlib) (JavaScript)
- [circomlibjs](https://github.com/iden3/circomlibjs) (JavaScript)

## Security Notice

This library is intended for generating valid SNARK witness inputs. While the
mathematical operations are correct, it has **not been audited** for use cases
requiring:

- Timing-attack resistance
- Side-channel attack resistance
- Key protection

For high-security applications, please consider a security audit before use.

## References

- [EIP-2494: Baby Jubjub Elliptic Curve](https://eips.ethereum.org/EIPS/eip-2494)
- [EdDSA for more curves](https://datatracker.ietf.org/doc/html/rfc8032)
- [circomlib babyjub.circom](https://github.com/iden3/circomlib/blob/master/circuits/babyjub.circom)

## License

MIT License - see [LICENSE](LICENSE) for details.
