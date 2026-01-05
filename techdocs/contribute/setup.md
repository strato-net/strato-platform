# Setup - Contributing to STRATO

This guide covers everything you need to start contributing to the STRATO platform codebase.

---

## Who is This For?

**You're in the right place if you want to:**

- Contribute to the STRATO blockchain core (Haskell)
- Develop smart contracts for the DeFi layer (Solidity)
- Work on the backend API (Node.js/TypeScript)
- Build the frontend UI (React/TypeScript)
- Improve infrastructure and services

**Not what you're looking for?**

- Building apps that use STRATO? → See [Building Apps on STRATO](../build-apps/overview.md)
- Running your own node? → See Node Operators (coming soon)

---

## Prerequisites

### Required Tools

#### 1. Stack (Haskell Build Tool)

**What:** Build tool for Haskell code (blockchain core)

**Install:** https://docs.haskellstack.org/en/stable/install_and_upgrade/

```bash
curl -sSL https://get.haskellstack.org/ | sh
```

**Verify:**

```bash
stack --version
```

#### 2. Docker with Compose Plugin

**What:** Runtime environment for running STRATO components

**Install:** https://docs.docker.com/engine/install/

**Verify:**

```bash
docker --version
docker compose version
```

#### 3. Node.js 18+ and npm

**What:** For building frontend and backend components

**Install:** https://nodejs.org/ or use nvm

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

**Verify:**

```bash
node --version  # Should be v18.x or higher
npm --version
```

#### 4. System Libraries

You have two options:

**Option A: Install System-wide**

**Ubuntu 24.04:**

```bash
sudo apt install -y \
  libleveldb-dev \
  liblzma-dev \
  libpq-dev \
  libsecp256k1-dev \
  libsodium-dev \
  postgresql-client
```

**macOS (requires Homebrew):**

```bash
brew install --quiet \
  leveldb \
  postgresql \
  libsodium \
  pkg-config \
  secp256k1 \
  xz
```

**Option B: Use Nix (Recommended for consistency)**

```bash
# Install Nix
curl -L https://nixos.org/nix/install | sh

# Nix packages are predefined in the project
# No manual library installation needed
```

**Verify:**

```bash
# Check if libraries are available
pkg-config --modversion leveldb
pkg-config --modversion libsodium
```

#### 5. OAuth Client Credentials

**What:** Required to connect to STRATO network

**How to get:**

1. Go to [support.blockapps.net](https://support.blockapps.net/)
2. Sign in
3. Click "Request Client Credentials"
4. You'll receive:
   - `OAUTH_DISCOVERY_URL`
   - `OAUTH_CLIENT_ID`
   - `OAUTH_CLIENT_SECRET`

**Keep these safe!** You'll need them to run STRATO locally.

---

## Clone the Repository

### 1. Clone the STRATO Platform Monorepo

```bash
git clone git@github.com:blockapps/strato-platform.git
cd strato-platform
```

**What's included:**

```
strato-platform/
├── strato/              # Blockchain core (Haskell)
├── mercata/             # DeFi application layer
│   ├── contracts/       # Smart contracts (Solidity)
│   ├── backend/         # REST API (Node.js/TypeScript)
│   ├── ui/              # Web UI (React/TypeScript)
│   └── services/        # Background services
├── bootstrap-docker/    # Production deployment
├── nginx-packager/      # Reverse proxy
└── docs/                # Documentation
```

### 2. Install Git Hooks (Optional but Recommended)

**Pre-commit hook:** Automatically removes trailing whitespace

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

## Build

### Option 1: Build Everything

!!! tip "First Time Building?"
    The first build will take **15-30 minutes** as Stack downloads dependencies and compiles the Haskell codebase. Subsequent builds are much faster (2-5 minutes for incremental changes).

**With system-wide libraries:**

```bash
make
```

**With Nix:**

```bash
NIX=true make
```

**What this does:**

- Compiles the Haskell blockchain core (`strato`, `vm-runner`, `cirrus`)
- Builds the Solidity smart contracts (`mercata/contracts`)
- Builds the Node.js backend API (`mercata/backend`)
- Builds the React frontend UI (`mercata/ui`)
- Generates Docker Compose files

**Build output:**

```
✓ strato-core
✓ vm-runner
✓ cirrus
✓ mercata-contracts
✓ mercata-backend
✓ mercata-ui
✓ docker-compose files generated
```

### Option 2: Build Individual Components

If you're only working on a specific part:

**Backend only:**

```bash
make mercata-backend
```

**Frontend only:**

```bash
make mercata-ui
```

**Contracts only:**

```bash
cd mercata/contracts
npm install
npm run compile
```

**Blockchain core only:**

```bash
make strato-core
```

### Option 3: Generate Docker Compose Files Only

```bash
make docker-compose
```

This overwrites existing `docker-compose.yml` files with the latest configuration.

---

## Run Locally

### 1. Start STRATO

```bash
./start my_node_name
```

**What this does:**

- Starts all STRATO components (blockchain, API, UI, services)
- Creates a local node directory (`my_node_name/`)
- Blockchain data stored in `my_node_name/strato-data/`
- Logs in `my_node_name/logs/`

**First-time setup:**

The first run will:

1. Initialize the blockchain database
2. Deploy core contracts
3. Start API servers
4. Launch the UI

**This takes 2-5 minutes.**

### 2. Verify It's Running

**Check the blockchain API:**

```bash
curl http://localhost:8080/strato-api/eth/v1.2/account
```

**Expected response:**

```json
{
  "accounts": []
}
```

**Check the REST API:**

```bash
curl http://localhost:3000/api/health
```

**Expected response:**

```json
{
  "status": "healthy"
}
```

**Check the UI:**

Open your browser: http://localhost:3001

You should see the STRATO DeFi interface.

### 3. Access Logs

**All logs:**

```bash
tail -f my_node_name/logs/*.log
```

**Blockchain core:**

```bash
tail -f my_node_name/logs/strato-core.log
```

**Backend API:**

```bash
tail -f my_node_name/logs/mercata-backend.log
```

**UI:**

```bash
tail -f my_node_name/logs/mercata-ui.log
```

### 4. Stop STRATO

```bash
# Graceful shutdown
./stop

# Force stop
pkill -f strato
```

### 5. Wipe and Start Fresh

```bash
./forceWipe
rm -rf my_node_name/
./start my_node_name
```

!!! warning "Wipe Deletes All Data"
    This removes all blockchain data, contracts, and transactions. Use only for testing/development.

---

## Run in Docker (Production-like)

For a fully Dockerized setup (similar to production):

### 1. Prepare Docker Compose

```bash
cp docker-compose.allDocker.yml bootstrap-docker/docker-compose.yml
cd bootstrap-docker
```

### 2. Configure Environment

Edit `strato-run.sh` with your credentials:

```bash
NODE_HOST='localhost' \
network='helium' \
OAUTH_CLIENT_ID='your-client-id-here' \
OAUTH_CLIENT_SECRET='your-client-secret-here' \
./strato
```

**Network options:**

- `network='helium'` - Testnet
- `network='upquark'` - Mainnet

### 3. Start

```bash
sudo ./strato-run.sh
```

**This will:**

- Pull Docker images
- Start all services in containers
- Expose ports (8080, 3000, 3001)

### 4. Wipe Docker Deployment

```bash
cd bootstrap-docker
sudo ./strato --wipe
```

---

## Common Issues

### Build Failures

**Problem:** `stack: command not found`

**Solution:** Install Stack:

```bash
curl -sSL https://get.haskellstack.org/ | sh
```

**Problem:** `Could not find module 'Crypto.Secp256k1'`

**Solution:** Install system libraries:

```bash
# Ubuntu
sudo apt install libsecp256k1-dev

# macOS
brew install secp256k1
```

**Problem:** `cabal: Missing dependency on a foreign library: * Missing (or bad) C library: leveldb`

**Solution:** Install leveldb:

```bash
# Ubuntu
sudo apt install libleveldb-dev

# macOS
brew install leveldb
```

### Runtime Errors

**Problem:** Port already in use (8080, 3000, 3001)

**Solution:**

```bash
# Find and kill processes
lsof -ti:8080 | xargs kill -9
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
```

**Problem:** Database connection failed

**Solution:** Ensure PostgreSQL is running:

```bash
# Check status
docker ps | grep postgres

# Restart
docker-compose restart postgres
```

**Problem:** OAuth authentication failed

**Solution:** Verify your credentials in `strato-run.sh` or request new ones at [support.blockapps.net](https://support.blockapps.net/).

---

## Next Steps

Now that you have STRATO running locally:

1. **Understand the architecture** → Read [Architecture](architecture.md)
2. **Choose your focus area:**
   - [Blockchain Core](blockchain/overview.md) (Haskell)
   - [Smart Contracts](contracts/overview.md) (Solidity)
   - [Backend API](backend/overview.md) (Node.js/TypeScript)
   - [Frontend UI](frontend/overview.md) (React/TypeScript)
   - [Services](services/bridge.md) (Background services)
3. **Make your first contribution** → Read [Contributing Guidelines](contributing.md)

---

## Need Help?

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)

