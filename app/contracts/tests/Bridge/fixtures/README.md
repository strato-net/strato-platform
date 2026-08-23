# Sepolia LightClient fixtures

Raw beacon-API responses captured from a public Sepolia beacon node
(Lodestar at `https://lodestar-sepolia.chainsafe.io`) on 2026-05-04.
Used as the test vector for `BLSVerify.sol` and `EthLightClient.sol`.

## Files

| File | Endpoint | Purpose |
|------|----------|---------|
| `finality_update.json`  | `GET /eth/v1/beacon/light_client/finality_update` | Sync-committee-signed attested header + FFG-finalized header + finality branch + sync aggregate |
| `bootstrap.json`        | `GET /eth/v1/beacon/light_client/bootstrap/{root}` | Sync committee for the period containing the finalized header (512 G1 pubkeys + aggregate, 5-deep Merkle branch) |
| `finalized_header.json` | `GET /eth/v1/beacon/headers/finalized` | Canonical finalized header (used to derive `{root}` for bootstrap) |
| `fork_schedule.json`    | `GET /eth/v1/config/fork_schedule` | Fork-version transitions, used to pick the right version for the signing root domain |
| `spec.json`             | `GET /eth/v1/config/spec` | Network constants (`SLOTS_PER_EPOCH`, `EPOCHS_PER_SYNC_COMMITTEE_PERIOD`, `DOMAIN_SYNC_COMMITTEE`, etc.) |

## Salient values

```
Network:  Sepolia
Fork at signature_slot:    fulu (0x90000075)
genesis_validators_root:   0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078
DOMAIN_SYNC_COMMITTEE:     0x07000000

attested_header.slot:      10182912    (period 1242, epoch 318216)
finalized_header.slot:     10182848    (same period, two epochs back)
signature_slot:            10182913    (same period; sync committee 1242 signed)

sync_committee_bits:       64-byte bitfield (≥ 342 of 512 → ≥ ⅔ participation)
sync_committee_signature:  96 bytes compressed G2
sync committee:            512 × 48-byte compressed G1 pubkeys + aggregate
```

## Encoding caveats for downstream tests

Beacon API returns BLS points in their **compressed** form:
- G1 pubkey:    48 bytes  (top 3 bits of byte 0 are flags: compression / infinity / Y-sign)
- G2 signature: 96 bytes  (same flag layout)

EIP-2537 / SolidVM precompiles consume **uncompressed** points:
- G1: 128 bytes (x.64 || y.64, big-endian; each F_p in 16 zero-pad + 48 value)
- G2: 256 bytes (xc0.64 || xc1.64 || yc0.64 || yc1.64)

Two ways to bridge the gap before passing into `BLSVerify`:
1. Decompress off-line (host-side prep tool emits hex literals for tests).
2. Add `bls12381DecompressG1`/`bls12381DecompressG2` SolidVM builtins so the
   contract can take what the beacon API returns directly. (TBD — pending
   scope decision.)

## What the consumer must do for sync-committee verification

1. Parse `sync_committee_bits` (64 bytes → 512-bit array).
2. Decompress only the participating pubkeys → 128-byte G1 points each.
3. Aggregate them via `bls12381G1Add` chained calls (or a single G1Msm with
   all-1 scalars).
4. Decompress `sync_committee_signature` → 256-byte G2 point.
5. Compute `signing_root`:
     - `fork_data_root = hash_tree_root(ForkData{fork_version, genesis_validators_root})`
     - `domain          = DOMAIN_SYNC_COMMITTEE || fork_data_root[:28]`
     - `signing_root    = sha256(hash_tree_root(attested_header) || domain)`
6. `bls12381Pairing(-G1::generator, signature, agg_pubkey, hash_to_curve_G2(signing_root, ETH_DST))`
   should return `true`.
   - `ETH_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"`
