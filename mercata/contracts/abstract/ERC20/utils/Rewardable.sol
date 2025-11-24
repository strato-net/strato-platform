// SPDX-License-Identifier: MIT
import "../../../concrete/Rewards/Rewards.sol";

/**
 * @dev Contract module which allows children to implement reward tracking
 * for protocol actions via the Rewards controller.
 *
 * This module is used through inheritance. It will make available the modifier
 * `rewardable`, which can be applied to functions to automatically track
 * one-time actions (e.g., swaps) in the Rewards contract.
 *
 * Note that the Rewards contract must be initialized with the appropriate
 * activity and the contract must be set as the allowed caller for that activity.
 */
abstract contract Rewardable {
    /// @notice The Rewards contract address (can be zero if rewards are disabled)
    Rewards public rewards;

    /**
     * @dev Set the Rewards contract address
     * @param rewardsAddr The address of the Rewards contract
     */
    function _setRewards(address rewardsAddr) internal {
        require(rewardsAddr != address(0), "Invalid rewards address");
        rewards = Rewards(rewardsAddr);
    }

    /**
     * @dev Modifier to track a one-time action in the Rewards contract
     * @param activityId The activity ID registered in the Rewards contract (0 = disabled)
     * @param user The user performing the action
     * @param amount The amount/value of the action to track
     * @dev This modifier calls rewards.occurred() after the function executes
     * @dev If rewards is not set (address(0)), the modifier does nothing
     */
    modifier rewardable(uint256 activityId, address user, uint256 amount) {
        _;
        if (address(rewards) != address(0)) {
            rewards.occurred(activityId, user, amount);
        }
    }
}

