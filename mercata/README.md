# Mercata

The app consists of multiple parts:
- backend (ExpressJS-based API server)
- ui (Vite/React-based UI)
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

---

## DEV MODE

### Prerequisites
- Node.js v22 (with nvm and npm) — see https://nodejs.org/en/download

### Run Backend:
```
cd backend/
npm i
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=client-secret-here \
  NODE_URL=https://node5.mercata-testnet.blockapps.net \
  BASE_URL=http://localhost \
  POOL_FACTORY=0x100a \
  LENDING_POOL=0x1005 \
  ONRAMP=0x1009 \
  TOKEN_FACTORY=0x100b \
  ADMIN_REGISTRY=0x100c \
  POOL_CONFIGURATOR=0x1006 \
  npm run dev
```
- `NETWORK` options are: `testnet|prod`.

### Run UI:
```
cd ../../ui/
npm i
npm run dev
```

### Run Nginx Standalone:
```
cd ../nginx
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=client-secret-here \
  docker compose -f docker-compose.nginx-standalone.yml up -d --build
```

- BEWARE! Disable any VPN on your host machine.  It can interfere with Docker networking and cause a hang on http://localhost.
- In most Linux scenarios 'host.docker.internal' will work just fine and there is no need to pass an explicit `HOST_IP` parameter into Docker Compose.  If there are network issues then you can drop back to a hardcoded IP address - usually `HOST_IP=172.17.0.1 \` (the gateway IP of the default Docker bridge interface), or any static local IP of your host machine.  More details here: https://github.com/blockapps/strato-platform/issues/3959#issuecomment-3051025844
- You may also need to explicitly open ports in your Linux host's firewall configuration to allow Docker to communicate with the node processes running on your host.  See iptables example below.
- Nginx also supports the live updates of the Next.js app during development, when it is deployed with `npm run dev`.

iptables example for Docker network bridge port setup:

    0     0 ACCEPT     6    --  *      *       172.17.0.0/16        0.0.0.0/0            tcp dpt:8080
    0     0 ACCEPT     17   --  *      *       172.17.0.0/16        0.0.0.0/0            udp dpt:8080
    0     0 ACCEPT     6    --  *      *       172.17.0.0/16        0.0.0.0/0            tcp dpt:3001
    0     0 ACCEPT     17   --  *      *       172.17.0.0/16        0.0.0.0/0            udp dpt:3001
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
  NODE_URL=https://node5.mercata.blockapps.net \
  ssl=true \
  BASE_URL=host-url-here \
  POOL_FACTORY=0x100a \
  LENDING_POOL=0x1005 \
  ONRAMP=0x1009 \
  TOKEN_FACTORY=0x100b \
  ADMIN_REGISTRY=0x100c \
  POOL_CONFIGURATOR=0x1006 \
  docker compose up -d --build
```