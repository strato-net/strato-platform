# Tools Reference

Complete reference for all Griphook MCP tools. Tools are organized by category.

## Data Snapshots

Aggregate views that fetch multiple related endpoints in a single call.

### strato.tokens
Fetch token catalog, user balances, voucher balance, and earning assets.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | `string` | - | Status filter (e.g., `eq.2`) |
| `includeStats` | `boolean` | `false` | Include token statistics |
| `includeEarningAssets` | `boolean` | `true` | Include earning assets |
| `includeBalances` | `boolean` | `true` | Include user balances |
| `tokenAddress` | `string` | - | Fetch specific token and balance history |
| `poolAddress` | `string` | - | Fetch pool price history |

**Returns:** `{ tokens, balances?, voucherBalance?, stats?, earningAssets?, balanceHistory?, poolPriceHistory? }`

---

### strato.swap
Inspect swap pools, supported tokens, LP positions, and history.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tokenA` | `string` | - | Token A address for pairable pools |
| `tokenB` | `string` | - | Token B address for pairable pools |
| `poolAddress` | `string` | - | Specific pool to fetch |
| `includePositions` | `boolean` | `false` | Include LP positions |
| `includeHistory` | `boolean` | `false` | Include swap history |
| `historyLimit` | `number` | - | History pagination limit |
| `historyPage` | `number` | - | History pagination page |

**Returns:** `{ pools, swappableTokens, pairableTokens?, poolsForPair?, pool?, history?, lpPositions? }`

---

### strato.lending
Fetch lending pools, loans, liquidity, collateral, and safety module state.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeInterest` | `boolean` | `false` | Include interest rates |
| `includeNearUnhealthy` | `boolean` | `false` | Include near-unhealthy loans |

**Returns:** `{ pools, liquidity, collateral, loans, liquidatable, safety, nearUnhealthy?, interest? }`

---

### strato.cdp
Fetch CDP vaults, assets, debt metrics, and interest/stats.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `asset` | `string` | - | Specific asset to inspect |
| `includeStats` | `boolean` | `true` | Include CDP statistics |
| `includeInterest` | `boolean` | `false` | Include interest data |

**Returns:** `{ vaults, assets, badDebt, vault?, assetConfig?, assetDebt?, stats?, interest? }`

---

### strato.bridge
Fetch bridge network configs, bridgeable tokens, and transaction history.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `chainId` | `string` | - | External chain ID |
| `txType` | `"deposit" \| "withdrawal"` | - | Transaction type to fetch |
| `limit` | `number` | - | Pagination limit |
| `offset` | `number` | - | Pagination offset |
| `context` | `string` | - | Pass `"admin"` for admin context |
| `includeSummary` | `boolean` | `true` | Include withdrawal summary |

**Returns:** `{ networks, bridgeableTokens?, transactions?, withdrawalSummary? }`

---

### strato.rewards
Fetch rewards overview, activities, pending balances, and leaderboard.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userAddress` | `string` | - | User address for activity data |
| `includeLeaderboard` | `boolean` | `false` | Include leaderboard |
| `leaderboardLimit` | `number` | - | Leaderboard pagination limit |
| `leaderboardOffset` | `number` | - | Leaderboard pagination offset |

**Returns:** `{ pending, overview, activities, pools, userActivities?, leaderboard? }`

---

### strato.admin
Fetch current user profile, admins, open issues, and contract search.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | `string` | - | Contract search query |
| `contractAddress` | `string` | - | Contract address for details |
| `includeConfig` | `boolean` | `true` | Include platform config |

**Returns:** `{ me, admins, openIssues, searchResults?, contractDetails?, config? }`

---

### strato.events
Query chain events through the backend search interface.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `order` | `string` | - | Order clause (e.g., `block_timestamp.desc`) |
| `limit` | `string` | - | Result limit |
| `offset` | `string` | - | Result offset |

---

### strato.protocol-fees
Fetch aggregated or per-protocol revenue summaries.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `protocol` | `string` | - | Protocol filter: `cdp`, `lending`, `swap`, `gas` |
| `period` | `string` | - | Period: `daily`, `weekly`, `monthly`, `ytd`, `allTime` |

---

### strato.rpc
Proxy a JSON-RPC request through the backend RPC router.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chainId` | `string` | Yes | Numeric chain ID |
| `payload` | `object` | Yes | Raw JSON-RPC payload |

**Example:**
```json
{
  "chainId": "1",
  "payload": {
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }
}
```

---

## Swap Actions

### strato.swap.create-pool
Create a new swap pool between two tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tokenA` | `string` | Yes | Token A address |
| `tokenB` | `string` | Yes | Token B address |
| `isStable` | `boolean` | No | Whether pool is stable (default: `false`) |

---

### strato.swap.add-liquidity
Add dual-sided liquidity to a pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool address |
| `tokenBAmount` | `string` | Yes | Amount of token B to deposit |
| `maxTokenAAmount` | `string` | Yes | Maximum token A to pair |
| `stakeLPToken` | `boolean` | No | Auto-stake LP tokens |

---

### strato.swap.add-liquidity-single
Add single-sided liquidity to a pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool address |
| `singleTokenAmount` | `string` | Yes | Amount of input token |
| `isAToB` | `boolean` | Yes | Direction (true = token A) |
| `stakeLPToken` | `boolean` | No | Auto-stake LP tokens |

---

### strato.swap.remove-liquidity
Remove liquidity from a pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool address |
| `lpTokenAmount` | `string` | Yes | LP tokens to redeem |
| `includeStakedLPToken` | `boolean` | No | Include staked LP tokens |

---

### strato.swap.execute
Execute a swap within a pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `poolAddress` | `string` | Yes | Pool address |
| `isAToB` | `boolean` | Yes | Swap direction |
| `amountIn` | `string` | Yes | Input amount |
| `minAmountOut` | `string` | Yes | Minimum output (slippage protection) |

---

## Token Actions

### strato.tokens.create
**Admin:** Create a new token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Token name |
| `symbol` | `string` | Yes | Token symbol |
| `initialSupply` | `string` | Yes | Initial supply |
| `description` | `string` | Yes | Token description |
| `customDecimals` | `number` | Yes | Decimal places |
| `images` | `string[]` | No | Image URLs |
| `files` | `string[]` | No | File URLs |
| `fileNames` | `string[]` | No | File names |

---

### strato.tokens.transfer
Transfer tokens to another address.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | `string` | Yes | Token contract address |
| `to` | `string` | Yes | Recipient address |
| `value` | `string` | Yes | Amount to transfer |

---

### strato.tokens.approve
Approve allowance for a spender.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | `string` | Yes | Token contract address |
| `spender` | `string` | Yes | Spender address |
| `value` | `string` | Yes | Allowance amount |

---

### strato.tokens.transfer-from
Transfer tokens on behalf of another address (requires approval).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | `string` | Yes | Token contract address |
| `from` | `string` | Yes | Source address |
| `to` | `string` | Yes | Recipient address |
| `value` | `string` | Yes | Amount to transfer |

---

### strato.tokens.set-status
**Admin:** Update token status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | `string` | Yes | Token contract address |
| `status` | `number` | Yes | Status: 1=PENDING, 2=ACTIVE, 3=LEGACY |

---

## Lending Actions

### strato.lending.supply-collateral
Supply collateral to the lending pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `amount` | `string` | Yes | Amount to supply |

---

### strato.lending.withdraw-collateral
Withdraw supplied collateral.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `amount` | `string` | Yes | Amount to withdraw |

---

### strato.lending.withdraw-collateral-max
Withdraw maximum available collateral for an asset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |

---

### strato.lending.borrow
Borrow USDST from the lending pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to borrow |

---

### strato.lending.borrow-max
Borrow the maximum available USDST based on collateral.

*No parameters required.*

---

### strato.lending.repay
Repay outstanding debt.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to repay |

---

### strato.lending.repay-all
Repay all outstanding debt.

*No parameters required.*

---

### strato.lending.deposit-liquidity
Deposit into the lending pool as a liquidity provider.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to deposit |
| `stakeMToken` | `boolean` | Yes | Whether to stake mTokens |

---

### strato.lending.withdraw-liquidity
Withdraw from the lending pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to withdraw |
| `includeStakedMToken` | `boolean` | No | Include staked mTokens |

---

### strato.lending.withdraw-liquidity-all
Withdraw all available liquidity.

*No parameters required.*

---

### strato.lending.safety-stake
Stake USDST into the safety module.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to stake |
| `stakeSToken` | `boolean` | Yes | Whether to stake sTokens |

---

### strato.lending.safety-cooldown
Begin safety module cooldown period.

*No parameters required.*

---

### strato.lending.safety-redeem
Redeem sUSDST shares from the safety module.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sharesAmount` | `string` | Yes | Shares to redeem |
| `includeStakedSToken` | `boolean` | Yes | Include staked sTokens |

---

### strato.lending.safety-redeem-all
Redeem all sUSDST shares.

*No parameters required.*

---

### strato.lending.liquidate
Liquidate an unhealthy lending position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Loan ID |
| `collateralAsset` | `string` | No | Collateral asset to seize |
| `repayAmount` | `string` | No | Amount to repay |
| `minCollateralOut` | `string` | No | Minimum collateral received |

---

### strato.lending.configure-asset
**Admin:** Set lending parameters for an asset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `ltv` | `number` | Yes | Loan-to-value ratio |
| `liquidationThreshold` | `number` | Yes | Liquidation threshold |
| `liquidationBonus` | `number` | Yes | Liquidation bonus |
| `interestRate` | `number` | Yes | Interest rate |
| `reserveFactor` | `number` | Yes | Reserve factor |
| `perSecondFactorRAY` | `string` | Yes | Per-second factor (RAY) |

---

### strato.lending.sweep-reserves
**Admin:** Sweep protocol reserves.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | `string` | Yes | Amount to sweep |

---

### strato.lending.set-debt-ceilings
**Admin:** Set global and per-asset debt ceilings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetUnits` | `string` | Yes | Asset unit ceiling |
| `usdValue` | `string` | Yes | USD value ceiling |

---

### strato.lending.pause
**Admin:** Pause the lending pool.

*No parameters required.*

---

### strato.lending.unpause
**Admin:** Unpause the lending pool.

*No parameters required.*

---

## CDP Actions

### strato.cdp.deposit
Deposit collateral into a CDP vault.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `amount` | `string` | Yes | Amount to deposit |

---

### strato.cdp.withdraw
Withdraw collateral from a CDP vault.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `amount` | `string` | Yes | Amount to withdraw |

---

### strato.cdp.withdraw-max
Withdraw maximum safe collateral.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |

---

### strato.cdp.mint
Mint USDST against collateral.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Collateral asset |
| `amount` | `string` | Yes | USDST amount to mint |

---

### strato.cdp.mint-max
Mint maximum safe USDST.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Collateral asset |

---

### strato.cdp.repay
Repay USDST debt.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Collateral asset |
| `amount` | `string` | Yes | Amount to repay |

---

### strato.cdp.repay-all
Repay all USDST debt for an asset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Collateral asset |

---

### strato.cdp.liquidate
Liquidate an unhealthy CDP position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collateralAsset` | `string` | Yes | Collateral asset address |
| `borrower` | `string` | Yes | Borrower address |
| `debtToCover` | `string` | Yes | Debt amount to cover |

---

### strato.cdp.set-collateral-config
**Admin:** Set collateral parameters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `liquidationRatio` | `string` | Yes | Liquidation ratio |
| `liquidationPenaltyBps` | `number` | Yes | Liquidation penalty (bps) |
| `closeFactorBps` | `number` | Yes | Close factor (bps) |
| `stabilityFeeRate` | `string` | Yes | Stability fee rate |
| `debtFloor` | `string` | Yes | Minimum debt |
| `debtCeiling` | `string` | Yes | Maximum debt |
| `unitScale` | `string` | Yes | Unit scale |
| `isPaused` | `boolean` | Yes | Pause state |

---

### strato.cdp.set-collateral-config-batch
**Admin:** Set multiple collateral configs at once.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assets` | `string[]` | Yes | Asset addresses |
| `liquidationRatios` | `string[]` | Yes | Liquidation ratios |
| `liquidationPenaltyBpsArr` | `string[]` | Yes | Liquidation penalties |
| `closeFactorBpsArr` | `string[]` | Yes | Close factors |
| `stabilityFeeRates` | `string[]` | Yes | Stability fee rates |
| `debtFloors` | `string[]` | Yes | Debt floors |
| `debtCeilings` | `string[]` | Yes | Debt ceilings |
| `unitScales` | `string[]` | Yes | Unit scales |
| `pauses` | `boolean[]` | Yes | Pause states |

---

### strato.cdp.set-asset-paused
**Admin:** Toggle pause for a collateral asset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `isPaused` | `boolean` | Yes | Pause state |

---

### strato.cdp.set-asset-supported
**Admin:** Toggle asset support.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `supported` | `boolean` | Yes | Support state |

---

### strato.cdp.set-global-paused
**Admin:** Toggle global CDP pause.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `isPaused` | `boolean` | Yes | Pause state |

---

### strato.cdp.open-junior-note
Open a junior note position for bad debt coverage.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | `string` | Yes | Asset address |
| `amountUSDST` | `string` | Yes | USDST amount |

---

### strato.cdp.top-up-junior-note
Add USDST to an existing junior note.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amountUSDST` | `string` | Yes | USDST amount to add |

---

### strato.cdp.claim-junior-note
Claim junior note rewards.

*No parameters required.*

---

## Bridge Actions

### strato.bridge.request-withdrawal
Submit a withdrawal request to an external chain.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `externalChainId` | `string` | Yes | Target chain ID |
| `stratoToken` | `string` | Yes | STRATO token address |
| `stratoTokenAmount` | `string` | Yes | Amount to withdraw |
| `externalRecipient` | `string` | Yes | External recipient address |
| `targetStratoToken` | `string` | No | Target token on external chain |

---

### strato.bridge.request-auto-save
Request auto-save for a bridge transaction.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `externalChainId` | `string` | Yes | External chain ID |
| `externalTxHash` | `string` | Yes | External transaction hash |

---

## Rewards Actions

### strato.rewards.claim
Claim all pending CATA rewards from RewardsChef.

*No parameters required.*

---

### strato.rewards.claim-all-activities
Claim all rewards across all activities.

*No parameters required.*

---

### strato.rewards.claim-activity
Claim rewards for a specific activity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `activityId` | `number` | Yes | Activity ID |

---

## Admin Actions

### strato.admin.add-admin
Grant administrator access.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userAddress` | `string` | Yes | User address to grant admin |

---

### strato.admin.remove-admin
Revoke administrator access.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userAddress` | `string` | Yes | User address to revoke admin |

---

### strato.admin.vote
Cast an administrative vote.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | `string` | Yes | Target contract address |
| `func` | `string` | Yes | Function to call |
| `args` | `string[]` | Yes | Function arguments |

---

### strato.admin.vote-by-id
Cast a vote for an existing issue.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `issueId` | `string` | Yes | Issue ID |

---

### strato.admin.dismiss-issue
Dismiss a governance issue (proposer only, single-voter case).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `issueId` | `string` | Yes | Issue ID to dismiss |

---

## Oracle Actions

### strato.oracle.set-price
**Admin:** Set oracle price for an asset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | `string` | Yes | Token address |
| `price` | `string` | Yes | Price value (wei) |
