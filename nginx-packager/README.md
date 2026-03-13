# Nginx Packager

OpenResty-based nginx reverse proxy for STRATO platform with OAuth2/OIDC authentication and CSRF protection.

## Features

- **OAuth2/OIDC Authentication** - Integrated with Identity Provider via OpenID Connect
- **CSRF Protection** - Double-submit cookie pattern for API endpoint protection
- **Rate Limiting** - Configurable rate limits with Docker network bypass
- **SSL/TLS Support** - Configurable HTTPS with certificate management
- **Prometheus Metrics** - Built-in metrics collection and export
- **Security Headers** - Content-Security-Policy, X-Frame-Options, etc.
- **API Reverse Proxy** - Routes to multiple backend services:
  - Mercata Backend API (`/api/`)
  - Mercata UI (`/`)
  - STRATO API (`/strato-api/`)
  - Blockchain API (`/bloc/v2.2/`)
  - Apex API (`/apex-api/`)
  - Cirrus Search (`/cirrus/search/`)
  - SMD UI (`/smd/`)
  - Swagger Documentation (`/docs/`)
  - Prometheus (`/prometheus`)

## CSRF Protection

Browser-based API requests are protected against CSRF attacks using the double-submit cookie pattern. This happens transparently at the edge with **zero backend changes required**.

**Important**: CSRF protection **only applies to browser requests** (detected via User-Agent). API clients like curl, Postman, mobile apps, and server-to-server calls are **automatically exempt** for better developer experience.

Protected endpoints (browser requests only):
- `/api/*` - Mercata backend
- `/apex-api/user`, `/apex-api/status` - User management
- `/bloc/v2.2/*` - Blockchain transactions
- `/strato-api/*` - Blockchain API
- `/strato/v2.3/transaction`, `/strato/v2.3/key`, `/strato/v2.3/users` - Transaction/key/user management

**CSRF Token Initialization**:
- `/csrf-init` - Dedicated endpoint for initializing CSRF tokens. Use this in frontend applications to ensure a token is generated before making state-changing requests.

**Frontend developers**: See [CSRF-PROTECTION.md](./CSRF-PROTECTION.md) for integration instructions.

**Swagger UI**: Automatic CSRF token injection configured. See `swagger/swagger-initializer.js`.

**API developers**: No changes needed - curl, Postman, and API clients work without CSRF tokens.

## Configuration

The nginx configuration is generated at runtime from templates:

- `nginx.tpl.conf` → `nginx.conf` - Main nginx configuration
- `openid.tpl.lua` → `openid.lua` - OAuth2/OIDC authentication logic
- `csrf.lua` - CSRF protection logic (no template, used as-is)

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_CLIENT_ID` | OAuth2 client ID | Required |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret | Required |
| `OAUTH_SCOPE` | OAuth2 scopes | `openid email profile` |
| `ssl` | Enable SSL/TLS | `false` |
| `sslCertFileType` | SSL certificate file type | `pem` |
| `blockTime` | Block time for timeout calculation | `13` |
| `STATS_ENABLED` | Enable statistics endpoints | `true` |
| `SMD_DEV_MODE` | Enable SMD development mode | `false` |
| `APEX_HOST` | Apex service host | `apex:3009` |
| `DOCS_HOST` | Documentation service host | `docs:8080` |
| `POSTGREST_HOST` | PostgREST service host | `postgrest:3001` |
| `PROMETHEUS_HOST` | Prometheus service host | `prometheus:9090` |
| `SMD_HOST` | SMD service host | `smd:3002` |
| `STRATO_HOSTNAME` | STRATO service hostname | `strato` |
| `STRATO_PORT_API` | STRATO API port | `3000` |
| `STRATO_PORT_VAULT_PROXY` | Vault proxy port | `8013` |

## Building

```bash
make build
```

## Running

The container is typically run via docker-compose as part of the STRATO platform:

```yaml
nginx:
  image: nginx-packager:latest
  environment:
    OAUTH_CLIENT_ID: "your-client-id"
    OAUTH_CLIENT_SECRET: "your-client-secret"
    ssl: "true"
  volumes:
    - ./ssl:/tmp/ssl
  ports:
    - "443:443"
    - "80:80"
```

## Security

### CSRF Protection

Implemented using the double-submit cookie pattern:
1. Server generates random token on GET requests
2. Token stored in nginx shared memory + sent as cookie
3. Client includes token in `X-CSRF-Token` header for POST/PUT/DELETE/PATCH
4. Server validates header matches both cookie and stored token

See [CSRF-PROTECTION.md](./CSRF-PROTECTION.md) for details.

### Session Management

- Session cookie: `strato_session`
- HttpOnly, Secure, SameSite=Strict
- 3-day lifetime for "remember me" scenarios
- 10-minute idle timeout with auto-renewal

### Security Headers

All responses include:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (varies by route)

### Rate Limiting

- Default: 80 requests/second per IP
- Burst: 100 requests
- Docker network traffic bypassed (for service-to-service calls)

## Monitoring

### Prometheus Metrics

Available at `/metrics`:
- `nginx_http_requests_total` - Request counter by host and status
- `nginx_http_request_duration_seconds` - Request latency histogram
- `nginx_http_connections` - Active connection gauge by state

### Logs

- Access logs: `/usr/local/openresty/nginx/logs/access.log` (JSON format)
- Error logs: `/usr/local/openresty/nginx/logs/error.log`

Check CSRF validation failures:
```bash
grep "CSRF validation failed" /usr/local/openresty/nginx/logs/error.log
```

## Development

### Testing CSRF Protection

See [CSRF-PROTECTION.md](./CSRF-PROTECTION.md) for testing instructions.

### Debugging

Set nginx error log level to `debug` in `nginx.tpl.conf`:
```nginx
error_log  /usr/local/openresty/nginx/logs/error.log debug;
```

## License

See [LICENSE](../LICENSE)

