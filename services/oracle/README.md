# Price Oracle Service

A clean, elegant, and highly configurable price oracle service that fetches real-time price data from multiple sources and updates blockchain price feeds using a generic adapter pattern.

## 🏗️ Architecture

The service uses a **generic adapter pattern** that makes it extremely easy to add new price sources and feeds without code changes - just configuration updates.

### Core Components

- **Generic REST Adapter**: Handles any REST API with configurable URL templates and response parsing
- **Cron Scheduler**: Manages automated price updates with flexible scheduling
- **Oracle Pusher**: Handles blockchain interactions and batch price updates
- **OAuth2 Client**: Manages STRATO authentication with automatic token refresh
- **Configuration-Driven**: All feeds and sources defined in JSON configuration files

## 🚀 Features

- ✅ **Zero-Code Feed Addition**: Add new price feeds by just updating JSON config
- ✅ **Multiple API Sources**: Alchemy, Metals.dev, LBMA, CoinGecko support built-in
- ✅ **OAuth2 Authentication**: Secure STRATO blockchain integration
- ✅ **Flexible Scheduling**: Individual cron schedules per feed
- ✅ **Price Validation**: Configurable min/max price bounds per feed
- ✅ **Batch Updates**: Efficient blockchain transactions
- ✅ **Error Handling**: Robust error handling with detailed logging
- ✅ **Configuration Validation**: Built-in config validation utility
- ✅ **Token Caching**: Smart OAuth2 token management with 90% expiry safety margin

## 📁 Project Structure

```
services/oracle/
├── src/
│   ├── adapters/
│   │   └── genericRestAdapter.js    # Generic API adapter
│   ├── config/
│   │   ├── feeds.json              # Feed configurations
│   │   └── sources.json            # API source configurations
│   ├── utils/
│   │   ├── oraclePusher.js         # Blockchain interactions
│   │   ├── oauth.js                # OAuth2 client
│   │   ├── logger.js               # Logging utilities
│   │   └── validateConfig.js       # Configuration validation
│   ├── cronScheduler.js            # Cron job management
│   └── index.js                    # Main entry point
├── package.json
├── env.example
└── README.md
```

## ⚙️ Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
# STRATO Blockchain Configuration
STRATO_NODE_URL=https://your-strato-node-url
OAUTH_URL=https://your-oauth-server/oauth/token
CLIENT_ID=your_oauth_client_id
CLIENT_SECRET=your_oauth_client_secret
PRICE_ORACLE_ADDRESS=your_price_oracle_contract_address
ORACLE_CONTRACT_NAME=PriceOracle

# API Keys
ALCHEMY_API_KEY=your_alchemy_api_key_here
METALS_API_KEY=your_metals_api_key_here
```

### Feed Configuration (`src/config/feeds.json`)

Each feed defines:
- **name**: Human-readable feed name
- **source**: Which API source to use (must exist in sources.json)
- **targetAssetAddress**: Blockchain asset address to update
- **cron**: Cron expression for update schedule
- **apiParams**: Parameters passed to the API source
- **minPrice/maxPrice**: Price validation bounds (in 8-decimal format)

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

### Source Configuration (`src/config/sources.json`)

Each source defines:
- **urlTemplate**: API URL with placeholder variables
- **apiKeyEnvVar**: Environment variable name for API key
- **parsePath**: JSONPath to extract price from response
- **feedTimestampPath**: JSONPath to extract timestamp (optional)

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

## 🔧 Installation & Setup

1. **Install Dependencies**
   ```bash
   cd services/oracle
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Validate Configuration**
   ```bash
   npm run validate
   ```

4. **Start the Service**
   ```bash
   npm start
   ```

## 🎯 Usage

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

## 📊 Supported Price Sources

### Alchemy (Crypto)
- **Use Case**: Real-time cryptocurrency prices
- **Update Frequency**: Every 5 minutes
- **Supported**: ETH, WBTC, USDC, USDT, PAXG
- **Authentication**: Bearer token (API key)

### Metals.dev (Precious Metals)
- **Use Case**: Gold and silver spot prices
- **Update Frequency**: Twice daily (9:30 AM, 3:30 PM UTC)
- **Supported**: XAU (Gold), XAG (Silver)
- **Authentication**: API key in header

### LBMA (London Fix)
- **Use Case**: Official London Fix prices
- **Update Frequency**: Daily at fix times
- **Supported**: Gold AM/PM Fix, Silver Fix

### CoinGecko (Fallback)
- **Use Case**: Backup crypto price source
- **Rate Limits**: Free tier available

## 🔄 Adding New Feeds

### 1. Add New Source (if needed)
Edit `src/config/sources.json`:
```json
{
  "NewAPI": {
    "urlTemplate": "https://api.example.com/price?symbol=${symbol}",
    "apiKeyEnvVar": "NEW_API_KEY",
    "parsePath": "data.price",
    "feedTimestampPath": "data.timestamp"
  }
}
```

### 2. Add New Feed
Edit `src/config/feeds.json`:
```json
{
  "name": "NEW-TOKEN-USD",
  "source": "NewAPI",
  "targetAssetAddress": "0xNewTokenAddress",
  "cron": "*/10 * * * *",
  "apiParams": {
    "symbol": "NEWTOKEN"
  },
  "minPrice": 1000000,
  "maxPrice": 100000000000
}
```

### 3. Add Environment Variable
Add to `.env`:
```env
NEW_API_KEY=your_new_api_key_here
```

### 4. Restart Service
```bash
npm restart
```

## 🔐 OAuth2 Authentication

The service uses OAuth2 for STRATO authentication with automatic token management:

- **Grant Types**: `client_credentials` and `password` flows supported
- **Token Caching**: Tokens cached with 90% expiry safety margin
- **Auto Refresh**: Automatic token refresh before expiry
- **Error Handling**: Robust error handling with retry logic

## 📈 Price Format

All prices are stored in **8-decimal USD format**:
- `100000000` = $1.00 USD
- `334999000000` = $3,349.99 USD (Gold)
- `183878000000` = $1,838.78 USD (ETH)

## 📝 Logging

The service provides comprehensive logging:
- **Feed Updates**: Price changes and blockchain confirmations
- **OAuth Events**: Token refresh and authentication status
- **Error Tracking**: Detailed error messages with context
- **Transaction Logs**: STRATO transaction hashes and status

## 🔧 Troubleshooting

### Common Issues

1. **OAuth Authentication Failed**
   ```bash
   # Check OAuth credentials
   curl -X POST $OAUTH_URL \
     -d "grant_type=client_credentials" \
     -d "client_id=$CLIENT_ID" \
     -d "client_secret=$CLIENT_SECRET"
   ```

2. **Price Validation Errors**
   - Check `minPrice` and `maxPrice` bounds in feeds.json
   - Ensure prices are in 8-decimal format

3. **STRATO Transaction Failures**
   - Verify `PRICE_ORACLE_ADDRESS` is correct
   - Check oracle authorization with contract owner
   - Ensure sufficient gas parameters

4. **API Rate Limits**
   - Adjust cron schedules to reduce frequency
   - Consider using multiple API keys

### Debug Mode
```bash
DEBUG=* npm start
```

## 🚀 Production Considerations

1. **Process Management**: Use PM2 or similar for production
2. **Monitoring**: Set up alerts for failed price updates
3. **Backup Sources**: Configure multiple API sources for redundancy
4. **Security**: Store API keys in secure environment variables
5. **Logging**: Configure log rotation and centralized logging

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the configuration examples 