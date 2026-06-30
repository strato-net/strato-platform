# STRATO Management Dashboard (SMD)

Modern rewrite of the SMD on the same stack as the Mercata app: **Vite + React 18 +
TypeScript + Tailwind + shadcn/ui**, with **wagmi / viem / RainbowKit** wallet
connectivity and **TanStack Query** for data.

Served under `/smd/` on port `3002` behind the platform `nginx-packager`.

> The previous React 15 / Redux-saga / Blueprint app is parked in `legacy/` as a
> reference during the port and will be removed once feature parity is reached.

## Develop

```bash
npm install
# Proxy API calls to a running STRATO node (defaults to http://localhost:8080):
STRATO_NODE_URL=https://your-node npm run dev
```

Vite serves the app at `http://localhost:3002/smd/`. The dev proxy forwards
`/bloc`, `/strato-api`, `/strato`, `/cirrus`, `/apex-api`, `/rpc`, `/vault`,
`/api`, `/auth`, and `/login` to `STRATO_NODE_URL`.

## Build

```bash
npm run build      # outputs dist/ (base = /smd/)
```

## Wallet connectivity

The **Connect Wallet** button lets users connect with:

- **STRATO Wallet** — OIDC/Keycloak login (handled by `nginx-packager` which already
  protects `/smd/`); identity comes from `POST /apex-api/user` and transactions are
  signed server-side by the vault via `POST /strato/v2.3/signature`.
- **External wallets** — MetaMask / Coinbase / WalletConnect via RainbowKit.

Both submit transactions over the STRATO chain JSON-RPC at `/rpc`.

### Backend requirements (nginx-packager)

- `JSONRPC_ENABLED=true` — exposes `/rpc` (required by the STRATO wallet connector).
- `/strato/v2.3/signature` location — added to proxy vault signing for the STRATO wallet.
- `window.ENV.CHAIN_ID` must be set (via `/smd/config.js`, generated at container
  startup from `ethconf.yaml`) for the STRATO wallet to appear; otherwise only
  external wallets are offered.

## Layout

- `src/lib/` — `env`, `api` (axios), `auth`, `csrf`, `wagmi`, `stratoChain`, `stratoWallet`.
- `src/context/UserContext.tsx` — auth/session + connected-wallet state (`useUser`).
- `src/services/` — TanStack Query hooks and STRATO/CIRRUS calls.
- `src/components/` — `ui/` (shadcn), `layout/`, feature components.
- `src/pages/` — `AccountsPage`, `ContractsPage`.
