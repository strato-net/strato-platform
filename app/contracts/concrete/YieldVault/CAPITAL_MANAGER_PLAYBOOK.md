# YieldVault — Capital Manager Playbook

How to move value in and out of the vault under the funded-accrual model.

**Core rule:** the vault's exchange rate is a *promise*, not a measurement. It grows at exactly
`perSecondSavingsRate`, funded by the `rewardDistributor`. Strategy P&L never touches the share
price — it only determines whether the promise stays funded.

## Roles

| Role | Address | Responsibility |
|---|---|---|
| `owner` | vault owner | Calls every vault function below. |
| strategy | approved via `setStrategyApproval` | Receives deployed capital, carries `strategyDebt`. |
| `rewardDistributor` | **must differ from every strategy** | Holds the token buffer that funds accrual. |

`deployCapital` rejects `to == rewardDistributor`; `setRewardDistributor` rejects an address with
open `strategyDebt`. Keep them separate.

## One-time setup

1. `setStrategyApproval(strategy, true)`
2. `setRewardDistributor(distributor)` — **do this before anything else touches the vault.** The
   stray-asset sweep reverts when the distributor is unset, which bricks deposits, withdrawals,
   claims, and deploys.
3. From the distributor: `IERC20(asset).approve(vault, <large>)` — accrual pulls via `transferFrom`.
4. `setPerSecondSavingsRate(rate)` — ray-scaled (`1e27` = 0%), max `1000000021979553151239153027` (100% APY).

## Moving value

### Out — deploy

```
deployCapital(strategy, amount)
```

Blocked unless: strategy approved, `amount <= maxDeploy()`, **withdrawal queue empty**, not paused.
`maxDeploy() == idle − totalClaimableAssets − minIdleRequirement`, and is `0` whenever `queueHead != 0`.

### In — return principal

The strategy must first `approve(vault, amount)`.

```
returnCapital(strategy, strategyDebt[strategy])   // EXACTLY the debt — never more
```

Works while paused. Requires `strategyDebt[strategy] > 0`.

> ### ⚠️ Never over-return
> `returnCapital` splits anything above the debt into `realizedProfit`, credits it to the vault, and
> raises the `accountedAssets` high-water mark. That excess is priced into shares **permanently**,
> and every future accrual target compounds on the inflated base — raising your funding obligation
> forever. There is no undo. Compute the amount from `strategyDebt`; never let a human type it.

### In — profit

Send it to the **`rewardDistributor`**, not the vault, and not through `returnCapital`.

| Channel | Result |
|---|---|
| Transfer to `rewardDistributor` | ✅ Correct. Funds accrual, capped at target. |
| Transfer directly to the vault | ✅ Safe. Swept to the distributor on the next accruing call. |
| `returnCapital(strategy, principal + profit)` | ❌ Permanent, unrecoverable rate inflation. |

## Losses

Losses do not disappear by not reporting them. Two paths, in order of preference:

1. **Make whole (preferred).** Top up the strategy from treasury and `returnCapital` the full
   original debt. **This only works while `strategyDebt > 0`.** Once debt hits zero the door closes
   permanently — the stray sweep means you cannot donate principal to the vault by any other route,
   and distributor balance cannot plug a principal hole (accrual is capped at `targetAmount`).
2. **Recognize it.** `reportStrategyLoss(strategy, loss)`. This drops the exchange rate and breaks
   the APY curve — correctly. Use it when the loss is genuinely unrecoverable.

Doing neither leaves phantom value in `deployedAssets`: the vault displays the promised rate while
insolvent, and `processQueue` overpays early exiters at the inflated rate. First-mover advantage,
tail holders eat it. Never sit in this state.

## Keeping the peg funded

`accrue()` is `onlyOwner` and `whenNotPaused`. It credits
`min(distributorBalance, allowance, targetAmount)`.

> ### ⚠️ Shortfalls never catch up
> `lastAccrual` advances to `block.timestamp` **before** the funding check. Any shortfall — even
> partial — is lost forever. There is no accumulator and no catch-up. The APY is exact only if
> funding is sufficient at *every* accrue.

Monitoring:

- `pendingAccrual()` → `(targetAmount, fundedAmount)`. **`fundedAmount < targetAmount` means the peg
  is about to slip.** Top up the distributor before calling anything that accrues.
- The `Accrued(distributor, targetAmount, creditedAmount)` event confirms after the fact:
  `credited < target` is a permanent slip.
- Runway in seconds, exact: `ln(1 + usable / activeAssets) / ln(perSecondSavingsRate / 1e27)`,
  where `usable = min(distributorBalance, allowance)`.

Two more traps:

- **Long pause.** Time keeps accruing while `accrue()` is blocked. Unpausing triggers one lump
  compounded demand — pre-fund the distributor before unpausing.
- **Frequent accrual on low-decimal assets.** `targetAmount` truncates toward zero while
  `lastAccrual` still advances. With small TVL and 8-decimal assets, don't accrue on a tight loop.

## Economics

The accrual target is charged on **100% of active assets**, but only the deployed portion earns:

```
required strategy yield = target APY ÷ (deployedAssets / activeAssets)
```

At an 8% target with 70% deployed, the strategy must earn ~11.4% to be self-funding. Idle capital is
now a direct, compounding cost on the distributor — not merely a lower blended yield.

## Routine cycle

1. Check `maxDeploy()` and that the queue is clear → `deployCapital(strategy, amount)`.
2. Run the strategy.
3. Strategy `approve(vault, strategyDebt)` → `returnCapital(strategy, strategyDebt)` — exact.
4. Send profit to `rewardDistributor`.
5. Confirm `pendingAccrual()` shows `funded == target`, then `accrue()`.
