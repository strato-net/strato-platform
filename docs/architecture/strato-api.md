# STRATO API Reference

The STRATO API provides low-level blockchain operations including transaction submission, contract management, and block/state queries.

## Swagger Interactive Docs
For full swagger documentation of the STRATO API, with an interactive Try it Out interface, please visit https://app.testnet.strato.nexus/docs/ or `/docs` on your preferred node.

## Base URL

```
https://<node-host>/strato/v2.3
```

## API Modules

### Bloc API

The Bloc API handles smart contract operations and transactions.

#### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Get node info and git version details |
| `GET` | `/contracts` | List deployed contracts |
| `POST` | `/contracts/compile` | Compile Solidity source code |
| `POST` | `/contracts/xabi` | Get extended ABI for contract |
| `GET` | `/contracts/:address` | Get contract details |
| `GET` | `/contracts/:address/state` | Get contract state |
| `GET` | `/contracts/:address/functions` | Get contract functions |
| `GET` | `/contracts/:address/symbols` | Get contract symbols |
| `POST` | `/transaction` | Submit signed transaction |
| `POST` | `/transaction/parallel` | Submit parallel transactions |
| `POST` | `/transaction/unsigned` | Generate unsigned transaction |
| `GET` | `/transaction/result/:hash` | Get transaction result |
| `POST` | `/transaction/results` | Get multiple transaction results |

### Core API

The Core API provides blockchain data queries.

#### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/account` | Get account information |
| `GET` | `/block` | Get block by number or hash |
| `GET` | `/block/last/:n` | Get last N blocks |
| `GET` | `/transaction/:hash` | Get transaction details |
| `GET` | `/transaction/last/:n` | Get last N transactions |
| `GET` | `/stats` | Get node statistics |
| `GET` | `/peers` | Get connected peers |
| `GET` | `/storage/:address` | Get raw storage for address |
| `GET` | `/metadata` | Get node metadata |

### Ethereum JSON-RPC

Standard Ethereum JSON-RPC interface for compatibility.

#### Supported Methods

| Method | Description |
|--------|-------------|
| `eth_blockNumber` | Get current block number |
| `eth_getBlockByNumber` | Get block by number |
| `eth_getBlockByHash` | Get block by hash |
| `eth_getTransactionByHash` | Get transaction by hash |
| `eth_getTransactionReceipt` | Get transaction receipt |
| `eth_getBalance` | Get account balance |
| `eth_getCode` | Get contract code |
| `eth_call` | Execute contract call (read-only) |
| `eth_sendRawTransaction` | Submit raw transaction |
| `eth_estimateGas` | Estimate gas for transaction |

## Authentication

All API endpoints require OAuth 2.0 authentication. Include the access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Request/Response Examples

### Compile Contract

**Request:**
```bash
POST /strato/v2.3/contracts/compile
Content-Type: application/json

{
  "source": "pragma solidity ^0.8.0; contract SimpleStorage { uint256 value; function set(uint256 v) public { value = v; } function get() public view returns (uint256) { return value; } }",
  "contractName": "SimpleStorage"
}
```

**Response:**
```json
{
  "contracts": {
    "SimpleStorage": {
      "bin": "608060405234801561001057600080fd5b50...",
      "abi": [
        {
          "inputs": [{"name": "v", "type": "uint256"}],
          "name": "set",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "get",
          "outputs": [{"type": "uint256"}],
          "type": "function"
        }
      ]
    }
  }
}
```

### Submit Transaction

**Request:**
```bash
POST /strato/v2.3/transaction
Content-Type: application/json

{
  "txs": [{
    "payload": {
      "contractName": "SimpleStorage",
      "contractAddress": "0x1234...",
      "method": "set",
      "args": {
        "v": 42
      }
    },
    "type": "FUNCTION"
  }],
  "txParams": {
    "gasLimit": 100000,
    "gasPrice": 1
  }
}
```

**Response:**
```json
{
  "hash": "0xabc123...",
  "status": "Pending"
}
```

### Get Transaction Result

**Request:**
```bash
GET /strato/v2.3/transaction/result/0xabc123...
```

**Response:**
```json
{
  "hash": "0xabc123...",
  "status": "Success",
  "blockNumber": 12345,
  "gasUsed": 21000,
  "contractsCreated": [],
  "events": []
}
```

### Get Account Info

**Request:**
```bash
GET /strato/v2.3/account?address=0x1234...
```

**Response:**
```json
{
  "address": "0x1234...",
  "balance": "1000000000000000000",
  "nonce": 5,
  "kind": "EOA"
}
```

## Error Responses

| Status Code | Description |
|-------------|-------------|
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Invalid or missing token |
| `404` | Not Found - Resource doesn't exist |
| `500` | Internal Server Error |

**Error Response Format:**
```json
{
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

## Rate Limiting

API requests are subject to rate limiting. Default limits:
- 1000 requests per minute per user
- 100 concurrent connections per IP

## Pragmas

SolidVM supports various pragma directives to enable features:

| Pragma | Description |
|--------|-------------|
| `pragma solidvm 12.0` | Latest SolidVM features |
| `pragma strict` | Enable strict visibility modifiers |
| `pragma es6` | Enable braced and qualified imports |
| `pragma safeExternalCalls` | Enforce type safety on external calls |

## Related Documentation

- [Architecture Overview](README.md)
- [Smart Contracts](contracts.md)
- [Mercata Backend API](../mercata/README.md)
