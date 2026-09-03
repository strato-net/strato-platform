/**
 * @title PoolV3Factory
 * @notice Factory pattern contract that standardizes concentrated liquidity (PoolV3) pool creation and tracking
 * @dev While pools are created here, users interact directly with pool contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized pool creation (owner only)
 * 2. Pool registry - lookup existing pools by token pair and fee tier
 * 3. Pool tracking - maintain list of all created pools
 *
 * Coexists with PoolFactory (V2-style pools): separate registry, separate Cirrus tables,
 * no LP tokens (PoolV3 positions are per-range records, not fungible tokens).
 */

import "PoolV3.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/// @notice Concentrated liquidity pool factory contract
contract record PoolV3Factory is Ownable {

    // ============ EVENTS ============

    /// @notice Event emitted when a new pool is created
    event NewPoolV3(address tokenA, address tokenB, uint fee, address pool);

    /// @notice Event emitted when the token factory is updated
    event TokenFactoryUpdated(address newFactory);

    /// @notice Event emitted when the fee collector is updated
    event FeeCollectorsUpdated(address newFeeCollector);

    /// @notice Event emitted when a fee tier is enabled
    event FeeTierEnabled(uint fee, int tickSpacing);

    /// @notice Event emitted when pools are migrated between factories
    event PoolsMigrated(address fromFactory, address toFactory, uint count);

    // ============ STATE VARIABLES ============

    /// @notice Mapping of tokenA => tokenB => fee (pips) => pool address (both token orders registered)
    mapping(address => mapping(address => mapping(uint => address))) public record pools;

    /// @notice Array of all pool addresses
    address[] public record allPools;

    /// @notice Enabled fee tiers: fee in pips (1e6 denominator) => tickSpacing (0 = tier disabled)
    mapping(uint => int) public record feeTiers;

    /// @notice Token factory contract address
    address public tokenFactory;

    /// @notice Fee collector address: the destination for collectPoolProtocol proceeds
    address public feeCollector;

    address public poolV3Implementation;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) { }

    /// @notice Initialize the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _feeCollector The address of the fee collector
    function initialize(address _tokenFactory, address _feeCollector) external onlyOwner {
        require(feeCollector == address(0), "Already initialized");
        require(_tokenFactory != address(0), "Zero token factory address");
        require(_feeCollector != address(0), "Zero fee collector address");

        tokenFactory = _tokenFactory;
        feeCollector = _feeCollector;

        // Default fee tiers (fee in pips => tickSpacing), canonical Uniswap V3 values
        feeTiers[500] = 10;
        feeTiers[3000] = 60;
        feeTiers[10000] = 200;

        emit FeeCollectorsUpdated(feeCollector);
        emit TokenFactoryUpdated(tokenFactory);
        emit FeeTierEnabled(500, 10);
        emit FeeTierEnabled(3000, 60);
        emit FeeTierEnabled(10000, 200);
    }

    // ============ MODIFIERS ============

    /// @notice Modifier to check if tokens are active
    modifier tokensActive(address tokenA, address tokenB) {
        require(TokenFactory(tokenFactory).isTokenActive(tokenA) && TokenFactory(tokenFactory).isTokenActive(tokenB), "Token not active");
        _;
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Update the token factory address (owner only)
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "Zero token factory address");
        tokenFactory = _tokenFactory;
        emit TokenFactoryUpdated(_tokenFactory);
    }

    /// @notice Update the fee collector address (owner only)
    /// @dev The fee collector receives the proceeds of collectPoolProtocol
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "Zero fee collector address");
        feeCollector = newFeeCollector;
        emit FeeCollectorsUpdated(newFeeCollector);
    }

    /// @notice Enable a fee tier (owner only)
    /// @param fee Fee in pips (hundredths of a bip, 1e6 denominator; canonical V3 bounds)
    /// @param tickSpacing Tick spacing for pools of this tier
    function enableFeeTier(uint fee, int tickSpacing) external onlyOwner {
        require(fee > 0 && fee < 1000000, "Invalid fee");
        require(tickSpacing > 0 && tickSpacing < 16384, "Invalid tick spacing");
        require(feeTiers[fee] == 0, "Fee tier exists");
        feeTiers[fee] = tickSpacing;
        emit FeeTierEnabled(fee, tickSpacing);
    }

    /// @notice Set a pool's protocol fee denominators (owner only)
    /// @param poolAddress The address of the pool to update
    /// @param feeProtocol0 Protocol fee denominator for token0-input swaps (0, or 4..10;
    ///        canonical setFeeProtocol bounds, enforced by the pool)
    /// @param feeProtocol1 Protocol fee denominator for token1-input swaps
    function setPoolFeeProtocol(address poolAddress, uint feeProtocol0, uint feeProtocol1) external onlyOwner {
        require(poolAddress != address(0), "Zero pool address");
        require(address(PoolV3(poolAddress).poolV3Factory()) == address(this), "Pool does not belong to this factory");
        PoolV3(poolAddress).setFeeProtocol(feeProtocol0, feeProtocol1);
    }

    /// @notice Set a pool's flash-specific fee (owner only)
    /// @param poolAddress The pool to configure
    /// @param flashFee Fee charged by flash in pips (1e6 denominator); 0 = free flash loans
    function setPoolFlashFee(address poolAddress, uint flashFee) external onlyOwner {
        require(poolAddress != address(0), "Zero pool address");
        require(address(PoolV3(poolAddress).poolV3Factory()) == address(this), "Pool does not belong to this factory");
        PoolV3(poolAddress).setFlashFee(flashFee);
    }

    /// @notice Collect a pool's accrued protocol fees to the factory's fee collector (owner only)
    /// @param poolAddress The pool to collect from
    /// @param amount0Requested The maximum amount of token0 to collect
    /// @param amount1Requested The maximum amount of token1 to collect
    /// @return amount0 The protocol fee collected in token0
    /// @return amount1 The protocol fee collected in token1
    function collectPoolProtocol(
        address poolAddress,
        uint amount0Requested,
        uint amount1Requested
    ) external onlyOwner returns (uint amount0, uint amount1) {
        require(poolAddress != address(0), "Zero pool address");
        require(address(PoolV3(poolAddress).poolV3Factory()) == address(this), "Pool does not belong to this factory");
        return PoolV3(poolAddress).collectProtocol(feeCollector, amount0Requested, amount1Requested);
    }

    // ============ POOL MANAGEMENT ============

    /// @notice Create a new concentrated liquidity pool for tokenA/tokenB at a fee tier
    /// @param tokenA Becomes the pool's token0. NOTE: creation order is preserved (canonical
    ///        V3 sorts by address); the registry stores both directions so lookups are
    ///        order-independent, but the pool's price is always token1 per token0
    /// @param tokenB Becomes the pool's token1
    /// @param fee The fee tier in pips (must be an enabled tier)
    /// @param initialSqrtPriceX96 Initial sqrt(token1/token0 price), Q64.96
    function createPoolV3(
        address tokenA,
        address tokenB,
        uint fee,
        uint initialSqrtPriceX96
    ) external tokensActive(tokenA, tokenB) onlyOwner returns (address pool) {
        require(feeCollector != address(0), "Factory not initialized");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(initialSqrtPriceX96 > 0, "Zero initial price");
        int tickSpacing = feeTiers[fee];
        require(tickSpacing > 0, "Fee tier not enabled");
        require(pools[tokenA][tokenB][fee] == address(0) && pools[tokenB][tokenA][fee] == address(0), "Pool exists");

        // deploy new pool
        _updatePoolV3Implementation();
        pool = address(new Proxy(poolV3Implementation, address(this)));
        PoolV3(pool).initialize(tokenA, tokenB, fee, tickSpacing, initialSqrtPriceX96, address(this));
        PoolV3(pool).transferOwnership(owner());

        // update pool registry
        pools[tokenA][tokenB][fee] = pool;
        pools[tokenB][tokenA][fee] = pool; // support both directions
        allPools.push(pool);

        emit NewPoolV3(tokenA, tokenB, fee, pool);

        return pool;
    }

    function updatePoolV3Implementation() external onlyOwner {
        _updatePoolV3Implementation();
    }

    function _updatePoolV3Implementation() internal {
        poolV3Implementation = address(new PoolV3(address(owner())));
    }

    // ============ POOL MAINTENANCE (mirrors PoolFactory) ============

    /// @notice Call sync on all pools or select pools
    /// @param poolsToSync Array of pool addresses to sync (empty = all pools)
    /// @dev This function is used to sync the pools after a token transfer
    function syncPools(address[] poolsToSync) external onlyOwner {
        address[] memory targetPools = poolsToSync;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint i = 0; i < targetPools.length; i++) {
            PoolV3(targetPools[i]).sync();
        }
    }

    /// @notice Call skim on all pools or select pools
    /// @param poolsToSkim Array of pool addresses to skim (empty = all pools)
    /// @param to Address to skim the pools to
    /// @dev This function is used to skim the pools after a token transfer
    function skimPools(address[] poolsToSkim, address to) external onlyOwner {
        address[] memory targetPools = poolsToSkim;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint i = 0; i < targetPools.length; i++) {
            PoolV3(targetPools[i]).skim(to);
        }
    }

    // ============ FACTORY MIGRATION (mirrors PoolFactory) ============

    /// @notice Transfer all pools to a new factory
    /// @param newFactory Address of the new factory
    /// @dev The new factory owner must then call registerPoolsFromFactory to adopt them
    function transferPoolsToFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "Zero factory address");
        for (uint i = 0; i < allPools.length; i++) {
            address pool = allPools[i];
            if (pool != address(0)) {
                PoolV3(pool).transferPoolToFactory(newFactory);
            }
        }
        emit PoolsMigrated(address(this), newFactory, allPools.length);
    }

    /// @notice Register pools received from another factory
    /// @param poolAddresses Array of pool addresses to register
    function registerPoolsFromFactory(address[] poolAddresses) external onlyOwner {
        for (uint i = 0; i < poolAddresses.length; i++) {
            address pool = poolAddresses[i];

            // Verify the pool belongs to this factory
            require(address(PoolV3(pool).poolV3Factory()) == address(this), "Pool does not belong to this factory");

            PoolV3 poolContract = PoolV3(pool);
            address token0Addr = address(poolContract.token0());
            address token1Addr = address(poolContract.token1());
            uint fee = poolContract.fee();

            // Only register if a pool for this pair + fee tier doesn't already exist
            if (pools[token0Addr][token1Addr][fee] == address(0) && pools[token1Addr][token0Addr][fee] == address(0)) {
                pools[token0Addr][token1Addr][fee] = pool;
                pools[token1Addr][token0Addr][fee] = pool;
                allPools.push(pool);
            }
        }
        emit PoolsMigrated(address(0), address(this), poolAddresses.length);
    }
}
