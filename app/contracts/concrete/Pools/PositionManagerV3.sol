// SPDX-License-Identifier: MIT
import "PoolV3.sol";
import "../../abstract/ERC721/ERC721.sol";
import "../../libraries/PoolV3/LiquidityAmounts.sol";

/// @notice A liquidity position wrapped by a manager NFT (canonical
///         NonfungiblePositionManager.Position; file-level struct because SolidVM does not
///         support contract-nested struct references in record mappings)
/// @dev Canonical fields dropped: `nonce`/`operator` (no EIP-712 permit on STRATO — identity
///      is the transaction sender; token approvals use the ERC-721 port's standard
///      _tokenApprovals) and `poolId`/`PoolKey` (an EVM slot-packing indirection — the pool
///      address is stored directly, which also gives Cirrus a clean join key)
struct ManagedPosition {
    // the pool the position lives in
    address pool;
    // the tick range of the position
    int tickLower;
    int tickUpper;
    // the liquidity of this token's share of the pool position
    uint liquidity;
    // fee growth inside the range as of the last action on this token (signed, matching V3Position)
    int feeGrowthInside0LastX128;
    int feeGrowthInside1LastX128;
    // uncollected amounts owed to this token's holder (burned principal + fee share)
    uint tokensOwed0;
    uint tokensOwed1;
}

/**
 * @title PositionManagerV3
 * @notice Wraps PoolV3 liquidity positions in ERC-721 tokens — a port of Uniswap
 *         v3-periphery's NonfungiblePositionManager to SolidVM
 * @dev One singleton (proxied) instance manages positions across all PoolV3 pools. It is the
 *      `owner` key of the pool-level positions it holds, so every tokenId with the same
 *      (pool, tickLower, tickUpper) shares ONE pool position — the per-tokenId
 *      feeGrowthInside snapshots below are what apportion that shared position's fees, with
 *      exactly the delta math the pool's own Position.update uses (signed deltas, positive
 *      guard).
 *
 *      IMPORTANT (deployment): this contract's address is the owner key of all managed
 *      pool positions. Deploy once behind Proxy and only ever upgrade the implementation —
 *      a redeploy at a new address would strand every managed position.
 *
 * Deliberate divergences from canonical NonfungiblePositionManager (all driven by the
 * platform PoolV3's token model or SolidVM):
 * - Payment: canonical pays pools from the original caller inside uniswapV3MintCallback.
 *   PoolV3 has no callbacks — it pulls from its caller via transferFrom. mint/increase
 *   therefore pre-pull the EXACT amounts from the caller and approve the pool for them;
 *   exactness comes from PoolV3.getAmountsForLiquidity, a public view over the identical
 *   rounding-aware math pool.mint runs in the same transaction. No refunds, no dust, no
 *   residual allowance.
 * - Pool discovery: canonical computes pool addresses via CREATE2 (PoolAddress) and takes
 *   (token0, token1, fee) params. mint takes the pool address and validates it against the
 *   factory registry instead.
 * - Dropped wholesale (EVM machinery with no SolidVM meaning): ERC721Permit/SelfPermit
 *   (ecrecover/EIP-712), Multicall (delegatecall; the platform batches at the tx layer),
 *   PeripheryPayments/WETH9 (no native currency), the tokenURI descriptor stack (the UI
 *   renders positions from Cirrus), PoolInitializer (pool creation is admin-gated here).
 * - Fee growth values are signed ints with an explicit positive-delta guard, mirroring the
 *   pool port's Position.update (canonical relies on uint256 wraparound).
 * - No pause machinery (as canonical): pool-level guards govern — paused blocks
 *   mint/increase, decrease/collect stay open until disabled, so exit follows pool rules.
 *
 * @author Mercata Protocol
 * @version 1.0.0
 */
contract record PositionManagerV3 is ERC721, Ownable {

    // ============ EVENTS (canonical NonfungiblePositionManager shapes) ============

    /// @notice Emitted when liquidity is added to a token's position (including at mint)
    event IncreaseLiquidity(uint tokenId, uint liquidity, uint amount0, uint amount1);

    /// @notice Emitted when liquidity is removed from a token's position (amounts become collectable)
    event DecreaseLiquidity(uint tokenId, uint liquidity, uint amount0, uint amount1);

    /// @notice Emitted when owed tokens are collected for a token's position
    event Collect(uint tokenId, address recipient, uint amount0, uint amount1);

    // ============ STATE VARIABLES ============

    /// @notice The pool factory whose registry validates pools at mint (platform extension;
    ///         canonical validates via CREATE2 address recomputation)
    PoolV3Factory public poolV3Factory;

    /// @notice Managed positions (tokenId => position), the NFT-side ledger
    mapping(uint => ManagedPosition) public record positions;

    /// @notice The id the next minted token will get (ids start at 1; 0 = nonexistent)
    uint public nextTokenId;

    /// @notice Whether the manager is unlocked. Born locked — false in fresh (proxied)
    ///         storage — and unlocked at the end of initialize, as PoolV3
    bool private unlocked;

    // ============ CONSTRUCTOR / INITIALIZER ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    //SOLIDVM_COMPATIBILITY: constructor args resolve on direct parents only (D11), so both
    // parents are invoked here; name/symbol are set for real in initialize (proxy pattern)
    constructor(address initialOwner) ERC721("", "") Ownable(initialOwner) { }

    /// @notice Initialize the contract (proxy pattern; owner only, one-time)
    /// @param _poolV3Factory The PoolV3Factory whose pools this manager accepts
    function initialize(address _poolV3Factory) external onlyOwner {
        require(address(poolV3Factory) == address(0), "Already initialized");
        require(_poolV3Factory != address(0), "Zero factory address");
        __ERC721_init("V3 Liquidity Positions", "V3-POS");
        poolV3Factory = PoolV3Factory(_poolV3Factory);
        nextTokenId = 1;
        unlocked = true;
    }

    // ============ MODIFIERS ============

    /// @dev Mutually exclusive reentrancy protection, as PoolV3's lock. Also prevents any
    ///      state-changing entry before initialization
    modifier lock() {
        require(unlocked, "LOK");
        unlocked = false;
        _;
        unlocked = true;
    }

    /// @dev Canonical PeripheryValidation.checkDeadline
    modifier checkDeadline(uint deadline) {
        require(block.timestamp <= deadline, "Transaction too old");
        _;
    }

    /// @dev Canonical isAuthorizedForToken: owner, per-token approvee, or operator.
    ///      Reverts "ERC721: invalid token ID" for nonexistent tokens
    modifier isAuthorizedForToken(uint tokenId) {
        _checkAuthorized(_ownerOf(tokenId), _msgSender(), tokenId);
        _;
    }

    // ============ VIEWS ============

    /// @notice Read a managed position (canonical positions(); pair/fee are readable from
    ///         the pool, and Cirrus exposes the full struct off-chain)
    function getPosition(uint tokenId)
        external
        view
        returns (
            address pool,
            int tickLower,
            int tickUpper,
            uint liquidity,
            uint tokensOwed0,
            uint tokensOwed1
        )
    {
        ManagedPosition storage position = positions[tokenId];
        require(position.pool != address(0), "Invalid token ID");
        return (
            position.pool,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    // ============ POSITION ACTIONS ============

    /// @notice Mint a new position NFT: adds liquidity to the pool over the range and issues
    ///         a token to `recipient` representing it
    /// @param pool The PoolV3 to provide liquidity to (must be registered with the factory)
    /// @param tickLower Lower tick of the range (multiple of the pool's tickSpacing)
    /// @param tickUpper Upper tick of the range
    /// @param amount0Desired Maximum token0 the caller wishes to deposit
    /// @param amount1Desired Maximum token1 the caller wishes to deposit
    /// @param amount0Min Minimum token0 that must be deposited (slippage check)
    /// @param amount1Min Minimum token1 that must be deposited (slippage check)
    /// @param recipient The owner of the minted NFT
    /// @param deadline Timestamp after which the call reverts
    /// @dev The caller must have approved this contract for the desired amounts on both
    ///      tokens. Exactly the pool-computed amounts are pulled, never more
    function mint(
        address pool,
        int tickLower,
        int tickUpper,
        uint amount0Desired,
        uint amount1Desired,
        uint amount0Min,
        uint amount1Min,
        address recipient,
        uint deadline
    ) external lock checkDeadline(deadline) returns (uint tokenId, uint liquidity, uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        PoolV3 poolContract = PoolV3(pool);
        // registry check replaces canonical's CREATE2 address recomputation: only pools the
        // trusted factory created can round-trip through its registry
        require(
            poolV3Factory.pools(address(poolContract.token0()), address(poolContract.token1()), poolContract.fee()) == pool,
            "Pool not registered with factory"
        );

        (liquidity, amount0, amount1) = _addLiquidity(
            poolContract, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline
        );

        //SOLIDVM_COMPATIBILITY (D10): a local captured from nextTokenId would re-read the
        // incremented value at every later use, so nextTokenId is used directly and only
        // incremented after its last use; the return re-derives the id (NFT.mint precedent)
        _mint(recipient, nextTokenId);

        (int inside0, int inside1) =
            poolContract.getPositionFeeGrowthInside(address(this), tickLower, tickUpper);

        ManagedPosition storage position = positions[nextTokenId];
        position.pool = pool;
        position.tickLower = tickLower;
        position.tickUpper = tickUpper;
        position.liquidity = liquidity;
        position.feeGrowthInside0LastX128 = inside0;
        position.feeGrowthInside1LastX128 = inside1;

        emit IncreaseLiquidity(nextTokenId, liquidity, amount0, amount1);

        nextTokenId++;
        tokenId = nextTokenId - 1;
        return (tokenId, liquidity, amount0, amount1);
    }

    /// @notice Add liquidity to an existing position, keeping its range
    /// @dev As canonical, callable by anyone (the caller pays); the position's holder gains.
    ///      The caller must have approved this contract for the desired amounts
    function increaseLiquidity(
        uint tokenId,
        uint amount0Desired,
        uint amount1Desired,
        uint amount0Min,
        uint amount1Min,
        uint deadline
    ) external lock checkDeadline(deadline) returns (uint liquidity, uint amount0, uint amount1) {
        ManagedPosition storage position = positions[tokenId];
        require(position.pool != address(0), "Invalid token ID");
        PoolV3 poolContract = PoolV3(position.pool);

        (liquidity, amount0, amount1) = _addLiquidity(
            poolContract, position.tickLower, position.tickUpper,
            amount0Desired, amount1Desired, amount0Min, amount1Min, deadline
        );

        // pool.mint refreshed the shared pool position's snapshots to now; credit this
        // token's fee share BEFORE its liquidity grows (the share belongs to the liquidity
        // that earned it — canonical ordering, D10-mandatory here)
        (int inside0, int inside1) =
            poolContract.getPositionFeeGrowthInside(address(this), position.tickLower, position.tickUpper);
        _accrueFees(position, inside0, inside1);
        position.liquidity += liquidity;

        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
        return (liquidity, amount0, amount1);
    }

    /// @notice Remove liquidity from a position; amounts become collectable via collect()
    /// @param liquidity Liquidity units to remove (must be > 0; canonical semantics)
    function decreaseLiquidity(
        uint tokenId,
        uint liquidity,
        uint amount0Min,
        uint amount1Min,
        uint deadline
    ) external lock isAuthorizedForToken(tokenId) checkDeadline(deadline) returns (uint amount0, uint amount1) {
        require(liquidity > 0, "Zero liquidity");
        ManagedPosition storage position = positions[tokenId];
        require(position.liquidity >= liquidity, "Insufficient liquidity");
        PoolV3 poolContract = PoolV3(position.pool);

        (amount0, amount1) = poolContract.burn(position.tickLower, position.tickUpper, liquidity, deadline);
        require(amount0 >= amount0Min && amount1 >= amount1Min, "Price slippage check");

        // pool.burn refreshed the shared snapshots; credit the fee share earned by the FULL
        // pre-burn liquidity, then the withdrawn principal, then shrink (order is D10-critical)
        (int inside0, int inside1) =
            poolContract.getPositionFeeGrowthInside(address(this), position.tickLower, position.tickUpper);
        _accrueFees(position, inside0, inside1);
        position.tokensOwed0 += amount0;
        position.tokensOwed1 += amount1;
        position.liquidity -= liquidity;

        emit DecreaseLiquidity(tokenId, liquidity, amount0, amount1);
        return (amount0, amount1);
    }

    /// @notice Collect owed tokens (burned principal + fee share) for a position
    /// @param recipient Address the collected tokens are sent to (directly from the pool)
    /// @param amount0Max Maximum token0 to collect
    /// @param amount1Max Maximum token1 to collect
    function collect(
        uint tokenId,
        address recipient,
        uint amount0Max,
        uint amount1Max
    ) external lock isAuthorizedForToken(tokenId) returns (uint amount0, uint amount1) {
        require(recipient != address(0), "Zero recipient");
        ManagedPosition storage position = positions[tokenId];
        require(position.pool != address(0), "Invalid token ID");
        PoolV3 poolContract = PoolV3(position.pool);

        // poke the pool so pending fees land in the shared position and the snapshots are
        // fresh (canonical: pool.burn(..., 0)); only meaningful while liquidity is staked
        if (position.liquidity > 0) {
            poolContract.burn(position.tickLower, position.tickUpper, 0, block.timestamp);
            (int inside0, int inside1) =
                poolContract.getPositionFeeGrowthInside(address(this), position.tickLower, position.tickUpper);
            _accrueFees(position, inside0, inside1);
        }

        uint amount0Collect = position.tokensOwed0 < amount0Max ? position.tokensOwed0 : amount0Max;
        uint amount1Collect = position.tokensOwed1 < amount1Max ? position.tokensOwed1 : amount1Max;

        (amount0, amount1) =
            poolContract.collect(recipient, position.tickLower, position.tickUpper, amount0Collect, amount1Collect);

        // canonical: subtract the requested amounts, not the pool's payout — the shared pool
        // position can be a few wei short of the per-token ledger due to other sharers'
        // rounding, and keeping unclaimable wei on the books would strand them forever
        position.tokensOwed0 -= amount0Collect;
        position.tokensOwed1 -= amount1Collect;

        emit Collect(tokenId, recipient, amount0Collect, amount1Collect);
        return (amount0, amount1);
    }

    /// @notice Burn an empty position's NFT. The position must have 0 liquidity and 0 owed
    ///         amounts (decrease + collect first)
    function burn(uint tokenId) external lock isAuthorizedForToken(tokenId) {
        ManagedPosition storage position = positions[tokenId];
        require(
            position.liquidity == 0 && position.tokensOwed0 == 0 && position.tokensOwed1 == 0,
            "Not cleared"
        );
        //SOLIDVM_COMPATIBILITY: fields zeroed explicitly — `delete` through a storage
        // reference is a no-op (Tick.clear precedent); liquidity/owed are 0 by the require
        position.pool = address(0);
        position.tickLower = 0;
        position.tickUpper = 0;
        position.feeGrowthInside0LastX128 = 0;
        position.feeGrowthInside1LastX128 = 0;
        _burn(tokenId);
    }

    // ============ INTERNALS ============

    /// @dev Canonical LiquidityManagement.addLiquidity, restructured for the pull model:
    ///      compute liquidity from the desired amounts at the current price, learn the exact
    ///      amounts the pool will demand from the pool's own math, check slippage, pull
    ///      exactly those amounts from the caller, authorize the pool, deposit
    function _addLiquidity(
        PoolV3 poolContract,
        int tickLower,
        int tickUpper,
        uint amount0Desired,
        uint amount1Desired,
        uint amount0Min,
        uint amount1Min,
        uint deadline
    ) internal returns (uint liquidity, uint amount0, uint amount1) {
        uint sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            poolContract.sqrtPriceX96(), sqrtRatioAX96, sqrtRatioBX96, amount0Desired, amount1Desired
        );
        require(liquidity > 0, "Zero liquidity");

        // the exact amounts pool.mint will compute for this liquidity in this transaction
        // (same state, same math, same rounding)
        (amount0, amount1) = poolContract.getAmountsForLiquidity(tickLower, tickUpper, liquidity);
        require(amount0 >= amount0Min && amount1 >= amount1Min, "Price slippage check");

        if (amount0 > 0) {
            Token token0 = poolContract.token0();
            require(token0.transferFrom(_msgSender(), address(this), amount0), "Token0 transfer failed");
            require(token0.approve(address(poolContract), amount0), "Token0 approval failed");
        }
        if (amount1 > 0) {
            Token token1 = poolContract.token1();
            require(token1.transferFrom(_msgSender(), address(this), amount1), "Token1 transfer failed");
            require(token1.approve(address(poolContract), amount1), "Token1 approval failed");
        }

        // the amounts double as the maxes: any divergence from the precomputed values reverts
        (amount0, amount1) =
            poolContract.mint(address(this), tickLower, tickUpper, liquidity, amount0, amount1, deadline);
        return (liquidity, amount0, amount1);
    }

    /// @dev Credit the token's share of fee growth since its last snapshots, then advance the
    ///      snapshots. Mirrors the pool's Position.update delta math: signed deltas, a
    ///      delta <= 0 accrues nothing. Must run BEFORE any change to position.liquidity, and
    ///      the deltas' last read strictly precedes the snapshot writes (call-by-name locals)
    function _accrueFees(ManagedPosition storage position, int inside0, int inside1) internal {
        int delta0 = inside0 - position.feeGrowthInside0LastX128;
        if (delta0 > 0) {
            position.tokensOwed0 += FullMath.mulDiv(uint(delta0), position.liquidity, FixedPoint128.Q128);
        }
        int delta1 = inside1 - position.feeGrowthInside1LastX128;
        if (delta1 > 0) {
            position.tokensOwed1 += FullMath.mulDiv(uint(delta1), position.liquidity, FixedPoint128.Q128);
        }
        position.feeGrowthInside0LastX128 = inside0;
        position.feeGrowthInside1LastX128 = inside1;
    }
}
