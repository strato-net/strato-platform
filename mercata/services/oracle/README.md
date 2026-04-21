# Price Oracle Service

The oracle is a long-running Node service. It fetches asset prices from multiple external providers (Alchemy, CoinGecko, CoinMarketCap, DefiLlama, CoinAPI, TwelveData, OANDA, Metals.dev, MetalsAPI, CommodityPriceAPI), aggregates each asset's price by median (minimum 3 valid sources), and pushes the result to the `PriceOracle` contract on STRATO. Three write methods are used: `setAssetPrices`, `setRebaseFactors`, and `setExchangeRates`.

- **How it works end-to-end** -> [docs/FLOW.md](docs/FLOW.md)
- **Runbooks -- add/remove an asset, add/remove a source** -> [docs/OPERATIONS.md](docs/OPERATIONS.md)

---

## Source map

```text
src/
├── index.ts                          Express /health, startup, calls startCronScheduler()
├── cronScheduler.ts                  Main orchestrator: processAllAssets(), cron, median, aggregation
├── adapters/
│   └── genericRestAdapter.ts         Universal REST adapter driven by sources.json; also fetchRebaseFactor, fetchExchangeRate, generateConstantPrices
├── config/
│   ├── assets.json                   What to price: targetAssetAddress, constantPrice, weekendProxy, equivalentAssets, rebase, exchangeRate, submit
│   └── sources.json                  Where to fetch: url, params, parse, headers, apiKeyEnvVar, symbolMapping, assets
├── types/
│   └── index.ts                      Asset, SourceConfig, RebaseConfig, ExchangeRateConfig, AggregatedPrice, CallListArg, etc.
└── utils/
    ├── oraclePusher.ts               pushAssetPrices, pushRebaseFactors, pushExchangeRates + callListAndWait + waitForTransaction
    ├── priceReader.ts                Fetches previous on-chain prices from Cirrus for change detection
    ├── balanceChecker.ts             Pre-flight USDST + Voucher balance check; exits on critically low balance
    ├── configLoader.ts               Loads assets.json + sources.json, resolves API keys from env
    ├── validateConfig.ts             Startup validation: env vars, OAuth, asset/source cross-refs, MIN_VALID_SOURCES
    ├── oauth.ts                      STRATO OpenID auth (token + user address)
    ├── apiClient.ts                  Axios wrapper with retry (withRetry) and withTimeout
    ├── healthMonitor.ts              Error/warning flag files for /health
    ├── logger.ts                     Structured console logging with secret redaction + Slack forwarding
    ├── slackNotifier.ts              Sends warnings/errors to Slack (optional, needs SLACK_BOT_TOKEN)
    ├── txMetricsService.ts           CloudWatch transaction metrics (optional, needs CLOUDWATCH_NAMESPACE)
    └── constants.ts                  ORACLE_CONFIG, TIMEOUTS, GAS_PARAMS, RETRY_DELAYS, CONSTANTS (balance thresholds)
```

---

## Configuration

### Required environment variables

| Variable | Purpose |
| - | - |
| `STRATO_NODE_URL` | STRATO node base URL |
| `PRICE_ORACLE_ADDRESS` | PriceOracle contract address (no `0x` prefix) |
| `USERNAME`, `PASSWORD` | BlockApps credentials |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | OAuth client credentials |
| `OAUTH_DISCOVERY_URL` | OpenID discovery endpoint |
| `ALCHEMY_API_KEY` | Alchemy (prices + exchange-rate/rebase `eth_call`) |
| `COINMARKETCAP_API_KEY` | CoinMarketCap |
| `COINGECKO_API_KEY` | CoinGecko Pro |
| `METALS_DEV_API_KEY` | Metals.dev |
| `METALS_API_API_KEY` | MetalsAPI |
| `COMMODITY_PRICE_API_KEY` | CommodityPriceAPI |
| `COINAPI_API_KEY` | CoinAPI |
| `DEFILLAMA_API_KEY` | DefiLlama Pro |
| `TWELVEDATA_API_KEY` | TwelveData |
| `OANDA_API_KEY`, `OANDA_ACCOUNT_ID` | OANDA |

### Optional environment variables

| Variable | Default | Purpose |
| - | - | - |
| `HEALTH_PORT` | `3000` | Express port for `/health` |
| `CRON_SCHEDULE` | `0 */15 * * * *` (every 15 min) | 6-field cron (includes seconds) |
| `USDST_ADDRESS` | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` | USDST token for balance check |
| `VOUCHER_ADDRESS` | `000000000000000000000000000000000000100e` | Voucher token for balance check |
| `GAS_FEE_USDST` | `1` (= 0.01 USDST) | Gas estimate per tx, multiplied by 1e16 |
| `GAS_FEE_VOUCHER` | `100` (= 1 Voucher) | Gas estimate per tx, multiplied by 1e16 |
| `MIN_TRANSACTIONS_THRESHOLD` | `100` | Mark unhealthy if estimated txs remaining <= this |
| `SLACK_BOT_TOKEN` | _(disabled)_ | Slack bot token for warning/error notifications |
| `SLACK_WARNING_CHANNEL` | `#ops-monitoring` | Slack channel |
| `ORACLE_NAME` | `Dev Oracle` | Identifier in Slack messages |
| `AWS_REGION` | `us-east-1` | CloudWatch region |
| `CLOUDWATCH_NAMESPACE` | _(disabled)_ | Set to enable tx metrics (e.g. `Testnet/Oracle/Transactions`) |

### Config JSON files

- [`src/config/assets.json`](src/config/assets.json) -- one entry per asset. See [FLOW.md](docs/FLOW.md) for the full schema. Current categories: crypto (ETH, WBTC), stablecoins (USDC, USDT, USDST), precious metals (XAU, XAG), gold-backed tokens (PAXG, XAUT), yield-bearing (RETH, WSTETH, SUSDS, SYRUPUSDC, WEETH), Aave aTokens (AWETH, AWBTC, AWEETH, AWSTETH, AUSDC, AUSDT), xStock wrappers (WSPYX, WTSLAX), and proxy-only feeds (KAG, SPYX, TSLAX, WEETH).
- [`src/config/sources.json`](src/config/sources.json) -- one entry per external price provider. Each entry declares the URL, parse path, API-key env var, and which assets it covers. See [OPERATIONS.md -- Add a source](docs/OPERATIONS.md#add-a-source).

---

## Running

```bash
npm install
npm run build
npm run dev     # development
npm start       # production
```

The service runs one cycle immediately on startup, then schedules `CRON_SCHEDULE`.

## Health check

```
GET /health
```

- **200** -- healthy (no `oracle-error.flag` file).
- **500** -- unhealthy (`oracle-error.flag` exists and is non-empty).

The flag file is appended to by `logError()` (every error call writes to it). To recover, fix the underlying issue, delete the flag, and restart.
