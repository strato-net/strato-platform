# STRATO Management Dashboard (SMD)

Modern rewrite of the SMD on the same stack as the STRATO App: **Vite + React 18 +
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
- `WAGMI_PROJECT_ID` must be exported where `docker compose` runs (strato-init passes it
  to the `smd` service and `docker-run.sh` writes it into `/smd/config.js`); otherwise
  WalletConnect's relay rejects the placeholder project ID with close code 3000
  "Project not found" and no QR code is shown.

## Dedicated multisig deployment

Dedicated multisigs are disabled until the canonical network deployment is pinned:

- `defaultMultisigFactoryFor` — the canonical factory address by network ID.

The map lives in `app/backend/src/config/config.ts` and is returned by `/api/config`.
`MULTISIG_FACTORY_ADDRESS` overrides it for local and temporary deployments. SMD keeps
wallet actions read-only when the factory or wallet provenance checks fail.

This uses the same trust model as existing platform proxies: the backend pins the
factory proxy address, AdminRegistry owns its implementation pointer (or the proxy is
permanently frozen), and the separately stored registry governance remains
AdminRegistry. The factory registry identifies wallets and approved wallet logic
versions.

The contracts use the regular proxy and upgrade tooling with
`BaseCodeCollection.sol` as the source bundle.

Deploy the canonical factory proxy once:

```bash
cd app/contracts
npm run deployProxy -- \
  --empty \
  --owner 000000000000000000000000000000000000100c \
  --contract-file BaseCodeCollection.sol
```

Install or upgrade the factory implementation:

```bash
npm run upgrade -- \
  --proxy-address <factory-proxy> \
  --contract-name MultisigFactory \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{"_governance":"00000000000000000000000000000000deadbeef"}' \
  +OVERRIDE-CHECKS
```

Then, through AdminRegistry governance, initialize the independent version-registry
authority once:

```text
initializeRegistryGovernance(000000000000000000000000000000000000100c)
```

Deploy the concrete wallet logic without another proxy:

```bash
npm run upgrade -- \
  --deploy-only \
  --contract-name MultisigLogic \
  --contract-file BaseCodeCollection.sol \
  --constructor-args '{}'
```

Then:

1. Review both implementation ABIs, including the wallet shell's reserved function
   names, and require every state-changing setup function to use the `migrate` prefix.
2. Confirm `registryGovernance` is AdminRegistry, then through AdminRegistry governance call
   `publishLogicVersion("1", logic)` on the factory.
3. Configure the factory proxy address in the backend.
4. Create a test wallet and confirm the setup from every initial signer.
5. Verify Bloc resolves `MultisigLogic` methods at the permanent wallet address and SMD
   reports the wallet as `Factory-created and active` before enabling production deposits.

Future factory implementations use the same proxy upgrade command without deploying a
new proxy. Future wallet logic versions use `--deploy-only`, are published in the factory
registry, and are adopted independently by each wallet quorum. Renouncing ownership of
the factory proxy permanently freezes factory implementation upgrades without disabling
version publication or revocation through `registryGovernance`.

## Layout

- `src/lib/` — `env`, `api` (axios), `auth`, `csrf`, `wagmi`, `stratoChain`, `stratoWallet`.
- `src/context/UserContext.tsx` — auth/session + connected-wallet state (`useUser`).
- `src/services/` — TanStack Query hooks and STRATO/CIRRUS calls.
- `src/components/` — `ui/` (shadcn), `layout/`, feature components.
- `src/pages/` — `AccountsPage`, `ContractsPage`.
