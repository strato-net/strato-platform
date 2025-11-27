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

enum ActionType {
    Deposit,   // Increase stake (Position activities only)
    Withdraw,  // Decrease stake (Position activities only)
    Occurred   // One-time action (OneTime activities only)
}

struct Action {
    address sourceContract; // The source contract this event originated from
    string eventName;       // The event name that triggered this action
    address user;           // The user whose stake is changing
    uint256 amount;         // The amount of stake change
    uint256 blockNumber;    // Block number this event originated from (for idempotency)
    uint256 eventIndex;     // Event index within the block (for idempotency)
}

struct ActionableEvent {
    string eventName;    // Name of the event that triggers this action
    ActionType actionType; // The type of action to perform when this event occurs
}

struct RewardsUserInfo {
    uint256 stake;       // User's effective stake in this activity
    uint256 userIndex;   // Snapshot of accRewardPerStake at last update (Aave-style)
}

struct Activity {
    string name;                 // Human-readable name for this activity
    ActivityType activityType;   // Type of activity (Position or OneTime)
    uint256 emissionRate;        // CATA tokens emitted per second for this activity
    uint256 accRewardPerStake;   // Accumulated reward per 1 unit of stake (scaled by 1e18)
    uint256 lastUpdateTime;      // Last timestamp when the index was updated
    uint256 totalStake;          // Sum of all users' effective stakes for this activity
    address sourceContract;      // Address of the contract this activity tracks (for external service mapping)
    ActionableEvent[] actionableEvents; // Events that can trigger actions for this activity
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
    event ActivityAdded(uint256 indexed activityId, string name, uint256 emissionRate, address sourceContract);
    event EmissionRateUpdated(uint256 indexed activityId, uint256 oldRate, uint256 newRate);
    event SourceContractUpdated(uint256 indexed activityId, address oldSourceContract, address newSourceContract);
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

    // User info per activity: user => activityId => RewardsUserInfo
    mapping(address => mapping(uint256 => RewardsUserInfo)) public record userInfo;

    // Total unclaimed rewards per user
    mapping(address => uint256) public record unclaimedRewards;

    // ═══════════════════════════════════════════════════════════════════════
    // EVENT TO ACTIVITY MAPPING
    // ═══════════════════════════════════════════════════════════════════════

    // Struct to store both activityId and actionType for an event
    struct EventInfo {
        uint256 activityId;  // 0 means not found
        ActionType actionType;
    }

    // Mapping from sourceContract -> eventName -> EventInfo
    // This enables O(1) lookup of activity and action type by source contract and event name
    mapping(address => mapping(string => EventInfo)) public sourceEventInfo;

    // ═══════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY STATE
    // ═══════════════════════════════════════════════════════════════════════

    // Current block number being processed (for idempotency)
    uint256 public currentBlockHandled;

    // Mapping of event hashes processed in the current block
    mapping(string => bool) public processedHashes;

    // Array of event hashes in current block (for clearing the mapping)
    string[] public processedHashList;

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
     * @dev Register a new Position activity for reward distribution
     * @param activityId Unique identifier for the activity
     * @param name Human-readable name for the activity
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param sourceContract Address of the contract this activity tracks
     * @param actionableEvents Array of events that can trigger actions (must have at least one)
     */
    function addPositionActivity(
        uint256 activityId,
        string name,
        uint256 emissionRate,
        address sourceContract,
        ActionableEvent[] actionableEvents
    ) external onlyOwner {
        require(actionableEvents.length > 0, "At least one actionable event required");
        _addActivity(activityId, name, ActivityType.Position, emissionRate, sourceContract, actionableEvents);
    }

    /**
     * @dev Register a new OneTime activity for reward distribution
     * @param activityId Unique identifier for the activity
     * @param name Human-readable name for the activity
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param sourceContract Address of the contract this activity tracks
     * @param eventName Name of the event that triggers this one-time action
     */
    function addOneTimeActivity(
        uint256 activityId,
        string name,
        uint256 emissionRate,
        address sourceContract,
        string eventName
    ) external onlyOwner {
        ActionableEvent[] memory actionableEvents = new ActionableEvent[](1);
        actionableEvents[0] = ActionableEvent(eventName, ActionType.Occurred);
        _addActivity(activityId, name, ActivityType.OneTime, emissionRate, sourceContract, actionableEvents);
    }

    /**
     * @dev Update the emission rate for an existing activity
     * @param activityId The activity to update
     * @param newEmissionRate The new emission rate (CATA per second)
     */
    function setEmissionRate(uint256 activityId, uint256 newEmissionRate) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");

        // Update index with old emission rate first
        _updateActivityIndex(activityId);

        uint256 oldRate = activity.emissionRate;
        activity.emissionRate = newEmissionRate;

        // Update total emission rate
        totalRewardsEmission = totalRewardsEmission + newEmissionRate - oldRate;

        emit EmissionRateUpdated(activityId, oldRate, newEmissionRate);
    }

    /**
     * @dev Update the source contract for an existing activity
     * @param activityId The activity to update
     * @param newSourceContract The new source contract address
     */
    function setSourceContract(uint256 activityId, address newSourceContract) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(newSourceContract != address(0), "Invalid source contract address");

        address oldSourceContract = activity.sourceContract;
        activity.sourceContract = newSourceContract;

        emit SourceContractUpdated(activityId, oldSourceContract, newSourceContract);
    }

    /**
     * @dev Update the actionable events for an existing Position activity
     * @param activityId The activity to update
     * @param newActionableEvents The new array of actionable events
     *
     * WARNING: This function is NOT SAFE to call while the activity has existing stakes.
     * Changing events mid-operation can cause:
     * - Events from old configuration to be ignored
     * - Inconsistent state between user stakes and event mappings
     * Only use this function when the activity has zero total stake or during initial setup.
     */
    function setPositionActivityEvents(
        uint256 activityId,
        ActionableEvent[] newActionableEvents
    ) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(activity.activityType == ActivityType.Position, "Only for Position activities");
        require(newActionableEvents.length > 0, "At least one actionable event required");

        address sourceContract = activity.sourceContract;

        // Check for duplicate event names within the same sourceContract (excluding current activity's events)
        for (uint256 evtIdx = 0; evtIdx < newActionableEvents.length; evtIdx++) {
            EventInfo storage existingInfo = sourceEventInfo[sourceContract][newActionableEvents[evtIdx].eventName];
            require(
                existingInfo.activityId == 0 || existingInfo.activityId == activityId,
                "Event name already exists for this source contract"
            );
        }

        // Remove old event mappings (delete individual fields as SolidVM requires)
        for (uint256 i = 0; i < activity.actionableEvents.length; i++) {
            delete sourceEventInfo[sourceContract][activity.actionableEvents[i].eventName].activityId;
            delete sourceEventInfo[sourceContract][activity.actionableEvents[i].eventName].actionType;
        }

        // Clear old actionable events array
        activity.actionableEvents = [];

        // Add new actionable events and register in mapping
        for (uint256 j = 0; j < newActionableEvents.length; j++) {
            activity.actionableEvents.push(newActionableEvents[j]);
            sourceEventInfo[sourceContract][newActionableEvents[j].eventName] = EventInfo(activityId, newActionableEvents[j].actionType);
        }
    }

    /**
     * @dev Update the event name for an existing OneTime activity
     * @param activityId The activity to update
     * @param newEventName The new event name
     *
     * WARNING: This function is NOT SAFE to call while the activity has existing stakes.
     * Changing the event name mid-operation can cause:
     * - Events with the old name to be ignored
     * - Inconsistent state between user stakes and event mappings
     * Only use this function when the activity has zero total stake or during initial setup.
     */
    function setOneTimeActivityEvent(
        uint256 activityId,
        string newEventName
    ) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(activity.activityType == ActivityType.OneTime, "Only for OneTime activities");
        require(bytes(newEventName).length > 0, "Event name cannot be empty");

        address sourceContract = activity.sourceContract;

        // Check that new event name doesn't conflict with another activity
        EventInfo storage existingInfo = sourceEventInfo[sourceContract][newEventName];
        require(
            existingInfo.activityId == 0 || existingInfo.activityId == activityId,
            "Event name already exists for this source contract"
        );

        // Remove old event mapping (delete individual fields as SolidVM requires)
        string oldEventName = activity.actionableEvents[0].eventName;
        delete sourceEventInfo[sourceContract][oldEventName].activityId;
        delete sourceEventInfo[sourceContract][oldEventName].actionType;

        // Update the event name in actionableEvents array
        activity.actionableEvents[0].eventName = newEventName;

        // Register new event in mapping
        sourceEventInfo[sourceContract][newEventName] = EventInfo(activityId, ActionType.Occurred);
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
     * @dev Process a single action
     * @param action The action to process
     */
    function handleAction(Action calldata action) external onlyOwner {
        _handleAction(action);
    }

    /**
     * @dev Process multiple actions in a single call
     * @param actions Array of actions to process (each action includes blockNumber for idempotency)
     */
    function batchHandleAction(Action[] calldata actions) external onlyOwner {
        for (uint256 i = 0; i < actions.length; i++) {
            _handleAction(actions[i]);
        }
    }

    /**
     * @dev Emergency function to reset idempotency state
     * @param newBlockNumber The block number to set as currentBlockHandled
     */
    function emergencyOverride(uint256 newBlockNumber) external onlyOwner {
        _clearProcessedHashes();
        currentBlockHandled = newBlockNumber;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal function to register a new activity
     */
    function _addActivity(
        uint256 activityId,
        string name,
        ActivityType activityType,
        uint256 emissionRate,
        address sourceContract,
        ActionableEvent[] actionableEvents
    ) internal {
        require(activities[activityId].sourceContract == address(0), "Activity already exists");
        require(sourceContract != address(0), "Invalid source contract address");
        require(bytes(name).length > 0, "Name cannot be empty");

        // Check for duplicate event names within the same sourceContract using the mapping
        for (uint256 evtIdx = 0; evtIdx < actionableEvents.length; evtIdx++) {
            require(
                sourceEventInfo[sourceContract][actionableEvents[evtIdx].eventName].activityId == 0,
                "Event name already exists for this source contract"
            );
        }

        Activity storage activity = activities[activityId];
        activity.name = name;
        activity.activityType = activityType;
        activity.emissionRate = emissionRate;
        activity.accRewardPerStake = 0;
        activity.lastUpdateTime = block.timestamp;
        activity.totalStake = 0;
        activity.sourceContract = sourceContract;

        // Copy actionable events and register in mapping
        for (uint256 i = 0; i < actionableEvents.length; i++) {
            activity.actionableEvents.push(actionableEvents[i]);
            sourceEventInfo[sourceContract][actionableEvents[i].eventName] = EventInfo(activityId, actionableEvents[i].actionType);
        }

        activityIds.push(activityId);

        // Update total emission rate
        totalRewardsEmission += emissionRate;

        emit ActivityAdded(activityId, name, emissionRate, sourceContract);
    }

    /**
     * @dev Internal function to handle stake changes with idempotency
     * @param action The action to process (includes blockNumber for idempotency)
     */
    function _handleAction(Action action) internal {
        // ═══════════════════════════════════════════════════════════════════════
        // IDEMPOTENCY CHECK
        // ═══════════════════════════════════════════════════════════════════════

        // If blockNumber < currentBlockHandled, this is an old event - silently ignore
        if (action.blockNumber < currentBlockHandled) {
            return;
        }

        // If blockNumber > currentBlockHandled, we've moved to a new block
        if (action.blockNumber > currentBlockHandled) {
            // Clear the processed hashes from the previous block
            _clearProcessedHashes();
            // Update to the new block
            currentBlockHandled = action.blockNumber;
        }

        // Calculate event hash from blockNumber and eventIndex (uniquely identifies event on chain)
        string eventHash = keccak256(action.blockNumber, action.eventIndex);

        // blockNumber == currentBlockHandled at this point
        // Check if we've already processed this event hash
        if (processedHashes[eventHash]) {
            // Already processed - silently ignore (idempotency)
            return;
        }

        // Mark this event hash as processed
        processedHashes[eventHash] = true;
        processedHashList.push(eventHash);

        // ═══════════════════════════════════════════════════════════════════════
        // ACTION PROCESSING
        // ═══════════════════════════════════════════════════════════════════════

        // Look up activity and action type by sourceContract and eventName
        EventInfo storage eventInfo = sourceEventInfo[action.sourceContract][action.eventName];
        require(eventInfo.activityId != 0, "Activity not found for source/event");

        uint256 activityId = eventInfo.activityId;
        ActionType actionType = eventInfo.actionType;
        Activity storage activity = activities[activityId];

        // Validate action type against activity type
        if (actionType == ActionType.Deposit || actionType == ActionType.Withdraw) {
            require(activity.activityType == ActivityType.Position, "Only for Position activities");
        } else {
            require(activity.activityType == ActivityType.OneTime, "Only for OneTime activities");
        }

        // Determine if this is an increase or decrease
        bool isIncrease = (actionType != ActionType.Withdraw);

        // 1) Update global index using current totalStake (before user update)
        _updateActivityIndex(activityId);

        // 2) Settle user's pending rewards using index delta (Aave-style)
        RewardsUserInfo storage userState = userInfo[action.user][activityId];
        uint256 oldStake = userState.stake;
        uint256 pendingRewards = 0;

        if (oldStake > 0) {
            // Calculate rewards using index delta: stake × (currentIndex - userIndex)
            uint256 indexDelta = activity.accRewardPerStake - userState.userIndex;
            pendingRewards = (oldStake * indexDelta) / PRECISION_MULTIPLIER;

            if (pendingRewards > 0) {
                unclaimedRewards[action.user] += pendingRewards;
            }
        }

        // 3) Calculate new stake from delta
        uint256 newStake;
        if (isIncrease) {
            newStake = oldStake + action.amount;
        } else {
            require(oldStake >= action.amount, "Insufficient stake");
            newStake = oldStake - action.amount;
        }

        // 4) Update user stake and index snapshot
        userState.stake = newStake;
        userState.userIndex = activity.accRewardPerStake;

        // 5) Update total stake internally (secure calculation)
        activity.totalStake = activity.totalStake + newStake - oldStake;

        emit UserStakeUpdated(activityId, action.user, oldStake, newStake, pendingRewards);
    }

    /**
     * @dev Clear all processed hashes when moving to a new block
     * This keeps storage bounded to only the hashes of the current block
     */
    function _clearProcessedHashes() internal {
        for (uint256 i = 0; i < processedHashList.length; i++) {
            delete processedHashes[processedHashList[i]];
        }
        // Clear the array
        processedHashList = [];
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
        RewardsUserInfo storage userState = userInfo[user][activityId];
        uint256 userStake = userState.stake;

        if (userStake > 0) {
            // Calculate rewards using index delta: stake × (currentIndex - userIndex)
            uint256 indexDelta = activity.accRewardPerStake - userState.userIndex;
            uint256 pending = (userStake * indexDelta) / PRECISION_MULTIPLIER;

            if (pending > 0) {
                unclaimedRewards[user] += pending;
            }

            // Update user index to current (without changing stake)
            userState.userIndex = activity.accRewardPerStake;
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
