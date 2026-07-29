# Deposit-to-Withdrawal Transactions Affecting Assets Received

## Scope

Assumes a standard ERC-20 asset and no contract upgrade. For a full-share exit, the relevant price is:

`assets = floor(user shares × projected active assets / total share supply)`

An instant `redeem` fixes the amount during that transaction. A queued redemption fixes the amount only when `processQueue` burns each full or partial share amount; `claim` only transfers the amount already fixed.

## Transactions that can directly change the amount

### Funded yield accrual

`accrue`, `deposit`, `mint`, `withdraw`, `redeem`, `redeemOrQueue`, `processQueue`, `setPerSecondSavingsRate`, `setRewardDistributor`, `returnCapital`, and `reportStrategyLoss` call `_accrue`.

If elapsed yield is funded by the reward distributor, `_accrue` transfers assets into the vault without minting shares. This increases assets per share and therefore the user's withdrawal amount.

Related asset-token transactions also matter:

- Transfers into or out of the reward distributor change available accrual funding.
- The distributor's approval to the vault changes how much accrual can be funded.
- A direct transfer to the vault is treated as stray, not an immediate donation to holders. It is removed to the reward distributor on reconciliation and can only benefit holders later through funded accrual.

### Yield configuration

- `setPerSecondSavingsRate` accrues at the old rate, then changes future accrual.
- `setRewardDistributor` accrues from the old distributor, then changes the source of future funding.

### Strategy result

- `returnCapital`: returned principal is value-neutral; any amount above strategy debt is realized profit and increases assets per share.
- `reportStrategyLoss`: reduces deployed assets without burning shares, decreasing assets per share.

### Other ERC-4626 entries and exits

- `deposit` / `mint`: add assets and mint shares at the current price. They are proportionate except for integer rounding, whose dust benefits existing holders.
- `withdraw` / `redeem`: remove assets and burn shares at the current price. They are proportionate except for integer rounding, whose dust remains for holders.
- `processQueue`: burns queued shares and reserves assets at the then-current price. Processing is proportionate except for rounding. For the user, this transaction fixes the claimable amount; partial processing can fix different portions at different prices.

### User share transfers

- `transfer` / `transferFrom` of vault shares changes how many shares the user owns and can redeem.
- `approve` alone does not change the amount, but permits a spender to transfer, redeem, withdraw, or queue the user's shares.

## Transactions that affect route or timing, and can therefore indirectly affect the amount

- `deployCapital`: does not change total economic assets, but reduces idle liquidity and can force a later exit into the queue.
- `returnCapital` of principal: does not change total economic assets, but restores idle liquidity and can enable withdrawal or queue processing.
- `requestRedeem` / queued `redeemOrQueue`: locks shares but does not fix their asset value. The amount continues to move until processing.
- Other users' queue requests: block instant withdrawals and can delay the user's processing.
- `cancelRequest`: does not change price, but can advance or leave the queue and therefore alter processing time.
- `processQueue` for earlier users: consumes free idle and advances the queue; this can change when the user's price is fixed.
- `pause` / `unpause`: do not change price directly, but can delay exit or processing while time-based funded accrual continues to accumulate.

## Transactions with no effect after pricing is fixed

Once the user's shares have been processed into `claimableAssets`, later deposits, withdrawals, accruals, profits, losses, queue operations, and share transfers do not change that fixed amount. `claim(receiver)` only transfers it. Claims by other users likewise do not change the user's fixed claim.
