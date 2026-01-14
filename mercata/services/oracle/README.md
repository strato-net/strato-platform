# Price Oracle Service

Fetches asset prices from multiple sources and pushes them to the STRATO blockchain.

## Features

- **Batch Updates**: Multiple assets updated in single transaction
- **Configurable Interval**: Update schedule via `CRON_SCHEDULE` cron pattern (e.g., '0 */15 * * * *' for :00, :15, :30, :45 or '30 7,22,37,52 * * * *' for :07:30, :22:30, :37:30, :52:30)
- **Parallel Processing**: All feeds run simultaneously
- **Automatic Retry**: All API calls retry twice on failure
- **Health Monitoring**: Service marks itself unhealthy on persistent failures
- **Balance Checks**: Validates USDST balance before transactions
- **Transaction Metrics**: Records transaction timing data to AWS CloudWatch (optional)
- **Price Validation**: Drops invalid, non-finite, non-positive, or stale prices (older than 5 minutes)
- **Median Aggregation**: Uses median (not average) when multiple price sources are available
- **Anchoring Safety**: Rejects price updates that jump more than 15% from last-known-good price

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

## Price Aggregation & Safety

The oracle implements a robust price aggregation and validation flow:

### 1. Input Validation
For each asset, prices are collected from all configured sources and **dropped** if:
- Invalid / non-finite / non-positive
- Missing required fields (timestamp)
- Stale (older than 5 minutes)

If no valid prices remain after validation, the update for that asset is rejected.

### 2. Candidate Price Selection
- **≥ 2 valid prices**: `candidate = median(validPrices)`
  - With 2 prices, median is the average
  - With 3+ prices, median is the middle value
- **1 valid price**: `candidate = price`

### 3. Anchoring Safety Check
Computes deviation vs last-known-good price:

```
jump = |candidate - lastGood| / lastGood
```

- **If `jump ≤ 15%`**: Publish candidate and update last-known-good
- **If `jump > 15%`**: Reject update, retain last-known-good, log error

If no last-known-good price exists (first update), the candidate is accepted immediately. 
