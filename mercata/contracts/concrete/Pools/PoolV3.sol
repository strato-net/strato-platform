// SPDX-License-Identifier: MIT
import "PoolV3Factory.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/// @notice Per-tick state for concentrated liquidity accounting
struct V3TickInfo {
    uint liquidityGross;
    int liquidityNet;
    int feeGrowthOutsideA;
    int feeGrowthOutsideB;
    bool initialized;
}

/// @notice A liquidity position over a tick range, keyed by (owner, tickLower, tickUpper)
struct V3Position {
    uint liquidity;
    int feeGrowthInsideALast;
    int feeGrowthInsideBLast;
    uint tokensOwedA;
    uint tokensOwedB;
}

/**
 * @title PoolV3
 * @notice A concentrated liquidity pool (Uniswap V3-style) for trading between two ERC20 tokens
 * @dev Liquidity is provided over [tickLower, tickUpper) price ranges. Price is tracked as the
 *      square root of the tokenB-per-tokenA price, WAD-scaled (1e18), instead of Q64.96 —
 *      SolidVM integers are unbounded so no fixed-point overflow tricks are needed.
 *
 * Key Features:
 * - Concentrated liquidity: positions earn fees only while the price is inside their range
 * - Tick-crossing swaps with per-range liquidity
 * - Fee growth accounting per unit of in-range liquidity (LP share stays in pool, protocol
 *   share is sent to the fee collector, mirroring Pool.sol conventions)
 * - Positions are records keyed by (owner, tickLower, tickUpper) — no LP token is minted
 * - Built-in TWAP oracle: time-weighted tick accumulator (V3-style geometric mean TWAP)
 *
 * @author Mercata Protocol
 * @version 1.0.0
 */
contract record PoolV3 is Ownable {

    // ============ EVENTS ============

    /// @notice Emitted once when the pool price is initialized
    event Initialize(uint sqrtPriceWad, int tick);

    /// @notice Emitted when liquidity is added to a position
    event Mint(address owner, int tickLower, int tickUpper, uint liquidityAmount, uint tokenAAmount, uint tokenBAmount);

    /// @notice Emitted when liquidity is removed from a position (amounts become collectable)
    event Burn(address owner, int tickLower, int tickUpper, uint liquidityAmount, uint tokenAAmount, uint tokenBAmount);

    /// @notice Emitted when owed tokens (principal + fees) are collected from a position
    event Collect(address owner, int tickLower, int tickUpper, uint tokenAAmount, uint tokenBAmount);

    /// @notice Emitted when a swap occurs
    event Swap(address sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint sqrtPriceWad, int tick, uint liquidity);

    // ============ CONSTANTS ============

    uint constant WAD = 1e18;

    /// @notice Tick bounds. Half of Uniswap V3's range: price spans ~1e-19 .. 1e19, the widest
    /// range whose sqrt prices stay representable in WAD (1e18) scaling
    int constant MIN_TICK = -443636;
    int constant MAX_TICK = 443636;

    // ============ STATE VARIABLES ============

    /// @notice The factory that created this pool
    PoolV3Factory public poolV3Factory;

    /// @notice The first token in the trading pair (token0)
    Token public tokenA;

    /// @notice The second token in the trading pair (token1)
    Token public tokenB;

    /// @notice Swap fee in basis points (fixed at pool creation; defines the fee tier)
    uint public feeBps;

    /// @notice Ticks usable by positions must be multiples of this spacing
    int public tickSpacing;

    /// @notice Current sqrt(tokenB/tokenA price), WAD-scaled
    uint public sqrtPriceWad;

    /// @notice Current tick (floor of log_1.0001(price))
    int public currentTick;

    /// @notice Total liquidity currently in range
    uint public liquidity;

    /// @notice Global fee growth per unit of liquidity, WAD-scaled, in tokenA
    int public feeGrowthGlobalA;

    /// @notice Global fee growth per unit of liquidity, WAD-scaled, in tokenB
    int public feeGrowthGlobalB;

    /// @notice Pool-specific LP share percentage in basis points (0 = use factory default)
    uint public lpSharePercent;

    /// @notice Tracked balance of tokenA in the pool
    uint public tokenABalance;

    /// @notice Tracked balance of tokenB in the pool
    uint public tokenBBalance;

    /// @notice Per-tick state
    mapping(int => V3TickInfo) public record ticks;

    /// @notice List of currently initialized ticks (unordered; scanned for next-tick lookup)
    int[] public record tickList;

    /// @notice Positions: owner => tickLower => tickUpper => position
    mapping(address => mapping(int => mapping(int => V3Position))) public record positions;

    // ============ TWAP ORACLE ============

    /// @notice Time-weighted sum of currentTick (tick-seconds)
    int public tickCumulative;

    /// @notice Timestamp of the last oracle accumulator update
    uint public observationTimestamp;

    // ============ ADMIN FLAGS ============

    bool public isPaused = false;

    bool public isDisabled = false;

    /// @notice Reentrancy guard to prevent recursive calls
    bool private locked;

    // ============ MODIFIERS ============

    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    /// @notice Modifier to check if the caller is the pool factory
    modifier onlyPoolV3Factory() {
        require(
            msg.sender == address(poolV3Factory)
            || msg.sender == owner(),
            "Caller is not PoolV3Factory");
        _;
    }

    modifier whenNotPaused() {
        require(!isPaused, "Pool is paused");
        _;
    }

    modifier whenNotDisabled() {
        require(!isDisabled, "Pool is disabled");
        _;
    }

    modifier onlyActiveTokens() {
        require(_tokenFactory().isTokenActive(address(tokenA)), "TokenA is not active");
        require(_tokenFactory().isTokenActive(address(tokenB)), "TokenB is not active");
        _;
    }

    // ============ OWNER FUNCTIONS ============

    function setPaused(bool _isPaused) external onlyOwner {
        require(!isDisabled, "Pool pause cannot be set while isDisabled = true");
        isPaused = _isPaused;
    }

    function setDisabled(bool _isDisabled) external onlyOwner {
        isPaused = _isDisabled ? true : isPaused;
        isDisabled = _isDisabled;
    }

    /// @notice Set the pool-specific LP share percentage (factory only)
    /// @param newLpSharePercent New LP share in basis points (0 = use factory default)
    function setLpSharePercent(uint newLpSharePercent) external onlyPoolV3Factory {
        require(newLpSharePercent <= 10000, "Invalid LP share percent");
        lpSharePercent = newLpSharePercent;
    }

    // ============ INTERNAL HELPERS ============

    function _tokenFactory() internal view returns (TokenFactory) {
        return TokenFactory(address(PoolV3Factory(address(poolV3Factory)).tokenFactory()));
    }

    function _feeCollector() internal view returns (address) {
        return PoolV3Factory(poolV3Factory).feeCollector();
    }

    function _lpSharePercent() internal view returns (uint) {
        if (lpSharePercent == 0) {
            return PoolV3Factory(poolV3Factory).lpSharePercent();
        }
        return lpSharePercent;
    }

    function _divRoundUp(uint a, uint b) internal pure returns (uint) {
        require(b > 0, "Division by zero");
        if (a == 0) return 0;
        return (a + b - 1) / b;
    }

    // ============ CONSTRUCTOR ============

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Initialize a new concentrated liquidity pool
    /// @param tokenAAddr The address of the first token in the pair
    /// @param tokenBAddr The address of the second token in the pair
    /// @param _feeBps Swap fee in basis points (fee tier, fixed for the pool's lifetime)
    /// @param _tickSpacing Tick spacing for position boundaries
    /// @param initialSqrtPriceWad Initial sqrt(tokenB/tokenA price), WAD-scaled
    /// @param factoryAddr The PoolV3Factory that created this pool
    /// @dev Should be called by the PoolV3Factory contract
    function initialize(
        address tokenAAddr,
        address tokenBAddr,
        uint _feeBps,
        int _tickSpacing,
        uint initialSqrtPriceWad,
        address factoryAddr
    ) external onlyOwner {
        require(sqrtPriceWad == 0, "Already initialized");
        require(tokenAAddr != address(0), "Zero tokenA address");
        require(tokenBAddr != address(0), "Zero tokenB address");
        require(factoryAddr != address(0), "Zero factory address");
        require(_feeBps > 0 && _feeBps <= 1000, "Invalid fee rate"); // Max 10%
        require(_tickSpacing > 0 && _tickSpacing <= 32768, "Invalid tick spacing");

        // @dev important: must be set here for proxied instances
        isPaused = false;
        isDisabled = false;

        poolV3Factory = PoolV3Factory(address(factoryAddr));
        tokenA = Token(tokenAAddr);
        tokenB = Token(tokenBAddr);
        feeBps = _feeBps;
        tickSpacing = _tickSpacing;

        sqrtPriceWad = initialSqrtPriceWad;
        currentTick = getTickAtSqrtPrice(initialSqrtPriceWad);
        observationTimestamp = block.timestamp;

        emit Initialize(initialSqrtPriceWad, currentTick);
    }

    // ============ TICK MATH ============

    /// @notice Compute sqrt(1.0001^tick), WAD-scaled
    /// @dev Product of precomputed constants sqrt(1.0001)^(2^k) at 1e36 precision,
    ///      one per set bit of |tick| (same technique as Uniswap V3 TickMath, re-derived for WAD)
    function getSqrtPriceAtTick(int tick) public pure returns (uint) {
        require(tick >= MIN_TICK && tick <= MAX_TICK, "Tick out of range");
        uint absTick = tick < 0 ? uint(-tick) : uint(tick);

        uint ratio = 1e36;
        if ((absTick & 1) != 0)      ratio = (ratio * 1000049998750062496094023416993798697) / 1e36;
        if ((absTick & 2) != 0)      ratio = (ratio * 1000100000000000000000000000000000000) / 1e36;
        if ((absTick & 4) != 0)      ratio = (ratio * 1000200010000000000000000000000000000) / 1e36;
        if ((absTick & 8) != 0)      ratio = (ratio * 1000400060004000100000000000000000000) / 1e36;
        if ((absTick & 16) != 0)     ratio = (ratio * 1000800280056007000560028000800010000) / 1e36;
        if ((absTick & 32) != 0)     ratio = (ratio * 1001601200560182043688009144128711441) / 1e36;
        if ((absTick & 64) != 0)     ratio = (ratio * 1003204964963598014666528690811055253) / 1e36;
        if ((absTick & 128) != 0)    ratio = (ratio * 1006420201727613920156533908409419273) / 1e36;
        if ((absTick & 256) != 0)    ratio = (ratio * 1012881622445451097078095631935005571) / 1e36;
        if ((absTick & 512) != 0)    ratio = (ratio * 1025929181087729343658708608578965861) / 1e36;
        if ((absTick & 1024) != 0)   ratio = (ratio * 1052530684607338948386589370372923836) / 1e36;
        if ((absTick & 2048) != 0)   ratio = (ratio * 1107820842039993613899215811078813988) / 1e36;
        if ((absTick & 4096) != 0)   ratio = (ratio * 1227267018058200482050503815090808830) / 1e36;
        if ((absTick & 8192) != 0)   ratio = (ratio * 1506184333613467388107955981199151720) / 1e36;
        if ((absTick & 16384) != 0)  ratio = (ratio * 2268591246822644826925609859343607240) / 1e36;
        if ((absTick & 32768) != 0)  ratio = (ratio * 5146506245160322222537991751503863982) / 1e36;
        if ((absTick & 65536) != 0)  ratio = (ratio * 26486526531474198664033811812785769605) / 1e36;
        if ((absTick & 131072) != 0) ratio = (ratio * 701536087702486644953017488493794435252) / 1e36;
        if ((absTick & 262144) != 0) ratio = (ratio * 492152882348911033633683861778354995017201) / 1e36;

        if (tick < 0) {
            ratio = (1e36 * 1e36) / ratio;
        }

        return ratio / 1e18; // 1e36 -> WAD
    }

    /// @notice Find the greatest tick whose sqrt price is <= the given sqrt price
    /// @dev Binary search over getSqrtPriceAtTick (~20 iterations)
    function getTickAtSqrtPrice(uint _sqrtPriceWad) public pure returns (int) {
        require(_sqrtPriceWad >= getSqrtPriceAtTick(MIN_TICK), "Price too low");
        require(_sqrtPriceWad <= getSqrtPriceAtTick(MAX_TICK), "Price too high");
        int lo = MIN_TICK;
        int hi = MAX_TICK;
        while (lo < hi) {
            int mid = (lo + hi + 1) / 2;
            if (getSqrtPriceAtTick(mid) <= _sqrtPriceWad) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    // ============ AMOUNT MATH ============

    /// @notice TokenA amount needed for `liquidityAmt` between two sqrt prices (sqrtLower < sqrtUpper)
    /// @dev amountA = L * (sqrtUpper - sqrtLower) * WAD / (sqrtLower * sqrtUpper)
    function _amountADelta(uint sqrtLower, uint sqrtUpper, uint liquidityAmt, bool roundUp) internal pure returns (uint) {
        require(sqrtLower > 0 && sqrtUpper >= sqrtLower, "Invalid sqrt prices");
        uint numerator = liquidityAmt * (sqrtUpper - sqrtLower) * WAD;
        uint denominator = sqrtLower * sqrtUpper;
        return roundUp ? _divRoundUp(numerator, denominator) : numerator / denominator;
    }

    /// @notice TokenB amount needed for `liquidityAmt` between two sqrt prices (sqrtLower < sqrtUpper)
    /// @dev amountB = L * (sqrtUpper - sqrtLower) / WAD
    function _amountBDelta(uint sqrtLower, uint sqrtUpper, uint liquidityAmt, bool roundUp) internal pure returns (uint) {
        require(sqrtUpper >= sqrtLower, "Invalid sqrt prices");
        uint numerator = liquidityAmt * (sqrtUpper - sqrtLower);
        return roundUp ? _divRoundUp(numerator, WAD) : numerator / WAD;
    }

    /// @notice Token amounts required to mint `liquidityAmount` over a range at the current price
    function getAmountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount
    ) public view returns (uint tokenAAmount, uint tokenBAmount) {
        uint sqrtLower = getSqrtPriceAtTick(tickLower);
        uint sqrtUpper = getSqrtPriceAtTick(tickUpper);
        if (currentTick < tickLower) {
            tokenAAmount = _amountADelta(sqrtLower, sqrtUpper, liquidityAmount, true);
        } else if (currentTick < tickUpper) {
            tokenAAmount = _amountADelta(sqrtPriceWad, sqrtUpper, liquidityAmount, true);
            tokenBAmount = _amountBDelta(sqrtLower, sqrtPriceWad, liquidityAmount, true);
        } else {
            tokenBAmount = _amountBDelta(sqrtLower, sqrtUpper, liquidityAmount, true);
        }
        return (tokenAAmount, tokenBAmount);
    }

    // ============ TWAP ORACLE ============

    /// @notice Advance the tick-seconds accumulator using the tick in effect since the last update
    function _updateOracle() internal {
        if (block.timestamp > observationTimestamp) {
            tickCumulative += currentTick * int(block.timestamp - observationTimestamp);
            observationTimestamp = block.timestamp;
        }
    }

    /// @notice Current tick-seconds accumulator and timestamp
    /// @dev TWAP tick over [t1, t2] = (tickCumulative(t2) - tickCumulative(t1)) / (t2 - t1);
    ///      TWAP price = 1.0001^twapTick (geometric mean, V3-style)
    function observe() external view returns (int tickCumulative_, uint timestamp) {
        tickCumulative_ = tickCumulative;
        if (block.timestamp > observationTimestamp) {
            tickCumulative_ += currentTick * int(block.timestamp - observationTimestamp);
        }
        return (tickCumulative_, block.timestamp);
    }

    // ============ TICK MANAGEMENT ============

    function _insertTick(int tick) internal {
        tickList.push(tick);
    }

    function _removeTick(int tick) internal {
        for (uint i = 0; i < tickList.length; i++) {
            if (tickList[i] == tick) {
                tickList[i] = tickList[tickList.length - 1];
                tickList.length--;
                return;
            }
        }
    }

    /// @notice Find the next initialized tick in the swap direction
    /// @param isAToB If true price moves down (find greatest tick <= currentTick), else up (smallest tick > currentTick)
    function _nextInitializedTick(bool isAToB) internal view returns (int nextTick, bool found) {
        for (uint i = 0; i < tickList.length; i++) {
            int t = tickList[i];
            if (isAToB) {
                if (t <= currentTick && (!found || t > nextTick)) {
                    nextTick = t;
                    found = true;
                }
            } else {
                if (t > currentTick && (!found || t < nextTick)) {
                    nextTick = t;
                    found = true;
                }
            }
        }
        return (nextTick, found);
    }

    /// @notice Update a tick's liquidity bookkeeping for a position change
    /// @return True when the tick's liquidity just dropped to zero; the caller must
    ///         _clearTick it only after its fee accounting no longer needs the tick
    function _updateTick(int tick, int liquidityDelta, bool isUpper) internal returns (bool) {
        V3TickInfo storage info = ticks[tick];
        // liquidityGross tracks total liquidity referencing this tick; add and remove
        // apply the same signed delta because a position references each of its ticks once
        int grossAfterSigned = int(info.liquidityGross) + liquidityDelta;
        require(grossAfterSigned >= 0, "Tick liquidity underflow");
        uint grossBefore = info.liquidityGross;
        uint grossAfter = uint(grossAfterSigned);

        if (grossBefore == 0 && grossAfter > 0) {
            // Convention (as in V3): assume all prior fee growth happened below the tick
            if (tick <= currentTick) {
                info.feeGrowthOutsideA = feeGrowthGlobalA;
                info.feeGrowthOutsideB = feeGrowthGlobalB;
            } else {
                info.feeGrowthOutsideA = 0;
                info.feeGrowthOutsideB = 0;
            }
            info.initialized = true;
            _insertTick(tick);
        }

        info.liquidityGross = grossAfter;
        if (isUpper) {
            info.liquidityNet -= liquidityDelta;
        } else {
            info.liquidityNet += liquidityDelta;
        }

        if (grossBefore > 0 && grossAfter == 0) {
            // De-initialize for next-tick search now, but leave feeGrowthOutside intact:
            // _updatePosition still needs it for the position's final fee accrual, and
            // clears the tick afterwards (V3 clears ticks only after Position.update)
            info.initialized = false;
            _removeTick(tick);
            return true;
        }
        return false;
    }

    /// @notice Fully reset a tick whose liquidity dropped to zero (V3's Tick.clear)
    function _clearTick(int tick) internal {
        V3TickInfo storage info = ticks[tick];
        info.feeGrowthOutsideA = 0;
        info.feeGrowthOutsideB = 0;
        info.liquidityNet = 0;
    }

    /// @notice Cross an initialized tick during a swap, flipping fee growth and applying net liquidity
    function _crossTick(int tick, bool isAToB) internal {
        V3TickInfo storage info = ticks[tick];
        info.feeGrowthOutsideA = feeGrowthGlobalA - info.feeGrowthOutsideA;
        info.feeGrowthOutsideB = feeGrowthGlobalB - info.feeGrowthOutsideB;
        int lNet = info.liquidityNet;
        if (isAToB) {
            lNet = -lNet;
        }
        int newLiquidity = int(liquidity) + lNet;
        require(newLiquidity >= 0, "Liquidity underflow on cross");
        liquidity = uint(newLiquidity);
    }

    /// @notice Fee growth inside a tick range (may be transiently negative; deltas are what matter)
    function _feeGrowthInside(int tickLower, int tickUpper) internal view returns (int insideA, int insideB) {
        V3TickInfo storage lowerInfo = ticks[tickLower];
        V3TickInfo storage upperInfo = ticks[tickUpper];

        int belowA = currentTick >= tickLower ? lowerInfo.feeGrowthOutsideA : feeGrowthGlobalA - lowerInfo.feeGrowthOutsideA;
        int belowB = currentTick >= tickLower ? lowerInfo.feeGrowthOutsideB : feeGrowthGlobalB - lowerInfo.feeGrowthOutsideB;
        int aboveA = currentTick < tickUpper ? upperInfo.feeGrowthOutsideA : feeGrowthGlobalA - upperInfo.feeGrowthOutsideA;
        int aboveB = currentTick < tickUpper ? upperInfo.feeGrowthOutsideB : feeGrowthGlobalB - upperInfo.feeGrowthOutsideB;

        insideA = feeGrowthGlobalA - belowA - aboveA;
        insideB = feeGrowthGlobalB - belowB - aboveB;
        return (insideA, insideB);
    }

    // ============ POSITION MANAGEMENT ============

    function _checkTicks(int tickLower, int tickUpper) internal view {
        require(tickLower < tickUpper, "tickLower >= tickUpper");
        require(tickLower >= MIN_TICK && tickUpper <= MAX_TICK, "Tick out of range");
        require(tickLower % tickSpacing == 0 && tickUpper % tickSpacing == 0, "Tick not multiple of spacing");
    }

    /// @notice Update position liquidity and accrue owed fees to the position
    function _updatePosition(address positionOwner, int tickLower, int tickUpper, int liquidityDelta) internal {
        bool flippedLower = _updateTick(tickLower, liquidityDelta, false);
        bool flippedUpper = _updateTick(tickUpper, liquidityDelta, true);

        (int insideA, int insideB) = _feeGrowthInside(tickLower, tickUpper);

        V3Position storage pos = positions[positionOwner][tickLower][tickUpper];
        if (pos.liquidity > 0) {
            int deltaA = insideA - pos.feeGrowthInsideALast;
            int deltaB = insideB - pos.feeGrowthInsideBLast;
            if (deltaA > 0) {
                pos.tokensOwedA += (pos.liquidity * uint(deltaA)) / WAD;
            }
            if (deltaB > 0) {
                pos.tokensOwedB += (pos.liquidity * uint(deltaB)) / WAD;
            }
        }
        pos.feeGrowthInsideALast = insideA;
        pos.feeGrowthInsideBLast = insideB;

        int newPosLiquidity = int(pos.liquidity) + liquidityDelta;
        require(newPosLiquidity >= 0, "Position liquidity underflow");
        pos.liquidity = uint(newPosLiquidity);

        // Only now is it safe to wipe ticks this burn emptied; clearing them before the
        // fee accrual above would zero the feeGrowthOutside snapshots that
        // _feeGrowthInside just read, crediting phantom fees to the position
        if (flippedLower) {
            _clearTick(tickLower);
        }
        if (flippedUpper) {
            _clearTick(tickUpper);
        }
    }

    /// @notice Read a position's liquidity and currently collectable amounts
    function getPosition(
        address positionOwner,
        int tickLower,
        int tickUpper
    ) external view returns (uint positionLiquidity, uint tokensOwedA, uint tokensOwedB) {
        V3Position storage pos = positions[positionOwner][tickLower][tickUpper];
        return (pos.liquidity, pos.tokensOwedA, pos.tokensOwedB);
    }

    // ============ CORE FUNCTIONS ============

    /// @notice Add liquidity to a position over [tickLower, tickUpper)
    /// @param tickLower Lower tick of the range (multiple of tickSpacing)
    /// @param tickUpper Upper tick of the range (multiple of tickSpacing)
    /// @param liquidityAmount Liquidity units to add
    /// @param maxTokenAAmount Maximum tokenA the caller is willing to deposit (slippage protection)
    /// @param maxTokenBAmount Maximum tokenB the caller is willing to deposit (slippage protection)
    /// @return tokenAAmount The tokenA deposited
    /// @return tokenBAmount The tokenB deposited
    /// @dev The caller must approve both tokens for transfer before calling
    function mint(
        int tickLower,
        int tickUpper,
        uint liquidityAmount,
        uint maxTokenAAmount,
        uint maxTokenBAmount,
        uint deadline
    ) external whenNotPaused onlyActiveTokens nonReentrant returns (uint tokenAAmount, uint tokenBAmount) {
        require(liquidityAmount > 0, "Invalid liquidity");
        require(block.timestamp <= deadline, "EXPIRED");
        _checkTicks(tickLower, tickUpper);

        _updateOracle();
        _updatePosition(msg.sender, tickLower, tickUpper, int(liquidityAmount));

        (tokenAAmount, tokenBAmount) = getAmountsForLiquidity(tickLower, tickUpper, liquidityAmount);
        require(tokenAAmount > 0 || tokenBAmount > 0, "Zero amounts");
        require(tokenAAmount <= maxTokenAAmount && tokenBAmount <= maxTokenBAmount, "Slippage check failed");

        if (currentTick >= tickLower && currentTick < tickUpper) {
            liquidity += liquidityAmount;
        }

        if (tokenAAmount > 0) {
            require(tokenA.transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");
            tokenABalance += tokenAAmount;
        }
        if (tokenBAmount > 0) {
            require(tokenB.transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
            tokenBBalance += tokenBAmount;
        }

        emit Mint(msg.sender, tickLower, tickUpper, liquidityAmount, tokenAAmount, tokenBAmount);
        return (tokenAAmount, tokenBAmount);
    }

    /// @notice Remove liquidity from a position; amounts become collectable via collect()
    /// @param liquidityAmount Liquidity units to remove (0 = poke, just accrues fees)
    /// @return tokenAAmount The tokenA credited to the position
    /// @return tokenBAmount The tokenB credited to the position
    function burn(
        int tickLower,
        int tickUpper,
        uint liquidityAmount,
        uint deadline
    ) external whenNotDisabled nonReentrant returns (uint tokenAAmount, uint tokenBAmount) {
        require(block.timestamp <= deadline, "EXPIRED");
        _checkTicks(tickLower, tickUpper);

        _updateOracle();
        _updatePosition(msg.sender, tickLower, tickUpper, -int(liquidityAmount));

        if (liquidityAmount > 0) {
            uint sqrtLower = getSqrtPriceAtTick(tickLower);
            uint sqrtUpper = getSqrtPriceAtTick(tickUpper);
            if (currentTick < tickLower) {
                tokenAAmount = _amountADelta(sqrtLower, sqrtUpper, liquidityAmount, false);
            } else if (currentTick < tickUpper) {
                tokenAAmount = _amountADelta(sqrtPriceWad, sqrtUpper, liquidityAmount, false);
                tokenBAmount = _amountBDelta(sqrtLower, sqrtPriceWad, liquidityAmount, false);
                liquidity -= liquidityAmount;
            } else {
                tokenBAmount = _amountBDelta(sqrtLower, sqrtUpper, liquidityAmount, false);
            }

            V3Position storage pos = positions[msg.sender][tickLower][tickUpper];
            pos.tokensOwedA += tokenAAmount;
            pos.tokensOwedB += tokenBAmount;
        }

        emit Burn(msg.sender, tickLower, tickUpper, liquidityAmount, tokenAAmount, tokenBAmount);
        return (tokenAAmount, tokenBAmount);
    }

    /// @notice Collect owed tokens (burned principal + accrued fees) from a position
    /// @param maxTokenAAmount Maximum tokenA to collect
    /// @param maxTokenBAmount Maximum tokenB to collect
    function collect(
        int tickLower,
        int tickUpper,
        uint maxTokenAAmount,
        uint maxTokenBAmount
    ) external whenNotDisabled nonReentrant returns (uint tokenAAmount, uint tokenBAmount) {
        V3Position storage pos = positions[msg.sender][tickLower][tickUpper];

        tokenAAmount = pos.tokensOwedA < maxTokenAAmount ? pos.tokensOwedA : maxTokenAAmount;
        tokenBAmount = pos.tokensOwedB < maxTokenBAmount ? pos.tokensOwedB : maxTokenBAmount;

        if (tokenAAmount > 0) {
            pos.tokensOwedA -= tokenAAmount;
            tokenABalance -= tokenAAmount;
            require(tokenA.transfer(msg.sender, tokenAAmount), "TokenA transfer failed");
        }
        if (tokenBAmount > 0) {
            pos.tokensOwedB -= tokenBAmount;
            tokenBBalance -= tokenBAmount;
            require(tokenB.transfer(msg.sender, tokenBAmount), "TokenB transfer failed");
        }

        emit Collect(msg.sender, tickLower, tickUpper, tokenAAmount, tokenBAmount);
        return (tokenAAmount, tokenBAmount);
    }

    // ============ SWAP ============

    /// @notice Swap tokens against in-range liquidity, crossing ticks as needed
    /// @param isAToB If true, swap tokenA for tokenB (price moves down); else tokenB for tokenA
    /// @param amountIn Maximum input amount (fully consumed unless the price limit or liquidity edge is hit)
    /// @param minAmountOut Minimum output amount (slippage protection)
    /// @param sqrtPriceLimitWad Optional price limit (0 = no limit beyond tick bounds)
    /// @return amountOut The output tokens sent to the caller
    function swap(
        bool isAToB,
        uint amountIn,
        uint minAmountOut,
        uint sqrtPriceLimitWad,
        uint deadline
    ) external whenNotPaused onlyActiveTokens nonReentrant returns (uint amountOut) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");

        _updateOracle();

        uint limit = sqrtPriceLimitWad;
        if (limit == 0) {
            limit = isAToB ? getSqrtPriceAtTick(MIN_TICK) : getSqrtPriceAtTick(MAX_TICK);
        }
        if (isAToB) {
            require(limit < sqrtPriceWad && limit >= getSqrtPriceAtTick(MIN_TICK), "Invalid price limit");
        } else {
            require(limit > sqrtPriceWad && limit <= getSqrtPriceAtTick(MAX_TICK), "Invalid price limit");
        }

        uint feeRate = feeBps;
        uint lpShare = _lpSharePercent();
        uint remaining = amountIn;
        uint protocolFees = 0;

        while (remaining > 0 && sqrtPriceWad != limit) {
            (int nextTick, bool found) = _nextInitializedTick(isAToB);

            // Target price for this step: next initialized tick, clamped by the limit
            uint tickSqrt = 0;
            uint targetSqrt = limit;
            bool targetIsTick = false;
            if (found) {
                tickSqrt = getSqrtPriceAtTick(nextTick);
                // >= / <= (not strict): a tick sitting exactly on the limit must still be
                // the step target so it gets crossed when reached (Uniswap V3 semantics);
                // otherwise currentTick would pass the tick while its liquidityNet was never applied
                if (isAToB ? tickSqrt >= limit : tickSqrt <= limit) {
                    targetSqrt = tickSqrt;
                    targetIsTick = true;
                }
            }

            if (liquidity == 0) {
                // No in-range liquidity: jump to the target without trading
                sqrtPriceWad = targetSqrt;
                if (targetIsTick) {
                    _crossTick(nextTick, isAToB);
                    currentTick = isAToB ? nextTick - 1 : nextTick;
                    continue;
                }
                currentTick = getTickAtSqrtPrice(sqrtPriceWad);
                break; // reached the limit with nothing to trade against
            }

            // Net input needed to move the price all the way to the target
            uint netNeeded = isAToB
                ? _amountADelta(targetSqrt, sqrtPriceWad, liquidity, true)
                : _amountBDelta(sqrtPriceWad, targetSqrt, liquidity, true);
            uint netAvail = (remaining * (10000 - feeRate)) / 10000;

            uint netUsed;
            uint grossUsed;
            uint newSqrt;
            if (netAvail >= netNeeded) {
                // Reach the target exactly
                netUsed = netNeeded;
                grossUsed = _divRoundUp(netNeeded * 10000, 10000 - feeRate);
                if (grossUsed > remaining) {
                    grossUsed = remaining;
                }
                newSqrt = targetSqrt;
            } else {
                // Consume all remaining input inside the current tick range
                netUsed = netAvail;
                grossUsed = remaining;
                if (isAToB) {
                    newSqrt = _divRoundUp(liquidity * sqrtPriceWad * WAD, liquidity * WAD + netUsed * sqrtPriceWad);
                    if (newSqrt < targetSqrt) newSqrt = targetSqrt;
                } else {
                    newSqrt = sqrtPriceWad + (netUsed * WAD) / liquidity;
                    if (newSqrt > targetSqrt) newSqrt = targetSqrt;
                }
            }

            // Output for the price move (rounded down, favoring the pool)
            uint stepOut = isAToB
                ? _amountBDelta(newSqrt, sqrtPriceWad, liquidity, false)
                : _amountADelta(sqrtPriceWad, newSqrt, liquidity, false);
            amountOut += stepOut;

            // Fee accounting: LP share accrues to in-range liquidity, protocol share leaves the pool
            uint stepFee = grossUsed - netUsed;
            uint lpFee = (stepFee * lpShare) / 10000;
            protocolFees += stepFee - lpFee;
            if (lpFee > 0) {
                if (isAToB) {
                    feeGrowthGlobalA += int((lpFee * WAD) / liquidity);
                } else {
                    feeGrowthGlobalB += int((lpFee * WAD) / liquidity);
                }
            }

            remaining -= grossUsed;
            sqrtPriceWad = newSqrt;

            if (targetIsTick && newSqrt == tickSqrt) {
                _crossTick(nextTick, isAToB);
                currentTick = isAToB ? nextTick - 1 : nextTick;
            } else {
                currentTick = getTickAtSqrtPrice(sqrtPriceWad);
            }
        }

        uint consumed = amountIn - remaining;
        require(consumed > 0, "Nothing swapped");
        require(amountOut >= minAmountOut, "Slippage check failed");

        Token inputToken = isAToB ? tokenA : tokenB;
        Token outputToken = isAToB ? tokenB : tokenA;

        require(inputToken.transferFrom(msg.sender, address(this), consumed), "Input transfer failed");
        if (protocolFees > 0) {
            require(inputToken.transfer(_feeCollector(), protocolFees), "Protocol fee transfer failed");
        }
        require(outputToken.transfer(msg.sender, amountOut), "Output transfer failed");

        if (isAToB) {
            tokenABalance += consumed - protocolFees;
            tokenBBalance -= amountOut;
        } else {
            tokenBBalance += consumed - protocolFees;
            tokenABalance -= amountOut;
        }

        emit Swap(msg.sender, address(inputToken), address(outputToken), consumed, amountOut, sqrtPriceWad, currentTick, liquidity);
        return amountOut;
    }

    /// @notice Transfer the pool to a new factory
    /// @dev This function can only be called by the current PoolV3Factory contract
    function transferPoolToFactory(address newFactory) external onlyPoolV3Factory {
        require(newFactory != address(0), "Invalid factory address");
        poolV3Factory = PoolV3Factory(newFactory);
    }
}
