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

### Multipliers management

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

### Action Management

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

### User Balance and time-based accrued rewards

  We need to store user balances per each `Reward Token` per each `Action`.
  Time-based rewards accrue continuously based on differently per each action.

  We need to introduce new structure called `UserBalance` that will hold:
  - `balance`: a `uint`, accrued reward over time
  - `createdAt`: a `uint`, timestamp when `UserBalance` was created
  - `modifiedAt`: a `uint`, timestamp when balance was last modified
  - `lastSeenAmount`: a `unit` holding last seen amount for a given `Action`
    (this is only needed for feature "Estimate Accrued Reward")

  We need a field called `balances`.

  It should map from `action type` to mapping
    from `asset` to mapping
	   `rewardToken` to mapping
	        from `address` (user address) to `UserBalance`

  Because the `balances` are effectively a mapping from `Action` to
  `RewardBalance` to `UserBalance`, we must modify balances when `Action` is
  removed or added.

### Update rewards

  We must introduce function `update` which will have the following
  parameters.

  - `caller`: an `address` of a caller (e.g Liquidity Pool)
  - `type`: type of an `Action` that is triggering the update
  - `assets`: an array of `Token`s.

     Both the `type` and each asset in `assets` identify the list of `Action`s
     that will be updated. Each `Action` has an `owner` and that `owner` must be
     the same as the `caller`.
  - `amounts`: an array of amounts, each representing current amount for each of the assets
     The length of `assets` and `amunts` must be identical
  - `user`: an `address` of a user

  The function will identify `Action`s that are updated.
  Then for each `Action`
     for each `Reward token`
	     find a user and in `balances`
	     - we check the modifier value for action, for a `Reward` token
	     - we calculate delta: how much time has passed since last update of a
           given `Action`
	     - we calculate accrued value as `accrued = amount` * `multiplier value` * `delta`
           and we add that value to existing `balance` (`balance` += `accrued`)
	     - we modify the `modifiedAt` with current timestamp
	     - we modify the `lastSeenAmount` to `amount`

   Lastly as a result we want to return current balance. That will be a list of
   `CurrentBalance` for a given user where `CurrentBalance` holds:

   - `rewardToken`
   - `action`
   - `currentBalance`

### Reward claim

  TBD

### Estimate CurrentBalance Reward

  TBD

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
