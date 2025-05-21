# Mercata

The app consists of multiple parts:
- backend (ExpressJS-based API server)
- ui (Vite/React-based UI) 
  - with legacy next.js-based UI in `frontend/` dir
- nginx
  - The purpose of the Nginx in the app:
    - Handle OAuth2 authentication and authorization
      - In the future: can be moved to the backend - handle client-credentials, authorization-code flows, keep user sessions to avoid having access token in cookie, etc.
    - Serve backend and frontend on a single domain and port
      - In the future: can be done the other way if we want to simplify the deployment without nginx, or do serverless
- services
  - The purpose of the services directory is to store offchain functionalities that are tied to the web application.
  - Currently there is only the Stripe service for token on ramping.
  - Look at the individual services read me for further details.

## Global Project Prerequisites
- Git submodules
  - Fetch the git submodules code:
    ```shell
    git submodule update --init --recursive
    ```
    - `ui/` is a git submodule from https://github.com/blockapps/mercata-ui repo
    - To work with ui/ codebase, please learn how git submodules work.


---

## DEV MODE

### Prerequisites
- Node.js v22 (with nvm and npm) — see https://nodejs.org/en/download

### Run Backend:
```
cd backend/
npm i
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  NODE_URL=https://marketplace.mercata-testnet2.blockapps.net \
  NETWORK=testnet2 \
  BASE_URL=http://localhost \
  npm run dev
```
- `NETWORK` options are: `prod|testnet|testnet2`.

### Run UI:
```
cd ../../ui/
npm i
npm run dev
```

### Run Nginx Standalone:
```
cd ../nginx
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata-testnet2/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=false \
  HOST_IP=host.docker.internal \
  docker compose -f docker-compose.nginx-standalone.yml up -d --build
```
- On Linux, use `HOST_IP=172.17.0.1 \` (the default Docker host IP), or use any static local IP of your host machine.
- Nginx also supports the live updates of the Next.js app during development, when it is deployed with `npm run dev`.

---

## PROD MODE - DOCKERIZED

### Prerequisites
- Docker
  - Linux: Docker (Engine, CLI, Compose v2 plugin)
  - Mac/Windows: Docker Desktop

### Run the Full App

This single command will build and start the full application (backend, frontend, nginx) in the background. With `ssl=true` the app will be served on port 443, and with `ssl=false` on port 80.
```
# in the root directory of the project:
sudo \
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  NODE_URL=https://marketplace.mercata.blockapps.net \
  NETWORK=testnet \
  ssl=true \
  BASE_URL=host-url-here \
  docker compose up -d --build
```
