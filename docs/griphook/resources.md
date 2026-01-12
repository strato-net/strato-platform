# Resources

Griphook exposes two MCP resources that provide documentation and configuration information.

## strato://resources/endpoints

**URI:** `strato://resources/endpoints`
**MIME Type:** `text/markdown`
**Description:** STRATO API endpoints mapped to UI features.

This resource provides a comprehensive overview of all STRATO backend API endpoints, organized by feature area. It serves as a reference for understanding what operations are available and how to call them.

### Content

The endpoints resource includes documentation for:

- **Authentication** - OAuth token handling and configuration
- **User & Admin** - User profile, admin management, governance
- **Tokens & Balances** - Token catalog, balances, transfers
- **Swaps & Liquidity** - Swap pools, liquidity operations
- **Lending Pools** - Collateral, loans, liquidations, safety module
- **CDP Engine** - Vaults, minting, repayment, admin config
- **Bridge** - Cross-chain configurations and transactions
- **Rewards** - Pending rewards, activities, leaderboard
- **Oracle & Protocol Fees** - Price feeds, revenue metrics
- **Events & RPC** - Chain events, JSON-RPC proxy
- **Config & Health** - Platform configuration, health checks

### Example Usage

When an AI agent needs to understand available API endpoints:

```
Agent: Read resource strato://resources/endpoints

Response: # STRATO API surface

Authentication
- OAuth tokens are acquired automatically using BlockApps credentials...
- Base URL defaults to http://localhost:3001/api...

User & Admin
- GET /user/me – current address, admin flag, username.
- GET /user/admin – list admins...
...
```

---

## strato://resources/config

**URI:** `strato://resources/config`
**MIME Type:** `text/markdown`
**Description:** Active MCP configuration and environment hints.

This resource displays the current Griphook configuration, showing how the server is configured and what environment variables affect its behavior.

### Content

The config resource includes:

- **Runtime Configuration**
  - API base URL
  - OAuth username and client ID
  - OpenID discovery URL
  - HTTP timeout setting

- **Authentication Modes**
  - Browser login (recommended): Run `griphook login` to authenticate
  - Token mode: Set `STRATO_ACCESS_TOKEN` directly

- **Environment Variables**
  - `STRATO_API_BASE_URL`
  - `STRATO_HTTP_TIMEOUT_MS`
  - `GRIPHOOK_HTTP_ENABLED`
  - `GRIPHOOK_HTTP_HOST`
  - `GRIPHOOK_HTTP_PORT`
  - `GRIPHOOK_HTTP_PATH`
  - `GRIPHOOK_HTTP_SSE_PATH`

### Example Usage

When an AI agent needs to understand the current configuration:

```
Agent: Read resource strato://resources/config

Response: # Griphook configuration

- API base: https://buildtest.mercata-testnet.blockapps.net/api
- OAuth client ID: localhost
- OpenID discovery: https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
- HTTP timeout: 15000ms

Authentication modes:
1. Browser login (recommended): Run 'griphook login' to authenticate via browser
2. Token mode: Set STRATO_ACCESS_TOKEN with a pre-obtained access token
...
```

---

## Using Resources

In MCP, resources are read-only data sources that provide context to AI agents. Unlike tools (which perform actions), resources provide information.

### Reading Resources in Claude

Claude Code and other MCP clients can read resources using the MCP protocol:

```typescript
// Example: Reading the endpoints resource
const result = await client.readResource({
  uri: "strato://resources/endpoints"
});

console.log(result.contents[0].text);
```

### When to Use Resources vs Tools

| Use Case | Resource or Tool |
|----------|-----------------|
| Understanding available API endpoints | Resource: `strato://resources/endpoints` |
| Checking current configuration | Resource: `strato://resources/config` |
| Fetching live token data | Tool: `strato.tokens` |
| Executing a swap | Tool: `strato.swap.execute` |
| Querying lending positions | Tool: `strato.lending` |

Resources are static documentation; tools interact with the live STRATO backend.
