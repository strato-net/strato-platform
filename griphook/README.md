# Griphook

Griphook is an MCP (Model Context Protocol) server that exposes the STRATO web app backend to AI agents.

## Setup

```bash
cd griphook
npm install
npm run build
```

## Authentication

Griphook supports two authentication modes:

### 1. Browser Mode (Recommended)
```bash
export OAUTH_CLIENT_ID="localhost"
export OAUTH_CLIENT_SECRET="your-client-secret"
export OPENID_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration"
export STRATO_API_BASE_URL="https://buildtest.mercata-testnet.blockapps.net/api"

npm run login   # Opens browser for OAuth
npm start       # Start the server
```

Credentials are stored in `~/.griphook/credentials.json`.

### 2. Token Mode
```bash
export STRATO_ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIs..."
npm start
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `npm run login` | Authenticate via browser |
| `npm run logout` | Clear stored credentials |
| `npm run status` | Check authentication status |

## Environment Variables

### Optional (STRATO Backend)

- `STRATO_NODE_URL` - STRATO node URL (default `http://localhost`)
- `STRATO_API_BASE_URL` - API base URL (default `http://localhost:3001/api`)
- `STRATO_HTTP_TIMEOUT_MS` - HTTP timeout in ms (default 15000)

### Optional (Griphook Server)

- `GRIPHOOK_HTTP_ENABLED` (true/false, default true)
- `GRIPHOOK_HTTP_HOST` (default 127.0.0.1)
- `GRIPHOOK_HTTP_PORT` (default 3005)
- `GRIPHOOK_HTTP_PATH` (default /mcp)
- `GRIPHOOK_HTTP_SSE_PATH` (default {path}/events)

## Run

```bash
npm run dev      # hot-reload via tsx
npm run build    # emit dist/
npm start        # run compiled server
```

## Transports

- **Stdio** - Default for Claude Code and MCP-aware CLI clients
- **HTTP Streamable** - REST-based at `http://127.0.0.1:3005/mcp` with SSE at `/mcp/events`

## Tools (67 total)

### Data Snapshots (10)
`strato.tokens`, `strato.swap`, `strato.lending`, `strato.cdp`, `strato.bridge`, `strato.rewards`, `strato.admin`, `strato.events`, `strato.protocol-fees`, `strato.rpc`

### Swap Actions (5)
`strato.swap.create-pool`, `strato.swap.add-liquidity`, `strato.swap.add-liquidity-single`, `strato.swap.remove-liquidity`, `strato.swap.execute`

### Token Actions (5)
`strato.tokens.create`, `strato.tokens.transfer`, `strato.tokens.approve`, `strato.tokens.transfer-from`, `strato.tokens.set-status`

### Lending Actions (20)
`strato.lending.supply-collateral`, `strato.lending.withdraw-collateral`, `strato.lending.withdraw-collateral-max`, `strato.lending.borrow`, `strato.lending.borrow-max`, `strato.lending.repay`, `strato.lending.repay-all`, `strato.lending.deposit-liquidity`, `strato.lending.withdraw-liquidity`, `strato.lending.withdraw-liquidity-all`, `strato.lending.safety-stake`, `strato.lending.safety-cooldown`, `strato.lending.safety-redeem`, `strato.lending.safety-redeem-all`, `strato.lending.liquidate`, `strato.lending.configure-asset`, `strato.lending.sweep-reserves`, `strato.lending.set-debt-ceilings`, `strato.lending.pause`, `strato.lending.unpause`

### CDP Actions (16)
`strato.cdp.deposit`, `strato.cdp.withdraw`, `strato.cdp.withdraw-max`, `strato.cdp.mint`, `strato.cdp.mint-max`, `strato.cdp.repay`, `strato.cdp.repay-all`, `strato.cdp.liquidate`, `strato.cdp.set-collateral-config`, `strato.cdp.set-collateral-config-batch`, `strato.cdp.set-asset-paused`, `strato.cdp.set-asset-supported`, `strato.cdp.set-global-paused`, `strato.cdp.open-junior-note`, `strato.cdp.top-up-junior-note`, `strato.cdp.claim-junior-note`

### Bridge Actions (2)
`strato.bridge.request-withdrawal`, `strato.bridge.request-auto-save`

### Rewards Actions (3)
`strato.rewards.claim`, `strato.rewards.claim-all-activities`, `strato.rewards.claim-activity`

### Admin Actions (5)
`strato.admin.add-admin`, `strato.admin.remove-admin`, `strato.admin.vote`, `strato.admin.vote-by-id`, `strato.admin.dismiss-issue`

### Oracle Actions (1)
`strato.oracle.set-price`

## Resources

- `strato://resources/endpoints` - Endpoint map by feature
- `strato://resources/config` - Current MCP configuration

## Tested Against

Successfully tested against `buildtest.mercata-testnet.blockapps.net`:
- **Read endpoints**: 100% success (45/45)
- **Write endpoints**: All responding correctly (business logic errors are expected when user lacks balances/permissions)

See [docs/griphook/](../docs/griphook/) for full documentation.
