# Mercata MCP server

Model Context Protocol server that exposes the Mercata web app backend.

## Setup

```
cd griphook
npm install
```

### Required Environment Variables

Authentication (BlockApps OAuth):
- `BA_USERNAME` – BlockApps username
- `BA_PASSWORD` – BlockApps password
- `CLIENT_ID` – OAuth client ID
- `CLIENT_SECRET` – OAuth client secret
- `OPENID_DISCOVERY_URL` – OpenID Connect discovery endpoint (e.g., `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration`)

### Optional Environment Variables

- `NODE_URL` – BlockApps node URL (default `http://localhost`)
- `MERCATA_API_BASE_URL` – API base URL (default `http://localhost:3001/api`)
- `MERCATA_HTTP_TIMEOUT_MS` – HTTP timeout in ms (default 15000)

## Run

```
npm run dev      # hot-reload via tsx
npm run build    # emit dist/
npm start        # run compiled server
```

Transports:
- Stdio transport (default for Claude Code/other MCP-aware clients when launched as a command).
- HTTP Streamable transport (enabled by default) at `http://127.0.0.1:3005/mcp` with SSE at `/mcp/events`. Override with:
  - `MERCATA_MCP_HTTP_ENABLED` (true/false)
  - `MERCATA_MCP_HTTP_HOST` (default 127.0.0.1)
  - `MERCATA_MCP_HTTP_PORT` (default 3005)
  - `MERCATA_MCP_HTTP_PATH` (default /mcp)
  - `MERCATA_MCP_HTTP_SSE_PATH` (default {path}/events)

Tools:
- `mercata.api-request` – raw HTTP call to any endpoint
- Domain snapshots: `mercata.tokens`, `mercata.swap`, `mercata.lending`, `mercata.cdp`, `mercata.bridge`, `mercata.rewards`, `mercata.admin`, `mercata.events`, `mercata.protocol-fees`, `mercata.rpc`
- Swap actions: `mercata.swap.create-pool`, `mercata.swap.add-liquidity`, `mercata.swap.add-liquidity-single`, `mercata.swap.remove-liquidity`, `mercata.swap.execute`
- Token actions: `mercata.tokens.create`, `mercata.tokens.transfer`, `mercata.tokens.approve`, `mercata.tokens.transfer-from`, `mercata.tokens.set-status`
- Lending actions: `mercata.lending.supply-collateral`, `mercata.lending.withdraw-collateral`, `mercata.lending.withdraw-collateral-max`, `mercata.lending.borrow`, `mercata.lending.borrow-max`, `mercata.lending.repay`, `mercata.lending.repay-all`, `mercata.lending.deposit-liquidity`, `mercata.lending.withdraw-liquidity`, `mercata.lending.withdraw-liquidity-all`, `mercata.lending.safety-stake`, `mercata.lending.safety-cooldown`, `mercata.lending.safety-redeem`, `mercata.lending.safety-redeem-all`, `mercata.lending.liquidate`, `mercata.lending.configure-asset`, `mercata.lending.sweep-reserves`, `mercata.lending.set-debt-ceilings`, `mercata.lending.pause`, `mercata.lending.unpause`
- CDP actions: `mercata.cdp.deposit`, `mercata.cdp.withdraw`, `mercata.cdp.withdraw-max`, `mercata.cdp.mint`, `mercata.cdp.mint-max`, `mercata.cdp.repay`, `mercata.cdp.repay-all`, `mercata.cdp.liquidate`, `mercata.cdp.set-collateral-config`, `mercata.cdp.set-collateral-config-batch`, `mercata.cdp.set-asset-paused`, `mercata.cdp.set-asset-supported`, `mercata.cdp.set-global-paused`, `mercata.cdp.open-junior-note`, `mercata.cdp.top-up-junior-note`, `mercata.cdp.claim-junior-note`
- Bridge actions: `mercata.bridge.request-withdrawal`, `mercata.bridge.request-auto-save`
- Rewards actions: `mercata.rewards.claim`, `mercata.rewards.claim-all-activities`, `mercata.rewards.claim-activity`
- Admin/governance actions: `mercata.admin.add-admin`, `mercata.admin.remove-admin`, `mercata.admin.vote`, `mercata.admin.vote-by-id`, `mercata.admin.dismiss-issue`
- Oracle actions: `mercata.oracle.set-price`

Resources:
- `mercata://resources/endpoints` – endpoint map by feature
- `mercata://resources/config` – current MCP configuration
