# App API - Getting Started

The **STRATO App API** provides programmatic access to all DeFi operations (lending, CDP, swaps, liquidity, bridge, rewards).

!!! tip "Interactive Documentation"
    Explore and test the App API: **[Interactive Swagger UI](interactive-api.md#app-api-defi-operations)**

## Base URL

**Production:**
```
https://app.strato.nexus/api
```

**Testnet:**
```
https://app.testnet.strato.nexus/api
```

!!! info "Alternative: Core Platform API"
    For low-level blockchain operations (transactions, contracts, blocks), see **[Core Platform API](strato-node-api.md)**

## Authentication

### OAuth Token

Most endpoints require authentication via **OAuth 2.0 Bearer token from Keycloak**.

!!! info "No `/auth/*` Endpoints"
    STRATO uses **Keycloak** for authentication. There are no `/auth/login` or `/auth/refresh` endpoints in the STRATO API.

**Obtaining a token:**

**For Interactive Users (Browser):**

1. Register/login at [app.strato.nexus](https://app.strato.nexus)
2. Token is automatically managed by the web app
3. See [Quick Start Guide](../quick-start.md) for registration

**For Service Accounts (API Integration):**

```bash
POST https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET
```

**Response:**

```json
{
  "access_token": "eyJhbGc...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Using the token:**

```bash
GET /tokens/v2
Authorization: Bearer eyJhbGc...
```

**Token Refresh:**

Keycloak tokens automatically refresh on the client side. For service accounts, simply request a new token when the current one expires.

## Core Endpoints

### Tokens

#### List Tokens

```
GET /tokens/v2
```

**Query Parameters:**

- `status`: Filter by status (e.g., `neq.2` for non-deprecated)
- `limit`: Results per page (default: 10, max: 50)
- `offset`: Pagination offset (default: 0)
- `balances.key`: Filter by user address (returns balances)

**Response:**

```json
{
  "tokens": [
    {
      "address": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
      "_name": "Ethereum STRATO Token",
      "_symbol": "ETHST",
      "customDecimals": 18,
      "description": "<p>Wrapped ETH on STRATO</p>",
      "status": "3",
      "balances": [
        {
          "user": "f11d828c8c126428ab0f46bce3112681931da9fb",
          "balance": "1500000000000000000"
        }
      ],
      "images": [
        {
          "value": "https://fileserver.mercata.blockapps.net/.../eth.jpg"
        }
      ]
    }
  ],
  "totalCount": 42
}
```

#### Get Token Details

```
GET /tokens/v2/{tokenAddress}
```

Returns single token with full metadata.

### Bridge

#### Get Deposit History

```
GET /bridge/deposits
Authorization: Bearer {token}
```

**Response:**

```json
{
  "deposits": [
    {
      "id": "...",
      "status": "confirmed",
      "amount": "1000000000000000000",
      "tokenAddress": "93fb...",
      "sourceChain": "ethereum",
      "txHash": "0xabc123...",
      "timestamp": "2025-12-22T10:30:00Z"
    }
  ]
}
```

#### Initiate Bridge In

```
POST /bridge/deposit
Authorization: Bearer {token}
Content-Type: application/json

{
  "tokenAddress": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "amount": "1000000000000000000",
  "sourceChain": "ethereum"
}
```

Returns transaction hash to sign on source chain.

### Swaps

#### List Swap Pools

```
GET /swap-pools
```

**Response:**

```json
{
  "pools": [
    {
      "address": "34d7caf576cf9493f054d9eced99dcd463eba4b7",
      "tokenA": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
      "tokenB": "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9",
      "tokenABalance": "100000000000000000000",
      "tokenBBalance": "300000000000000000000",
      "aToBRatio": "3000.0",
      "bToARatio": "0.000333",
      "swapFeeRate": "0.003",
      "lpToken": "69010124cdaa64286f6e413267a7001ea9379df4"
    }
  ]
}
```

#### Get Pool by Token Pair

```
GET /swap-pools/{tokenAddress1}/{tokenAddress2}
```

Returns pool for specific token pair (if exists).

#### Execute Swap

```
POST /swap-pools/{poolAddress}/swap
Authorization: Bearer {token}
Content-Type: application/json

{
  "fromToken": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "toToken": "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9",
  "amountIn": "1000000000000000000",
  "minAmountOut": "2990000000000000000",
  "deadline": 1735822200
}
```

**Response:**

```json
{
  "txHash": "0xdef456...",
  "amountOut": "2997000000000000000"
}
```

#### Add Liquidity

```
POST /swap-pools/{poolAddress}/liquidity
Authorization: Bearer {token}
Content-Type: application/json

{
  "tokenAAmount": "1000000000000000000",
  "tokenBAmount": "3000000000000000000",
  "deadline": 1735822200
}
```

Returns LP tokens minted.

#### Remove Liquidity

```
DELETE /swap-pools/{poolAddress}/liquidity
Authorization: Bearer {token}
Content-Type: application/json

{
  "lpTokenAmount": "500000000000000000",
  "minTokenAAmount": "990000000000000000",
  "minTokenBAmount": "2970000000000000000",
  "deadline": 1735822200
}
```

Returns amounts of tokenA and tokenB received.

### Lending

#### Get Lending Positions

```
GET /lending/positions
Authorization: Bearer {token}
```

**Response:**

```json
{
  "positions": {
    "supplied": [
      {
        "tokenAddress": "93fb...",
        "amount": "5000000000000000000",
        "valueUSD": "15000"
      }
    ],
    "borrowed": [
      {
        "tokenAddress": "...",
        "amount": "10000000000000000000",
        "valueUSD": "10000"
      }
    ],
    "healthFactor": "1.5"
  }
}
```

#### Supply Collateral

```
POST /lending/supply
Authorization: Bearer {token}
Content-Type: application/json

{
  "tokenAddress": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "amount": "1000000000000000000"
}
```

#### Borrow USDST

```
POST /lending/borrow
Authorization: Bearer {token}
Content-Type: application/json

{
  "amount": "5000000000000000000",
  "collateralToken": "93fb7295859b2d70199e0a4883b7c320cf874e6c"
}
```

#### Repay Debt

```
POST /lending/repay
Authorization: Bearer {token}
Content-Type: application/json

{
  "amount": "5000000000000000000"
}
```

#### Withdraw Collateral

```
POST /lending/withdraw
Authorization: Bearer {token}
Content-Type: application/json

{
  "tokenAddress": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "amount": "1000000000000000000"
}
```

### CDP

#### Get Vaults

```
GET /cdp/vaults
Authorization: Bearer {token}
```

**Response:**

```json
{
  "vaults": [
    {
      "collateralType": "ETHST",
      "collateralAmount": "5000000000000000000",
      "mintedUSDST": "10000000000000000000",
      "collateralizationRatio": "150",
      "healthFactor": "1.5"
    }
  ]
}
```

#### Get Vault Candidates (for planning)

```
GET /cdp/vault-candidates
Authorization: Bearer {token}
```

Returns available collateral types and user holdings for mint planning.

#### Mint USDST

```
POST /cdp/mint
Authorization: Bearer {token}
Content-Type: application/json

{
  "collateralToken": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "collateralAmount": "2000000000000000000",
  "mintAmount": "5000000000000000000"
}
```

#### Repay (Burn) USDST

```
POST /cdp/repay
Authorization: Bearer {token}
Content-Type: application/json

{
  "vaultId": "...",
  "amount": "5000000000000000000"
}
```

#### Withdraw Collateral from CDP

```
POST /cdp/withdraw
Authorization: Bearer {token}
Content-Type: application/json

{
  "vaultId": "...",
  "amount": "1000000000000000000"
}
```

### Rewards

#### Get Rewards Balance

```
GET /rewards
Authorization: Bearer {token}
```

**Response:**

```json
{
  "unclaimed": "15000000000000000000",
  "activities": [
    {
      "type": "lending_supply",
      "earned": "5000000000000000000"
    },
    {
      "type": "swap_lp",
      "earned": "10000000000000000000"
    }
  ]
}
```

#### Get Reward Activities & Rates

```
GET /rewards/activities
```

Returns current season's eligible activities and emission rates.

#### Claim Rewards

```
POST /rewards/claim
Authorization: Bearer {token}
```

Claims all unclaimed Reward Points.

#### Get Claim History

```
GET /rewards/history
Authorization: Bearer {token}
```

Returns past claim transactions.

## Error Handling

### Error Response Format

```json
{
  "error": {
    "message": "Insufficient balance",
    "status": 400,
    "type": "ValidationError"
  }
}
```

### Common Status Codes

- **200**: Success
- **400**: Bad Request (validation error)
- **401**: Unauthorized (invalid/expired token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Server Error

### Error Types

- **ValidationError**: Invalid parameters
- **AuthenticationError**: Authentication failed
- **StratoError**: Blockchain/contract error
- **ServerError**: Internal server error

## Rate Limiting

API requests are rate-limited per user:

- **Authenticated**: 1000 requests/minute
- **Public endpoints**: 100 requests/minute

**Rate limit headers:**

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1735822200
```

## Pagination

Endpoints returning lists support pagination:

```
GET /tokens/v2?limit=20&offset=40
```

**Response includes:**

```json
{
  "tokens": [...],
  "totalCount": 123,
  "limit": 20,
  "offset": 40
}
```

Calculate pages:

- Total pages = `ceil(totalCount / limit)`
- Current page = `(offset / limit) + 1`

## Filtering & Sorting

### Filtering

Use query parameters with operators:

```
GET /tokens/v2?status=eq.3
GET /tokens/v2?customDecimals=gte.18
```

**Operators:**

- `eq`: Equal
- `neq`: Not equal
- `gt`: Greater than
- `gte`: Greater than or equal
- `lt`: Less than
- `lte`: Less than or equal

### Sorting

```
GET /tokens/v2?order=_name.asc
GET /tokens/v2?order=balance.desc
```

## WebSocket (Real-Time Updates)

For real-time position updates:

```javascript
const ws = new WebSocket('wss://app.testnet.strato.nexus/ws');

ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'positions',
  token: 'Bearer eyJhbGc...'
}));

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Position update:', data);
};
```

Channels:

- `positions`: Lending/CDP position updates
- `rewards`: Rewards accrual updates
- `pools`: Swap pool state changes

## SDK & Libraries

### JavaScript/TypeScript

```bash
npm install @strato/sdk
```

```typescript
import { StratoClient } from '@strato/sdk';

const client = new StratoClient({
  baseUrl: 'https://app.testnet.strato.nexus/api',
  accessToken: 'eyJhbGc...'
});

const tokens = await client.tokens.list({ status: 'active' });
const swap = await client.swaps.execute({
  poolAddress: '0x...',
  fromToken: '0x...',
  toToken: '0x...',
  amountIn: '1000000000000000000'
});
```

(Note: SDK documentation in separate guide)

## Best Practices

### 1. Token Refresh

Implement automatic token refresh:

- Monitor `expiresIn` from login response
- Refresh before expiration
- Handle 401 errors by refreshing and retrying

### 2. Error Retry

Implement exponential backoff for transient errors:
```javascript
async function retryRequest(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1 || error.status < 500) throw error;
      await sleep(2 ** i * 1000); // 1s, 2s, 4s
    }
  }
}
```

### 3. Idempotency

For critical operations, use idempotency keys:
```
POST /lending/supply
Idempotency-Key: unique-request-id-123
```

### 4. Pagination

For large datasets, paginate efficiently:
```javascript
async function fetchAll(endpoint) {
  let offset = 0;
  const limit = 50;
  const results = [];

  while (true) {
    const res = await api.get(`${endpoint}?limit=${limit}&offset=${offset}`);
    results.push(...res.data);
    if (results.length >= res.totalCount) break;
    offset += limit;
  }

  return results;
}
```

### 5. Security

- **Never** log access tokens
- Store tokens securely (encrypted storage)
- Use HTTPS for all requests
- Validate SSL certificates

## Testing

### Testnet

Use testnet for development:
```
https://app.testnet.strato.nexus/api
```

- No real value at risk
- Identical API to production
- Use for testing before mainnet deployment

### Sandbox Mode

Some endpoints support sandbox mode:
```
POST /lending/borrow?sandbox=true
```

Returns simulated result without executing transaction.

## Related Docs

- [E2E Examples](../build-apps/e2e.md) - Complete application examples
- [Core Platform API](strato-node-api.md) - Direct blockchain interaction
- [Architecture](architecture.md) - System overview


