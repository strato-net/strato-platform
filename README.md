# Mercata

The app consists of 3 parts:
- backend (ExpressJS-based API server)
- frontend (NextJS-based web UI)
- nginx
  - The purpose of the Nginx in the app:
    - Handle OAuth2 authentication and authorization
      - In the future: can be moved to the backend - handle client-credentials, authorization-code flows, keep user sessions to avoid having access token in cookie, etc.
    - Serve backend and frontend on a single domain & port
      - In the future: can be done the other way if we want to simplify the deployment without nginx, or do serverless

---

## DEV MODE

### Prerequisites
- Node.js v22 (with nvm and npm) - see https://nodejs.org/en/download

### Run Backend:
```
cd backend/
npm i
OPENID_TOKEN_ENDPOINT=https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token \
  CLIENT_ID=localhost \
  CLIENT_SECRET=client-secret-here \
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

### Run Nginx:
```
cd ../nginx
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata-testnet2/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=false \
  HOST_IP=host.docker.internal \
  docker compose up -d --build
```
- When running on Linux, use `HOST_IP=172.17.0.1 \` (the default Docker host IP), or use any static local IP of your host machine.
- Nginx also supports the live updates of the NextJS app during development, when it is deployed with `npm run dev`.

---

## PROD MODE

### Prerequisites
- Node.js v22 (with nvm and npm) - see https://nodejs.org/en/download
- Install 'pm2' and 'serve': `npm i -g pm2 serve`

### Run Backend:
```
cd backend
npm i
npm run build
cd dist
OPENID_TOKEN_ENDPOINT=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/protocol/openid-connect/token \
  CLIENT_ID=client-id-here \
  CLIENT_SECRET=client-secret-here \
  NODE_URL=https://marketplace.mercata.blockapps.net \
  BASE_CODE_COLLECTION=skipped_for_now \
  pm2 start app.js --name backend
```

### Run Frontend:
```
cd ../../frontend
npm i
```
- after the 'npm run build' is fixed:
    ```
    npm run build
    cd dist
    # not yet tested:
    pm2 start serve --name frontend -- -s build -l 3000
    ```
- until then, we use the dev mode for frontend:
    ```
    pm2 start npm --name frontend-devmode -- run dev
    ```

#### To stop and delete the frontend service (e.g. for starting a new frontend version):
```
pm2 delete frontend ; pm2 delete frontend-devmode
```

### Run Nginx:
```
cd ../nginx
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=client-id-here \
  OAUTH_CLIENT_SECRET=client-secret-here \
  ssl=true \
  HOST_IP=your-host-ip \
  docker compose up -d --build
```
- When running on Linux, use `HOST_IP=172.17.0.1 \` (the default Docker host IP), or use any static local IP of your host machine.
