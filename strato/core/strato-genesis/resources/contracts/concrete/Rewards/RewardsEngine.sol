// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";
import "../Lending/LiquidityPool.sol";

contract record RewardsEngine is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event RewardTokenAdded(address indexed token);
    event RewardTokenRemoved(address indexed token);
    event EligiblePoolAdded(address indexed poolAddress, address indexed token);
    event EligiblePoolRemoved(address indexed poolAddress);
    event EligiblePoolEnabled(address indexed poolAddress);
    event EligiblePoolDisabled(address indexed poolAddress);
    event EligiblePoolAddressModified(address indexed oldPoolAddress, address indexed newPoolAddress);

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct InitialEligiblePool {
        address poolAddress;
        address token;
    }

    struct RewardsEngineArgs {
        address[] initialRewardTokens;
        InitialEligiblePool[] initialEligiblePools;
    }

    struct EligiblePool {
        bool enabled;
        address poolAddress;
        address token;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // Reward token management: tracks which tokens can be distributed as rewards
    Token[] public record rewardTokens;
    mapping(address => uint) public record rewardTokenMap;

    // Eligible pools management: tracks which pools users can earn rewards from
    EligiblePool[] public record eligiblePools;
    mapping(address => uint) public record eligiblePoolMap;


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
        for (uint i = 0; i < args.initialEligiblePools.length; i++) {
            _addEligiblePool(args.initialEligiblePools[i].poolAddress, args.initialEligiblePools[i].token);
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

    // ═════════════════════════════════════════════════════════════════════════
    // ELIGIBLE POOL MANAGEMENT CAPABILITIES
    // ═════════════════════════════════════════════════════════════════════════

    function addEligiblePool(address poolAddress, address token) external onlyOwner {
        _addEligiblePool(poolAddress, token);
    }

    function removeEligiblePool(address poolAddress) external onlyOwner {
        _removeEligiblePool(poolAddress);
    }

    function enableEligiblePool(address poolAddress) external onlyOwner {
        _setEligiblePoolEnabled(poolAddress, true);
    }

    function disableEligiblePool(address poolAddress) external onlyOwner {
        _setEligiblePoolEnabled(poolAddress, false);
    }

    function modifyEligiblePoolAddress(address oldPoolAddress, address newPoolAddress) external onlyOwner {
        _modifyEligiblePoolAddress(oldPoolAddress, newPoolAddress);
    }

    function addEligiblePools(address[] calldata poolAddresses, address[] calldata tokens) external onlyOwner {
        require(poolAddresses.length == tokens.length, "RewardsEngine: Arrays length mismatch");
        for (uint i = 0; i < poolAddresses.length; i++) {
            _addEligiblePool(poolAddresses[i], tokens[i]);
        }
    }

    function removeEligiblePools(address[] calldata poolAddresses) external onlyOwner {
        for (uint i = 0; i < poolAddresses.length; i++) {
            _removeEligiblePool(poolAddresses[i]);
        }
    }

    // INTERNAL

    function _addEligiblePool(address poolAddress, address token) internal {
        require(poolAddress != address(0), "RewardsEngine: Invalid pool address");
        require(token != address(0), "RewardsEngine: Invalid token address");
        require(eligiblePoolMap[poolAddress] == 0, "RewardsEngine: Pool already added");

        eligiblePools.push(EligiblePool({
            enabled: true,
            poolAddress: poolAddress,
            token: token
        }));
        eligiblePoolMap[poolAddress] = eligiblePools.length;

        emit EligiblePoolAdded(poolAddress, token);
    }

    function _removeEligiblePool(address poolAddress) internal {
        require(poolAddress != address(0), "RewardsEngine: Invalid pool address");
        uint index = eligiblePoolMap[poolAddress];
        require(index > 0, "RewardsEngine: Pool not found");

        uint arrayIndex = index - 1;
        uint lastIndex = eligiblePools.length - 1;

        if (arrayIndex != lastIndex) {
            EligiblePool memory lastPool = eligiblePools[lastIndex];
            eligiblePools[arrayIndex] = lastPool;
            eligiblePoolMap[lastPool.poolAddress] = index;
        }

        eligiblePools.pop();
        delete eligiblePoolMap[poolAddress];

        emit EligiblePoolRemoved(poolAddress);
    }

    function _setEligiblePoolEnabled(address poolAddress, bool enabled) internal {
        require(poolAddress != address(0), "RewardsEngine: Invalid pool address");
        uint index = eligiblePoolMap[poolAddress];
        require(index > 0, "RewardsEngine: Pool not found");

        uint arrayIndex = index - 1;
        eligiblePools[arrayIndex].enabled = enabled;

        if (enabled) {
            emit EligiblePoolEnabled(poolAddress);
        } else {
            emit EligiblePoolDisabled(poolAddress);
        }
    }

    function _modifyEligiblePoolAddress(address oldPoolAddress, address newPoolAddress) internal {
        require(oldPoolAddress != address(0), "RewardsEngine: Invalid old pool address");
        require(newPoolAddress != address(0), "RewardsEngine: Invalid new pool address");
        require(eligiblePoolMap[newPoolAddress] == 0, "RewardsEngine: New pool address already exists");

        uint index = eligiblePoolMap[oldPoolAddress];
        require(index > 0, "RewardsEngine: Pool not found");

        uint arrayIndex = index - 1;
        eligiblePools[arrayIndex].poolAddress = newPoolAddress;

        eligiblePoolMap[newPoolAddress] = index;
        delete eligiblePoolMap[oldPoolAddress];

        emit EligiblePoolAddressModified(oldPoolAddress, newPoolAddress);
    }


}
