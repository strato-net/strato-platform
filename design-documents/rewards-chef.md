# RewardsChef

## Motivation

Third attempt to the [Create CATA rewards smart contract
#4408](https://github.com/blockapps/strato-platform/issues/4408).

There are essentially two types scenarios where we give CATA rewards to our
users:

* time accrued rewards - rewards grow as time passes (most in our system)
* event-based rewards - rewards per specific action

## The name and the inspiration

In this document we will design an algorithm called `RewardsChef`, that will
focus on solving the time accrued rewards.

Name `RewardsChef` comes directly from `MasterChef`, an algorithm that heavily
inspired our implementation.

## Core requirements / ideas

* Stacking mechanism for LP tokens

  Ability to stake LP tokens owned by our users. The award is CATA token. The
  awards accrue over time.

  This means that once the pool (Liquidity Pools, Swap Pools) mints an LP token,
  it is responsibility of the user to stake those tokens in the staking
  pool. This can be obviously done by the UI in our system.

* The accrual should be computational efficient.

  Global to the whole stake pool, individual rewards per user calculated on
  demand.

* Consider rewards for early adopters

  We should consider multiplier for early adopters built into the smart
  contract.

* Consider supporting multiple awards

  Initially we need to support just CATA. But we might want to consider using
  other tokens.

  The first implementation - that will be based on the MasterChef V1 - will only support CATA. We might want

* Should we feed portion of rewards to the developers?

  The SushiSwap (following [@LawMaster](https://twitter.com/LawMaster))
  suggestion, delegated 10% of rewards to the developers of the smart contract
  for the sustainability of the project.

* Do we need to defer when rewards start to be calculated?

  The original SushiSwap contract deferred when the rewards were calculated to a
  specific `startBlock`. It is not well explained why, even in the original
  [blogpost](https://medium.com/sushiswap-org/the-sushiswap-project-8716c429cee1)
  that announced the contract.

  I don't believe we have to do it, and for now I will assume that we don't.

## RewardsChef 1.0 - the design

At its core, the `RewardsChef` will resemble `MasterChef` (`V1`) algorithm with
few adjustments.

### Structures

We will keep the same data structures: `UserInfo` and `PoolInfo` with some changes:

* since our blockchain allows us to retrieve timestamps from blocks
  `block.timestamp` we we will have a `uint256 lastRewardTimestamp` instead of
  `lastRewardBlock`

* since our reward is cata (not sushi) we will call the `accSushiPerShare` more
  general `accPerToken`

* each individual pool will have bonus periods with different multipliers

  The original MasterChef had a multiplier that would represent time passed (or
  number of blocks that has passed), multiplied by bonus. Bonus was only added
  if the pools were accruing rewards in special period (between start and end
  block that were defined in the contract).

  We extend this concept by allowing multiple bonus periods per pool. Each 
  `PoolInfo` contains an array of `BonusPeriod` structs, where each period has:
  - `startTimestamp`: When this bonus period begins
  - `bonusMultiplier`: The multiplier for this period (not smaller than 1)
  
  This approach prevents gaming attacks where users could time deposits/withdrawals
  around multiplier changes, since all periods are immutable once created and
  rewards are calculated accurately across different time periods.

### Pool management

#### Adding stake pool

Similar logic to `add` in the `MasterChef` with few differences

* The `add` funtion was renamed to `addPool`

* It will not take `withUpdate` variable

* We also don't have to track the `startBlock`, we will start calculating
  rewards the moment the first pool is added

* It is also not expensive for us to check if given LP token is already in the
pools. If it exists, the add function will return.

* Emits a `PoolAdded` event when a new pool is successfully added, including the
pool ID (index), LP token address, and allocation points.

* Initializes the pool with the first bonus period using the provided multiplier
and current block timestamp.

#### Updating allocation points

Similar to `set` function in the `MasterChef` with few differences

* The function name should be `updateAllocationPoints`

* It should not take `withUpdate`

* Should emit an event

#### Adding bonus periods

New functionality not present in MasterChef to manage bonus multipliers over time:

* The function name should be `addBonusPeriod`

* Takes pool ID, start timestamp, and bonus multiplier parameters

* Validates that the start timestamp is far enough in the future (using `minFutureTime`) and after the last existing period

* Prevents gaming by ensuring periods are immutable once the timestamp is reached

* Emits a `BonusPeriodAdded` event

#### Updating minimum future time

Configuration function to adjust the minimum time requirement for new bonus periods:

* The function name should be `updateMinFutureTime`

* Takes the new minimum future time in seconds

* Validates that the value is at least 60 seconds (1 minute)

* Initialized to 3600 seconds (1 hour) in the constructor

* Prevents last-minute bonus period additions that could be gamed

* Emits a `MinFutureTimeUpdated` event with old and new values
