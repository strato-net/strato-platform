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

    /// @notice Update the pool's state variables (balances and ratios)
    /// @dev Called after operations that change token balances
    function _updateStateVars() internal {
        tokenABalance = ERC20(tokenA).balanceOf(address(this));
        tokenBBalance = ERC20(tokenB).balanceOf(address(this));
        aToBRatio = _getCurrentTokenRatio(true);
        bToARatio = _getCurrentTokenRatio(false);
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
        uint256 maxTokenAAmount
    ) external returns (uint256) {
        require(tokenBAmount > 0 && maxTokenAAmount > 0, "Invalid inputs");
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();

        if (totalLiquidity > 0) {
            uint256 tokenBReserve = ERC20(tokenB).balanceOf(address(this));
            uint256 tokenAReserve = ERC20(tokenA).balanceOf(address(this));
            uint256 tokenAAmount = (tokenBAmount * tokenAReserve / tokenBReserve) + 1;
            uint256 liquidityMinted = tokenBAmount * totalLiquidity / tokenBReserve;

            require(maxTokenAAmount >= tokenAAmount, "Insufficient tokenA amount");
            lpToken.mint(msg.sender, liquidityMinted);

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenBAmount, tokenAAmount);

            _updateStateVars();

            return liquidityMinted;
        } else {
            uint256 tokenAAmount = maxTokenAAmount;
            uint256 initialLiquidity = tokenBAmount;
            lpToken.mint(msg.sender, initialLiquidity);

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenBAmount, tokenAAmount);

            _updateStateVars();

            return initialLiquidity;
        }
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
        uint256 minTokenAAmount
    ) external returns (uint256, uint256) {
        require(lpTokenAmount > 0 && minTokenBAmount > 0 && minTokenAAmount > 0, "Invalid inputs");
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        require(totalLiquidity > 0, "No liquidity");
        uint256 tokenAReserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenBReserve = ERC20(tokenB).balanceOf(address(this));
        uint256 tokenBAmount = lpTokenAmount * tokenBReserve / totalLiquidity;
        uint256 tokenAAmount = lpTokenAmount * tokenAReserve / totalLiquidity;

        require(tokenBAmount >= minTokenBAmount && tokenAAmount >= minTokenAAmount, "Insufficient amounts");

        require(ERC20(tokenB).transfer(msg.sender, tokenBAmount), "TokenB transfer failed");
        require(ERC20(tokenA).transfer(msg.sender, tokenAAmount), "TokenA transfer failed");

        emit RemoveLiquidity(msg.sender, tokenBAmount, tokenAAmount);

        lpToken.burn(msg.sender, lpTokenAmount);

        _updateStateVars();

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
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");

        Token inputToken = isAToB ? tokenA : tokenB;
        Token outputToken = isAToB ? tokenB : tokenA;

        uint256 inputReserve = ERC20(inputToken).balanceOf(address(this));
        uint256 outputReserve = ERC20(outputToken).balanceOf(address(this));

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

        _updateStateVars();

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
}
