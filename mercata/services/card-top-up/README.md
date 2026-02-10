# Card Top-Up Service

Standalone service that watches crypto credit card wallet balances and calls `topUpCard` on STRATO when a card’s balance falls below its configured threshold.

## Behavior

1. **Config source**: On each poll, the service calls the Mercata backend `GET /api/credit-card/watcher-config` (operator auth) to get all enabled card configs. The backend returns configs from its persisted store (threshold, top-up amount, cooldown, destination chain, token, card wallet address).
2. **Balance check**: For each config, the service calls the destination chain RPC (from `EXTERNAL_CHAIN_RPC_URLS`) to get the ERC20 balance of the card wallet for the configured token.
3. **Top-up**: If the balance is below the config’s `thresholdAmount` and the cooldown since `lastTopUpAt` has elapsed, the service calls `POST /api/credit-card/execute-top-up` (operator auth). The backend submits `CreditCardTopUp.topUpCard` to STRATO and updates the config’s `lastTopUpAt`.

## Requirements

- Backend must have `OPERATOR_ACCESS_TOKEN` set and credit-card config store persisted (backend loads/saves `data/credit-card-config-store.json` by default).
- Users add/update cards and config (including threshold, top-up amount, cooldown, enabled) via the app; the backend persists these so the watcher can read them.

## Environment

See `.env.example`. Required:

- `MERCATA_API_URL` – backend base URL
- `OPERATOR_ACCESS_TOKEN` – must match backend’s `OPERATOR_ACCESS_TOKEN`
- `EXTERNAL_CHAIN_RPC_URLS` – JSON map of `destinationChainId` → RPC URL (e.g. `{"84532":"https://sepolia.base.org"}`)

Optional: `POLL_INTERVAL_MS` (default 300000), `PORT` (default 3004).

## Run

```bash
npm install
npm run build
npm start
```

Health: `GET /health` returns 200 when no error flag file is present.
