# Price Oracle -- How it works

This document walks through one full price cycle from cron trigger to on-chain write.

---

## Entry point

[`index.ts`](../src/index.ts) is the entry point. On boot the service:

1. `dotenv.config()` at module level.
2. Express `/health` starts listening on `HEALTH_PORT` (default `3000`) — also at module level, **before** `main()` is called. The health endpoint is reachable before validation completes.
3. `main()` runs:
   1. `validateConfig()` — validates required env vars, OAuth credentials, `assets.json` / `sources.json` structure and cross-references (minimum sources per asset, constant-price wiring, rebase underlying references, weekend-proxy source counts). Exits on failure.
   2. `startCronScheduler()` in [`cronScheduler.ts`](../src/cronScheduler.ts) — creates a `ConfigLoader`, schedules a `node-cron` job on `CRON_SCHEDULE`, and fires one immediate run via `setTimeout(job, 1000)`.

---

## The cycle (`processAllAssets`)

Each cron tick runs `processAllAssets(configLoader)`. Steps:

### 1. OAuth pre-warm

```
oauthClient().validateToken()
```

Warms the token cache before the parallel fan-out so all downstream calls share the same token.

### 2. Parallel pre-flight

Two calls in parallel:

| Call | What it does |
|:--|:--|
| `checkBalances()` | Fetches the service account's Voucher + USDST balances from Cirrus (`BlockApps-Voucher-_balances`, `BlockApps-Token-_balances`). Estimates how many transactions the balance supports. Calls `logError` (which marks unhealthy) if below `MIN_TRANSACTIONS_THRESHOLD`. Calls `process.exit(1)` if fewer than 1 transaction is possible. |
| `fetchPreviousPrices()` | Reads the current on-chain price map from Cirrus (`BlockApps-PriceOracle-prices` table, `key` = asset address, `value` = price). Returns `Map<address, price>` for later change-detection alerts. Returns empty map on failure (non-blocking). |

### 3. Market status

```
const marketClosed = isMetalsMarketClosed();
```

Checks whether precious-metals markets are closed based on New York (ET) time:

- **Closed**: Friday noon ET through Monday 5:30 AM ET (inclusive of Saturday and Sunday).
- **Open**: all other times.

Used by aggregation (step 4) to decide whether to use weekend proxy feeds for metals.

### 4. Fetch from all sources

```
fetchFromAllSources(configLoader) -> Map<sourceName, SourceResult>
```

Iterates every entry in `sources.json`. For each source:

- Calls `fetchPrices(sourceConfig)` from [`genericRestAdapter.ts`](../src/adapters/genericRestAdapter.ts) with a `withTimeout(TIMEOUTS.FETCH)` wrapper (default 30 s).
- Special case: the `constant` source calls `generateConstantPrices()` which returns the `constantPrice` value from `assets.json` for each asset it covers (e.g. USDST = 1e18).
- If a source fails (timeout, HTTP error, parse error), it is logged as a warning and dropped -- it does **not** abort the cycle.
- All sources run in parallel via `Promise.all`.

Returns a map of `sourceName -> { prices: { [assetKey]: { price, feedTimestamp } }, success, duration }`.

### 5. Aggregate prices

```
aggregatePrices(configLoader, sourceResults, marketClosed, previousPrices) -> AggregatedPrice[]
```

Per asset (excluding `rebase` assets, which are handled in step 7):

1. **Required source count**: `constantPrice` assets need only 1; everything else needs `ORACLE_CONFIG.MIN_VALID_SOURCES` (currently **3**).

2. **Weekend proxy logic**: if the asset has `weekendProxy` and `marketClosed === true`:
   - First, try collecting sources for the proxy symbol (e.g. `PAXG` for `XAU`).
   - If enough proxy sources exist, use them. Otherwise, fall back to the asset's own weekday sources.

3. **Collect prices**: for each source that covers this asset, pull the price from the source result map.

4. **Validate**: if collected sources < required, the asset is marked `failed` with an error message and an `logError` call. It will not be submitted.

5. **Median**: `calculateMedian()` sorts the source prices and picks the middle value. For even-length arrays, it takes `floor((a + b) / 2)` -- integer arithmetic, no rounding up. All prices are in 1e18 (wei) scale.

6. **Divergence alert**: if the max-min spread among sources exceeds `MAX_SOURCE_DIVERGENCE_PERCENT` (5%), a warning is logged. The price is still submitted.

7. **Price-change alert**: if the new median differs from the previous on-chain price by more than `MAX_PRICE_CHANGE_PERCENT` (20%), a warning is logged. The price is still submitted.

> Both alerts are advisory-only -- they fire `logWarning` (which also forwards to Slack if configured) but do **not** block submission.

### 6. Equivalent asset prices

```
addEquivalentAssetPrices(prices, configLoader) -> AggregatedPrice[]
```

If an asset has `equivalentAssets` in its config (e.g. `XAU` lists `["XAUT"]`), this function:

1. Finds the equivalent asset's already-aggregated median.
2. Adds it as one additional synthetic source (named `"XAUT(equiv)"`).
3. Recalculates the median with the extra source.
4. If the asset was previously `failed` (insufficient sources) and now has >= `MIN_VALID_SOURCES`, it is un-failed.

This rescues assets that have too few direct feeds by borrowing prices from equivalent assets.

### 7. Rebase factors

```
applyRebaseFactors(prices, configLoader, previousPrices) -> RebaseFactorEntry[]
```

Only for assets with a `rebase` config block (e.g. AWETH, AWBTC, AWEETH, AWSTETH, AUSDC, AUSDT, WSPYX, WTSLAX). For each:

1. Look up the underlying asset's aggregated median from step 5 (e.g. ETH for AWETH, WBTC for AWBTC).
2. Fetch the raw rebase factor via `fetchRebaseFactor()` -- typically an `eth_call` to Aave's `getReserveNormalizedIncome()` or xStock's `getCurrentMultiplier()`, routed through Alchemy.
3. Normalize to WAD: `wadFactor = rawFactor * 1e18 / factorPrecision` (precision is `1e27` for Aave RAY, `1e18` for xStock WAD).
4. Compute rebased price: `rebasedPrice = underlyingMedian * rawFactor / factorPrecision`.
5. Push the rebased price back into the `prices` array as a normal `AggregatedPrice` (1 source, the synthetic `"ETH×rebaseFactor(...)"` source).
6. Collect `{ targetAddress, wadFactor }` for on-chain submission.
7. Run price-change alert against previous on-chain price.

### 8. Exchange rates

```
collectExchangeRates(configLoader) -> ExchangeRateEntry[]
```

For assets with an `exchangeRate` config block (RETH, SUSDS, SYRUPUSDC, WSTETH, WEETH, and all Aave aTokens). For each:

1. `fetchExchangeRate()` issues an `eth_call` via Alchemy (e.g. `rETH.getExchangeRate()`, `wstETH.stEthPerToken()`, `sUSDS.convertToAssets(1e18)`).
2. Normalize: `wadRate = rawRate * 1e18 / ratePrecision`. `ratePrecision` is `1e18` for most, `1e6` for syrupUSDC, `1e27` for Aave RAY.
3. Collect `{ targetAddress, wadRate }` for on-chain submission.

> Exchange rates and rebase factors are fetched in parallel via `Promise.all([applyRebaseFactors(...), collectExchangeRates(...)])`.

### 9. Partition and submit

1. Partition `prices` into `validPrices` (no `failed` flag) and `failedPrices`. Assets with `submit: false` (proxy-only feeds like KAG, SPYX, TSLAX, WEETH) are excluded from both.
2. If `validPrices` is empty, throw `'No valid prices to submit'` -- the cycle aborts.
3. Push in parallel:

| Push | Contract method | Data |
|:--|:--|:--|
| `pushAssetPrices(validPrices)` | `PriceOracle.setAssetPrices(address[], uint256[])` | `[targetAddress, ...]`, `[medianPrice, ...]` |
| `pushRebaseFactors(factors)` | `PriceOracle.setRebaseFactors(address[], uint256[])` | `[targetAddress, ...]`, `[wadFactor, ...]` |
| `pushExchangeRates(rates)` | `PriceOracle.setExchangeRates(address[], uint256[])` | `[targetAddress, ...]`, `[wadRate, ...]` |

4. Log each asset's feed details via `logFeedUpdate()` (including failed ones, for visibility).

---

## Anatomy of a write

All three push functions go through the same path: `callListAndWait()` in [`oraclePusher.ts`](../src/utils/oraclePusher.ts).

### Stage 1 -- Build `CallListArg[]`

```ts
{
  contract: { address: PRICE_ORACLE_ADDRESS, name: "PriceOracle" },
  method: "setAssetPrices",  // or setRebaseFactors, setExchangeRates
  args: {
    assets:      [...targetAddresses],
    priceValues: [...medianPrices],   // or factors / rates
  },
}
```

### Stage 2 -- Build transaction payload

```ts
{
  txs: [{ type: "FUNCTION", payload: { contractName, contractAddress, method, args } }],
  txParams: { gasLimit: 32_100_000_000, gasPrice: 10 },
}
```

### Stage 3 -- Submit

POST to `${STRATO_NODE_URL}/bloc/v2.2/transaction/parallel?resolve=true` with Bearer token.

Timeout: `TIMEOUTS.SUBMIT` (20 s).

### Stage 4 -- Evaluate immediate result

The `resolve=true` flag asks STRATO to try returning the result inline. Three outcomes:

| Inline status | Action |
|:--|:--|
| `Success` | Return immediately with hash. |
| `Failed` / `Failure` | Throw with the contract error message. |
| `Pending` or absent | Fall through to polling. |

### Stage 5 -- Poll for result (if pending)

POST `[txHash]` to `${STRATO_NODE_URL}/bloc/v2.2/transactions/results`. Retries every `RETRY_DELAYS.STATUS` (2 s) up to `TIMEOUTS.WAIT` (180 s). On `Success`, return. On `Failed`/`Failure`, throw. On timeout, throw.

### Stage 6 -- Record metrics

If `CLOUDWATCH_NAMESPACE` is set, `txMetricsService.recordTxMetric()` pushes `{ txHash, duration, status }` to CloudWatch.

---

## Error handling

| Error kind | Behavior |
|:--|:--|
| **Single source fetch failure** | Logged as warning (`logWarning`); source dropped for this cycle. Other sources proceed. If an asset falls below `MIN_VALID_SOURCES`, that asset is marked `failed` and excluded from submission -- all other assets still submit. |
| **Rebase factor fetch failure** | Logged as error; that rebased asset is skipped. Others proceed. |
| **Exchange rate fetch failure** | Logged as error; that rate is skipped. Others proceed. |
| **No valid prices** | `throw new Error('No valid prices to submit')` -- cycle aborts, caught at the top of `job` in `startCronScheduler`, logged as error. Next cron tick retries. |
| **Transaction failure** | Thrown from `callListAndWait` → `waitForTransaction`. Caught at `job` level, logged as error. Next cron tick retries. |
| **Transaction timeout** (> 180 s) | Same as transaction failure. |
| **Balance below threshold** | `logError` marks unhealthy via error flag file. If < 1 tx possible, `process.exit(1)`. |
| **OAuth failure** | Thrown from `validateToken()`, caught at `main()`, `process.exit(1)`. |

### Health file mechanics

- `logError()` appends to `oracle-error.flag` (via [`healthMonitor.ts`](../src/utils/healthMonitor.ts)). The `/health` endpoint returns 500 if this file exists and is non-empty.
- `logWarning()` appends to `oracle-warning.log` (informational; does not affect `/health`).
- Both `logWarning` and `logError` forward to Slack (if `SLACK_BOT_TOKEN` is set) with contextual emoji.

---

## What lives on-chain vs in this service

| Concern | Location |
|:--|:--|
| Per-asset price + timestamp | `PriceOracle` contract (`setAssetPrices`) |
| Rebase factors | `PriceOracle` contract (`setRebaseFactors`) |
| Exchange rates | `PriceOracle` contract (`setExchangeRates`) |
| What assets to price | `src/config/assets.json` |
| Where to fetch prices | `src/config/sources.json` |
| API keys, credentials, schedule | Environment variables |
| How to parse each source's response | `genericRestAdapter.ts` + `sources.json` parse patterns |

---

## `assets.json` schema reference

Each key in the `"assets"` object is the asset symbol (e.g. `"ETH"`). The value is:

| Field | Type | Required | Purpose |
|:--|:--|:--|:--|
| `targetAssetAddress` | `string` (40 hex) | yes | On-chain address the PriceOracle stores the price under |
| `constantPrice` | `number` | no | Hardcoded price in 1e18 scale (e.g. USDST = `1000000000000000000`). Source count required drops to 1. |
| `weekendProxy` | `string` | no | Proxy asset symbol to fetch during metals market closure (e.g. `"PAXG"` for XAU) |
| `equivalentAssets` | `string[]` | no | Asset keys whose aggregated median can be borrowed as an extra source (e.g. `["XAUT"]` for XAU) |
| `submit` | `boolean` | no | `false` to exclude from on-chain submission. Used for proxy-only feeds (KAG, SPYX, TSLAX, WEETH). Default `true`. |
| `rebase` | `RebaseConfig` | no | See below |
| `exchangeRate` | `ExchangeRateConfig` | no | See below |

### `RebaseConfig`

Used for rebasing tokens (aTokens, xStock wrappers). Price = `underlying.median * factor / precision`.

| Field | Purpose |
|:--|:--|
| `underlyingAsset` | Asset key in `assets.json` whose price is the base (e.g. `"ETH"` for AWETH) |
| `factorUrl` | REST/RPC endpoint (supports `${STRATO_NODE_URL}`, `${API_KEY}` substitution) |
| `factorMethod` | HTTP method (default `GET`; use `POST` for JSON-RPC `eth_call`) |
| `factorBody` | JSON body template for POST requests |
| `factorParse` | JSON path to extract the raw factor (e.g. `"result"` for `eth_call` hex response) |
| `factorPrecision` | Divisor for the raw factor (`1e27` for Aave RAY, `1e18` for WAD) |
| `factorApiKeyEnvVar` | Env var holding the API key |
| `factorHeaders` | Optional. Comma-separated header names that receive the API key |

### `ExchangeRateConfig`

Used for yield-bearing tokens (rETH, wstETH, sUSDS, syrupUSDC, weETH, aTokens).

| Field | Purpose |
|:--|:--|
| `rateUrl` | REST/RPC endpoint |
| `rateMethod` | HTTP method |
| `rateBody` | JSON body template |
| `rateParse` | JSON path to extract the raw rate |
| `ratePrecision` | Native precision (`1e18` for WAD, `1e6` for 6-decimal, `1e27` for RAY) |
| `rateApiKeyEnvVar` | Env var holding the API key |
| `rateHeaders` | Optional. Comma-separated header names that receive the API key |

---

## `sources.json` schema reference

Each key is the source name (e.g. `"CoinGecko"`). The value is:

| Field | Type | Required | Purpose |
|:--|:--|:--|:--|
| `url` | `string` | yes (except `constant`) | Fetch URL. Supports `${API_KEY}`, `${ACCOUNT_ID}`, `${SYMBOLS}` substitution. |
| `params` | `string` | no | Comma-separated URL query parameters |
| `headers` | `string` | no | Comma-separated header names that receive the API key |
| `parse` | `string` | yes | JSON path pattern for extracting prices from the response |
| `timestamp` | `string` | no | JSON path for extracting the feed timestamp |
| `apiKeyEnvVar` | `string` | no | Env var name for the API key |
| `accountIdEnvVar` | `string` | no | Env var name for account ID (OANDA) |
| `symbolMapping` | `Record<string, string>` | no | Maps asset keys to API-specific identifiers |
| `assets` | `string[]` | yes | Which asset keys this source covers |
