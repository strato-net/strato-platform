// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

// ═════════════════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ═════════════════════════════════════════════════════════════════════════

struct UserInfo {
    uint256 stake;       // User's effective stake in this activity
    uint256 rewardDebt;  // Reward debt for accounting
}

struct Activity {
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

    // User info per activity: activityId => user => UserInfo
    mapping(uint256 => mapping(address => UserInfo)) public record userInfo;

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
    // INTERNAL FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @dev Updates the global reward index for an activity
     * @param activityId The activity to update
     * @param currentTotalStake The current total stake for this activity
     */
    function _updateActivityIndex(uint256 activityId, uint256 currentTotalStake) internal {
        Activity storage activity = activities[activityId];

        // If no time has passed, nothing to update
        if (block.timestamp <= activity.lastUpdateTime) {
            return;
        }

        // If there's no stake, just update the timestamp
        if (currentTotalStake == 0) {
            activity.lastUpdateTime = block.timestamp;
            return;
        }

        // Calculate time elapsed
        uint256 dt = block.timestamp - activity.lastUpdateTime;

        // Calculate rewards accrued during this period
        uint256 reward = activity.emissionRate * dt;

        // Update the cumulative index
        activity.accRewardPerStake += (reward * PRECISION_MULTIPLIER) / currentTotalStake;
        activity.lastUpdateTime = block.timestamp;

        emit ActivityIndexUpdated(activityId, activity.accRewardPerStake, currentTotalStake);
    }

}
