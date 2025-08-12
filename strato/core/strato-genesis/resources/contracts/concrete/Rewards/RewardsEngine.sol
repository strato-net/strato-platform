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
    }

    struct UserBalance {
        uint256 balance;           // accrued reward over time
        uint256 createdAt;         // timestamp when UserBalance was created
        uint256 modifiedAt;        // timestamp when balance was last modified
        uint256 lastSeenAmount;    // last seen amount for a given Action (for estimate feature)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    uint256 private constant DEFAULT_MULTIPLIER_FACTOR = 1;

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

        rewardTokens.pop();
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
        require(bytes(name).length > 0, "RewardsEngine: Empty multiplier name");
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

        for (uint i = 0; i < tokenAddresses.length; i++) {
            multiplier.factors[tokenAddresses[i]] = factors[i];
        }

        emit MultiplierAdded(name);
    }

    function _removeMultiplier(string calldata name) internal {
        require(bytes(name).length > 0, "RewardsEngine: Empty multiplier name");
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

        multiplierNames.pop();
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
        require(bytes(actionType).length > 0, "RewardsEngine: Empty action type");
        require(asset != address(0), "RewardsEngine: Invalid asset address");
        require(bytes(multiplierName).length > 0, "RewardsEngine: Empty multiplier name");
        require(owner != address(0), "RewardsEngine: Invalid owner address");

        // Check that multiplier exists
        require(multiplierMap[multiplierName] > 0, "RewardsEngine: Multiplier not found");

        // Check that the (actionType, asset) tuple is unique
        require(bytes(actions[actionType][asset].actionType).length == 0, "RewardsEngine: Action already exists");

        actions[actionType][asset] = Action({
            actionType: actionType,
            asset: asset,
            multiplierName: multiplierName,
            owner: owner
        });

        // Initialize balances structure for this action
        // Note: UserBalance structs will be created on-demand when users interact with the system

        emit ActionAdded(actionType, asset, multiplierName);
    }

    function _removeAction(
        string calldata actionType,
        address asset
    ) internal {
        require(bytes(actionType).length > 0, "RewardsEngine: Empty action type");
        require(asset != address(0), "RewardsEngine: Invalid asset address");

        // Check that action exists
        require(bytes(actions[actionType][asset].actionType).length > 0, "RewardsEngine: Action not found");

        // TODO: Clean up existing user balances for this action
        // This would require iterating through all users, which is gas-expensive
        // For now, we leave existing balances orphaned but inaccessible

        delete actions[actionType][asset];

        emit ActionRemoved(actionType, asset);
    }

}
