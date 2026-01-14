# Liquidation Bot Service

An automated liquidation bot that monitors CDP and Lending pools for liquidatable positions and executes liquidations to maintain system health. The bot acts as a **managed vault** where users can invest funds, and profits from liquidations are distributed proportionally to all investors.

## Features

### Automated Liquidation
- Continuously monitors CDP and Lending pools for unhealthy positions
- Executes liquidations automatically when positions fall below collateralization thresholds
- Configurable profit threshold to ensure only profitable liquidations are executed
- Batch processing with configurable limits

### Managed Vault Investment
- Users can invest USDST into the bot's vault
- Profits from liquidations are distributed proportionally to all investors based on their share
- Performance fee mechanism (default 5%)
- Real-time tracking of investment value and ROI
- Withdraw anytime based on current share value

### Integration with Junior Notes
The liquidation bot complements the existing Junior Notes system:
- **Junior Notes**: Passive investment in bad debt recovery with 10% premium cap
- **Liquidation Bot Vault**: Active investment in liquidation operations with uncapped returns

Both mechanisms work together:
1. Bot performs liquidations, earning profits for vault investors
2. Liquidation fees flow to CDP Reserve
3. Junior Note holders benefit from reserve inflows through the index system

## Architecture

```
liquidation-bot/
├── src/
│   ├── index.ts              # Express server & main entry point
│   ├── config/               # Configuration management
│   ├── polling/              # Polling loop for liquidations
│   ├── services/             # Business logic services
│   │   ├── cdpLiquidationService.ts    # CDP liquidation logic
│   │   └── vaultService.ts             # Managed vault logic
│   ├── types/                # TypeScript type definitions
│   └── utils/                # Utilities (logging, etc.)
├── package.json
├── tsconfig.json
└── .env.example
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Service
PORT=3006

# Blockchain
STRATO_URL=http://localhost:3000
BOT_ADDRESS=<bot-wallet-address>
BOT_OAUTH_TOKEN=<oauth-token>

# Polling
POLL_INTERVAL_MS=30000
MAX_LIQUIDATIONS_PER_BATCH=10

# Strategy
MIN_PROFIT_THRESHOLD_USD=10
ENABLE_CDP_LIQUIDATIONS=true
ENABLE_LENDING_LIQUIDATIONS=true

# Managed Vault
VAULT_ENABLED=true
MIN_INVESTMENT_USD=100
VAULT_FEE_BPS=500  # 5%
```

## Installation

```bash
npm install
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Vault Management

#### Get Vault Metrics
```
GET /vault/metrics
```
Returns total value, shares, investors, profits, and ROI.

#### Get All Investors
```
GET /vault/investors
```

#### Get Investor Details
```
GET /vault/investor/:address
```

#### Invest in Vault
```
POST /vault/invest
Body: { "userAddress": "0x...", "amount": "1000000000000000000" }
```

#### Withdraw from Vault
```
POST /vault/withdraw
Body: { "userAddress": "0x...", "shareAmount": "500000000000000000" }
```

### Polling Control

#### Start Polling
```
POST /polling/start
```

#### Stop Polling
```
POST /polling/stop
```

## How It Works

### 1. Liquidation Monitoring
The bot polls the CDP and Lending systems every 30 seconds (configurable) to find liquidatable positions.

### 2. Profit Calculation
For each position, the bot calculates:
- Expected profit from liquidation penalty
- Gas costs
- Net profit after fees

### 3. Execution
Positions are sorted by profitability and executed in batch (up to 10 per cycle).

### 4. Profit Distribution
After successful liquidation:
- Performance fee (5%) is deducted
- Net profit is added to total vault value
- All investor shares increase in value proportionally

### 5. Share Calculation
```
Initial Investment: shares = investment amount (1:1)
Subsequent: shares = (investment × totalShares) / totalValue
Withdrawal: amount = (shares × totalValue) / totalShares
```

## Example Investment Flow

1. Alice invests 1000 USDST → receives 1000 shares
2. Bot executes liquidations, earning 100 USDST profit
3. After 5% fee, 95 USDST added to vault
4. Vault value now 1095 USDST
5. Bob invests 1095 USDST → receives 1000 shares
6. Alice's 1000 shares now worth 1095 USDST (9.5% ROI)
7. Total: 2000 shares, 2190 USDST value

## Deployment

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

### Kubernetes
Deploy alongside other Mercata services with proper secrets management for bot credentials.

## Security Considerations

1. **Private Key Management**: Bot's private key should be stored securely (e.g., AWS Secrets Manager, HashiCorp Vault)
2. **Access Control**: Vault endpoints should be protected with OAuth
3. **Rate Limiting**: Implement rate limiting on API endpoints
4. **Monitoring**: Set up alerts for failed liquidations and low balances

## Future Enhancements

1. **Multi-Collateral Support**: Handle multiple collateral types simultaneously
2. **Flash Loan Integration**: Use flash loans for zero-capital liquidations
3. **MEV Protection**: Implement private transaction submission
4. **Advanced Strategies**: Custom liquidation strategies per asset
5. **Governance**: Allow vault investors to vote on bot parameters

## Troubleshooting

### Bot not executing liquidations
- Check bot has sufficient USDST balance
- Verify OAuth token is valid
- Check global pause status on CDP/Lending contracts
- Review logs for errors

### Vault value not updating
- Ensure `VAULT_ENABLED=true`
- Check `recordProfit()` is being called after successful liquidations
- Verify performance fee calculation

## License

UNLICENSED - Proprietary to BlockApps
