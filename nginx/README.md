# Mercata Nginx

## Purpose of the Nginx in the App
- Handle OAuth2 authentication and authorization
  - In the future: can be moved to the backend - handle client-credentials, authorization-code flows, keep user sessions to avoid having access token in cookie, etc.
- Serve backend and frontend on a single domain & port 
  - In the future: can be done the other way if we want to simplify the deployment without nginx, or do serverless



## How to Start

### DEV MODE
```shell
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=false \
  docker compose up -d --build
```
Nginx also supports the live updates of the NextJS app during development, when it is deployed with `npm run dev`.

### PROD MODE
```shell
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=true \
  docker compose up -d --build
```
