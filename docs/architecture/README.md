# Architecture Overview

STRATO Mercata is a blockchain platform built by BlockApps that provides enterprise-grade blockchain services with DeFi capabilities.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                            │
│                    (Web UI, Mobile Apps, External Services)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NGINX Gateway Layer                            │
│           (highway-nginx, vault-nginx, nginx-packager)                      │
│                    - Authentication (OAuth/OpenID)                          │
│                    - CSRF Protection                                        │
│                    - Load Balancing                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐
│    Mercata Backend  │  │     STRATO API      │  │       APEX API          │
│    (TypeScript)     │  │     (Haskell)       │  │     (Node.js)           │
│  - Tokens API       │  │  - Bloc API         │  │  - OAuth Management     │
│  - Lending API      │  │  - Core API         │  │  - User Key Creation    │
│  - Pools API        │  │  - Ethereum JSON-RPC│  │  - Health Checks        │
│  - Bridge API       │  │  - Transaction API  │  └─────────────────────────┘
│  - CDP API          │  │  - Contracts API    │
│  - Rewards API      │  └─────────────────────┘
│  - Oracle API       │              │
└─────────────────────┘              │
          │                          ▼
          │            ┌─────────────────────────────────────────────────────┐
          │            │                  STRATO Core                        │
          │            │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
          │            │  │  Sequencer  │  │  VM Runner  │  │    P2P      │ │
          │            │  │(Blockstanbul)│  │             │  │ (Discovery) │ │
          │            │  └─────────────┘  └─────────────┘  └─────────────┘ │
          │            │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
          │            │  │   SolidVM   │  │     EVM     │  │   Genesis   │ │
          │            │  └─────────────┘  └─────────────┘  └─────────────┘ │
          │            └─────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
┌─────────────────────┐  ┌─────────────────────────────────────────────────────┐
│   Smart Contracts   │  │                Data Layer                          │
│    (SolidVM)        │  │  ┌───────────┐  ┌───────────┐  ┌───────────────┐  │
│  - ERC20 Tokens     │  │  │ PostgreSQL│  │  LevelDB  │  │     Redis     │  │
│  - Lending Pools    │  │  │ (Cirrus)  │  │ (State)   │  │ (BlockDB)     │  │
│  - CDP Engine       │  │  └───────────┘  └───────────┘  └───────────────┘  │
│  - Rewards Chef     │  │  ┌───────────┐  ┌─────────────────────────────┐   │
│  - Bridge           │  │  │  Kafka    │  │     Slipstream (Indexer)    │   │
│  - Token Factory    │  │  └───────────┘  └─────────────────────────────┘   │
└─────────────────────┘  └─────────────────────────────────────────────────────┘
```

## Core Components

### 1. STRATO Node (`strato/`)

The blockchain node implementation written in Haskell:

| Component | Description |
|-----------|-------------|
| **strato-sequencer** | Block production using Blockstanbul consensus |
| **vm-runner** | Transaction execution engine |
| **strato-p2p** | Peer-to-peer networking |
| **ethereum-discovery** | Node discovery protocol |
| **SolidVM** | Smart contract virtual machine (Solidity compatible) |
| **EVM** | Ethereum Virtual Machine compatibility layer |
| **slipstream** | Real-time contract state indexer to PostgreSQL |

### 2. Mercata Platform (`mercata/`)

DeFi and token management layer:

| Component | Description |
|-----------|-------------|
| **backend** | REST API for DeFi operations (TypeScript) |
| **contracts** | Smart contracts (Solidity/SolidVM) |
| **services** | Bridge and Oracle services |
| **ui** | Web application frontend |

### 3. APEX API (`apex/`)

OAuth and user management service (Node.js):

| Component | Description |
|-----------|-------------|
| **api** | User key creation, OAuth integration, health checks |

### 4. Infrastructure (`*-nginx/`, `*-packager/`)

Supporting services:

| Component | Description |
|-----------|-------------|
| **highway-nginx** | Main API gateway with OAuth |
| **vault-nginx** | Key management gateway |
| **nginx-packager** | SMD API gateway with CSRF protection |
| **postgrest-packager** | REST API auto-generation from PostgreSQL |
| **prometheus-packager** | Metrics collection |

## Data Flow

### Transaction Flow

1. Client submits transaction via REST API
2. NGINX gateway authenticates request
3. STRATO API validates and signs transaction
4. Transaction enters mempool via Kafka
5. Sequencer includes transaction in block (Blockstanbul consensus)
6. VM Runner executes transaction in SolidVM/EVM
7. State changes written to LevelDB
8. Slipstream indexes contract state to PostgreSQL (Cirrus)
9. Client queries indexed data via PostgREST

### Smart Contract Deployment

1. Source code submitted to `/compile` endpoint
2. SolidVM compiler generates bytecode and ABI
3. Contract creation transaction submitted
4. Contract address derived (optionally with salt for deterministic addresses)
5. Bytecode stored in code reference table
6. Slipstream creates PostgreSQL tables for contract state

## Networks

| Network | Purpose | Network ID |
|---------|---------|------------|
| **Helium** | Testnet | `helium` |
| **Upquark** | Mainnet | `upquark` |

## Key Technologies

- **Language**: Haskell (core), TypeScript (Mercata), Node.js (APEX)
- **Consensus**: Blockstanbul (PBFT-based)
- **Smart Contracts**: SolidVM (Solidity-compatible)
- **Database**: PostgreSQL (indexed data), LevelDB (state), Redis (caching)
- **Message Queue**: Kafka
- **Runtime**: Docker, Nix

## Related Documentation

- [Getting Started](../getting-started.md) - Build and run instructions
- [STRATO API](strato-api.md) - Blockchain node API reference
- [Mercata Backend API](../mercata/README.md) - DeFi API documentation
- [Smart Contracts](contracts.md) - Contract architecture and deployment
