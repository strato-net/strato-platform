# Rewards Poller — End-to-End Flow

How the service works, from start to finish.

- For **how to change things** → [OPERATIONS.md](OPERATIONS.md)
- For **module map, config, health** → [README](../README.md)

---

## Contents

1. [Startup](#startup)
2. [The rewards cycle](#the-rewards-cycle)
3. [The bonus cycle](#the-bonus-cycle)
4. [Anatomy of a contract write](#anatomy-of-a-contract-write)
5. [State, idempotency, and recovery](#state-idempotency-and-recovery)

---

## Startup

`src/index.ts` is the entry point. On boot the service:

1. Loads `.env` via `dotenv`.
2. Builds the single `config` object ([`runtimeConfig.ts`](../src/infra/config/runtimeConfig.ts)). At module load time the order is:
   1. Parse and validate [`bonusTokenConfig.json`](../src/infra/config/bonusTokenConfig.json) via `bonusConfig.validator.ts`.
   2. Construct the `config` object.
   3. Run `validateRequiredEnvVars` on `REQUIRED_ENV_VARS` (see [`constants.ts`](../src/infra/config/constants.ts)).

   An invalid bonus config throws an uncaught `Error` first; a missing env var calls `process.exit(2)` last. Either crashes the process on boot, through different mechanisms.
3. Starts an Express app on `PORT` (default `3004`) exposing `GET /health`.
4. `initOpenIdConfig()` fetches the OpenID discovery document and primes the OAuth flow ([`tokenProvider.ts`](../src/infra/auth/tokenProvider.ts)).
5. `initializeRewardsPolling()` (in [`polling.bootstrap.ts`](../src/features/polling/polling.bootstrap.ts)):
   - Reads the block cursor from `lastProcessedBlock.json`. If the file is absent or corrupt, `getLatestCursorFromEvents()` queries Cirrus for the **most recent** `ActionProcessed` event on the Rewards contract (`order: id.desc`, `limit: 1`) and uses that as the starting cursor.
   - Starts the rewards cycle via `polling.scheduler.ts` (recursive `setTimeout`, so each cycle waits for the previous to finish before scheduling the next).
   - Schedules the bonus cycle via `node-cron` using `BONUS_CRON_SCHEDULE`.

> **Note:** On a fresh deploy with no cursor file, the service starts from the **tip** of the Cirrus event stream — it does not backfill history.

From this point the service is two concurrent loops plus the HTTP server.

---

## The rewards cycle

Entry: [`rewardsCycle.processor.ts`](../src/features/rewards-cycle/rewardsCycle.processor.ts) → `processRewardsCycle()`. Runs every `POLLING_INTERVAL` ms (default 10 minutes).

### 1. Balance guard

`checkBalances()` ([`rewardsBalance.guard.ts`](../src/features/rewards-cycle/rewardsBalance.guard.ts)):

- Reads the service account's USDST and Voucher balances from Cirrus (`/BlockApps-Token-_balances`, `/BlockApps-Voucher-_balances`).
- Divides each by `GAS_FEE_*` to estimate transactions remaining; sums the two counts.
- Throws if the sum is at or below `MIN_TRANSACTIONS_THRESHOLD` (default `1`), aborting this cycle.
- If the sum is below `WARNING_TRANSACTIONS_THRESHOLD` (default `100`), calls `logError`.

> **Warning:** A low-balance warning goes through `logError`, which appends to the error flag file and marks the service **unhealthy**. Operators clear this by topping up the account and deleting or truncating the flag.

### 2. Activity discovery

`getEventQueryParams()` ([`cirrusEvents.client.ts`](../src/features/events-read/cirrusEvents.client.ts)) queries Cirrus for the Rewards contract's `activities` mapping, filtered to entries with non-zero `emissionRate`. For each activity it reads `sourceContract` and `actionableEvents` and builds three lookup structures:

| Structure | Built as | Returned as | Use |
|:--|:--|:--|:--|
| `contractAddresses` | `Set<string>` | `string[]` | SQL filter |
| `eventNames` | `Set<string>` | `string[]` | SQL filter |
| `validPairs` | `Set<string>` (pair keys) | `Set<string>` | Post-filter against the SQL cross-product |

> **Note:** What gets tracked is fully on-chain. The service has no local list; admin governance on `Rewards.sol` is the source of truth.

### 3. Event fetch

`getEventsBatch()` pulls new events since the stored cursor (`{blockNumber, eventIndex, block_timestamp}`). Two parallel paths:

**Regular events** (`/event` Cirrus table):

- Filtered by contract address + event name + `block_timestamp >= cursor.block_timestamp`.
- Results post-filtered to drop events at or before `(cursor.blockNumber, cursor.eventIndex)`.
- For each event that passes the cursor filter, [`activity.mapper.ts`](../src/features/events-read/activity.mapper.ts) → `extractAmountFromAttributes` looks up the right attribute per [`attributeMapping.json`](../src/infra/config/attributeMapping.json).
- For `Swap`, `DepositCompleted`, `WithdrawalCompleted` the amount is converted to USD using the most recent `BlockApps-PriceOracle-PriceUpdated` / `BlockApps-PriceOracle-BatchPricesUpdated` event at or before the event's timestamp.
- `DepositCompleted` / `WithdrawalCompleted` additionally drop any token that isn't USDST — only USDST bridge flows accrue rewards.

**LP-token transfers** (`/BlockApps-Token-Transfer`):

- For addresses whose `attributeMapping.json` entry has `Minted` and/or `Burned`.
- Filtered by `from = 0000…0` (mint) or `to = 0000…0` (burn) — the 40-hex zero address.
- Synthesized into a `Minted` or `Burned` protocol event with `amount = value`.

`getEventsBatch()` merges the two sets and sorts by `(blockNumber, eventIndex)`.

### 4. Batch and write

Events are mapped to `RewardsAction` records and chunked into batches of `MAX_BATCH_SIZE` (default `50`). For each batch:

1. [`rewardsBatch.writer.ts`](../src/features/rewards-cycle/rewardsBatch.writer.ts) → `batchHandleAction()` builds a `FunctionInput` targeting `Rewards.batchHandleAction(...)`.
2. `retryWithBackoff` ([`retry.policy.ts`](../src/infra/http/retry.policy.ts)) wraps the call — default 2 attempts with exponential backoff.
3. `execute()` ([`strato.client.ts`](../src/infra/http/strato.client.ts)) posts to STRATO's `/transaction/parallel?resolve=true`, waits for tx hashes, then polls `/transactions/results` until each is no longer `Pending`.
4. On success, the block cursor is advanced to the last event in the batch via `blockTrackingService.updateCursor()`.

### 5. Error handling

| Error kind | Behavior |
|:--|:--|
| Contract execution failure (per `isContractExecutionFailure()`) | Batch skipped, **cursor still advances**. One poisoned event can't block the queue. |
| Anything else (network, Strato, auth) | Re-thrown from the per-batch `catch`, then swallowed by the outer `catch` in `processRewardsCycle` which calls `logError` and returns. The cycle ends early, the cursor does not advance past the failed batch, the polling loop continues, and the next cycle retries the same range. |

---

## The bonus cycle

Entry: [`bonusCycle.processor.ts`](../src/features/bonus-cycle/bonusCycle.processor.ts) → `processBonusCycle()`. Scheduled by `node-cron` using `BONUS_CRON_SCHEDULE` (default `0 3,9,15,21 * * *` — four times a day).

### 1. What the bonus actually is

A user who holds an eligible bonus token gets a multiplier on their base rewards, up to `maxMultiplier` total, scaled by how much of their active position value is "covered" by their bonus-token holdings. Holding more bonus tokens than your position does **not** push coverage past 1.0 — the multiplier caps there.

Base rewards still accrue via the regular rewards cycle (via `batchHandleAction` on Position / OneTime activities). The bonus cycle **only posts the delta** — the extra amount on top of base rewards — as a direct-payout credit.

### 2. Eligibility

- Every **Position** activity the user is staked in counts toward `eligibleActivityUsd`.
- **OneTime** activities (`activityType === "1"`) are excluded (see `isPositionActivity()`, [`bonusCredit.calculator.ts`](../src/features/bonus-cycle/bonusCredit.calculator.ts)).
- Each activity's USD notional comes from [`stakeUsd.provider.ts`](../src/features/events-read/stakeUsd.provider.ts). Different activity shapes use different pricing paths:
  - **LP tokens** — priced reserve-weighted via the Price Oracle (`getOraclePrices()`).
  - **Vault shares** — priced from on-chain vault state (`BlockApps-SaveUSDSTVault` + `BlockApps-Token-_balances`) as a conservative `min(liveBalance, managedAssets) / totalShares`. The Price Oracle is not consulted for vault pricing.
  - **CDP notional** — passthrough (activity names containing "cdp", "mint", or "borrow" return `userStake` as-is on the assumption that the stake is already USD-denominated).

### 3. Anti-gaming: trailing-average balances

Per `(bonusToken, user)` pair, the service keeps a rolling window of `BONUS_SNAPSHOT_WINDOW = 28` balance snapshots (one per successful cycle). The effective balance for the cycle is:

```text
effectiveBalance = min(currentBalance, averageOfSnapshots)
```

A user who spikes their bonus-token balance right before a cycle sees only the rolling average, not their current holdings. The window grows cycle-by-cycle to its cap.

Snapshots are stored in `lastBonusRun.json` under `balanceSnapshots[<tokenKey>][<user>]` and trimmed to the most recent 28 entries each cycle.

### 4. The math

```text
effectiveBalance = min(currentBalance, trailingAvg)
boostCapUsd      = effectiveBalance * conversionRate
coverage         = min(1, boostCapUsd / eligibleActivityUsd)
boostedRewards   = baseRewards * coverage * (maxMultiplier - 1)
totalRewards     = baseRewards + boostedRewards
```

What the service actually posts (the delta) is computed at `bonusCredit.calculator.ts:189`:

```text
bonusAmount = eligibleEmissionRate * intervalSeconds * coverage * (maxMultiplier - 1)
```

| Term | Meaning |
|:--|:--|
| `eligibleEmissionRate` | Sum of the user's per-activity personal emission rates across eligible (Position) activities. Pulled via [`emissionRates.reader.ts`](../src/features/events-read/emissionRates.reader.ts) from Cirrus. |
| `intervalSeconds` | Seconds since the last successful bonus run, clamped to `[1, MAX_BONUS_INTERVAL_SECONDS]` where `MAX_BONUS_INTERVAL_SECONDS = 86400` (24h). On first run, `getCronIntervalSeconds()` derives a sensible interval from the cron expression. |

### 5. Retry: pending credits first

Each cycle:

1. Load state from `lastBonusRun.json`: `{lastSuccessfulTimestamp, pendingCredits[], balanceSnapshots}`.
2. Fetch current bonus-token balances ([`bonusEligibility.reader.ts`](../src/features/events-read/bonusEligibility.reader.ts)).
3. Build `bonusUsers` and advance `balanceSnapshots`.
4. **Compute** new credits.
5. **Validate** — `[...pendingCredits, ...newCredits]` are each run through `isValidBonusCredit()`. If any credit has missing fields, the cycle throws before any write happens (`bonusCycle.processor.ts:45-49`).
6. **Write** any `pendingCredits` from the previous cycle first (in batches of `MAX_BATCH_SIZE`). Failed batches stay pending.
7. **Write** the new credits. Failed batches are added to `pendingCredits`.
8. Persist updated state.

> **Note:** Computation of new credits happens before any write this cycle, but on the wire, previous-cycle leftovers go first. A single invalid credit anywhere in the combined set aborts the entire cycle before either write.

### 6. Per-user error isolation

If `computeStakeUsdForActivities()` throws for a specific user (e.g. an LP pricing error), `bonusCredit.calculator.ts:161-170` catches and skips that user — the rest of the cycle continues.

### 7. Writing the credit

`batchAddBonus()` ([`rewardsBatch.writer.ts`](../src/features/rewards-cycle/rewardsBatch.writer.ts)) builds a `FunctionInput` for `Rewards.batchHandleAction` — the **same method** as the regular cycle — but:

- The event name used is the one registered via `addOneTimeDirectPayoutActivity` for that bonus token (looked up at runtime by [`directPayout.resolver.ts`](../src/features/events-read/directPayout.resolver.ts)).
- Each credit uses sentinel `blockNumber = 1`, `eventIndex = 1`. Direct-payout activities on the contract bypass the idempotency check, so the same sentinels can be reused across cycles without collisions.
- No `retryWithBackoff` wrapper here — unlike the regular cycle, a failed `batchAddBonus` falls through immediately to the pending-credit path.

---

## Anatomy of a contract write

The service makes exactly **one kind of on-chain write**: `Rewards.batchHandleAction(...)`. A single batch (from either the rewards cycle or the bonus cycle) moves through five stages:

### Stage 1 — Input

Either `RewardsAction[]` (regular cycle) or `BonusCredit[]` (bonus cycle), both chunked to `MAX_BATCH_SIZE`.

### Stage 2 — Build `FunctionInput` (`rewardsBatch.writer`)

```ts
{
  contractName:    "Rewards",
  contractAddress: REWARDS_CONTRACT_ADDRESS,
  method:          "batchHandleAction",
  args: {
    sourceContracts: [...],
    eventNames:      [...],
    users:           [...],
    amounts:         [...],
    blockNumbers:    [...],
    eventIndexes:    [...],
  },
}
```

### Stage 3 — Wrap as `BuiltTx` (`strato.client.buildFunctionTx`)

```ts
{
  txs: [{ type: "FUNCTION", payload: { /* the FunctionInput */ } }],
  txParams: { gasLimit, gasPrice },  // fixed in constants.ts
}
```

### Stage 4 — Submit and poll (`strato.client.execute`)

| Call | Endpoint | Purpose |
|:--|:--|:--|
| `strato.post(...)` | `/transaction/parallel?resolve=true` | Submit; returns `[{ hash, ... }]` |
| `bloc.post(...)` | `/transactions/results` | Polled with each hash until no result is `Pending`. Returns `{ status: Success \| Failure, hash }` |

### Stage 5 — On-chain execution (`Rewards.batchHandleAction`)

For each `(sourceContract, eventName, user, amount, blockNumber, eventIndex)` in the batch:

1. Look up the activity via `sourceEventInfo[sourceContract][eventName]`. Reverts the action if no activity is registered for that pair.
2. If the activity is marked `directPayout`, credit the user directly and return — this path bypasses the idempotency check (see [Idempotency](#idempotency)).
3. Otherwise, check `processedEvents[keccak256(blockNumber, eventIndex)]` — if already processed, silently skip.
4. Update the activity's global reward index, then settle the user's pending rewards using their **old** stake (Aave-style: rewards = oldStake × (currentIndex − userIndex)). This credits `unclaimedRewards` before the stake changes.
5. Apply the `Deposit` / `Withdraw` / `Occurred` action to the user's stake; update `userInfo.stake` and `totalStake`.

---

## State, idempotency, and recovery

### Where state lives

Three files in the service's working directory — see [README § State files](../README.md#state-files-working-directory) for the canonical listing. In brief:

| File | Purpose |
|:--|:--|
| `lastProcessedBlock.json` | Rewards-cycle cursor |
| `lastBonusRun.json` | Bonus-cycle state |
| `rewards-poller-error.flag` | Health-check sink |

> **Important:** The block cursor is cached in memory by `blockTracking.repo.ts` and a regression guard refuses to write a cursor that goes backwards during a run. To rewind the cursor for replay, **stop the service first** — otherwise the file edit will be overwritten on the next successful cycle.

### Idempotency

On-chain `batchHandleAction` uses `keccak256(blockNumber, eventIndex)` as a global dedup key in a single `processedEvents` mapping: processed events are silently skipped (mechanism described in [Anatomy of a contract write](#anatomy-of-a-contract-write) above). In practice the `(blockNumber, eventIndex)` pair is unique across all on-chain events, so this behaves as per-event dedup. Operational implications:

- **Replaying the rewards cycle is safe.** Rewind `lastProcessedBlock.json` (service stopped), restart. Duplicate events are dropped on-chain.
- **Bonus credits deliberately bypass** this check. Direct-payout activities use sentinel `blockNumber=1, eventIndex=1`, so the same user can receive multiple credits across cycles — which is exactly what you want for a periodic payout.

### Common recovery scenarios

| Symptom | What to do |
|:--|:--|
| Poisoned event blocking the cycle | Usually not an issue — contract execution failures auto-skip at `rewardsCycle.processor.ts:54-68` and the cursor advances. If not, manually advance the cursor past the offending `(blockNumber, eventIndex)`. |
| `/health` returns 500 | Inspect `rewards-poller-error.flag` for context, fix the root cause (top up gas, fix auth, fix Cirrus), then delete or truncate the flag. |
| Missed bonus cycles | `MAX_BONUS_INTERVAL_SECONDS = 86400` caps the interval at 24h regardless of downtime. You lose boost accrual beyond 24h of downtime. |
| Pending credits backlog | Inspect `lastBonusRun.json.pendingCredits[]`. They retry each cycle. If they fail persistently, the root cause is almost always the on-chain direct-payout activity being missing or misconfigured. |
