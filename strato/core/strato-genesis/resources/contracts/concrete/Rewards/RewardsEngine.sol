// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

contract record RewardsEngine is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event RewardTokenAdded(address indexed token);
    event RewardTokenRemoved(address indexed token);
    event MultiplierAdded(string indexed name);
    event MultiplierRemoved(string indexed name);
    event ActionAdded(string indexed actionType, address indexed asset, string multiplierName);
    event ActionRemoved(string indexed actionType, address indexed asset);
    event RewardsUpdated(address indexed user, string indexed actionType, address indexed asset);

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct RewardsEngineArgs {
        address[] initialRewardTokens;
    }

    struct Multiplier {
        string name;
        mapping(address => uint256) factors; // rewardToken -> factor
    }

    struct Action {
        string actionType;
        address asset;
        string multiplierName;
        address owner;
        uint256 createdAt;         // timestamp when Action was added
    }

    struct UserBalance {
        uint256 balance;           // accrued reward over time
        uint256 createdAt;         // timestamp when UserBalance was created
        uint256 modifiedAt;        // timestamp when balance was last modified
        uint256 lastSeenAmount;    // last seen amount for a given Action (for estimate feature)
    }

    struct CurrentBalance {
        address rewardToken;
        string actionType;
        address asset;
        uint256 currentBalance;
    }

    struct ActionKey {
        string actionType;
        address asset;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    /* uint256 private constant DEFAULT_MULTIPLIER_FACTOR = 1;
       REQUESTED: https://github.com/blockapps/strato-platform/issues/4474
     */
    uint256 private DEFAULT_MULTIPLIER_FACTOR = 1;

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // Reward token management: tracks which tokens can be distributed as rewards
    Token[] public record rewardTokens;
    mapping(address => uint) public record rewardTokenMap;

    // Multiplier management: tracks multiplier factors per reward token
    string[] public record multiplierNames;
    mapping(string => uint) public record multiplierMap;
    mapping(string => Multiplier) public record multipliers;

    // Action management: nested mapping from actionType -> asset -> Action
    mapping(string => mapping(address => Action)) public record actions;

    // User balances: actionType -> asset -> rewardToken -> userAddress -> UserBalance
    mapping(string => mapping(address => mapping(address => mapping(address => UserBalance)))) public record balances;

    // Reward calculation delegate
    address public rewardDelegate;

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(
        RewardsEngineArgs memory args,
        address initialOwner
    ) Ownable(initialOwner) {
        _ownershipGranted = true;
        for (uint i = 0; i < args.initialRewardTokens.length; i++) {
            _addRewardToken(args.initialRewardTokens[i]);
        }
        _ownershipGranted = false;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // DELEGATE MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function setRewardDelegate(address _rewardDelegate) external onlyOwner {
        rewardDelegate = _rewardDelegate;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REWARD TOKEN MANAGEMENT CAPABILITIES
    // ═════════════════════════════════════════════════════════════════════════

    function addRewardToken(address tokenAddress) external onlyOwner {
        _addRewardToken(tokenAddress);
    }

    function removeRewardToken(address tokenAddress) external onlyOwner {
        _removeRewardToken(tokenAddress);
    }

    function addRewardTokens(address[] calldata tokenAddresses) external onlyOwner {
        for (uint i = 0; i < tokenAddresses.length; i++) {
            _addRewardToken(tokenAddresses[i]);
        }
    }

    function removeRewardTokens(address[] calldata tokenAddresses) external onlyOwner {
        for (uint i = 0; i < tokenAddresses.length; i++) {
            _removeRewardToken(tokenAddresses[i]);
        }
    }

    function _addRewardToken(address tokenAddress) internal {
        require(tokenAddress != address(0), "RewardsEngine: Invalid token address");
        require(rewardTokenMap[tokenAddress] == 0, "RewardsEngine: Token already added");

        rewardTokens.push(Token(tokenAddress));
        rewardTokenMap[tokenAddress] = rewardTokens.length;

        // Add default factor for this token in all existing multipliers
        for (uint i = 0; i < multiplierNames.length; i++) {
            string memory multiplierName = multiplierNames[i];
            multipliers[multiplierName].factors[tokenAddress] = DEFAULT_MULTIPLIER_FACTOR;
        }

        emit RewardTokenAdded(tokenAddress);
    }

    function _removeRewardToken(address tokenAddress) internal {
        require(tokenAddress != address(0), "RewardsEngine: Invalid token address");
        uint index = rewardTokenMap[tokenAddress];
        require(index > 0, "RewardsEngine: Token not found");

        uint arrayIndex = index - 1;
        uint lastIndex = rewardTokens.length - 1;

        if (arrayIndex != lastIndex) {
            Token lastToken = rewardTokens[lastIndex];
            rewardTokens[arrayIndex] = lastToken;
            rewardTokenMap[address(lastToken)] = index;
        }

	rewardTokens[lastIndex] = Token(address(0));
        rewardTokens.length -= 1;
        delete rewardTokenMap[tokenAddress];

        // Remove this token from all existing multipliers
        for (uint i = 0; i < multiplierNames.length; i++) {
            string memory multiplierName = multiplierNames[i];
            delete multipliers[multiplierName].factors[tokenAddress];
        }

        emit RewardTokenRemoved(tokenAddress);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MULTIPLIER MANAGEMENT CAPABILITIES
    // ═════════════════════════════════════════════════════════════════════════

    function addMultiplier(
        string calldata name,
        address[] calldata tokenAddresses,
        uint256[] calldata factors
    ) external onlyOwner {
        _addMultiplier(name, tokenAddresses, factors);
    }

    function removeMultiplier(string calldata name) external onlyOwner {
        _removeMultiplier(name);
    }

    function addMultipliers(
        string[] calldata names,
        address[][] calldata tokenAddresses,
        uint256[][] calldata factors
    ) external onlyOwner {
        require(names.length == tokenAddresses.length, "RewardsEngine: Array length mismatch");
        require(names.length == factors.length, "RewardsEngine: Array length mismatch");

        for (uint i = 0; i < names.length; i++) {
            _addMultiplier(names[i], tokenAddresses[i], factors[i]);
        }
    }

    function removeMultipliers(string[] calldata names) external onlyOwner {
        for (uint i = 0; i < names.length; i++) {
            _removeMultiplier(names[i]);
        }
    }

    function _addMultiplier(
        string calldata name,
        address[] calldata tokenAddresses,
        uint256[] calldata factors
    ) internal {
        require(name != "", "RewardsEngine: Empty multiplier name");
        require(multiplierMap[name] == 0, "RewardsEngine: Multiplier already exists");
        require(tokenAddresses.length == factors.length, "RewardsEngine: Array length mismatch");

        // Verify all registered reward tokens have a factor provided
        for (uint i = 0; i < rewardTokens.length; i++) {
            address tokenAddress = address(rewardTokens[i]);
            bool found = false;
            for (uint j = 0; j < tokenAddresses.length; j++) {
                if (tokenAddresses[j] == tokenAddress) {
                    require(factors[j] > 0, "RewardsEngine: Factor must be greater than 0");
                    found = true;
                    break;
                }
            }
            require(found, "RewardsEngine: Missing factor for registered reward token");
        }

        multiplierNames.push(name);
        multiplierMap[name] = multiplierNames.length;

        Multiplier storage multiplier = multipliers[name];
        multiplier.name = name;

        for (uint j = 0; j < tokenAddresses.length; j++) {
            multiplier.factors[tokenAddresses[j]] = factors[j];
        }

        emit MultiplierAdded(name);
    }

    function _removeMultiplier(string calldata name) internal {
        require(name != "", "RewardsEngine: Empty multiplier name");
        uint index = multiplierMap[name];
        require(index > 0, "RewardsEngine: Multiplier not found");

        // TODO: Check that no existing actions reference this multiplier
        // This requires tracking multiplier usage or iterating through all actions

        uint arrayIndex = index - 1;
        uint lastIndex = multiplierNames.length - 1;

        if (arrayIndex != lastIndex) {
            string memory lastName = multiplierNames[lastIndex];
            multiplierNames[arrayIndex] = lastName;
            multiplierMap[lastName] = index;
        }


	multiplierNames[lastIndex] = "";
        multiplierNames.length -= 1;
        delete multiplierMap[name];
        delete multipliers[name];

        emit MultiplierRemoved(name);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ACTION MANAGEMENT CAPABILITIES
    // ═════════════════════════════════════════════════════════════════════════

    function addAction(
        string calldata actionType,
        address asset,
        string calldata multiplierName,
        address owner
    ) external onlyOwner {
        _addAction(actionType, asset, multiplierName, owner);
    }

    function removeAction(
        string calldata actionType,
        address asset
    ) external onlyOwner {
        _removeAction(actionType, asset);
    }

    function _addAction(
        string calldata actionType,
        address asset,
        string calldata multiplierName,
        address owner
    ) internal {
        require(actionType != "", "RewardsEngine: Empty action type");
        require(asset != address(0), "RewardsEngine: Invalid asset address");
        require(multiplierName != "", "RewardsEngine: Empty multiplier name");
        require(owner != address(0), "RewardsEngine: Invalid owner address");

        // Check that multiplier exists
        require(multiplierMap[multiplierName] > 0, "RewardsEngine: Multiplier not found");

        // Check that the (actionType, asset) tuple is unique
        require(actions[actionType][asset].actionType == "", "RewardsEngine: Action already exists");

        actions[actionType][asset] = Action(
            actionType,
            asset,
            multiplierName,
            owner,
            block.timestamp
        );

        // Note: balances[actionType][asset][rewardToken][user] mappings are automatically
        // available in Solidity. UserBalance structs will be created on-demand when users interact.

        emit ActionAdded(actionType, asset, multiplierName);
    }

    function _removeAction(
        string calldata actionType,
        address asset
    ) internal {
        require(actionType != "", "RewardsEngine: Empty action type");
        require(asset != address(0), "RewardsEngine: Invalid asset address");

        // Check that action exists
        require(actions[actionType][asset].actionType != "", "RewardsEngine: Action not found");

        // TODO: Clean up existing user balances for this action
        // This would require iterating through all users, which is gas-expensive
        // For now, we leave existing balances orphaned but inaccessible

        delete actions[actionType][asset];

        emit ActionRemoved(actionType, asset);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REWARD CALCULATION UTILITIES
    // ═════════════════════════════════════════════════════════════════════════

    function calculateAccruedReward(
        UserBalance storage userBalance,
        uint256 amount,
        uint256 multiplierFactor
    ) internal view returns (uint256) {
        if (rewardDelegate != address(0)) {
            return rewardDelegate.delegatecall("calculateAccruedReward",
                userBalance.modifiedAt,
                amount,
                multiplierFactor
            );
        } else {
            uint256 currentTime = block.timestamp;
            uint256 timeDelta = currentTime - userBalance.modifiedAt;
            uint256 seconds_in_year = 60 * 60 * 24 * 365;
            return (amount * timeDelta * multiplierFactor) / seconds_in_year;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // UPDATE REWARDS FUNCTIONALITY
    // ═════════════════════════════════════════════════════════════════════════

    // This is a workaround to an issue requested in
    // https://github.com/blockapps/strato-platform/issues/4485. For now the
    // update function will not return balances, but once #4485 is fixed, it
    // will.
    function update(
        string calldata actionType,
        address[] calldata assets,
        uint256[] calldata amounts,
        address user
    ) external {
	_update(actionType, assets, amounts, user);
    }

    function _update(
        string calldata actionType,
        address[] calldata assets,
        uint256[] calldata amounts,
        address user
    ) internal returns (CurrentBalance[] memory) {
        require(actionType != "", "RewardsEngine: Empty action type");
        require(assets.length == amounts.length, "RewardsEngine: Array length mismatch");
        require(user != address(0), "RewardsEngine: Invalid user address");

	// length assets.length * rewardTokens.length
        CurrentBalance[] memory currentBalances = [];

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 amount = amounts[i];

            // Check that action exists and caller is authorized
            Action storage action = actions[actionType][asset];
            require(action.actionType != "", "RewardsEngine: Action not found");
            require(action.owner == msg.sender, "RewardsEngine: Unauthorized caller");

            // Get the multiplier for this action
            Multiplier storage multiplier = multipliers[action.multiplierName];

            // Update rewards for each reward token
            for (uint256 j = 0; j < rewardTokens.length; j++) {
                address rewardToken = address(rewardTokens[j]);

                UserBalance storage userBalance = balances[actionType][asset][rewardToken][user];

                uint256 currentTime = block.timestamp;
                uint256 multiplierFactor = multiplier.factors[rewardToken];

                // Initialize user balance if this is the first time
                if (userBalance.createdAt == 0) {
                    userBalance.createdAt = currentTime;
                    userBalance.modifiedAt = action.createdAt; // Use action's creation time
                    userBalance.balance = 0; // Start with zero balance
                }

                // Calculate and add accrued rewards
                uint256 accruedReward = calculateAccruedReward(userBalance, amount, multiplierFactor);
                userBalance.balance += accruedReward;
                userBalance.modifiedAt = currentTime;
                userBalance.lastSeenAmount = amount;

                currentBalances.push(CurrentBalance(
                    rewardToken,
                    actionType,
                    asset,
                    userBalance.balance
		));
            }

            emit RewardsUpdated(user, actionType, asset);
        }

        return currentBalances;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ESTIMATE REWARDS FUNCTIONALITY
    // ═════════════════════════════════════════════════════════════════════════

    // This is a workaround for the estimateRewards not being rendered properly
    function estimateReward(
        address userAddress,
        string calldata actionType,
        address asset,
        address rewardToken
    ) external view returns (uint256) {
        require(rewardTokenMap[rewardToken] > 0, "RewardsEngine: Reward token not registered");

        ActionKey[] memory actionKeysArray = [];
        actionKeysArray.push(ActionKey(actionType, asset));

        CurrentBalance[] memory results = estimateRewards(userAddress, actionKeysArray);

        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].rewardToken == rewardToken) {
                return results[i].currentBalance;
            }
        }
	return 0;
    }

    // When called via HTTP, this function will return 400 because of the
    // https://github.com/blockapps/strato-platform/issues/4485. This function
    // works, we are just waiting for the #4485 to be fixed
    function estimateRewards(
        address userAddress,
        ActionKey[] calldata actionKeys
    ) public view returns (CurrentBalance[] memory) {
        require(userAddress != address(0), "RewardsEngine: Invalid user address");

	// length actionKeys.length * rewardTokens.length
        CurrentBalance[] memory estimatedBalances = [];

        for (uint256 i = 0; i < actionKeys.length; i++) {
            string calldata actionType = actionKeys[i].actionType;
            address asset = actionKeys[i].asset;

            // Check that action exists
            Action storage action = actions[actionType][asset];
            require(action.actionType != "", "RewardsEngine: Action not found");

            // Get the multiplier for this action
            Multiplier storage multiplier = multipliers[action.multiplierName];

            // Estimate rewards for each reward token
            for (uint256 j = 0; j < rewardTokens.length; j++) {
                address rewardToken = address(rewardTokens[j]);

                UserBalance storage userBalance = balances[actionType][asset][rewardToken][userAddress];
                uint256 multiplierFactor = multiplier.factors[rewardToken];

                uint256 estimatedBalance = userBalance.balance;

                // Add potential accrued rewards using lastSeenAmount
                if (userBalance.createdAt > 0) {
                    uint256 accruedReward = calculateAccruedReward(userBalance, userBalance.lastSeenAmount, multiplierFactor);
                    estimatedBalance += accruedReward;
                }

                estimatedBalances.push(CurrentBalance(
                    rewardToken,
                    actionType,
                    asset,
                    estimatedBalance
		));
            }
        }

        return estimatedBalances;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CLAIM REWARDS
    // ═════════════════════════════════════════════════════════════════════════

    function claim(
        string calldata actionType,
        address[] calldata assets,
        address user
    ) external returns (CurrentBalance[] memory) {
        require(actionType != "", "RewardsEngine: Empty action type");
        require(user != address(0), "RewardsEngine: Invalid user address");
        require(user == msg.sender, "RewardsEngine: Only user can claim their own rewards");

        CurrentBalance[] memory claimedBalances = [];

        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];

            // Check that action exists
            Action storage action = actions[actionType][asset];
            require(action.actionType != "", "RewardsEngine: Action not found");

            // Get the multiplier for this action
            Multiplier storage multiplier = multipliers[action.multiplierName];

            // Update and claim rewards for each reward token
            for (uint256 j = 0; j < rewardTokens.length; j++) {
                address rewardToken = address(rewardTokens[j]);

                UserBalance storage userBalance = balances[actionType][asset][rewardToken][user];

                uint256 currentTime = block.timestamp;
                uint256 multiplierFactor = multiplier.factors[rewardToken];
                uint256 claimedAmount = userBalance.balance;

                // Add accrued rewards using lastSeenAmount
                if (userBalance.createdAt > 0) {
                    uint256 accruedReward = calculateAccruedReward(userBalance, userBalance.lastSeenAmount, multiplierFactor);
                    claimedAmount += accruedReward;
                }

                // Only mint and record if there's something to claim
                if (claimedAmount > 0) {
                    // Mint reward tokens to the user
                    Token(rewardToken).mint(user, claimedAmount);

                    // Nullify the balance
                    userBalance.balance = 0;
                    userBalance.modifiedAt = currentTime;

                    claimedBalances.push(CurrentBalance(
                        rewardToken,
                        actionType,
                        asset,
                        claimedAmount
                    ));
                }
            }
        }

        return claimedBalances;
    }

}
