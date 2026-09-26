# Interactive API Reference

OpenAPI specs and Swagger UI for the STRATO HTTP APIs.

## App API

The App API is the backend for lending, CDP, swaps, pools, bridge, rewards and vaults. See [App API](api.md).

| | Mainnet | Testnet |
|---|---------|---------|
| Swagger UI | [app.strato.nexus/api/docs](https://app.strato.nexus/api/docs) | [app.testnet.strato.nexus/api/docs](https://app.testnet.strato.nexus/api/docs) |
| OpenAPI JSON | [app.strato.nexus/api/public/api-docs.json](https://app.strato.nexus/api/public/api-docs.json) | [app.testnet.strato.nexus/api/public/api-docs.json](https://app.testnet.strato.nexus/api/public/api-docs.json) |

- **Swagger UI requires sign-in.** Opening it redirects you to the STRATO login first.
- **The OpenAPI JSON is public.** Import it into Postman, Insomnia or a client generator. Its server base path is `/api`.

## Core and Bloc API

The node's Core API (`/eth/v1.2`) and Bloc API (`/bloc/v2.2`) share one OpenAPI 3.0 spec, served by `strato-api`. See [Core Platform API](strato-node-api.md).

| | Mainnet | Testnet |
|---|---------|---------|
| Swagger UI | [app.strato.nexus/strato-api/openapi-ui/](https://app.strato.nexus/strato-api/openapi-ui/) | [app.testnet.strato.nexus/strato-api/openapi-ui/](https://app.testnet.strato.nexus/strato-api/openapi-ui/) |
| OpenAPI JSON | [app.strato.nexus/strato-api/openapi.json](https://app.strato.nexus/strato-api/openapi.json) | [app.testnet.strato.nexus/strato-api/openapi.json](https://app.testnet.strato.nexus/strato-api/openapi.json) |

Neither needs a login.

!!! note "Base path"
    The spec's paths start at `/eth/v1.2/...` and `/bloc/v2.2/...`, and the spec doesn't declare a server. To call them through a node, prefix the paths with `https://<host>/strato-api`, or use the public `/bloc/v2.2` path for Bloc. "Try it out" requests sent without that prefix won't reach the API.

## Other Interfaces

These have no Swagger page:

- **[Cirrus](cirrus.md)** (`/cirrus/search`): PostgREST queries over indexed contract data
- **[JSON-RPC](json-rpc.md)** (`/rpc`): Ethereum-compatible JSON-RPC

## Authentication

Reads don't need a token. Endpoints that act as a user, such as App API writes and Bloc server-side signing, need an OAuth 2.0 bearer token from Keycloak:

```http
Authorization: Bearer <access_token>
```

See [App API authentication](api.md#authentication) and [Core Platform API authentication](strato-node-api.md#authentication).

## Support

- [Support Portal](https://support.blockapps.net)
- [Telegram Community](https://t.me/strato_net)
