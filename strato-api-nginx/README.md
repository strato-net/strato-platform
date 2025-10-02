# Strato API OAuth Integration

This directory contains the OAuth2/OpenID Connect authentication setup for the Strato API Swagger UI. This provides a user-friendly login experience similar to the docs-website, replacing the simple token input with a full OAuth flow.

## Architecture

```
User Browser → Nginx Proxy (OAuth) → Strato API
                ↓
           Keycloak (OAuth Provider)
```

The nginx proxy handles OAuth authentication and automatically adds the `X-USER-ACCESS-TOKEN` header to requests sent to the Strato API backend.

## Features

- ✅ OAuth2/OpenID Connect authentication via Keycloak
- ✅ Automatic token management and refresh
- ✅ Session-based authentication (no manual token input needed)
- ✅ Backward compatible with existing `X-USER-ACCESS-TOKEN` header
- ✅ PKCE support for enhanced security
- ✅ Automatic token renewal before expiration
- ✅ Swagger UI "Authorize" button integration

## Prerequisites

- Docker and Docker Compose
- OAuth client credentials from Keycloak
- Network access to Keycloak server

## Quick Start

### Prerequisites
Make sure strato-api is already running on your local machine on port 3000. You can check this with:
```bash
curl http://localhost:3000/health
```

### 1. Copy Environment Variables (Optional)

The docker-compose.yml has sensible defaults, but you can customize:
```bash
cd strato-api-nginx
cp .env.example .env
# Edit .env if you need to change OAuth credentials
```

### 2. Start the Nginx Proxy

```bash
cd strato-api-nginx
docker-compose up -d
```

This will:
- Build the nginx proxy with OAuth support
- Connect to your local strato-api running on port 3000
- Expose the authenticated API on port 80

### 3. Access Swagger UI

Open your browser and navigate to:
```
http://localhost/swagger-ui/
```

You'll be automatically redirected to Keycloak for authentication.

### Alternative: Run strato-api in Docker

If you want to run strato-api in Docker as well:

1. Edit `docker-compose.yml` and uncomment the alternative configuration section
2. Comment out the simple nginx-proxy service
3. Run `docker-compose up -d`

This will build both strato-api and nginx-proxy from source.

## How It Works

### Authentication Flow

1. **User accesses Swagger UI** at `http://localhost/swagger-ui/`
2. **Nginx intercepts the request** and checks for valid OAuth session
3. **If no session exists**, user is redirected to Keycloak login page
4. **User logs in** with Keycloak credentials
5. **Keycloak redirects back** to `/oauth2/callback` with authorization code
6. **Nginx exchanges code for tokens** and creates a session
7. **User is redirected** back to Swagger UI
8. **All subsequent requests** automatically include the access token

### Token Management

- Access tokens are automatically refreshed before expiration
- Sessions last for 15 minutes of inactivity (configurable)
- Tokens are securely stored in nginx-managed sessions
- No tokens are stored in browser localStorage

### Swagger UI Integration

The Swagger UI now shows:
- **"Authorize" button** at the top
- **OAuth2 authentication option** in the security definitions
- **Automatic token injection** for all API calls

## Configuration

### Nginx Configuration (`nginx.conf`)

Key settings:
- **Upstream**: Points to `strato-api:3000`
- **Protected paths**: `/swagger-ui/`, `/swagger.json`, `/strato-api/`, `/bloc/`, `/strato/`
- **Public paths**: `/health` (no authentication)
- **OAuth callback**: `/oauth2/callback`

### OpenID Connect Configuration (`openid.lua`)

Key settings:
- **Discovery URL**: Keycloak OpenID Connect discovery endpoint
- **Client credentials**: OAuth client ID and secret
- **Session interval**: 900 seconds (15 minutes)
- **Token renewal**: Automatic before expiration
- **PKCE**: Enabled for additional security

## Customization

### Change Session Duration

Edit `openid.lua`:
```lua
refresh_session_interval = 1800,  -- 30 minutes
```

### Add Domain Restrictions

Edit `openid.lua` to restrict to specific email domains:
```lua
-- Add after authentication
if res.id_token.email then
  local email = res.id_token.email
  if not string.match(email, "@blockapps%.net$") then
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end
end
```

### Change OAuth Scopes

Edit `openid.lua`:
```lua
scope = "openid email profile custom_scope",
```

## Troubleshooting

### "Authentication error" message

**Problem**: OAuth authentication fails

**Solutions**:
1. Check that Keycloak is accessible from the nginx container
2. Verify OAuth client credentials are correct
3. Check nginx logs: `docker logs strato-api-nginx`
4. Ensure the callback URL is registered in Keycloak: `http://localhost/oauth2/callback`

### Redirect loop

**Problem**: Browser keeps redirecting between nginx and Keycloak

**Solutions**:
1. Clear browser cookies for localhost
2. Check that `redirect_uri_path` matches the registered callback URL
3. Verify SSL/TLS settings if using HTTPS

### Token not being passed to API

**Problem**: API returns authentication errors

**Solutions**:
1. Check nginx logs to see if token is being set
2. Verify the `X-USER-ACCESS-TOKEN` header is being added in `openid.lua`
3. Check strato-api logs to see what it's receiving

### Session expires too quickly

**Problem**: Users get logged out frequently

**Solutions**:
1. Increase `refresh_session_interval` in `openid.lua`
2. Increase `access_token_expires_in` value
3. Enable `renew_access_token_on_expiry`

## Development

### Building the nginx image

```bash
docker build -t strato-api-nginx .
```

### Testing locally

```bash
# Start just the nginx proxy
docker-compose up nginx-proxy

# Access logs
docker logs -f strato-api-nginx

# Access nginx container
docker exec -it strato-api-nginx sh
```

### Debugging OAuth flow

Enable debug logging in `openid.lua`:
```lua
local opts = {
  -- ... other options ...
  
  -- Add this for debugging
  debug = true,
}
```

## Production Deployment

### Using HTTPS

For production, you'll want to use HTTPS. Update `nginx.conf`:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /etc/ssl/certs/your-cert.crt;
    ssl_certificate_key /etc/ssl/private/your-key.key;
    
    # ... rest of configuration
}
```

### Security Considerations

1. **Never commit `.env` file** - Add to `.gitignore`
2. **Use strong client secrets** - Generate using secure random
3. **Enable SSL verification** in production:
   ```lua
   ssl_verify = "yes",
   ```
4. **Restrict OAuth scopes** to minimum required
5. **Set appropriate session timeouts**
6. **Use HTTPS** for all production deployments
7. **Rotate OAuth client secrets** periodically

### Kubernetes Deployment

For Kubernetes, use Secrets for OAuth credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oauth-credentials
type: Opaque
stringData:
  client-id: "your-client-id"
  client-secret: "your-client-secret"
```

## File Structure

```
strato-api-nginx/
├── Dockerfile              # Nginx with OpenResty/Lua
├── nginx.conf             # Nginx configuration
├── openid.lua             # OAuth authentication logic
├── docker-compose.yml     # Docker Compose setup
├── .env.example           # Environment variables template
└── README.md              # This file
```

## Integration with Main Strato API

The main Strato API code has been updated:
- `strato/api/strato-api/exec_src/Main.hs` now includes OAuth2 in the Swagger spec
- Swagger UI shows both OAuth2 and API key authentication options
- Backward compatible with existing token-based authentication

## Support

For issues or questions:
1. Check nginx logs: `docker logs strato-api-nginx`
2. Check strato-api logs: `docker logs strato-api`
3. Review Keycloak admin console for client configuration
4. Consult lua-resty-openidc documentation: https://github.com/zmartzone/lua-resty-openidc

## License

Same as the main strato-platform repository.
