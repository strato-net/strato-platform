# Mercata Rewards Poller Service

The Mercata Rewards Poller Service monitors protocol events from Cirrus DB and posts batch transactions to the Rewards contract to track user activity for reward distribution.

## Features

* **Event Monitoring**: Polls Cirrus DB for events from protocol contracts (Pool, LiquidityPool, LendingPool)
* **Automatic Mapping**: Maps protocol events to Rewards contract actions (deposit, withdraw, occurred)
* **Batch Processing**: Groups events by action type and posts transactions in batches
* **OAuth Integration**: Secure authentication with STRATO using OpenID Connect
* **Comprehensive Logging**: Secure and contextual logging using Winston
* **Health Monitoring**: Health check endpoint with error tracking

## Prerequisites

- Node.js 22.12 or higher
- Access to STRATO node
- STRATO OAuth credentials
- Rewards contract address

## Installation

1. Navigate to the rewards poller service:
```bash
cd services/rewards-poller
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example environment file and update the values:
```bash
cp .env.example .env
```

## Configuration

### Required Environment Variables

#### Authentication
- `BA_USERNAME` - BlockApps username
- `BA_PASSWORD` - BlockApps password
- `CLIENT_SECRET` - OAuth client secret
- `CLIENT_ID` - OAuth client ID
- `OPENID_DISCOVERY_URL` - OpenID discovery endpoint

#### Blockchain
- `NODE_URL` - STRATO node URL
- `REWARDS_CONTRACT_ADDRESS` - Rewards contract address

#### Service
- `PORT` - Service port (default: 3004)
- `POLLING_INTERVAL` - Polling interval in milliseconds (default: 60000)

### Optional Environment Variables

#### Contract Addresses
- `USDST_ADDRESS` - USDST token contract address (default: `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`)

#### Polling Configuration
- `MAX_BATCH_SIZE` - Maximum number of actions per batch (default: `100`)

#### Balance Configuration
- `GAS_FEE_USDST` - Gas fee in USDST, multiplied by 1e16 (default: `1` = 0.01 USDST)
- `GAS_FEE_VOUCHER` - Gas fee in Voucher, multiplied by 1e16 (default: `100` = 1 Voucher)
- `MIN_TRANSACTIONS_THRESHOLD` - Minimum transactions that can be processed with current balance (default: `1`)
- `WARNING_TRANSACTIONS_THRESHOLD` - Threshold for low balance warning (default: `50`)

#### Retry Configuration
- `RETRY_MAX_ATTEMPTS` - Maximum retry attempts (default: `2`)
- `RETRY_INITIAL_DELAY` - Initial retry delay in milliseconds (default: `1000`)
- `RETRY_MAX_DELAY` - Maximum retry delay in milliseconds (default: `10000`)

### Example .env File

```env
# Authentication
BA_USERNAME=your_username
BA_PASSWORD=your_password
CLIENT_SECRET=your_client_secret
CLIENT_ID=your_client_id
OPENID_DISCOVERY_URL=https://your-openid-provider/.well-known/openid-configuration

# Contract Addresses
REWARDS_CONTRACT_ADDRESS=0000000000000000000000000000000000000000
USDST_ADDRESS=937efa7e3a77e20bbdbd7c0d32b6514f368c1010

# API Configuration
NODE_URL=https://your-strato-node-url

# Polling Configuration
POLLING_INTERVAL=60000
MAX_BATCH_SIZE=100

# Balance Configuration
GAS_FEE_USDST=1
GAS_FEE_VOUCHER=100
MIN_TRANSACTIONS_THRESHOLD=1
WARNING_TRANSACTIONS_THRESHOLD=50

# Retry Configuration
RETRY_MAX_ATTEMPTS=2
RETRY_INITIAL_DELAY=1000
RETRY_MAX_DELAY=10000
```

## Event Mappings

The service uses hardcoded event mappings to convert protocol events to Rewards contract calls:

- `Pool.Deposited` → `rewards.deposit(activityId: 1, user, amount)`
- `Pool.Withdrawn` → `rewards.withdraw(activityId: 1, user, amount)`
- `LiquidityPool.Deposited` → `rewards.deposit(activityId: 2, user, amount)`
- `LiquidityPool.Withdrawn` → `rewards.withdraw(activityId: 2, user, amount)`
- `LendingPool.Borrowed` → `rewards.occurred(activityId: 3, user, amount)`
- `LendingPool.Repaid` → `rewards.occurred(activityId: 4, user, amount)`

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Build
```bash
npm run build
```

## API Endpoints

### Health Check
```
GET /health
```

Returns service health status. Returns 500 if error file exists, 200 otherwise.

## Architecture

### Service Structure

- `src/index.ts` - Express server entry point
- `src/config/index.ts` - Configuration management
- `src/types/index.ts` - TypeScript type definitions
- `src/services/rewardsService.ts` - Rewards contract interaction
- `src/services/cirrusService.ts` - Cirrus DB event queries
- `src/polling/rewardsPolling.ts` - Main polling logic
- `src/utils/` - Utility functions (API client, logger, strato helper)
- `src/auth/` - OAuth authentication

### Polling Flow

1. Service polls Cirrus DB for events from configured protocol contracts
2. Events are mapped to Rewards actions based on hardcoded mappings
3. Actions are grouped by type (deposit/withdraw/occurred)
4. Batched transactions are posted to the Rewards contract
5. Last processed block numbers are tracked to avoid reprocessing

### Error Handling

- Duplicate transaction errors are handled gracefully
- Errors are logged but polling continues
- Failed events can be retried on next polling cycle
- Error file tracking for health monitoring

## Logging

The service uses structured logging with:
- Info logs for successful operations
- Error logs for failures with context
- Sensitive data redaction (API keys, tokens)
- Error file tracking for health monitoring

