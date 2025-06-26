# Price Oracle Service

A clean, elegant, and highly configurable price oracle service built in **TypeScript** that fetches real-time price data from multiple sources and updates blockchain price feeds using a generic adapter pattern.

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
- ✅ **TypeScript**: Full type safety and modern development experience

## 📁 Project Structure

```
services/oracle/
├── src/                            # TypeScript source files
│   ├── adapters/
│   │   └── genericRestAdapter.ts   # Generic API adapter
│   ├── config/
│   │   ├── feeds.json              # Feed configurations
│   │   └── sources.json            # API source configurations
│   ├── utils/
│   │   ├── oraclePusher.ts         # Blockchain interactions
│   │   ├── oauth.ts                # OAuth2 client
│   │   ├── logger.ts               # Logging utilities
│   │   └── validateConfig.ts       # Configuration validation
│   ├── cronScheduler.ts            # Cron job management
│   └── index.ts                    # Main entry point
├── dist/                           # Compiled JavaScript output
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript configuration
├── start.sh                        # Production startup script
├── env.example                     # Environment variables template
└── README.md
```

## ⚙️ Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
# STRATO Blockchain Configuration
STRATO_NODE_URL=https://node5.mercata-testnet.blockapps.net
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
OAUTH_CLIENT_ID=mercata-testnet-node1
OAUTH_CLIENT_SECRET=your_oauth_client_secret
USERNAME=your_username
PASSWORD=your_password
PRICE_ORACLE_ADDRESS=08ba35c33d8f51a1732f604ff760aad00582d48b
ORACLE_CONTRACT_NAME=PriceOracle

# API Keys
ALCHEMY_API_KEY=your_alchemy_api_key_here
METALS_API_KEY=your_metals_api_key_here
COINGECKO_API_KEY=your_coingecko_api_key_here
```

### Feed Configuration (`src/config/feeds.json`)

Each feed defines:
- **name**: Human-readable feed name
- **source**: Which API source to use (must exist in sources.json)
- **targetAssetAddress**: Blockchain asset address to update
- **cron**: Cron expression for update schedule
- **apiParams**: Parameters passed to the API source

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
      }
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
    "urlTemplate": "https://api.g.alchemy.com/prices/v1/${API_KEY}/tokens/by-address",
    "apiKeyEnvVar": "ALCHEMY_API_KEY",
    "method": "POST",
    "requestBody": {
      "addresses": [
        {
          "network": "eth-mainnet",
          "address": "${tokenAddress}"
        }
      ]
    },
    "parsePath": "data[0].prices[0].value",
    "feedTimestampPath": "data[0].prices[0].lastUpdatedAt"
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

3. **Build TypeScript**
   ```bash
   npm run build
   ```

4. **Start the Service**
   ```bash
   # Production (recommended)
   ./start.sh
   
   # Development
   npm run dev
   
   # Alternative (requires manual environment setup)
   npm start
   ```

## 🎯 Usage

### Production Start (Recommended)
```bash
cd services/oracle
./start.sh
```

### Development Start
```bash
cd services/oracle
npm run dev
```

### Build and Validate
```bash
# Build TypeScript
npm run build

# Validate configuration
npm run validate
```

## 📊 Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run in development mode with ts-node
- `npm start` - Build and run compiled JavaScript (requires environment setup)
- `npm run watch` - Watch mode compilation
- `npm run validate` - Validate configuration files
- `./start.sh` - **Production startup script (recommended)**

## 🚨 Important: Starting the Service

**Always use `./start.sh` for production** as it properly loads environment variables. The npm scripts may not work reliably across all shell environments.

```bash
# Make executable (first time only)
chmod +x start.sh

# Start service
./start.sh
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
  }
}
```

### 3. Add Environment Variable
Add to `.env`:
```env
NEW_API_KEY=your_new_api_key_here
```

### 4. Rebuild and Restart Service
```bash
npm run build
./start.sh
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
   # Check OAuth discovery URL
   curl https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
   
   # Test OAuth credentials
   curl -X POST https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token \
     -d "grant_type=client_credentials" \
     -d "client_id=your_client_id" \
     -d "client_secret=your_client_secret"
   ```

2. **Environment Variables Not Loading**
   - Always use `./start.sh` instead of `npm start`
   - Verify `.env` file exists and has correct permissions
   - Check that all required environment variables are set

3. **TypeScript Compilation Errors**
   ```bash
   # Check TypeScript errors
   npm run build
   
   # Run in development mode for better error messages
   npm run dev
   ```

4. **Price Validation Errors**
   - Ensure prices are in 8-decimal format
   - Check API response parsing paths in sources.json

5. **STRATO Transaction Failures**
   - Verify `PRICE_ORACLE_ADDRESS` is correct
   - Check oracle authorization with contract owner
   - Ensure sufficient gas parameters

### Debug Mode
```bash
# Development with detailed logging
npm run dev

# Production with environment variables
DEBUG=* ./start.sh
```

## 🚀 Production Considerations

1. **Process Management**: Use PM2 or similar for production
   ```bash
   # Install PM2
   npm install -g pm2
   
   # Start with PM2
   pm2 start start.sh --name "oracle-service"
   ```

2. **Monitoring**: Set up alerts for failed price updates
3. **Backup Sources**: Configure multiple API sources for redundancy
4. **Security**: Store API keys in secure environment variables
5. **Logging**: Configure log rotation and centralized logging
6. **Build Process**: Always run `npm run build` before deployment

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes in TypeScript
4. Run `npm run build` to compile
5. Test with `./start.sh`
6. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the configuration examples
- Ensure you're using `./start.sh` for startup 