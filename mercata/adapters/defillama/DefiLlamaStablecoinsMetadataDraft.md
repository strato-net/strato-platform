# DefiLlama Stablecoins Metadata Draft

## Purpose

This file captures the concrete STRATO stablecoin asset set and metadata needed for a DefiLlama stablecoin submission.

It is intentionally separate from the draft stablecoin adapter logic because the exact DefiLlama submission path may require:

- asset registration / metadata changes
- a stablecoin-specific adapter shape
- or both

## STRATO Chain

- chain key: `strato`
- public source endpoint: `https://YOUR_PUBLIC_STRATO_API_HOST/api/v1/metrics/stablecoins`

## Included Stablecoins

### `USDST`

- address: `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`
- symbol: `USDST`
- name: `USDST`
- decimals: `18`
- peg type: `peggedUSD`
- classification: native STRATO stablecoin

### `USDC`

- address: `6aeacaa19c68e53035bf495d15e0a328fc600ba8`
- symbol: `USDC`
- name: `STRATO USDC`
- decimals: `18`
- peg type: `peggedUSD`
- classification: bridged representation on STRATO

### `USDT`

- address: `5ed0bdfb378ac0d06249d70759536d7a41906216`
- symbol: `USDT`
- name: `STRATO USDT`
- decimals: `18`
- peg type: `peggedUSD`
- classification: bridged representation on STRATO

## Explicit Exclusions

These assets may appear in STRATO TVL when they are locked, but they should not be counted as canonical stablecoin supply:

- `sUSDS` at `6e2d93d323edf1b3cc4672a909681b6a430cae64`
- `syrupUSDC` at `c6c3e9881665d53ae8c222e24ca7a8d069aa56ca`

Reason:

- they are yield-bearing wrappers, not canonical circulating stablecoins

## Methodology

Stablecoin supply on STRATO counts the circulating supply of canonical USD-pegged assets issued or represented on STRATO. Current scope includes `USDST`, `USDC`, and `USDT`. Yield-bearing wrappers such as `sUSDS` and `syrupUSDC` are excluded from stablecoin supply and treated separately from canonical circulating stablecoins.

## Current Prod Snapshot

Current production output from `prod-stablecoins-output.json`:

- total stablecoin supply: approximately `$814.9M`
- `USDST`: approximately `$801.0M`
- `USDC`: approximately `$9.28M`
- `USDT`: approximately `$4.60M`

## Candidate Review Notes

Use these points if DefiLlama asks for supporting context:

- STRATO stablecoin supply is separate from STRATO TVL
- `USDST` is the native STRATO stablecoin
- `USDC` and `USDT` are STRATO-side bridged representations
- the backend endpoint is public, read-only, and unauthenticated
- the endpoint returns stablecoin-specific supply rows, not protocol TVL balances

## Candidate Asset Registration Shape

If DefiLlama asks for chain asset metadata rather than just prose, these are the concrete rows to register for `strato`:

```json
[
  {
    "chain": "strato",
    "address": "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
    "symbol": "USDST",
    "name": "USDST",
    "decimals": 18,
    "pegType": "peggedUSD",
    "classification": "native"
  },
  {
    "chain": "strato",
    "address": "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
    "symbol": "USDC",
    "name": "STRATO USDC",
    "decimals": 18,
    "pegType": "peggedUSD",
    "classification": "bridged_representation"
  },
  {
    "chain": "strato",
    "address": "5ed0bdfb378ac0d06249d70759536d7a41906216",
    "symbol": "USDT",
    "name": "STRATO USDT",
    "decimals": 18,
    "pegType": "peggedUSD",
    "classification": "bridged_representation"
  }
]
```

This JSON block is a draft reference, not a claim about DefiLlama's exact file schema.
