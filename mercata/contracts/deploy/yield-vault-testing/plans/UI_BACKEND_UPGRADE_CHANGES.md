# YieldVault UI/backend upgrade changes

## Backend

Update `mercata/backend/src/api/services/yieldVault.service.ts`:

- Widen `getVaultState()` to read `perSecondSavingsRate`, `lastAccrual`, `rewardDistributor`, `accrualInitialized`, and `accountedAssets`. Use the `/storage` pattern already used by `saveUsdst.service.ts` if upgraded proxy fields are not exposed as normal Cirrus columns.
- Add token allowance lookup for `rewardDistributor -> vault`.
- Reproduce the contract's projected pricing:

```text
economicAssets   = idleAssets + deployedAssets
reconciledAssets = accrualInitialized
    ? min(economicAssets, accountedAssets)
    : economicAssets
reconciledActive = max(reconciledAssets - totalClaimableAssets, 0)
strayAssets      = max(economicAssets - accountedAssets, 0)
targetAccrual    = reconciledActive × (rpow(rate, elapsed, 1e27) - 1e27) / 1e27
fundedAccrual    = min(targetAccrual, distributorBalance + strayAssets, distributorAllowance)
projectedActive  = reconciledActive + fundedAccrual
projectedRate    = totalShares == 0 ? 1e18 : projectedActive × 1e18 / totalShares
projectedFreeIdle = queueOpen ? 0 : max(projectedActive - deployedAssets, 0)
```

- Keep raw `totalAssets`, `idleAssets`, and realized `exchangeRate` for telemetry, but add:
  - `accountedAssets`
  - `reconciledAssets`
  - `projectedActiveAssets`
  - `projectedExchangeRate`
  - `pendingAccrual`
  - `pendingAccrualTarget`
  - `strayAssets`
  - `perSecondSavingsRate`
  - `lastAccrual`
  - `rewardDistributor`
  - `accrualInitialized`
- Calculate user `redeemableAssets`, `positionUsd`, pending-withdrawal estimates, `maxWithdraw`, and `maxRedeem` from `projectedActive`/`projectedFreeIdle`, not raw live assets.
- Use reconciled/projected share value in `oracle.helper.ts` for YieldVault token and carry-vault USD prices; otherwise donations or pending funded accrual will misprice portfolio balances.
- Use reconciled assets for displayed TVL. Add projected TVL separately if desired.
- Preserve the existing strategy APY. If the configured savings rate is displayed, expose it as a separate funded target APY—not a guaranteed APY or strategy-return replacement.
- Default missing upgrade fields to neutral values so the backend supports a mixed rollout of upgraded and old vaults.

No changes are required to existing deposit, redeem-or-queue, claim, or user endpoint payloads.

## UI

Update `YieldVaultContext.shared.ts` with the new backend fields and matching safe defaults.

Update `EarnYieldVault.tsx`:

- Display `projectedExchangeRate` as the actionable share rate; optionally label the existing rate as realized.
- Replace locally reconstructed `totalAssets - totalClaimableAssets` previews with `projectedActiveAssets`.
- Use backend-provided projected `redeemableAssets`, `maxWithdraw`, `maxRedeem`, and pending-withdrawal estimates.
- Optionally show funded pending accrual, target accrual, distributor funding status, and stray assets as secondary details.
- Continue refreshing vault/user state after deposit, redeem/queue, claim, and queue processing.

Transaction submission remains unchanged because the upgraded contract retains the existing user-facing method signatures.

## Administration

Only add backend/admin UI actions if these operations should be managed in-app:

- `setRewardDistributor(address)`
- `setPerSecondSavingsRate(uint256)`
- `accrue()`—owner-only and unavailable while paused

Keep `initializeAccrual()` in the upgrade runbook rather than normal UI. Funding the distributor and approving each vault remain treasury operations.

## Verification

- Test fully funded, partially funded, unfunded, donation, queue, claimable, and paused states.
- Confirm UI previews equal transaction results for deposit, mint, withdraw, and redeem.
- Confirm portfolio/oracle share prices ignore donations and include currently fundable accrual.
- Verify old and upgraded vaults can coexist during dev, testnet, and production rollout.
