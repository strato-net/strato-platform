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

