// SPDX-License-Identifier: MIT
import "PoolV3Factory.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/// @notice Per-tick state (Uniswap V3 Tick.Info, cumulative fields as signed ints —
///         SolidVM has no wrapping arithmetic, and only deltas of these are meaningful)
struct V3TickInfo {
    uint liquidityGross;
    int liquidityNet;
    int feeGrowthOutside0X128;
    int feeGrowthOutside1X128;
    int tickCumulativeOutside;
    int secondsPerLiquidityOutsideX128;
    int secondsOutside;
    bool initialized;
}

/// @notice A liquidity position over a tick range, keyed by (owner, tickLower, tickUpper)
struct V3Position {
    uint liquidity;
    int feeGrowthInside0LastX128;
    int feeGrowthInside1LastX128;
    uint tokensOwed0;
    uint tokensOwed1;
}

/// @notice A TWAP oracle checkpoint (Uniswap V3 Oracle.Observation)
struct V3Observation {
    uint blockTimestamp;
    int tickCumulative;
    int secondsPerLiquidityCumulativeX128;
    bool initialized;
}

/**
 * @title PoolV3
 * @notice A concentrated liquidity pool — a port of Uniswap V3's UniswapV3Pool to SolidVM
 * @dev Math is canonical Uniswap V3: Q64.96 sqrt prices, the exact 20 TickMath constants,
 *      SqrtPriceMath/SwapMath formulas, Q128 fee growth, the full ±887272 tick domain and a
 *      TickBitmap for next-tick lookup. Because SolidVM integers are unbounded, a*b/c is exact
 *      (what FullMath.mulDiv achieves on the EVM), so outputs are bit-identical to canonical
 *      V3 wherever V3 itself does not intentionally overflow. Nested ceil/floor divisions
 *      collapse by the identity ceil(ceil(n/b)/a) == ceil(n/(a*b)) (same for floor).
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
 * - Oracle: timestamps are full-width (no uint32 wrap), cumulative quantities are signed ints
 *   (no uint wrap); observe() additionally has a single-lookback observeSingle convenience
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

    // ============ CONSTANTS (canonical TickMath / fixed-point bases) ============

    int constant MIN_TICK = -887272;
    int constant MAX_TICK = 887272;

    /// @notice getSqrtRatioAtTick(MIN_TICK) / (MAX_TICK): canonical TickMath values
    uint constant MIN_SQRT_RATIO = 4295128739;
    uint constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @notice Q64.96 and Q128 fixed-point units
    uint constant Q96 = 79228162514264337593543950336;
    uint constant Q128 = 340282366920938463463374607431768211456;

    /// @notice All 256 bits of a bitmap word set (2**256 - 1)
    uint constant MAX_WORD = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

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

    /// @notice Maximum position liquidity referencing any single tick (V3 'LO' guard)
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

    /// @notice Per-tick state
    mapping(int => V3TickInfo) public record ticks;

    /// @notice Bitmap of initialized ticks: word index => 256-bit word, one bit per tick spacing
    /// @dev Word index is floor(tick / tickSpacing / 256), as in Uniswap V3 TickBitmap
    mapping(int => uint) public record tickBitmap;

    /// @notice Positions: owner => tickLower => tickUpper => position
    /// @dev Canonical V3 keys by keccak256(owner, tickLower, tickUpper); a nested mapping is
    ///      the same key space and queryable in Cirrus
    mapping(address => mapping(int => mapping(int => V3Position))) public record positions;

    // ============ TWAP ORACLE ============

    /// @notice Oracle observations ring buffer (slot => observation)
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

    /// @dev Division truncating toward zero, as the EVM does. SolidVM's `/` floors instead
    ///      (-7 / 2 == -4), so canonical V3 spots that divide signed values (the oracle's
    ///      tick interpolation) need the truncated form for bit-identical results
    function _divTrunc(int a, int b) internal pure returns (int) {
        int q = a / b;
        if (a % b != 0 && ((a < 0) != (b < 0))) {
            return q + 1;
        }
        return q;
    }

    /// @dev Integer division rounding toward negative infinity. SolidVM's `/` already floors,
    ///      so this wrapper just documents intent at tick/bitmap call sites
    function _floorDiv(int a, int b) internal pure returns (int) {
        return a / b;
    }

    /// @dev 2**n for n in [0, 255], built from squaring constants (SolidVM-safe)
    function _pow2(uint n) internal pure returns (uint) {
        require(n <= 255, "pow2 out of range");
        uint r = 1;
        if ((n & 1) != 0)   r *= 2;
        if ((n & 2) != 0)   r *= 4;
        if ((n & 4) != 0)   r *= 16;
        if ((n & 8) != 0)   r *= 256;
        if ((n & 16) != 0)  r *= 65536;
        if ((n & 32) != 0)  r *= 4294967296;
        if ((n & 64) != 0)  r *= 18446744073709551616;
        if ((n & 128) != 0) r *= 340282366920938463463374607431768211456;
        return r;
    }

    /// @dev Index of the most significant set bit (Uniswap V3 BitMath.mostSignificantBit)
    function _msb(uint x) internal pure returns (uint) {
        require(x > 0, "msb of zero");
        uint v = x;
        uint r = 0;
        if (v >= 340282366920938463463374607431768211456) { v /= 340282366920938463463374607431768211456; r += 128; }
        if (v >= 18446744073709551616) { v /= 18446744073709551616; r += 64; }
        if (v >= 4294967296) { v /= 4294967296; r += 32; }
        if (v >= 65536) { v /= 65536; r += 16; }
        if (v >= 256)   { v /= 256;   r += 8; }
        if (v >= 16)    { v /= 16;    r += 4; }
        if (v >= 4)     { v /= 4;     r += 2; }
        if (v >= 2)     { r += 1; }
        return r;
    }

    /// @dev Index of the least significant set bit (Uniswap V3 BitMath.leastSignificantBit)
    function _lsb(uint x) internal pure returns (uint) {
        require(x > 0, "lsb of zero");
        // x & (x - 1) clears the lowest set bit; the difference isolates it
        uint lowBit = x - (x & (x - 1));
        return _msb(lowBit);
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

        // V3 Tick.tickSpacingToMaxLiquidityPerTick. MIN_TICK == -MAX_TICK exactly, so the
        // EVM's truncated MIN_TICK / tickSpacing equals -(MAX_TICK / tickSpacing) here
        int maxUsableTick = (MAX_TICK / _tickSpacing) * _tickSpacing;
        uint numTicks = uint((maxUsableTick * 2) / _tickSpacing + 1);
        maxLiquidityPerTick = (2**128 - 1) / numTicks;

        sqrtPriceX96 = initialSqrtPriceX96;
        currentTick = getTickAtSqrtRatio(initialSqrtPriceX96);

        // Bootstrap the oracle ring buffer with a single observation (V3 Oracle.initialize)
        observationIndex = 0;
        observationCardinality = 1;
        observationCardinalityNext = 1;
        V3Observation storage obs0 = observations[0];
        obs0.blockTimestamp = block.timestamp;
        obs0.tickCumulative = 0;
        obs0.secondsPerLiquidityCumulativeX128 = 0;
        obs0.initialized = true;

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

    // ============ TICK MATH (canonical Uniswap V3 TickMath) ============

    /// @notice sqrt(1.0001^tick) as a Q64.96
    /// @dev Bit-for-bit port of TickMath.getSqrtRatioAtTick: the 20 Q128.128 constants encode
    ///      sqrt(1.0001)^-(2^k); positive ticks invert via (2^256 - 1) / ratio, and the final
    ///      Q128 -> Q96 conversion rounds up. Constants validated against a 120-digit
    ///      reference in tests/Pool/poolv3_reference.py
    function getSqrtRatioAtTick(int tick) public pure returns (uint) {
        uint absTick = tick < 0 ? uint(-tick) : uint(tick);
        require(absTick <= uint(MAX_TICK), "T");

        uint ratio = (absTick & 0x1) != 0
            ? 0xfffcb933bd6fad37aa2d162d1a594001
            : 0x100000000000000000000000000000000;
        if ((absTick & 0x2) != 0)     ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if ((absTick & 0x4) != 0)     ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if ((absTick & 0x8) != 0)     ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if ((absTick & 0x10) != 0)    ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if ((absTick & 0x20) != 0)    ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if ((absTick & 0x40) != 0)    ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if ((absTick & 0x80) != 0)    ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if ((absTick & 0x100) != 0)   ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if ((absTick & 0x200) != 0)   ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if ((absTick & 0x400) != 0)   ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if ((absTick & 0x800) != 0)   ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if ((absTick & 0x1000) != 0)  ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if ((absTick & 0x2000) != 0)  ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if ((absTick & 0x4000) != 0)  ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if ((absTick & 0x8000) != 0)  ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if ((absTick & 0x10000) != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if ((absTick & 0x20000) != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if ((absTick & 0x40000) != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if ((absTick & 0x80000) != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) {
            ratio = (2**256 - 1) / ratio;
        }

        // Q128.128 -> Q64.96, rounding up (canonical final step)
        uint sqrtRatio = ratio >> 32;
        if (ratio % 4294967296 != 0) {
            sqrtRatio += 1;
        }
        return sqrtRatio;
    }

    /// @notice Greatest tick whose sqrt ratio is <= the given ratio
    /// @dev Same spec as TickMath.getTickAtSqrtRatio (which uses an assembly log2 the SolidVM
    ///      has no equivalent for); a binary search over getSqrtRatioAtTick returns identical
    ///      values. Input domain [MIN_SQRT_RATIO, MAX_SQRT_RATIO) as canonical ('R')
    function getTickAtSqrtRatio(uint _sqrtPriceX96) public pure returns (int) {
        require(_sqrtPriceX96 >= MIN_SQRT_RATIO && _sqrtPriceX96 < MAX_SQRT_RATIO, "R");
        int lo = MIN_TICK;
        int hi = MAX_TICK;
        while (lo < hi) {
            int mid = (lo + hi + 1) / 2;
            if (getSqrtRatioAtTick(mid) <= _sqrtPriceX96) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    // ============ TICK BITMAP (canonical Uniswap V3 TickBitmap) ============

    /// @dev (word index, bit index) of a compressed tick
    function _bitmapPosition(int compressed) internal pure returns (int, uint) {
        int wordPos = _floorDiv(compressed, 256);
        uint bitPos = uint(compressed - wordPos * 256); // always in [0, 255]
        return (wordPos, bitPos);
    }

    /// @notice Flip a tick's initialized bit in the bitmap
    function _flipTick(int tick) internal {
        require(tick % tickSpacing == 0, "Tick not spaced");
        (int wordPos, uint bitPos) = _bitmapPosition(tick / tickSpacing);
        uint bit = _pow2(bitPos);
        uint word = tickBitmap[wordPos];
        // XOR without ^ (unsupported): add the bit if clear, remove it if set
        if ((word & bit) != 0) {
            tickBitmap[wordPos] = word - bit;
        } else {
            tickBitmap[wordPos] = word + bit;
        }
    }

    /// @notice Next initialized tick within one bitmap word, in the swap direction
    /// @param tick The current tick (need not be spacing-aligned)
    /// @param lte If true search at-or-below `tick` (price moving down), else strictly above
    /// @return next The next initialized tick, or the word boundary if the word has no set bits
    /// @return initialized Whether `next` is an initialized tick (false = word-boundary sentinel)
    /// @dev Word-boundary results let the swap loop step word by word, exactly as Uniswap V3;
    ///      the caller must clamp `next` to [MIN_TICK, MAX_TICK]
    function _nextInitializedTickWithinOneWord(int tick, bool lte) internal view returns (int, bool) {
        int compressed = _floorDiv(tick, tickSpacing);

        if (lte) {
            (int wordPos, uint bitPos) = _bitmapPosition(compressed);
            // Bits at or below bitPos
            uint mask = MAX_WORD;
            if (bitPos < 255) {
                mask = _pow2(bitPos + 1) - 1;
            }
            uint masked = tickBitmap[wordPos] & mask;
            if (masked != 0) {
                return ((compressed - int(bitPos - _msb(masked))) * tickSpacing, true);
            }
            return ((compressed - int(bitPos)) * tickSpacing, false);
        }

        (int wordPosUp, uint bitPosUp) = _bitmapPosition(compressed + 1);
        // Bits at or above bitPosUp: subtract off the low bits
        uint word = tickBitmap[wordPosUp];
        uint lowMask = 0;
        if (bitPosUp > 0) {
            lowMask = _pow2(bitPosUp) - 1;
        }
        uint maskedUp = word - (word & lowMask);
        if (maskedUp != 0) {
            return ((compressed + 1 + int(_lsb(maskedUp) - bitPosUp)) * tickSpacing, true);
        }
        return ((compressed + 1 + int(255 - bitPosUp)) * tickSpacing, false);
    }

    // ============ AMOUNT MATH (canonical Uniswap V3 SqrtPriceMath) ============

    /// @notice Token0 amount for `liquidityAmt` between two sqrt ratios
    /// @dev getAmount0Delta: L * 2^96 * (sqrtB - sqrtA) / (sqrtB * sqrtA), one exact division
    ///      (equals V3's nested mulDiv/div by the ceil/floor nesting identity)
    function _amount0Delta(uint sqrtA, uint sqrtB, uint liquidityAmt, bool roundUp) internal pure returns (uint) {
        if (sqrtA > sqrtB) {
            (sqrtA, sqrtB) = (sqrtB, sqrtA);
        }
        require(sqrtA > 0, "Invalid sqrt ratio");
        uint numerator = liquidityAmt * Q96 * (sqrtB - sqrtA);
        uint denominator = sqrtB * sqrtA;
        return roundUp ? _divRoundUp(numerator, denominator) : numerator / denominator;
    }

    /// @notice Token1 amount for `liquidityAmt` between two sqrt ratios
    /// @dev getAmount1Delta: L * (sqrtB - sqrtA) / 2^96
    function _amount1Delta(uint sqrtA, uint sqrtB, uint liquidityAmt, bool roundUp) internal pure returns (uint) {
        if (sqrtA > sqrtB) {
            (sqrtA, sqrtB) = (sqrtB, sqrtA);
        }
        uint numerator = liquidityAmt * (sqrtB - sqrtA);
        return roundUp ? _divRoundUp(numerator, Q96) : numerator / Q96;
    }

    /// @dev getNextSqrtPriceFromInput. SolidVM's exact wide math always takes V3's
    ///      no-overflow branch; where mainnet would hit the overflow fallback our result is
    ///      the mathematically exact one
    function _nextSqrtFromInput(uint sqrtP, uint liq, uint amountIn, bool zeroForOne) internal pure returns (uint) {
        if (zeroForOne) {
            if (amountIn == 0) return sqrtP;
            uint numerator1 = liq * Q96;
            return _divRoundUp(numerator1 * sqrtP, numerator1 + amountIn * sqrtP);
        }
        return sqrtP + (amountIn * Q96) / liq;
    }

    /// @dev getNextSqrtPriceFromOutput
    function _nextSqrtFromOutput(uint sqrtP, uint liq, uint amountOut, bool zeroForOne) internal pure returns (uint) {
        if (zeroForOne) {
            uint quotient = _divRoundUp(amountOut * Q96, liq);
            require(sqrtP > quotient, "Insufficient liquidity for output");
            return sqrtP - quotient;
        }
        uint numerator1 = liq * Q96;
        uint product = amountOut * sqrtP;
        require(numerator1 > product, "Insufficient liquidity for output");
        return _divRoundUp(numerator1 * sqrtP, numerator1 - product);
    }

    /// @dev Bit-for-bit port of SwapMath.computeSwapStep. amountRemaining >= 0 is exact input
    ///      (fee taken from input), < 0 is exact output
    function _computeSwapStep(
        uint sqrtCurrent,
        uint sqrtTarget,
        uint liq,
        int amountRemaining,
        uint feePips
    ) internal pure returns (uint sqrtNext, uint amountIn, uint amountOut, uint feeAmount) {
        bool zeroForOne = sqrtCurrent >= sqrtTarget;
        bool exactIn = amountRemaining >= 0;
        sqrtNext = 0;
        amountIn = 0;
        amountOut = 0;
        feeAmount = 0;

        if (exactIn) {
            uint amountRemainingLessFee = (uint(amountRemaining) * (1000000 - feePips)) / 1000000;
            amountIn = zeroForOne
                ? _amount0Delta(sqrtTarget, sqrtCurrent, liq, true)
                : _amount1Delta(sqrtCurrent, sqrtTarget, liq, true);
            if (amountRemainingLessFee >= amountIn) {
                sqrtNext = sqrtTarget;
            } else {
                sqrtNext = _nextSqrtFromInput(sqrtCurrent, liq, amountRemainingLessFee, zeroForOne);
            }
        } else {
            amountOut = zeroForOne
                ? _amount1Delta(sqrtTarget, sqrtCurrent, liq, false)
                : _amount0Delta(sqrtCurrent, sqrtTarget, liq, false);
            if (uint(-amountRemaining) >= amountOut) {
                sqrtNext = sqrtTarget;
            } else {
                sqrtNext = _nextSqrtFromOutput(sqrtCurrent, liq, uint(-amountRemaining), zeroForOne);
            }
        }

        bool max = sqrtTarget == sqrtNext;

        if (zeroForOne) {
            if (!(max && exactIn)) {
                amountIn = _amount0Delta(sqrtNext, sqrtCurrent, liq, true);
            }
            if (!(max && !exactIn)) {
                amountOut = _amount1Delta(sqrtNext, sqrtCurrent, liq, false);
            }
        } else {
            if (!(max && exactIn)) {
                amountIn = _amount1Delta(sqrtCurrent, sqrtNext, liq, true);
            }
            if (!(max && !exactIn)) {
                amountOut = _amount0Delta(sqrtCurrent, sqrtNext, liq, false);
            }
        }

        // Cap the output to the exact-output request
        if (!exactIn && amountOut > uint(-amountRemaining)) {
            amountOut = uint(-amountRemaining);
        }

        if (exactIn && sqrtNext != sqrtTarget) {
            // Input exhausted within this step: the leftover input is the fee
            feeAmount = uint(amountRemaining) - amountIn;
        } else {
            feeAmount = _divRoundUp(amountIn * feePips, 1000000 - feePips);
        }
        return (sqrtNext, amountIn, amountOut, feeAmount);
    }

    /// @notice Token amounts required to mint `liquidityAmount` over a range at the current price
    /// @dev Platform convenience (canonical V3 keeps this in the periphery's LiquidityAmounts)
    function getAmountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount
    ) public view returns (uint amount0, uint amount1) {
        return _amountsForLiquidity(tickLower, tickUpper, liquidityAmount, true);
    }

    /// @dev roundUp=true when depositing (mint), false when withdrawing (burn), as in V3
    function _amountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount,
        bool roundUp
    ) internal view returns (uint, uint) {
        uint sqrtLower = getSqrtRatioAtTick(tickLower);
        uint sqrtUpper = getSqrtRatioAtTick(tickUpper);
        if (currentTick < tickLower) {
            return (_amount0Delta(sqrtLower, sqrtUpper, liquidityAmount, roundUp), 0);
        }
        if (currentTick < tickUpper) {
            return (
                _amount0Delta(sqrtPriceX96, sqrtUpper, liquidityAmount, roundUp),
                _amount1Delta(sqrtLower, sqrtPriceX96, liquidityAmount, roundUp)
            );
        }
        return (0, _amount1Delta(sqrtLower, sqrtUpper, liquidityAmount, roundUp));
    }

    // ============ TWAP ORACLE (canonical Uniswap V3 Oracle) ============

    /// @dev Current extrapolated accumulators, from the given tick/liquidity in effect since
    ///      the latest observation (Oracle.observeSingle's secondsAgo == 0 path)
    function _currentCumulatives(int tickAccrue, uint liquidityAccrue) internal view returns (int, int) {
        V3Observation storage last = observations[observationIndex];
        if (last.blockTimestamp == block.timestamp) {
            return (last.tickCumulative, last.secondsPerLiquidityCumulativeX128);
        }
        uint delta = block.timestamp - last.blockTimestamp;
        return (
            last.tickCumulative + tickAccrue * int(delta),
            last.secondsPerLiquidityCumulativeX128
                + int((delta * Q128) / (liquidityAccrue > 0 ? liquidityAccrue : 1))
        );
    }

    /// @notice Record a checkpoint of the accumulators (at most one per timestamp)
    /// @dev Oracle.write. Called with the tick/liquidity that were in effect since the
    ///      previous observation, per canonical V3: on in-range mint/burn before the
    ///      liquidity change, and at the end of a swap with the pre-swap values
    function _writeObservation(int tickAccrue, uint liquidityAccrue) internal {
        V3Observation storage last = observations[observationIndex];
        if (last.blockTimestamp == block.timestamp) {
            return;
        }

        uint cardinality = observationCardinality;
        // Grow into pre-announced slots only when the ring is about to wrap (V3 semantics)
        if (observationCardinalityNext > cardinality && observationIndex == cardinality - 1) {
            cardinality = observationCardinalityNext;
        }

        (int newTickCumulative, int newSpl) = _currentCumulatives(tickAccrue, liquidityAccrue);
        uint indexUpdated = (observationIndex + 1) % cardinality;

        V3Observation storage obs = observations[indexUpdated];
        obs.blockTimestamp = block.timestamp;
        obs.tickCumulative = newTickCumulative;
        obs.secondsPerLiquidityCumulativeX128 = newSpl;
        obs.initialized = true;

        observationIndex = indexUpdated;
        observationCardinality = cardinality;
    }

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

    /// @dev Ring binary search for the two observations straddling `target` (Oracle.binarySearch).
    ///      Precondition: oldest.blockTimestamp <= target < newest.blockTimestamp
    function _observationBinarySearch(uint target) internal view returns (uint, uint) {
        uint cardinality = observationCardinality;
        int l = int((observationIndex + 1) % cardinality); // oldest slot
        int r = l + int(cardinality) - 1;                  // newest slot (mod cardinality)

        // Bounded defensively; the precondition guarantees convergence well within this
        for (uint iter = 0; iter < 2 * cardinality + 16; iter++) {
            int i = (l + r) / 2;
            uint beforeIdx = uint(i) % cardinality;
            V3Observation storage beforeOrAt = observations[beforeIdx];

            // Uninitialized slots (ring grew but hasn't wrapped): keep to the recent side
            if (!beforeOrAt.initialized) {
                l = i + 1;
                continue;
            }

            uint afterIdx = (uint(i) + 1) % cardinality;
            V3Observation storage atOrAfter = observations[afterIdx];

            if (beforeOrAt.blockTimestamp <= target && target <= atOrAfter.blockTimestamp) {
                return (beforeIdx, afterIdx);
            }
            if (beforeOrAt.blockTimestamp > target) {
                r = i - 1;
            } else {
                l = i + 1;
            }
        }
        require(false, "Observation search failed");
        return (0, 0);
    }

    /// @dev Oracle.observeSingle for one lookback
    function _observeSingle(uint secondsAgo) internal view returns (int, int) {
        if (secondsAgo == 0) {
            return _currentCumulatives(currentTick, liquidity);
        }

        uint target = block.timestamp - secondsAgo;

        // At or after the newest observation: extrapolate with the current tick/liquidity
        V3Observation storage newest = observations[observationIndex];
        if (newest.blockTimestamp <= target) {
            if (newest.blockTimestamp == target) {
                return (newest.tickCumulative, newest.secondsPerLiquidityCumulativeX128);
            }
            uint deltaNew = target - newest.blockTimestamp;
            return (
                newest.tickCumulative + currentTick * int(deltaNew),
                newest.secondsPerLiquidityCumulativeX128
                    + int((deltaNew * Q128) / (liquidity > 0 ? liquidity : 1))
            );
        }

        // Older than the oldest retained observation: unanswerable
        uint oldestIdx = (observationIndex + 1) % observationCardinality;
        V3Observation storage oldestCandidate = observations[oldestIdx];
        if (!oldestCandidate.initialized) {
            oldestIdx = 0; // ring grew but has not wrapped: true oldest is slot 0
        }
        V3Observation storage oldest = observations[oldestIdx];
        require(oldest.blockTimestamp <= target, "OLD");

        (uint beforeIdx, uint afterIdx) = _observationBinarySearch(target);
        V3Observation storage beforeOrAt = observations[beforeIdx];
        V3Observation storage atOrAfter = observations[afterIdx];

        if (beforeOrAt.blockTimestamp == target) {
            return (beforeOrAt.tickCumulative, beforeOrAt.secondsPerLiquidityCumulativeX128);
        }
        if (atOrAfter.blockTimestamp == target) {
            return (atOrAfter.tickCumulative, atOrAfter.secondsPerLiquidityCumulativeX128);
        }

        // Interpolate exactly as canonical V3: tickCumulative divides first with EVM
        // truncation semantics; secondsPerLiquidity multiplies first
        uint obsDelta = atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp;
        uint targetDelta = target - beforeOrAt.blockTimestamp;
        int tickCum = beforeOrAt.tickCumulative
            + _divTrunc(atOrAfter.tickCumulative - beforeOrAt.tickCumulative, int(obsDelta)) * int(targetDelta);
        int splCum = beforeOrAt.secondsPerLiquidityCumulativeX128
            + int((uint(atOrAfter.secondsPerLiquidityCumulativeX128 - beforeOrAt.secondsPerLiquidityCumulativeX128)
                   * targetDelta) / obsDelta);
        return (tickCum, splCum);
    }

    /// @notice Accumulator values as of each `secondsAgos[i]` seconds ago (canonical V3 observe)
    /// @dev TWAP tick over window w = (tickCumulatives[0 seconds ago] - tickCumulatives[w]) / w;
    ///      reverts 'OLD' when the ring no longer holds data that far back
    function observe(uint[] secondsAgos) external view returns (
        int[] tickCumulatives,
        int[] secondsPerLiquidityCumulativeX128s
    ) {
        int[] memory tickCums = new int[](secondsAgos.length);
        int[] memory splCums = new int[](secondsAgos.length);
        for (uint i = 0; i < secondsAgos.length; i++) {
            (int tc, int spl) = _observeSingle(secondsAgos[i]);
            tickCums[i] = tc;
            splCums[i] = spl;
        }
        return (tickCums, splCums);
    }

    /// @notice Single-lookback convenience wrapper over observe (platform extension)
    function observeSingle(uint secondsAgo) external view returns (int tickCumulative, int secondsPerLiquidityCumulativeX128) {
        return _observeSingle(secondsAgo);
    }

    /// @notice Cumulative snapshots inside a tick range (canonical V3 snapshotCumulativesInside)
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
            (int tickCum, int splCum) = _currentCumulatives(currentTick, liquidity);
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

    // ============ TICK MANAGEMENT (canonical Uniswap V3 Tick) ============

    /// @notice Update a tick's liquidity bookkeeping for a position change (Tick.update)
    /// @return True when the tick flipped to zero liquidity; the caller must _clearTick it
    ///         only after its fee accounting no longer needs the tick
    function _updateTick(
        int tick,
        int liquidityDelta,
        bool isUpper,
        int tickCumulative_,
        int secondsPerLiquidityCumulativeX128_
    ) internal returns (bool) {
        V3TickInfo storage info = ticks[tick];
        // liquidityGross tracks total liquidity referencing this tick; add and remove
        // apply the same signed delta because a position references each of its ticks once
        int grossAfterSigned = int(info.liquidityGross) + liquidityDelta;
        require(grossAfterSigned >= 0, "Tick liquidity underflow");
        uint grossBefore = info.liquidityGross;
        uint grossAfter = uint(grossAfterSigned);
        require(grossAfter <= maxLiquidityPerTick, "LO");

        if (grossBefore == 0 && grossAfter > 0) {
            // Convention (as in V3): assume all prior growth happened below the tick
            if (tick <= currentTick) {
                info.feeGrowthOutside0X128 = feeGrowthGlobal0X128;
                info.feeGrowthOutside1X128 = feeGrowthGlobal1X128;
                info.tickCumulativeOutside = tickCumulative_;
                info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128_;
                info.secondsOutside = int(block.timestamp);
            } else {
                info.feeGrowthOutside0X128 = 0;
                info.feeGrowthOutside1X128 = 0;
                info.tickCumulativeOutside = 0;
                info.secondsPerLiquidityOutsideX128 = 0;
                info.secondsOutside = 0;
            }
            info.initialized = true;
            _flipTick(tick);
        }

        info.liquidityGross = grossAfter;
        if (isUpper) {
            info.liquidityNet -= liquidityDelta;
        } else {
            info.liquidityNet += liquidityDelta;
        }

        if (grossBefore > 0 && grossAfter == 0) {
            // De-initialize for next-tick search now, but leave the outside snapshots intact:
            // _updatePosition still needs them for the position's final fee accrual, and
            // clears the tick afterwards (V3 clears ticks only after Position.update)
            info.initialized = false;
            _flipTick(tick);
            return true;
        }
        return false;
    }

    /// @notice Fully reset a tick whose liquidity dropped to zero (V3's Tick.clear)
    function _clearTick(int tick) internal {
        V3TickInfo storage info = ticks[tick];
        info.feeGrowthOutside0X128 = 0;
        info.feeGrowthOutside1X128 = 0;
        info.tickCumulativeOutside = 0;
        info.secondsPerLiquidityOutsideX128 = 0;
        info.secondsOutside = 0;
        info.liquidityNet = 0;
    }

    /// @notice Cross an initialized tick during a swap (Tick.cross)
    function _crossTick(
        int tick,
        bool zeroForOne,
        int tickCumulative_,
        int secondsPerLiquidityCumulativeX128_
    ) internal {
        V3TickInfo storage info = ticks[tick];
        info.feeGrowthOutside0X128 = feeGrowthGlobal0X128 - info.feeGrowthOutside0X128;
        info.feeGrowthOutside1X128 = feeGrowthGlobal1X128 - info.feeGrowthOutside1X128;
        info.tickCumulativeOutside = tickCumulative_ - info.tickCumulativeOutside;
        info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128_ - info.secondsPerLiquidityOutsideX128;
        info.secondsOutside = int(block.timestamp) - info.secondsOutside;

        int lNet = info.liquidityNet;
        if (zeroForOne) {
            lNet = -lNet;
        }
        int newLiquidity = int(liquidity) + lNet;
        require(newLiquidity >= 0, "Liquidity underflow on cross");
        liquidity = uint(newLiquidity);
    }

    /// @notice Fee growth inside a tick range (may be transiently negative; deltas are what matter)
    function _feeGrowthInside(int tickLower, int tickUpper) internal view returns (int inside0, int inside1) {
        V3TickInfo storage lowerInfo = ticks[tickLower];
        V3TickInfo storage upperInfo = ticks[tickUpper];

        int below0 = currentTick >= tickLower ? lowerInfo.feeGrowthOutside0X128 : feeGrowthGlobal0X128 - lowerInfo.feeGrowthOutside0X128;
        int below1 = currentTick >= tickLower ? lowerInfo.feeGrowthOutside1X128 : feeGrowthGlobal1X128 - lowerInfo.feeGrowthOutside1X128;
        int above0 = currentTick < tickUpper ? upperInfo.feeGrowthOutside0X128 : feeGrowthGlobal0X128 - upperInfo.feeGrowthOutside0X128;
        int above1 = currentTick < tickUpper ? upperInfo.feeGrowthOutside1X128 : feeGrowthGlobal1X128 - upperInfo.feeGrowthOutside1X128;

        inside0 = feeGrowthGlobal0X128 - below0 - above0;
        inside1 = feeGrowthGlobal1X128 - below1 - above1;
        return (inside0, inside1);
    }

    // ============ POSITION MANAGEMENT ============

    function _checkTicks(int tickLower, int tickUpper) internal view {
        require(tickLower < tickUpper, "TLU");
        require(tickLower >= MIN_TICK, "TLM");
        require(tickUpper <= MAX_TICK, "TUM");
        require(tickLower % tickSpacing == 0 && tickUpper % tickSpacing == 0, "Tick not multiple of spacing");
    }

    /// @notice Update position liquidity and accrue owed fees to the position
    function _updatePosition(address positionOwner, int tickLower, int tickUpper, int liquidityDelta) internal {
        (int tickCum, int splCum) = _currentCumulatives(currentTick, liquidity);
        bool flippedLower = _updateTick(tickLower, liquidityDelta, false, tickCum, splCum);
        bool flippedUpper = _updateTick(tickUpper, liquidityDelta, true, tickCum, splCum);

        (int inside0, int inside1) = _feeGrowthInside(tickLower, tickUpper);

        V3Position storage pos = positions[positionOwner][tickLower][tickUpper];
        if (pos.liquidity > 0) {
            int delta0 = inside0 - pos.feeGrowthInside0LastX128;
            int delta1 = inside1 - pos.feeGrowthInside1LastX128;
            if (delta0 > 0) {
                pos.tokensOwed0 += (pos.liquidity * uint(delta0)) / Q128;
            }
            if (delta1 > 0) {
                pos.tokensOwed1 += (pos.liquidity * uint(delta1)) / Q128;
            }
        }
        pos.feeGrowthInside0LastX128 = inside0;
        pos.feeGrowthInside1LastX128 = inside1;

        int newPosLiquidity = int(pos.liquidity) + liquidityDelta;
        require(newPosLiquidity >= 0, "Position liquidity underflow");
        pos.liquidity = uint(newPosLiquidity);

        // Only now is it safe to wipe ticks this burn emptied; clearing them before the
        // fee accrual above would zero the outside snapshots that _feeGrowthInside just
        // read, crediting phantom fees to the position
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

        // In-range liquidity changes write an oracle checkpoint first (V3 _modifyPosition)
        if (currentTick >= tickLower && currentTick < tickUpper) {
            _writeObservation(currentTick, liquidity);
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

        // In-range liquidity changes write an oracle checkpoint first (V3 _modifyPosition)
        if (amount > 0 && currentTick >= tickLower && currentTick < tickUpper) {
            _writeObservation(currentTick, liquidity);
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
    ///        strictly inside (MIN_SQRT_RATIO, MAX_SQRT_RATIO) ('SPL', as canonical V3)
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
            limit = zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1;
        }
        if (zeroForOne) {
            require(limit < sqrtPriceX96 && limit > MIN_SQRT_RATIO, "SPL");
        } else {
            require(limit > sqrtPriceX96 && limit < MAX_SQRT_RATIO, "SPL");
        }

        // Pre-swap snapshot: the oracle checkpoint and the crossing cache accrue with these
        // values (canonical V3 slot0Start / cache semantics)
        int tickBefore = currentTick;
        uint liquidityBefore = liquidity;
        (int cacheTickCum, int cacheSplCum) = _currentCumulatives(tickBefore, liquidityBefore);

        bool exactInput = amountSpecified > 0;
        int remaining = amountSpecified;
        int calculated = 0;
        uint protocolFees = 0;
        uint lpShare = _lpSharePercent();
        uint feePips = fee;

        while (remaining != 0 && sqrtPriceX96 != limit) {
            uint stepStartSqrt = sqrtPriceX96;

            (int foundTick, bool nextInitialized) = _nextInitializedTickWithinOneWord(currentTick, zeroForOne);
            int nextTick = foundTick;
            if (nextTick < MIN_TICK) {
                nextTick = MIN_TICK;
            } else if (nextTick > MAX_TICK) {
                nextTick = MAX_TICK;
            }
            uint tickSqrt = getSqrtRatioAtTick(nextTick);

            // Step target: the next tick, clamped by the price limit. A tick exactly on the
            // limit is still the target so it gets crossed when reached (V3 semantics)
            uint targetSqrt = limit;
            if (zeroForOne) {
                if (tickSqrt >= limit) targetSqrt = tickSqrt;
            } else {
                if (tickSqrt <= limit) targetSqrt = tickSqrt;
            }

            (uint newSqrt, uint stepIn, uint stepOut, uint stepFee) =
                _computeSwapStep(sqrtPriceX96, targetSqrt, liquidity, remaining, feePips);

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
                    feeGrowthGlobal0X128 += int((lpFee * Q128) / liquidity);
                } else {
                    feeGrowthGlobal1X128 += int((lpFee * Q128) / liquidity);
                }
            }

            sqrtPriceX96 = newSqrt;

            if (newSqrt == tickSqrt) {
                // Reached the next tick: apply its liquidity if initialized; word-boundary
                // sentinels just advance the search window (canonical V3 does the same)
                if (nextInitialized) {
                    _crossTick(nextTick, zeroForOne, cacheTickCum, cacheSplCum);
                }
                currentTick = zeroForOne ? nextTick - 1 : nextTick;
            } else if (newSqrt != stepStartSqrt) {
                currentTick = getTickAtSqrtRatio(newSqrt);
            }
        }

        // Oracle checkpoint accrues the pre-swap tick/liquidity, only if the tick moved (V3)
        if (currentTick != tickBefore) {
            _writeObservation(tickBefore, liquidityBefore);
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
