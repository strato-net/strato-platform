# Core Platform API (Advanced)

Direct blockchain interaction APIs for advanced use cases.

## Overview

The **Core Platform API** provides low-level blockchain access:

- Transaction submission
- Contract queries
- Block/state data
- Event logs

!!! tip "Interactive Documentation"
    Explore and test the Core API: **[Interactive Swagger UI](interactive-api.md#core-platform-api)**

**When to use:**

- Advanced integrations requiring direct blockchain access
- Custom contract interactions
- Blockchain data indexing
- Real-time event monitoring

**When NOT to use:**

- Standard DeFi operations (use **[App API](api.md)** instead)
- User authentication (use OAuth API)
- High-level abstractions available in App API

## Base URL

**Production:**
```
https://app.strato.nexus/strato-api
```

**Testnet:**
```
https://app.testnet.strato.nexus/strato-api
```

## Authentication

STRATO Node API uses **API keys** or **OAuth tokens** depending on endpoint.

### API Key (Admin operations)

```bash
GET /strato-api/eth/v1.2/account
X-API-Key: your-api-key-here
```

### OAuth Token (User operations)

```bash
POST /strato-api/eth/v1.2/transaction
Authorization: Bearer eyJhbGc...
```

## Core Endpoints

### Account Management

#### Get Account Info

```
GET /strato-api/eth/v1.2/account?address={address}
```

**Response:**

```json
{
  "address": "f11d828c8c126428ab0f46bce3112681931da9fb",
  "balance": "1000000000000000000",
  "nonce": 42
}
```

#### Get Account Balance

```
GET /strato-api/eth/v1.2/account/{address}/balance
```

Returns account's native token balance (in wei).

### Transaction Submission

#### Send Transaction

```
POST /strato-api/eth/v1.2/transaction
Authorization: Bearer {token}
Content-Type: application/json

{
  "from": "f11d828c8c126428ab0f46bce3112681931da9fb",
  "to": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "value": "1000000000000000000",
  "gasLimit": "21000",
  "gasPrice": "1000000000",
  "data": "0x...",
  "nonce": 42
}
```

**Response:**

```json
{
  "txHash": "0xabc123...",
  "status": "pending"
}
```

#### Get Transaction Status

```
GET /strato-api/eth/v1.2/transaction/{txHash}
```

**Response:**

```json
{
  "txHash": "0xabc123...",
  "status": "confirmed",
  "blockNumber": "12345",
  "blockHash": "0xdef456...",
  "gasUsed": "21000",
  "from": "f11d828c8c126428ab0f46bce3112681931da9fb",
  "to": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "value": "1000000000000000000"
}
```

### Contract Interaction

#### Call Contract Method (Read)

```
POST /strato-api/eth/v1.2/contract/{contractAddress}/call
Content-Type: application/json

{
  "method": "balanceOf",
  "args": {
    "owner": "f11d828c8c126428ab0f46bce3112681931da9fb"
  }
}
```

**Response:**

```json
{
  "result": "5000000000000000000"
}
```

#### Send Contract Transaction (Write)

```
POST /strato-api/eth/v1.2/contract/{contractAddress}/send
Authorization: Bearer {token}
Content-Type: application/json

{
  "method": "transfer",
  "args": {
    "to": "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9",
    "amount": "1000000000000000000"
  },
  "from": "f11d828c8c126428ab0f46bce3112681931da9fb",
  "gasLimit": "50000"
}
```

Returns transaction hash.

### Block & State Queries

#### Get Latest Block

```
GET /strato-api/eth/v1.2/block/latest
```

**Response:**

```json
{
  "number": "14756",
  "hash": "0x...",
  "timestamp": "2025-12-22T10:30:00Z",
  "transactions": ["0xabc...", "0xdef..."],
  "gasUsed": "8000000",
  "gasLimit": "10000000"
}
```

#### Get Block by Number

```
GET /strato-api/eth/v1.2/block/{blockNumber}
```

Returns full block details including transactions.

#### Get Block by Hash

```
GET /strato-api/eth/v1.2/block/hash/{blockHash}
```

### Event Logs

#### Query Logs

```
GET /strato-api/eth/v1.2/logs?address={contractAddress}&fromBlock={start}&toBlock={end}
```

**Query Parameters:**

- `address`: Contract address (optional, filter by contract)
- `topics`: Event signature hashes (optional, array)
- `fromBlock`: Start block number
- `toBlock`: End block number (or "latest")

**Response:**

```json
{
  "logs": [
    {
      "address": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
      "topics": ["0x...Transfer...", "0x...from...", "0x...to..."],
      "data": "0x...",
      "blockNumber": "14755",
      "transactionHash": "0xabc123...",
      "logIndex": 0
    }
  ]
}
```

#### Subscribe to Events (WebSocket)

```javascript
const ws = new WebSocket('wss://app.testnet.strato.nexus/strato-api/ws');

ws.send(JSON.stringify({
  type: 'subscribe',
  filter: {
    address: '93fb7295859b2d70199e0a4883b7c320cf874e6c',
    topics: ['0x...Transfer...']
  }
}));

ws.onmessage = (event) => {
  const log = JSON.parse(event.data);
  console.log('Transfer event:', log);
};
```

### Cirrus (Indexer) Queries

#### Search Indexed Data

```
GET /cirrus/search/{contractName}?{queryParams}
```

**Example: Get token balances**

```
GET /cirrus/search/Token-_balances?key=eq.f11d828c8c126428ab0f46bce3112681931da9fb&select=address,value
```

**Response:**

```json
[
  {
    "address": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
    "key": "f11d828c8c126428ab0f46bce3112681931da9fb",
    "value": "5000000000000000000"
  }
]
```

**Query Operators:**

- `eq`: Equal
- `neq`: Not equal
- `gt`, `gte`, `lt`, `lte`: Comparisons
- `like`, `ilike`: Pattern matching
- `in`: In list

#### Complex Queries

```
GET /cirrus/search/Pool?tokenA=eq.93fb...&select=address,tokenA,tokenB,aToBRatio&order=aToBRatio.desc&limit=10
```

Returns top 10 pools by ratio containing specific token.

## Gas Management

### Estimate Gas

```
POST /strato-api/eth/v1.2/transaction/estimateGas
Content-Type: application/json

{
  "from": "f11d828c8c126428ab0f46bce3112681931da9fb",
  "to": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  "data": "0x..."
}
```

**Response:**

```json
{
  "gasEstimate": "45000"
}
```

### Gas Price

```
GET /strato-api/eth/v1.2/gasPrice
```

Returns current gas price in wei.

## Advanced Features

### Batch Requests

Send multiple calls in one request:

```
POST /strato-api/eth/v1.2/batch
Content-Type: application/json

[
  {
    "method": "GET",
    "path": "/eth/v1.2/account/f11d.../balance"
  },
  {
    "method": "POST",
    "path": "/eth/v1.2/contract/93fb.../call",
    "body": {
      "method": "balanceOf",
      "args": {"owner": "f11d..."}
    }
  }
]
```

Returns array of responses.

### Transaction Receipts

```
GET /strato-api/eth/v1.2/transaction/{txHash}/receipt
```

**Response includes:**

- Gas used
- Status (success/failure)
- Logs emitted
- Contract address (if contract creation)

## Error Handling

### Error Format

```json
{
  "error": {
    "code": "TRANSACTION_REVERTED",
    "message": "execution reverted: insufficient balance",
    "details": {
      "txHash": "0xabc123...",
      "revertReason": "insufficient balance"
    }
  }
}
```

### Common Errors

- **INSUFFICIENT_FUNDS**: Account balance too low
- **NONCE_TOO_LOW**: Transaction nonce already used
- **TRANSACTION_REVERTED**: Smart contract rejected transaction
- **GAS_LIMIT_EXCEEDED**: Transaction ran out of gas
- **INVALID_SIGNATURE**: Transaction signature invalid

## Best Practices

### 1. Nonce Management

Track nonces per account to avoid conflicts:

```javascript
let currentNonce = await api.getAccount(address).nonce;

async function sendTx(txData) {
  txData.nonce = currentNonce++;
  const result = await api.sendTransaction(txData);
  return result;
}
```

### 2. Gas Estimation

Always estimate gas before sending:

```javascript
const gasEstimate = await api.estimateGas(txData);
txData.gasLimit = Math.ceil(gasEstimate * 1.2); // 20% buffer
```

### 3. Transaction Confirmation

Wait for sufficient confirmations:

```javascript
async function waitForConfirmation(txHash, confirmations = 3) {
  while (true) {
    const tx = await api.getTransaction(txHash);
    if (tx.status === 'confirmed') {
      const currentBlock = await api.getLatestBlock();
      const confirmationCount = currentBlock.number - tx.blockNumber;
      if (confirmationCount >= confirmations) return tx;
    }
    await sleep(5000);
  }
}
```

### 4. Event Monitoring

Use WebSocket for real-time events instead of polling:

```javascript
// ✅ Good (WebSocket)
ws.on('Transfer', handleTransfer);

// ❌ Bad (polling)
setInterval(async () => {
  const logs = await api.getLogs(...);
}, 5000);
```

## Security

### Transaction Signing

For sensitive operations, sign transactions client-side:

```javascript
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(privateKey);
const signedTx = await wallet.signTransaction(txData);
await api.sendRawTransaction(signedTx);
```

**Never** send private keys to the API.

### API Key Protection

- Store API keys in environment variables
- Rotate keys regularly
- Use least-privilege keys (read-only when possible)
- Monitor API key usage for anomalies

## Rate Limits

- **Public endpoints**: 100 req/min
- **Authenticated**: 1000 req/min
- **WebSocket**: 50 subscriptions per connection

## Related Docs

- [App API](api.md) - High-level DeFi API
- [Architecture](architecture.md) - System architecture
- [E2E Examples](../build-apps/e2e.md) - Complete application examples


