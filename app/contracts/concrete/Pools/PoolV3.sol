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
 *   users may call the pool directly, so mint/swap/burn carry trailing slippage/deadline
 *   parameters that canonical V3 delegates to its periphery. flash() keeps its callback (the
 *   borrower must act between receiving and repaying): IPoolV3FlashCallback replaces
 *   IUniswapV3FlashCallback, and repayment is a transfer back to the pool inside the callback,
 *   verified by balance delta exactly as canonical. The fee is the pool's swap fee tier,
 *   as canonical
 * - Protocol fees: canonical feeProtocol model (setFeeProtocol 1/x denominators per direction,
 *   per-step accrual into protocolFees0/1, collectProtocol withdrawal). Access is the factory
 *   or the pool owner (canonical: the factory owner); the factory's collectPoolProtocol wrapper
 *   routes proceeds to its feeCollector
 * - Admin: initialize carries the token/fee/factory wiring (proxy pattern); pause/disable,
 *   token-active gating, sync/skim and factory migration mirror the platform's V2 Pool
 * - Guard semantics: paused blocks mint+swap+flash (exit stays open); disabled blocks everything;
 *   inactive tokens block mint+swap+flash but never burn/collect; flashPaused blocks flash only
 * - Locking: as canonical, pools are born locked (slot0.unlocked == false in fresh proxied
 *   storage) and unlock at the end of initialize, so nothing runs before initialization
 *
 * @author Mercata Protocol
 * @version 1.0.0
 */
/// @notice Callback for PoolV3.flash (canonical IUniswapV3FlashCallback). Any contract that
///         calls flash must implement this and, before returning, transfer the borrowed amounts
///         plus fee0/fee1 back to the pool
interface IPoolV3FlashCallback {
    /// @param fee0 The fee amount in token0 due to the pool by the end of the flash
    /// @param fee1 The fee amount in token1 due to the pool by the end of the flash
    /// @param data Any data passed through by the caller via the flash call
    function poolV3FlashCallback(uint fee0, uint fee1, variadic data) external;
}

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

    /// @notice Emitted by flash; paid0/paid1 are the amounts repaid over the borrowed principal
    event Flash(address sender, address recipient, uint amount0, uint amount1, uint paid0, uint paid1);

    /// @notice Emitted when the observation ring buffer growth is scheduled
    event IncreaseObservationCardinalityNext(uint observationCardinalityNextOld, uint observationCardinalityNextNew);

    /// @notice Emitted when the protocol fee denominators are changed (canonical shape)
    event SetFeeProtocol(uint feeProtocol0Old, uint feeProtocol1Old, uint feeProtocol0New, uint feeProtocol1New);

    /// @notice Emitted when accrued protocol fees are withdrawn (canonical shape)
    event CollectProtocol(address sender, address recipient, uint amount0, uint amount1);

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

    /// @notice The current protocol fee as a fraction of the swap fee, represented as an
    ///         integer denominator 1/x, packed per input direction as
    ///         feeProtocol0 + (feeProtocol1 << 4) (canonical slot0.feeProtocol)
    uint public feeProtocol;

    /// @notice Accrued protocol fees in token0 units, withdrawn via collectProtocol
    ///         (canonical protocolFees.token0)
    uint public protocolFees0;

    /// @notice Accrued protocol fees in token1 units (canonical protocolFees.token1)
    uint public protocolFees1;

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

    /// @notice Pauses flash() only; swaps and liquidity operations are unaffected
    bool public isFlashPaused = false;

    /// @notice Whether the pool is unlocked (canonical slot0.unlocked). Pools are born locked —
    ///         false in fresh (proxied) storage — and unlock at the end of initialize, so no
    ///         lock-guarded call works before initialization, as canonical
    bool private unlocked;

    // ============ MODIFIERS ============

    /// @dev Mutually exclusive reentrancy protection into the pool to/from a method. This
    ///      method also prevents entrance to a function before the pool is initialized
    ///      (canonical lock)
    modifier lock() {
        require(unlocked, "LOK");
        unlocked = false;
        _;
        unlocked = true;
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

    modifier whenFlashNotPaused() {
        require(!isFlashPaused, "Flash is paused");
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

    /// @notice Pause or resume flash() without touching the pool-wide pause
    function setFlashPaused(bool _isFlashPaused) external onlyOwner {
        isFlashPaused = _isFlashPaused;
    }

    /// @notice Set the denominator of the protocol's share of the swap fee (canonical setFeeProtocol)
    /// @param feeProtocol0 New protocol fee denominator for token0-input swaps (0, or 4..10)
    /// @param feeProtocol1 New protocol fee denominator for token1-input swaps (0, or 4..10)
    /// @dev Callable by the factory or the pool owner (canonical: the factory owner)
    function setFeeProtocol(uint feeProtocol0, uint feeProtocol1) external lock onlyPoolV3Factory {
        require(
            (feeProtocol0 == 0 || (feeProtocol0 >= 4 && feeProtocol0 <= 10)) &&
                (feeProtocol1 == 0 || (feeProtocol1 >= 4 && feeProtocol1 <= 10))
        );
        uint feeProtocolOld = feeProtocol;
        feeProtocol = feeProtocol0 + (feeProtocol1 << 4);
        emit SetFeeProtocol(feeProtocolOld % 16, feeProtocolOld >> 4, feeProtocol0, feeProtocol1);
    }

    /// @notice Collect the protocol fee accrued to the pool (canonical collectProtocol)
    /// @param recipient The address to which collected protocol fees should be sent
    /// @param amount0Requested The maximum amount of token0 to send
    /// @param amount1Requested The maximum amount of token1 to send
    /// @return amount0 The protocol fee collected in token0
    /// @return amount1 The protocol fee collected in token1
    function collectProtocol(
        address recipient,
        uint amount0Requested,
        uint amount1Requested
    ) external lock onlyPoolV3Factory returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        amount0 = amount0Requested > protocolFees0 ? protocolFees0 : amount0Requested;
        amount1 = amount1Requested > protocolFees1 ? protocolFees1 : amount1Requested;

        if (amount0 > 0) {
            // ensure that the slot is not cleared, for gas savings (canonical; kept so
            // collection amounts stay bit-identical to canonical's)
            if (amount0 == protocolFees0) amount0 -= 1;
            protocolFees0 -= amount0;
            token0Balance -= amount0;
            require(token0.transfer(recipient, amount0), "Token0 transfer failed");
        }
        if (amount1 > 0) {
            if (amount1 == protocolFees1) amount1 -= 1;
            protocolFees1 -= amount1;
            token1Balance -= amount1;
            require(token1.transfer(recipient, amount1), "Token1 transfer failed");
        }

        emit CollectProtocol(msg.sender, recipient, amount0, amount1);
        return (amount0, amount1);
    }

    // ============ INTERNAL HELPERS (platform) ============

    function _tokenFactory() internal view returns (TokenFactory) {
        return TokenFactory(address(PoolV3Factory(address(poolV3Factory)).tokenFactory()));
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

        // pools are born locked; initialization opens them (canonical slot0.unlocked = true)
        unlocked = true;

        emit Initialize(initialSqrtPriceX96, currentTick);
    }

    /// @notice Canonical V3 slot0 view: price, tick, oracle indices, protocol fee mode, lock
    /// @dev feeProtocol is packed per input direction as feeProtocol0 + (feeProtocol1 << 4),
    ///      as canonical
    function slot0() external view returns (
        uint sqrtPriceX96_,
        int tick_,
        uint observationIndex_,
        uint observationCardinality_,
        uint observationCardinalityNext_,
        uint feeProtocol_,
        bool unlocked_
    ) {
        return (sqrtPriceX96, currentTick, observationIndex, observationCardinality, observationCardinalityNext, feeProtocol, unlocked);
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
        (int amount0Int, int amount1Int) = _amountsForLiquidity(tickLower, tickUpper, int(liquidityAmount));
        return (uint(amount0Int), uint(amount1Int));
    }

    /// @dev Signed token deltas for a liquidity change, as canonical _modifyPosition computes
    ///      them: positive liquidityDelta rounds up (mint), negative rounds down (burn)
    function _amountsForLiquidity(
        int tickLower,
        int tickUpper,
        int liquidityDelta
    ) internal view returns (int amount0, int amount1) {
        if (currentTick < tickLower) {
            // current tick is below the passed range; liquidity can only become in range by crossing from left to
            // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
            amount0 = SqrtPriceMath.getAmount0Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidityDelta
            );
        } else if (currentTick < tickUpper) {
            // current tick is inside the passed range
            amount0 = SqrtPriceMath.getAmount0Delta(
                sqrtPriceX96,
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidityDelta
            );
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                sqrtPriceX96,
                liquidityDelta
            );
        } else {
            // current tick is above the passed range; liquidity can only become in range by crossing from right to
            // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
            amount1 = SqrtPriceMath.getAmount1Delta(
                TickMath.getSqrtRatioAtTick(tickLower),
                TickMath.getSqrtRatioAtTick(tickUpper),
                liquidityDelta
            );
        }
        return (amount0, amount1);
    }

    // ============ TWAP ORACLE (wrappers over the Oracle library) ============

    /// @notice Grow the observation ring buffer (permissionless, as in Uniswap V3)
    /// @param next The desired minimum ring size
    /// @dev The explicit bounds require replaces canonical's implicit uint16 range
    function increaseObservationCardinalityNext(uint next) external lock {
        require(next > 0 && next <= MAX_CARDINALITY, "Invalid cardinality");
        uint observationCardinalityNextOld = observationCardinalityNext; // for the event
        uint observationCardinalityNextNew = Oracle.grow(observations, observationCardinalityNextOld, next);
        observationCardinalityNext = observationCardinalityNextNew;
        if (observationCardinalityNextOld != observationCardinalityNextNew)
            emit IncreaseObservationCardinalityNext(observationCardinalityNextOld, observationCardinalityNextNew);
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
        return Oracle.observe(
            observations, block.timestamp, secondsAgos,
            currentTick, observationIndex, liquidity, observationCardinality
        );
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
        V3Position storage position = Position.get(positions, positionOwner, tickLower, tickUpper);

        // if we need to update the ticks, do it (canonical: ticks are only touched when
        // liquidity actually changes; pokes skip straight to the position fee accrual)
        bool flippedLower = false;
        bool flippedUpper = false;
        if (liquidityDelta != 0) {
            (int tickCum, int splCum) = Oracle.observeSingle(
                observations, block.timestamp, 0,
                currentTick, observationIndex, liquidity, observationCardinality
            );

            flippedLower = Tick.update(
                ticks, tickLower, currentTick, liquidityDelta,
                feeGrowthGlobal0X128, feeGrowthGlobal1X128,
                splCum, tickCum, block.timestamp, false, maxLiquidityPerTick
            );
            flippedUpper = Tick.update(
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
        }

        (int inside0, int inside1) = Tick.getFeeGrowthInside(
            ticks, tickLower, tickUpper, currentTick, feeGrowthGlobal0X128, feeGrowthGlobal1X128
        );
        Position.update(position, liquidityDelta, inside0, inside1);

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

    /// @notice Read a position's fee-growth-inside snapshots (as of its last update)
    /// @dev For contracts that hold one pool position on behalf of many parties (the
    ///      position manager): after any pool call that runs Position.update, these
    ///      snapshots let the caller apportion fee growth to its own sub-positions with
    ///      the same delta math Position.update uses. Signed values, matching V3Position
    function getPositionFeeGrowthInside(
        address positionOwner,
        int tickLower,
        int tickUpper
    ) external view returns (int feeGrowthInside0LastX128, int feeGrowthInside1LastX128) {
        V3Position storage pos = positions[positionOwner][tickLower][tickUpper];
        return (pos.feeGrowthInside0LastX128, pos.feeGrowthInside1LastX128);
    }

    struct ModifyPositionParams {
        // the address that owns the position
        address owner;
        // the lower and upper tick of the position
        int tickLower;
        int tickUpper;
        // any change in liquidity
        int liquidityDelta;
    }

    /// @dev Effect some changes to a position (canonical _modifyPosition)
    /// @param params the position details and the change to the position's liquidity to effect
    /// @return amount0 the amount of token0 owed to the pool, negative if the pool should pay the recipient
    /// @return amount1 the amount of token1 owed to the pool, negative if the pool should pay the recipient
    /// @dev Canonical also returns the position's storage pointer; SolidVM cannot return
    ///      storage references inside tuples, so callers re-fetch via Position.get. The
    ///      amounts branch reuses _amountsForLiquidity (canonical inlines the same math)
    function _modifyPosition(ModifyPositionParams memory params) private returns (int amount0, int amount1) {
        _checkTicks(params.tickLower, params.tickUpper);

        _updatePosition(params.owner, params.tickLower, params.tickUpper, params.liquidityDelta);

        if (params.liquidityDelta != 0) {
            (amount0, amount1) = _amountsForLiquidity(params.tickLower, params.tickUpper, params.liquidityDelta);

            // current tick inside the range: write an oracle entry and shift active liquidity
            if (currentTick >= params.tickLower && currentTick < params.tickUpper) {
                uint liquidityBefore = liquidity; // SLOAD for gas optimization (canonical)
                _writeObservation();
                liquidity = LiquidityMath.addDelta(liquidityBefore, params.liquidityDelta);
            }
        }
        return (amount0, amount1);
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
    ) external lock whenNotPaused onlyActiveTokens returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Invalid liquidity");
        require(block.timestamp <= deadline, "EXPIRED");

        (int amount0Int, int amount1Int) =
            _modifyPosition(
                ModifyPositionParams({
                    owner: recipient,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: int(amount)
                })
            );

        amount0 = uint(amount0Int);
        amount1 = uint(amount1Int);
        require(amount0 > 0 || amount1 > 0, "Zero amounts");
        require(amount0 <= amount0Max && amount1 <= amount1Max, "Slippage check failed");

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
    ) external lock whenNotDisabled returns (uint amount0, uint amount1) {
        require(block.timestamp <= deadline, "EXPIRED");

        (int amount0Int, int amount1Int) =
            _modifyPosition(
                ModifyPositionParams({
                    owner: msg.sender,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: -int(amount)
                })
            );

        amount0 = uint(-amount0Int);
        amount1 = uint(-amount1Int);

        if (amount0 > 0 || amount1 > 0) {
            V3Position storage position = Position.get(positions, msg.sender, tickLower, tickUpper);
            position.tokensOwed0 += amount0;
            position.tokensOwed1 += amount1;
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
    ) external lock whenNotDisabled returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        // we don't need to checkTicks here, because invalid positions will never have non-zero tokensOwed{0,1}
        V3Position storage pos = Position.get(positions, msg.sender, tickLower, tickUpper);

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

    struct SwapCache {
        // the protocol fee for the input token
        uint feeProtocol;
        // liquidity at the beginning of the swap
        uint liquidityStart;
        // the timestamp of the current block
        uint blockTimestamp;
        // the current value of the tick accumulator, computed only if we cross an initialized tick
        int tickCumulative;
        // the current value of seconds per liquidity accumulator, computed only if we cross an initialized tick
        int secondsPerLiquidityCumulativeX128;
        // whether we've computed and cached the above two accumulators
        bool computedLatestObservation;
    }

    // the top level state of the swap, the results of which are recorded in storage at the end
    struct SwapState {
        // the amount remaining to be swapped in/out of the input/output asset
        int amountSpecifiedRemaining;
        // the amount already swapped out/in of the output/input asset
        int amountCalculated;
        // current sqrt(price)
        uint sqrtPriceX96;
        // the tick associated with the current price
        int tick;
        // the global fee growth of the input token
        int feeGrowthGlobalX128;
        // amount of input token paid as protocol fee
        uint protocolFee;
        // the current liquidity in range
        uint liquidity;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint sqrtPriceStartX96;
        // the next tick to swap to from the current tick in the swap direction
        int tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        // sqrt(price) for the next tick (1/0)
        uint sqrtPriceNextX96;
        // how much is being swapped in in this step
        uint amountIn;
        // how much is being swapped out
        uint amountOut;
        // how much fee is being paid in
        uint feeAmount;
    }

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
    ) external lock whenNotPaused onlyActiveTokens returns (int amount0, int amount1) {
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

        // canonical slot0Start.tick; price/tick/oracle indices are read from storage directly
        int tickBefore = currentTick;

        // struct fields are assigned individually: SolidVM memory structs initialized from a
        // literal become immutable, so canonical's SwapCache({...}) form cannot be used
        SwapCache memory cache;
        cache.liquidityStart = liquidity;
        cache.blockTimestamp = block.timestamp;
        cache.feeProtocol = zeroForOne ? (feeProtocol % 16) : (feeProtocol >> 4);

        bool exactInput = amountSpecified > 0;

        SwapState memory state;
        state.amountSpecifiedRemaining = amountSpecified;
        state.amountCalculated = 0;
        state.sqrtPriceX96 = sqrtPriceX96;
        state.tick = tickBefore;
        state.feeGrowthGlobalX128 = zeroForOne ? feeGrowthGlobal0X128 : feeGrowthGlobal1X128;
        state.protocolFee = 0;
        state.liquidity = cache.liquidityStart;

        // continue swapping as long as we haven't used the entire input/output and haven't reached the price limit
        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != limit) {
            StepComputations memory step;

            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) = TickBitmap.nextInitializedTickWithinOneWord(
                tickBitmap,
                state.tick,
                tickSpacing,
                zeroForOne
            );

            // ensure that we do not overshoot the min/max tick, as the tick bitmap is not aware of these bounds
            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            // get the price for the next tick
            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            // compute values to swap to the target tick, price limit, or point where input/output amount is exhausted
            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                state.sqrtPriceX96,
                (zeroForOne ? step.sqrtPriceNextX96 < limit : step.sqrtPriceNextX96 > limit)
                    ? limit
                    : step.sqrtPriceNextX96,
                state.liquidity,
                state.amountSpecifiedRemaining,
                fee
            );

            if (exactInput) {
                state.amountSpecifiedRemaining -= int(step.amountIn + step.feeAmount);
                state.amountCalculated -= int(step.amountOut);
            } else {
                state.amountSpecifiedRemaining += int(step.amountOut);
                state.amountCalculated += int(step.amountIn + step.feeAmount);
            }

            // if the protocol fee is on, calculate how much is owed, decrement feeAmount, and increment protocolFee
            if (cache.feeProtocol > 0) {
                uint delta = step.feeAmount / cache.feeProtocol;
                step.feeAmount -= delta;
                state.protocolFee += delta;
            }

            // update global fee tracker
            if (state.liquidity > 0)
                state.feeGrowthGlobalX128 += int(FullMath.mulDiv(step.feeAmount, FixedPoint128.Q128, state.liquidity));

            // shift tick if we reached the next price
            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // check for the placeholder value, which we replace with the actual value the first time the swap
                    // crosses an initialized tick
                    if (!cache.computedLatestObservation) {
                        (cache.tickCumulative, cache.secondsPerLiquidityCumulativeX128) = Oracle.observeSingle(
                            observations,
                            cache.blockTimestamp,
                            0,
                            tickBefore,
                            observationIndex,
                            cache.liquidityStart,
                            observationCardinality
                        );
                        cache.computedLatestObservation = true;
                    }
                    int liquidityNet = Tick.cross(
                        ticks,
                        step.tickNext,
                        (zeroForOne ? state.feeGrowthGlobalX128 : feeGrowthGlobal0X128),
                        (zeroForOne ? feeGrowthGlobal1X128 : state.feeGrowthGlobalX128),
                        cache.secondsPerLiquidityCumulativeX128,
                        cache.tickCumulative,
                        cache.blockTimestamp
                    );
                    // if we're moving leftward, we interpret liquidityNet as the opposite sign
                    if (zeroForOne) liquidityNet = -liquidityNet;

                    state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
                }

                state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                // recompute unless we're on a lower tick boundary (i.e. already transitioned ticks), and haven't moved
                state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
            }
        }

        // update tick and write an oracle entry if the tick change
        if (state.tick != tickBefore) {
            (observationIndex, observationCardinality) = Oracle.write(
                observations, observationIndex, cache.blockTimestamp,
                tickBefore, cache.liquidityStart, observationCardinality, observationCardinalityNext
            );
            sqrtPriceX96 = state.sqrtPriceX96;
            currentTick = state.tick;
        } else {
            // otherwise just update the price
            sqrtPriceX96 = state.sqrtPriceX96;
        }

        // update liquidity if it changed
        if (cache.liquidityStart != state.liquidity) liquidity = state.liquidity;

        // update fee growth global and, if necessary, protocol fees
        if (zeroForOne) {
            feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees0 += state.protocolFee;
        } else {
            feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees1 += state.protocolFee;
        }

        // platform settlement (canonical pays the recipient and collects via the swap callback)
        uint amountInTotal = 0;
        uint amountOutTotal = 0;
        if (exactInput) {
            amountInTotal = uint(amountSpecified - state.amountSpecifiedRemaining);
            amountOutTotal = uint(-state.amountCalculated);
            require(amountOutTotal >= amountLimit, "Slippage check failed");
        } else {
            amountInTotal = uint(state.amountCalculated);
            amountOutTotal = uint(-(amountSpecified - state.amountSpecifiedRemaining));
            require(amountOutTotal > 0, "Nothing swapped");
            require(amountInTotal <= amountLimit, "Slippage check failed");
        }

        Token inputToken = zeroForOne ? token0 : token1;
        Token outputToken = zeroForOne ? token1 : token0;

        require(inputToken.transferFrom(msg.sender, address(this), amountInTotal), "Input transfer failed");
        require(outputToken.transfer(recipient, amountOutTotal), "Output transfer failed");

        if (zeroForOne) {
            token0Balance += amountInTotal;
            token1Balance -= amountOutTotal;
            amount0 = int(amountInTotal);
            amount1 = -int(amountOutTotal);
        } else {
            token1Balance += amountInTotal;
            token0Balance -= amountOutTotal;
            amount0 = -int(amountOutTotal);
            amount1 = int(amountInTotal);
        }

        emit Swap(msg.sender, recipient, amount0, amount1, state.sqrtPriceX96, state.liquidity, state.tick);
        return (amount0, amount1);
    }

    // ============ FLASH ============

    /// @notice Receive token0 and/or token1 and pay it back, plus a fee, in the callback
    /// @param recipient The address which will receive the token0 and token1 amounts
    /// @param amount0 The amount of token0 to send
    /// @param amount1 The amount of token1 to send
    /// @param data Any data to be passed through to the callback
    /// @dev The caller of this method receives a callback in the form of
    ///      IPoolV3FlashCallback.poolV3FlashCallback and must transfer amount0 + fee0 / amount1 +
    ///      fee1 back to the pool before it returns. Fees are the pool's swap fee tier applied
    ///      to the borrowed amounts, rounded up; anything repaid above the principal is split
    ///      between the protocol (per feeProtocol) and in-range liquidity, all as canonical.
    ///      Reentering the pool from the callback reverts (lock)
    function flash(
        address recipient,
        uint amount0,
        uint amount1,
        variadic data
    ) external lock whenNotPaused whenFlashNotPaused onlyActiveTokens {
        require(recipient != address(0), "Zero recipient");
        uint _liquidity = liquidity;
        require(_liquidity > 0, "L");

        uint fee0 = FullMath.mulDivRoundingUp(amount0, fee, 1e6);
        uint fee1 = FullMath.mulDivRoundingUp(amount1, fee, 1e6);
        uint balance0Before = token0.balanceOf(address(this));
        uint balance1Before = token1.balanceOf(address(this));

        if (amount0 > 0) require(token0.transfer(recipient, amount0), "Token0 transfer failed");
        if (amount1 > 0) require(token1.transfer(recipient, amount1), "Token1 transfer failed");

        IPoolV3FlashCallback(msg.sender).poolV3FlashCallback(fee0, fee1, data);

        uint balance0After = token0.balanceOf(address(this));
        uint balance1After = token1.balanceOf(address(this));

        require(balance0Before + fee0 <= balance0After, "F0");
        require(balance1Before + fee1 <= balance1After, "F1");

        // sub is safe because we know balanceAfter is gt balanceBefore by at least fee
        uint paid0 = balance0After - balance0Before;
        uint paid1 = balance1After - balance1Before;

        // the principal came back, so only the overage moves the tracked balances (platform)
        if (paid0 > 0) {
            uint feeProtocol0 = feeProtocol % 16;
            uint fees0 = feeProtocol0 == 0 ? 0 : paid0 / feeProtocol0;
            if (fees0 > 0) protocolFees0 += fees0;
            feeGrowthGlobal0X128 += int(FullMath.mulDiv(paid0 - fees0, FixedPoint128.Q128, _liquidity));
            token0Balance += paid0;
        }
        if (paid1 > 0) {
            uint feeProtocol1 = feeProtocol >> 4;
            uint fees1 = feeProtocol1 == 0 ? 0 : paid1 / feeProtocol1;
            if (fees1 > 0) protocolFees1 += fees1;
            feeGrowthGlobal1X128 += int(FullMath.mulDiv(paid1 - fees1, FixedPoint128.Q128, _liquidity));
            token1Balance += paid1;
        }

        emit Flash(msg.sender, recipient, amount0, amount1, paid0, paid1);
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
