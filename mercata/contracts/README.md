
# Price Oracle Service

A production-ready, configuration-driven price oracle service that fetches real-time price data from multiple sources and updates blockchain price feeds using a generic adapter pattern with OAuth2 authentication.

## Architecture

The service uses a **generic adapter pattern** that makes it extremely easy to add new price sources and feeds without code changes - just configuration updates.

### Core Components

- **Generic REST Adapter**: Handles any REST API with configurable URL templates and response parsing
- **OAuth2 Client**: Automatic STRATO authentication with token caching and refresh
- **Cron Scheduler**: Manages automated price updates with flexible scheduling
- **Oracle Pusher**: Handles STRATO blockchain interactions and batch price updates
- **Configuration-Driven**: All feeds and sources defined in JSON configuration files

## Features

- Zero-Code Feed Addition: Add new price feeds by just updating JSON config
- OAuth2 Authentication: Automatic STRATO authentication with token management
- Multiple API Sources: Alchemy, Metals.dev, LBMA, CoinGecko support built-in
- STRATO Native: Built specifically for STRATO blockchain
- Flexible Scheduling: Individual cron schedules per feed
- Price Validation: Configurable min/max price bounds per feed
- Batch Updates: Efficient blockchain transactions
- Error Handling: Robust error handling with detailed logging
- Configuration Validation: Built-in config validation utility

## Project Structure
services/oracle/
├── src/
│ ├── adapters/
│ │ └── genericRestAdapter.js # Generic API adapter
│ ├── config/
│ │ ├── feeds.json # Feed configurations
│ │ └── sources.json # API source configurations
│ ├── utils/
│ │ ├── oauth.js # OAuth2 authentication
│ │ ├── oraclePusher.js # STRATO blockchain interactions
│ │ ├── logger.js # Logging utilities
│ │ └── validateConfig.js # Configuration validation
│ ├── cronScheduler.js # Cron job management
│ └── index.js # Main entry point
├── package.json
├── env.example
└── README.md
## Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
# STRATO Blockchain Configuration
STRATO_NODE_URL=https://your-strato-node-url
PRICE_ORACLE_ADDRESS=your_price_oracle_contract_address
ORACLE_CONTRACT_NAME=PriceOracle

# OAuth2 Configuration for STRATO Access
OAUTH_URL=https://your-oauth-provider-url/oauth/token
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
USERNAME=your_username
PASSWORD=your_password

# API Keys for Price Sources
ALCHEMY_API_KEY=your_alchemy_api_key_here
METALS_API_KEY=your_metals_api_key_here
COINGECKO_API_KEY=your_coingecko_api_key_here
```

### Feed Configuration (src/config/feeds.json)

Each feed defines:
- name: Human-readable feed name
- source: Which API source to use (must exist in sources.json)
- targetAssetAddress: Blockchain asset address to update
- cron: Cron expression for update schedule
- apiParams: Parameters passed to the API source
- minPrice/maxPrice: Price validation bounds (in 8-decimal format)

```json
{
  "feeds": [
    {
      "name": "ETH-USD",
      "source": "Alchemy",
      "targetAssetAddress": "0xETHAssetAddress",
      "cron": "*/5 * * * *",
      "apiParams": {
        "tokenAddress": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
      },
      "minPrice": 100000000,
      "maxPrice": 1000000000000
    }
  ]
}
```

### Source Configuration (src/config/sources.json)

Each source defines:
- urlTemplate: API URL with placeholder variables
- apiKeyEnvVar: Environment variable name for API key
- parsePath: JSONPath to extract price from response
- feedTimestampPath: JSONPath to extract timestamp (optional)

```json
{
  "Alchemy": {
    "urlTemplate": "https://api.g.alchemy.com/prices/v1/${API_KEY}/tokens/latest?network=eth-mainnet&addresses[]=${tokenAddress}",
    "apiKeyEnvVar": "ALCHEMY_API_KEY",
    "parsePath": "prices[0].price.value",
    "feedTimestampPath": "prices[0].timestamp"
  }
}
```

## Installation & Setup

### Prerequisites

- Node.js 16+ and npm
- STRATO blockchain node access
- OAuth2 credentials for STRATO authentication
- API keys for price data sources
- Deployed PriceOracle contract on STRATO

### 1. Install Dependencies

```bash
cd services/oracle
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
# Edit .env with your configuration
```

### 3. Deploy PriceOracle Contract

Deploy the provided `PriceOracle.sol` contract to your STRATO network and note the contract address.

### 4. Validate Configuration

```bash
npm run validate
```

### 5. Start the Service

```bash
npm start
```

## Usage

### Development Mode
```bash
npm run dev
```

### Validate Configuration
```bash
npm run validate
```

### Production Deployment
```bash
npm start
```

## Current Price Feed Schedule

### Crypto Assets (High Frequency):
- ETH-USD: Every 5 minutes
- WBTC-USD: Every 5 minutes
- USDC-USD: Every 10 minutes
- USDT-USD: Every 10 minutes
- PAXG-USD: Every 15 minutes

### Metal Assets (Market Hours):
- XAU-USD (Gold): Twice daily at 9:30 AM and 3:30 PM UTC
- XAG-USD (Silver): Twice daily at 9:30 AM and 3:30 PM UTC

## Supported Price Sources

### Alchemy (Crypto)
- Use Case: Real-time cryptocurrency prices
- Authentication: API key required
- Rate Limits: Based on your Alchemy plan
- Supported: ETH, WBTC, USDC, USDT, PAXG

### Metals.dev (Precious Metals)
- Use Case: Gold and silver spot prices
- Authentication: API key required
- Update Frequency: Real-time market data
- Supported: XAU (Gold), XAG (Silver)

### LBMA (London Fix)
- Use Case: Official London Fix prices
- Authentication: No API key required
- Update Frequency: Daily at fix times
- Supported: Gold AM/PM Fix, Silver Fix

### CoinGecko (Fallback)
- Use Case: Backup crypto price source
- Authentication: Optional API key for higher limits
- Rate Limits: Free tier available

## Adding New Feeds

### 1. Add to feeds.json
```json
{
  "name": "NEW-TOKEN-USD",
  "source": "Alchemy",
  "targetAssetAddress": "0xNewTokenAddress",
  "cron": "*/10 * * * *",
  "apiParams": {
    "tokenAddress": "0xActualTokenAddress"
  },
  "minPrice": 1000000,
  "maxPrice": 100000000000
}
```

### 2. Restart Service
```bash
npm restart
```

That's it! No code changes required.

## Adding New API Sources

### 1. Add to sources.json
```json
{
  "NewAPI": {
    "urlTemplate": "https://api.newapi.com/price?symbol=${symbol}&key=${API_KEY}",
    "apiKeyEnvVar": "NEW_API_KEY",
    "parsePath": "data.price",
    "feedTimestampPath": "data.timestamp"
  }
}
```

### 2. Add Environment Variable
```env
NEW_API_KEY=your_new_api_key
```

### 3. Use in Feed Configuration
```json
{
  "name": "TOKEN-USD",
  "source": "NewAPI",
  "apiParams": {
    "symbol": "TOKEN"
  }
}
```

## Monitoring & Logging

The service provides detailed logging for:
- OAuth2 Authentication: Token acquisition and refresh
- Feed Updates: Price changes and blockchain confirmations
- Error Tracking: API failures and validation errors
- Performance: Transaction status and timing
- Configuration: Startup validation and feed scheduling

### Log Format
[FeedLogger] 2024-01-01T12:00:00.000Z | ETH-USD | price: 234567000000 | feedTimestamp: 2024-01-01T12:00:00.000Z | onChainLastUpdated: Success
[OAuth] Access token obtained successfully (expires in 3600s)
[OraclePusher] Transaction confirmed → status: Success, hash: 0xabc123...

## Price Validation

Each feed includes configurable price bounds:
- minPrice: Minimum acceptable price (8-decimal format)
- maxPrice: Maximum acceptable price (8-decimal format)
- Validation: Prices outside bounds are rejected with error logging

Example: ETH with bounds $1.00 - $10,000.00
```json
{
  "minPrice": 100000000,
  "maxPrice": 1000000000000
}
```

## Cron Scheduling

Flexible cron expressions for each feed:
- `*/5 * * * *` - Every 5 minutes
- `0 9,15 * * *` - Daily at 9:00 AM and 3:00 PM
- `30 9 * * 1-5` - Weekdays at 9:30 AM
- `0 */4 * * *` - Every 4 hours

## Error Handling

- OAuth2 Failures: Automatic token refresh and retry
- API Failures: Logged with retry logic
- Price Validation: Out-of-bounds prices rejected
- STRATO Errors: Transaction failures logged with details
- Configuration Errors: Startup validation prevents invalid configs

## Security

- OAuth2 Tokens: Automatic refresh with 90% expiry margin
- API Keys: Masked in logs for security
- Input Validation: All configuration validated on startup
- Error Isolation: Individual feed failures don't affect others
- Access Control: STRATO contract-level authorization

## Production Deployment

### Using PM2
```bash
npm install -g pm2
pm2 start src/index.js --name price-oracle
pm2 save
pm2 startup
```

### Using Docker
```bash
docker build -t price-oracle .
docker run -d --name price-oracle --env-file .env --restart unless-stopped price-oracle
```

### Using systemd
```bash
sudo cp scripts/price-oracle.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable price-oracle
sudo systemctl start price-oracle
```

## Testing

### Test Configuration
```bash
npm run validate
```

### Test OAuth2 Connection
```bash
node -e "require('dotenv').config(); const { oauthClient } = require('./src/utils/oauth'); oauthClient.validateToken().then(console.log);"
```

## Troubleshooting

### Common Issues

**OAuth2 Authentication Failed**
- Check CLIENT_ID and CLIENT_SECRET
- Verify OAUTH_URL is correct
- Ensure proper network connectivity

**Price Fetch Failed**
- Verify API keys are set correctly
- Check API rate limits
- Validate source configuration

**STRATO Transaction Failed**
- Confirm PRICE_ORACLE_ADDRESS is correct
- Check contract is deployed and accessible
- Verify gas parameters are sufficient

**Cron Jobs Not Running**
- Validate cron expressions with online tools
- Check system time and timezone
- Review application logs for errors

## License

MIT License - see LICENSE file for details.

Built with ❤️ for STRATO blockchain ecosystem