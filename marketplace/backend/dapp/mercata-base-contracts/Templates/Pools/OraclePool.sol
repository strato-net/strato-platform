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
    event Swap(address indexed user, uint amountIn, uint amountOut);
    event AddLiquidity(address indexed provider, uint tokenAmount, uint stablecoinAmount);
    event RemoveLiquidity(address indexed provider, uint tokenAmount, uint stablecoinAmount);
    
    constructor(
        address tokenAddr, 
        address stablecoinAddr,
        address oracleAddr
    ) ERC20("Simple LP", "SLP") {
        token = IERC20(tokenAddr);
        stablecoin = IERC20(stablecoinAddr);
        oracle = OracleService(oracleAddr);
    }

    // 1000000000000000000000000
    
    /**
     * @notice Add liquidity to the pool
     * @param tokenAmount Amount of tokens to deposit
     * @param stablecoinAmount Amount of stablecoin to deposit
     * @return liquidity Amount of LP tokens minted
     */
    function addLiquidity(uint tokenAmount, uint stablecoinAmount) external returns (uint liquidity) {
        require(tokenAmount > 0 && stablecoinAmount > 0, "Amounts must be > 0");
        
        uint totalSupplyAmount = totalSupply();
        
        // First liquidity provider sets the ratio
        if (totalSupplyAmount == 0) {
            liquidity = stablecoinAmount;  // Use stablecoin amount as initial LP tokens
        } else {
            // Use getQuote to verify deposit ratio
            uint expectedStablecoin = getQuote(false, tokenAmount);
            
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
    function removeLiquidity(uint lpAmount) external returns (uint tokenAmount, uint stablecoinAmount) {
        require(lpAmount > 0, "Amount must be > 0");
        
        uint totalSupplyAmount = totalSupply();
        uint tokenReserve = token.balanceOf(address(this));
        uint stablecoinReserve = stablecoin.balanceOf(address(this));
        
        // Calculate proportional amounts based on LP tokens
        tokenAmount = (lpAmount * tokenReserve) / totalSupplyAmount;
        stablecoinAmount = (lpAmount * stablecoinReserve) / totalSupplyAmount;
        
        // Use getQuote to verify withdrawal ratio
        uint expectedStablecoin = getQuote(false, tokenAmount);
        
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
    function swap(bool isStablecoinToToken, uint amountIn) external returns (uint amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        
        amountOut = getQuote(isStablecoinToToken, amountIn);
        
        if (isStablecoinToToken) {
            stablecoin.transferFrom(msg.sender, address(this), amountIn);
            token.transfer(msg.sender, amountOut);
        } else {
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
    function getQuote(bool isStablecoinToToken, uint amountIn) public view returns (uint) {
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        
        if (isStablecoinToToken) {
            return (amountIn) / uint(oraclePrice);
        } else {
            return (amountIn * uint(oraclePrice));
        }
    }
}