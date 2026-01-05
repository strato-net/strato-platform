# Interactive API Reference

Explore and test the STRATO API interactively with Swagger UI.

## Access Interactive Documentation

### App API (DeFi Operations)

High-level API for DeFi operations: lending, CDP, swaps, liquidity, bridge, rewards.

!!! example "App API - Mainnet"
    [https://app.strato.nexus/api/docs](https://app.strato.nexus/api/docs)

!!! example "App API - Testnet"
    [https://buildtest.mercata-testnet.blockapps.net/api/docs](https://buildtest.mercata-testnet.blockapps.net/api/docs)

---

### Core Platform API

Low-level blockchain API: users, transactions, contracts, blocks.

!!! info "Core API - Mainnet"
    [https://app.strato.nexus/docs](https://app.strato.nexus/docs)

!!! info "Core API - Testnet"
    [https://buildtest.mercata-testnet.blockapps.net/docs](https://buildtest.mercata-testnet.blockapps.net/docs)

---

## What You Can Do

These interactive docs let you:

- ✅ Browse all API endpoints
- ✅ See request/response schemas
- ✅ Try endpoints with "Try it out" functionality
- ✅ Test with your own authentication tokens
- ✅ Download the OpenAPI spec

---

## About This API

This is the **STRATO Core API** reference. The API provides access to:

- **User Management** - Account creation, address management (`/strato/v2.3/users`, `/strato/v2.3/key`)
- **Transactions** - Submit and track blockchain transactions (`/strato/v2.3/transaction`)
- **Smart Contracts** - Deploy and interact with contracts (`/bloc/v2.2/contracts`)
- **Blockchain Queries** - Account data, metadata (`/strato-api/eth/v1.2/*`)
- **Health Checks** - System status (`/health`, `/apex-api/status`)

!!! note "DeFi Operations"
    For higher-level DeFi operations (lending, CDP, swaps, etc.), see the **[App API Getting Started](api.md)** guide.

!!! tip "Quick Links"
    - **[API Integration Guide](../build-apps/integration.md)** - Complete integration walkthrough
    - **[Quick Reference](../build-apps/quick-reference.md)** - Code snippets for common operations
    - **[E2E Examples](../build-apps/e2e.md)** - Full end-to-end integration examples

---

## Authentication

All API requests require authentication via **OAuth 2.0 Bearer token**.

**Quick setup:**

1. Register at [app.strato.nexus](https://app.strato.nexus)
2. Get OAuth token (see [Developer Quick Start](../build-apps/quickstart.md))
3. Include in requests: `Authorization: Bearer YOUR_TOKEN`

**Base URLs:**

- **Mainnet**: `https://app.strato.nexus`
- **Testnet**: `https://buildtest.mercata-testnet.blockapps.net`

---

## Rate Limits

- **Default**: 100 requests/second per IP
- **Authenticated**: 1000 requests/second per user
- **429 response** if exceeded (includes `Retry-After` header)

---

## Support

- **[API Overview](api.md)** - High-level API documentation
- **[Support Portal](https://support.blockapps.net)**
- **[Telegram Community](https://t.me/strato_net)**

