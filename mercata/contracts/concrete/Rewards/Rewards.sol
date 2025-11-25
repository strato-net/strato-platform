// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

// ═════════════════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ═════════════════════════════════════════════════════════════════════════

enum ActivityType {
    Position,  // e.g providing liquidity
    OneTime    // e.g swaps, borrows
}

struct RewardsUserInfo {
    uint256 stake;       // User's effective stake in this activity
    uint256 rewardDebt;  // Reward debt for accounting
}

struct Activity {
    string name;                 // Human-readable name for this activity
    ActivityType activityType;   // Type of activity (Position or OneTime)
    uint256 emissionRate;        // CATA tokens emitted per second for this activity
    uint256 accRewardPerStake;   // Accumulated reward per 1 unit of stake (scaled by 1e18)
    uint256 lastUpdateTime;      // Last timestamp when the index was updated
    uint256 totalStake;          // Sum of all users' effective stakes for this activity
    address allowedCaller;       // Address of pool/contract allowed to call handleAction for this activity
}

/**
 * Rewards - incentives controller for distributing CATA rewards
 *
 * This contract implements a global incentives controller that tracks rewards
 * for various protocol activities without requiring users to stake or transfer
 * their LP tokens. Pools and other protocol contracts call handleAction() when
 * user balances change, and the controller tracks accrued rewards using a
 * cumulative index pattern.
 *
 * Key features:
 * - No asset custody - contract only tracks accounting state
 * - O(1) gas efficiency - no loops over users or epochs
 * - Global index pattern inspired by Aave's Incentives Controller
 * - Simple pool integration via handleAction() hook
 */
contract record Rewards is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event ActivityIndexUpdated(uint256 indexed activityId, uint256 accRewardPerStake, uint256 totalStake);
    event UserStakeUpdated(uint256 indexed activityId, address indexed user, uint256 oldStake, uint256 newStake, uint256 pendingRewards);
    event ActivityAdded(uint256 indexed activityId, string name, uint256 emissionRate, address allowedCaller);
    event EmissionRateUpdated(uint256 indexed activityId, uint256 oldRate, uint256 newRate);
    event AllowedCallerUpdated(uint256 indexed activityId, address oldCaller, address newCaller);
    event RewardsClaimed(address indexed user, uint256 amount);

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    // Precision multiplier for reward calculations to avoid rounding errors
    uint256 public PRECISION_MULTIPLIER = 1e18;

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // The CATA token (reward token)
    Token public rewardToken;

    // Mapping of activityId to Activity struct
    mapping(uint256 => Activity) public record activities;

    // Array of all activity IDs for enumeration
    uint256[] public activityIds;

    // Total emission rate across all activities (CATA per second)
    uint256 public totalRewardsEmission;

    // User info per activity: activityId => user => RewardsUserInfo
    mapping(uint256 => mapping(address => RewardsUserInfo)) public record userInfo;

    // Total unclaimed rewards per user
    mapping(address => uint256) public record unclaimedRewards;

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _rewardToken) external onlyOwner {
        require(_rewardToken != address(0), "Invalid reward token address");
        rewardToken = Token(_rewardToken);
        PRECISION_MULTIPLIER = 1e18;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PUBLIC FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @dev Mass update reward indices for all activities
     */
    function massUpdateActivitiesIndices() public {
        for (uint256 i = 0; i < activityIds.length; i++) {
            _updateActivityIndex(activityIds[i]);
        }
    }

    /**
     * @dev Register a new activity for reward distribution
     * @param activityId Unique identifier for the activity
     * @param name Human-readable name for the activity
     * @param activityType Type of activity (Position or OneTime)
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param allowedCaller Address of pool/contract allowed to call handleAction
     */
    function addActivity(
        uint256 activityId,
        string name,
        ActivityType activityType,
        uint256 emissionRate,
        address allowedCaller
    ) external onlyOwner {
        require(allowedCaller != address(0), "Invalid caller address");
        require(bytes(name).length > 0, "Name cannot be empty");

        activities[activityId] = Activity({
            name: name,
            activityType: activityType,
            emissionRate: emissionRate,
            accRewardPerStake: 0,
            lastUpdateTime: block.timestamp,
            totalStake: 0,
            allowedCaller: allowedCaller
        });

        activityIds.push(activityId);

        // Update total emission rate
        totalRewardsEmission += emissionRate;

        emit ActivityAdded(activityId, name, emissionRate, allowedCaller);
    }

    /**
     * @dev Update the emission rate for an existing activity
     * @param activityId The activity to update
     * @param newEmissionRate The new emission rate (CATA per second)
     */
    function setEmissionRate(uint256 activityId, uint256 newEmissionRate) external onlyOwner {
        Activity storage activity = activities[activityId];

        // Update index with old emission rate first
        _updateActivityIndex(activityId);

        uint256 oldRate = activity.emissionRate;
        activity.emissionRate = newEmissionRate;

        // Update total emission rate
        totalRewardsEmission = totalRewardsEmission + newEmissionRate - oldRate;

        emit EmissionRateUpdated(activityId, oldRate, newEmissionRate);
    }

    /**
     * @dev Update the allowed caller for an existing activity
     * @param activityId The activity to update
     * @param newAllowedCaller The new address allowed to call deposit/withdraw
     */
    function setAllowedCaller(uint256 activityId, address newAllowedCaller) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(newAllowedCaller != address(0), "Invalid caller address");

        address oldCaller = activity.allowedCaller;
        activity.allowedCaller = newAllowedCaller;

        emit AllowedCallerUpdated(activityId, oldCaller, newAllowedCaller);
    }

    /**
     * @dev Claim accumulated rewards for the caller
     * @param activityIds Array of activity IDs to settle rewards from
     */
    function claimRewards(uint256[] calldata activityIds) external {
        address user = msg.sender;

        // Update indices and settle pending rewards for all specified activities
        for (uint256 i = 0; i < activityIds.length; i++) {
            _settlePendingRewards(activityIds[i], user);
        }

        // Get total accumulated rewards
        uint256 totalRewards = unclaimedRewards[user];
        require(totalRewards > 0, "No rewards to claim");

        // Reset unclaimed rewards and transfer CATA tokens
        unclaimedRewards[user] = 0;
        rewardToken.transfer(user, totalRewards);

        emit RewardsClaimed(user, totalRewards);
    }

    /**
     * @dev Claim accumulated rewards from all activities for the caller
     */
    function claimAllRewards() external {
        address user = msg.sender;

        // Update indices and settle pending rewards for all activities
        for (uint256 i = 0; i < activityIds.length; i++) {
            _settlePendingRewards(activityIds[i], user);
        }

        // Get total accumulated rewards
        uint256 totalRewards = unclaimedRewards[user];
        require(totalRewards > 0, "No rewards to claim");

        // Reset unclaimed rewards and transfer CATA tokens
        unclaimedRewards[user] = 0;
        rewardToken.transfer(user, totalRewards);

        emit RewardsClaimed(user, totalRewards);
    }

    /**
     * @dev Deposit/increase stake for a user in an activity
     * @param activityId The activity to deposit into
     * @param user The user whose stake is increasing
     * @param amount The amount to deposit
     */
    function deposit(
        uint256 activityId,
        address user,
        uint256 amount
    ) external {
        require(activities[activityId].activityType == ActivityType.Position, "Only for Position activities");
        _handleActivity(activityId, user, amount, true);
    }

    /**
     * @dev Withdraw/decrease stake for a user in an activity
     * @param activityId The activity to withdraw from
     * @param user The user whose stake is decreasing
     * @param amount The amount to withdraw
     */
    function withdraw(
        uint256 activityId,
        address user,
        uint256 amount
    ) external {
        require(activities[activityId].activityType == ActivityType.Position, "Only for Position activities");
        _handleActivity(activityId, user, amount, false);
    }

    /**
     * @dev Record a one-time action occurrence for a user
     * @param activityId The one-time activity that occurred
     * @param user The user who performed the action
     * @param amount The amount/value of the action
     */
    function occurred(
        uint256 activityId,
        address user,
        uint256 amount
    ) external {
        require(activities[activityId].activityType == ActivityType.OneTime, "Only for OneTime activities");
        _handleActivity(activityId, user, amount, true);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal function to handle stake changes
     * @param activityId The activity being updated
     * @param user The user whose stake is changing
     * @param amount The amount of stake change
     * @param isIncrease True for deposit/increase, false for withdraw/decrease
     */
    function _handleActivity(
        uint256 activityId,
        address user,
        uint256 amount,
        bool isIncrease
    ) internal {
        Activity storage activity = activities[activityId];

        // Access control: only allowed caller can update this activity
        require(msg.sender == activity.allowedCaller, "Caller not allowed");

        // 1) Update global index using current totalStake (before user update)
        _updateActivityIndex(activityId);

        // 2) Settle user's pending rewards
        RewardsUserInfo storage userState = userInfo[activityId][user];
        uint256 oldStake = userState.stake;
        uint256 pendingRewards = 0;

        if (oldStake > 0) {
            uint256 accumulated = (oldStake * activity.accRewardPerStake) / PRECISION_MULTIPLIER;
            pendingRewards = accumulated - userState.rewardDebt;

            if (pendingRewards > 0) {
                unclaimedRewards[user] += pendingRewards;
            }
        }

        // 3) Calculate new stake from delta
        uint256 newStake;
        if (isIncrease) {
            newStake = oldStake + amount;
        } else {
            require(oldStake >= amount, "Insufficient stake");
            newStake = oldStake - amount;
        }

        // 4) Update user stake and debt
        userState.stake = newStake;
        userState.rewardDebt = (newStake * activity.accRewardPerStake) / PRECISION_MULTIPLIER;

        // 5) Update total stake internally (secure calculation)
        activity.totalStake = activity.totalStake + newStake - oldStake;

        emit UserStakeUpdated(activityId, user, oldStake, newStake, pendingRewards);
    }

    /**
     * @dev Settle pending rewards for a user without changing their stake
     * @param activityId The activity to settle rewards for
     * @param user The user to settle rewards for
     */
    function _settlePendingRewards(uint256 activityId, address user) internal {
        // Update the activity index first
        _updateActivityIndex(activityId);

        Activity storage activity = activities[activityId];
        RewardsUserInfo storage userState = userInfo[activityId][user];
        uint256 userStake = userState.stake;

        if (userStake > 0) {
            uint256 accumulated = (userStake * activity.accRewardPerStake) / PRECISION_MULTIPLIER;
            uint256 pending = accumulated - userState.rewardDebt;

            if (pending > 0) {
                unclaimedRewards[user] += pending;
            }

            // Update reward debt to current accumulated value (without changing stake)
            userState.rewardDebt = accumulated;
        }
    }

    /**
     * @dev Updates the global reward index for an activity
     * @param activityId The activity to update
     */
    function _updateActivityIndex(uint256 activityId) internal {
        Activity storage activity = activities[activityId];

        // If no time has passed, nothing to update
        if (block.timestamp <= activity.lastUpdateTime) {
            return;
        }

        // If there's no stake, just update the timestamp
        if (activity.totalStake == 0) {
            activity.lastUpdateTime = block.timestamp;
            return;
        }

        // Calculate time elapsed
        uint256 dt = block.timestamp - activity.lastUpdateTime;

        // Calculate rewards accrued during this period
        uint256 reward = activity.emissionRate * dt;

        // Update the cumulative index
        activity.accRewardPerStake += (reward * PRECISION_MULTIPLIER) / activity.totalStake;
        activity.lastUpdateTime = block.timestamp;

        emit ActivityIndexUpdated(activityId, activity.accRewardPerStake, activity.totalStake);
    }

}
