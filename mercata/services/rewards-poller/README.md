# Mercata Rewards Poller Service

The rewards poller is a long-running Node service. It reads protocol events from Cirrus DB, converts them to USD amounts via the on-chain Price Oracle, and writes them to the `Rewards` contract through a single method: `batchHandleAction`. It also computes periodic bonus (boost) credits for holders of configured bonus tokens and posts those through the same method.

- **How it works end-to-end** → [docs/FLOW.md](docs/FLOW.md)
- **Runbooks — add/remove a reward, add/remove a bonus token** → [docs/OPERATIONS.md](docs/OPERATIONS.md)

---

## Source map

```text
src/
├── index.ts                                  Express bootstrap, /health, cycle init
├── features/
│   ├── polling/
│   │   ├── polling.bootstrap.ts              Starts both cycles
│   │   └── polling.scheduler.ts              Recursive setTimeout loop
│   ├── rewards-cycle/
│   │   ├── rewardsCycle.processor.ts         Rewards cycle: read events → batch → write
│   │   ├── rewardsBatch.writer.ts            batchHandleAction / batchAddBonus wrappers
│   │   └── rewardsBalance.guard.ts           Pre-flight USDST/Voucher balance check
│   ├── bonus-cycle/
│   │   ├── bonusCycle.processor.ts           Bonus cycle: retry pending, compute, write
│   │   ├── bonusCredit.calculator.ts         Boost math
│   │   └── bonusConfig.validator.ts          Schema-checks bonusTokenConfig.json + validates BonusCredit objects
│   └── events-read/
│       ├── cirrusEvents.client.ts            Discovers activities + fetches events
│       ├── activity.mapper.ts                attributeMapping.json + PriceOracle USD conversion
│       ├── actionableEvents.parser.ts        Parses Rewards.activities.actionableEvents
│       ├── bonusEligibility.reader.ts        Current bonus-token balances per user
│       ├── emissionRates.reader.ts           Per-user per-activity emission rates
│       ├── stakeUsd.provider.ts              Per-activity USD notional: LP tokens (reserve-weighted, via Oracle), vault shares (on-chain NAV), CDP (passthrough)
│       ├── directPayout.resolver.ts          Maps bonus token → direct-payout event name
│       └── eventRecord.mapper.ts, mappingRow.parser.ts, addressNormalization.ts
├── infra/
│   ├── config/
│   │   ├── runtimeConfig.ts                  Single `config` object
│   │   ├── constants.ts, env.ts              Defaults and env validation
│   │   ├── attributeMapping.json             (see Configuration)
│   │   └── bonusTokenConfig.json             (see Configuration)
│   ├── auth/
│   │   └── oauth.client.ts, tokenProvider.ts OpenID / STRATO auth + BA user address
│   ├── http/
│   │   ├── api.ts                            strato / bloc / cirrus axios clients
│   │   ├── strato.client.ts                  buildFunctionTx + postAndWaitForTx + execute
│   │   └── retry.policy.ts                   Exponential backoff wrapper
│   ├── observability/
│   │   ├── logger.ts                         Structured console logging with secret redaction
│   │   └── errorFileSink.ts, healthMonitor.ts Error flag file for /health
│   └── state/
│       ├── atomicJson.store.ts               Atomic JSON write (write-to-tmp then rename)
│       ├── blockTracking.repo.ts             Block cursor (lastProcessedBlock.json)
│       └── bonusTracking.repo.ts             Bonus state (lastBonusRun.json)
└── shared/
    ├── core/                                 address.ts, errors.ts, retry.ts
    └── types/index.ts
```

---

## Configuration

### Required environment variables


| Variable                     | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `BA_USERNAME`, `BA_PASSWORD` | BlockApps credentials                               |
| `CLIENT_ID`, `CLIENT_SECRET` | OAuth client credentials                            |
| `OPENID_DISCOVERY_URL`       | OpenID discovery endpoint                           |
| `NODE_URL`                   | STRATO node URL                                     |
| `REWARDS_CONTRACT_ADDRESS`   | Rewards contract (proxy)                            |
| `PRICE_ORACLE_ADDRESS`       | Price Oracle contract (required for USD conversion) |


### Optional environment variables


| Variable                         | Default                                    | Purpose                                       |
| -------------------------------- | ------------------------------------------ | --------------------------------------------- |
| `PORT`                           | `3004`                                     | Express port                                  |
| `USDST_ADDRESS`                  | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` | USDST token                                   |
| `VOUCHER_ADDRESS`                | `000000000000000000000000000000000000100e` | Voucher token                                 |
| `POLLING_INTERVAL`               | `600000` (10 min)                          | Rewards cycle interval, ms                    |
| `MAX_BATCH_SIZE`                 | `50`                                       | Actions per `batchHandleAction` call          |
| `BONUS_CRON_SCHEDULE`            | `0 3,9,15,21 * * *`                        | Bonus cycle cron                              |
| `GAS_FEE_USDST`                  | `1` (= 0.01 USDST)                         | Gas estimate per tx, multiplied by 1e16       |
| `GAS_FEE_VOUCHER`                | `100` (= 1 Voucher)                        | Gas estimate per tx, multiplied by 1e16       |
| `MIN_TRANSACTIONS_THRESHOLD`     | `1`                                        | Abort cycle if estimated txs remaining ≤ this |
| `WARNING_TRANSACTIONS_THRESHOLD` | `100`                                      | Log error (flag unhealthy) below this         |
| `RETRY_MAX_ATTEMPTS`             | `2`                                        | Exponential backoff for Strato calls          |
| `RETRY_INITIAL_DELAY`            | `1000`                                     | ms                                            |
| `RETRY_MAX_DELAY`                | `10000`                                    | ms                                            |


See [`src/infra/config/constants.ts`](src/infra/config/constants.ts) for the full list of defaults.

### Event attribute mapping

[`src/infra/config/attributeMapping.json`](src/infra/config/attributeMapping.json) is keyed by contract address, then by event name. Each entry tells the poller which attribute on the event payload holds the amount (and optionally which holds the user address; otherwise `transaction_sender` is used).

```json
{
  "0000000000000000000000000000000000001004": {
    "Deposited":  { "amount": "mTokenMinted", "user": "user" },
    "Withdrawn":  { "amount": "mTokenBurned" }
  }
}
```


| Field    | Required | Meaning                                                                         |
| -------- | -------- | ------------------------------------------------------------------------------- |
| `amount` | yes      | Event attribute that holds the amount                                           |
| `user`   | no       | Event attribute that holds the user address; falls back to `transaction_sender` |


Keys are the 40-hex-char address (no `0x`, lowercase). Categories currently represented: protocol pool events, bridge events, stablecoin mint/burn, staking, AMM swaps, LP token mint/burn, external vaults. See [FLOW.md](docs/FLOW.md) for how this file is used at runtime, and [OPERATIONS.md](docs/OPERATIONS.md) for how to add entries.

### Bonus token config

[`src/infra/config/bonusTokenConfig.json`](src/infra/config/bonusTokenConfig.json) is an array of objects:

```json
[
  {
    "address": "<stratoTokenAddress>",
    "maxMultiplier": 2,
    "conversionRate": 0.3
  }
]
```


| Field            | Constraint                 | Meaning                                                            |
| ---------------- | -------------------------- | ------------------------------------------------------------------ |
| `address`        | 40-hex, no `0x`, lowercase | Bonus token contract on STRATO                                     |
| `maxMultiplier`  | strictly `> 1`             | Total boost cap; `2` means up to 2× total rewards at full coverage |
| `conversionRate` | in `(0, 1]`                | Bonus token → USD; `0.3` means 1 token covers $0.30 of position    |


> **Important:** Constraints are enforced at startup by `bonusConfig.validator.ts`. An invalid config crashes the service on boot.

> **Caveat:** `maxMultiplier` is currently taken from the **first** token config entry only (`tokenConfigs[0].maxMultiplier` at `bonusCycle.processor.ts:40`) and applied to all users. If multiple bonus tokens are configured with different `maxMultiplier` values, only the first entry's value is used.

---

## Running

```bash
cd services/rewards-poller
npm install
cp .env.example .env   # fill in the required variables
npm start              # runs ts-node on src/index.ts
npm run build          # compile to dist/ via tsc
```

> **Note:** `npm run dev` (nodemon) is not usable as-is because the service writes state files (`lastProcessedBlock.json`, `lastBonusRun.json`) in the working directory on every cycle, which nodemon detects and triggers a restart loop. Use `npm start` for local work, or run nodemon manually with `--ignore '*.json' --ignore '*.flag'`.

---

## Health, state, and logging

### Health check

```
GET /health
```

Returns `200` when the error flag file is empty or missing; `500` when it has content. The `/health` handler calls `healthMonitor.errorFileExists()` ([`healthMonitor.ts`](src/infra/observability/healthMonitor.ts)), which wraps [`errorFileSink.ts:errorFileHasContent`](src/infra/observability/errorFileSink.ts) with ENOENT handling.

The flag is append-only: every `logError` call writes to it — low-balance warnings, transient Cirrus failures, anything at error level. Once set, the service stays unhealthy until you delete or truncate `rewards-poller-error.flag` after resolving the root cause.

For recovery scenarios, see [FLOW.md § State, idempotency, and recovery](docs/FLOW.md#state-idempotency-and-recovery).

### State files (working directory)


| File                        | Shape                                                             | Writer                                                           | Atomic?              |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| `lastProcessedBlock.json`   | `{ blockNumber, eventIndex, block_timestamp }`                    | [`blockTracking.repo.ts`](src/infra/state/blockTracking.repo.ts) | yes (write)          |
| `lastBonusRun.json`         | `{ lastSuccessfulTimestamp, pendingCredits[], balanceSnapshots }` | [`bonusTracking.repo.ts`](src/infra/state/bonusTracking.repo.ts) | yes (write)          |
| `rewards-poller-error.flag` | Append-only log of error-level events                             | [`errorFileSink.ts`](src/infra/observability/errorFileSink.ts)   | no (`fs.appendFile`) |


Atomic writes go through [`atomicJson.store.ts`](src/infra/state/atomicJson.store.ts) (write-to-tmp then rename). Reads use `fs.readFile` directly. Non-empty `.flag` means `/health` reports unhealthy.

### Logging

Structured JSON-ish logs to stdout/stderr via [`src/infra/observability/logger.ts`](src/infra/observability/logger.ts) (plain `console`, not Winston):

- `logInfo(context, message, data?)` — successful operations.
- `logError(context, error, data?)` — failures; also appends to the error flag file.

Known sensitive patterns redacted before output:

- `api_key=` / `api-key=` / `apikey=`
- `Bearer <token>`
- `Authorization:` headers

> **Warning:** Raw credential strings outside the patterns above are not auto-redacted. Be careful about log context.

