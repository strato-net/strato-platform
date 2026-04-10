# DefiLlama Stablecoins PR Body

## Summary

- Add STRATO stablecoin coverage for canonical USD-pegged assets on STRATO
- Include `USDST`, `USDC`, and `USDT`
- Exclude yield-bearing wrappers such as `sUSDS` and `syrupUSDC` from canonical stablecoin supply

## Methodology

Stablecoin supply on STRATO counts the circulating supply of canonical USD-pegged assets issued or represented on STRATO. Current scope includes `USDST`, `USDC`, and `USDT`. Yield-bearing wrappers such as `sUSDS` and `syrupUSDC` are excluded from stablecoin supply and treated separately from canonical circulating stablecoins.

## Data Source

- Public stablecoins endpoint: `https://YOUR_PUBLIC_STRATO_API_HOST/api/v1/metrics/stablecoins`
- The endpoint is read-only and unauthenticated
- The endpoint returns current stablecoin supply snapshots for STRATO-recognized canonical stablecoins

## STRATO Stablecoin Set

- `USDST`
  - address: `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`
  - decimals: `18`
  - classification: native STRATO stablecoin
- `USDC`
  - address: `6aeacaa19c68e53035bf495d15e0a328fc600ba8`
  - decimals: `18`
  - classification: bridged representation on STRATO
- `USDT`
  - address: `5ed0bdfb378ac0d06249d70759536d7a41906216`
  - decimals: `18`
  - classification: bridged representation on STRATO

## Notes

- Current prod stablecoin supply is approximately `$814.9M` using this methodology
- Stablecoin supply is tracked separately from STRATO TVL
- If a different DefiLlama file path or stablecoin-specific adapter shape is preferred for STRATO, this asset set and methodology can be moved accordingly

## Short Version

## Summary

- Add STRATO stablecoin coverage for `USDST`, `USDC`, and `USDT`
- Exclude `sUSDS` and `syrupUSDC` from canonical stablecoin supply
- Use the public read-only stablecoins endpoint as the reviewable source

## Methodology

Counts circulating USD-pegged stablecoin supply on STRATO for `USDST`, `USDC`, and `USDT`. Excludes yield-bearing wrappers such as `sUSDS` and `syrupUSDC`.

## Data Source

- `https://YOUR_PUBLIC_STRATO_API_HOST/api/v1/metrics/stablecoins`
- Public, read-only, unauthenticated
