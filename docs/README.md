# STRATO Platform Documentation

[![STRATO Mercata logo](https://strato.nexus/images/strato.nexus/2025.10.11/strato-logo.png)](https://strato.nexus)

Welcome to the STRATO Platform documentation. STRATO is an enterprise-grade blockchain platform with DeFi capabilities built by BlockApps.

## Quick Start

- **[Getting Started](getting-started.md)** - Prerequisites, build, and run instructions

## Architecture

Understanding the platform components and how they work together:

- **[Architecture Overview](architecture/README.md)** - High-level system architecture
- **[STRATO Node API](architecture/strato-api.md)** - Blockchain node API reference
- **[Smart Contracts](architecture/contracts.md)** - Contract architecture and SolidVM features
- **[Infrastructure](architecture/infrastructure.md)** - NGINX, databases, and services

## API Documentation

### Mercata Backend

The DeFi and token management REST API:

- **[API Overview](mercata/README.md)** - Complete endpoint reference
- **[Tokens](mercata/Tokens.md)** - Token management
- **[Lending](mercata/Lending.md)** - Lending protocol
- **[Pools](mercata/Pools.md)** - Liquidity pools and AMM
- **[Bridge](mercata/Bridge.md)** - Cross-chain transfers
- **[CDP](mercata/CDP.md)** - Collateralized Debt Positions
- **[Rewards](mercata/Rewards.md)** - Rewards distribution
- **[Admin](mercata/Admin.md)** - Platform administration
- **[Voucher](mercata/Voucher.md)** - Fee voucher system

### Supplementary

- **[Lending Pool Overview](mercata/lending_pool_overview.md)** - Detailed lending mechanics
- **[Lending API Test Plan](mercata/lending_api_test_plan.md)** - Testing documentation

## Design Documents

Technical specifications and architecture decisions:

- **[Rewards System](design/rewards.md)** - Core rewards design

## Features

### Blockchain

- **SolidVM** - Solidity-compatible smart contract execution
- **Blockstanbul** - PBFT-based consensus mechanism
- **Slipstream** - Real-time contract state indexing to PostgreSQL
- **Ethereum Compatibility** - JSON-RPC interface

### DeFi

- **Token Factory** - ERC20 token creation and management
- **Lending Pools** - Collateralized borrowing and lending
- **AMM Pools** - Automated market making and swaps
- **CDP Engine** - Collateralized debt positions
- **Rewards** - Multi-pool incentive distribution
- **Bridge** - Cross-chain asset transfers

### Enterprise

- **OAuth 2.0** - OpenID Connect authentication
- **X.509 Certificates** - PKI-based identity
- **Permissioned Networks** - Validator-controlled consensus
- **HSM Support** - Hardware security module integration

## Networks

| Network | Purpose | Use Case |
|---------|---------|----------|
| **Helium** | Testnet | Development and testing |
| **Upquark** | Mainnet | Production deployment |

## Support

- Website: [strato.nexus](https://strato.nexus)
- GitHub: [blockapps/strato-platform](https://github.com/blockapps/strato-platform)

## LLMs / AI Agents
- **[Instructions for LLMs](llm-instructions.md)**
