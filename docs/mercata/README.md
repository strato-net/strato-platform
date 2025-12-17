# Mercata Backend API

The Mercata Backend API provides DeFi functionality including token management, lending, swapping, and rewards.

## Base URL

```
https://<node-host>/api
```

## Authentication

All endpoints require OAuth 2.0 Bearer token authentication unless marked as public.

```
Authorization: Bearer <access_token>
```

## Swagger Interactive Docs
For full swagger documentation of the backend API, with an interactive Try it Out interface, please visit https://app.testnet.strato.nexus/api/docs/ or `/api/docs` on your preferred node.

## API Reference

### Overview

| Route | Description |
|-------|-------------|
| `/user` | User management |
| `/tokens` | Token operations (v1) |
| `/tokens/v2` | Token operations (v2) |
| `/vouchers` | Voucher balance |
| `/config` | Platform configuration |
| `/oracle` | Price oracle |
| `/swap/*` | Token swapping |
| `/lending` | Lending protocol |
| `/events` | Event queries |
| `/bridge` | Cross-chain bridge |
| `/cdp` | Collateralized Debt Positions |
| `/rewards` | Rewards distribution |
| `/protocol-fees` | Protocol fee management |
| `/docs` | Swagger documentation |
| `/health` | Health check |

---

## Modules

### [Tokens](Tokens.md)

Token management and operations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tokens` | List all tokens |
| `GET` | `/tokens/:address` | Get token details |
| `POST` | `/tokens/create` | Create new token |
| `POST` | `/tokens/transfer` | Transfer tokens |
| `POST` | `/tokens/approve` | Approve spending |
| `GET` | `/tokens/v2/balances` | Get user balances (v2) |
| `GET` | `/vouchers/balance` | Get voucher balance |

### [Lending](Lending.md)

DeFi lending protocol operations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/lending/pools` | List lending pools |
| `GET` | `/lending/pools/:id` | Get pool details |
| `POST` | `/lending/deposit` | Deposit collateral |
| `POST` | `/lending/withdraw` | Withdraw collateral |
| `POST` | `/lending/borrow` | Borrow assets |
| `POST` | `/lending/repay` | Repay loan |
| `GET` | `/lending/positions` | Get user positions |
| `GET` | `/lending/health` | Get health factor |

### [Pools](Pools.md)

Liquidity pool and AMM operations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/swap/pools` | List liquidity pools |
| `GET` | `/swap/pools/:id` | Get pool details |
| `POST` | `/swap/addLiquidity` | Add liquidity |
| `POST` | `/swap/removeLiquidity` | Remove liquidity |
| `GET` | `/swap/quote` | Get swap quote |
| `POST` | `/swap/execute` | Execute swap |

### [Bridge](Bridge.md)

Cross-chain asset transfer.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/bridge/supported` | List supported chains |
| `GET` | `/bridge/status/:id` | Get transfer status |
| `POST` | `/bridge/initiate` | Start bridge transfer |
| `POST` | `/bridge/claim` | Claim bridged assets |

### [CDP](CDP.md)

Collateralized Debt Positions.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cdp/vaults` | List user vaults |
| `GET` | `/cdp/vaults/:id` | Get vault details |
| `POST` | `/cdp/open` | Open new vault |
| `POST` | `/cdp/deposit` | Deposit collateral |
| `POST` | `/cdp/withdraw` | Withdraw collateral |
| `POST` | `/cdp/borrow` | Generate debt |
| `POST` | `/cdp/repay` | Repay debt |
| `POST` | `/cdp/close` | Close vault |

### [Rewards](Rewards.md)

Rewards and incentive distribution.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/rewards/pools` | List reward pools |
| `GET` | `/rewards/pending` | Get pending rewards |
| `POST` | `/rewards/stake` | Stake tokens |
| `POST` | `/rewards/unstake` | Unstake tokens |
| `POST` | `/rewards/claim` | Claim rewards |

### [Admin](Admin.md)

Platform administration (admin only).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/config` | Get platform config |
| `POST` | `/config` | Update platform config |
| `GET` | `/protocol-fees` | Get fee configuration |
| `POST` | `/protocol-fees/collect` | Collect protocol fees |

### [Oracle](oracle.md)

Price feed operations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/oracle/prices` | Get all prices |
| `GET` | `/oracle/price/:token` | Get token price |
| `POST` | `/oracle/update` | Update price (admin) |

### Events

Event and history queries.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events` | Query events |
| `GET` | `/events/:type` | Get events by type |

---

## Common Patterns

### Pagination

```bash
GET /tokens?limit=20&offset=0
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Items per page |
| `offset` | number | 0 | Skip items |

### Filtering

```bash
GET /tokens?symbol=USDC&owner=0x1234...
```

### Sorting

```bash
GET /tokens?sort=createdAt&order=desc
```

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    // Response data
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `INSUFFICIENT_BALANCE` | 400 | Not enough tokens |
| `STRATO_ERROR` | 500 | Blockchain transaction failed |
| `CIRRUS_ERROR` | 500 | Database query failed |

---

## Health Check

```bash
GET /health
```

**Response:**
```json
{
  "name": "mercata-backend",
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Swagger Documentation

Interactive API documentation is available at:
```
https://<node-host>/api/docs
```

OpenAPI spec available at:
```
https://<node-host>/api/public/api-docs.json
```

---

## Related Documentation

- [Architecture Overview](../architecture/README.md)
- [Smart Contracts](../architecture/contracts.md)
- [Lending Pool Overview](lending_pool_overview.md)
- [Rewards Design](../design/rewards.md)
