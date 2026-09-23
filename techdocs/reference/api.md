# App API - Getting Started

The **STRATO App API** is the backend behind the STRATO app. It covers tokens, swaps and pools, lending, CDP (minting USDST), bridge, rewards, vaults and staking. Each node serves it under `/api`.

!!! tip "Interactive Documentation"
    The full route list with request schemas is in the **[Interactive Swagger UI](interactive-api.md#app-api)**. You can also download the public [OpenAPI JSON](https://app.strato.nexus/api/public/api-docs.json).

## Base URL

| Network | URL |
|---------|-----|
| Mainnet | `https://app.strato.nexus/api` |
| Testnet | `https://app.testnet.strato.nexus/api` |

!!! info "Lower-level APIs"
    For blocks, raw transactions and contract state, see **[Core Platform API](strato-node-api.md)**, **[Cirrus](cirrus.md)** and **[JSON-RPC](json-rpc.md)**.

## Authentication

STRATO uses **OAuth 2.0 / OpenID Connect with Keycloak**, realm `mercata`. The App API has no login, logout or refresh endpoints.

### Browser users

Sign in at [app.strato.nexus](https://app.strato.nexus). The node keeps your session and attaches your token to `/api` calls, so you don't handle tokens yourself. See the [Quick Start](../quick-start.md).

### Integrations (client credentials)

1. Request OAuth client credentials at [support.blockapps.net](https://support.blockapps.net).
2. Get an access token from Keycloak:

    ```bash
    curl -s -X POST \
      https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token \
      -d grant_type=client_credentials \
      -d client_id="$CLIENT_ID" \
      -d client_secret="$CLIENT_SECRET"
    ```

    The response is a standard OAuth 2.0 token response. Use its `access_token`, and request a new one when `expires_in` runs out.

3. Send the token with each request:

    ```bash
    curl -s https://app.testnet.strato.nexus/api/vouchers/balance \
      -H "Authorization: Bearer $ACCESS_TOKEN"
    ```

Keep client secrets out of source code and logs.

### Access rules

| Request | Result |
|---------|--------|
| `GET` without a token | Allowed for public data. Routes that need a user return `401 {"error":"unauthorized", ...}`. Example: `/api/user/me`. |
| `POST`, `PUT`, `PATCH`, `DELETE` without a token | `401` |
| Invalid or expired bearer token | `403` with a plain-text message from nginx |
| Valid token | The backend finds or creates the user's Vault key on the first authenticated request, and uses the token's `preferred_username` as the username |

## Route Groups

| Prefix | Area |
|--------|------|
| `/user` | Current user (`/user/me`), admin and governance issues |
| `/tokens`, `/tokens/v2` | Token list, balances, transfers, approvals, balance history |
| `/vouchers/balance` | Your voucher balance |
| `/nfts` | NFT collections and transfers |
| `/swap-pools`, `/swap`, `/swap-history` | Pools, liquidity and swaps |
| `/poolv3` | Concentrated-liquidity pools and positions |
| `/trade` | Pool-type-agnostic quotes, pairs and swaps |
| `/lending` (alias `/lend`) | Lending pools, collateral, loans, liquidations, safety module |
| `/cdp` | CDP vaults, minting and repaying USDST, liquidations |
| `/bridge` | Bridgeable tokens, network configs, withdrawals, bridge history |
| `/rewards` | Reward activities, claims, leaderboard |
| `/vault` | Vault deposits, withdrawals and info |
| `/staking` | Validator staking |
| `/psm` | PSM mint and redeem |
| `/metal-forge` | Metal token purchases |
| `/earn` | Earn opportunities and token APYs |
| `/refer` | Referral deposits and redemptions |
| `/credit-card` | Card top-up configuration |
| `/onramp` | Fiat on-ramp sessions |
| `/oracle` | Prices and price history |
| `/events` | Contract events and activity |
| `/protocol-fees` | Protocol revenue |
| `/config` | Public app configuration |
| `/v1/metrics` (also at `/api/metrics`) | TVL and stablecoin metrics |
| `/health` | Backend health |

Routes under `.../admin/...` are for platform administrators.

## Examples

### Public reads

These work without a token.

```bash
curl -s https://app.testnet.strato.nexus/api/config
```

```json
{
  "success": true,
  "data": { "networkId": "114784819836269", "networkName": "helium", "contactEnabled": true }
}
```

```bash
curl -s "https://app.testnet.strato.nexus/api/tokens?limit=1"
```

```json
[
  {
    "address": "000000000000000000000000000000000000100f",
    "_name": "lendUSDST",
    "_symbol": "lendUSDST",
    "_totalSupply": "211633657347554922364834",
    "customDecimals": 18,
    "status": "2",
    "balances": [{ "user": "0dbb9131d99c8317aa69a70909e124f2e02446e8", "balance": "99711486480772815703" }]
  }
]
```

Other public reads:

| Endpoint | Returns |
|----------|---------|
| `GET /swap-pools` | Swap pools with token details and balances |
| `GET /lending/pools` | Lending pool configuration and state |
| `GET /cdp/assets` | CDP collateral assets and their parameters |
| `GET /rewards/overview` | Reward token, emission and season |

### Writes

These need a token. Each write sends one or more on-chain transactions from your account, and each transaction pays the normal [transaction fee](../platform/transactions-and-fees.md#fees). Amounts are strings; check each endpoint's schema in Swagger for units.

| Action | Request |
|--------|---------|
| Transfer tokens | `POST /tokens/transfer` `{ "address": "<token>", "to": "<recipient>", "value": "<amount>" }` |
| Swap | `POST /swap` `{ "poolAddress": "<pool>", "isAToB": true, "amountIn": "<amount>", "minAmountOut": "<amount>" }` |
| Supply collateral | `POST /lending/collateral` `{ "asset": "<token>", "amount": "<amount>" }` |
| Withdraw collateral | `DELETE /lending/collateral` `{ "asset": "<token>", "amount": "<amount>" }` |
| Borrow USDST | `POST /lending/loans` `{ "amount": "<amount>" }` |
| Repay USDST | `PATCH /lending/loans` `{ "amount": "<amount>" }` |
| Mint USDST (CDP) | `POST /cdp/mint` `{ "asset": "<collateral token>", "amount": "<amount>" }` |
| Claim all rewards | `POST /rewards/claim-all` |

```bash
curl -s -X POST https://app.testnet.strato.nexus/api/lending/loans \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": "<amount>"}'
```

Response bodies vary by endpoint (see Swagger). For example, `POST /rewards/claim-all` returns `{ "success": true, "txHash": "..." }`. To follow a transaction to completion, see [Transaction results](../platform/transactions-and-fees.md#transaction-results).

## Errors

The backend returns errors as:

```json
{ "error": { "message": "...", "status": 400, "type": "..." } }
```

For `5xx` errors the message is replaced with a generic one. Authentication failures use the formats in [Access rules](#access-rules).

## Related Docs

- [Interactive API (Swagger)](interactive-api.md)
- [Core Platform API](strato-node-api.md)
- [Transactions & Fees](../platform/transactions-and-fees.md)
- [E2E Examples](../build-apps/e2e.md)
