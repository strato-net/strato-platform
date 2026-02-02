# Price Oracle Service

Fetches asset prices from multiple sources and pushes them to the STRATO blockchain.

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
STRATO_NODE_URL=https://node1.mercata-testnet.blockapps.net/
PRICE_ORACLE_ADDRESS=0000000000000000000000000000000000001002

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
COINAPI_API_KEY=your-coinapi-api-key
LIVECOINWATCH_API_KEY=your-livecoinwatch-api-key

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
