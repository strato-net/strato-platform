## Yield Vault Admin Operations

Owner/admin runbook for the ERC-4626 yield vaults (`YieldVault.sol`). Covers strategy
and capital operations, the withdrawal queue, and the funded savings-rate accrual
introduced with funded rewards.

### Vaults

| Key | Name | Asset | Share |
| --- | --- | --- | --- |
| `eth-carry` | ETH Yield Vault | ETH | carryETH |
| `wbtc-carry` | wBTC Carry Vault | wBTC | carryWBTC |
| `usdc-yield` | USDC Yield Vault | USDC | yieldUSDC |

All three appear in the `Vault` dropdown of the `Carry Vault Admin` section on the
`Admin` page.

### Where each control lives

Not every owner function is in the UI. Check this before planning a test session.

| Operation | Admin UI | REST | Contract |
| --- | --- | --- | --- |
| Approve / revoke strategy | yes | `POST /earn/yield-vault/:key/admin/strategy-approval` | `setStrategyApproval` |
| Deploy capital | yes | `POST /earn/yield-vault/:key/admin/deploy` | `deployCapital` |
| Process queue | yes | `POST /earn/yield-vault/:key/admin/process-queue` | `processQueue` |
| Min idle reserve | yes | `POST /earn/yield-vault/:key/admin/min-idle-bps` | `setMinIdleBps` |
| Report strategy loss | yes | `POST /earn/yield-vault/:key/admin/report-loss` | `reportStrategyLoss` |
| Return capital | no | `POST /earn/yield-vault/:key/admin/return` | `returnCapital` |
| Initialize accrual | no | none | `initializeAccrual` |
| Set reward distributor | no | none | `setRewardDistributor` |
| Set savings rate | no | none | `setPerSecondSavingsRate` |
| Settle accrual | no | none | `accrue` |
| Pause / unpause | no | none | `pause` / `unpause` |

Accrual configuration has no UI and no REST endpoint. It must be driven by direct
contract calls from the owner key.

### What still works while paused

Pause blocks entry and most admin mutation, but deliberately leaves unwind paths open.

- Blocked: `deposit`, `mint`, `withdraw`, `redeem`, `redeemOrQueue`, `processQueue`,
  `deployCapital`, `reportStrategyLoss`, `accrue`, `setPerSecondSavingsRate`,
  `setRewardDistributor`.
- Still allowed: `claim`, `cancelRequest`, `returnCapital`, `setStrategyApproval`,
  `setMinIdleBps`, `initializeAccrual`.

### Prerequisites

- Connect as the vault owner/admin.
- Select the correct vault from the `Vault` dropdown.
- For strategy actions, paste a full strategy address or click `Use Address` from
  `Active Strategy Holdings`.
- Read the status row across the top before acting: `Vault Address`, `Idle Assets`,
  `Max Deployable`, `Deployed Assets`, `Queue Status`. These are read-only cards showing
  live vault state, not inputs — the only control among them is the `Process Queue` button
  on the `Queue Status` card. `Max Deployable` also carries a sub-line showing either the
  current min idle reserve or `Deploy blocked: <reason>`.

---

### 1. Approve or revoke a strategy

Capital can only be deployed to an approved strategy.

1. Enter the full strategy address.
2. Click `Approve Strategy`, or `Revoke Strategy` to stop new deployments.

Expected result:
- The strategy can now receive deployed capital.
- If the strategy already has debt, it appears under `Active Strategy Holdings`.

Notes:
- Approval gates entry only. Revoking does **not** require the strategy to be debt-free,
  and `returnCapital` / `reportStrategyLoss` both keep working after a revoke, so you can
  cut off a misbehaving strategy immediately and unwind afterwards.
- A revoked strategy with outstanding debt is still counted in `deployedAssets` and
  therefore still in NAV. Use `reportStrategyLoss` to write it down.
- Approving the address currently set as `rewardDistributor` reverts with
  `YieldVault: strategy is distributor`. Strategies and the distributor must stay
  separate — see section 8.

### 2. Deploy capital

1. Read the value on the `Max Deployable` status card.
2. In `Capital Movement`, enter an amount at or below `Max Deployable`.
3. Click `Deploy Capital`.

Expected result:
- `Idle Assets` decreases, `Deployed Assets` increases, `Current strategy debt` increases.
- The strategy appears or updates under `Active Strategy Holdings`.
- Share price does not change: this moves idle into deployed, both of which are in NAV.

Common blockers:
- `Deploy blocked: Withdrawal queue is open` — any open queue forces `maxDeploy()` to 0.
- `Deploy blocked: Idle reserve requirement reached`
- Strategy not approved, or amount exceeds `Max Deployable`.

### 3. Process the withdrawal queue

1. Read the `Queue Status` card, which shows queued shares plus `Claimable`.
2. If queued shares exist and free idle assets are available, click `Process Queue` on that
   same card.

Expected result:
- Queued withdrawals are priced and reserved, `Claimable` increases, queued shares drop.
- Once the queue clears, deploys can resume.

Notes:
- Processing moves assets into a reserved claimable state. It does not send them to users.
- The UI submits `maxRequests: 50` and `maxAssets` equal to current free idle. Large
  queues may need several passes.
- The button is enabled only when a queue is open and free idle assets exist.
- Processed claimable assets are carved out of the accrual base, so a reserved claim stops
  earning the savings rate at the moment it is processed.

### 4. Claim processed withdrawals

Tested from the user-facing vault page, not the admin page.

1. Open the vault page as the user with the queued withdrawal.
2. After the admin has processed the queue, click `Claim`.

Expected result:
- Claimable assets transfer to the user and `Claimable Now` returns to zero.
- Share price is unchanged: a claim reduces idle and `totalClaimableAssets` by the same
  amount, so active assets stay flat.

### 5. Update min idle reserve

1. Enter a new `Min Idle Bps` value (0 - 10000).
2. Click `Save Min Idle`.

Expected result:
- The reserve requirement updates and `Max Deployable` may change immediately.

### 6. Report strategy loss

Use only to write down permanent loss.

1. Select or enter the strategy address.
2. Enter the loss amount (must not exceed current strategy debt).
3. Click `Report Strategy Loss`.

Expected result:
- Strategy debt and `Deployed Assets` decrease.
- Share price drops accordingly — this is a realized write-down against holders.

### 7. Return capital

No admin UI control. Two steps, and the first is not something the vault can do for you:

1. The strategy address must approve the vault to pull the underlying asset.
2. The owner calls `returnCapital(from, assets)`, or
   `POST /earn/yield-vault/:key/admin/return` with `{ strategy, assets }`.

Expected result:
- Idle rises by `assets`; debt and `deployedAssets` fall by the principal portion.
- Any excess over principal is realized profit and raises share price.

Notes:
- Requires only `strategyDebt[from] > 0`, not current approval.
- Works while paused. Profit returned during a pause is excluded from the accrual
  interval that was already running, and enters the base afterwards.

---

### 8. Funded savings-rate accrual

The vault can publish a fixed savings rate that is **funded by a reward distributor**
rather than generated by NAV growth. On each accrual the vault computes a target from the
checkpointed base and elapsed time, then pulls up to that amount from the distributor via
`transferFrom`. Strategy yield is expected to flow into the distributor, which then funds
the rate.

Accrual is opt-in and inert until all three of these are set: initialized, a rate above
flat, and a non-zero distributor.

#### 8.1 One-time initialization

Call `initializeAccrual()`. This sets the rate to `1e27` (flat, no accrual), stamps
`lastAccrual`, and checkpoints `accrualBaseAssets` to current active assets. It reverts on
a second call. Safe to call while paused.

#### 8.2 Set the reward distributor

Call `setRewardDistributor(address)`. Guards:

- Cannot be the vault itself.
- Cannot be an approved strategy (`YieldVault: distributor is strategy`).
- Cannot hold strategy debt (`YieldVault: distributor has strategy debt`).

These guards exist because strategies grant the vault an allowance so `returnCapital`
works. Without them, pointing the distributor at a strategy would pull deployed principal
and book it as fresh yield while the debt stayed on the books, silently inflating NAV.

Switching distributors settles the elapsed interval against the **old** distributor first,
then starts a new interval, so an incoming distributor is never charged for history.
Setting `address(0)` disables accrual.

#### 8.3 Set the savings rate

Call `setPerSecondSavingsRate(rate)` with a per-second ray:

- `1e27` = flat, no accrual (the floor; lower reverts).
- `1000000021979553151239153027` = `MAX_PER_SECOND_SAVINGS_RATE` = 100% APY (the ceiling).

The old rate is settled before the new one takes effect. Convert with
`APY = (rate / 1e27) ^ 31536000 - 1`.

#### 8.4 Fund the distributor

The distributor must hold the underlying asset **and** approve the vault as spender. Each
accrual is capped by `min(target, distributor balance, allowance)`.

**There is no backlog.** If the distributor is short, only the available amount is
credited, `lastAccrual` still advances, and the shortfall is forfeited permanently.
Topping up later does not recover it. Keep the distributor funded ahead of the published
rate.

#### 8.5 Settling accrual

Accrual settles automatically on `deposit`, `mint`, `withdraw`, `redeem`, `redeemOrQueue`,
`processQueue`, `returnCapital`, and `reportStrategyLoss`. `accrue()` is available for an
explicit settle on a quiet vault.

Failures in the distributor's token calls are swallowed: if `balanceOf`, `allowance`, or
`transferFrom` reverts or returns false, accrual credits zero and the user operation still
succeeds. A broken distributor degrades yield, it does not brick deposits or withdrawals.

#### 8.6 Pause behaviour

Pause does **not** stop the accrual meter. `lastAccrual` freezes, and the first accrual
after unpause charges the distributor for the entire paused window. Because
`setPerSecondSavingsRate` and `setRewardDistributor` are both blocked while paused, they
cannot be used to stop the meter mid-pause.

To actually stop accrual during an incident, revoke the distributor's allowance or drain
its balance. Both are token-side actions and work while the vault is paused.

#### 8.7 Monitoring

- `pendingAccrual()` returns `(targetAmount, fundedAmount)`. Any gap means underfunding.
- `projectedExchangeRate()` is the rate including currently funded pending accrual.
- The `Accrued(distributor, targetAmount, creditedAmount)` event records every settle.
  Alert when `creditedAmount < targetAmount`.
- Alert on non-zero `strategyDebt` for addresses where `approvedStrategies` is false —
  there is no on-chain strategy list, so revoked-but-indebted strategies are only visible
  through this mapping and the `CapitalDeployed` / `CapitalReturned` events.

Note that the published APY on Earn and the dashboard is derived from the configured rate,
not from what was actually funded, so a dry distributor keeps advertising the full rate
until the monitoring above catches it.

---

### Recommended test sequence

1. Approve a strategy.
2. Deploy a small amount of capital.
3. `initializeAccrual`, set a distributor, fund and approve it, set a rate.
4. Let time pass, confirm `pendingAccrual()` target equals funded, then `accrue()`.
5. Confirm share price rose and the distributor balance fell by the credited amount.
6. Submit a user withdrawal large enough to queue.
7. Process the queue from admin, then claim from the user page.
8. Return capital with profit, confirm share price rose.
9. Optionally report a small strategy loss.

### Quick sanity checklist

- `Max Deployable` drops after a deploy; `Deployed Assets` matches strategy debt growth.
- An open queue blocks new deploys.
- `Process Queue` moves value into `Claimable`; the user can then claim.
- Claiming does not move share price.
- Loss reporting reduces debt and deployed assets, and lowers share price.
- `accrue()` raises share price and reduces the distributor's balance by the same amount.
- An underfunded distributor credits a partial amount and never catches up later.
- A paused vault still bills the distributor for the paused window on the next accrual.
- The distributor is never an approved strategy and never holds strategy debt.
