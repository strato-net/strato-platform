# STRATO Local Auth

A bundled OAuth2/OIDC identity provider for local STRATO deployments. Contains:

- **Ory Kratos** - Identity management (users, passwords, 2FA)
- **Ory Hydra** - OAuth2/OIDC token server
- **Login UI** - Simple web interface for login/consent

## Quick Start

```bash
cd local-auth
docker compose up --build
```

## Endpoints

| Service | Port | Description |
|---------|------|-------------|
| Kratos Public | 4433 | Self-service flows |
| Kratos Admin | 4434 | User management API |
| Hydra Public | 4444 | OAuth2/OIDC endpoints |
| Hydra Admin | 4445 | Client management API |
| Login UI | 3000 | Web interface |

## Users

Local auth creates the first admin/operator user during the first `strato-up` run. This address is also used as the node identity.

Additional users can be created after the node is running:

```bash
strato-user-add /path/to/mynode alice
```

The login UI accepts a username and password. The default first admin username is `admin`; override it with `LOCAL_AUTH_ADMIN_USERNAME` if needed.

## OAuth Configuration

### Discovery URL
```
http://localhost:4444/.well-known/openid-configuration
```

### Default Client
- **Client ID:** `strato-local`
- **Client Secret:** `strato-local-secret`
- **Grant Types:** authorization_code, refresh_token, client_credentials

## Testing OAuth Flow

1. Start the container:
   ```bash
   docker compose up --build
   ```

2. Get an access token (client credentials):
   ```bash
   curl -X POST http://localhost:4444/oauth2/token \
     -d grant_type=client_credentials \
     -d client_id=strato-local \
     -d client_secret=strato-local-secret \
     -d scope=openid
   ```

3. Or use the authorization code flow:
   - Create the first admin user with `strato-up`
   - Open: http://localhost:3000/login
   - Sign in with the local username and password
   - You'll be redirected back with an authorization code

## Integration with STRATO

When integrated with STRATO:

1. nginx routes `/oauth/*` to this container's Hydra (4444)
2. nginx routes `/auth/*` to this container's Login UI (3000)
3. STRATO services use OAuth discovery URL pointing to local Hydra
4. Each localAuth username maps to its matching key in STRATO vault

## Configuration Files

- `kratos.yml` - Kratos configuration (identity schemas, self-service flows)
- `hydra.yml` - Hydra configuration (OAuth settings, token TTLs)
- `identity.schema.json` - User identity schema

## Production Notes

Before production use:

1. Change secrets in `kratos.yml` and `hydra.yml`
2. Configure proper database DSN (not in-memory)
3. Enable HTTPS
4. Review password policies in `kratos.yml`
