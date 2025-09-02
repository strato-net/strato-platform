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
