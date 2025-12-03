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

/**
 * @dev Activity configuration - set by governance
 */
struct Activity {
    string name;                 // Human-readable name for this activity (e.g., "GOLDST-USDST LP Staking")
    ActivityType activityType;   // Type of activity (Position or OneTime)
    uint256 emissionRate;        // CATA tokens emitted per second for this activity
    address sourceContract;      // Address of the contract this activity tracks (for external service mapping)
    ActionableEvent[] actionableEvents; // Events that can trigger actions for this activity
    uint256 minAmount;           // Minimum amount required to qualify for rewards (0 = no minimum)
    uint256 weightMultiplier;    // Scaling factor for OneTime activities (1e18 = 1x, prevents unbounded stake growth)
}

/**
 * @dev Activity state - automatically updated by reward logic
 */
struct ActivityState {
    uint256 accRewardPerStake;   // Accumulated reward per 1 unit of stake (scaled by 1e18)
    uint256 lastUpdateTime;      // Last timestamp when the index was updated
    uint256 totalStake;          // Sum of all users' effective stakes for this activity
}

/**
 * Rewards - incentives controller for distributing CATA rewards
 *
 * This contract implements a global incentives controller that tracks rewards
 * for various protocol activities without requiring users to stake or transfer
 * their LP tokens.
 *
 * Key features:
 * - No asset custody - contract only tracks accounting state
 * - O(1) gas efficiency - no loops over users or epochs
 * - Global index pattern inspired by Aave's Incentives Controller
 * - Order-independent event processing with permanent idempotency tracking
 * - Service passes raw event data, contract computes hashes and lookups
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
    event MaxBatchSizeUpdated(uint256 oldMaxBatchSize, uint256 newMaxBatchSize);
    event ActivityMinAmountUpdated(uint256 indexed activityId, uint256 oldMinAmount, uint256 newMinAmount);
    event ActivityWeightUpdated(uint256 indexed activityId, uint256 oldWeight, uint256 newWeight);
    event SeasonAnnouncement(string seasonName, uint256 timestamp);
    event ActionProcessed(
        uint256 indexed activityId,
        address indexed user,
        address indexed sourceContract,
        string eventName,
        ActionType actionType,
        uint256 amount,
        uint256 blockNumber,
        uint256 eventIndex
    );

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

    // Mapping of activityId to Activity struct (governance/configuration)
    mapping(uint256 => Activity) public record activities;

    // Mapping of activityId to ActivityState struct (runtime state)
    mapping(uint256 => ActivityState) public record activityStates;

    // Array of all activity IDs for enumeration
    uint256[] public activityIds;

    // Counter for generating unique activity IDs (starts at 1, 0 means "not found")
    uint256 public nextActivityId = 1;

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
    mapping(address => mapping(string => EventInfo)) public record sourceEventInfo;

    // ═══════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY STATE
    // ═══════════════════════════════════════════════════════════════════════

    // Mapping of all processed event hashes: keccak256(blockNumber, eventIndex) => bool
    // Persisted forever to enable order-independent event processing
    // Key is computed on-chain from blockNumber and eventIndex provided by service
    mapping(string => bool) public record processedEvents;

    // Highest block number seen (for monitoring/debugging only, not used in contract logic)
    uint256 public highestBlockSeen;

    // ═══════════════════════════════════════════════════════════════════════
    // GOVERNANCE PARAMETERS
    // ═══════════════════════════════════════════════════════════════════════

    // Maximum number of actions that can be processed in a single batch
    uint256 public maxBatchSize = 100;

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
     * @param name Human-readable name for the activity
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param sourceContract Address of the contract this activity tracks
     * @param actionableEvents Array of events that can trigger actions (must have at least one)
     * @return activityId The auto-generated unique identifier for the activity
     */
    function addPositionActivity(
        string  name,
        uint256 emissionRate,
        address sourceContract,
        ActionableEvent[]  actionableEvents
    ) external onlyOwner returns (uint256) {
        require(actionableEvents.length > 0, "At least one actionable event required");
        return _addActivity(name, ActivityType.Position, emissionRate, sourceContract, actionableEvents);
    }

    /**
     * @dev Register a new OneTime activity for reward distribution
     * @param name Human-readable name for the activity
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param sourceContract Address of the contract this activity tracks
     * @param eventName Name of the event that triggers this one-time action
     * @return activityId The auto-generated unique identifier for the activity
     */
    function addOneTimeActivity(
        string  name,
        uint256 emissionRate,
        address sourceContract,
        string  eventName
    ) external onlyOwner returns (uint256) {
        ActionableEvent[]  actionableEvents = new ActionableEvent[](1);
        actionableEvents[0] = ActionableEvent(eventName, ActionType.Occurred);
        return _addActivity(name, ActivityType.OneTime, emissionRate, sourceContract, actionableEvents);
    }

    /**
     * @dev Register a new Position activity with deposit and withdraw event names - simplified for AdminRegistry
     * @param name Human-readable name for the activity
     * @param emissionRate CATA tokens emitted per second for this activity
     * @param sourceContract Address of the contract this activity tracks
     * @param depositEventName Name of the deposit event
     * @param withdrawEventName Name of the withdraw event
     * @return activityId The auto-generated unique identifier for the activity
     */
    function addPositionActivitySimple(
        string  name,
        uint256 emissionRate,
        address sourceContract,
        string  depositEventName,
        string  withdrawEventName
    ) external onlyOwner returns (uint256) {
        ActionableEvent[]  actionableEvents = new ActionableEvent[](2);
        actionableEvents[0] = ActionableEvent(depositEventName, ActionType.Deposit);
        actionableEvents[1] = ActionableEvent(withdrawEventName, ActionType.Withdraw);
        return _addActivity(name, ActivityType.Position, emissionRate, sourceContract, actionableEvents);
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

        // Update total emission rate (subtract old, add new)
        totalRewardsEmission = totalRewardsEmission - oldRate + newEmissionRate;

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

        // Remove old sourceContract mappings from routing table
        for (uint256 removeIdx = 0; removeIdx < activity.actionableEvents.length; removeIdx++) {
            string  evt = activity.actionableEvents[removeIdx].eventName;
            delete sourceEventInfo[oldSourceContract][evt].activityId;
            delete sourceEventInfo[oldSourceContract][evt].actionType;
        }

        // Check for collisions at destination contract before updating
        for (uint256 checkIdx = 0; checkIdx < activity.actionableEvents.length; checkIdx++) {
            string  evt = activity.actionableEvents[checkIdx].eventName;
            EventInfo storage existing = sourceEventInfo[newSourceContract][evt];
            require(
                existing.activityId == 0 || existing.activityId == activityId,
                "Event already used by another activity for this sourceContract"
            );
        }

        // Update the activity's config
        activity.sourceContract = newSourceContract;

        // Add new sourceContract mappings to routing table
        for (uint256 j = 0; j < activity.actionableEvents.length; j++) {
            ActionableEvent  ae = activity.actionableEvents[j];
            sourceEventInfo[newSourceContract][ae.eventName] = EventInfo(activityId, ae.actionType);
        }

        emit SourceContractUpdated(activityId, oldSourceContract, newSourceContract);
    }

    /**
     * @dev Update the maximum batch size for processing actions
     * @param newMaxBatchSize The new maximum batch size (must be > 0)
     */
    function setMaxBatchSize(uint256 newMaxBatchSize) external onlyOwner {
        require(newMaxBatchSize > 0, "Batch size must be greater than 0");

        uint256 oldMaxBatchSize = maxBatchSize;
        maxBatchSize = newMaxBatchSize;

        emit MaxBatchSizeUpdated(oldMaxBatchSize, newMaxBatchSize);
    }

    /**
     * @dev Update the minimum amount required for an activity
     * @param activityId The activity to update
     * @param newMinAmount The new minimum amount (0 = no minimum)
     */
    function setActivityMinAmount(uint256 activityId, uint256 newMinAmount) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");

        uint256 oldMinAmount = activity.minAmount;
        activity.minAmount = newMinAmount;

        emit ActivityMinAmountUpdated(activityId, oldMinAmount, newMinAmount);
    }

    /**
     * @dev Update the weight multiplier for a OneTime activity
     * @param activityId The activity to update
     * @param newWeight The new weight multiplier (1e18 = 1x, prevents unbounded stake growth)
     */
    function setActivityWeight(uint256 activityId, uint256 newWeight) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(activity.activityType == ActivityType.OneTime, "Only for OneTime activities");
        require(newWeight > 0, "Weight must be > 0");

        uint256 oldWeight = activity.weightMultiplier;
        activity.weightMultiplier = newWeight;

        emit ActivityWeightUpdated(activityId, oldWeight, newWeight);
    }

    /**
     * @dev Announce a new season for off-chain tracking and demarcation
     * @param seasonName Human-readable name for the season (e.g., "Season 2", "Q1 2025")
     *
     * This updates all activity indices first to ensure all rewards are properly
     * accrued at the season boundary before any subsequent parameter changes.
     */
    function announceNewSeason(string  seasonName) external onlyOwner {
        // Update all activity indices to current timestamp
        // This ensures pending rewards are calculated with current parameters
        // before governance makes any emission rate or config changes for the new season
        massUpdateActivitiesIndices();

        emit SeasonAnnouncement(seasonName, block.timestamp);
    }

    /**
     * @dev Update the actionable events for an existing Position activity
     * @param activityId The activity to update
     * @param newActionableEvents The new array of actionable events
     *
     * This function enforces that the activity has zero total stake to prevent
     * inconsistent state between user stakes and event mappings.
     */
    function setPositionActivityEvents(
        uint256 activityId,
        ActionableEvent[]  newActionableEvents
    ) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(activity.activityType == ActivityType.Position, "Only for Position activities");

        ActivityState storage state = activityStates[activityId];
        require(state.totalStake == 0, "Cannot change events while activity has stakes");
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

        // Enforce correct action types for Position activities
        for (uint256 typeIdx = 0; typeIdx < newActionableEvents.length; typeIdx++) {
            require(
                newActionableEvents[typeIdx].actionType == ActionType.Deposit ||
                newActionableEvents[typeIdx].actionType == ActionType.Withdraw,
                "Position activity cannot use Occurred action type"
            );
        }

        // Remove old event mappings (delete individual fields as SolidVM requires)
        for (uint256 oldIdx = 0; oldIdx < activity.actionableEvents.length; oldIdx++) {
            delete sourceEventInfo[sourceContract][activity.actionableEvents[oldIdx].eventName].activityId;
            delete sourceEventInfo[sourceContract][activity.actionableEvents[oldIdx].eventName].actionType;
        }

        // Rebuild actionable events array by reassigning the entire array
        // Note: In SolidVM, we reassign the array field directly
        activity.actionableEvents = newActionableEvents;

        // Register new event mappings
        for (uint256 j = 0; j < newActionableEvents.length; j++) {
            sourceEventInfo[sourceContract][newActionableEvents[j].eventName] = EventInfo(activityId, newActionableEvents[j].actionType);
        }
    }

    /**
     * @dev Update the event name for an existing OneTime activity
     * @param activityId The activity to update
     * @param newEventName The new event name
     *
     * This function enforces that the activity has zero total stake to prevent
     * inconsistent state between user stakes and event mappings.
     */
    function setOneTimeActivityEvent(
        uint256 activityId,
        string  newEventName
    ) external onlyOwner {
        Activity storage activity = activities[activityId];
        require(activity.sourceContract != address(0), "Activity does not exist");
        require(activity.activityType == ActivityType.OneTime, "Only for OneTime activities");

        ActivityState storage state = activityStates[activityId];
        require(state.totalStake == 0, "Cannot change events while activity has stakes");
        require(bytes(newEventName).length > 0, "Event name cannot be empty");

        address sourceContract = activity.sourceContract;

        // Check that new event name doesn't conflict with another activity
        EventInfo storage existingInfo = sourceEventInfo[sourceContract][newEventName];
        require(
            existingInfo.activityId == 0 || existingInfo.activityId == activityId,
            "Event name already exists for this source contract"
        );

        // Remove old event mapping (delete individual fields as SolidVM requires)
        string  oldEventName = activity.actionableEvents[0].eventName;
        delete sourceEventInfo[sourceContract][oldEventName].activityId;
        delete sourceEventInfo[sourceContract][oldEventName].actionType;

        // Update the event name in actionableEvents array
        activity.actionableEvents[0].eventName = newEventName;

        // Register new event in mapping
        sourceEventInfo[sourceContract][newEventName] = EventInfo(activityId, ActionType.Occurred);
    }

    /**
     * @dev Claim accumulated rewards for the caller
     * @param activityIdsToSettle Array of activity IDs to settle rewards from
     */
    function claimRewards(uint256[] calldata activityIdsToSettle) external {
        address user = msg.sender;

        // Update indices and settle pending rewards for all specified activities
        for (uint256 i = 0; i < activityIdsToSettle.length; i++) {
            _settlePendingRewards(activityIdsToSettle[i], user);
        }

        // Get total accumulated rewards
        uint256 totalRewards = unclaimedRewards[user];
        require(totalRewards > 0, "No rewards to claim");

        // Ensure contract has sufficient reward tokens
        require(rewardToken.balanceOf(address(this)) >= totalRewards, "Insufficient reward tokens");

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

        // Ensure contract has sufficient reward tokens
        require(rewardToken.balanceOf(address(this)) >= totalRewards, "Insufficient reward tokens");

        // Reset unclaimed rewards and transfer CATA tokens
        unclaimedRewards[user] = 0;
        rewardToken.transfer(user, totalRewards);

        emit RewardsClaimed(user, totalRewards);
    }

    /**
     * @dev Process a single action
     * @param sourceContract The source contract this event originated from
     * @param eventName The event name that triggered this action
     * @param user The user whose stake is changing
     * @param amount The amount of stake change
     * @param blockNumber Block number this event originated from (for idempotency)
     * @param eventIndex Event index within the block (for idempotency)
     */
    function handleAction(
        address sourceContract,
        string calldata eventName,
        address user,
        uint256 amount,
        uint256 blockNumber,
        uint256 eventIndex
    ) external onlyOwner {
        Action  action = Action({
            sourceContract: sourceContract,
            eventName: eventName,
            user: user,
            amount: amount,
            blockNumber: blockNumber,
            eventIndex: eventIndex
        });
        _handleAction(action);
    }

    /**
     * @dev Process multiple actions in a single call
     * @param sourceContracts Array of source contracts
     * @param eventNames Array of event names
     * @param users Array of user addresses
     * @param amounts Array of amounts
     * @param blockNumbers Array of block numbers
     * @param eventIndexes Array of event indexes
     */
    function batchHandleAction(
        address[] calldata sourceContracts,
        string[] calldata eventNames,
        address[] calldata users,
        uint256[] calldata amounts,
        uint256[] calldata blockNumbers,
        uint256[] calldata eventIndexes
    ) external onlyOwner {
        require(sourceContracts.length <= maxBatchSize, "Batch too large");
        require(
            sourceContracts.length == eventNames.length &&
            eventNames.length == users.length &&
            users.length == amounts.length &&
            amounts.length == blockNumbers.length &&
            blockNumbers.length == eventIndexes.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < sourceContracts.length; i++) {
            Action  action = Action({
                sourceContract: sourceContracts[i],
                eventName: eventNames[i],
                user: users[i],
                amount: amounts[i],
                blockNumber: blockNumbers[i],
                eventIndex: eventIndexes[i]
            });
            _handleAction(action);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal function to register a new activity
     * @return activityId The auto-generated unique identifier for the activity
     */
    function _addActivity(
        string  name,
        ActivityType activityType,
        uint256 emissionRate,
        address sourceContract,
        ActionableEvent[]  actionableEvents
    ) internal returns (uint256) {
        require(sourceContract != address(0), "Invalid source contract address");
        require(bytes(name).length > 0, "Name cannot be empty");

        // Check for duplicate event names within the same sourceContract using the mapping
        for (uint256 evtIdx = 0; evtIdx < actionableEvents.length; evtIdx++) {
            require(
                sourceEventInfo[sourceContract][actionableEvents[evtIdx].eventName].activityId == 0,
                "Event name already exists for this source contract"
            );
        }

        // Enforce correct action types for each activity type
        if (activityType == ActivityType.Position) {
            for (uint256 posIdx = 0; posIdx < actionableEvents.length; posIdx++) {
                require(
                    actionableEvents[posIdx].actionType == ActionType.Deposit ||
                    actionableEvents[posIdx].actionType == ActionType.Withdraw,
                    "Position activity cannot use Occurred action type"
                );
            }
        }

        if (activityType == ActivityType.OneTime) {
            for (uint256 oneIdx = 0; oneIdx < actionableEvents.length; oneIdx++) {
                require(
                    actionableEvents[oneIdx].actionType == ActionType.Occurred,
                    "OneTime activity must use Occurred action type"
                );
            }
        }

        // Generate unique activity ID
        // Workaround for SolidVM bug: initialize if zero
        if (nextActivityId == 0) {
            nextActivityId = 1;
        }
        uint256 activityId = nextActivityId;
        nextActivityId++;

        // Initialize activity configuration
        Activity storage activity = activities[activityId];
        activity.name = name;
        activity.activityType = activityType;
        activity.emissionRate = emissionRate;
        activity.sourceContract = sourceContract;
        activity.minAmount = 0; // No minimum by default
        activity.weightMultiplier = 1e18; // 1x multiplier by default

        // Initialize activity state
        ActivityState storage state = activityStates[activityId];
        state.accRewardPerStake = 0;
        state.lastUpdateTime = block.timestamp;
        state.totalStake = 0;

        // Copy actionable events and register in mapping
        for (uint256 regIdx = 0; regIdx < actionableEvents.length; regIdx++) {
            activity.actionableEvents.push(actionableEvents[regIdx]);
            sourceEventInfo[sourceContract][actionableEvents[regIdx].eventName] = EventInfo(activityId, actionableEvents[regIdx].actionType);
        }

        activityIds.push(activityId);

        // Update total emission rate
        totalRewardsEmission += emissionRate;

        emit ActivityAdded(activityId, name, emissionRate, sourceContract);

        return activityId;
    }

    /**
     * @dev Internal function to handle stake changes with idempotency
     * @param action The action to process (raw event data from service)
     *
     * IDEMPOTENCY: Events can be processed in ANY order. The contract uses
     * keccak256(blockNumber, eventIndex) as a unique event identifier (SolidVM style).
     *
     * ACCOUNTING DEPENDENCIES: While idempotency is order-independent, the
     * rewards accounting has logical dependencies (e.g., Deposit before Withdraw).
     * If a Withdraw arrives before its corresponding Deposit, it will revert with
     * "Insufficient stake". The service should retry such events after processing
     * earlier events from the same user/activity.
     */
    function _handleAction(Action calldata action) internal {
        // ═══════════════════════════════════════════════════════════════════════
        // IDEMPOTENCY CHECK
        // ═══════════════════════════════════════════════════════════════════════

        // Calculate event hash from blockNumber and eventIndex (uniquely identifies event on chain)
        // Contract computes hash - service just provides the raw data
        // SolidVM keccak256 takes multiple args directly and returns string
        string eventHash = keccak256(action.blockNumber, action.eventIndex);

        // Check if we've already processed this event hash
        if (processedEvents[eventHash]) {
            // Already processed - silently ignore (idempotency)
            return;
        }

        // Mark this event hash as processed (permanent, never cleared)
        processedEvents[eventHash] = true;

        // Update highestBlockSeen for monitoring (not used in logic)
        if (action.blockNumber > highestBlockSeen) {
            highestBlockSeen = action.blockNumber;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // ACTIVITY LOOKUP
        // ═══════════════════════════════════════════════════════════════════════

        // Look up activity and action type by sourceContract and eventName
        // Service passes raw event data, contract does the lookup
        EventInfo storage eventInfo = sourceEventInfo[action.sourceContract][action.eventName];
        require(eventInfo.activityId != 0, "Activity not found for source/event");

        uint256 activityId = eventInfo.activityId;
        ActionType actionType = eventInfo.actionType;

        Activity storage activity = activities[activityId];      // Config
        ActivityState storage state = activityStates[activityId]; // State

        // Validate action inputs
        require(action.user != address(0), "Invalid user");

        // Extra enforcement for OneTime safety (protects against governance misconfiguration)
        if (activity.activityType == ActivityType.OneTime) {
            require(actionType == ActionType.Occurred, "Invalid action for OneTime activity");
        }

        // Handle zero-amount events explicitly
        if (action.amount == 0) {
            // Zero-amount events are silently ignored (no stake change, no index update, no rewards)
            // Event is still marked as processed for idempotency
            return;
        }

        // Check minimum amount threshold (event is still marked as processed for idempotency)
        if (activity.minAmount > 0 && action.amount < activity.minAmount) {
            // Amount below threshold - no stake change, no rewards
            return;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // ACTION PROCESSING
        // ═══════════════════════════════════════════════════════════════════════

        // Validate action type against activity type
        if (actionType == ActionType.Deposit || actionType == ActionType.Withdraw) {
            require(activity.activityType == ActivityType.Position, "Only for Position activities");
        } else {
            require(activity.activityType == ActivityType.OneTime, "Only for OneTime activities");
        }

        // Emit event for off-chain monitoring and auditing (after all validation passes)
        emit ActionProcessed(
            activityId,
            action.user,
            action.sourceContract,
            action.eventName,
            actionType,
            action.amount,
            action.blockNumber,
            action.eventIndex
        );

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
            uint256 indexDelta = state.accRewardPerStake - userState.userIndex;
            pendingRewards = (oldStake * indexDelta) / PRECISION_MULTIPLIER;

            if (pendingRewards > 0) {
                unclaimedRewards[action.user] += pendingRewards;
            }
        }

        // 3) Calculate new stake from delta
        uint256 newStake;

        if (activity.activityType == ActivityType.OneTime) {
            // OneTime activities: apply weight multiplier to prevent unbounded stake growth
            // Note: If weightMultiplier is very low and action.amount is small, weighted may round to 0.
            // In this case, the event is still processed (index updated, existing rewards settled),
            // but stake doesn't increase. Governance should set minAmount to prevent this if undesired.
            uint256 weighted = (action.amount * activity.weightMultiplier) / PRECISION_MULTIPLIER;
            newStake = oldStake + weighted;
        } else {
            // Position activities: normal increase/decrease behavior
            if (isIncrease) {
                newStake = oldStake + action.amount;
            } else {
                // If withdraw amount exceeds stake, event likely arrived out of order
                // Revert so service can retry after processing earlier events
                require(oldStake >= action.amount, "Insufficient stake");
                newStake = oldStake - action.amount;
            }
        }

        // 4) Update user stake and index snapshot
        userState.stake = newStake;
        userState.userIndex = state.accRewardPerStake;

        // 5) Update total stake internally (secure calculation)
        state.totalStake = state.totalStake + newStake - oldStake;

        emit UserStakeUpdated(activityId, action.user, oldStake, newStake, pendingRewards);
    }

    /**
     * @dev Settle pending rewards for a user without changing their stake
     * @param activityId The activity to settle rewards for
     * @param user The user to settle rewards for
     */
    function _settlePendingRewards(uint256 activityId, address user) internal {
        // Update the activity index first
        _updateActivityIndex(activityId);

        ActivityState storage state = activityStates[activityId];
        RewardsUserInfo storage userState = userInfo[user][activityId];
        uint256 userStake = userState.stake;

        if (userStake > 0) {
            // Calculate rewards using index delta: stake × (currentIndex - userIndex)
            uint256 indexDelta = state.accRewardPerStake - userState.userIndex;
            uint256 pending = (userStake * indexDelta) / PRECISION_MULTIPLIER;

            if (pending > 0) {
                unclaimedRewards[user] += pending;
            }

            // Update user index to current (without changing stake)
            userState.userIndex = state.accRewardPerStake;
        }
    }

    /**
     * @dev Updates the global reward index for an activity
     * @param activityId The activity to update
     */
    function _updateActivityIndex(uint256 activityId) internal {
        Activity storage activity = activities[activityId];      // Config
        ActivityState storage state = activityStates[activityId]; // State

        // If no time has passed, nothing to update
        if (block.timestamp <= state.lastUpdateTime) {
            return;
        }

        // If there's no stake, just update the timestamp
        if (state.totalStake == 0) {
            state.lastUpdateTime = block.timestamp;
            return;
        }

        // Calculate time elapsed
        uint256 dt = block.timestamp - state.lastUpdateTime;

        // Calculate rewards accrued during this period
        uint256 reward = activity.emissionRate * dt;

        // Update the cumulative index
        state.accRewardPerStake += (reward * PRECISION_MULTIPLIER) / state.totalStake;
        state.lastUpdateTime = block.timestamp;

        emit ActivityIndexUpdated(activityId, state.accRewardPerStake, state.totalStake);
    }

}
