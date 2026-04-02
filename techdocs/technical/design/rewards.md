# Rewards System - Technical Implementation Guide

## Overview

The Rewards system is a global incentives controller that distributes CATA token rewards to users based on their participation in various protocol activities. The system uses an Aave-style cumulative index pattern to achieve O(1) gas efficiency for all operations.

**Key Implementation File:** `mercata/contracts/concrete/Rewards/Rewards.sol`

### Core Principles

1. **No Asset Custody**: The contract never holds user assets (LP tokens, collateral, etc.) - only CATA rewards and accounting state
2. **O(1) Operations**: All user interactions are constant time - no loops over users or time periods
3. **Global Index Pattern**: Uses cumulative reward-per-stake indices for efficient calculation
4. **Activity-Based**: Each reward stream is an "activity" with independent tracking
5. **Pre-Funded Model**: Contract must be funded with CATA tokens before users can claim

## Activity Types

The system supports two types of activities (see `Rewards.sol:11-14`):

### Position Activities (`ActivityType.Position`)
- **Use Case**: Ongoing positions where users can increase/decrease participation
- **Examples**: Liquidity provision, lending supply, borrowing
- **API**: `deposit(activityId, user, amount)` and `withdraw(activityId, user, amount)`
- **Behavior**: User stake can go up or down based on position changes

### OneTime Activities (`ActivityType.OneTime`)
- **Use Case**: Discrete actions where participation only increases
- **Examples**: Swap volume tracking, one-time milestones
- **API**: `occurred(activityId, user, amount)`
- **Behavior**: User stake only increases (never decreases)

The contract enforces these restrictions at the function level (see `Rewards.sol:240`, `Rewards.sol:255`, `Rewards.sol:270`).

## Architecture

### Data Structures

**Activity** (`Rewards.sol:21-29`)
```
struct Activity {
    string name;                 // Human-readable identifier
    ActivityType activityType;   // Position or OneTime
    uint256 emissionRate;        // CATA tokens per second for this activity
    uint256 accRewardPerStake;   // Cumulative reward index (scaled by 1e18)
    uint256 lastUpdateTime;      // Last time index was updated
    uint256 totalStake;          // Sum of all user stakes (tracked internally)
    address allowedCaller;       // Only this address can call deposit/withdraw/occurred
}
```

**RewardsUserInfo** (`Rewards.sol:16-19`)
```
struct RewardsUserInfo {
    uint256 stake;       // User's effective stake in this activity
    uint256 rewardDebt;  // Accounting variable for reward calculation
}
```

### State Variables

- `activities[activityId]` - Activity data by ID
- `userInfo[activityId][user]` - Per-user state for each activity
- `unclaimedRewards[user]` - Accumulated claimable rewards across all activities
- `totalRewardsEmission` - Sum of emission rates across all activities
- `activityIds[]` - Array of all activity IDs for enumeration

## Reward Calculation Logic

### The Global Index Pattern

The system uses a cumulative index to track how much reward has accrued per unit of stake over time. This is the key to O(1) efficiency.

**Index Update** (see `_updateActivityIndex()` at `Rewards.sol:345-370`):
```
Time elapsed: dt = now - lastUpdateTime
Rewards generated: reward = emissionRate * dt
Index increment: accRewardPerStake += (reward * 1e18) / totalStake
```

**User Pending Rewards** (calculated in `_handleActivity()` and `_settlePendingRewards()`):
```
accumulated = (userStake * accRewardPerStake) / 1e18
pending = accumulated - rewardDebt
```

The `rewardDebt` tracks what the user has already been credited, so the difference gives new rewards since last update.

### How Rewards Accrue

1. **Index Update**: When any user interacts with an activity, the global index is updated first using the **current** totalStake (before the user's change is applied)

2. **Settle User Rewards**: Calculate pending rewards using the freshly updated index and add to `unclaimedRewards[user]`

3. **Update User State**:
   - Update user's stake based on the action
   - Set `rewardDebt = (newStake * accRewardPerStake) / 1e18`

4. **Update Total Stake**: `totalStake = totalStake + newStake - oldStake`

This ensures:
- Users get credit for rewards accrued before their action
- The new stake is properly initialized for future accrual
- Total stake stays consistent (sum of all user stakes)

See `_handleActivity()` implementation at `Rewards.sol:268-313`.

### For Users

Users interact with activities through pools, then claim rewards:

```solidity
// Claim from specific activities
uint256[] memory activityIds = [1, 2, 3];
rewards.claimRewards(activityIds);

// Or claim from all activities
rewards.claimAllRewards();
```

Claiming:
1. Updates indices for specified activities
2. Settles pending rewards (without changing stakes)
3. Transfers all `unclaimedRewards[user]` to the user
4. Resets `unclaimedRewards[user]` to 0

See `claimRewards()` at `Rewards.sol:188-205` and `claimAllRewards()` at `Rewards.sol:210-227`.

## Administration

**Owner Functions** (all require `onlyOwner`):

- `addActivity()` - Register new activity (see `Rewards.sol:121-147`)
- `setEmissionRate()` - Update emission rate for an activity (see `Rewards.sol:154-167`)
- `setAllowedCaller()` - Change the allowed caller for an activity (see `Rewards.sol:174-182`)

**Emission Rate Updates**: When updating emission rates, the contract:
1. Updates the activity index first (with old rate)
2. Changes the emission rate
3. Updates `totalRewardsEmission` accordingly

This ensures a clean transition between emission rates without retroactive changes.
