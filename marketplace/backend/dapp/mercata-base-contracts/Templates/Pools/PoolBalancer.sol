// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Pool.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PoolBalancer
 * @dev Maintains the desired ratio in a liquidity pool by adding or removing liquidity
 */
contract PoolBalancer is Ownable {
    Pool public pool;
    ERC20 public token;
    ERC20 public stablecoin;
    
    // Target ratio of stable/token (scaled by 1e18)
    // For example, if target is 1:1, then targetRatio = 1e18
    uint256 public targetRatio;
    
    event BalanceAdjusted(uint256 stableAmount, uint256 tokenAmount);
    event TargetRatioUpdated(uint256 newRatio);

    constructor(
        address _poolAddress,
        uint256 _initialTargetRatio
    ) {
        pool = Pool(_poolAddress);
        token = pool.token();
        stablecoin = pool.stablecoin();
        targetRatio = _initialTargetRatio;
    }

    /**
     * @notice Updates the target ratio. Only owner can update.
     * @param newRatio New target ratio (scaled by 1e18)
     */
    function updateTargetRatio(uint256 newRatio) external onlyOwner {
        require(newRatio > 0, "Invalid ratio");
        targetRatio = newRatio;
        emit TargetRatioUpdated(newRatio);
    }

    /**
     * @notice Balances the pool by adding liquidity to reach target ratio
     * @param maxStableAmount Maximum stable tokens to use
     * @param maxTokenAmount Maximum tokens to use
     */
    function balance(uint256 maxStableAmount, uint256 maxTokenAmount) external onlyOwner {
        // Get current reserves
        uint256 stableReserve = stablecoin.balanceOf(address(pool));
        uint256 tokenReserve = token.balanceOf(address(pool));
        
        // Calculate current ratio (scaled by 1e18)
        uint256 currentRatio = (stableReserve * 1e18) / tokenReserve;
        
        require(currentRatio != targetRatio, "Pool already balanced");
        
        uint256 stableAmount;
        uint256 tokenAmount;
        
        if (currentRatio < targetRatio) {
            // Need more stable tokens
            stableAmount = ((tokenReserve * targetRatio) / 1e18) - stableReserve;
            tokenAmount = (stableAmount * tokenReserve) / stableReserve;
        } else {
            // Need more tokens
            tokenAmount = (stableReserve * 1e18) / targetRatio - tokenReserve;
            stableAmount = (tokenAmount * stableReserve) / tokenReserve;
        }
        
        // Cap at maximum amounts
        stableAmount = stableAmount > maxStableAmount ? maxStableAmount : stableAmount;
        tokenAmount = tokenAmount > maxTokenAmount ? maxTokenAmount : tokenAmount;
        
        require(stableAmount > 0 && tokenAmount > 0, "Invalid amounts calculated");
        
        // Approve tokens
        require(stablecoin.approve(address(pool), stableAmount), "Stable approve failed");
        require(token.approve(address(pool), tokenAmount), "Token approve failed");
        
        // Add liquidity to pool
        pool.addLiquidity(stableAmount, tokenAmount);
        
        emit BalanceAdjusted(stableAmount, tokenAmount);
    }

    /**
     * @notice Withdraw tokens from the contract
     * @param tokenAddress Address of token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawTokens(address tokenAddress, uint256 amount) external onlyOwner {
        ERC20 tokenToWithdraw = ERC20(tokenAddress);
        require(tokenToWithdraw.transfer(msg.sender, amount), "Transfer failed");
    }

    /**
     * @notice Get current pool ratio
     * @return ratio Current ratio of stable/token (scaled by 1e18)
     */
    function getCurrentRatio() external view returns (uint256) {
        uint256 stableReserve = stablecoin.balanceOf(address(pool));
        uint256 tokenReserve = token.balanceOf(address(pool));
        return (stableReserve * 1e18) / tokenReserve;
    }
} 