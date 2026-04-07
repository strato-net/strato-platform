# Metrics Functional Spec

## Purpose

Expose two public, read-only backend metrics endpoints that external consumers can rely on for STRATO analytics:

- `GET /v1/metrics/tvl`
- `GET /v1/metrics/stablecoins`

Primary target consumer is DefiLlama, but the endpoints are intentionally generic and reusable by any read-only integrator.

These endpoints do not mutate protocol state, mint assets, transfer assets, or persist derived metrics. They compute a fresh snapshot from current protocol data and return JSON.

## Actors

- External integrator: requests a public metrics snapshot.
- Backend API: authorizes the request as public, gathers live protocol data, and returns normalized JSON.
- Protocol data sources: Cirrus-backed contract state and oracle pricing used by the backend services.
- Backend config and token registry: provide contract addresses and explicit token classification where runtime inference is not enough.

## Endpoints

### `GET /v1/metrics/tvl`

Returns the current STRATO TVL snapshot.

Business meaning:

- TVL is the USD value of underlying assets locked in STRATO DeFi contracts.
- Assets are counted once at the underlying-asset level.
- Receipt or share tokens are not counted as TVL.

### `GET /v1/metrics/stablecoins`

Returns the current circulating stablecoin supply snapshot for STRATO-recognized stable assets.

Business meaning:

- Stablecoin supply is separate from TVL.
- This endpoint reports total supply of included stablecoins, priced in USD.
- Yield-bearing wrappers are not counted as stablecoin supply unless explicitly classified that way.

## TVL User Flow

### Request flow

1. A client requests `GET /v1/metrics/tvl`.
2. The route is exposed as public via `authorizeRequest(true)`.
3. `MetricsController.getTvl()` calls `getTvlMetrics(accessToken)`.
4. The service gathers live data from the existing backend service layer.
5. The service normalizes positions into a common asset shape.
6. The service aggregates positions by underlying token address into top-level `assets`.
7. The service returns the raw balances, per-position breakdown, and summed USD totals.

### Buckets included in TVL

- CDP collateral
- Lending supplied underlying
- Lending collateral
- Pool reserves
- `saveUSDST` underlying
- Safety module underlying
- Vault underlying

### TVL inclusion rules

- Include assets currently locked in protocol-controlled contracts.
- Count underlying assets, not receipt/share tokens.
- Aggregate the same underlying token across buckets into one top-level asset row.

### TVL exclusion rules

- User wallet balances
- LP tokens
- Lending receipt tokens
- Vault share tokens
- Safety receipt tokens
- Other share/claim tokens that represent already-counted locked assets
- Protocol debt as additive TVL
- Any double counting of the same underlying across products

## Stablecoin User Flow

### Request flow

1. A client requests `GET /v1/metrics/stablecoins`.
2. The route is exposed as public via `authorizeRequest(true)`.
3. `MetricsController.getStablecoins()` calls `getStablecoinMetrics(accessToken)`.
4. The service loads active tokens and oracle prices.
5. The service builds token-classification context from live protocol state plus explicit registry entries.
6. Tokens are filtered to `includeInStablecoinSupply`.
7. The service returns per-asset total supply, price, and USD value.

### Stablecoin inclusion rules

- Include canonical STRATO stablecoins and recognized bridged stablecoins.
- Current intended production scope is `USDST`, `USDC`, and `USDT`.

### Stablecoin exclusion rules

- Exclude yield-bearing wrappers from stablecoin supply, even if they appear in TVL as locked assets.
- Current examples: `sUSDS` and `syrupUSDC`.

## Output Contract

### TVL response

Returns:

- `timestamp`
- `methodologyVersion`
- `totalUsd`
- `assets`: aggregated underlying assets across all included buckets
- `positions`: unaggregated per-bucket positions with `sourceBucket` and `sourceKey`
- `breakdown`: per-bucket detail

Important behavioral detail:

- Top-level `assets` are aggregated by token address from the raw `positions` set.
- `positions` preserve bucket-level provenance for debugging and review.

### Stablecoin response

Returns:

- `timestamp`
- `methodologyVersion`
- `totalUsd`
- `assets`: stablecoin supply rows with `address`, `name`, `symbol`, `decimals`, `totalSupply`, `priceUsd`, and `totalUsd`

## Data Dependencies

The metrics slice relies on the existing backend service layer rather than bespoke direct queries for each product bucket.

Key dependencies include:

- Oracle pricing
- CDP stats
- Lending liquidity and collateral state
- Swapping pools
- `saveUSDST`
- Safety module
- Vaults
- Token classification context

## Config And Classification Dependencies

### `saveUsdstVault`

`saveUSDST` TVL depends on `config.saveUsdstVault`. If this address is wrong or unset, the `saveUsdst` bucket will not reflect the intended deployed vault.

### Token registry

Explicit token registry entries are used to make token classification deterministic for:

- stablecoin supply filtering
- metal and bridged asset identification
- receipt/share token exclusion behavior
- known LP and protocol token handling

The token registry is intentionally not a full `BlockApps-Token` inventory. It is a canonical classification layer for protocol-relevant assets and known receipt/reward tokens.

## Error Handling

- The endpoints are read-only.
- Failures in required upstream reads bubble up through the controller and are handled by the backend error middleware.
- No protocol state is modified when requests fail.
- Missing or incorrect configuration can cause incomplete bucket coverage, especially for `saveUSDST`.

## Non-Goals

- These endpoints do not replace protocol-specific product APIs.
- They are not intended to expose every token on STRATO.
- They do not define stablecoin supply and TVL as the same metric.
- They are not intended to return receipt-token inventories.

## Reference Snapshots

Captured example outputs live at the repo root:

- `prod-tvl-output.json`
- `prod-stablecoins-output.json`

These are useful for review, adapter drafting, and PR preparation, but the deployed endpoints remain the source of truth.
