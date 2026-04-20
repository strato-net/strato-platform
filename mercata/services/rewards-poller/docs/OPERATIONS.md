# Rewards Poller — Operations Runbook

Step-by-step procedures for adding and removing rewards and bonuses. Use this when onboarding a new protocol, pool, or bonus token.

- For **how the service works** → [FLOW.md](FLOW.md)
- For **config and deployment** → [README](../README.md)

---

## Contents

- [Add a reward](#add-a-reward)
- [Remove a reward](#remove-a-reward)
- [Add a bonus](#add-a-bonus)
- [Remove a bonus](#remove-a-bonus)
- [Upgrade the Rewards contract](#upgrade-the-rewards-contract)

---

> **Note:** The authoritative registry of what is tracked lives on-chain in the Rewards contract's `activities` mapping. The poller discovers it at every cycle via Cirrus, so there is no "register in the service" step for activities. The two local JSON files ([`attributeMapping.json`](../src/infra/config/attributeMapping.json) and [`bonusTokenConfig.json`](../src/infra/config/bonusTokenConfig.json)) only tell the service how to interpret what the contract has already registered.

---

## Add a reward

Use when you want to reward users for a new kind of event (new pool, new LP, new protocol). "Reward" here means an **activity** on the Rewards contract — either **Position** (stake accrues rewards over time) or **OneTime** (one-shot credit per event).

### 1. Decide the activity shape

| Shape | When to use | Events |
|:--|:--|:--|
| **Position** | Stake accrues rewards proportional to `stake / totalStake`. Deposits, LPs, lending positions, vaults. | Paired `Deposit` + `Withdraw` |
| **OneTime** | One-shot credit when the event fires. Referrals, boosts, completed actions. | Single `Occurred` |

### 2. Register the activity on-chain (admin vote)

All activity registration happens via an Admin-UI governance vote on the Rewards contract. Pick the one function that matches your activity shape:

#### Option A — Position activity with deposit + withdraw events

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy (`REWARDS_CONTRACT_ADDRESS`)
> - **Function:** `addPositionActivitySimple(string name, uint256 emissionRate, address sourceContract, string depositEventName, string withdrawEventName)`

Example args:

- `name`: `"NewPool Staking"`
- `emissionRate`: CATA per second in the smallest unit (18 decimals — so `1e18` ≈ 1 CATA/sec). Use `0` to register disabled and enable later.
- `sourceContract`: pool contract address (no `0x` prefix, lowercase).
- `depositEventName`: `"Deposited"`
- `withdrawEventName`: `"Withdrawn"`

#### Option B — Position activity with custom events

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy
> - **Function:** `addPositionActivity(string name, uint256 emissionRate, address sourceContract, ActionableEvent[] actionableEvents)`

`ActionableEvent = (string eventName, ActionType actionType)` where `ActionType ∈ {Deposit, Withdraw, Occurred}`. At least one entry required.

#### Option C — OneTime activity

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy
> - **Function:** `addOneTimeActivity(string name, uint256 emissionRate, address sourceContract, string eventName)`

---

In all three cases:

**Admin UI → Vote On Issues → Create New Issue → select the function above, fill args, approve.**

### 3. Add attribute mapping

Edit [`src/infra/config/attributeMapping.json`](../src/infra/config/attributeMapping.json) — see [README § Event attribute mapping](../README.md#event-attribute-mapping) for the schema. Add a new entry keyed by `sourceContract` → `eventName`.

Extra considerations:

- **USD conversion** — if the event emits a non-USDST token amount that needs USD-denomination, extend `PRICE_CONVERSION_MAP` in [`activity.mapper.ts`](../src/features/events-read/activity.mapper.ts) with `"<EventName>": "<tokenAttributeName>"`. Make sure `PRICE_ORACLE_ADDRESS` is set.

  > **Warning:** `DepositCompleted` / `WithdrawalCompleted` have a hardcoded filter that drops any token other than USDST. A new entry in `PRICE_CONVERSION_MAP` does **not** inherit that filter.

- **LP mint/burn** — events named `Minted` / `Burned` use a special code path (fetched from `BlockApps-Token-Transfer` with zero-address `from`/`to`, not from `/event`). Use those event names for LP mint/burn tracking.

Commit and redeploy the service.

### 4. (Optional) Tune the activity

Additional admin on-chain calls, all `onlyOwner` on the Rewards proxy, same Admin-UI vote mechanism as step 2:

| Function | Purpose |
|:--|:--|
| `setEmissionRate(uint256 activityId, uint256 newEmissionRate)` | Change emission rate (set to `0` to disable) |
| `setActivityName(uint256 activityId, string newName)` | Rename |
| `setActivityMinAmount(uint256 activityId, uint256 newMinAmount)` | Require a minimum per-action amount to qualify |
| `setActivityWeight(uint256 activityId, uint256 newWeight)` | Weight multiplier, default `1e18` (1×). OneTime activities only. Must be `> 0` |
| `setPositionActivityEvents(uint256 activityId, ActionableEvent[] newActionableEvents)` | Replace events on a Position activity. Requires `totalStake == 0` |
| `setPositionActivityEventsSimple(uint256 activityId, string depositEventName, string withdrawEventName)` | Convenience form of the above. Requires `totalStake == 0` |
| `setOneTimeActivityEvent(uint256 activityId, string newEventName)` | Change the event on a OneTime activity. Requires `totalStake == 0` |

### 5. Verify

- Logs should include `CirrusService Loaded activities: N contracts, M event names, cursor: …` with N/M increased.
- On the next cycle, `CirrusService Fetched K events (…)` should include events from the new contract.
- `RewardsPolling Processed K actions` should follow.
- Confirm `batchHandleAction` transactions succeed on STRATO (no Failure status).

> **Note:** If you see `AttributeMapping No attribute mapping found for contract …` or `Amount attribute '…' not found`, fix the JSON and redeploy.

---

## Remove a reward

The clean way to remove a reward is to set the activity's emission rate to zero. The poller filters out activities where `emissionRate == 0` in `getEventQueryParams`, so the events stop being fetched.

### 1. Disable on-chain

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy (`REWARDS_CONTRACT_ADDRESS`)
> - **Function:** `setEmissionRate(uint256 activityId, uint256 newEmissionRate)`
> - **Args:** `activityId` = id from the original registration; `newEmissionRate` = `0`.

Admin UI → Vote On Issues → Create New Issue → select `setEmissionRate`, fill args, approve.

> **Note:** Existing user stakes and unclaimed rewards are preserved on-chain — only accrual stops. Re-enabling with `setEmissionRate(activityId, rate > 0)` resumes earning for all existing stakers at the new rate.

### 2. (Optional) Clean up attribute mapping

If no other activity uses the same `(contractAddress, eventName)` pair, you can remove the entry from `attributeMapping.json` to keep it tidy. Not required — unused entries are harmless.

### 3. Verify

On the next cycle, `CirrusService Loaded activities: …` should show a lower contract/event count. No new `batchHandleAction` calls will include that contract.

---

## Add a bonus

> **Note:** This runbook assumes the bonus token already exists on STRATO. If it's a bridged token, bridge onboarding happens separately and is not part of rewards operations. If the deployed Rewards contract doesn't yet support the boost model, run [Upgrade the Rewards contract](#upgrade-the-rewards-contract) first.

### 1. Edit `bonusTokenConfig.json`

Add an entry to [`src/infra/config/bonusTokenConfig.json`](../src/infra/config/bonusTokenConfig.json) — see [README § Bonus token config](../README.md#bonus-token-config) for the schema and validation rules.

```json
{
  "address": "<stratoTokenAddress>",
  "maxMultiplier": 2,
  "conversionRate": 0.3
}
```

Address is 40-hex, no `0x`, lowercase.

### 2. Register the direct-payout activity on-chain

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy (`REWARDS_CONTRACT_ADDRESS`)
> - **Function:** `addOneTimeDirectPayoutActivity(string name, address sourceContract, string eventName)`
> - **Args:**
>   - `name`: human-readable label, e.g. `"<Token> Bonus"`
>   - `sourceContract`: the bonus token's STRATO address (matches `address` in step 1)
>   - `eventName`: the synthetic bonus event label, e.g. `"Bonus"`

Admin UI → Vote On Issues → Create New Issue → select `addOneTimeDirectPayoutActivity`, fill args, approve.

Direct-payout activities have emission = 0 and skip the idempotency check, so the poller can post credits with sentinel `blockNumber = 1, eventIndex = 1`. The `eventName` is looked up per-token by `directPayout.resolver.ts` from the on-chain activity definition — as long as the registration lands, the poller picks it up.

> **Warning:** Only **one** direct-payout activity is allowed per `sourceContract`. `directPayout.resolver.ts` throws if it finds more than one.

### 3. Activate the token

Admin UI → Token Status:

- **Status:** `ACTIVE`
- **Status Code:** `2`

### 4. Redeploy the poller

`runtimeConfig.ts` reads `bonusTokenConfig.json` once at startup — the service must be restarted to pick up the new entry.

### 5. Verify

- Next bonus cycle (per `BONUS_CRON_SCHEDULE`) should log:
  - `CirrusService Loaded N current bonus balances from M bonus tokens` (M should include the new token)
  - `BonusUtils Calculated bonus credits for X/Y users`
  - `RewardsBonusPolling Applied X/Y bonus credits`
- `lastBonusRun.json` should grow a `balanceSnapshots[<newTokenKey>]` section.
- Confirm `batchHandleAction` transactions succeed on STRATO (no Failure status).

> **Note:** If you see `BonusUtils Skipped N users because bonus token direct payout is not initialized`, step 2 didn't land — re-check the vote.

---

## Remove a bonus

### 1. Drain pending credits first

Inspect `lastBonusRun.json` for a `pendingCredits[]` entry referencing the token (match on `sourceContract`). If any exist, they were computed in a prior cycle but failed to post and are still being retried. Either:

- Wait for the next successful bonus cycle to drain them, or
- Manually edit `lastBonusRun.json` to remove those entries if you explicitly want to forfeit them.

> **Warning:** Skipping this step will cause the service to keep re-submitting credits for the removed token until the direct-payout activity is also disabled on-chain (step 3).

### 2. Remove the config entry

Delete the object from [`src/infra/config/bonusTokenConfig.json`](../src/infra/config/bonusTokenConfig.json) and redeploy. On the next successful bonus cycle, the service writes a new state that no longer contains `balanceSnapshots[<tokenKey>]` — the rolling snapshot history for that token is discarded.

### 3. (Optional) Disable the on-chain activity

> **Admin on-chain call**
>
> - **Contract:** Rewards proxy (`REWARDS_CONTRACT_ADDRESS`)
> - **Function:** `setEmissionRate(uint256 activityId, uint256 newEmissionRate)`
> - **Args:** `activityId` = the direct-payout activity id for this bonus token; `newEmissionRate` = `0`.

No-op for emission (direct-payout activities are already at 0), but it signals intent and makes admin history clear.

### 4. Verify

Bonus cycle logs should no longer reference the removed token, and `balanceSnapshots[<tokenKey>]` should disappear from `lastBonusRun.json` after the next successful cycle.

---

## Upgrade the Rewards contract

Run this when the deployed Rewards proxy doesn't yet support the boost model and you need to onboard a bonus token (or pick up any other newer contract features).

### 1. Check whether the upgrade is needed

Any successful `addOneTimeDirectPayoutActivity` call on the current deployment is the machine-checkable signal that the boost model is already in place. If such a call has succeeded, skip this operation.

### 2. Run the upgrade script

```bash
cd mercata/contracts
npm install
npm run upgrade -- \
  --proxy-address <rewards-proxy-address> \
  --contract-file BaseCodeCollection.sol \
  --contract-name Rewards \
  --constructor-args '{"initialOwner":"<ownerAddress>"}' \
  +OVERRIDE-CHECKS
```

### 3. Verify

After the upgrade, a test call to `addOneTimeDirectPayoutActivity` (Admin UI → Vote On Issues) should succeed. You can now proceed with [Add a bonus](#add-a-bonus).
