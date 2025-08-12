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

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct RewardsEngineArgs {
        address[] initialRewardTokens;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // Reward token management: tracks which tokens can be distributed as rewards
    Token[] public record rewardTokens;
    mapping(address => uint) public record rewardTokenMap;

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

        emit RewardTokenRemoved(tokenAddress);
    }



}
