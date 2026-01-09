# Griphook

Griphook is an MCP (Model Context Protocol) server that exposes the STRATO web app backend to AI agents and MCP-compatible clients.

## What is Griphook?

Griphook provides a bridge between AI assistants (like Claude) and the STRATO DeFi platform. Through MCP tools, AI agents can:

- Query token balances, swap pools, lending positions, and CDP vaults
- Execute DeFi operations: swaps, lending, borrowing, bridging
- Manage platform administration and governance
- Access real-time protocol data and metrics

## Key Features

### Authentication
- **BlockApps OAuth** - Automatic token acquisition using username/password credentials
- **Token Caching** - Tokens are cached and refreshed automatically before expiration
- **OpenID Connect** - Discovery-based configuration for flexible deployment

### Transports
- **Stdio** - Default transport for Claude Code and other MCP-aware CLI clients
- **HTTP Streamable** - REST-based transport with Server-Sent Events for web integrations

### Tool Categories
| Category | Tools | Description |
|----------|-------|-------------|
| **Data Snapshots** | 10 | Aggregate views of tokens, swap, lending, CDP, bridge, rewards, admin, events, fees, RPC |
| **Swap Actions** | 5 | Pool creation, liquidity management, swap execution |
| **Token Actions** | 5 | Create, transfer, approve, transferFrom, set status |
| **Lending Actions** | 20 | Collateral, borrowing, liquidity, safety module, admin |
| **CDP Actions** | 16 | Deposits, minting, repayment, liquidation, admin |
| **Bridge Actions** | 2 | Withdrawal requests, auto-save |
| **Rewards Actions** | 3 | Claim rewards across activities |
| **Admin Actions** | 5 | User management, governance voting |
| **Oracle Actions** | 1 | Price feed updates |

### Resources
- `strato://resources/endpoints` - Complete STRATO API endpoint reference
- `strato://resources/config` - Current MCP server configuration

## Quick Start

```bash
cd griphook
npm install
npm run dev
```

See [Setup](setup.md) for detailed configuration instructions.

## Integration

### Claude Code
Add to your MCP configuration:
```json
{
  "mcpServers": {
    "griphook": {
      "command": "node",
      "args": ["/path/to/griphook/dist/server.js"],
      "env": {
        "BLOCKAPPS_USERNAME": "your-username",
        "BLOCKAPPS_PASSWORD": "your-password",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "OPENID_DISCOVERY_URL": "https://keycloak.example.com/auth/realms/mercata/.well-known/openid-configuration",
        "STRATO_API_BASE_URL": "https://your-strato-instance/api"
      }
    }
  }
}
```

### HTTP Transport
When enabled (default), Griphook listens on `http://127.0.0.1:3005/mcp` with SSE at `/mcp/events`.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│    Griphook     │────▶│   STRATO API    │
│  (Claude, etc)  │◀────│   MCP Server    │◀────│    Backend      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │ MCP Protocol          │ OAuth + REST
        │ (stdio/HTTP)          │
        ▼                       ▼
   Tool calls              Authenticated
   Resources               API requests
```

## Related Documentation

- [Setup & Configuration](setup.md)
- [Tools Reference](tools.md)
- [Resources](resources.md)
