# Bridge circuits

Zero-knowledge circuits for the trustless bridge's Ethereum light client.

## What this proves

`EthLightClient` anchors an Ethereum block by checking that the sync
committee signed it. The signature check itself is cheap on STRATO — SolidVM
has an EIP-2537-parity BLS12-381 pairing, metered at 90,000 gas. What is not
cheap is deriving the *aggregate pubkey of the signing subset*, which means
summing 342-512 curve points on-chain at ~9,000 gas each.

So the circuit takes exactly that one step, and nothing else:

> Given a committee pinned by the on-chain commitment `Comm`, and a
> participation bitfield `Bits`, the point `Agg` is the sum of the members
> `Bits` selects.

Everything else stays where it is. The BLS pairing, the SSZ hash-tree roots,
the finality branch and the beacon state proofs all remain native Solidity —
they are already inexpensive, and keeping SSZ on-chain means an Ethereum fork
that shifts a generalized index is an owner transaction (`setIndices`) rather
than a new circuit and a new verifying key.

## Measured

`go run ./cmd/probe` (add `prove` to also run a proving benchmark).

| operation | R1CS | PLONK (scs) |
|---|---:|---:|
| G1 Add (incomplete) | 534 | 2,172 |
| G1 AddUnified (complete) | 1,169 | 3,853 |
| AssertIsOnCurve | 277 | 983 |
| AssertIsOnG1 (subgroup) | 72,455 | 238,925 |
| UnmarshalCompressed (48B) | 77,240 | 246,291 |
| Point Select | 12 | 36 |
| Poseidon2 MD hash (4 in) | 744 | 1,204 |
| sign check (LessOrEqual) | 2,369 | 4,461 |
| emulated ToBits | 451 | 1,014 |

| circuit (n=512) | R1CS | PLONK (scs) |
|---|---:|---:|
| EC accumulation only | 283,127 | 992,352 |
| + commitment, incomplete add | 664,056 | 1,612,897 |
| **+ commitment, unified add** | **921,821** | **2,322,257** |

Proving the shipped variant on 10 cores: **35.8s**, native verify 2ms.
One-time SRS 54s, PLONK setup 6.7s.

## Verified end to end

A real proof from this circuit verifies on-chain. `cmd/emit` writes the
artifacts, `plonkgen import` (in the lambdachain rollup) runs a Go reference
verifier over them and emits a SolidVM fixture, and
`app/contracts/tests/Plonk/BridgeAggregateProof.test.sol` puts it in front of
`PlonkVerifier`. Challenges, the vanishing polynomial and PI(zeta) are pinned
against the reference verifier's intermediates, so a break names its stage
rather than just reporting that a proof did not verify.

    cd app/circuits && go run ./cmd/emit 512 470 /tmp/e2e
    cd <lambdachin>/rollup/plonkgen && go run . import         /tmp/e2e BridgeAggregateFixture BridgeAggregateFixture.sol gt.json

**~116,000 gas** to verify, against the 400,000 per-transaction budget. The
key is a 2^22 domain with 17 public inputs and one Bsb22 commitment -- the
commitment comes from the emulated field's range checks, via gnark's
Committer API, and is not optional.

The participation bitfield is packed 128 bits to a public word rather than
passed a bit at a time, because the verifier does a modular inversion per
public input: measured at ~820 gas each, 512 of them would have been ~420,000
and over budget on their own.

## Three decisions, and why

**The committee is committed as affine (X, Y), not compressed.** In-circuit
decompression costs 77,240 constraints per key, 94% of which is the subgroup
check — 512 of those would be 39.5M constraints, an order of magnitude more
than the entire rest of the circuit. Committing to the affine point skips
both. It is sound because the point is fully determined by the commitment, so
subgroup membership is a property of committed data rather than something a
prover chooses.

The cost lands on the contract instead: it must decompress all 512 keys once
per rotation to build the commitment (~2.56M gas, so a handful of
transactions every ~27 hours).

**Y is committed, not just X.** Committing X alone leaves each key's sign
free. 512 free signs is a k-sum instance, and Wagner's generalized birthday
algorithm can search sign patterns for an aggregate whose discrete log the
attacker knows — which is a forgery, because the on-chain pairing would then
accept a signature they produced themselves. Pinning Y removes the freedom.
It is also the cheaper option: ~381k constraints for the extra hashing,
against ~446k or worse for committing the sign bit and checking it in-circuit.

**Addition is complete (`AddUnified`), not incomplete.** The cheap variant
saves ~39% but has a degenerate case — equal x-coordinates have no modular
inverse — that the accumulator pattern does not rule out. It has failed on
more than one committee. `TestIncompleteAdditionIsNotYetUsable` records that;
if a future change makes it work, the circuit drops to 1.61M constraints,
fits a 2^21 domain instead of 2^22, and proves in roughly half the time.

## Poseidon2 interop

The commitment is computed twice by two implementations in two languages: by
`EthLightClient` in SolidVM, and by this circuit in gnark. Nothing in either
build catches a divergence — a mismatch surfaces as a proof that never
verifies.

`cmd/fixtures` emits vectors from gnark-crypto's `ecc/bn254/fr/poseidon2`
(the default t=2, rF=6, rP=50 instance, zero-IV Merkle-Damgard). They are
asserted on the SolidVM side in
`app/contracts/tests/General/poseidon2Interop.test.sol`, including at the
field boundary. Both sides currently agree bit-for-bit.

## Layout

    aggregate.go            the circuit
    witness.go              witness construction from a synthetic committee
    aggregate_test.go       satisfiability, tamper rejection, add-mode guard
    cmd/probe               constraint counts and proving benchmark
    cmd/fixtures            Poseidon2 vectors for the SolidVM interop test
