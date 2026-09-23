# Price Oracle Service

Fetches asset prices from multiple sources and pushes them to the STRATO blockchain.

Oracle config is keyed by network in `assets.json` (`networks[ORACLE_NETWORK_ID]`). Set `ORACLE_NETWORK_ID` to the upquark network ID on production (`33056204878082667`) and to the helium network ID on testnet (`114784819836269`). Each block has complete `assets` and `sources`.

## Price-only feeds (symbol-derived keys)

`PriceOracle` keys prices by address, so an asset with no STRATO token still needs one. For assets that
are priced but not tokenized — commodities, or L1s with no bridge route — `targetAssetAddress` is **the
feed symbol as left-aligned ASCII, zero-padded to 20 bytes**, and the feed behaves like any other: median
of the sources, same batch push, same `prices` row in Cirrus.

| Key | Asset | Quote |
| --- | --- | --- |
| `4252454e54000000000000000000000000000000` | `BRENT` | Brent crude, USD/barrel, ICE front-month |
| `444f474500000000000000000000000000000000` | `DOGE` | Dogecoin, USD |

Derive one, or read one back:

```bash
python3 -c "print('BRENT'.encode().hex().ljust(40,'0'))"
python3 -c "print(bytes.fromhex('4252454e54000000000000000000000000000000').rstrip(b'\0').decode())"
```

Consumers read them exactly like a token price, and the existing contract tests already exercise a bare
address as a price key. Two things to know:

- **Nothing is deployed at these addresses.** There is no token, no balance and no pool. They will not
  appear in `/tokens`, the dashboard or price-tracking, all of which build their universe from deployed
  tokens. `/oracle/price?asset=…` and `/oracle/price-history/:assetAddress` serve them directly.
- **No registry is needed.** The key is a function of the symbol, so two feeds added in parallel cannot
  collide, and a `prices` row decodes back to its symbol with no lookup. Symbols are limited to 20
  characters and uppercase ASCII. `deadbeef` remains used by proxy-only assets that are never submitted.

## Features

- **Median Aggregation**: Robust price calculation using median of all valid sources
- **Minimum Source Requirement**: Requires at least 3 valid sources to submit a price
- **Batch Updates**: Multiple assets updated in single transaction
- **Configurable Interval**: Update schedule via `CRON_SCHEDULE` cron pattern (e.g., '0 */15 * * * *' for :00, :15, :30, :45 or '30 7,22,37,52 * * * *' for :07:30, :22:30, :37:30, :52:30)
- **Parallel Processing**: All feeds run simultaneously
- **Automatic Retry**: All API calls retry twice on failure
- **Health Monitoring**: Service marks itself unhealthy on persistent failures
- **Balance Checks**: Validates USDST balance before transactions
- **Transaction Metrics**: Records transaction timing data to AWS CloudWatch (optional)
- **Weekend Fallback**: Metals weekend feed falls back to metals-batch prices when insufficient sources

## Environment Variables

```env
# STRATO Configuration
STRATO_NODE_URL=https://node1.testnet.strato.nexus/
PRICE_ORACLE_ADDRESS=0000000000000000000000000000000000001002
ORACLE_NETWORK_ID=114784819836269  # helium testnet; production: 33056204878082667 (upquark)

# OAuth Configuration
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid_configuration

# API Keys
ALCHEMY_API_KEY=your-alchemy-key
COINMARKETCAP_API_KEY=your-coinmarketcap-key
COINGECKO_API_KEY=your-coingecko-api-key
METALS_DEV_API_KEY=your-metals-dev-key
METALS_API_API_KEY=your-metals-api-key
COMMODITIES_API_KEY=your-commodities-api-key
COMMODITY_PRICE_API_KEY=your-commodity-price-api-key
COINAPI_API_KEY=your-coinapi-api-key
DEFILLAMA_API_KEY=your-defillama-api-key  # Pro/API plan: https://defillama.com/subscription
TWELVEDATA_API_KEY=your-twelvedata-key
OANDA_API_KEY=your-oanda-api-key
OANDA_ACCOUNT_ID=your-oanda-account-id  # Fetch via: curl -H "Authorization: Bearer API_KEY" https://api-fxpractice.oanda.com/v3/accounts

# Oracle Configuration
CRON_SCHEDULE="0 */15 * * * *"

# Token Configuration (Optional)
USDST_ADDRESS=86a5ae535ded415203c3e27d654f9a1d454c553b  # USDST contract address
GAS_FEE_USDST=1  # Gas fee in USDST (0.01 = 1, default: 1)

# AWS Configuration (for CloudWatch Metrics - Optional)
# Leave CLOUDWATCH_NAMESPACE empty to disable metrics
AWS_REGION=us-east-1
CLOUDWATCH_NAMESPACE=Testnet/Oracle/Transactions
```

## Development

```bash
npm install
npm run build
npm run dev
```

## Health Check

```bash
curl http://localhost:3000/health
```

**Response:**
- **200 OK**: Service is healthy
- **503 Service Unavailable**: Service is unhealthy (after retry failure)

## Health Monitoring

The service automatically marks itself as unhealthy when:
- Any API source fails twice in a row
- Transaction submission fails twice in a row  
- USDST balance check fails twice in a row
- USDST balance is below minimum threshold (10 USDST) 
