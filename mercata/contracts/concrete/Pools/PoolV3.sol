// SPDX-License-Identifier: MIT
import "PoolV3Factory.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";

import "../../libraries/PoolV3/BitMath.sol";
import "../../libraries/PoolV3/FixedPoint96.sol";
import "../../libraries/PoolV3/FixedPoint128.sol";
import "../../libraries/PoolV3/FullMath.sol";
import "../../libraries/PoolV3/TickMath.sol";
import "../../libraries/PoolV3/SqrtPriceMath.sol";
import "../../libraries/PoolV3/SwapMath.sol";
import "../../libraries/PoolV3/TickBitmap.sol";
import "../../libraries/PoolV3/Tick.sol";
import "../../libraries/PoolV3/Oracle.sol";
import "../../libraries/PoolV3/Position.sol";

/**
 * @title PoolV3
 * @notice A concentrated liquidity pool — a port of Uniswap V3's UniswapV3Pool to SolidVM
 * @dev Structured like canonical v3-core: this contract owns the state and orchestrates;
 *      the math lives in libraries/PoolV3/{TickMath, SqrtPriceMath, SwapMath, TickBitmap,
 *      Tick, Oracle, Position, BitMath, FullMath, FixedPoint96, FixedPoint128}.sol, each a
 *      port of the v3-core library of the same name. Because SolidVM integers are unbounded,
 *      a*b/c is exact (what FullMath's 512-bit tricks achieve on the EVM), so outputs are
 *      bit-identical to canonical V3 wherever V3 itself does not intentionally overflow.
 *
 * SolidVM dialect notes (vs canonical):
 * - Library calls are fully qualified (Tick.cross(ticks, ...)) — no `using X for Y` sugar
 * - Structs live at file level in their library's file (no library-nested struct references)
 * - Canonical UnsafeMath/LowGasSafeMath/SafeCast have no equivalents here: unbounded
 *   integers make them unnecessary
 *
 * Deliberate divergences from canonical UniswapV3Pool.sol (platform extensions):
 * - Payment: approve + transferFrom (platform token model) instead of mint/swap callbacks;
 *   consequently flash() does not exist and users may call the pool directly, so mint/swap/burn
 *   carry trailing slippage/deadline parameters that canonical V3 delegates to its periphery
 * - Protocol fees: each swap's protocol share (1 - lpSharePercent) is routed immediately to the
 *   factory's feeCollector (platform convention) instead of accruing for collectProtocol;
 *   slot0().feeProtocol is therefore always 0
 * - Admin: initialize carries the token/fee/factory wiring (proxy pattern); pause/disable,
 *   token-active gating, sync/skim and factory migration mirror the platform's V2 Pool
 * - Guard semantics: paused blocks mint+swap (exit stays open); disabled blocks everything;
 *   inactive tokens block mint+swap but never burn/collect
 *
 * @author Mercata Protocol
 * @version 1.0.0
 */
contract record PoolV3 is Ownable {

    // ============ EVENTS (canonical Uniswap V3 shapes) ============

    /// @notice Emitted once when the pool price is initialized
    event Initialize(uint sqrtPriceX96, int tick);

    /// @notice Emitted when liquidity is added to a position
    event Mint(address sender, address owner, int tickLower, int tickUpper, uint amount, uint amount0, uint amount1);

    /// @notice Emitted when liquidity is removed from a position (amounts become collectable)
    event Burn(address owner, int tickLower, int tickUpper, uint amount, uint amount0, uint amount1);

    /// @notice Emitted when owed tokens (burned principal + fees) are collected from a position
    event Collect(address owner, address recipient, int tickLower, int tickUpper, uint amount0, uint amount1);

    /// @notice Emitted on every swap; amounts are the pool's signed token deltas
    event Swap(address sender, address recipient, int amount0, int amount1, uint sqrtPriceX96, uint liquidity, int tick);

    /// @notice Emitted when the observation ring buffer growth is scheduled
    event IncreaseObservationCardinalityNext(uint observationCardinalityNextOld, uint observationCardinalityNextNew);

    // ============ EVENTS (platform extensions, mirrors Pool.sol) ============

    /// @notice Emitted when tracked balances are re-synced to actual token balances
    event Sync(uint token0Balance, uint token1Balance);

    /// @notice Emitted when excess token balances are skimmed
    event Skim(address to, uint excess0, uint excess1);

    // ============ CONSTANTS ============

    /// @notice Maximum observation ring size (as in Uniswap V3)
    uint constant MAX_CARDINALITY = 65535;

    // ============ STATE VARIABLES ============

    /// @notice The factory that created this pool (platform extension)
    PoolV3Factory public poolV3Factory;

    /// @notice The first token of the pair. NOTE: creation order, not address-sorted as on
    ///         canonical V3 — the factory registry stores both directions
    Token public token0;

    /// @notice The second token of the pair
    Token public token1;

    /// @notice Swap fee in hundredths of a bip (pips, 1e6 denominator; e.g. 3000 = 0.30%)
    uint public fee;

    /// @notice Ticks usable by positions must be multiples of this spacing
    int public tickSpacing;

    /// @notice Maximum position liquidity referencing any single tick (canonical 'LO' guard)
    uint public maxLiquidityPerTick;

    /// @notice Current sqrt(token1/token0 price), Q64.96
    uint public sqrtPriceX96;

    /// @notice Current tick (floor of log_1.0001(price))
    int public currentTick;

    /// @notice Total liquidity currently in range
    uint public liquidity;

    /// @notice Global fee growth per unit of liquidity in token0, Q128 (signed: deltas matter)
    int public feeGrowthGlobal0X128;

    /// @notice Global fee growth per unit of liquidity in token1, Q128
    int public feeGrowthGlobal1X128;

    /// @notice Pool-specific LP share of swap fees in basis points (0 = use factory default)
    uint public lpSharePercent;

    /// @notice Tracked balance of token0 in the pool (platform extension; see sync/skim)
    uint public token0Balance;

    /// @notice Tracked balance of token1 in the pool
    uint public token1Balance;

    /// @notice Per-tick state, operated on by the Tick library
    mapping(int => V3TickInfo) public record ticks;

    /// @notice Bitmap of initialized ticks, operated on by the TickBitmap library
    mapping(int => uint) public record tickBitmap;

    /// @notice Positions (owner => tickLower => tickUpper), operated on by the Position library
    mapping(address => mapping(int => mapping(int => V3Position))) public record positions;

    /// @notice Oracle observations ring buffer, operated on by the Oracle library
    mapping(uint => V3Observation) public record observations;

    /// @notice Slot of the most recently written observation
    uint public observationIndex;

    /// @notice Number of observation slots currently in the ring
    uint public observationCardinality;

    /// @notice Ring size the buffer will grow to once the current ring is full
    uint public observationCardinalityNext;

    // ============ ADMIN FLAGS (platform extensions) ============

    bool public isPaused = false;

    bool public isDisabled = false;

    /// @notice Reentrancy guard (canonical V3 keeps this in slot0.unlocked)
    bool private locked;

    // ============ MODIFIERS ============

    modifier nonReentrant() {
        require(!locked, "LOK");
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
        require(_tokenFactory().isTokenActive(address(token0)), "Token0 is not active");
        require(_tokenFactory().isTokenActive(address(token1)), "Token1 is not active");
        _;
    }

    // ============ OWNER FUNCTIONS (platform extensions) ============

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

    // ============ INTERNAL HELPERS (platform) ============

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

    // ============ CONSTRUCTOR ============

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Initialize a new concentrated liquidity pool
    /// @param token0Addr The first token of the pair
    /// @param token1Addr The second token of the pair
    /// @param _fee Swap fee in pips (hundredths of a bip; fee tier, fixed for the pool's lifetime)
    /// @param _tickSpacing Tick spacing for position boundaries
    /// @param initialSqrtPriceX96 Initial sqrt(token1/token0 price), Q64.96
    /// @param factoryAddr The PoolV3Factory that created this pool
    /// @dev Platform extension: canonical V3 sets the pair/fee immutably at deployment and
    ///      initialize() only sets the price; the proxy pattern requires wiring here instead
    function initialize(
        address token0Addr,
        address token1Addr,
        uint _fee,
        int _tickSpacing,
        uint initialSqrtPriceX96,
        address factoryAddr
    ) external onlyOwner {
        require(sqrtPriceX96 == 0, "Already initialized");
        require(token0Addr != address(0), "Zero token0 address");
        require(token1Addr != address(0), "Zero token1 address");
        require(factoryAddr != address(0), "Zero factory address");
        require(_fee > 0 && _fee < 1000000, "Invalid fee");
        require(_tickSpacing > 0 && _tickSpacing < 16384, "Invalid tick spacing");

        // @dev important: must be set here for proxied instances
        isPaused = false;
        isDisabled = false;

        poolV3Factory = PoolV3Factory(address(factoryAddr));
        token0 = Token(token0Addr);
        token1 = Token(token1Addr);
        fee = _fee;
        tickSpacing = _tickSpacing;
        maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(_tickSpacing);

        sqrtPriceX96 = initialSqrtPriceX96;
        currentTick = TickMath.getTickAtSqrtRatio(initialSqrtPriceX96);

        observationIndex = 0;
        (observationCardinality, observationCardinalityNext) = Oracle.initialize(observations, block.timestamp);

        emit Initialize(initialSqrtPriceX96, currentTick);
    }

    /// @notice Canonical V3 slot0 view: price, tick, oracle indices, protocol fee mode, lock
    /// @dev feeProtocol is always 0 — the protocol share routes to the factory feeCollector
    ///      per swap (platform extension) instead of accruing for collectProtocol
    function slot0() external view returns (
        uint sqrtPriceX96_,
        int tick_,
        uint observationIndex_,
        uint observationCardinality_,
        uint observationCardinalityNext_,
        uint feeProtocol_,
        bool unlocked_
    ) {
        return (sqrtPriceX96, currentTick, observationIndex, observationCardinality, observationCardinalityNext, 0, !locked);
    }

    // ============ TICK MATH (public wrappers over the TickMath library) ============

    /// @notice sqrt(1.0001^tick) as a Q64.96 (TickMath.getSqrtRatioAtTick)
    function getSqrtRatioAtTick(int tick) public pure returns (uint) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    /// @notice Greatest tick whose sqrt ratio is <= the given ratio (TickMath.getTickAtSqrtRatio)
    function getTickAtSqrtRatio(uint _sqrtPriceX96) public pure returns (int) {
        return TickMath.getTickAtSqrtRatio(_sqrtPriceX96);
    }

    // ============ AMOUNT MATH ============

    /// @notice Token amounts required to mint `liquidityAmount` over a range at the current price
    /// @dev Platform convenience (canonical V3 keeps this in the periphery's LiquidityAmounts)
    function getAmountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount
    ) public view returns (uint amount0, uint amount1) {
        return _amountsForLiquidity(tickLower, tickUpper, liquidityAmount, true);
    }

    /// @dev roundUp=true when depositing (mint), false when withdrawing (burn), as canonical
    function _amountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount,
        bool roundUp
    ) internal view returns (uint, uint) {
        uint sqrtLower = TickMath.getSqrtRatioAtTick(tickLower);
        uint sqrtUpper = TickMath.getSqrtRatioAtTick(tickUpper);
        if (currentTick < tickLower) {
            return (SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, liquidityAmount, roundUp), 0);
        }
        if (currentTick < tickUpper) {
            return (
                SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidityAmount, roundUp),
                SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtPriceX96, liquidityAmount, roundUp)
            );
        }
        return (0, SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidityAmount, roundUp));
    }

    // ============ TWAP ORACLE (wrappers over the Oracle library) ============

    /// @notice Grow the observation ring buffer (permissionless, as in Uniswap V3)
    /// @param next The desired minimum ring size
    function increaseObservationCardinalityNext(uint next) external nonReentrant {
        require(next > 0 && next <= MAX_CARDINALITY, "Invalid cardinality");
        if (next > observationCardinalityNext) {
            emit IncreaseObservationCardinalityNext(observationCardinalityNext, next);
            observationCardinalityNext = next;
        }
    }

    /// @notice Read an observation slot
    function getObservation(uint slot) external view returns (
        uint blockTimestamp,
        int tickCumulative,
        int secondsPerLiquidityCumulativeX128,
        bool initialized
    ) {
        V3Observation storage obs = observations[slot];
        return (obs.blockTimestamp, obs.tickCumulative, obs.secondsPerLiquidityCumulativeX128, obs.initialized);
    }

    /// @notice Accumulator values as of each `secondsAgos[i]` seconds ago (canonical observe)
    /// @dev TWAP tick over window w = (tickCumulatives[0 seconds ago] - tickCumulatives[w]) / w;
    ///      reverts 'OLD' when the ring no longer holds data that far back
    function observe(uint[] secondsAgos) external view returns (
        int[] tickCumulatives,
        int[] secondsPerLiquidityCumulativeX128s
    ) {
        int[] memory tickCums = new int[](secondsAgos.length);
        int[] memory splCums = new int[](secondsAgos.length);
        for (uint i = 0; i < secondsAgos.length; i++) {
            (int tc, int spl) = Oracle.observeSingle(
                observations, block.timestamp, secondsAgos[i],
                currentTick, observationIndex, liquidity, observationCardinality
            );
            tickCums[i] = tc;
            splCums[i] = spl;
        }
        return (tickCums, splCums);
    }

    /// @notice Single-lookback convenience wrapper over observe (platform extension)
    function observeSingle(uint secondsAgo) external view returns (int tickCumulative, int secondsPerLiquidityCumulativeX128) {
        return Oracle.observeSingle(
            observations, block.timestamp, secondsAgo,
            currentTick, observationIndex, liquidity, observationCardinality
        );
    }

    /// @notice Cumulative snapshots inside a tick range (canonical snapshotCumulativesInside)
    /// @dev Values are only meaningful as deltas between two snapshots taken while the range
    ///      holds liquidity. Requires both ticks to be initialized
    function snapshotCumulativesInside(int tickLower, int tickUpper) external view returns (
        int tickCumulativeInside,
        int secondsPerLiquidityInsideX128,
        int secondsInside
    ) {
        _checkTicks(tickLower, tickUpper);
        V3TickInfo storage lower = ticks[tickLower];
        V3TickInfo storage upper = ticks[tickUpper];
        require(lower.initialized && upper.initialized, "Ticks not initialized");

        if (currentTick < tickLower) {
            return (
                lower.tickCumulativeOutside - upper.tickCumulativeOutside,
                lower.secondsPerLiquidityOutsideX128 - upper.secondsPerLiquidityOutsideX128,
                lower.secondsOutside - upper.secondsOutside
            );
        }
        if (currentTick < tickUpper) {
            (int tickCum, int splCum) = Oracle.observeSingle(
                observations, block.timestamp, 0,
                currentTick, observationIndex, liquidity, observationCardinality
            );
            return (
                tickCum - lower.tickCumulativeOutside - upper.tickCumulativeOutside,
                splCum - lower.secondsPerLiquidityOutsideX128 - upper.secondsPerLiquidityOutsideX128,
                int(block.timestamp) - lower.secondsOutside - upper.secondsOutside
            );
        }
        return (
            upper.tickCumulativeOutside - lower.tickCumulativeOutside,
            upper.secondsPerLiquidityOutsideX128 - lower.secondsPerLiquidityOutsideX128,
            upper.secondsOutside - lower.secondsOutside
        );
    }

    // ============ POSITION MANAGEMENT ============

    function _checkTicks(int tickLower, int tickUpper) internal view {
        require(tickLower < tickUpper, "TLU");
        require(tickLower >= TickMath.MIN_TICK, "TLM");
        require(tickUpper <= TickMath.MAX_TICK, "TUM");
        require(tickLower % tickSpacing == 0 && tickUpper % tickSpacing == 0, "Tick not multiple of spacing");
    }

    /// @notice Update tick + position bookkeeping for a liquidity change
    ///         (canonical _updatePosition: Tick.update x2 -> bitmap flips -> Position.update
    ///         -> Tick.clear on emptied ticks, in exactly that order)
    function _updatePosition(address positionOwner, int tickLower, int tickUpper, int liquidityDelta) internal {
        (int tickCum, int splCum) = Oracle.observeSingle(
            observations, block.timestamp, 0,
            currentTick, observationIndex, liquidity, observationCardinality
        );

        bool flippedLower = Tick.update(
            ticks, tickLower, currentTick, liquidityDelta,
            feeGrowthGlobal0X128, feeGrowthGlobal1X128,
            splCum, tickCum, block.timestamp, false, maxLiquidityPerTick
        );
        bool flippedUpper = Tick.update(
            ticks, tickUpper, currentTick, liquidityDelta,
            feeGrowthGlobal0X128, feeGrowthGlobal1X128,
            splCum, tickCum, block.timestamp, true, maxLiquidityPerTick
        );

        if (flippedLower) {
            TickBitmap.flipTick(tickBitmap, tickLower, tickSpacing);
        }
        if (flippedUpper) {
            TickBitmap.flipTick(tickBitmap, tickUpper, tickSpacing);
        }

        (int inside0, int inside1) = Tick.getFeeGrowthInside(
            ticks, tickLower, tickUpper, currentTick, feeGrowthGlobal0X128, feeGrowthGlobal1X128
        );
        Position.update(positions, positionOwner, tickLower, tickUpper, liquidityDelta, inside0, inside1);

        // Clear emptied ticks only after the position's final fee accrual above
        if (liquidityDelta < 0) {
            if (flippedLower) {
                Tick.clear(ticks, tickLower);
            }
            if (flippedUpper) {
                Tick.clear(ticks, tickUpper);
            }
        }
    }

    /// @notice Read a position's liquidity and currently collectable amounts
    function getPosition(
        address positionOwner,
        int tickLower,
        int tickUpper
    ) external view returns (uint positionLiquidity, uint tokensOwed0, uint tokensOwed1) {
        V3Position storage pos = positions[positionOwner][tickLower][tickUpper];
        return (pos.liquidity, pos.tokensOwed0, pos.tokensOwed1);
    }

    // ============ CORE FUNCTIONS ============

    /// @notice Add liquidity to a position over [tickLower, tickUpper)
    /// @param recipient The owner of the position the liquidity is credited to
    /// @param tickLower Lower tick of the range (multiple of tickSpacing)
    /// @param tickUpper Upper tick of the range (multiple of tickSpacing)
    /// @param amount Liquidity units to add
    /// @param amount0Max Maximum token0 the caller will deposit (platform extension; canonical
    ///        V3 delegates slippage checks to the periphery)
    /// @param amount1Max Maximum token1 the caller will deposit (platform extension)
    /// @param deadline Timestamp after which the call reverts (platform extension)
    /// @return amount0 The token0 deposited
    /// @return amount1 The token1 deposited
    /// @dev Payment is approve + transferFrom from msg.sender (platform token model; canonical
    ///      V3 collects via the mint callback instead)
    function mint(
        address recipient,
        int tickLower,
        int tickUpper,
        uint amount,
        uint amount0Max,
        uint amount1Max,
        uint deadline
    ) external whenNotPaused onlyActiveTokens nonReentrant returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Invalid liquidity");
        require(block.timestamp <= deadline, "EXPIRED");
        _checkTicks(tickLower, tickUpper);

        // In-range liquidity changes write an oracle checkpoint first (canonical _modifyPosition)
        if (currentTick >= tickLower && currentTick < tickUpper) {
            _writeObservation();
        }
        _updatePosition(recipient, tickLower, tickUpper, int(amount));

        (amount0, amount1) = _amountsForLiquidity(tickLower, tickUpper, amount, true);
        require(amount0 > 0 || amount1 > 0, "Zero amounts");
        require(amount0 <= amount0Max && amount1 <= amount1Max, "Slippage check failed");

        if (currentTick >= tickLower && currentTick < tickUpper) {
            liquidity += amount;
        }

        if (amount0 > 0) {
            require(token0.transferFrom(msg.sender, address(this), amount0), "Token0 transfer failed");
            token0Balance += amount0;
        }
        if (amount1 > 0) {
            require(token1.transferFrom(msg.sender, address(this), amount1), "Token1 transfer failed");
            token1Balance += amount1;
        }

        emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
        return (amount0, amount1);
    }

    /// @notice Remove liquidity from a caller's position; amounts become collectable via collect()
    /// @param amount Liquidity units to remove (0 = poke, just accrues fees)
    /// @param deadline Timestamp after which the call reverts (platform extension)
    /// @return amount0 The token0 credited to the position
    /// @return amount1 The token1 credited to the position
    function burn(
        int tickLower,
        int tickUpper,
        uint amount,
        uint deadline
    ) external whenNotDisabled nonReentrant returns (uint amount0, uint amount1) {
        require(block.timestamp <= deadline, "EXPIRED");
        _checkTicks(tickLower, tickUpper);

        // In-range liquidity changes write an oracle checkpoint first (canonical _modifyPosition)
        if (amount > 0 && currentTick >= tickLower && currentTick < tickUpper) {
            _writeObservation();
        }
        _updatePosition(msg.sender, tickLower, tickUpper, -int(amount));

        if (amount > 0) {
            (amount0, amount1) = _amountsForLiquidity(tickLower, tickUpper, amount, false);
            if (currentTick >= tickLower && currentTick < tickUpper) {
                liquidity -= amount;
            }

            V3Position storage pos = positions[msg.sender][tickLower][tickUpper];
            pos.tokensOwed0 += amount0;
            pos.tokensOwed1 += amount1;
        }

        emit Burn(msg.sender, tickLower, tickUpper, amount, amount0, amount1);
        return (amount0, amount1);
    }

    /// @dev Oracle checkpoint accruing the current tick/liquidity (canonical Oracle.write call)
    function _writeObservation() internal {
        (observationIndex, observationCardinality) = Oracle.write(
            observations, observationIndex, block.timestamp,
            currentTick, liquidity, observationCardinality, observationCardinalityNext
        );
    }

    /// @notice Collect owed tokens (burned principal + accrued fees) from a caller's position
    /// @param recipient Address the collected tokens are sent to
    /// @param amount0Requested Maximum token0 to collect
    /// @param amount1Requested Maximum token1 to collect
    function collect(
        address recipient,
        int tickLower,
        int tickUpper,
        uint amount0Requested,
        uint amount1Requested
    ) external whenNotDisabled nonReentrant returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        V3Position storage pos = positions[msg.sender][tickLower][tickUpper];

        amount0 = pos.tokensOwed0 < amount0Requested ? pos.tokensOwed0 : amount0Requested;
        amount1 = pos.tokensOwed1 < amount1Requested ? pos.tokensOwed1 : amount1Requested;

        if (amount0 > 0) {
            pos.tokensOwed0 -= amount0;
            token0Balance -= amount0;
            require(token0.transfer(recipient, amount0), "Token0 transfer failed");
        }
        if (amount1 > 0) {
            pos.tokensOwed1 -= amount1;
            token1Balance -= amount1;
            require(token1.transfer(recipient, amount1), "Token1 transfer failed");
        }

        emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
        return (amount0, amount1);
    }

    // ============ SWAP ============

    /// @notice Swap token0 for token1, or token1 for token0
    /// @param recipient Address to receive the output tokens
    /// @param zeroForOne If true, swap token0 in for token1 out (price moves down)
    /// @param amountSpecified Exact input (> 0, fee taken from input) or exact output (< 0)
    /// @param sqrtPriceLimitX96 Price limit; 0 defaults to the tick-domain edge. Must be
    ///        strictly inside (MIN_SQRT_RATIO, MAX_SQRT_RATIO) ('SPL', as canonical)
    /// @param amountLimit Platform extension replacing V3's periphery checks: for exact input,
    ///        the minimum acceptable output; for exact output, the maximum acceptable input
    /// @param deadline Timestamp after which the call reverts (platform extension)
    /// @return amount0 Signed token0 delta of the pool (positive = pool received)
    /// @return amount1 Signed token1 delta of the pool
    function swap(
        address recipient,
        bool zeroForOne,
        int amountSpecified,
        uint sqrtPriceLimitX96,
        uint amountLimit,
        uint deadline
    ) external whenNotPaused onlyActiveTokens nonReentrant returns (int amount0, int amount1) {
        require(amountSpecified != 0, "AS");
        require(amountLimit > 0, "Invalid amount limit");
        require(block.timestamp <= deadline, "EXPIRED");
        require(recipient != address(0), "Zero recipient");

        uint limit = sqrtPriceLimitX96;
        if (limit == 0) {
            limit = zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1;
        }
        if (zeroForOne) {
            require(limit < sqrtPriceX96 && limit > TickMath.MIN_SQRT_RATIO, "SPL");
        } else {
            require(limit > sqrtPriceX96 && limit < TickMath.MAX_SQRT_RATIO, "SPL");
        }

        // Pre-swap snapshot: the oracle checkpoint and the crossing cache accrue with these
        // values (canonical slot0Start / cache semantics)
        int tickBefore = currentTick;
        uint liquidityBefore = liquidity;
        (int cacheTickCum, int cacheSplCum) = Oracle.observeSingle(
            observations, block.timestamp, 0,
            tickBefore, observationIndex, liquidityBefore, observationCardinality
        );

        bool exactInput = amountSpecified > 0;
        int remaining = amountSpecified;
        int calculated = 0;
        uint protocolFees = 0;
        uint lpShare = _lpSharePercent();
        uint feePips = fee;

        while (remaining != 0 && sqrtPriceX96 != limit) {
            uint stepStartSqrt = sqrtPriceX96;

            (int foundTick, bool nextInitialized) =
                TickBitmap.nextInitializedTickWithinOneWord(tickBitmap, currentTick, tickSpacing, zeroForOne);
            int nextTick = foundTick;
            if (nextTick < TickMath.MIN_TICK) {
                nextTick = TickMath.MIN_TICK;
            } else if (nextTick > TickMath.MAX_TICK) {
                nextTick = TickMath.MAX_TICK;
            }
            uint tickSqrt = TickMath.getSqrtRatioAtTick(nextTick);

            // Step target: the next tick, clamped by the price limit. A tick exactly on the
            // limit is still the target so it gets crossed when reached (canonical semantics)
            uint targetSqrt = limit;
            if (zeroForOne) {
                if (tickSqrt >= limit) targetSqrt = tickSqrt;
            } else {
                if (tickSqrt <= limit) targetSqrt = tickSqrt;
            }

            (uint newSqrt, uint stepIn, uint stepOut, uint stepFee) =
                SwapMath.computeSwapStep(sqrtPriceX96, targetSqrt, liquidity, remaining, feePips);

            if (exactInput) {
                remaining -= int(stepIn + stepFee);
                calculated -= int(stepOut);
            } else {
                remaining += int(stepOut);
                calculated += int(stepIn + stepFee);
            }

            // Fee accounting (platform extension): LP share accrues as Q128 fee growth,
            // protocol share leaves the pool to the factory's feeCollector after the loop
            uint lpFee = (stepFee * lpShare) / 10000;
            protocolFees += stepFee - lpFee;
            if (lpFee > 0 && liquidity > 0) {
                if (zeroForOne) {
                    feeGrowthGlobal0X128 += int((lpFee * FixedPoint128.Q128) / liquidity);
                } else {
                    feeGrowthGlobal1X128 += int((lpFee * FixedPoint128.Q128) / liquidity);
                }
            }

            sqrtPriceX96 = newSqrt;

            if (newSqrt == tickSqrt) {
                // Reached the next tick: apply its liquidity if initialized; word-boundary
                // sentinels just advance the search window (canonical does the same)
                if (nextInitialized) {
                    int liquidityNet = Tick.cross(
                        ticks, nextTick,
                        feeGrowthGlobal0X128, feeGrowthGlobal1X128,
                        cacheSplCum, cacheTickCum, block.timestamp
                    );
                    if (zeroForOne) {
                        liquidityNet = -liquidityNet;
                    }
                    int newLiquidity = int(liquidity) + liquidityNet;
                    require(newLiquidity >= 0, "Liquidity underflow on cross");
                    liquidity = uint(newLiquidity);
                }
                currentTick = zeroForOne ? nextTick - 1 : nextTick;
            } else if (newSqrt != stepStartSqrt) {
                currentTick = TickMath.getTickAtSqrtRatio(newSqrt);
            }
        }

        // Oracle checkpoint accrues the pre-swap tick/liquidity, only if the tick moved (canonical)
        if (currentTick != tickBefore) {
            (observationIndex, observationCardinality) = Oracle.write(
                observations, observationIndex, block.timestamp,
                tickBefore, liquidityBefore, observationCardinality, observationCardinalityNext
            );
        }

        uint amountInTotal = 0;
        uint amountOutTotal = 0;
        if (exactInput) {
            amountInTotal = uint(amountSpecified - remaining);
            amountOutTotal = uint(-calculated);
            require(amountOutTotal >= amountLimit, "Slippage check failed");
        } else {
            amountInTotal = uint(calculated);
            amountOutTotal = uint(-(amountSpecified - remaining));
            require(amountOutTotal > 0, "Nothing swapped");
            require(amountInTotal <= amountLimit, "Slippage check failed");
        }

        Token inputToken = zeroForOne ? token0 : token1;
        Token outputToken = zeroForOne ? token1 : token0;

        require(inputToken.transferFrom(msg.sender, address(this), amountInTotal), "Input transfer failed");
        if (protocolFees > 0) {
            require(inputToken.transfer(_feeCollector(), protocolFees), "Protocol fee transfer failed");
        }
        require(outputToken.transfer(recipient, amountOutTotal), "Output transfer failed");

        if (zeroForOne) {
            token0Balance += amountInTotal - protocolFees;
            token1Balance -= amountOutTotal;
            amount0 = int(amountInTotal);
            amount1 = -int(amountOutTotal);
        } else {
            token1Balance += amountInTotal - protocolFees;
            token0Balance -= amountOutTotal;
            amount0 = -int(amountOutTotal);
            amount1 = int(amountInTotal);
        }

        emit Swap(msg.sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, currentTick);
        return (amount0, amount1);
    }

    // ============ BALANCE RECONCILIATION (platform extension, mirrors Pool.sol) ============

    /// @notice Sync tracked balances with actual token balances (e.g., after a token migration)
    /// @dev Does not touch pricing: the pool price lives in sqrtPriceX96, so sync only
    ///      repairs the tracked-balance bookkeeping used by collect/skim
    function sync() external onlyPoolV3Factory {
        token0Balance = token0.balanceOf(address(this));
        token1Balance = token1.balanceOf(address(this));
        emit Sync(token0Balance, token1Balance);
    }

    /// @notice Transfer any token balance in excess of the tracked balances to `to`
    /// @param to Address to send the excess tokens to
    function skim(address to) external onlyPoolV3Factory {
        require(to != address(0), "Invalid recipient");
        uint excess0 = token0.balanceOf(address(this)) - token0Balance;
        uint excess1 = token1.balanceOf(address(this)) - token1Balance;

        if (excess0 > 0) {
            require(token0.transfer(to, excess0), "Token0 skim failed");
        }
        if (excess1 > 0) {
            require(token1.transfer(to, excess1), "Token1 skim failed");
        }

        emit Skim(to, excess0, excess1);
    }

    /// @notice Transfer the pool to a new factory (platform extension)
    /// @dev Only callable by the current PoolV3Factory; the new factory must then adopt the
    ///      pool via registerPoolsFromFactory so its registry stays consistent
    function transferPoolToFactory(address newFactory) external onlyPoolV3Factory {
        require(newFactory != address(0), "Invalid factory address");
        poolV3Factory = PoolV3Factory(newFactory);
    }
}
