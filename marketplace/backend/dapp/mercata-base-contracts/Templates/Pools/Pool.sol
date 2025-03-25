// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../Oracles/OracleService.sol";
import "../ERC20/ERC20.sol";

/**
 * @title Simple ERC20/Stablecoin Liquidity Pool
 * @notice A basic implementation of x*y=k formula without fees
 */
abstract contract Pool is ERC20 {
    IERC20 public token;
    IERC20 public stablecoin;
    OracleService public oracle;
    
    // Events
    event Swap(address indexed user, uint256 amountIn, uint256 amountOut);
    event AddLiquidity(address indexed provider, uint256 tokenAmount, uint256 stablecoinAmount);
    event RemoveLiquidity(address indexed provider, uint256 tokenAmount, uint256 stablecoinAmount);
    
    constructor(
        address tokenAddr, 
        address stablecoinAddr,
        address oracleAddr
    ) ERC20("Simple LP", "SLP") {
        token = IERC20(tokenAddr);
        stablecoin = IERC20(stablecoinAddr);
        oracle = OracleService(oracleAddr);
    }
    
    /**
     * @notice Add liquidity to the pool
     * @param tokenAmount Amount of tokens to deposit
     * @param stablecoinAmount Amount of stablecoin to deposit
     * @return liquidity Amount of LP tokens minted
     */
    function addLiquidity(uint256 tokenAmount, uint256 stablecoinAmount) external returns (uint256 liquidity) {
        require(tokenAmount > 0 && stablecoinAmount > 0, "Amounts must be > 0");
        
        uint256 totalSupplyAmount = totalSupply();
        
        // First liquidity provider sets the ratio
        if (totalSupplyAmount == 0) {
            liquidity = stablecoinAmount;  // Use stablecoin amount as initial LP tokens
        } else {
            // Get oracle price to verify deposit ratio
            (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
            
            // Check if deposit matches oracle price
            uint256 expectedStablecoin = (tokenAmount * uint256(oraclePrice)) / (10 ** 18);
            require(
                stablecoinAmount >= expectedStablecoin * 99 / 100 &&  // Allow 1% deviation
                stablecoinAmount <= expectedStablecoin * 101 / 100,
                "Amount ratio doesn't match oracle price"
            );
            
            // Calculate liquidity based on stablecoin proportion
            liquidity = (stablecoinAmount * totalSupplyAmount) / stablecoin.balanceOf(address(this));
        }
        
        _mint(msg.sender, liquidity);
        
        token.transferFrom(msg.sender, address(this), tokenAmount);
        stablecoin.transferFrom(msg.sender, address(this), stablecoinAmount);
        
        emit AddLiquidity(msg.sender, tokenAmount, stablecoinAmount);
        return liquidity;
    }
    
    /**
     * @notice Remove liquidity from the pool
     * @param lpAmount Amount of LP tokens to burn
     * @return tokenAmount Amount of tokens withdrawn
     * @return stablecoinAmount Amount of stablecoin withdrawn
     */
    function removeLiquidity(uint256 lpAmount) external returns (uint256 tokenAmount, uint256 stablecoinAmount) {
        require(lpAmount > 0, "Amount must be > 0");
        
        uint256 totalSupplyAmount = totalSupply();
        uint256 tokenReserve = token.balanceOf(address(this));
        uint256 stablecoinReserve = stablecoin.balanceOf(address(this));
        
        // Calculate proportional amounts based on LP tokens
        tokenAmount = (lpAmount * tokenReserve) / totalSupplyAmount;
        stablecoinAmount = (lpAmount * stablecoinReserve) / totalSupplyAmount;
        
        // Verify the ratio matches oracle price (with 1% tolerance)
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        uint256 expectedStablecoin = (tokenAmount * uint256(oraclePrice)) / (10 ** 18);
        require(
            stablecoinAmount >= expectedStablecoin * 99 / 100 &&
            stablecoinAmount <= expectedStablecoin * 101 / 100,
            "Withdrawal ratio doesn't match oracle price"
        );
        
        _burn(msg.sender, lpAmount);
        
        token.transfer(msg.sender, tokenAmount);
        stablecoin.transfer(msg.sender, stablecoinAmount);
        
        emit RemoveLiquidity(msg.sender, tokenAmount, stablecoinAmount);
        return (tokenAmount, stablecoinAmount);
    }
    
    /**
     * @notice Swap tokens using x*y=k formula
     * @param isStablecoinToToken True if swapping stablecoin for token
     * @param amountIn Amount of input token
     * @return amountOut Amount of output token
     */
    function swap(bool isStablecoinToToken, uint256 amountIn) external returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        
        if (isStablecoinToToken) {
            // Converting USDC to TOKEN using oracle price
            amountOut = (amountIn * (10 ** 18)) / uint256(oraclePrice);
            stablecoin.transferFrom(msg.sender, address(this), amountIn);
            token.transfer(msg.sender, amountOut);
        } else {
            // Converting TOKEN to USDC using oracle price
            amountOut = (amountIn * uint256(oraclePrice)) / (10 ** 18);
            token.transferFrom(msg.sender, address(this), amountIn);
            stablecoin.transfer(msg.sender, amountOut);
        }
        
        emit Swap(msg.sender, amountIn, amountOut);
        return amountOut;
    }
    
    /**
     * @notice Get quote for swap
     * @param isStablecoinToToken True if swapping stablecoin for token
     * @param amountIn Amount of input token
     * @return Amount of output token
     */
    function getQuote(bool isStablecoinToToken, uint256 amountIn) external view returns (uint256) {
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        
        if (isStablecoinToToken) {
            return (amountIn * (10 ** 18)) / uint256(oraclePrice);
        } else {
            return (amountIn * uint256(oraclePrice)) / (10 ** 18);
        }
    }
}