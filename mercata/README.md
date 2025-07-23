# Mercata

The app consists of multiple parts:
- **backend** - ExpressJS-based API server (port 3001)
- **ui** - Vite/React-based UI (port 8080)
- **nginx** - Reverse proxy handling OAuth2 authentication and serving the app (port 80/443)
- **services** - Additional offchain services:
  - **bridge** - Ethereum bridge service for cross-chain operations (port 3003)
  - **oracle** - Price oracle service
  - **payment/stripe** - Token on-ramping service

---

## DEV MODE - Local Development Setup

### Prerequisites
- Node.js v22 (with nvm and npm) — see https://nodejs.org/en/download
- Docker Desktop (for running Nginx)
  - **Windows users**: Ensure Docker Desktop is configured for WSL2 if using WSL
- Git
  - **Windows/WSL users**: Configure Git to use Unix line endings:
    ```bash
    git config --global core.autocrlf input
    ```

### Quick Start

First, navigate to the mercata project directory:
```bash
# Windows (PowerShell/CMD)
cd C:\Users\[your-username]\[path-to]\strato-platform\mercata

# Linux/Mac or WSL
cd /path/to/strato-platform/mercata
# In WSL: cd /mnt/c/Users/[your-username]/[path-to]/strato-platform/mercata
```

For local development, you need to run three components:
1. **Backend API** (Node.js - port 3001)
2. **Frontend UI** (Vite - port 8080)  
3. **Nginx Proxy** (Docker - port 80)

## Option 1: Using Helper Scripts (Recommended)

### First Time Setup
```bash
# Copy the example environment file
cp backend/.env.example backend/.env

# Edit backend/.env and add your OAUTH_CLIENT_SECRET
```

### Start All Services

**Windows (PowerShell/CMD):**
```cmd
start-dev.bat
```

**Windows with WSL:**
```bash
# Run from WSL terminal
./start-dev.sh
```

**Linux/Mac:**
```bash
./start-dev.sh
```

This will automatically:
- Check that Docker is running
- Install all npm dependencies
- Start all three services with proper environment variables
- Show you the URLs to access everything

### Stop All Services

**Windows (PowerShell/CMD):**
```cmd
stop-dev.bat
```

**Windows with WSL:**
```bash
# Run from WSL terminal
./stop-dev.sh
```

**Linux/Mac:**
```bash
./stop-dev.sh
```

## Option 2: Manual Setup

If you prefer to run each component manually:

### Step 1: Run the Backend API

First, navigate to the backend directory and install dependencies:
```bash
cd backend/
npm install
```

Then run the backend with all required environment variables:
```bash
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=[your-client-secret] \
  NODE_URL=https://node5.mercata-testnet.blockapps.net \
  NETWORK=testnet \
  BASE_URL=http://localhost \
  BASE_CODE_COLLECTION=0000000000000000000000000000000000001000 \
  POOL_FACTORY=000000000000000000000000000000000000100a \
  LENDING_POOL=0000000000000000000000000000000000001005 \
  LENDING_REGISTRY=0000000000000000000000000000000000001007 \
  ONRAMP=0000000000000000000000000000000000001009 \
  TOKEN_FACTORY=000000000000000000000000000000000000100b \
  POOL_CONFIGURATOR=0000000000000000000000000000000000001006 \
  ADMIN_REGISTRY=000000000000000000000000000000000000100c \
  BRIDGE_API_BASE_URL=http://localhost:3003 \
  npm run dev
```

The backend will start on `http://localhost:3001`

### Step 2: Run the Frontend UI

In a new terminal, navigate to the UI directory:
```bash
cd ui/
npm install
npm run dev
```

The UI will start on `http://localhost:8080`

### Step 3: Run Nginx with Docker

In a new terminal, navigate to the nginx directory and run:
```bash
cd nginx/
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=localhost \
  OAUTH_CLIENT_SECRET=[your-client-secret] \
  docker compose -f docker-compose.nginx-standalone.yml up -d --build
```

Nginx will proxy the application on `http://localhost`

### Step 4: Access the Application

Open your browser and navigate to `http://localhost`

The application should now be running with:
- Nginx handling authentication and proxying requests
- Backend API serving data
- Frontend UI providing the interface

### Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `OAUTH_DISCOVERY_URL` | Keycloak OpenID configuration URL | `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration` |
| `OAUTH_CLIENT_ID` | OAuth client ID | `localhost` |
| `OAUTH_CLIENT_SECRET` | OAuth client secret (keep secure!) | `[your-secret]` |
| `NODE_URL` | BlockApps STRATO node URL | `https://node5.mercata-testnet.blockapps.net` |
| `NETWORK` | Network environment | `testnet` or `prod` |
| `BASE_URL` | Base URL for the application | `http://localhost` |
| `BASE_CODE_COLLECTION` | Base code collection contract address | `0000000000000000000000000000000000001000` |
| `POOL_FACTORY` | Pool factory contract address | `000000000000000000000000000000000000100a` |
| `LENDING_POOL` | Lending pool contract address | `0000000000000000000000000000000000001005` |
| `LENDING_REGISTRY` | Lending registry contract address | `0000000000000000000000000000000000001007` |
| `ONRAMP` | Onramp contract address | `0000000000000000000000000000000000001009` |
| `TOKEN_FACTORY` | Token factory contract address | `000000000000000000000000000000000000100b` |
| `POOL_CONFIGURATOR` | Pool configurator contract address | `0000000000000000000000000000000000001006` |
| `ADMIN_REGISTRY` | Admin registry contract address | `000000000000000000000000000000000000100c` |
| `BRIDGE_API_BASE_URL` | Bridge service URL | `http://localhost:3003` |

### Optional: Run Bridge Service

If you need the bridge functionality, run the bridge service in another terminal:
```bash
cd services/bridge/
npm install
# Create .env file with required variables (see services/bridge/.env.example)
npm run dev
```

### Troubleshooting

1. **VPN Issues**: Disable any VPN on your host machine as it can interfere with Docker networking.

2. **Port Conflicts**: Ensure the following ports are available:
   - 80 (Nginx)
   - 3001 (Backend API)
   - 8080 (Frontend UI)
   - 3003 (Bridge Service - if running)

3. **Docker Network Issues**: 
   - On Linux, you might need to use `HOST_IP=172.17.0.1` instead of `host.docker.internal`
   - You may need to configure firewall rules for Docker to communicate with host services

4. **WSL-Specific Issues**:
   - **Nginx can't connect to backend/frontend**: The start-dev.sh script automatically detects WSL and configures the correct IP
   - **Manual fix**: If automatic detection fails, find your WSL IP with `hostname -I` and run:
     ```bash
     HOST_IP=[your-wsl-ip] docker compose -f docker-compose.nginx-standalone.yml up -d --build
     ```
   - **Docker "no such file or directory" errors**: This is caused by Windows line endings. The start-dev.sh script now automatically fixes this, but if you still have issues:
     ```bash
     cd nginx && sed -i 's/\r$//' *.sh
     ```
   - **Ensure Docker Desktop WSL2 integration is enabled** in Docker Desktop settings

5. **Authentication Issues**: 
   - Ensure your `OAUTH_CLIENT_SECRET` is correct
   - Check that the Keycloak realm is accessible

6. **Backend API Errors (500 errors)**:
   - **"Error fetching LendingRegistry data"**: Ensure `LENDING_REGISTRY` is set in your .env file
   - Check all contract addresses are correct and 40 characters long (without 0x prefix)
   - Verify the NODE_URL is accessible

7. **Missing Environment Variables**: 
   - The start-dev.sh script will warn about missing critical variables
   - Check backend/.env has all variables from backend/.env.example
   - Contact your team for the correct contract addresses if needed

### Development Tips

- The UI hot-reloads on changes
- Backend uses ts-node-dev for auto-restart on changes
- Nginx configuration changes require container restart
- Check browser console and network tab for debugging
- Backend logs are visible in the terminal running `npm run dev`
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