# Architecture - Technical Documentation

In-depth technical architecture documentation for STRATO platform internals.

## Available Documents

### [Smart Contracts](contracts.md)
**Contract Structure and SolidVM Implementation**

Deep dive into the smart contract architecture, including:
- Contract directory structure
- SolidVM features and capabilities
- Token system implementation
- DeFi protocol contracts (Lending, CDP, Pools, Bridge, Rewards)
- Deployment and upgrade patterns
- Access control and security

**Audience:** Smart contract developers, security auditors

---

### [Infrastructure](infrastructure.md)
**Service Architecture and Infrastructure Components**

Detailed infrastructure documentation covering:
- NGINX gateways (highway-nginx, vault-nginx, nginx-packager)
- OAuth 2.0 / OpenID Connect authentication flows
- Message queues (Kafka, Zookeeper)
- Data stores (PostgreSQL, LevelDB, Redis)
- Service communication patterns
- Deployment architecture

**Audience:** DevOps, infrastructure engineers, backend developers

---

### [STRATO Node API](strato-api.md)
**Core Blockchain API Reference**

Low-level blockchain node API documentation:
- JSON-RPC interface
- Transaction submission and querying
- Block and chain queries
- Contract deployment and interaction
- Event subscriptions
- Node management

**Audience:** Blockchain developers, node operators

---

## Architecture Documentation Levels

The platform has multiple levels of architecture documentation:

| Document | Level | Audience |
|----------|-------|----------|
| [Reference: Architecture](../../reference/architecture.md) | High-level | App developers |
| [Contribute: Architecture](../../contribute/architecture.md) | Mid-level | Contributors |
| **This section** | Low-level | Core developers |

**When to use this section:**
- You need implementation details (config files, exact ports, data structures)
- You're debugging system internals
- You're modifying core platform components
- You need to understand exact service communication patterns

## Related Documentation

- [Design Documents](../design/) - Technical design specifications
- [API Specifications](../api-specs/) - Detailed API specs with formulas
- [Contributing Guide](../../contribute/contributing.md) - How to contribute
