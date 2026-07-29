# YieldVault funded-accrual changes

## Scope

This document describes only the source delta from [`YieldVaultOld.sol`](./YieldVaultOld.sol) to the current [`YieldVault.sol`](../../concrete/YieldVault/YieldVault.sol). Intermediate versions are out of scope. [`SaveUSDSTVault.sol`](../../concrete/Savings/SaveUSDSTVault.sol) is referenced only as the source of the funded-accrual pattern, not as the comparison baseline.

## Exact code-level delta

Relative to `YieldVaultOld.sol`, `YieldVault.sol`:

- Changes `locked` visibility from `private` to `internal` without changing storage or behavior.
- Appends five proxy-safe fields: `perSecondSavingsRate`, `lastAccrual`, `rewardDistributor`, `accrualInitialized`, and `accountedAssets`.
- Adds the maximum rate constant and accrual, configuration, and stray-removal events.
- Extends `initialize()` to initialize accrual for new vaults and adds `initializeAccrual()` for existing proxies.
- Adds `_accrue()` before pricing in `deposit()`, `mint()`, `withdraw()`, `redeem()`, `redeemOrQueue()`, and `processQueue()`.
- Adds `_accrue()` before strategy profit returns and loss write-downs so elapsed rewards use the pre-change asset base.
- Adds `_syncAccountedAssets()` after legitimate asset movement in deposits, mints, instant exits, claims, capital deployment, capital return, and loss reporting.
- Adds `_removeStrayAssets()` before protected pricing or value movement.
- Adds owner-only, unpaused `accrue()`, owner-only rate/distributor setters, `pendingAccrual()`, and `projectedExchangeRate()`.
- Makes the existing ERC-4626 conversions and instant-liquidity view use reconciled assets plus currently fundable pending accrual, so inherited previews and max-exit views match execution.
- Prevents the reward distributor from being the vault or an indebted strategy, and prevents capital deployment to the active distributor.
- Adds `nonReentrant` to `reportStrategyLoss()` because stray cleanup can transfer underlying tokens.
- Does not alter request creation, request cancellation, FIFO queue structure, claim reservation math, strategy debt math, or the existing `totalAssets()`/`activeAssets()` formulas.

## Summary

The original vault could gain assets through deposits, direct transfers, or profitable strategy returns. The new vault adds a transaction-triggered reward path:

1. A configured per-second rate determines a target reward.
2. The vault checks the reward distributor's underlying-token balance and allowance.
3. It pulls the fundable amount into idle assets.
4. No shares are minted and `deployedAssets` is unchanged.
5. The added idle assets increase `activeAssets()` and the share exchange rate.

This is an additive funded target rate, not a guaranteed APY or a strategy-return top-up.

The vault also tracks `accountedAssets = idle balance + deployedAssets` after legitimate state changes. Before protected execution, excess live assets are treated as donations and transferred to the reward distributor.

## Logic copied and adapted from SaveUSDSTVault

Copied concepts:

- `MAX_PER_SECOND_SAVINGS_RATE` and RAY precision (`1e27`).
- `perSecondSavingsRate`, `lastAccrual`, and `rewardDistributor`.
- `_rpow()` compounded-rate calculation.
- `_pendingAccrual()`, `_accrue()`, and explicit `accrue()`.
- `setPerSecondSavingsRate()` and `setRewardDistributor()`.
- `pendingAccrual()` and `projectedExchangeRate()`.
- Balance/allowance funding caps and no-backlog underfunding behavior.

YieldVault adaptations:

- Uses `activeAssets()` instead of SaveUSDST's `_managedAssets`.
- Uses `activeSupply()` instead of raw `totalSupply()`.
- Uses `asset()` instead of `assetToken`.
- Does not update separate managed-asset accounting: the received token balance automatically enters `idle + deployedAssets`.
- Excludes processed `totalClaimableAssets` from the reward base.
- Adds `nonReentrant` protection because accrual performs `transferFrom`.
- Adds `accrualInitialized` and a separate upgrade initializer for existing proxies.
- Adds an `accountedAssets` checkpoint used to remove unsolicited transfers before state-changing pricing.
- Restricts explicit `accrue()` to the owner while unpaused instead of copying SaveUSDST's permissionless access.
- Projects inherited ERC-4626 conversions from donation-reconciled assets plus currently fundable pending rewards.
- Keeps YieldVault's strategy debt and withdrawal queue unchanged.

Not copied:

- SaveUSDST's `_managedAssets` donation-resistant accounting.
- SaveUSDST's manual `recordRewardTransfer()`, `recoverStrayAssets()`, or token rescue functions. YieldVault instead removes stray assets automatically through existing wrappers.
- SaveUSDST's immediate-only withdrawal model.

## Accrual calculation

For elapsed time since `lastAccrual`:

```text
if live economic assets > accountedAssets:
    transfer the excess to rewardDistributor
accountedAssets = live economic assets after removal

growthFactor = rpow(perSecondSavingsRate, elapsed, 1e27)
targetAmount = activeAssets × (growthFactor - 1e27) / 1e27
fundedAmount = min(targetAmount, distributor balance, distributor allowance)
credited     = vault balance after transfer - vault balance before transfer
accountedAssets = live economic assets after legitimate movement
```

`lastAccrual` advances for the entire elapsed interval even when funding is zero or partial. Any unfunded difference is discarded rather than recorded as debt. If `transferFrom` reverts, the whole transaction—including the timestamp update—reverts.

This lightweight checkpoint does not replace YieldVault's existing accounting. It removes excess idle tokens before they can affect state-changing pricing or distributor payments, then synchronizes after legitimate value movement.

`accountedAssets` is gross economic accounting and includes processed claim liabilities. Rewards use `activeAssets()`, which subtracts `totalClaimableAssets`, so fixed claims do not continue earning.

## Affected flows

### Initialization and proxy upgrades

New deployment:

- `initialize()` now also initializes accrual.
- The initial rate is neutral (`1e27`), the distributor is unset, and `lastAccrual` starts at the current timestamp.

Existing proxy:

- The five new storage fields are appended after the old YieldVault fields.
- The owner calls one-time `initializeAccrual()` after upgrading.
- `initializeAccrual()` snapshots the existing gross `idle + deployedAssets` value into `accountedAssets`.
- Before migration, accrual helpers return zero so normal vault interactions remain usable.
- Rate/distributor setters reject calls until accrual is initialized.

New state:

- `perSecondSavingsRate`
- `lastAccrual`
- `rewardDistributor`
- `accrualInitialized`
- `accountedAssets`

The reentrancy-lock visibility changed from `private` to `internal` without changing its storage or runtime behavior.

### Explicit accrual

Only the owner can call `accrue()`, and the vault must be unpaused. This matches the access and pause gating used by `deployCapital()`.

Possible outcomes:

- Fully funded: the entire target enters idle assets.
- Partially funded: only the balance/allowance-limited amount enters.
- Unfunded: zero enters, an `Accrued(..., 0)` event is emitted, and the elapsed reward is skipped.
- Flat rate, no shares, or no distributor: zero enters and the clock advances, provided no stray excess requires a distributor.
- Donated excess: it is removed before target calculation and cannot inflate distributor payment.

Internal accrual can still run through owner-authorized functions that remain callable while paused, including `returnCapital()` and the rate/distributor setters.

### Deposit

Old:

- `deposit()` priced shares from the currently realized exchange rate.

New:

- `_accrue()` runs before `previewDeposit()`.
- Any donation is removed before pricing.
- Existing holders receive any funded elapsed reward before the newcomer is priced.
- Inherited `previewDeposit()` uses the same donation-reconciled, fundable projected asset base as execution.

New funded-accrual guarantee:

- A depositor cannot share in fundable rewards accumulated before their deposit merely because nobody called `accrue()` first.

### Mint

Old:

- `mint()` calculated required assets from the currently realized exchange rate.

New:

- `_accrue()` runs before `previewMint()`.
- Any donation is removed before pricing.
- Minting the requested shares may require more assets after funded accrual raises the exchange rate.
- Inherited `previewMint()` projects that funded accrual and uses the same rounding as execution.

### Withdraw

Old:

- `withdraw()` checked liquidity and calculated shares against realized assets.

New:

- `_accrue()` runs before `maxWithdraw()` and `previewWithdraw()`.
- Any donation is removed before pricing.
- Funded accrual can increase the owner's asset claim and idle liquidity before pricing.
- Withdrawing a fixed asset amount may burn fewer shares.
- `maxWithdraw()` and inherited `previewWithdraw()` use the same projected/reconciled basis.

If an open queue still makes `maxWithdraw()` zero, the transaction reverts and its attempted accrual also reverts atomically.

### Redeem

Old:

- `redeem()` valued shares against realized assets.

New:

- `_accrue()` runs before `maxRedeem()` and `previewRedeem()`.
- Any donation is removed before pricing.
- Redeemed shares include fundable elapsed rewards.
- A fixed share amount may return more underlying.
- `maxRedeem()` and inherited `previewRedeem()` use the same projected/reconciled basis.

### Redeem-or-queue

Old:

- The immediate-versus-queue decision used pre-existing idle liquidity and share value.

New:

- `_accrue()` runs before share pricing and the liquidity decision.
- Any donation is removed before pricing or the liquidity decision.
- Newly funded idle assets can turn a would-be queued redemption into an immediate redemption.
- If a queue is already open, existing FIFO protection still blocks instant exits.

New funded-accrual guarantee:

- `redeemOrQueue()` cannot decide using stale, fundable pre-accrual liquidity.

### Queue processing

Old:

- `processQueue()` priced queued shares and reserved existing unclaimed idle assets.

New:

- `_accrue()` runs before calculating available idle assets or pricing queued shares.
- Any donation is removed before queue liquidity and pricing are calculated.
- Unprocessed queued shares participate in funded rewards until they are burned.
- Distributor funding becomes idle liquidity available to the FIFO queue.
- Shares are processed at the post-accrual exchange rate.
- Already processed `claimableAssets` remain fixed and are excluded from future accrual.

Unchanged:

- Processing remains owner-only and FIFO.
- Partial processing and `maxAssets` limits remain.
- Claiming transfers the already-fixed amount and does not accrue.

### Rate changes

`setPerSecondSavingsRate()` now:

1. Validates `1e27 <= newRate <= MAX_PER_SECOND_SAVINGS_RATE`.
2. Accrues the elapsed interval using the old rate.
3. Stores the new rate and resets `lastAccrual`.

New configuration guarantee:

- A rate change cannot retroactively apply the new rate to time elapsed under the old rate.

The configuration transaction itself may pull funds from the distributor.

### Distributor changes

`setRewardDistributor()` now:

1. Rejects the vault itself and any address with outstanding strategy debt.
2. If no distributor exists yet, temporarily installs the new distributor so pre-existing stray assets have a valid recipient.
3. Accrues against the old distributor when one exists; initial setup accrues against the new distributor.
4. Stores the new distributor.

New configuration guarantee:

- Switching distributors cannot silently move an already elapsed interval from the old distributor to the new one.
- Deployed principal cannot be pulled back and double-counted as funded yield.

The change transaction may debit the old distributor before switching.

### Views

`exchangeRate()` remains realized-only.

Projected and ERC-4626 views:

- `pendingAccrual()` returns the mathematical target and currently fundable amount.
- `projectedExchangeRate()` adds only the currently fundable pending amount.
- Inherited `previewDeposit()`, `previewMint()`, `previewWithdraw()`, and `previewRedeem()` route through projected conversion accounting.
- `maxWithdraw()` and `maxRedeem()` use projected, donation-reconciled instant liquidity.

New UX state:

- `projectedExchangeRate()` can be greater than `exchangeRate()` between accrual-triggering transactions.
- Standard ERC-4626 previews include the currently fundable post-accrual rate.
- Projection can fall if distributor balance or allowance falls; it is not a promise.
- Direct donations remain visible in raw `totalAssets()` and realized `exchangeRate()`, but pending/projected accrual, conversions, standard previews, and max-exit views reconcile them out.
- Projection also accounts for a donation that will be returned to an underfunded distributor before accrual.

## Invariants

### Preserved

- `totalAssets = idle balance + deployedAssets`.
- `activeAssets = totalAssets - totalClaimableAssets`.
- Accrual does not mint or burn shares.
- Accrual does not change `deployedAssets` or `strategyDebt`.
- Processed claim amounts do not participate in later gains or losses.
- An open queue still blocks instant withdrawals and capital deployment.
- Strategy profit/loss and queue accounting remain separate from reward configuration.

### Added or changed

- Successful accrual increases idle assets and `totalAssets` by the actual received balance delta.
- `credited <= targetAmount`, distributor balance, and distributor allowance.
- The exchange rate increases from accrual without requiring a strategy return.
- Entry, exit, and queue-processing prices settle fundable elapsed rewards first.
- Strategy profit and loss settle elapsed accrual before changing the reward base.
- Underfunded rewards create no vault liability and no future catch-up.
- Realized state changes only when a state-changing accrual trigger executes.
- Legitimate value-moving wrappers synchronize `accountedAssets` after completion.
- Excess over `accountedAssets` is transferred to the distributor.
- Without donations or untracked movement, `accountedAssets == idle balance + deployedAssets`.
- The reward distributor cannot be the vault or carry strategy debt, and `deployCapital()` cannot target it.

## Unchanged flows

These functions did not gain accrual hooks:

- `requestRedeem()`: escrows shares but does not price or burn them.
- `cancelRequest()`: returns escrowed shares.
- Strategy approval and idle-reserve configuration.
- Pause and unpause.

`claim()` and `deployCapital()` keep their original business behavior but now reconcile donations before movement and synchronize accounting afterward.

`returnCapital()` and `reportStrategyLoss()` additionally settle elapsed accrual before recognizing profit or loss, preventing ordering-dependent distributor payments.

## Accepted limitations

- Raw realized views such as `totalAssets()` and `exchangeRate()` remain based on live balances, so donations can temporarily distort them until a protected transaction removes the excess.
- The checkpoint assumes legitimate economic-asset changes pass through the wrapped YieldVault functions.
- Stray removal requires a configured reward distributor; if unset, a donated excess blocks protected execution until the owner configures one.
- The upgrade initializer treats every asset already present at migration time as legitimate; donations must therefore be removed before migration if they should not be included in the initial checkpoint.
- Pausing blocks explicit `accrue()`, but owner-authorized `returnCapital()` and configuration setters can still invoke internal accrual while paused.
- The capital manager's target rate is not enforced if distributor funding or allowance is insufficient.
- Funded rewards are general idle assets, not a dedicated withdrawal reserve; existing queue, reserve, and deployment rules govern their later use.

## Verification coverage

The YieldVault suite verifies:

- Virtual/live accounting alignment through deposit, mint, withdrawal, redemption, deployment, profit return, loss reporting, queue processing, claims, and funded accrual.
- Exact divergence after donations and exact realignment after cleanup.
- Donation cleanup during initial distributor setup, deposits, claims, deployment, and explicit accrual.
- Fair post-donation deposit pricing and prevention of donation-inflated distributor rewards.
- Preview/execution parity for deposits, mints, withdrawals, and redemptions with pending accrual and donations.
- Projected/reconciled `maxWithdraw()` and `maxRedeem()` behavior.
- Pre-profit and pre-loss accrual checkpointing.
- Owner-only and pause-gated explicit accrual.
- Distributor/strategy role-separation guards.
- Funded, underfunded, allowance-capped, multi-user, queue, rate-change, distributor-change, projection, and proxy-upgrade behavior.

Current result: `48 / 48` YieldVault tests pass.
