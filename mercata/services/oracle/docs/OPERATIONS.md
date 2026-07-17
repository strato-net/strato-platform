# Price Oracle -- Operations Runbook

Step-by-step procedures for adding and removing assets and price sources. Use this when onboarding a new token or a new price provider.

- For **how the service works** -> [FLOW.md](FLOW.md)
- For **config and deployment** -> [README](../README.md)

---

## Contents

- [Add an asset](#add-an-asset)
  - [Plain asset](#plain-asset)
  - [Constant-price asset](#constant-price-asset)
  - [Yield-bearing token (exchangeRate)](#yield-bearing-token-exchangerate)
  - [Rebasing token](#rebasing-token)
- [Remove an asset](#remove-an-asset)
- [Add a source](#add-a-source)
- [Remove a source](#remove-a-source)

---

> **Note:** The source of truth for what is priced lives in two JSON config files: [`assets.json`](../src/config/assets.json) (what to price) and [`sources.json`](../src/config/sources.json) (where to fetch). Both are read once at startup by `ConfigLoader`. Changes require a redeploy.

---

## Add an asset

### Plain asset

Use for a standard token with market-price feeds from external providers (e.g. ETH, WBTC, PAXG).

> **Important:** A plain asset needs at least **3** sources (`MIN_VALID_SOURCES`) wired up in `sources.json`. If fewer are configured, `validateConfig()` will **block startup** with an error. Add the sources in the same change as the asset.

#### 1. Add to `assets.json`

```json
"NEWSYMBOL": {
  "targetAssetAddress": "40-hex-address-no-0x-prefix"
}
```

Optional fields:

| Field | When to use |
|:--|:--|
| `weekendProxy` | Asset whose sources to use when metals market is closed (e.g. `"PAXG"` for a gold asset). Assets with `weekendProxy` skip the 3-source startup check. |
| `equivalentAssets` | Other asset keys whose median to borrow as an extra source (e.g. `["XAUT"]` for XAU) |

#### 2. Wire up sources

For each external provider that should cover this asset, add the symbol to the source's `assets` array in [`sources.json`](../src/config/sources.json). If the provider uses a different identifier, add a `symbolMapping` entry:

```json
"CoinGecko": {
  "assets": ["ETH", "WBTC", "NEWSYMBOL"],
  "symbolMapping": {
    "NEWSYMBOL": "coingecko-id-for-newsymbol"
  }
}
```

You need the symbol in at least **3** different sources. At runtime, if fewer than 3 sources return a valid price for this asset during a cycle, the asset is skipped for that cycle (not submitted) but the service stays up.

#### 3. Redeploy

Restart the service so `ConfigLoader` picks up the new config.

#### 4. Verify

- Startup log: `ConfigValidator Configuration valid. N/M assets to submit, K sources.` (N should include the new asset).
- Cycle log: `CronScheduler Submitting N prices: [..., NEWSYMBOL, ...]`.
- `[FeedLogger]` block for `NEWSYMBOL` shows the price and `Sources: K/K`.
- Check the `PriceOracle` contract state on Cirrus to confirm the price landed.

---

### Constant-price asset

Use for a token with a hardcoded price (e.g. USDST pegged at $1).

#### 1. Add to `assets.json` with `constantPrice`

```json
"USDST": {
  "targetAssetAddress": "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  "constantPrice": 1000000000000000000
}
```

The value is in 1e18 scale (`1000000000000000000` = $1.00).

#### 2. Add to the `constant` source

In `sources.json`, add the symbol to the `constant` source's `assets` array:

```json
"constant": {
  "parse": "constant",
  "assets": ["USDST", "NEWSYMBOL"]
}
```

Constant-price assets require only **1** source (the `constant` source). No external provider needed.

#### 3. Redeploy + verify

Same as [plain asset](#plain-asset) steps 3-4.

---

### Yield-bearing token (exchangeRate)

Use for tokens that have a market price **and** an on-chain exchange rate (rETH, wstETH, sUSDS, syrupUSDC, weETH, Aave aTokens). Both the price and the exchange rate are pushed to the `PriceOracle` contract.

#### 1. Add with market-price sources

Follow [plain asset](#plain-asset) steps 1-2 to add the asset to `assets.json` and wire up market-price sources.

#### 2. Add the `exchangeRate` block

In `assets.json`, add an `exchangeRate` object alongside the `targetAssetAddress`:

```json
"RETH": {
  "targetAssetAddress": "2e4789eb7db143576da25990a3c0298917a8a87d",
  "exchangeRate": {
    "rateUrl": "https://eth-mainnet.g.alchemy.com/v2/${API_KEY}",
    "rateMethod": "POST",
    "rateBody": "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"0xae78736Cd615f374D3085123A210448E74Fc6393\",\"data\":\"0xe6aa216c\"},\"latest\"]}",
    "rateParse": "result",
    "ratePrecision": "1000000000000000000",
    "rateApiKeyEnvVar": "ALCHEMY_API_KEY"
  }
}
```

| Field | How to fill |
|:--|:--|
| `rateUrl` | Typically Alchemy mainnet RPC. `${API_KEY}` is substituted from the env var. |
| `rateMethod` | `POST` for JSON-RPC `eth_call`. Defaults to `GET` if omitted. |
| `rateBody` | ABI-encoded call. `"to"` = Ethereum contract, `"data"` = function selector + args. |
| `rateParse` | JSON path to extract the rate value from the response (e.g. `"result"` for `eth_call` hex). |
| `ratePrecision` | Raw response precision: `"1000000000000000000"` (1e18/WAD) for most; `"1000000"` (1e6) for 6-decimal tokens like syrupUSDC; `"1000000000000000000000000000"` (1e27/RAY) for Aave. |
| `rateApiKeyEnvVar` | Usually `ALCHEMY_API_KEY`. |
| `rateHeaders` | Optional. Comma-separated header names that receive the API key. |

#### 3. Redeploy + verify

- Cycle log: `CronScheduler RETH: exchangeRate=<wadRate> (raw=<rawRate>)`.
- `OraclePusher Exchange rates pushed for N asset(s)`.
- On-chain: `PriceOracle.setExchangeRates` tx succeeds.

---

### Rebasing token

Use for tokens that derive their price from an underlying asset times a rebase factor (Aave aTokens, xStock wrappers). Market-price sources for the rebasing token itself are **not** needed -- only the underlying's sources matter.

#### 1. Ensure the underlying asset exists

The `rebase.underlyingAsset` must be a key in `assets.json`. It can have `submit: false` if only used as an underlying (e.g. SPYX for WSPYX, TSLAX for WTSLAX, WEETH for AWEETH).

> **Important:** Even with `submit: false`, the underlying still needs at least **3** sources wired up in `sources.json` to produce a valid median at runtime. The startup validator does not enforce this for `submit: false` assets, but at runtime `aggregatePrices` will mark the underlying as `failed` if fewer than 3 sources return a price — and the rebased asset silently gets no price that cycle.

#### 2. Add the rebasing asset

```json
"AWETH": {
  "targetAssetAddress": "6d40952f0895d21d2bf20cd088f0eb9a1574583f",
  "rebase": {
    "underlyingAsset": "ETH",
    "factorUrl": "https://eth-mainnet.g.alchemy.com/v2/${API_KEY}",
    "factorMethod": "POST",
    "factorBody": "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2\",\"data\":\"0xd15e0053000000000000000000000000C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\"},\"latest\"]}",
    "factorParse": "result",
    "factorPrecision": "1000000000000000000000000000",
    "factorApiKeyEnvVar": "ALCHEMY_API_KEY"
  }
}
```

Rebasing assets do **not** need entries in `sources.json` -- they derive their price entirely from the underlying. The startup validator skips the `MIN_VALID_SOURCES` check for them.

Optional fields not shown above: `factorHeaders` (comma-separated header names that receive the API key, analogous to `rateHeaders`). See [FLOW.md](FLOW.md#rebaseconfig) for the full schema.

> **Note:** If the asset also needs an on-chain exchange rate (common for Aave aTokens), add an `exchangeRate` block too -- both `rebase` and `exchangeRate` can coexist on the same asset. See [yield-bearing token](#yield-bearing-token-exchangerate) for the `exchangeRate` fields.

#### 3. Redeploy + verify

- Cycle log: `CronScheduler AWETH: rebased price $X.XXXX (underlying=$Y.YYYY, wadFactor=Z)`.
- `OraclePusher Rebase factors pushed for N asset(s)`.
- The rebased asset appears in `Submitting N prices: [...]` (it is submitted as a regular price).

---

## Remove an asset

### Full removal

Delete the asset's entry from `assets.json`. Redeploy. The service no longer prices it. The on-chain price remains at its last submitted value until governance updates or zeroes it.

### Keep as proxy/underlying only

If the asset is still needed as a weekend proxy or equivalent or rebase underlying for another asset, keep it with `submit: false` instead of deleting:

```json
"KAG": {
  "targetAssetAddress": "...",
  "submit": false
}
```

The service still aggregates the price internally but does not submit it on-chain. Current examples: KAG, SPYX, TSLAX, WEETH.

### Verify

- `ConfigValidator` log should show a reduced submission count.
- The asset should not appear in `Submitting N prices: [...]`.

---

## Add a source

### 1. Add to `sources.json`

```json
"NewSource": {
  "url": "https://api.newsource.com/v1/prices",
  "params": "apikey,symbols",
  "headers": "X-Api-Key",
  "parse": "data.{symbol}.price",
  "timestamp": "data.{symbol}.timestamp",
  "apiKeyEnvVar": "NEWSOURCE_API_KEY",
  "assets": ["ETH", "WBTC"],
  "symbolMapping": {
    "ETH": "ethereum",
    "WBTC": "bitcoin-wrapped"
  }
}
```

| Field | Notes |
|:--|:--|
| `url` | Supports `${API_KEY}`, `${ACCOUNT_ID}`, `${SYMBOLS}` substitution. Optional for the `constant` source. |
| `method` | HTTP method. Defaults to `GET`. Use `POST` for JSON-RPC style APIs. |
| `params` | Comma-separated query params. `apikey` is replaced with the resolved API key. |
| `headers` | Comma-separated header names that receive the API key (e.g. `"X-Api-Key"`, `"Authorization"`) |
| `body` | Request body key (for POST requests). |
| `parse` | JSON path pattern. `{symbol}` is replaced per-asset. Special parsers: `"defiLlama"`, `"oanda.prices"`, `"assets"` (CoinAPI), `"constant"`. |
| `timestamp` | JSON path for extracting the feed timestamp from the response. |
| `apiKeyEnvVar` | Environment variable name for the API key (e.g. `"COINGECKO_API_KEY"`). |
| `accountIdEnvVar` | Environment variable for account ID, used by OANDA (`"OANDA_ACCOUNT_ID"`). |
| `symbolMapping` | Maps asset keys to API-specific identifiers. If absent, the asset key itself is used. |
| `assets` | Which assets this source covers. Must reference keys that exist in `assets.json`. |

### 2. Add the API key

Add the env var (e.g. `NEWSOURCE_API_KEY`) to `.env` and the deployment secret store. If the key is missing, `validateConfig()` errors and blocks startup.

### 3. Redeploy + verify

- Startup: `ConfigValidator Configuration valid. ...` (no new errors).
- First cycle: `CronScheduler N/M sources: [... NewSource (Xms) ...]` in the succeeded list.
- Assets covered by the new source show an increased source count in `[FeedLogger]` output.

---

## Remove a source

### Full removal

Delete the source's entry from `sources.json`. Redeploy.

### Narrow scope

Remove specific assets from the source's `assets` array instead of deleting the entire source. The source will still run for its remaining assets.

### Check remaining coverage

Before removing, ensure every affected plain asset still has >= **3** other sources in `sources.json`. If not:

- The startup validator will **block startup** with an error for any plain asset below 3 sources.
- Add another source first ([Add a source](#add-a-source)), or set `submit: false` on the undercovered asset.
- At runtime, even with 3+ sources configured, if some sources fail during a cycle and fewer than 3 return a valid price, the asset is skipped for that cycle (not submitted) and `logError` fires.

### Verify

- Startup: `ConfigValidator Configuration valid. ...` with the source no longer listed.
- Assets that lost a source show a decreased source count in `[FeedLogger]` output.
