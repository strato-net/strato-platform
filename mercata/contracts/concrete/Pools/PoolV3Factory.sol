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
    event NewPoolV3(address tokenA, address tokenB, uint feeBps, address pool);

    /// @notice Event emitted when the token factory is updated
    event TokenFactoryUpdated(address newFactory);

    /// @notice Event emitted when the fee collector is updated
    event FeeCollectorsUpdated(address newFeeCollector);

    /// @notice Event emitted when the default LP share is updated
    event LpSharePercentUpdated(uint newLpSharePercent);

    /// @notice Event emitted when a fee tier is enabled
    event FeeTierEnabled(uint feeBps, int tickSpacing);

    // ============ STATE VARIABLES ============

    /// @notice Mapping of tokenA => tokenB => feeBps => pool address
    mapping(address => mapping(address => mapping(uint => address))) public record pools;

    /// @notice Array of all pool addresses
    address[] public record allPools;

    /// @notice Enabled fee tiers: feeBps => tickSpacing (0 = tier disabled)
    mapping(uint => int) public record feeTiers;

    /// @notice Token factory contract address
    address public tokenFactory;

    /// @notice Fee collector address
    address public feeCollector;

    /// @notice Default LP share percentage in basis points (e.g., 7000 = 70%)
    uint public lpSharePercent;

    address public poolV3Implementation;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) { }

    /// @notice Initialize the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _feeCollector The address of the fee collector
    function initialize(address _tokenFactory, address _feeCollector) external onlyOwner {
        require(_tokenFactory != address(0), "Zero token factory address");
        require(_feeCollector != address(0), "Zero fee collector address");

        tokenFactory = _tokenFactory;
        feeCollector = _feeCollector;
        lpSharePercent = 7000;

        // Default fee tiers (feeBps => tickSpacing), mirroring Uniswap V3 conventions
        feeTiers[5] = 10;
        feeTiers[30] = 60;
        feeTiers[100] = 200;

        emit LpSharePercentUpdated(lpSharePercent);
        emit FeeCollectorsUpdated(feeCollector);
        emit TokenFactoryUpdated(tokenFactory);
        emit FeeTierEnabled(5, 10);
        emit FeeTierEnabled(30, 60);
        emit FeeTierEnabled(100, 200);
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
    /// @dev This updates the factory's fee collector - pools read from factory
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "Zero fee collector address");
        feeCollector = newFeeCollector;
        emit FeeCollectorsUpdated(newFeeCollector);
    }

    /// @notice Update the default LP share percentage (owner only)
    /// @param newLpSharePercent New LP share percentage in basis points
    function setLpSharePercent(uint newLpSharePercent) external onlyOwner {
        require(newLpSharePercent > 0 && newLpSharePercent <= 10000, "Invalid LP share percent");
        lpSharePercent = newLpSharePercent;
        emit LpSharePercentUpdated(newLpSharePercent);
    }

    /// @notice Enable a fee tier (owner only)
    /// @param feeBps Fee in basis points
    /// @param tickSpacing Tick spacing for pools of this tier
    function enableFeeTier(uint feeBps, int tickSpacing) external onlyOwner {
        require(feeBps > 0 && feeBps <= 1000, "Invalid fee rate"); // Max 10%
        require(tickSpacing > 0 && tickSpacing <= 32768, "Invalid tick spacing");
        require(feeTiers[feeBps] == 0, "Fee tier exists");
        feeTiers[feeBps] = tickSpacing;
        emit FeeTierEnabled(feeBps, tickSpacing);
    }

    /// @notice Update LP share for a specific pool (owner only)
    /// @param poolAddress The address of the pool to update
    /// @param newLpSharePercent New LP share percentage in basis points (0 = use factory default)
    function setPoolLpSharePercent(address poolAddress, uint newLpSharePercent) external onlyOwner {
        require(poolAddress != address(0), "Zero pool address");
        require(address(PoolV3(poolAddress).poolV3Factory()) == address(this), "Pool does not belong to this factory");
        PoolV3(poolAddress).setLpSharePercent(newLpSharePercent);
    }

    // ============ POOL MANAGEMENT ============

    /// @notice Create a new concentrated liquidity pool for tokenA/tokenB at a fee tier
    /// @param tokenA The first token in the pair
    /// @param tokenB The second token in the pair
    /// @param feeBps The fee tier in basis points (must be an enabled tier)
    /// @param initialSqrtPriceWad Initial sqrt(tokenB/tokenA price), WAD-scaled
    function createPoolV3(
        address tokenA,
        address tokenB,
        uint feeBps,
        uint initialSqrtPriceWad
    ) external tokensActive(tokenA, tokenB) onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(initialSqrtPriceWad > 0, "Zero initial price");
        int tickSpacing = feeTiers[feeBps];
        require(tickSpacing > 0, "Fee tier not enabled");
        require(pools[tokenA][tokenB][feeBps] == address(0) && pools[tokenB][tokenA][feeBps] == address(0), "Pool exists");

        // deploy new pool
        _updatePoolV3Implementation();
        pool = address(new Proxy(poolV3Implementation, address(this)));
        PoolV3(pool).initialize(tokenA, tokenB, feeBps, tickSpacing, initialSqrtPriceWad, address(this));
        PoolV3(pool).transferOwnership(owner());

        // update pool registry
        pools[tokenA][tokenB][feeBps] = pool;
        pools[tokenB][tokenA][feeBps] = pool; // support both directions
        allPools.push(pool);

        emit NewPoolV3(tokenA, tokenB, feeBps, pool);

        return pool;
    }

    function updatePoolV3Implementation() external onlyOwner {
        _updatePoolV3Implementation();
    }

    function _updatePoolV3Implementation() internal {
        poolV3Implementation = address(new PoolV3(address(owner())));
    }
}
