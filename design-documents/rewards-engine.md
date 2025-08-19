# New smart contract allowing users to earn CATA rewords

## Summary

We want to have a smart contract that allows our users to earn CATA rewards.

**Users should earn CATA when:**
- they deposit USDST in Lending Pool - more specifically USDST balance in
  lending pool
- they add assets to swap pool - more specifically swap pool balance

Currently the contract will allow earning CATA each time liquidity is provided
to the pools, however we want to design it to be flexible enough to:

- support not only CATA but also other reward tokens
- that in the future other actions other than liquidity added or removed from
  pools

The name of the smart contract will be `RewardsEngine`

## Capabilities

### Reward tokens managements (IMPLEMENTED)

  We want to manage tokens that will be rewarded to users.

  Functionality:

  - Add reward token
  - Remove reward token
  - Add reward tokens (batch operation that calls 'Add reward token' in a loop)
  - Remove reward tokens (batch operation that calls 'Remove reward token' in a
    loop)

### Multipliers management (PARTIALLY IMPLEMENTED)

  Because we have different `Reward tokens`, one `Action` can requires applying
  different multiplications per each reward.

  For example if we have two `Reward tokens`: CATA and BATA, we might want to
  have a multiplier we will call "USDTST multiplier" that will multiply the
  reward by 100 for CATA and only 50 for BATA.

  Those multipliers will be later referenced by name when dealing with `Actions`
  (see Action Management capability).

  We need to be able to manage those multipliers.

  Functionality:

  - Add multiplier
  - Remove multiplier
  - Add multipliers (bath operation)
  - Remove multipliers (bath operation)

  Both those actions intertwine with "Reward tokens management" and "Action
  management". When adding a multiplier we need to check that it provides a
  factor for every Reward token we have, and fail otherwise. When we remove a
  multiplier, we need to check that it is not referenced by other existing
  `Action` and fail otherwise.

  <!-- TODO: Add validation to prevent removing multipliers that are referenced by existing Actions (requires Action Management to be implemented first) -->

### Action Management (IMPLEMENTED)

  We want to store different `Action`s that can happen in the system and that
  will trigger rewards evaluation.

  For now we will support types types of actions:

  - Lending Liquidity
  - Swap Liquidity

  However we want the system to be extensible, so that other actions might be
  introduced in the future. Thus we need to have `Action` management, where
  actions are added and removed.

  Functionality:

  - Add Action
  - Remove Action

  `Action` will need to have following:
  - type of an action (e.g "Lending Liquidity", "Swap Liquidity")
  - the asset (token) on which it was triggered
  - the multiplier - factor to use when calculating a reward
  - owner - address that can trigger that action
  - createdAt - timestamp when the action was added

  For example, in a scenario where there is:
  - one Lending pool (USDST) address 0x001
  - one Swap Pool (USDST, ETH) 0x002
  - two multipliers: "USDST multiplier" & "Eth multiplier"

  The `RewardsEngine` will be given 3 actions:

  - "Lending Liquidity", USDST, "USDST multiplier", 0x001
  - "Swap Liquidity", USDST, "USDST multiplier", 0x002
  - "Swap Liquidity", Eth, "Eth multiplier", 0x002

  When adding an `Action` we must check that the tuple (`type` and `asset`) is
  unique, as its being used as a key for balances.

  Because solidity does not allow using tuples for keys in mappings, we most
  likely want to use approach with nested mapping.

  Thus `actions` should be mapping from `type` to mapping from `asset` to
  `action`.

### User Balance and time-based accrued rewards (IMPLEMENTED)

  We need to store user balances per each `Reward Token` per each `Action`.
  Time-based rewards accrue continuously based on differently per each action.

  We need to introduce new structure called `UserBalance` that will hold:
  - `balance`: a `uint`, accrued reward over time
  - `createdAt`: a `uint`, timestamp when `UserBalance` was created
  - `modifiedAt`: a `uint`, timestamp when balance was last modified
  - `lastSeenAmount`: a `unit` holding last seen amount for a given `Action`
    (this is only needed for feature "Estimate Accrued Reward")

  Note: When a UserBalance is first created for a given action/reward combination,
  if no previous balance exists, the initial `modifiedAt` should be set to the
  action's `createdAt` timestamp to properly calculate accrued rewards from when
  the action was first available.

  We need a field called `balances`.

  It should map from `action type` to mapping
    from `asset` to mapping
	   `rewardToken` to mapping
	        from `address` (user address) to `UserBalance`

  Because the `balances` are effectively a mapping from `Action` to
  `RewardBalance` to `UserBalance`, we must modify balances when `Action` is
  removed or added.

### Update rewards (IMPLEMENTED)

  We must introduce function `update` which will have the following
  parameters.

  - `actionType`: type of an `Action` that is triggering the update (string)
  - `assets`: an array of asset addresses
  - `amounts`: an array of amounts, each representing the liquidity amount before the current transaction
     The length of `assets` and `amounts` must be identical
  - `user`: an `address` of a user

  The function will identify `Action`s that are updated by matching `actionType` and each `asset`.
  Each `Action` has an `owner` and that `owner` must be the same as `msg.sender` (caller authorization).

  Then for each `Action`
     for each `Reward token`
	     find a user in `balances`
	     - we get the multiplier factor for the action's multiplier and the reward token
	     - we calculate time delta: how much time has passed since last update (`modifiedAt`)
	     - we calculate accrued value as `accrued = amount * multiplier_factor * time_delta`
           and we add that value to existing `balance` (`balance += accrued`)
	     - we update the `modifiedAt` with current timestamp
	     - we update the `lastSeenAmount` to the provided `amount`

  Key implementation details:
  - For first-time users, `modifiedAt` is initialized to the action's `createdAt` timestamp
  - The `amount` parameter represents the liquidity state before the current transaction
  - Rewards are always calculated using the provided `amount`, not the stored `lastSeenAmount`
  - User balances are created on-demand when first accessed

   The function returns a list of `CurrentBalance` for the given user where `CurrentBalance` holds:

   - `rewardToken`: address of the reward token
   - `actionType`: the action type string
   - `asset`: the asset address
   - `currentBalance`: the updated balance amount

### TODO Reward claim

  implement today
  minting capability (for each reward token) to create reward when claimed

### TODO function modifiers

 `update` should be called by owners only
 `claim` only user should be allowed to claim rewards

### TODO Delegate pattern

### Estimate CurrentBalance Reward (IMPLEMENTED)

  We need a function to estimate how much rewards a user would have at the current moment
  without updating their balances. This is useful for displaying potential rewards in UIs.

  The function `estimateRewards` takes the following parameters:
  - `userAddress`: address of the user to estimate rewards for
  - `actionKeys`: array of `ActionKey` structs identifying which actions to estimate

  Where `ActionKey` contains:
  - `actionType`: string identifying the type of action
  - `asset`: address of the asset for the action

  The function returns an array of `CurrentBalance` structs (same as `update` function).

  Key implementation details:
  - Uses the shared `calculateAccruedReward` utility function
  - For existing user balances, calculates potential accrued rewards using `lastSeenAmount`
  - The `lastSeenAmount` represents the user's liquidity state from their last interaction
  - Does not modify any state (view function)
  - If user has no balance for an action, returns the stored balance (typically 0)

  The calculation logic is identical to `update`, but uses `lastSeenAmount` instead of
  the provided `amount` parameter, allowing estimation without knowing current liquidity amounts.

### Ownership Controls (IMPLEMENTED)

  - Transfer ownership of the contract

## Implementation hints

### Inspirations

There is a contract developed by Dustin called `RewardsManager` that was
implemented for CATA rewards added each time there is a asset transfer between
users. Our requirements obviously has changed, and thus this contract is
obsolete, but it would be a good inspiration for the implementation of the new
contract.

### Manageable resources stored with O(1) scans

  Use a common Solidity pattern for efficient lookups - O(1) to check if a X
  exists and find its array position, rather than O(n) array scanning.

  Here's how it works:

  ```
  X[] public record xs;           // Array of xs
  mapping (address => uint) public record xMap;  // x -> array index
  ````

  Key Points:
  1. 1-based indexing: xMap stores array.length (not array.length - 1)
  2. Why 1-based: So that xMap[_token] == 0 means "not registered"
  3. Usage: To access the token, use xs[xMap[x] - 1]
