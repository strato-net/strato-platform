# Loop Widget — Backend POC Guide

Backend-only looping orchestration for [issue #6608](https://github.com/strato-net/strato-platform/issues/6608).

## Prerequisites

- Node.js v22.12+
- `.env` in `mercata/backend/` with:

```
NODE_URL=https://node1.testnet.strato.nexus/
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
OAUTH_CLIENT_ID=localhost
OAUTH_CLIENT_SECRET=<your-secret>
```

## Start

```bash
cd mercata/backend
npm i
npm run dev
```

Verify: `curl http://localhost:3001/api/health`

## Auth — Get User Token

```bash
export KC_TOKEN_URL="https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token"

export USER_TOKEN=$(curl -s -X POST "$KC_TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=localhost&client_secret=<secret>&username=<email>&password=<pwd>" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Validate: `curl -s http://localhost:3001/api/user/me -H "Authorization: Bearer $USER_TOKEN"`

## Endpoints

### GET /api/loop/bootstrap

Returns all data for frontend-local quote calculation.

```bash
curl -s http://localhost:3001/api/loop/bootstrap | python3 -m json.tool
```

Response includes:
- `version` — hash for cache/comparison
- `routes.lending` — assets with LTV, prices, liquidation thresholds, borrow/supply APY
- `routes.cdp` — assets with minCR, liquidation ratio, stability fee, debt floor/ceiling
- `gasFeePerStep`, `maxLoops`

### POST /api/loop/execute

Execute a loop strategy (sync blocking).

```bash
curl -s -X POST http://localhost:3001/api/loop/execute \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-here" \
  -d '{
    "routeType": "lending_loop",
    "asset": "93fb7295859b2d70199e0a4883b7c320cf874e6c",
    "amount": "1000000000000000000",
    "loops": 2,
    "dryRun": true
  }'
```

Parameters:
- `routeType`: `lending_loop` or `cdp_loop`
- `asset`: collateral token address (40 hex chars, no 0x)
- `amount`: wei string
- `loops`: 1–5
- `dryRun`: if true, validates and returns without chain tx
- `minHealthFactor`: optional, minimum 1.15
- `Idempotency-Key` header: prevents duplicate execution on retry

Response:
- `requestId`, `bootstrapVersion`
- `plannedSteps`, `executedSteps[]` with per-step `action`, `status`, `txHash`
- `terminalState` with collateral/debt/leverage/healthFactor

### GET /api/loop/history

```bash
curl -s http://localhost:3001/api/loop/history \
  -H "Authorization: Bearer $USER_TOKEN"
```

Returns past executions with requestId, status, txHashes.

## Route Mechanics

### lending_loop

Each iteration:
1. Approve + supply collateral to lending pool
2. Borrow USDST against collateral (amount = supplied * LTV / 10000)
3. Swap borrowed USDST back to collateral asset via swap pool

Swapped collateral becomes input for the next loop iteration.

### cdp_loop

Each iteration:
1. Approve + deposit collateral to CDP vault
2. Mint USDST against collateral (95% of max mintable at minCR)
3. Swap minted USDST back to collateral asset via swap pool

Swapped collateral becomes input for the next loop iteration.

Both routes require a swap pool to exist for the USDST <-> collateral pair. The execute endpoint will reject with an error if no pool is found.

## Validation Errors (400)

| Case | Message |
|------|---------|
| Bad route type | `routeType must be one of: lending_loop, cdp_loop` |
| Loops > 5 | `loops must not exceed 5` |
| Zero amount | `amount must be greater than 0` |
| Bad address | `asset must be a valid Ethereum address` |
| Low health factor | `minHealthFactor must be at least 1.15` |

## Debug

- **401**: token expired or bad format; re-acquire from Keycloak
- **Boot failure**: check `NODE_URL` connectivity to `/strato-api/eth/v1.2/metadata`
- **Execute failure**: check `executedSteps[].error` for step-local reason
- **Cirrus issues**: check backend console for query errors; verify address case (lowercase, no 0x)
