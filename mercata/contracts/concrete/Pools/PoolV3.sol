// SPDX-License-Identifier: MIT
import "PoolV3Factory.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/// @notice Per-tick state for concentrated liquidity accounting (Uniswap V3 Tick.Info)
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

/// @notice A TWAP oracle checkpoint (Uniswap V3 Oracle.Observation, tick accumulator only)
struct V3Observation {
    uint blockTimestamp;
    int tickCumulative;
    bool initialized;
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
 * - Tick-crossing swaps with per-range liquidity; the next initialized tick is found via a
 *   tick bitmap (one 256-bit word per 256 tick-spacings, as in Uniswap V3 TickBitmap), so
 *   swap cost is independent of how many ticks are initialized
 * - Fee growth accounting per unit of in-range liquidity (LP share stays in pool, protocol
 *   share is sent to the fee collector, mirroring Pool.sol conventions)
 * - Positions are records keyed by (owner, tickLower, tickUpper) — no LP token is minted
 * - TWAP oracle: ring buffer of tick-accumulator observations (V3-style geometric-mean TWAP);
 *   cardinality is grown permissionlessly via increaseObservationCardinalityNext
 * - sync()/skim() balance reconciliation, factory-gated, mirroring Pool.sol
 *
 * Custody / guard semantics (deliberate, documented for reviewers):
 * - paused: blocks mint + swap; burn and collect still work (LPs can always exit a paused pool)
 * - disabled: emergency freeze — blocks mint, swap, burn AND collect until re-enabled.
 *   This is the platform's nuclear option and matches V2 Pool's whenNotDisabled posture.
 * - inactive token: blocks mint + swap but NOT burn/collect. This deliberately diverges from
 *   V2 Pool (whose removeLiquidity requires active tokens) in favor of Uniswap's principle
 *   that LP exit is always possible; use setDisabled for a full freeze.
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

    /// @notice Emitted when tracked balances are re-synced to actual token balances
    event Sync(uint tokenABalance, uint tokenBBalance);

    /// @notice Emitted when excess token balances are skimmed
    event Skim(address to, uint excessA, uint excessB);

    /// @notice Emitted when the observation ring buffer is grown
    event IncreaseObservationCardinalityNext(uint observationCardinalityNextOld, uint observationCardinalityNextNew);

    // ============ CONSTANTS ============

    uint constant WAD = 1e18;

    /// @notice Tick bounds. Half of Uniswap V3's range: price spans ~1e-19 .. 1e19, the widest
    /// range whose sqrt prices stay representable in WAD (1e18) scaling
    int constant MIN_TICK = -443636;
    int constant MAX_TICK = 443636;

    /// @notice All 256 bits of a bitmap word set (2**256 - 1)
    uint constant MAX_WORD = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    /// @notice Maximum observation ring size (as in Uniswap V3)
    uint constant MAX_CARDINALITY = 65535;

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

    /// @notice Bitmap of initialized ticks: word index => 256-bit word, one bit per tick spacing
    /// @dev Word index is floor(tick / tickSpacing / 256), as in Uniswap V3 TickBitmap
    mapping(int => uint) public record tickBitmap;

    /// @notice Positions: owner => tickLower => tickUpper => position
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

    /// @dev Integer division rounding toward negative infinity (for negative tick indexing).
    ///      SolidVM's `/` already floors for negative operands (-10 / 256 == -1, unlike the
    ///      EVM's truncation), so no correction term is needed; this wrapper just documents
    ///      the intent at the call sites
    function _floorDiv(int a, int b) internal pure returns (int) {
        return a / b;
    }

    /// @dev 2**n for n in [0, 255], built from squaring constants (SolidVM-safe: no variable shifts)
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

        // Bootstrap the oracle ring buffer with a single observation (V3 Oracle.initialize)
        observationIndex = 0;
        observationCardinality = 1;
        observationCardinalityNext = 1;
        V3Observation storage obs0 = observations[0];
        obs0.blockTimestamp = block.timestamp;
        obs0.tickCumulative = 0;
        obs0.initialized = true;

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

    // ============ TICK BITMAP (Uniswap V3 TickBitmap) ============

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
    /// @param lte If true search at-or-below `tick` (price moving down), else strictly above (moving up)
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

    /// @dev Token amounts for `liquidityAmount` over a range at the current price.
    ///      roundUp=true when depositing (mint), roundUp=false when withdrawing (burn),
    ///      so rounding always favors the pool
    function _amountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount,
        bool roundUp
    ) internal view returns (uint, uint) {
        uint sqrtLower = getSqrtPriceAtTick(tickLower);
        uint sqrtUpper = getSqrtPriceAtTick(tickUpper);
        if (currentTick < tickLower) {
            return (_amountADelta(sqrtLower, sqrtUpper, liquidityAmount, roundUp), 0);
        }
        if (currentTick < tickUpper) {
            return (
                _amountADelta(sqrtPriceWad, sqrtUpper, liquidityAmount, roundUp),
                _amountBDelta(sqrtLower, sqrtPriceWad, liquidityAmount, roundUp)
            );
        }
        return (0, _amountBDelta(sqrtLower, sqrtUpper, liquidityAmount, roundUp));
    }

    /// @notice Token amounts required to mint `liquidityAmount` over a range at the current price
    function getAmountsForLiquidity(
        int tickLower,
        int tickUpper,
        uint liquidityAmount
    ) public view returns (uint tokenAAmount, uint tokenBAmount) {
        return _amountsForLiquidity(tickLower, tickUpper, liquidityAmount, true);
    }

    // ============ TWAP ORACLE (Uniswap V3 Oracle, tick accumulator only) ============

    /// @notice Record a checkpoint of the tick accumulator (at most one per timestamp)
    /// @dev Called before any state-changing operation, so it always integrates the tick
    ///      that was in effect since the previous observation (V3 Oracle.write)
    function _writeObservation() internal {
        V3Observation storage last = observations[observationIndex];
        if (last.blockTimestamp == block.timestamp) {
            return;
        }

        uint cardinality = observationCardinality;
        // Grow into pre-announced slots only when the ring is about to wrap (V3 semantics)
        if (observationCardinalityNext > cardinality && observationIndex == cardinality - 1) {
            cardinality = observationCardinalityNext;
        }

        uint indexUpdated = (observationIndex + 1) % cardinality;
        int newCumulative = last.tickCumulative + currentTick * int(block.timestamp - last.blockTimestamp);

        V3Observation storage obs = observations[indexUpdated];
        obs.blockTimestamp = block.timestamp;
        obs.tickCumulative = newCumulative;
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
    function getObservation(uint slot) external view returns (uint blockTimestamp, int tickCumulative, bool initialized) {
        V3Observation storage obs = observations[slot];
        return (obs.blockTimestamp, obs.tickCumulative, obs.initialized);
    }

    /// @dev Ring binary search for the two observations straddling `target` (V3 Oracle.binarySearch).
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

    /// @notice Tick accumulator as of `secondsAgo` seconds ago (V3 Oracle.observeSingle)
    /// @dev TWAP tick over a window w = (observe(0) - observe(w)) / w;
    ///      TWAP price = 1.0001^twapTick (geometric mean, V3-style).
    ///      Reverts with 'OLD' when the ring no longer holds data that far back —
    ///      call increaseObservationCardinalityNext to retain a longer history.
    function observe(uint secondsAgo) public view returns (int) {
        if (secondsAgo == 0) {
            V3Observation storage last = observations[observationIndex];
            if (last.blockTimestamp == block.timestamp) {
                return last.tickCumulative;
            }
            return last.tickCumulative + currentTick * int(block.timestamp - last.blockTimestamp);
        }

        uint target = block.timestamp - secondsAgo;

        // At or after the newest observation: extrapolate with the current tick
        V3Observation storage newest = observations[observationIndex];
        if (newest.blockTimestamp <= target) {
            return newest.tickCumulative + currentTick * int(target - newest.blockTimestamp);
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
            return beforeOrAt.tickCumulative;
        }
        if (atOrAfter.blockTimestamp == target) {
            return atOrAfter.tickCumulative;
        }
        // Linear interpolation between the surrounding observations
        return beforeOrAt.tickCumulative
            + ((atOrAfter.tickCumulative - beforeOrAt.tickCumulative)
                * int(target - beforeOrAt.blockTimestamp))
              / int(atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp);
    }

    // ============ TICK MANAGEMENT ============

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
            _flipTick(tick);
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
            _flipTick(tick);
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

        _writeObservation();
        _updatePosition(msg.sender, tickLower, tickUpper, int(liquidityAmount));

        (tokenAAmount, tokenBAmount) = _amountsForLiquidity(tickLower, tickUpper, liquidityAmount, true);
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

        _writeObservation();
        _updatePosition(msg.sender, tickLower, tickUpper, -int(liquidityAmount));

        if (liquidityAmount > 0) {
            (tokenAAmount, tokenBAmount) = _amountsForLiquidity(tickLower, tickUpper, liquidityAmount, false);
            if (currentTick >= tickLower && currentTick < tickUpper) {
                liquidity -= liquidityAmount;
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
    /// @param sqrtPriceLimitWad Optional price limit (0 = no limit beyond tick bounds).
    ///        Must be strictly inside (minSqrtPrice, maxSqrtPrice), as in Uniswap V3
    /// @return amountInUsed The input tokens actually consumed (may be < amountIn on a partial fill)
    /// @return amountOut The output tokens sent to the caller
    function swap(
        bool isAToB,
        uint amountIn,
        uint minAmountOut,
        uint sqrtPriceLimitWad,
        uint deadline
    ) external whenNotPaused onlyActiveTokens nonReentrant returns (uint amountInUsed, uint amountOut) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");

        _writeObservation();

        // Price limits are strictly exclusive of the tick-domain endpoints (V3 semantics):
        // the pool price can approach but never reach the MIN/MAX sqrt price, so the
        // ticks at the domain edge can never be crossed and currentTick stays in range
        uint minSqrt = getSqrtPriceAtTick(MIN_TICK);
        uint maxSqrt = getSqrtPriceAtTick(MAX_TICK);
        uint limit = sqrtPriceLimitWad;
        if (limit == 0) {
            limit = isAToB ? minSqrt + 1 : maxSqrt - 1;
        }
        if (isAToB) {
            require(limit < sqrtPriceWad && limit > minSqrt, "Invalid price limit");
        } else {
            require(limit > sqrtPriceWad && limit < maxSqrt, "Invalid price limit");
        }

        uint feeRate = feeBps;
        uint lpShare = _lpSharePercent();
        uint remaining = amountIn;
        uint protocolFees = 0;

        while (remaining > 0 && sqrtPriceWad != limit) {
            uint stepStartSqrt = sqrtPriceWad;

            (int foundTick, bool nextInitialized) = _nextInitializedTickWithinOneWord(currentTick, isAToB);
            int nextTick = foundTick;
            if (nextTick < MIN_TICK) {
                nextTick = MIN_TICK;
            } else if (nextTick > MAX_TICK) {
                nextTick = MAX_TICK;
            }
            uint tickSqrt = getSqrtPriceAtTick(nextTick);

            // Target price for this step: the next tick (initialized or word boundary),
            // clamped by the limit. >= / <= (not strict): a tick sitting exactly on the
            // limit must still be the step target so it gets crossed when reached
            // (Uniswap V3 semantics); otherwise currentTick would pass the tick while
            // its liquidityNet was never applied
            uint targetSqrt = limit;
            bool targetIsTick = false;
            if (isAToB ? tickSqrt >= limit : tickSqrt <= limit) {
                targetSqrt = tickSqrt;
                targetIsTick = true;
            }

            // Net input needed to move the price all the way to the target
            // (zero when there is no in-range liquidity: the price jumps for free)
            uint netNeeded = isAToB
                ? _amountADelta(targetSqrt, sqrtPriceWad, liquidity, true)
                : _amountBDelta(sqrtPriceWad, targetSqrt, liquidity, true);
            uint netAvail = (remaining * (10000 - feeRate)) / 10000;

            uint netUsed = 0;
            uint grossUsed = 0;
            uint newSqrt = 0;
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
                // Reached the next tick: apply its liquidity if it is a real initialized
                // tick; word-boundary sentinels just advance the search window (V3 does
                // the same tick bookkeeping for both)
                if (nextInitialized) {
                    _crossTick(nextTick, isAToB);
                }
                currentTick = isAToB ? nextTick - 1 : nextTick;
            } else if (newSqrt != stepStartSqrt) {
                currentTick = getTickAtSqrtPrice(newSqrt);
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
        return (consumed, amountOut);
    }

    // ============ BALANCE RECONCILIATION (mirrors Pool.sol) ============

    /// @notice Sync tracked balances with actual token balances (e.g., after a token migration)
    /// @dev Unlike V2, this does not touch pricing: the pool price lives in sqrtPriceWad,
    ///      so sync only repairs the tracked-balance bookkeeping used by collect/skim
    function sync() external onlyPoolV3Factory {
        tokenABalance = tokenA.balanceOf(address(this));
        tokenBBalance = tokenB.balanceOf(address(this));
        emit Sync(tokenABalance, tokenBBalance);
    }

    /// @notice Transfer any token balance in excess of the tracked balances to `to`
    /// @param to Address to send the excess tokens to
    function skim(address to) external onlyPoolV3Factory {
        require(to != address(0), "Invalid recipient");
        uint excessA = tokenA.balanceOf(address(this)) - tokenABalance;
        uint excessB = tokenB.balanceOf(address(this)) - tokenBBalance;

        if (excessA > 0) {
            require(tokenA.transfer(to, excessA), "TokenA skim failed");
        }
        if (excessB > 0) {
            require(tokenB.transfer(to, excessB), "TokenB skim failed");
        }

        emit Skim(to, excessA, excessB);
    }

    /// @notice Transfer the pool to a new factory
    /// @dev This function can only be called by the current PoolV3Factory contract.
    ///      The new factory must then adopt the pool via registerPoolsFromFactory
    ///      so its registry stays consistent
    function transferPoolToFactory(address newFactory) external onlyPoolV3Factory {
        require(newFactory != address(0), "Invalid factory address");
        poolV3Factory = PoolV3Factory(newFactory);
    }
}
