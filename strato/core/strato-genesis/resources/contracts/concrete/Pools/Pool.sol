// SPDX-License-Identifier: MIT
import "PoolFactory.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Admin/AdminRegistry.sol";
import "../Admin/FeeCollector.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title Pool
 * @notice A decentralized exchange (DEX) liquidity pool for trading between two ERC20 tokens
 * @dev This contract implements an automated market maker (AMM) with constant product formula
 * 
 * Key Features:
 * - Automated market making using x * y = k formula
 * - Liquidity provision and removal with LP token rewards
 * - Swap functionality with configurable fees
 * - Fee distribution between protocol and liquidity providers
 * - Reentrancy protection for security
 * 
 * Fee Structure:
 * - Total swap fee is split between protocol and LP providers
 * - Protocol fee goes to fee collector
 * - LP fee is distributed to liquidity providers based on their share
 * 
 * @author Mercata Protocol
 * @version 1.0.0
 */
contract record Pool is Ownable {
    
    // ============ EVENTS ============
    
    /// @notice Emitted when a swap occurs
    /// @param sender The address that initiated the swap
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    /// @param amountIn The amount of input tokens
    /// @param amountOut The amount of output tokens received
    event Swap(address sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    
    /// @notice Emitted when liquidity is added to the pool
    /// @param provider The address that provided liquidity
    /// @param tokenBAmount The amount of tokenB added
    /// @param tokenAAmount The amount of tokenA added
    event AddLiquidity(address provider, uint256 tokenBAmount, uint256 tokenAAmount);
    
        /// @notice Emitted when liquidity is removed from the pool
    /// @param provider The address that removed liquidity
    /// @param tokenBAmount The amount of tokenB received
    /// @param tokenAAmount The amount of tokenA received
    event RemoveLiquidity(address provider, uint256 tokenBAmount, uint256 tokenAAmount);
    
    /// @notice Emitted when excess tokens are skimmed from the pool
    /// @param to The address that received the excess tokens
    /// @param tokenAAmount The amount of excess tokenA skimmed
    /// @param tokenBAmount The amount of excess tokenB skimmed
    event Skim(address to, uint256 tokenAAmount, uint256 tokenBAmount);

    /// @notice Emitted when the pool's reserves are synced with current balances
    /// @param tokenABalance The new balance of tokenA
    /// @param tokenBBalance The new balance of tokenB
    event Sync(uint256 tokenABalance, uint256 tokenBBalance);

    // ============ STATE VARIABLES ============
    
    /// @notice The first token in the trading pair
    Token public tokenA;
    
    /// @notice The second token in the trading pair
    Token public tokenB;
    
    /// @notice The liquidity provider token representing ownership in the pool
    Token public lpToken;

    /// @notice Reentrancy guard to prevent recursive calls
    bool private locked;   
    
    /// @notice Current exchange rate from tokenA to tokenB
    decimal public aToBRatio;
    
    /// @notice Current exchange rate from tokenB to tokenA
    decimal public bToARatio;

    /// @notice Current balance of tokenA in the pool
    uint public tokenABalance;
    
    /// @notice Current balance of tokenB in the pool
    uint public tokenBBalance;

    /// @notice Pool-specific swap fee rate in basis points (0 = use factory default)
    uint256 public swapFeeRate;
    
    /// @notice Pool-specific LP share percentage in basis points (0 = use factory default)
    uint256 public lpSharePercent;
    
    /// @notice Whether to charge swap fees on internal zap swaps (default: true)
    bool public zapSwapFeesEnabled = true;
    
    // ============ MODIFIERS ============
    
    /// @notice Prevents reentrant calls to functions
    /// @dev Uses a simple boolean lock to prevent recursive calls
    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    // ============ INTERNAL FUNCTIONS ============
    
    /// @notice Get the fee collector address from the factory
    /// @return The address of the fee collector contract
    function _feeCollector() internal view returns (address) {
        return PoolFactory(owner()).feeCollector();
    }

    /// @notice Get the token factory address from the factory
    /// @return The address of the token factory contract
    function _tokenFactory() internal view returns (address) {
        return PoolFactory(owner()).tokenFactory();
    }

    /// @notice Get the effective swap fee rate for this pool
    /// @return The swap fee rate in basis points (uses pool-specific rate if set, otherwise factory default)
    function _swapFeeRate() internal view returns (uint256) {
        if (swapFeeRate == 0) {
            return PoolFactory(owner()).swapFeeRate();
        }
        return swapFeeRate;
    }

    /// @notice Get the effective LP share percentage for this pool
    /// @return The LP share percentage in basis points (uses pool-specific rate if set, otherwise factory default)
    function _lpSharePercent() internal view returns (uint256) {
        if (lpSharePercent == 0) {
            return PoolFactory(owner()).lpSharePercent();
        }
        return lpSharePercent;
    }

    // ============ CONSTRUCTOR ============
    
    /// @notice Initialize a new liquidity pool
    /// @param tokenAAddr The address of the first token in the pair
    /// @param tokenBAddr The address of the second token in the pair
    /// @param lpTokenAddr The address of the LP token contract
    /// @dev The pool owner is set to the factory that creates it
    constructor(
        address tokenAAddr, 
        address tokenBAddr,
        address lpTokenAddr
    ) Ownable(msg.sender) {
        require(tokenAAddr != address(0), "Zero tokenA address");
        require(tokenBAddr != address(0), "Zero tokenB address");
        require(lpTokenAddr != address(0), "Zero lpToken address");
        
        tokenA = Token(tokenAAddr);
        tokenB = Token(tokenBAddr);
        lpToken = Token(lpTokenAddr);
    }

    // ============ UTILITY FUNCTIONS ============
    /// @notice Sync the pool's reserves with current balances (external version)
    /// @dev Updates reserves to match current token balances
    function sync() external onlyOwner {
        tokenABalance = ERC20(tokenA).balanceOf(address(this));
        tokenBBalance = ERC20(tokenB).balanceOf(address(this));
        _updateRatios();
        emit Sync(tokenABalance, tokenBBalance);
    }

    /// @notice Force balances to match reserves
    /// @param to Address to send the excess tokens to
    function skim(address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        uint256 excessA = ERC20(tokenA).balanceOf(address(this)) - tokenABalance;
        uint256 excessB = ERC20(tokenB).balanceOf(address(this)) - tokenBBalance;

        if (excessA > 0) {
            require(ERC20(tokenA).transfer(to, excessA), "TokenA skim failed");
        }
        if (excessB > 0) {
            require(ERC20(tokenB).transfer(to, excessB), "TokenB skim failed");
        }

        emit Skim(to, excessA, excessB);
    }
    /// @notice Update the pool's ratios
    /// @dev Called after operations that change token balances
    function _updateRatios() internal {
        aToBRatio = _getCurrentTokenRatio(true);
        bToARatio = _getCurrentTokenRatio(false);
    }

    /// @notice Update the pool's state variables with new balances
    /// @param newTokenABalance The new tokenA balance
    /// @param newTokenBBalance The new tokenB balance
    function _updateStateVars(uint256 newTokenABalance, uint256 newTokenBBalance) internal {
        tokenABalance = newTokenABalance;
        tokenBBalance = newTokenBBalance;
        _updateRatios();
    }

    /// @notice Calculate the current exchange ratio between tokens
    /// @param isAToB If true, calculate A to B ratio; if false, calculate B to A ratio
    /// @return The exchange ratio as a decimal value
    /// @dev Returns 0 if either reserve is too small to calculate a meaningful ratio
    function _getCurrentTokenRatio(bool isAToB) internal view returns (decimal) {
        decimal tokenAReserve = decimal(tokenABalance);
        decimal tokenBReserve = decimal(tokenBBalance);

        if (tokenAReserve <= 0.000000000000000000 || tokenBReserve <= 0.000000000000000000) {
            return 0.000000000000000000;
        }

        if (isAToB) {
            return decimal((tokenBReserve * 1.000000000000000000) / tokenAReserve) / 1.000000000000000000;
        } else {
            return decimal((tokenAReserve * 1.000000000000000000) / tokenBReserve) / 1.000000000000000000;
        }
        return 0.000000000000000000;
    }

    // ============ CORE FUNCTIONS ============
    
    /// @notice Add liquidity to the pool and receive LP tokens
    /// @param tokenBAmount The amount of tokenB to add (used as the base for calculations)
    /// @param maxTokenAAmount The maximum amount of tokenA the user is willing to add
    /// @return The amount of LP tokens minted to the user
    /// @dev For the first liquidity provision, tokenBAmount determines the initial LP token supply
    /// @dev For subsequent provisions, the ratio must match the current pool ratio
    /// @dev The user must approve both tokens for transfer before calling this function
    function addLiquidity(
        uint256 tokenBAmount,
        uint256 maxTokenAAmount,
        uint256 deadline
    ) external returns (uint256) {
        require(tokenBAmount > 0 && maxTokenAAmount > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        uint256 tokenAAmount;
        uint256 mintAmount;
        
        if (totalLiquidity > 0) {
            tokenAAmount = (tokenBAmount * tokenABalance / tokenBBalance) + 1;
            mintAmount = tokenBAmount * totalLiquidity / tokenBBalance;
            require(maxTokenAAmount >= tokenAAmount, "Insufficient tokenA amount");
        } else {
            tokenAAmount = maxTokenAAmount;
            mintAmount = tokenBAmount;
        }

        lpToken.mint(msg.sender, mintAmount);
        require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
        require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");

        _updateStateVars(tokenABalance + tokenAAmount, tokenBBalance + tokenBAmount);
        emit AddLiquidity(msg.sender, tokenBAmount, tokenAAmount);
        return mintAmount;
    }

    /// @notice Remove liquidity from the pool by burning LP tokens
    /// @param lpTokenAmount The amount of LP tokens to burn
    /// @param minTokenBAmount The minimum amount of tokenB to receive
    /// @param minTokenAAmount The minimum amount of tokenA to receive
    /// @return tokenBAmount The amount of tokenB received
    /// @return tokenAAmount The amount of tokenA received
    /// @dev The user must approve LP tokens for burning before calling this function
    /// @dev Slippage protection is provided by minTokenBAmount and minTokenAAmount parameters
    function removeLiquidity(
        uint256 lpTokenAmount, 
        uint256 minTokenBAmount,
        uint256 minTokenAAmount,
        uint256 deadline
    ) external returns (uint256, uint256) {
        require(lpTokenAmount > 0 && minTokenBAmount > 0 && minTokenAAmount > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        require(totalLiquidity > 0, "No liquidity");
        uint256 tokenAReserve = tokenABalance;
        uint256 tokenBReserve = tokenBBalance;
        uint256 tokenBAmount = lpTokenAmount * tokenBReserve / totalLiquidity;
        uint256 tokenAAmount = lpTokenAmount * tokenAReserve / totalLiquidity;
        
        require(tokenBAmount >= minTokenBAmount && tokenAAmount >= minTokenAAmount, "Insufficient amounts");

        require(ERC20(tokenB).transfer(msg.sender, tokenBAmount), "TokenB transfer failed");
        require(ERC20(tokenA).transfer(msg.sender, tokenAAmount), "TokenA transfer failed");

        lpToken.burn(msg.sender, lpTokenAmount);
        _updateStateVars(tokenABalance - tokenAAmount, tokenBBalance - tokenBAmount);
        emit RemoveLiquidity(msg.sender, tokenBAmount, tokenAAmount);

        return (tokenBAmount, tokenAAmount);
    }

    // ============ SWAP FUNCTIONS ============
    
    /// @notice Calculate the output amount for a given input amount using the constant product formula
    /// @param inputAmount The amount of input tokens
    /// @param inputReserve The current reserve of input tokens
    /// @param outputReserve The current reserve of output tokens
    /// @return The amount of output tokens that would be received
    /// @dev Uses the formula: outputAmount = (inputAmount * outputReserve) / (inputReserve + inputAmount)
    function getInputPrice(
        uint256 inputAmount,
        uint256 inputReserve,
        uint256 outputReserve
    ) pure returns (uint256) {
        require(inputReserve > 0 && outputReserve > 0, "Invalid reserves");
        uint256 numerator = inputAmount * outputReserve;
        uint256 denominator = inputReserve + inputAmount;
        return numerator / denominator;
    }

    /// @notice Swap tokens using the automated market maker
    /// @param isAToB If true, swap tokenA for tokenB; if false, swap tokenB for tokenA
    /// @param amountIn The amount of input tokens to swap
    /// @param minAmountOut The minimum amount of output tokens to receive (slippage protection)
    /// @return amountOut The actual amount of output tokens received
    /// @dev The user must approve input tokens for transfer before calling this function
    /// @dev Fees are automatically deducted and distributed between protocol and LP providers
    /// @dev Reentrancy protection is applied to prevent attacks
    function swap(
        bool isAToB,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");

        Token inputToken = isAToB ? tokenA : tokenB;
        Token outputToken = isAToB ? tokenB : tokenA;

        uint256 inputReserve = isAToB ? tokenABalance : tokenBBalance;
        uint256 outputReserve = isAToB ? tokenBBalance : tokenABalance;

        uint256 fee = (amountIn * _swapFeeRate()) / 10000;
        uint256 lpFee = (fee * _lpSharePercent()) / 10000;
        uint256 protocolFee = fee - lpFee;

        uint256 netInput = amountIn - fee;

        // Transfer full amount to pool
        require(ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");
        
        // Send protocol fee to fee collector
        require(ERC20(inputToken).transfer(_feeCollector(), protocolFee), "Protocol fee transfer failed");

        amountOut = getInputPrice(netInput, inputReserve, outputReserve);
        require(amountOut >= minAmountOut, "Slippage check failed");

        require(ERC20(outputToken).transfer(msg.sender, amountOut), "Output xfer failed");

        // Update balances: net input stays in pool, output is sent out
        if (isAToB) {
            _updateStateVars(tokenABalance + netInput, tokenBBalance - amountOut);
        } else {
            _updateStateVars(tokenABalance - amountOut, tokenBBalance + netInput);
        }

        emit Swap(msg.sender, address(inputToken), address(outputToken), amountIn, amountOut);
    }

    // ============ ADMIN FUNCTIONS ============
    
    /// @notice Set fee parameters for this pool (owner only)
    /// @param newSwapFeeRate New swap fee rate in basis points (e.g., 30 = 0.3%)
    /// @param newLpSharePercent New LP share percentage in basis points (e.g., 7000 = 70%)
    /// @dev This function can only be called by the owner of the pool which is the PoolFactory contract
    /// @dev Updates both swap fee rate and LP share percentage in a single transaction
    /// @dev If set to 0, the pool will use the factory's default values
    /// @dev Maximum swap fee rate is 10% (1000 basis points)
    /// @dev LP share percentage must be between 0 and 100% (0-10000 basis points)
    function setFeeParameters(
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent
    ) external onlyOwner {
        require(newSwapFeeRate <= 1000, "Swap fee rate too high"); // Max 10%
        require(newLpSharePercent <= 10000, "LP share percent too high"); // Max 100%
        require(newLpSharePercent > 0, "LP share must be greater than 0");
        
        swapFeeRate = newSwapFeeRate;
        lpSharePercent = newLpSharePercent;
    }

    /// @notice Toggle swap fees for internal zap swaps (owner only)
    /// @param enabled Whether to charge fees on internal zap swaps
    /// @dev When disabled, zap swaps are fee-free, improving capital efficiency for liquidity providers
    /// @dev When enabled, zap swaps follow the same fee structure as regular swaps
    function setZapSwapFeesEnabled(bool enabled) external onlyOwner {
        zapSwapFeesEnabled = enabled;
    }

    // ============ ZAP-IN (SINGLE TOKEN LIQUIDITY) ============
    /// @notice Calculate integer square root of a uint256 (Babylonian method)
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /// @notice Compute optimal swap amount for single-sided liquidity (generic fee)
    /// @dev Derived from Uniswap-V2 zap formula, generalized for fee in basis points.
    function _getOptimalSwapAmount(
        uint256 reserveIn,
        uint256 userIn,
        uint256 feeBps
    ) internal pure returns (uint256) {
        require(feeBps < 10000, "Fee too high");
        uint256 a = 10000 - feeBps; // effective multipler (e.g., 9970 for 0.3%)
        uint256 b = 10000;
        // term = sqrt( reserveIn * ( userIn * 4 * a * b + reserveIn * (a + b) ** 2 ) )
        uint256 term1 = userIn * 4 * a * b;
        uint256 term2 = reserveIn * (a + b) * (a + b);
        uint256 term = _sqrt(reserveIn * (term1 + term2));
        uint256 numerator = term - reserveIn * (a + b);
        return numerator / (2 * a);
    }

    function _internalSwapForZap(
        bool isAToB,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        uint256 inputReserve = isAToB ? tokenABalance : tokenBBalance;
        uint256 outputReserve = isAToB ? tokenBBalance : tokenABalance;

        uint256 netInput;
        if (zapSwapFeesEnabled) {
            uint256 fee = (amountIn * _swapFeeRate()) / 10000;
            uint256 lpFee = (fee * _lpSharePercent()) / 10000;
            uint256 protocolFee = fee - lpFee;
            netInput = amountIn - fee;

            // protocol fee sent to collector
            Token inputToken = isAToB ? tokenA : tokenB;
            require(ERC20(inputToken).transfer(_feeCollector(), protocolFee), "Fee transfer failed");
        } else {
            netInput = amountIn; // no fees charged
        }

        amountOut = getInputPrice(netInput, inputReserve, outputReserve);

        // Note: For internal zap swaps, we don't update balances here since all tokens
        // stay in the pool. The balance updates happen in the calling function.
    }

    function _mintLiquidityAfterZap(
        uint256 tokenBContribution,
        uint256 tokenAContribution
    ) internal returns (uint256 liquidityMinted) {
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        uint256 tokenBReserve = tokenBBalance;
        liquidityMinted = tokenBContribution * totalLiquidity / tokenBReserve;
        
        lpToken.mint(msg.sender, liquidityMinted);
        emit AddLiquidity(msg.sender, tokenBContribution, tokenAContribution);
    }

    /// @notice Add liquidity with a single token (zap-in)
    /// @param isAToB True if depositing tokenA only, false if depositing tokenB only
    /// @param amountIn Amount of the single token supplied by the user
    /// @param deadline Expiry timestamp
    /// @return liquidityMinted Amount of LP tokens minted to the user
    function addLiquiditySingleToken(
        bool isAToB,
        uint256 amountIn,
        uint256 deadline
    ) external returns (uint256 liquidityMinted) {
        require(amountIn > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        require(ERC20(lpToken).totalSupply() > 0, "POOL_EMPTY");

        // Transfer full amount from user to pool
        Token depositToken = isAToB ? tokenA : tokenB;
        uint256 reserveIn = isAToB ? tokenABalance : tokenBBalance; // reserve before deposit
        require(ERC20(depositToken).transferFrom(msg.sender, address(this), amountIn), "Deposit transfer failed");
        
        uint256 feeBps = zapSwapFeesEnabled ? _swapFeeRate() : 0;
        uint256 swapAmt = _getOptimalSwapAmount(reserveIn, amountIn, feeBps);

        uint256 amountOut = _internalSwapForZap(isAToB, swapAmt);

        uint256 tokenAContribution;
        uint256 tokenBContribution;
        if (isAToB) {
            tokenAContribution = amountIn - swapAmt;
            tokenBContribution = amountOut;
        } else {
            tokenBContribution = amountIn - swapAmt;
            tokenAContribution = amountOut;
        }

        liquidityMinted = _mintLiquidityAfterZap(tokenBContribution, tokenAContribution);
        _updateStateVars(tokenABalance + tokenAContribution, tokenBBalance + tokenBContribution);
    }
}