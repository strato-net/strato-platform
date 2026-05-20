# Mercata Bridge Service

The bridge service is a long-running Node service that moves tokens between Ethereum (and other EVM chains) and STRATO. It handles two directions:

- **Bridge-in** (Ethereum → STRATO): polls `DepositRouter` events via `eth_getLogs`, mirrors them to the `MercataBridge` contract on STRATO, verifies on-chain receipts, confirms deposits (which mints the STRATO-side tokens), and awards Voucher rewards.
- **Bridge-out** (STRATO → Ethereum): picks up withdrawal requests from STRATO, builds and proposes Safe multisig transactions on the destination chain, monitors Safe execution, and finalizes or aborts on-chain.

It also exposes `POST /request-deposit-action` for operators to manually unblock stuck deposits.

- **How it works end-to-end** → [docs/FLOW.md](docs/FLOW.md)
- **Runbooks — add/remove a chain, add/remove an asset** → [docs/OPERATIONS.md](docs/OPERATIONS.md)

---

## Source map

```text
src/
├── index.ts                                   Express bootstrap, /health, /request-deposit-action, polling init
├── polling/
│   ├── alchemyPolling.ts                      Bridge-in: Ethereum event polling → depositBatch
│   └── mercataPolling.ts                      STRATO-side: deposit verification, withdrawal request, withdrawal tx monitoring
├── services/
│   ├── bridgeService.ts                       MercataBridge contract call wrappers (deposit, confirm, review, withdrawal, finalize, abort)
│   ├── verificationService.ts                 Deposit receipt verification (ETH-direct, ETH-via-router, ERC20)
│   ├── depositActionService.ts                HTTP unblock: requestDepositAction wrapper
│   ├── voucherService.ts                      Voucher.mint after deposit confirmation
│   ├── blockTrackingService.ts                Per-chain bridge-in cursor (local + on-chain dual cursor)
│   ├── cirrusService.ts                       Cirrus query helpers (chains, assets, deposits, withdrawals, prices)
│   ├── emailService.ts                        SendGrid notification to withdrawal approvers
│   ├── rpcService.ts                          Ethereum JSON-RPC helpers (eth_getLogs, eth_blockNumber, receipts, traces)
│   └── safeService.ts                         Safe orchestration: create proposals, monitor tx status (executed / rejected / pending)
├── controllers/
│   └── depositAction.controller.ts            Express handler for POST /request-deposit-action
├── auth/
│   ├── index.ts                               OpenID / OAuth init + token helpers
│   ├── oauth.ts                               simple-oauth2 wrapper
│   └── tokenMiddleware.ts                     OIDC bearer-token verification middleware
├── config/
│   └── index.ts                               Single config object, constants, env validation
├── types/
│   └── index.ts                               Shared TypeScript types
└── utils/
    ├── api.ts                                 strato / bloc / cirrus axios clients
    ├── stratoHelper.ts                        buildFunctionTx + execute (same pattern as rewards-poller)
    ├── safeHelper.ts                          Safe low-level: nonce allocation, meta-tx building, signing, API proposal submission, hot-wallet execution
    ├── balanceCheck.ts                        Pre-flight USDST/Voucher balance check
    ├── configValidator.ts                     Startup validation: OIDC, auth probe, address formats, chain RPC URLs
    ├── healthMonitor.ts                       Error flag file for /health
    ├── logger.ts                              Structured console logging with secret redaction
    └── utils.ts                               Address normalization, hex helpers
```

---

## Configuration

### Required environment variables

| Variable | Purpose |
|:--|:--|
| `BA_USERNAME`, `BA_PASSWORD` | BlockApps credentials |
| `CLIENT_ID`, `CLIENT_SECRET` | OAuth client credentials |
| `OPENID_DISCOVERY_URL` | OpenID discovery endpoint |
| `BRIDGE_ADDRESS` | MercataBridge contract on STRATO |
| `PRICE_ORACLE_ADDRESS` | Price Oracle contract (for rebase factors) |
| `SAFE_ADDRESS` | Main Safe multisig address on Ethereum |
| `SAFE_PROPOSER_ADDRESS` | Proposer EOA address |
| `SAFE_PROPOSER_PRIVATE_KEY` | Proposer private key (signs Safe proposals) |
| `CHAIN_<id>_RPC_URL` | Per-chain Ethereum RPC endpoint (one per enabled chain, e.g. `CHAIN_1_RPC_URL`) |

### Optional environment variables

| Variable | Default | Purpose |
|:--|:--|:--|
| `PORT` | `3003` | Express port |
| `NODE_URL` | — | STRATO node URL (not in `requiredEnvVars` but needed by `validateBridgeConfig`) |
| `USDST_ADDRESS` | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` | USDST token |
| `VOUCHER_CONTRACT_ADDRESS` | `000000000000000000000000000000000000100e` | Voucher token |
| `SAFE_HOT_WALLET_ADDRESS` | — | Hot-wallet Safe for auto-executing small withdrawals |
| `SAFE_API_KEY` | — | Safe Transaction Service API key |
| `GAS_FEE_USDST` | `1` (= 0.01 USDST) | Gas estimate per tx, multiplied by 1e16 |
| `GAS_FEE_VOUCHER` | `100` (= 1 Voucher) | Gas estimate per tx, multiplied by 1e16 |
| `MIN_TRANSACTIONS_THRESHOLD` | `200` | Mark unhealthy if remaining txs ≤ this; exit if 0 |
| `SENDGRID_API_KEY` | — | For withdrawal-approver email notifications |
| `TRANSACTION_APPROVER_EMAILS` | — | Comma-separated list of approver emails |

> **Note:** `NODE_URL` is not in the `requiredEnvVars` array, but `validateBridgeConfig()` calls Cirrus at `${NODE_URL}/cirrus/search/...` to fetch enabled chains. If `NODE_URL` is unset, validation fails and the process exits before polling starts.

See [`src/config/index.ts`](src/config/index.ts) for the full config object and defaults.

---

## Running

```bash
cd services/bridge
npm install
cp .env.example .env   # fill in the required variables
npm start              # runs ts-node on src/index.ts
npm run build          # compile to dist/ via tsc
```

> **Note:** `npm run dev` (nodemon) writes state files (`data/lastProcessedBlocks.json`) on every polling cycle, which triggers restart loops. Use `npm start` for local work.

---

## Health, state, and logging

### Health check

```
GET /health
```

Returns `200` when the error flag file is empty or missing; `500` when it has content. The `/health` handler calls `healthMonitor.errorFileExists()` ([`healthMonitor.ts`](src/utils/healthMonitor.ts)).

The flag is append-only: every `logError` call writes to it. Once set, the service stays unhealthy until you delete or truncate `data/bridge-error.flag` after resolving the root cause.

### State files (under `data/`)

| File | Shape | Purpose |
|:--|:--|:--|
| `data/lastProcessedBlocks.json` | `{ [chainId]: blockNumber }` | Per-chain bridge-in cursor. In-memory cache; dual-cursor with on-chain `MercataBridge.chains[chainId].lastProcessedBlock` |
| `data/bridge-error.flag` | Append-only error log | Non-empty means `/health` reports unhealthy |

### Logging

Structured console logs via [`src/utils/logger.ts`](src/utils/logger.ts) (plain `console`, not Winston):

- `logInfo(context, message, data?)` — successful operations.
- `logError(context, error, data?)` — failures; also appends to the error flag file.

Redacted patterns: `api_key=` / `api-key=` / `apikey=`, `Bearer <token>`, `Authorization:` headers.

> **Warning:** Raw credential strings outside those patterns are not auto-redacted. The `SAFE_PROPOSER_PRIVATE_KEY` is particularly sensitive — never log it in context objects.
