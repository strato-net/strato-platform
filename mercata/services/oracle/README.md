# Price Oracle Service

A high-performance, production-ready price oracle service for the Mercata lending platform. Fetches real-time asset prices from multiple sources and pushes them to the STRATO blockchain with round-based consensus and automatic finalization.

## 🚀 Features

### **Multi-Node Support**
- **Parallel Feed Processing**: All feeds run simultaneously for maximum efficiency
- **Single Blockchain Transaction**: All assets updated in one transaction (7 assets = 1 TX)
- **Instance Identification**: Each oracle instance has unique ID and logging
- **Basic Health Checks**: Simple health endpoint with service status
- **Configurable Update Interval**: Update frequency configurable via environment variable (1-60 minutes)

### **Simple Price Oracle Contract**
- **Direct Price Updates**: Immediate price updates without round-based consensus
- **Batch Updates**: Multiple assets updated in single transaction
- **Authorized Oracle System**: Only authorized oracle addresses can submit prices
- **Price Validation**: Ensures prices are greater than zero
- **Timestamp Tracking**: Records when each price was last updated
- **Owner Controls**: Owner can authorize/revoke oracle addresses

### **API Optimization**
- **Batch API Calls**: Multiple assets fetched in single API requests
- **Parallel Source Fetching**: All sources (Alchemy, CoinMarketCap, etc.) run simultaneously
- **Dynamic Configuration**: API parameters built from source configuration
- **Cost Reduction**: ~50% fewer API calls through batching

### **Production Features**
- **Robust Error Handling**: Graceful degradation when sources fail
- **Log Sanitization**: Sensitive data masked in logs
- **Configurable Timeouts**: 60s feed processing, 30s API calls, 120s blockchain
- **Retry Logic**: Automatic retry with exponential backoff
- **Basic Health Monitoring**: Simple status endpoint

## 📊 Performance Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Cron Jobs** | 2 separate | 1 combined | 50% reduction |
| **Blockchain TX** | 2 transactions | 1 transaction | 50% gas savings |
| **Execution Time** | Sequential | Parallel | ~50% faster |
| **API Calls** | 4 parallel | 4 parallel | Same efficiency |

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cron Job      │    │  API Sources    │    │  Price Oracle   │
│   (Every 15m)   │───▶│  (Parallel)     │───▶│  (Batch Update) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Feed Logger    │    │  Batch Adapter  │    │  Direct Update  │
│  (Tree Format)  │    │  (Cost Optim.)  │    │  (No Consensus) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔧 Configuration

### Environment Variables

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
METALS_API_KEY=your-metals-dev-key
METALPRICE_API_KEY=your-metalprice-api-key

# Oracle Update Configuration
UPDATE_INTERVAL_MINUTES=15  # Update interval in minutes (1-60, default: 15)

# Instance Configuration
INSTANCE_ID=oracle-1
INSTANCE_NAME=Oracle Instance 1
```

### Contract Configuration

The enhanced PriceOracle contract supports:

- **Round Duration**: 15 minutes by default, adjustable by owner
- **Simple Averaging**: Arithmetic mean of all oracle submissions
- **Multi-Node Support**: Multiple oracles can submit during same round
- **Early Finalization**: Rounds complete when all authorized oracles submit
- **Storage Cleanup**: Automatic deletion of old round data (configurable)

## 📁 File Structure

```
src/
├── config/
│   ├── assets.json          # Centralized asset registry
│   ├── feeds.json           # Feed definitions (simplified)
│   └── sources.json         # API source configurations
├── adapters/
│   └── genericRestAdapter.ts # Unified API adapter with batching
├── utils/
│   ├── configLoader.ts      # Configuration management
│   ├── oauth.ts            # OAuth client (lazy initialization)
│   ├── oraclePusher.ts     # Blockchain interaction
│   └── logger.ts           # Centralized logging
├── types/
│   └── index.ts            # TypeScript interfaces
└── cronScheduler.ts        # Parallel feed processing
```

## 🚀 Deployment

### 1. Deploy Enhanced Contract

```bash
cd mercata/contracts
node deploy/deployEnhancedPriceOracle.js
```

### 2. Update Environment

```bash
# Update .env with new contract address
PRICE_ORACLE_ADDRESS=<deployed-contract-address>
```

### 3. Start Oracle Service

```bash
cd mercata/services/oracle
npm run dev
```

## 📈 Multi-Instance Deployment

For high availability, deploy multiple oracle instances:

### Strategy
- **Separate API Keys**: Each instance uses different API keys
- **Staggered Scheduling**: Offset cron jobs by 1-2 minutes
- **Instance-Specific Logging**: Unique instance IDs for monitoring
- **Basic Health Checks**: Simple health endpoints per instance

### Configuration
```env
# Instance 1
INSTANCE_ID=oracle-1
INSTANCE_NAME=Oracle Instance 1

# Instance 2  
INSTANCE_ID=oracle-2
INSTANCE_NAME=Oracle Instance 2
```

## 🔍 Monitoring

### Health Check Endpoint
```bash
curl http://localhost:3000/health
```

### Log Format
```
[FeedLogger] ETH-USD
├─ Price: $3579.14559084 USD
├─ Transaction: 33d2c8b5a8d10abca4626c5845d867212d1bdfc771192c1aaee2599261efcb2a
└─ Sources:
    ├─ Alchemy: $3579.14559084 USD
    └─ CoinMarketCap: $3579.14559084 USD
```

## 🛠️ Development

### Build
```bash
npm run build
```

### Test
```bash
npm run dev
```

### Configuration Validation
The service validates all configuration files on startup:
- ✅ Asset registry completeness
- ✅ Source configuration validity
- ✅ API key availability
- ✅ Feed definition consistency

## 📊 Supported Assets

### Crypto Assets
- **ETH**: Ethereum (WETH)
- **WBTC**: Wrapped Bitcoin
- **PAXG**: PAX Gold
- **USDT**: Tether
- **USDC**: USD Coin

### Precious Metals
- **XAU**: Gold
- **XAG**: Silver

## 🔗 API Sources

### Crypto Sources
- **Alchemy**: High-frequency crypto prices
- **CoinMarketCap**: Comprehensive crypto data

### Metals Sources
- **Metals.dev**: Precious metals pricing
- **MetalPriceAPI**: Alternative metals data

## 🚨 Error Handling

### Graceful Degradation
- ✅ One source fails → Others continue
- ✅ API timeout → Retry with backoff
- ✅ Blockchain error → Retry transaction
- ✅ Configuration error → Detailed logging
- ✅ **Specific Error Messages**: Each failed source logged with detailed error information

### Log Sanitization
- 🔒 API keys masked in logs
- 🔒 OAuth tokens hidden
- 🔒 Sensitive URLs protected

### Error Logging Examples
```
[ERROR] 2024-01-15T10:30:00.000Z | CronScheduler | Failed to fetch crypto from Alchemy: Network timeout
[ERROR] 2024-01-15T10:30:00.000Z | CronScheduler | Failed to fetch crypto from CoinMarketCap: API rate limit exceeded
[INFO] 2024-01-15T10:30:00.000Z | CronScheduler | crypto: 1/2 sources succeeded. Successful: [CoinMarketCap]. Failed: [Alchemy]
```

## 📝 License

This project is part of the Mercata lending platform. 