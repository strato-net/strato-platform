# DefiLlama TVL Adapter PR Body

## Summary

- Add a STRATO TVL adapter backed by a public read-only metrics endpoint
- Count underlying assets locked in STRATO DeFi contracts across CDP, lending, pools, saveUSDST, safety module, and vaults
- Exclude wallet balances, receipt/share tokens, protocol debt, and double counting across products

## Methodology

STRATO TVL counts the USD value of underlying assets currently locked in STRATO DeFi contracts, counted once at the underlying-asset level. Included buckets are CDP collateral, lending supplied assets, lending collateral, AMM/stable pool reserves, saveUSDST underlying, safety module underlying, and diversified vault underlying. Excluded items are user wallet balances, receipt/share tokens, protocol debt, and any double counting of the same underlying across products.

## Data Source

- Public TVL endpoint: `https://app.strato.nexus/api/metrics/tvl`
- The endpoint is read-only and unauthenticated
- The adapter uses the endpoint's raw asset balances and does not rely on the endpoint's precomputed USD totals

## Notes

- Final adapter path in `DefiLlama/DefiLlama-Adapters`: `projects/strato/index.js`
- Stablecoin supply is tracked separately and is not included in this TVL adapter
- STRATO should be treated as its own chain for this adapter

## Short Version

## Summary

- Add STRATO TVL adapter using the public read-only metrics endpoint
- Count underlying assets locked in CDP, lending, pools, saveUSDST, safety module, and vaults
- Exclude wallet balances, receipt/share tokens, protocol debt, and double counting

## Methodology

Counts underlying assets locked in STRATO DeFi contracts across CDP, lending, pools, saveUSDST, safety module, and vaults. Excludes wallet balances, receipt/share tokens, protocol debt, and double counting.

## Data Source

- `https://app.strato.nexus/api/metrics/tvl`
- Public, read-only, unauthenticated
- Final adapter file path: `projects/strato/index.js`
- Adapter uses raw balances from the endpoint
