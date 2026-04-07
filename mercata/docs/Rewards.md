## Rewards

Purpose: Distributed incentives to participants (LPs, lenders, etc.).

Functional summary:
- Track time‑weighted balances and mint reward tokens on claim per configured factors.

Key contracts:
- RewardsManager.sol: Tracks balances and updates rewards on token movements.

Core flows:
- Accrual: Token transfers notify RewardsManager to update user accruals.
- Claim: Users claim accumulated rewards from Chef/Manager.

Mechanics:
- Tracks reward balances per eligible token and user. Accrual is time‑weighted by user balance vs total supply.
- `updateRewardsBalanceFor(token, user)` is called on token balance updates (Token hooks), rolling timestamps and balances.
- `rewardBalanceOf(user)` aggregates across eligible tokens into per‑rewardToken amounts using configured `rewardFactors` (defaults to 10% APY basis if unset).
- `claimRewardsFor(user)` mints due amounts in each reward token to the user.

Formulas:
- User accrual step (per eligible token):
  - `userAccum += userBalance × (t_now − t_user)`
  - `tokenAccum += totalSupply × (t_now − t_token)`
- Payout per reward token: `reward = userAccum / rewardFactor` (fallback factor ≈ 1e18 / (10% APY seconds)).


