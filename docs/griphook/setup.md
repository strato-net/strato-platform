# Setup & Configuration

This guide covers installation, environment variables, and running Griphook.

## Prerequisites

- Node.js 18+
- npm or yarn
- Access to a STRATO deployment
- BlockApps OAuth credentials

## Installation

```bash
cd griphook
npm install
```

## Environment Variables

### Required (Authentication)

These variables are required for Griphook to authenticate with the STRATO backend:

| Variable | Description | Example |
|----------|-------------|---------|
| `BLOCKAPPS_USERNAME` | BlockApps account username | `user@example.com` |
| `BLOCKAPPS_PASSWORD` | BlockApps account password | `secretpassword` |
| `OAUTH_CLIENT_ID` | OAuth 2.0 client ID | `strato-client` |
| `OAUTH_CLIENT_SECRET` | OAuth 2.0 client secret | `client-secret-value` |
| `OPENID_DISCOVERY_URL` | OpenID Connect discovery endpoint | `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration` |

### Optional (STRATO Backend)

Configure the STRATO backend connection:

| Variable | Description | Default |
|----------|-------------|---------|
| `STRATO_NODE_URL` | STRATO blockchain node URL | `http://localhost` |
| `STRATO_API_BASE_URL` | STRATO API base URL | `http://localhost:3001/api` |
| `STRATO_HTTP_TIMEOUT_MS` | HTTP request timeout in milliseconds | `15000` |

### Optional (Griphook Server)

Configure the Griphook MCP server itself:

| Variable | Description | Default |
|----------|-------------|---------|
| `GRIPHOOK_HTTP_ENABLED` | Enable HTTP transport | `true` |
| `GRIPHOOK_HTTP_HOST` | HTTP server bind address | `127.0.0.1` |
| `GRIPHOOK_HTTP_PORT` | HTTP server port | `3005` |
| `GRIPHOOK_HTTP_PATH` | HTTP endpoint path | `/mcp` |
| `GRIPHOOK_HTTP_SSE_PATH` | Server-Sent Events path | `/mcp/events` |

## Running Griphook

### Development Mode
Hot-reload during development:
```bash
npm run dev
```

### Production Build
Build and run compiled JavaScript:
```bash
npm run build
npm start
```

## Transports

Griphook supports two MCP transports simultaneously:

### Stdio Transport
The default transport for CLI-based MCP clients. When you launch Griphook as a subprocess, it communicates over stdin/stdout using the MCP protocol.

Used by:
- Claude Code
- Other MCP-aware CLI tools

### HTTP Streamable Transport
A REST-based transport for web integrations and remote connections.

- **Endpoint**: `POST http://{host}:{port}{path}`
- **SSE**: `GET http://{host}:{port}{ssePath}`

Default: `http://127.0.0.1:3005/mcp` with SSE at `/mcp/events`

To disable HTTP transport:
```bash
GRIPHOOK_HTTP_ENABLED=false npm start
```

## Example Configurations

### Local Development
```bash
export BLOCKAPPS_USERNAME="dev@example.com"
export BLOCKAPPS_PASSWORD="devpassword"
export OAUTH_CLIENT_ID="strato-dev"
export OAUTH_CLIENT_SECRET="dev-secret"
export OPENID_DISCOVERY_URL="http://localhost:8080/auth/realms/dev/.well-known/openid-configuration"
export STRATO_API_BASE_URL="http://localhost:3001/api"

npm run dev
```

### Production (Helium Testnet)
```bash
export BLOCKAPPS_USERNAME="user@company.com"
export BLOCKAPPS_PASSWORD="$VAULT_PASSWORD"
export OAUTH_CLIENT_ID="production-client"
export OAUTH_CLIENT_SECRET="$VAULT_CLIENT_SECRET"
export OPENID_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration"
export STRATO_API_BASE_URL="https://helium.blockapps.net/api"
export GRIPHOOK_HTTP_HOST="0.0.0.0"
export GRIPHOOK_HTTP_PORT="8080"

npm start
```

### Claude Code Integration
Add to `~/.claude/claude_code_config.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "griphook": {
      "command": "node",
      "args": ["/absolute/path/to/griphook/dist/server.js"],
      "env": {
        "BLOCKAPPS_USERNAME": "your-username",
        "BLOCKAPPS_PASSWORD": "your-password",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "OPENID_DISCOVERY_URL": "https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration",
        "STRATO_API_BASE_URL": "https://helium.blockapps.net/api"
      }
    }
  }
}
```

## Authentication Flow

Griphook handles OAuth automatically:

1. On first API request, discovers token endpoint from `OPENID_DISCOVERY_URL`
2. Acquires access token using Resource Owner Password Credentials grant
3. Caches token until 2 minutes before expiration
4. Automatically refreshes expired tokens

You do not need to manage tokens manually - all MCP tool calls are authenticated transparently.

## Troubleshooting

### Missing Environment Variable Error
```
Error: Missing required environment variable: BLOCKAPPS_USERNAME
```
Ensure all required environment variables are set before starting.

### OAuth Token Failure
```
Error: Failed to acquire access token
```
- Verify credentials are correct
- Check `OPENID_DISCOVERY_URL` is accessible
- Ensure client ID/secret match the OAuth provider configuration

### Connection Refused
```
Error: connect ECONNREFUSED 127.0.0.1:3001
```
- Verify `STRATO_API_BASE_URL` points to a running STRATO instance
- Check network connectivity and firewall rules

### HTTP Transport Not Starting
If HTTP transport fails but stdio works:
- Check if the port is already in use
- Verify `GRIPHOOK_HTTP_HOST` is a valid bind address
- Review logs for specific error messages
