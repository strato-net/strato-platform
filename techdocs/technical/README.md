# Technical Documentation

Implementation-level documentation for STRATO platform developers and contributors.

## Contents

This section contains in-depth technical specifications, design documents, and implementation details:

### [Design Documents](design/)
Technical design specifications for major platform features:
- **[Rewards System](design/rewards.md)** - Implementation guide with data structures, formulas, and code references
- **[Rewards Chef](design/rewards-chef.md)** - Alternative rewards implementation details

### [Architecture](architecture/)
Detailed architecture documentation for platform internals:
- **[Smart Contracts](architecture/contracts.md)** - Contract structure, SolidVM features, deployment details
- **[Infrastructure](architecture/infrastructure.md)** - NGINX configs, message queues, data stores, service architecture
- **[STRATO Node API](architecture/strato-api.md)** - Core blockchain API reference (JSON-RPC, transactions, blocks)

### [API Specifications](api-specs/)
Implementation-level API specifications with formulas and technical details:
- **[Lending Specification](api-specs/lending-spec.md)** - Lending protocol formulas, contract methods, math
- **[Lending Pool Overview](api-specs/lending_pool_overview.md)** - Detailed lending mechanics
- **[Lending API Test Plan](api-specs/lending_api_test_plan.md)** - QA and testing documentation

---

## Who Should Use This Section?

**This is for you if you're:**
- Contributing to the STRATO platform codebase
- Implementing smart contracts
- Understanding system internals
- Debugging protocol mechanics
- Writing tests for core functionality

**Not what you need?**
- **Building apps on STRATO?** → See [Building Apps](../build-apps/overview.md)
- **Using the platform?** → See [User Guides](../guides/borrow.md)
- **General architecture overview?** → See [Architecture Reference](../reference/architecture.md)

---

## Documentation Levels

STRATO documentation is organized by depth:

| Level | Location | Audience | Example |
|-------|----------|----------|---------|
| **User** | `/guides`, `/scenarios` | End users | "Click Supply to deposit collateral" |
| **Developer** | `/build-apps`, `/reference` | App developers | "POST /lending/deposit with amount param" |
| **Technical** | `/technical` (this section) | Core contributors | "Exchange rate = (cash + totalDebt + badDebt − reserves) × 1e18 / mTokenSupply" |

---

## Related Documentation

- [Contributing Guide](../contribute/contributing.md) - How to contribute to the platform
- [Setup Guide](../contribute/setup.md) - Development environment setup
- [Architecture Overview](../contribute/architecture.md) - High-level system overview
