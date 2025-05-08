# Mercata

The app consists of 3 parts:
- backend (Express.js-based API server)
- frontend (NextJS-based web UI)
- nginx
  - The purpose of the Nginx in the app:
    - Handle OAuth2 authentication and authorization
      - In the future: can be moved to the backend - handle client-credentials, authorization-code flows, keep user sessions to avoid having access token in cookie, etc.
    - Serve backend and frontend on a single domain and port
      - In the future: can be done the other way if we want to simplify the deployment without nginx, or do serverless

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
  BASE_CODE_COLLECTION=skipped_for_now \
  npm run dev
```

### Run Frontend:
```
cd ../frontend/
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
  NODE_URL=https://marketplace.mercata-testnet2.blockapps.net \
  ssl=true \
  docker compose up -d --build
```

---

## (LEGACY) PROD MODE - NON-DOCKERIZED

### Prerequisites
- Node.js v22 (with nvm and npm) — see https://nodejs.org/en/download
- Install 'pm2' and 'serve': `npm i -g pm2 serve`

### Run Backend:
```
cd backend
npm i
npm run build
cd dist
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  NODE_URL=https://marketplace.mercata.blockapps.net \
  BASE_CODE_COLLECTION=skipped_for_now \
  pm2 start app.js --name backend
```

#### To stop and delete the backend service (e.g., for starting a new backend version):
```
pm2 delete backend
```

### Run Frontend:
```
cd ../../frontend
npm i
```
- To run the compiled/optimized version (prod mode):
    ```
    npm run build
    cd dist
    pm2 start serve --name frontend -- -s build -l 3000
    ```
- To run the uncompiled version (dev mode):
    ```
    pm2 start npm --name frontend-devmode -- run dev
    ```

#### To stop and delete the frontend service (e.g., for starting a new frontend version):
```
pm2 delete frontend ; pm2 delete frontend-devmode
```

### Run Nginx Standalone:
```
cd ../nginx
sudo \ 
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=true \
  HOST_IP=your-host-ip \
  docker compose -f docker-compose.nginx-standalone.yml up -d --build
```
- On Linux, use `HOST_IP=172.17.0.1 \` (the default Docker host IP), or use any static local IP of your host machine.
