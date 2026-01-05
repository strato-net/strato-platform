# System Architecture

High-level overview of the STRATO platform architecture.

## System Components

```
┌─────────────┐
│   Browser   │ (User Interface)
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────┐
│   Backend API           │ (Node.js + TypeScript)
└───────┬─────────────────┘
        │
        ├─► Cirrus (Indexer)     [PostgreSQL]
        ├─► STRATO Node (Blockchain)
        └─► External Services (RPC Proxy, File Server)
```

### 1. Frontend (UI)

**Technology:** React + TypeScript + Vite

**Key Features:**

- Single-page application (SPA)
- Real-time balance updates
- Multi-step transaction flows
- Responsive design (mobile + desktop)

**State Management:**

- React Context API for global state
- Local storage for pending transactions
- WebSocket for real-time updates

**Components:**

- Dashboard (portfolio overview)
- Bridge (deposit/withdraw)
- Swap (AMM trading)
- Liquidity (pool management)
- Lending (supply/borrow)
- CDP (mint USDST)
- Rewards (CATA accrual/claiming)

### 2. Backend

**Technology:** Node.js + Express + TypeScript

**Responsibilities:**

- API gateway for frontend
- Authentication (OAuth)
- Business logic orchestration
- External RPC proxy
- Transaction preparation & submission

**Key Services:**

- **Auth Service**: User authentication and session management
- **Token Service**: Token metadata and balance queries
- **Swap Service**: Pool discovery and swap routing
- **Lending Service**: Collateral and borrowing logic
- **CDP Service**: Vault management and mint planning
- **Rewards Service**: Reward accrual calculations
- **Bridge Service**: Cross-chain deposit/withdraw tracking

**Database:**

- None (stateless, queries Cirrus directly)

### 3. STRATO Node

**Technology:** Custom blockchain node (EVM-compatible)

**Responsibilities:**

- Transaction execution
- Smart contract deployment
- State management
- Block production
- P2P networking (if multi-node)

**Key Features:**

- Solidity smart contract support
- EVM compatibility (with STRATO extensions)
- Fast finality (~1-2 second block times)
- Deterministic execution

**APIs:**

- ETH JSON-RPC (standard Ethereum endpoints)
- STRATO-specific extensions
- WebSocket for event subscriptions

### 4. Cirrus (Indexer)

**Technology:** PostgreSQL + Custom indexing service

**Responsibilities:**

- Index blockchain state into relational database
- Provide fast queries for UI/backend
- Store contract metadata and attributes
- Track balances, transfers, events

**Indexed Data:**

- Token contracts (balances, metadata, attributes)
- Swap pools (reserves, ratios, LP tokens)
- Lending positions (supplied, borrowed)
- CDP vaults (collateral, minted)
- Rewards activities (accrual, claims)

**Query API:**

- PostgREST interface (RESTful queries on PostgreSQL)
- Filter, sort, paginate indexed data
- Complex joins and aggregations

### 5. External Services

**RPC Proxy:**

- Routes external blockchain calls (e.g., Ethereum mainnet)
- Automatic failover between providers
- Rate limiting and caching

**File Server:**

- Stores token images, logos, banners
- Static asset hosting

## Data Flow

### User Action: Borrow USDST

```
1. User enters borrow amount in UI
   ▼
2. UI calls GET /lending/positions (check current collateral)
   ▼
3. Backend queries Cirrus for collateral balances
   ▼
4. UI calculates required collateral (auto-planner)
   ▼
5. User approves multi-step flow (deposit + borrow)
   ▼
6. UI calls POST /lending/supply (deposit collateral)
   ▼
7. Backend prepares transaction, sends to STRATO Node
   ▼
8. STRATO Node executes smart contract (supply)
   ▼
9. Cirrus indexes new state (updated collateral balance)
   ▼
10. UI calls POST /lending/borrow (borrow USDST)
   ▼
11. Backend prepares borrow transaction
   ▼
12. STRATO Node executes smart contract (borrow)
   ▼
13. Cirrus indexes borrowed amount
   ▼
14. UI shows updated positions (health factor, debt)
```

### Indexing Pipeline

```
STRATO Node (produces blocks)
   │
   ▼ Event logs
Cirrus Indexer (listens to events)
   │
   ├─► Parse Transfer events → Update balances
   ├─► Parse Mint/Burn events → Update supplies
   ├─► Parse Swap events → Update pool reserves
   └─► Parse Borrow/Repay events → Update lending positions
   │
   ▼ Write to PostgreSQL
Cirrus Database (indexed state)
   │
   ▼ Backend queries
App API (serves UI)
```

## Smart Contract Architecture

### Core Contracts

**Token.sol:**

- ERC20 implementation
- Mintable/burnable (with access control)
- Pausable for emergencies

**Pool.sol:**

- AMM swap pool (constant product formula)
- Add/remove liquidity
- LP token minting/burning

**LendingPool.sol:**

- Supply/withdraw collateral
- Borrow/repay USDST
- Health factor calculations
- Liquidations

**CDP.sol:**

- Vault management
- Mint/burn USDST
- Collateralization ratio enforcement
- Liquidations

**AdminRegistry.sol:**

- Governance and admin actions
- Whitelist management
- Multi-sig voting for critical operations

### Contract Ownership

Most contracts are owned by **AdminRegistry**:

- Allows governance control
- Enables whitelist-based permissions
- Prevents single-point-of-failure

**Example: LP Token**
```
LP Token (owner: AdminRegistry)
   ▲
   │ mint() calls
Pool Contract (whitelisted to mint LP tokens)
```

### Access Control

**Modifiers:**

- `onlyOwner`: Owner or AdminRegistry
- `onlyWhitelisted`: Specific whitelist entries
- `whenNotPaused`: Emergency pause mechanism

**Whitelist Pattern:**
```solidity
whitelist[LP_TOKEN_ADDRESS]["mint"][POOL_ADDRESS] = true
```

Allows Pool to call `mint()` on LP Token.

## Security Model

### Authentication

**Frontend → Backend:**

- OAuth 2.0 access tokens
- Refresh tokens for session extension
- Token expiry and automatic refresh

**Backend → STRATO Node:**

- User's private key held in backend (encrypted)
- Or user signs transactions client-side (MetaMask-style)

### Transaction Security

**Multi-sig for Admin:**

- Critical operations require multiple admin approvals
- Implemented via AdminRegistry voting

**Approval Pattern:**

- Users approve token spending before transactions
- Prevents unauthorized fund movements

**Reentrancy Guards:**

- Smart contracts use reentrancy protection
- Prevents common exploit patterns

## Scalability

### Current State

- Single STRATO node (sufficient for testnet/small scale)
- Cirrus indexes single node
- Backend scales horizontally (stateless)

### Future Scaling

**Multi-node Blockchain:**

- Add validator nodes for decentralization
- Consensus mechanism for block production

**Sharding/Rollups:**

- Layer 2 solutions for higher throughput
- Offload computation to rollups

**Caching:**

- Redis for frequently accessed data
- CDN for static assets

## Monitoring & Observability

### Logging

- Backend: Structured JSON logs
- STRATO Node: Block production logs
- Cirrus: Indexing progress logs

### Metrics

- Transaction throughput (TPS)
- API response times
- Indexing lag (blocks behind)
- Error rates

### Alerting

- Node downtime
- Indexing failures
- High error rates
- Unusual transaction patterns

## Deployment

### Environments

**Development:**

- Local STRATO node
- Local Cirrus instance
- Frontend dev server (Vite)

**Testnet (buildtest):**

- Hosted STRATO node
- Hosted Cirrus + PostgreSQL
- Backend API on cloud (e.g., AWS)
- Frontend static hosting (S3 + CloudFront)

**Mainnet:**

- Production-grade infrastructure
- Multi-node blockchain (validators)
- Database replication
- Load balancers for backend

### CI/CD

**Pipeline:**

1. Code commit → GitHub
2. Automated tests (unit + integration)
3. Build artifacts (Docker images)
4. Deploy to testnet (auto)
5. Manual approval for mainnet
6. Deploy to mainnet

## Network Topology

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Frontend │────▶│ Backend  │────▶│  STRATO  │
│  (SPA)   │     │   API    │     │   Node   │
└──────────┘     └────┬─────┘     └────┬─────┘
                      │                 │
                      ▼                 ▼
                 ┌─────────┐       ┌────────┐
                 │ Cirrus  │◀──────│ Events │
                 │  (PG)   │       └────────┘
                 └─────────┘
```

**Request Flow:**

- User action → Frontend → Backend API → STRATO Node
- Node emits events → Cirrus indexes
- Cirrus provides fast queries → Backend → Frontend

## API Design

**RESTful Principles:**

- Resource-based URLs (`/tokens`, `/pools`, `/lending`)
- Standard HTTP methods (GET, POST, PUT, DELETE)
- JSON request/response bodies
- HTTP status codes for errors

**Pagination:**

- `limit` and `offset` query parameters
- `totalCount` in response

**Filtering:**

- PostgREST-style operators (`eq`, `neq`, `gt`, etc.)
- Applied via query parameters

**Versioning:**

- `/v2` in URL path
- Allows breaking changes without disrupting existing clients

## Related Docs

- [App API](api.md) - DeFi operations API
- [Core Platform API](strato-node-api.md) - Direct blockchain interaction
- [E2E Examples](../build-apps/e2e.md) - Complete application examples


