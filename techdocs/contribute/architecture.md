# Architecture - STRATO Platform

Understanding the STRATO platform monorepo structure and how components work together.

---

## Monorepo Overview

The STRATO platform is a **monorepo** containing:

1. **Layer 1: Blockchain** (`strato/`) - Core blockchain (Haskell)
2. **Layer 2: DeFi Application** (`mercata/`) - Application layer (Solidity, TypeScript, React)
3. **Supporting Infrastructure** - Deployment, proxies, documentation

```
strato-platform/
├── strato/              # Blockchain core (Haskell)
├── mercata/             # DeFi application (TypeScript, Solidity, React)
├── bootstrap-docker/    # Production deployment scripts
├── nginx-packager/      # Reverse proxy & Swagger docs
├── docs/                # Additional documentation
└── techdocs/            # User & developer documentation (this site!)
```

---

## Layer 1: Blockchain Core (`strato/`)

### Purpose

Custom EVM-compatible blockchain built on Haskell for security and performance.

### Key Components

#### strato-core

**What:** Main blockchain node (consensus, state, networking)

**Language:** Haskell

**Location:** `strato/core/`

**Responsibilities:**

- Block production and validation
- Consensus mechanism
- P2P networking
- State management
- Transaction pool

**Key modules:**

- `BlockApps.Blockchain` - Block processing
- `BlockApps.Network` - P2P networking
- `BlockApps.VM` - VM interface
- `BlockApps.State` - World state management

#### vm-runner

**What:** EVM (Ethereum Virtual Machine) executor

**Language:** Haskell

**Location:** `strato/vm-runner/`

**Responsibilities:**

- Execute smart contract bytecode
- Gas metering
- State transitions
- Opcode implementations

#### strato-api

**What:** JSON-RPC API server (Ethereum-compatible)

**Language:** Haskell

**Location:** `strato/api/`

**Responsibilities:**

- HTTP/WebSocket API endpoints
- Ethereum JSON-RPC compatibility
- Transaction submission
- Query interface

**API endpoints:**

- `/strato-api/eth/v1.2/account` - Account management
- `/strato-api/eth/v1.2/transaction` - Transaction submission
- `/strato-api/eth/v1.2/block` - Block queries
- `/strato-api/eth/v1.2/contract` - Contract interactions

#### cirrus

**What:** Blockchain indexer (PostgreSQL-based)

**Language:** Haskell

**Location:** `strato/cirrus/`

**Responsibilities:**

- Index blockchain data into PostgreSQL
- Fast queries for transactions, events, balances
- Block explorer data
- Historical data access

**Database schema:**

- `blocks` - Block data
- `transactions` - Transaction data
- `events` - Smart contract events
- `accounts` - Account balances

### Data Flow (Layer 1)

```
User → JSON-RPC API → strato-core → vm-runner → State
                           ↓
                        cirrus → PostgreSQL
```

1. User submits transaction via JSON-RPC
2. `strato-core` validates and adds to mempool
3. Block produced, transactions executed in `vm-runner`
4. State updated
5. `cirrus` indexes results to PostgreSQL

---

## Layer 2: DeFi Application (`mercata/`)

### Purpose

Full-stack DeFi application built on top of STRATO blockchain.

### Key Components

#### Smart Contracts (`mercata/contracts/`)

**What:** Solidity smart contracts for DeFi protocols

**Language:** Solidity 0.8.22

**Location:** `mercata/contracts/concrete/`

**Core Protocols:**

1. **Lending** (`Lending/`)
   - `LendingPool.sol` - Main lending logic
   - `CollateralVault.sol` - Collateral storage
   - Health factor calculations, liquidations

2. **CDP (Collateralized Debt Position)** (`CDP/`)
   - `CDPEngine.sol` - Mint USDST stablecoin
   - `CDPVault.sol` - Collateral storage
   - Stability fees, liquidation ratios

3. **AMM Pools** (`Pools/`)
   - `Pool.sol` - Automated market maker
   - `PoolFactory.sol` - Pool creation
   - Swap, add/remove liquidity

4. **Bridge** (`Bridge/`)
   - `MercataBridge.sol` - Cross-chain transfers
   - Deposit/withdrawal workflows

5. **Rewards** (`Rewards/`)
   - `Rewards.sol` - Incentives controller for distributing Reward Points
   - Tracks user activities (borrowing, liquidity, swaps, etc.)
   - Calculates and distributes rewards based on emission rates
   - Activity-based incentive system

6. **Tokens** (`Tokens/`)
   - `Token.sol` - Base token implementation
   - `TokenFactory.sol` - Token creation (USDST, Reward Points, wrapped assets)
   - `TokenMetadata.sol` - Token metadata management

**Build:**

```bash
cd mercata/contracts
npm install
npm run compile
npm test
```

**Test:**

```bash
npm test                    # All tests
npm run test:coverage       # With coverage
```

#### Backend API (`mercata/backend/`)

**What:** Node.js REST API for DeFi operations

**Language:** TypeScript (Node.js + Express)

**Location:** `mercata/backend/src/`

**Responsibilities:**

- High-level DeFi API endpoints
- User authentication (OAuth 2.0)
- Transaction bundling (e.g., approve + supply)
- Event monitoring
- Database queries (Cirrus)

**Key modules:**

- `api/routes/` - Express routes
- `api/services/` - Business logic
  - `lending.service.ts` - Lending operations
  - `cdp.service.ts` - CDP operations
  - `swapping.service.ts` - Swap/liquidity
  - `bridge.service.ts` - Bridge operations
- `api/middleware/` - Auth, validation
- `db/` - Database client (PostgreSQL via Cirrus)

**API endpoints:** (Available at `/api/docs`)

- `POST /api/lending/supply` - Supply collateral
- `POST /api/lending/borrow` - Borrow USDST
- `POST /api/cdp/deposit` - Deposit for CDP
- `POST /api/cdp/mint` - Mint USDST
- `POST /api/swap/execute` - Swap tokens
- `POST /api/pool/add-liquidity` - Add liquidity

**Run:**

```bash
cd mercata/backend
npm install
npm run dev              # Development mode
npm run build            # Production build
npm start                # Start production server
```

**Test:**

```bash
npm test                 # Unit tests
npm run test:integration # Integration tests
npm run test:e2e         # E2E tests
```

#### Frontend UI (`mercata/ui/`)

**What:** React web application for DeFi interactions

**Language:** TypeScript (React + Vite)

**Location:** `mercata/ui/src/`

**Responsibilities:**

- User interface for DeFi operations
- Wallet connection (MetaMask, WalletConnect)
- Transaction submission
- Real-time updates
- Data visualization

**Key modules:**

- `pages/` - Main pages
  - `Borrow.tsx` - Lending interface
  - `Advanced.tsx` - CDP minting, pools
  - `SwapAsset.tsx` - Token swaps
  - `DepositsPage.tsx` - Bridge in
  - `WithdrawalsPage.tsx` - Bridge out
  - `Rewards.tsx` - Rewards management
- `components/` - Reusable components
- `hooks/` - React hooks (API calls, wallet)
- `contexts/` - State management
- `utils/` - Helpers, formatters

**Tech stack:**

- React 18
- TypeScript
- Vite (build tool)
- ethers.js (Web3 library)
- Material-UI (components)

**Run:**

```bash
cd mercata/ui
npm install
npm run dev              # Development server (port 3001)
npm run build            # Production build
npm run preview          # Preview production build
```

**Test:**

```bash
npm test                 # Component tests
npm run test:e2e         # E2E tests (Playwright)
```

#### Background Services (`mercata/services/`)

**What:** Long-running services for async operations

**Language:** TypeScript (Node.js)

**Key services:**

1. **Bridge Service** (`bridge/`)
   - Monitors Ethereum for deposits
   - Processes withdrawals
   - Mints wrapped assets
   - Issues transaction vouchers (10 per bridge-in)

2. **Oracle Service** (`oracle/`)
   - Fetches external price feeds
   - Updates on-chain prices
   - Data sources (Chainlink, CoinGecko, etc.)

3. **Voucher Service** (`voucher/`)
   - Manages transaction vouchers
   - Mints vouchers on bridge-in
   - Tracks voucher usage

**Run:**

```bash
cd mercata/services/bridge
npm install
npm run dev
```

### Data Flow (Layer 2)

```
User (Browser)
    ↓
Frontend UI (React) → Wallet (MetaMask)
    ↓                       ↓
Backend API (Node.js) ← Blockchain (via ethers.js)
    ↓
Smart Contracts (Solidity)
    ↓
STRATO Blockchain (Layer 1)
```

**Example: Borrow USDST**

1. User clicks "Borrow" in UI
2. Frontend calls `POST /api/lending/borrow`
3. Backend bundles transactions:
   - Approve token spending
   - Call `LendingPool.borrow()`
4. Backend submits to STRATO blockchain
5. `vm-runner` executes contract
6. State updated, event emitted
7. `cirrus` indexes transaction
8. Backend returns result to frontend
9. UI updates with new balance

---

## Supporting Infrastructure

### bootstrap-docker

**What:** Production deployment scripts

**Location:** `bootstrap-docker/`

**Contains:**

- `strato-run.sh` - Main deployment script
- `docker-compose.yml` - Service definitions
- `strato` - CLI wrapper

**Usage:**

```bash
cd bootstrap-docker
sudo ./strato-run.sh
```

### nginx-packager

**What:** Reverse proxy and API gateway

**Location:** `nginx-packager/`

**Responsibilities:**

- Route `/strato-api/*` → strato-api (Layer 1)
- Route `/api/*` → mercata-backend (Layer 2)
- Route `/` → mercata-ui (frontend)
- Serve Swagger UI at `/docs` and `/api/docs`

**Configuration:**

- `nginx.conf` - Main config
- `swagger/swagger.yaml` - API specification

---

## Build System

### Makefiles

**Root Makefile:** `Makefile`

**Targets:**

```bash
make                     # Build everything
make strato-core         # Build blockchain core
make mercata-contracts   # Build smart contracts
make mercata-backend     # Build backend API
make mercata-ui          # Build frontend UI
make docker-compose      # Generate docker-compose files
make test                # Run all tests
```

### Stack (Haskell)

**What:** Build tool for Haskell components

**Configuration:** `stack.yaml`

**Usage:**

```bash
stack build              # Build Haskell code
stack test               # Run Haskell tests
stack exec strato-core   # Run compiled binary
```

### npm (Node.js)

**What:** Package manager for JavaScript/TypeScript

**Usage:**

```bash
cd mercata/backend
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm test                 # Run tests

cd mercata/ui
npm install
npm run dev              # Start dev server
```

---

## Technology Stack Summary

| Component | Language | Framework | Purpose |
|-----------|----------|-----------|---------|
| strato-core | Haskell | Stack | Blockchain core |
| vm-runner | Haskell | Stack | EVM executor |
| cirrus | Haskell | Stack + PostgreSQL | Indexer |
| Smart Contracts | Solidity 0.8.22 | Hardhat | DeFi protocols |
| Backend API | TypeScript | Node.js + Express | REST API |
| Frontend UI | TypeScript | React + Vite | Web app |
| Services | TypeScript | Node.js | Background tasks |
| Deployment | Bash + Docker | Docker Compose | Infrastructure |

---

## Component Communication

### Internal Communication

**Blockchain → API:**

- Direct function calls (Haskell)

**Blockchain → Cirrus:**

- Database writes (PostgreSQL)

**Backend → Blockchain:**

- HTTP (JSON-RPC API)
- Port: 8080

**Frontend → Backend:**

- HTTP (REST API)
- Port: 3000

**Frontend → Blockchain:**

- Direct via ethers.js (JSON-RPC)
- For read operations, gas estimation

### External Communication

**User → Frontend:**

- HTTPS (web browser)
- Port: 443 (production) or 3001 (dev)

**Bridge Service → Ethereum L1:**

- JSON-RPC (Infura, Alchemy)
- Monitors events, submits transactions

**Oracle Service → Price Feeds:**

- HTTPS (Chainlink, CoinGecko APIs)

---

## Development Workflow

### Choose Your Focus Area

Detailed component-specific guides are coming soon. For now, see:

1. **Blockchain Core** - Haskell codebase (`strato/core/`, `strato/api/`)
2. **Smart Contracts** - Solidity contracts (`mercata/contracts/`)
3. **Backend API** - Node.js/TypeScript (`mercata/backend/`)
4. **Frontend UI** - React/TypeScript (`mercata/ui/`)
5. **Services** - Background services (`mercata/services/`)

### General Workflow

1. **Make changes** in your area
2. **Build** your component
3. **Run tests** (unit, integration)
4. **Test locally** (full stack)
5. **Submit PR** (see [Contributing](contributing.md))

---

## Next Steps

Now that you understand the architecture:

1. **Choose your area of interest** (blockchain, contracts, backend, frontend, services)
2. **Read the component-specific guide**
3. **Set up your development environment** (see [Setup](setup.md))
4. **Make your first contribution** (see [Contributing](contributing.md))

---

## Need Help?

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)

