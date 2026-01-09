# Griphook

Griphook is an MCP (Model Context Protocol) server that exposes the STRATO web app backend.

## Setup

```
cd griphook
npm install
```

### Required Environment Variables

Authentication (BlockApps OAuth):
- `BLOCKAPPS_USERNAME` – BlockApps username
- `BLOCKAPPS_PASSWORD` – BlockApps password
- `OAUTH_CLIENT_ID` – OAuth client ID
- `OAUTH_CLIENT_SECRET` – OAuth client secret
- `OPENID_DISCOVERY_URL` – OpenID Connect discovery endpoint (e.g., `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration`)

### Optional Environment Variables

- `STRATO_NODE_URL` – STRATO node URL (default `http://localhost`)
- `STRATO_API_BASE_URL` – API base URL (default `http://localhost:3001/api`)
- `STRATO_HTTP_TIMEOUT_MS` – HTTP timeout in ms (default 15000)

## Run

```
npm run dev      # hot-reload via tsx
npm run build    # emit dist/
npm start        # run compiled server
```

Transports:
- Stdio transport (default for Claude Code/other MCP-aware clients when launched as a command).
- HTTP Streamable transport (enabled by default) at `http://127.0.0.1:3005/mcp` with SSE at `/mcp/events`. Override with:
  - `GRIPHOOK_HTTP_ENABLED` (true/false)
  - `GRIPHOOK_HTTP_HOST` (default 127.0.0.1)
  - `GRIPHOOK_HTTP_PORT` (default 3005)
  - `GRIPHOOK_HTTP_PATH` (default /mcp)
  - `GRIPHOOK_HTTP_SSE_PATH` (default {path}/events)

Tools:
- Domain snapshots: `strato.tokens`, `strato.swap`, `strato.lending`, `strato.cdp`, `strato.bridge`, `strato.rewards`, `strato.admin`, `strato.events`, `strato.protocol-fees`, `strato.rpc`
- Swap actions: `strato.swap.create-pool`, `strato.swap.add-liquidity`, `strato.swap.add-liquidity-single`, `strato.swap.remove-liquidity`, `strato.swap.execute`
- Token actions: `strato.tokens.create`, `strato.tokens.transfer`, `strato.tokens.approve`, `strato.tokens.transfer-from`, `strato.tokens.set-status`
- Lending actions: `strato.lending.supply-collateral`, `strato.lending.withdraw-collateral`, `strato.lending.withdraw-collateral-max`, `strato.lending.borrow`, `strato.lending.borrow-max`, `strato.lending.repay`, `strato.lending.repay-all`, `strato.lending.deposit-liquidity`, `strato.lending.withdraw-liquidity`, `strato.lending.withdraw-liquidity-all`, `strato.lending.safety-stake`, `strato.lending.safety-cooldown`, `strato.lending.safety-redeem`, `strato.lending.safety-redeem-all`, `strato.lending.liquidate`, `strato.lending.configure-asset`, `strato.lending.sweep-reserves`, `strato.lending.set-debt-ceilings`, `strato.lending.pause`, `strato.lending.unpause`
- CDP actions: `strato.cdp.deposit`, `strato.cdp.withdraw`, `strato.cdp.withdraw-max`, `strato.cdp.mint`, `strato.cdp.mint-max`, `strato.cdp.repay`, `strato.cdp.repay-all`, `strato.cdp.liquidate`, `strato.cdp.set-collateral-config`, `strato.cdp.set-collateral-config-batch`, `strato.cdp.set-asset-paused`, `strato.cdp.set-asset-supported`, `strato.cdp.set-global-paused`, `strato.cdp.open-junior-note`, `strato.cdp.top-up-junior-note`, `strato.cdp.claim-junior-note`
- Bridge actions: `strato.bridge.request-withdrawal`, `strato.bridge.request-auto-save`
- Rewards actions: `strato.rewards.claim`, `strato.rewards.claim-all-activities`, `strato.rewards.claim-activity`
- Admin/governance actions: `strato.admin.add-admin`, `strato.admin.remove-admin`, `strato.admin.vote`, `strato.admin.vote-by-id`, `strato.admin.dismiss-issue`
- Oracle actions: `strato.oracle.set-price`

Resources:
- `strato://resources/endpoints` – endpoint map by feature
- `strato://resources/config` – current MCP configuration
