This is a design document to implement brand new Rewards contract.
The contract will replaces existing RewardsChef.
It will be called Rewards.sol


# RewardsController — Aave-Style Incentives Design

## 1. Introduction & Goals

This document defines the design of the **RewardsController** contract, a central incentives engine responsible for distributing CATA rewards across protocol activities.

### Primary goals

- **No user staking**: Users do not move LP tokens or any position tokens into the rewards contract.
- **No asset custody**: The rewards contract holds **no user funds**, only accounting state.
- **Global incentives controller**: One contract tracks rewards for all incentivized activities.
- **Simple integration**: Pools / tokens call a single hook on user balance changes.
- **Gas efficiency**: O(1) accounting updates per user action, no loops over users or epochs.
- **Scalability**: Support many markets and users without storage/loop blowups.
- **Auditability**: Simple, well-known pattern (similar to Aave’s Incentives Controller).
- **Leadership clarity**: Easy to explain: _“We track points for balances over time, and users claim CATA.”_

## 2. High-Level Overview

The RewardsController:

- Tracks a set of **rewarded activities** (e.g. “SwapPool-1 LP”, “LendingPool-USDST Supply”, “Borrow-USDST”, “SafetyModule”).
- Each activity has:
  - A **reward emission rate** (CATA per second).
  - A **global cumulative index** (`accRewardPerStake`) that tracks how much reward has accrued per 1 unit of “effective stake”.
- Protocol modules (pools, token contracts) **call the controller** whenever a user’s effective stake changes.
- The controller updates:
  - The **activity index** (global, lazy-updated).
  - The **user’s accrued rewards** (`unclaimedRewards[user]`).
- Users call `claimRewards(...)` to pull CATA from the rewards treasury.

There is **no staking**, **no LP transfer**, and **no need to track per-epoch state**.

## 3. Core Concepts

### 3.1 Activity

An **Activity** is an abstract source of reward:

- Each activity corresponds to a single reward “stream”:
  examples:
  - SwapPool-USDST/ETHST LP
  - LendingPool-USDST supply
  - LendingPool-USDST borrow
  - SafetyModule stake
  - (Optionally) “Swap volume synthetic stake”

Each activity is identified by `activityId` (`uint256` or `bytes32`).

### 3.2 Effective Stake

For each activity, the pool defines a notion of **effective stake** per user:

- For LP activities → effective stake may be LP token balance or USD-equivalent TVL.
- For lending supply → amount of mTokens (or normalized principal).
- For borrowing → amount of debt tokens (can be scaled debt).
- For safety module → amount staked.
- For swaps (if included) → could be implemented as:
  - “sticky stake” (cumulative volume),
  - or some other simple scheme chosen by the pool.

**Key point:**
The RewardsController is **agnostic** to the meaning of “stake” — it only sees numbers.
Integrating the correct business logic happens in the calling pool/token contract.

## 4. Rewards Model

### 4.1 Emission Configuration

Each activity has:

- `emissionRate` — CATA emitted per second to that activity.
- Optionally, a schedule (time-based change of emission rates). For Phase 0, this can be:
  - a single constant emission rate, or
  - a piecewise schedule maintained by admin (changing `emissionRate` at certain timestamps).

We **do not** store per-epoch weights or do epoch loops.
Epochs, if used, are just **time windows for updating `emissionRate`**, not first-class data structures.

### 4.2 Global Index

Per activity `A`:

- `accRewardPerStake[A]` — cumulative reward per 1 unit of stake (scaled by `1e18`).
- `lastUpdateTime[A]` — last timestamp when this index was updated.
- `totalStake[A]` — sum of all users’ effective stakes for this activity.

When reward-relevant time passes, we update:

```text
dt = now - lastUpdateTime[A]
if dt > 0 and totalStake[A] > 0:
    accRewardPerStake[A] += (emissionRate[A] * dt * 1e18) / totalStake[A]
lastUpdateTime[A] = now
```

This function is called lazily whenever an activity is touched (e.g. on user deposit, withdraw, borrow, repay, or claim).

### 4.3 User State

Per `(activity A, user U)`:

- `userStake[A][U]` — user’s current effective stake in activity A.
- `userRewardDebt[A][U]` — accounting variable:
  ```text
  userRewardDebt = userStake * accRewardPerStake
  ```

Global per user:

- `unclaimedRewards[U]` — sum of all CATA accrued across all activities, not yet claimed.

## 5. Pool Integration (Rewards Listener Pattern)

Each pool or token responsible for an activity integrates with the RewardsController via a simple hook.

### 5.1 Interface

```solidity
interface IRewardsController {
    function handleAction(
        uint256 activityId,
        address user,
        uint256 userNewStake,
        uint256 totalNewStake
    ) external;
}
```

- `activityId` — identifies which activity this state change refers to.
- `userNewStake` — user’s new effective stake after the action.
- `totalNewStake` — total effective stake for the activity after the action.

Each pool stores:

```solidity
IRewardsController public rewardsController;
uint256 public activityId; // per pool/activity
```

### 5.2 Example: SwapPool LP

On LP deposit / withdrawal:

```solidity
function _afterLiquidityChange(address user) internal {
    uint256 userStake = _getUserEffectiveStake(user);    // e.g. LP balance or USD value
    uint256 totalStake = _getTotalEffectiveStake();      // total LP / TVL

    if (address(rewardsController) != address(0)) {
        rewardsController.handleAction(activityId, user, userStake, totalStake);
    }
}
```

Same pattern applies to:

- Lending supply tokens
- Debt tokens
- Safety module positions
- Any other position-like activity

For swaps (if modeled as sticky stake), the pool would internally maintain a synthetic stake based on cumulative volume, and call `handleAction` when it changes.

## 6. handleAction: Core Accounting Logic

Inside RewardsController:

```solidity
function handleAction(
    uint256 activityId,
    address user,
    uint256 userNewStake,
    uint256 totalNewStake
) external {
    Activity storage a = activities[activityId];

    // 1) Update global index
    _updateActivityIndex(a, totalNewStake);

    // 2) Settle user’s pending rewards
    uint256 oldStake = userStake[activityId][user];
    uint256 oldDebt  = userRewardDebt[activityId][user];

    uint256 accumulated = (oldStake * a.accRewardPerStake) / 1e18;
    uint256 pending     = accumulated - oldDebt;

    if (pending > 0) {
        unclaimedRewards[user] += pending;
    }

    // 3) Update user stake and debt
    userStake[activityId][user]      = userNewStake;
    userRewardDebt[activityId][user] = (userNewStake * a.accRewardPerStake) / 1e18;

    // 4) Update total stake
    a.totalStake = totalNewStake;
}
```

Properties:

- O(1) operations per call.
- No loops over users.
- No per-epoch structures.
- Rewards are always proportional to stake × time.

## 7. Claiming Rewards

Users call:

```solidity
function claimRewards(address user, uint256[] calldata activityIds) external;
```

Implementation:

1. For each `activityId` in the list:
   - Call `_updateActivityIndex(activity)` (using current `totalStake`).
   - Settle pending rewards exactly as in `handleAction`, but without changing `userStake`:
     ```text
     accumulated = userStake * accRewardPerStake
     pending     = accumulated - userRewardDebt
     ```
   - Add `pending` to `unclaimedRewards[user]`.
   - Update `userRewardDebt = userStake * accRewardPerStake`.

2. Sum all pending amounts across activities.

3. Transfer `amount` of CATA from a funding source:
   - either from the contract’s CATA balance (pre-funded by treasury), or
   - via minting, if CATA is mintable and controller is minter.

4. Set `unclaimedRewards[user] = 0` (or subtract amount if you allow partial claims).

No epochs, no loops over historical periods, just index updates.

## 8. Administration

Admin (e.g. governance) can:

- Add a new activity:
  - `addActivity(activityId, initialEmissionRate)`
- Update emission rate:
  - `setEmissionRate(activityId, newRate)`
- Update rewardsController address in pools (via their existing admin mechanisms).
- Fund the RewardsController with CATA from treasury, if using pre-funded model.

Optionally:

- Maintain an off-chain schedule (e.g. weekly changes to emission rates),
  and apply `setEmissionRate` on schedule.

Even if you speak about “epochs” in product docs, **on-chain we only change `emissionRate`**, not store epoch state.

## 9. Security & Invariants

- RewardsController never holds user LP tokens, mTokens, or collateral — only CATA (if pre-funded).
- Only whitelisted pools/tokens should be allowed to call `handleAction` for their activities (e.g. via `allowedCallers[activityId] = poolAddress`).
- Arithmetic uses checked math and proper scaling (`1e18` for indices).
- EmissionRates should be bounded to avoid overflow / excessive emission.

Key invariants:

- For each activity:
  ```text
  totalRewardsEmitted ≈ ∫ emissionRate dt
  ```
- For each user, across time:
  ```text
  totalRewardsClaimed + unclaimedRewards
       = Σ_over_activities ∫ userStake(t)/totalStake(t) * emissionRate(t) dt
  ```

## 10. Properties (Leadership Summary)

This design satisfies the leadership constraints:

- **No staking**
  Users never move LP or position tokens into the rewards contract. All assets stay in pools.

- **No LP token transfers in RewardsController**
  Pools/tokens own balances; RewardsController sees only numbers (stakes).

- **No event-type per-epoch weight tracking**
  All rewards are computed via `stake × time` using a global cumulative index.

- **No epoch loops**
  Epochs, if used, only define emission rate changes. There is no per-epoch user state.

- **Clean global incentives controller model**
  One central contract, per-activity indices, pools call `handleAction` on state changes.

- **Simple pool integration**
  Each pool adds:
  - a `rewardsController` address
  - a small internal hook calling `handleAction` with new stakes.

- **Very gas-efficient**
  O(1) operations per state change, no loops over users or epochs.

- **Auditor-friendly**
  Pattern is directly inspired by Aave’s Incentives Controller, which is well known and battle tested.

- **Scalable**
  Works with many pools and users; state grows linearly with `(activities × active users)` without any per-epoch explosion.

- **Easy to explain**
  “Pools tell the Rewards contract how much each user has. The Rewards contract tracks how long and how much they’ve had. Users can claim their share of emissions at any time.”
