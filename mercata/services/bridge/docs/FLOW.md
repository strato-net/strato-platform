# Bridge Service — End-to-End Flow

How the service works, from start to finish.

- For **how to change things** → [OPERATIONS.md](OPERATIONS.md)
- For **module map, config, health** → [README](../README.md)

---

## Contents

1. [Startup](#startup)
2. [The bridge-in flow (Ethereum → STRATO)](#the-bridge-in-flow-ethereum--strato)
3. [The bridge-out flow (STRATO → Ethereum)](#the-bridge-out-flow-strato--ethereum)
4. [The HTTP unblock flow](#the-http-unblock-flow)
5. [Anatomy of a MercataBridge write](#anatomy-of-a-mercatabridge-write)
6. [State, idempotency, and recovery](#state-idempotency-and-recovery)

---

## Startup

`src/index.ts` is the entry point. On boot the service:

1. Loads `.env` via `dotenv` and validates required environment variables ([`src/config/index.ts`](../src/config/index.ts)). Missing vars crash the process (`process.exit(2)`).
2. Starts an Express app on `PORT` (default `3003`) exposing `GET /health` and `POST /request-deposit-action`.
3. Runs `validateBridgeConfig()` ([`configValidator.ts`](../src/utils/configValidator.ts)):
   1. Fetches the OIDC discovery document.
   2. Does a live user-auth probe via `getBAUserToken()`.
   3. Validates address / private-key / JWT formats.
   4. Reads `getEnabledChains()` from Cirrus and confirms each chain has a `CHAIN_<id>_RPC_URL`.
   Validation failure exits with code 1 before any polling starts.
4. `initOpenIdConfig()` caches the discovery document + JWKS for request-time auth ([`auth/index.ts`](../src/auth/index.ts)).
5. `startMultiChainDepositPolling()` ([`alchemyPolling.ts`](../src/polling/alchemyPolling.ts)) — starts the Ethereum-side cycle via `setInterval` at `bridgeInInterval` ms (default 1 min). Invoked immediately for the first poll (without awaiting), then repeated on the interval.
6. `initializeMercataPolling()` ([`mercataPolling.ts`](../src/polling/mercataPolling.ts)) — starts three concurrent STRATO-side cycles (deposit-initiated, withdrawal-request, withdrawal-tx), each via `setInterval`.

From this point the service is four concurrent polling loops plus the HTTP server.

> **Note:** `NODE_URL` is not in the `requiredEnvVars` array, but `validateBridgeConfig()` calls `getEnabledChains()` which hits Cirrus at `${NODE_URL}/cirrus/search/...`. If `NODE_URL` is unset, validation fails and the process exits before polling starts.

> **Note:** A non-OK `eth_blockNumber` response from a chain's RPC is a **warning**, not a startup failure. Missing `CHAIN_<id>_RPC_URL` env vars are a hard error.

---

## The bridge-in flow (Ethereum → STRATO)

Traces one user deposit from the source chain to a confirmed credit on STRATO with a Voucher reward. Two loops cooperate: `startMultiChainDepositPolling` mirrors the on-chain event into STRATO; `startDepositInitiatedPolling` verifies and confirms it.

### 1. Activity discovery

Per `bridgeInInterval` cycle, [`alchemyPolling.ts`](../src/polling/alchemyPolling.ts) reads from Cirrus in parallel:

- `getEnabledChains()` — every `BlockApps-MercataBridge-chains` row where `value->>enabled = true`.
- `getBridgeInfo()` — the root `BlockApps-MercataBridge` row, exposing `depositsPaused` / `withdrawalsPaused`.

If `depositsPaused` is true, the cycle logs `Deposits are paused` and returns.

### 2. Event fetch

For each enabled chain (in parallel via `Promise.allSettled`):

- Effective cursor = `max(local lastProcessedBlocks.json, on-chain chains.lastProcessedBlock)`. Managed by [`blockTrackingService.ts`](../src/services/blockTrackingService.ts). This runs first (even before the RPC check).
- `isChainConfigured(externalChainId)` — verifies the per-chain RPC URL is set. Unconfigured chains are skipped silently.
- `getCurrentBlockNumber(externalChainId)` via `eth_blockNumber`. If the tip hasn't advanced past the cursor, return early.
- `getChainLogs(...)` — `eth_getLogs` filtered by address (the chain's `depositRouter`) and topic 0 (`DEPOSIT_EVENT_SIGNATURE = 0x5542…f750`).
- Decode each log: topics give `externalToken`, `externalSender`, `stratoRecipient`; the data slot gives `amount` (first 32 bytes) and `targetStratoToken` (second 32 bytes).

### 3. Rebase (xStock only)

Tokens whose `targetStratoToken` has a non-zero rebase factor in `BlockApps-PriceOracle-rebaseFactors` represent a rebasing external token bridged to a share-counted STRATO token. Bridge-in **divides**:

```text
adjustedAmount = (originalAmount * 1e18) / factor
```

`getRebaseFactors()` fetches factors for all deduped target tokens in one request. Tokens with no factor pass through unchanged.

### 4. Mirror to STRATO

[`bridgeService.ts`](../src/services/bridgeService.ts) → `depositBatch()` submits a `FunctionInput` targeting `MercataBridge.depositBatch(...)` via `execute()`. The on-chain deposit enters `bridgeStatus=1` (initiated).


| Error pattern                           | Behavior                                                |
|:--|:--|
| `MB: dup key` / `MB: duplicate deposit` | Swallowed as info — another replica already mirrored it |
| Anything else                           | Re-thrown; cursor not advanced                          |


### 5. Cursor advance policy

Dual cursor — multiple replicas converge without drift:


| Scenario           | Local file | On-chain `setLastProcessedBlock` |
|:--|:--|:--|
| No deposits found  | advanced | — (no transaction)               |
| Deposits processed | advanced | advanced                       |


> **Note:** The on-chain cursor rejects rollbacks (`MB: cannot rollback block`), so the call is idempotent.

### 6. Verification

The second loop, `startDepositInitiatedPolling` in [`mercataPolling.ts`](../src/polling/mercataPolling.ts), runs every `withdrawalInterval` (default 1 min):

- `getDepositsByStatus("1")` from Cirrus, with `depositsPaused=false` joined in.
- `verifyDepositsBatch(deposits)` in [`verificationService.ts`](../src/services/verificationService.ts) groups by chain and batch-fetches receipts + internal traces per chain.

Per-deposit checks:


| Path                 | Condition                      | Verification                                                                                                                                        |
|:--|:--|:--|
| **ETH (direct)**     | `receipt.to === safe`          | Accept immediately                                                                                                                                  |
| **ETH (via router)** | `receipt.to === depositRouter` | An internal call must transfer exactly `stratoTokenAmount` to the Safe                                                                              |
| **ERC20**            | Any receipt log                | A `Transfer` log with `token = externalToken`, `to = safe`, and amount matching `stratoTokenAmount` after decimal normalization + rebase truncation |


> **Warning:** If an asset is disabled mid-flight, the deposit will revert on confirmation with `MB: route not enabled`.

Verified deposits → `confirmDepositBatch`. Failed → `reviewDepositBatch` (marks for manual review, not on-chain revert). Per-deposit error isolation: if verification throws for one deposit, the rest of the batch continues.

### 7. Voucher reward

After `confirmDepositBatch` succeeds, [`voucherService.ts`](../src/services/voucherService.ts) → `mintVouchersForDeposits(stratoRecipients)` builds one `Voucher.mint(to, amount)` tx per recipient where `amount = mintCount × 1e18` (default 25 Vouchers each), then submits them in a single `execute()` call. Mint failures are logged but do not fail the confirmation.

### 8. Error handling


| Error kind                                                      | Behavior                                                                                       |
|:--|:--|
| `MB: bad state` on `confirmDepositBatch` / `reviewDepositBatch` | Swallowed as info — another replica won                                                        |
| Verification failure for a deposit                              | Lands in `reviewDepositBatch` → manual unblock via [HTTP unblock flow](#the-http-unblock-flow) |
| Unknown error in the outer `poll()`                             | Logged with full context; loop continues next cycle                                            |


---

## The bridge-out flow (STRATO → Ethereum)

Traces one withdrawal request from creation on STRATO to the custody tx executing on the destination chain. Two loops cooperate: `startWithdrawalRequestPolling` builds and proposes the Safe transaction; `startWithdrawalTxPolling` watches for execution and finalizes.

### 1. Balance guard

`startWithdrawalRequestPolling` runs `checkBalances()` ([`balanceCheck.ts`](../src/utils/balanceCheck.ts)) first. Reads the service account's USDST and Voucher balances, divides by `gasFeeUSDST` / `gasFeeVoucher`, and marks the service **unhealthy** (via `logError`) if estimated remaining transactions fall at or below `minTransactionsThreshold` (default `200`). The cycle **continues** — only zero remaining transactions triggers `process.exit(1)`.

> **Warning:** The low-balance `logError` appends to the error flag file, so `/health` returns 500 even though the cycle proceeds. Top up the account and clear the flag to recover.

The other two Mercata-side loops do not run this guard.

### 2. Pick up requests

`getWithdrawalsByStatus("1")` from Cirrus, joined against the bridge root so that `bridge.withdrawalsPaused=eq.false` is enforced server-side.

### 3. Build Safe proposals

`createWithdrawalProposals()` in [`safeHelper.ts`](../src/utils/safeHelper.ts), per chain:

- **Rebase (xStock only)**: multiply — opposite direction from bridge-in:
  ```text
  externalAmount = (storedAmount * factor) / 1e18
  ```
- **Hot-wallet routing**: per-withdrawal `useHotWallet` flag (set on-chain). If the hot-wallet Safe is configured, check its balance per token; insufficient balance falls back to the main Safe with a log.
- **Nonce allocation**: `apiKit.getNextNonce(safeAddress)` per safe per chain, then incremented locally per proposal. Main safe and hot-wallet safe have independent nonce streams.
- **Meta-transaction**: `buildTxDescriptor()` builds ETH (`{to: recipient, value: amount, data: "0x"}`) or ERC20 (`Interface.encodeFunctionData("transfer", [recipient, amount])`) payloads.
- **Sign**: `protocolKit.getTransactionHash()` + `protocolKit.signHash()` using the proposer's private key.

### 4. Mark on STRATO

`MercataBridge.confirmWithdrawalBatch(ids, custodyTxHashes)` records which Safe tx hash goes with which withdrawal, advancing each to `bridgeStatus=2` (proposed). `MB: bad state` is swallowed — another replica got there first.

### 5. Propose to the Safe API

`apiKit.proposeTransaction(tx)` per proposal. For hot-wallet proposals, the service then calls `hotProtocolKit.executeTransaction(tx)` immediately — hot-wallet withdrawals auto-execute on-chain without waiting for co-signers.

> **Note:** Nonce conflicts (HTTP 409/422 or messages matching `nonce|already exists|conflict`) are handled by the generic proposal error handler — the error is logged and the loop moves to the next proposal. The next cycle fetches a fresh `getNextNonce()` from the Safe API.

### 6. Email approvers

[`emailService.ts`](../src/services/emailService.ts) posts a SendGrid notification per proposal to `TRANSACTION_APPROVER_EMAILS` (if configured). Email failures are logged per-proposal; the batch logs a summary.

### 7. Monitor execution

`startWithdrawalTxPolling` runs every `bridgeOutInterval` (default 1 min):

- `getWithdrawalsByStatus("2")` — the proposed-but-not-finalized set.
- `getSafeTxHashFromEvents(ids)` looks up each withdrawal's `custodyTxHash` from `BlockApps-MercataBridge-WithdrawalPending`.
- Group by chain; per chain, `monitorSafeTransactionStatusBatch` iterates sequentially (1 s between requests to avoid Safe API rate-limiting).

Per withdrawal, `checkSafeTxStatus()` classifies:


| Status     | Condition                                                          |
|:--|:--|
| `executed` | `isExecuted && isSuccessful` on the proposal                       |
| `rejected` | A different `safeTxHash` with the **same nonce** has been executed |
| `pending`  | Neither                                                            |


### 8. Finalize or abort


| Safe status | Bridge call                    | Result                                                   |
|:--|:--|:--|
| `executed`  | `finaliseWithdrawalBatch(ids)` | Withdrawal reaches terminal state                        |
| `rejected`  | `abortWithdrawalBatch(ids)`    | Refunds the user's STRATO-side balance (`WITHDRAWAL_ABORT_DELAY` applies to user-initiated aborts only, not the service) |
| `pending`   | —                              | Re-checked next cycle                                    |


`MB: bad state` and `MB: not abortable` are swallowed as info.

---

## The HTTP unblock flow

`POST /request-deposit-action` lets an operator (or an authenticated user) force an action on a deposit that can't be auto-verified.

1. Request hits the service (in production, the OpenResty sidecar enforces 3 req/s per IP).
2. `AuthHandler.authorizeRequest()` ([`tokenMiddleware.ts`](../src/auth/tokenMiddleware.ts)) verifies the OIDC bearer token. The verified user address is set on `res.locals.userAddress`.
3. `DepositActionController.requestDepositAction` reads `{externalChainId, externalTxHash, action, targetToken}` from the body and pairs them with the token-derived `userAddress`. The caller cannot spoof the user.
4. [`depositActionService.ts`](../src/services/depositActionService.ts) calls `MercataBridge.requestDepositAction(user, externalChainId, externalTxHash, action, targetToken)`.

> **Note:** The meaning of the `action` parameter is contract-defined — see `MercataBridge.sol`.

---

## Anatomy of a MercataBridge write

Unlike the rewards poller (one method), the bridge has eight distinct write methods on `MercataBridge` plus `Voucher.mint`. All share the same submission path through `execute()`.

### Stage 1 — Input


| Caller                             | File                                                                 | Method called                                                               |
|:--|:--|:--|
| `alchemyPolling` → `bridgeService` | [`bridgeService.ts`](../src/services/bridgeService.ts)               | `depositBatch`                                                              |
| `mercataPolling` → `bridgeService` | [`bridgeService.ts`](../src/services/bridgeService.ts)               | `confirmDepositBatch`, `reviewDepositBatch`                                 |
| `mercataPolling` → `bridgeService` | [`bridgeService.ts`](../src/services/bridgeService.ts)               | `confirmWithdrawalBatch`, `finaliseWithdrawalBatch`, `abortWithdrawalBatch` |
| `blockTrackingService`             | [`blockTrackingService.ts`](../src/services/blockTrackingService.ts) | `setLastProcessedBlock`                                                     |
| `depositActionService`             | [`depositActionService.ts`](../src/services/depositActionService.ts) | `requestDepositAction`                                                      |
| `voucherService`                   | [`voucherService.ts`](../src/services/voucherService.ts)             | `Voucher.mint`                                                              |


### Stage 2 — Build `FunctionInput` (caller-side)

```ts
{
  contractName:    "MercataBridge",       // or "Voucher"
  contractAddress: config.bridge.address, // or config.voucher.contractAddress
  method:          "depositBatch",        // varies per call
  args: {
    externalChainIds: [...],
    externalSenders:  [...],
    // ... remaining arrays
  },
}
```

### Stage 3 — Wrap as `BuiltTx` (`stratoHelper.buildFunctionTx`)

```ts
{
  txs: [{ type: "FUNCTION", payload: { /* the FunctionInput */ } }],
  txParams: { gasLimit, gasPrice },  // fixed in config/index.ts
}
```

### Stage 4 — Submit and poll (`stratoHelper.execute`)


| Call               | Endpoint                             | Purpose                                                                        |
|:--|:--|:--|
| `strato.post(...)` | `/transaction/parallel?resolve=true` | Submit; returns `[{ hash, … }]`                                                |
| `bloc.post(...)`   | `/transactions/results`              | Polled with each hash until no result is `Pending`. Returns `{ status: Success \| Failure, hash }` |


### Stage 5 — On-chain execution

Each method has its own contract-side semantics. Key behaviors:


| Method                    | On-chain effect                                                                      |
|:--|:--|
| `depositBatch`            | Records deposit with decimal conversion; sets `bridgeStatus=1`. Tokens are **not** minted yet. |
| `confirmDepositBatch`     | Mints STRATO-side tokens to `stratoRecipient` (or executes auto-save/auto-forge action); sets `bridgeStatus=COMPLETED` |
| `reviewDepositBatch`      | Flags for manual review                                                              |
| `confirmWithdrawalBatch`  | Records custody tx hash; `bridgeStatus` 1→2                                          |
| `finaliseWithdrawalBatch` | Terminal success state                                                               |
| `abortWithdrawalBatch`    | Refunds the user's STRATO-side balance (`WITHDRAWAL_ABORT_DELAY` applies to user-initiated aborts only, not the service) |
| `setLastProcessedBlock`   | Advances the per-chain cursor; rejects rollback (`MB: cannot rollback block`)        |
| `requestDepositAction`    | Contract-defined per `action` parameter                                              |


---

## State, idempotency, and recovery

### Where state lives

Two files in `data/` under the service's working directory — see [README § State files](../README.md#state-files-under-data) for the canonical table.


| File                       | Purpose                    |
|:--|:--|
| `lastProcessedBlocks.json` | Per-chain bridge-in cursor |
| `bridge-error.flag`        | Health-check sink          |


> **Important:** The block cursor is cached in memory by `blockTrackingService.ts`. To rewind the cursor for replay, **stop the service first** — otherwise the file edit will be overwritten on the next successful cycle.

### Idempotency

All four polling loops tolerate replay. Specific patterns:

- **Bridge-in cursor**: the effective cursor is `max(local, on-chain)`, so stale replicas catch up without double-processing.
- **`MB: dup key` / `MB: duplicate deposit`**: `depositBatch` is idempotent on `(externalChainId, externalTxHash)`. Duplicate submissions are swallowed as info.
- **`MB: bad state`**: thrown by `confirm*` / `review*` / `finalise*` when the state transition already happened. Swallowed as info.
- **`MB: not abortable`**: thrown by `abortWithdrawalBatch` when the withdrawal is already in a terminal state (completed or aborted by another replica or a prior cycle). Swallowed as info.
- **Safe API nonce conflicts**: HTTP 409/422 or messages matching `nonce|already exists|conflict`. Caught by the generic proposal error handler — the error is logged and the loop continues. The next cycle fetches a fresh `getNextNonce()` from the Safe API.

### Common recovery scenarios


| Symptom                                        | What to do                                                                                                                                                                                                                  |
|:--|:--|
| Cursor rewind needed (normal)                  | Stop service, edit `data/lastProcessedBlocks.json` to lower the chain's entry, restart. The on-chain floor via `setLastProcessedBlock` limits how far back you can go. Re-processing deposits is safe (`MB: dup key` path). |
| Cursor rewind below on-chain floor (emergency) | Admin vote: `emergencySetLastProcessedBlock(externalChainId, lastProcessedBlock)`. `onlyOwner`, no rollback guard. Will re-fetch and re-verify every receipt in the range.                                                  |
| Stuck deposit in `bridgeStatus=1`              | Retried automatically next cycle by `verifyDepositsBatch`. If it permanently fails, it lands in `reviewDepositBatch` and requires the [HTTP unblock flow](#the-http-unblock-flow).                                          |
| Stuck withdrawal in `bridgeStatus=2`           | Re-checked each cycle. If Safe owners reject (execute a different nonce), it becomes `rejected` and hits `abortWithdrawalBatch`. The service calls as admin, so `WITHDRAWAL_ABORT_DELAY` does not apply.                     |
| `/health` returns 500                          | Inspect `data/bridge-error.flag` for context, fix the root cause, delete or truncate the flag. A single stray `logError` is enough to flip it.                                                                              |
| Multi-replica idempotency noise                | Expected and safe. If it becomes too loud, consider leader election.                                                                                                                                                        |
