# Liquidation Bot as Managed Vault

## Overview

This document describes the implementation of the Liquidation Bot service that acts as a **managed vault** where users can invest funds. The bot automatically executes liquidations on undercollateralized positions in the CDP and Lending systems, and distributes profits proportionally to all investors.

## Problem Statement (Issue #5995)

**Issue**: "bot should act as a managed vault"
**Description**: "users can invest in the bot"

The platform needed an automated liquidation mechanism that:
1. Monitors CDP and Lending pools for liquidatable positions
2. Executes liquidations automatically
3. Allows users to invest in the bot's operations
4. Distributes profits fairly to all investors

## Solution Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Liquidation Bot Service                    │
│                      (Port 3006)                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Polling    │───▶│ Liquidation  │───▶│    Vault     │  │
│  │    Loop      │    │   Executor   │    │   Service    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         └────────────────────┴────────────────────┘          │
│                              │                                │
└──────────────────────────────┼────────────────────────────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
        ┌────────▼────────┐         ┌───────▼────────┐
        │   CDP Engine    │         │  Lending Pool  │
        │  (Liquidations) │         │ (Liquidations) │
        └─────────────────┘         └────────────────┘
```

### Key Components

1. **Polling Service** (`liquidationPolling.ts`)
   - Monitors blockchain for liquidatable positions
   - Configurable poll interval (default: 30 seconds)
   - Filters positions by profitability threshold
   - Batch execution with configurable limits

2. **CDP Liquidation Service** (`cdpLiquidationService.ts`)
   - Queries CDP backend for liquidatable vaults
   - Calculates expected profit from liquidation penalties
   - Executes liquidation transactions
   - Handles errors and retries

3. **Vault Service** (`vaultService.ts`)
   - Manages investor deposits and withdrawals
   - Tracks shares and ownership percentages
   - Records profits from liquidations
   - Calculates share value dynamically

4. **Express API** (`index.ts`)
   - REST endpoints for vault management
   - Investor query interfaces
   - Polling control endpoints
   - Health checks and monitoring

## How It Works

### Investment Mechanism

The vault uses a **share-based system** similar to traditional investment funds:

#### Initial Investment
```
User invests 1000 USDST
→ Receives 1000 shares (1:1 ratio for first investor)
→ Vault: 1000 shares, 1000 USDST total value
```

#### Subsequent Investment (after profits)
```
Vault state: 1000 shares, 1100 USDST value (after 100 USDST profit)
New user invests 1100 USDST
→ shares = (investment × totalShares) / totalValue
→ shares = (1100 × 1000) / 1100 = 1000 shares
→ Vault: 2000 shares, 2200 USDST total value
```

#### Profit Distribution
```
Bot executes liquidation earning 200 USDST
→ Performance fee: 200 × 5% = 10 USDST
→ Net profit: 190 USDST
→ New total value: 2200 + 190 = 2390 USDST
→ Each share value: 2390 / 2000 = 1.195 USDST/share
→ User 1 ROI: (1195 - 1000) / 1000 = 19.5%
→ User 2 ROI: (1195 - 1100) / 1100 = 8.6%
```

#### Withdrawal
```
User 1 withdraws 500 shares
→ amount = (shares × totalValue) / totalShares
→ amount = (500 × 2390) / 2000 = 597.5 USDST
→ User 1 profit: 597.5 - 500 = 97.5 USDST (19.5% ROI)
→ Vault: 1500 shares, 1792.5 USDST remaining
```

### Liquidation Flow

```
1. Poll Cycle Starts (every 30s)
   ↓
2. Query CDP/Lending for liquidatable positions
   ↓
3. Calculate profit for each position
   profit = liquidationPenalty - gasCosts
   ↓
4. Filter by minimum threshold ($10 default)
   ↓
5. Sort by profitability (highest first)
   ↓
6. Execute batch (up to 10 liquidations)
   ↓
7. For each successful liquidation:
   a. Deduct performance fee (5%)
   b. Add net profit to vault value
   c. All shares increase in value proportionally
   ↓
8. Record metrics (total liquidations, profits, ROI)
```

### Integration with Junior Notes

The bot complements the existing Junior Notes system:

| Feature | Junior Notes | Liquidation Bot Vault |
|---------|-------------|----------------------|
| **Investment Type** | Burn USDST for recovery rights | Deposit USDST for operations |
| **Return Mechanism** | Premium cap (10%) from bad debt recovery | Unlimited returns from liquidation profits |
| **Risk Profile** | Higher risk (depends on recovery) | Lower risk (active liquidations) |
| **Liquidity** | Claim as reserves accumulate | Withdraw anytime at share value |
| **Synergy** | Benefits from reserve inflows | Generates reserve inflows via fees |

**Combined Strategy**: Investors can allocate funds to both mechanisms for diversified exposure to platform revenues.

## Configuration

### Environment Variables

```bash
# Polling
POLL_INTERVAL_MS=30000              # Poll every 30 seconds
MAX_LIQUIDATIONS_PER_BATCH=10       # Max liquidations per cycle

# Strategy
MIN_PROFIT_THRESHOLD_USD=10         # Only execute if profit > $10
ENABLE_CDP_LIQUIDATIONS=true        # Enable CDP liquidations
ENABLE_LENDING_LIQUIDATIONS=true    # Enable Lending liquidations

# Vault
VAULT_ENABLED=true                  # Enable managed vault
MIN_INVESTMENT_USD=100              # Minimum investment: $100
VAULT_FEE_BPS=500                   # Performance fee: 5%
```

## API Reference

### Vault Endpoints

#### GET /vault/metrics
Returns vault performance metrics:
```json
{
  "totalShares": "2000000000000000000000",
  "totalValue": "2390000000000000000000",
  "totalInvestors": 2,
  "totalLiquidations": 15,
  "totalProfits": "390000000000000000000",
  "performanceFee": "5%",
  "roi": 19.5
}
```

#### GET /vault/investors
Returns all investors:
```json
[
  {
    "address": "0x123...",
    "shares": "1000000000000000000000",
    "investedAmount": "1000000000000000000000",
    "currentValue": "1195000000000000000000",
    "joinedAt": 1704067200000
  }
]
```

#### POST /vault/invest
Invest in the vault:
```json
{
  "userAddress": "0x123...",
  "amount": "1000000000000000000000"
}
```

#### POST /vault/withdraw
Withdraw from vault:
```json
{
  "userAddress": "0x123...",
  "shareAmount": "500000000000000000000"
}
```

## Deployment

### Standalone Service
```bash
cd mercata/services/liquidation-bot
npm install
npm run build
npm start
```

### Docker
```bash
docker build -t liquidation-bot .
docker run -p 3006:3006 --env-file .env liquidation-bot
```

### Alongside Other Services
Add to docker-compose.yml:
```yaml
liquidation-bot:
  build: ./mercata/services/liquidation-bot
  ports:
    - "3006:3006"
  environment:
    - STRATO_URL=http://backend:3002
    - VAULT_ENABLED=true
  depends_on:
    - backend
    - nginx
```

## Security Considerations

1. **Bot Credentials**: The bot's private key and OAuth token must be securely stored
2. **Access Control**: Vault API endpoints should require authentication
3. **Rate Limiting**: Prevent abuse of investment/withdrawal endpoints
4. **Balance Monitoring**: Alert if bot's USDST balance is low
5. **Circuit Breakers**: Auto-pause if error rate exceeds threshold

## Performance Metrics

Expected performance under normal conditions:

- **Polling Frequency**: 30 seconds
- **Liquidations per Day**: ~10-50 (depends on market volatility)
- **Average Profit per Liquidation**: $50-$200
- **Daily Revenue**: $500-$10,000
- **ROI for Investors**: 5-20% APY (highly variable)

## Future Enhancements

1. **Flash Loan Integration**: Use Aave/dYdX flash loans for zero-capital liquidations
2. **MEV Protection**: Submit transactions privately to avoid frontrunning
3. **Multi-Chain Support**: Extend to Ethereum, Polygon, etc.
4. **Advanced Strategies**: Per-asset liquidation strategies
5. **Governance**: DAO voting on bot parameters
6. **Insurance Fund**: Set aside portion of profits for potential losses
7. **Tiered Fees**: Lower fees for larger investors

## Monitoring and Alerts

Recommended monitoring setup:

1. **Health Checks**: Monitor `/health` endpoint (30s interval)
2. **Balance Alerts**: Alert if bot USDST balance < threshold
3. **Error Rate**: Alert if liquidation error rate > 10%
4. **Profit Tracking**: Daily reports on profits and ROI
5. **Investor Activity**: Track deposits, withdrawals, and value

## Conclusion

The Liquidation Bot as a Managed Vault provides:

✅ **Automated liquidation** to maintain platform health
✅ **Investment opportunity** for users to earn from liquidation profits
✅ **Fair profit distribution** through share-based system
✅ **Integration** with existing Junior Notes for comprehensive revenue exposure
✅ **Scalable architecture** following established service patterns
✅ **Configurable strategy** for different risk profiles

This implementation addresses issue #5995 by creating a bot that acts as a managed vault where users can invest, with profits from automated liquidations distributed proportionally to all investors.
