/**
 * @title PoolFactory
 * @notice Factory pattern contract that standardizes pool creation and tracking
 * @dev While pools are created here, users interact directly with pool contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized pool creation (owner only)
 * 2. Pool registry - lookup existing pools for tokenA pairs
 * 3. Pool tracking - maintain list of all created pools
 *
 * Similar to Uniswap's factory pattern:
 * - Use factory to find/create pools
 * - All trading/core functions happen directly with pool contracts
 */

import "Pool.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/AdminRegistry.sol";
import "../Proxy/Proxy.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/// @notice Pool factory contract
contract record PoolFactory is Ownable {
    
    // ============ EVENTS ============
    
    /// @notice Event emitted when a new pool is created
    event NewPool(address tokenA, address tokenB, address pool);

    /// @notice Event emitted when pools are migrated
    event PoolsMigrated(address oldFactory, address newFactory, uint256 poolCount);

    /// @notice Event emitted when the admin registry is updated
    event AdminRegistryUpdated(address newRegistry);

    /// @notice Event emitted when the token factory is updated
    event TokenFactoryUpdated(address newFactory);

    /// @notice Event emitted when fee collectors are updated
    event FeeCollectorsUpdated(address newFeeCollector);

    /// @notice Event emitted when fee parameters are updated
    event FeeParametersUpdated(uint256 newSwapFeeRate, uint256 newLpSharePercent);

    /// @notice Event emitted when pool fee parameters are updated
    event PoolFeeParametersUpdated(address poolAddress, uint256 newSwapFeeRate, uint256 newLpSharePercent);

    // ============ STATE VARIABLES ============
    
    /// @notice Mapping of tokenA/tokenB pairs to pool addresses
    mapping(address => mapping(address => address)) public record pools;

    /// @notice Array of all pool addresses
    address[] public record allPools;

    /// @notice Admin registry contract address
    address public adminRegistry;
    
    /// @notice Token factory contract address
    address public tokenFactory;
    
    /// @notice Fee collector address
    address public feeCollector;
    
    /// @notice Swap fee rate in basis points (e.g., 30 = 0.3%)
    uint256 public swapFeeRate;
    
    /// @notice LP share percentage in basis points (e.g., 7000 = 70%)
    uint256 public lpSharePercent;

    // ============ CONSTRUCTOR ============
    
    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _adminRegistry The address of the admin registry
    /// @param _feeCollector The address of the fee collector
    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _tokenFactory, address _adminRegistry, address _feeCollector) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        require(_tokenFactory  != address(0), "Zero token factory address");
        require(_feeCollector  != address(0), "Zero fee collector address");
        
        adminRegistry = _adminRegistry;
        tokenFactory = _tokenFactory;
        feeCollector = _feeCollector;
        swapFeeRate = 30;
        lpSharePercent = 7000;

        emit FeeParametersUpdated(swapFeeRate, lpSharePercent);
        emit FeeCollectorsUpdated(feeCollector);
        emit AdminRegistryUpdated(adminRegistry);
        emit TokenFactoryUpdated(tokenFactory);
    }

    // ============ MODIFIERS ============
    
    /// @notice Modifier to check if tokens are active
    /// @param tokenA First token address
    /// @param tokenB Second token address
    modifier tokensActive(address tokenA, address tokenB) {
        require(TokenFactory(tokenFactory).isTokenActive(tokenA) && TokenFactory(tokenFactory).isTokenActive(tokenB), "Token not active");
        _;
    }

    // ============ ADMIN FUNCTIONS ============
    
    /// @notice Update the admin registry address (owner only)
    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = _adminRegistry;
        emit AdminRegistryUpdated(_adminRegistry);
    }

    /// @notice Update the token factory address (owner or admin)
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "Zero token factory address");
        address oldFactory = address(tokenFactory);
        tokenFactory = _tokenFactory;
        emit TokenFactoryUpdated(_tokenFactory);
    }

    /// @notice Update the fee collector address (owner or admin)
    /// @dev This updates the factory's fee collector - pools read from factory
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "Zero fee collector address");
        address oldFeeCollector = feeCollector;
        feeCollector = newFeeCollector;
        
        emit FeeCollectorsUpdated(newFeeCollector);
    }

    /// @notice Update fee parameters for the factory (owner or admin)
    /// @param newSwapFeeRate New swap fee rate in basis points
    /// @param newLpSharePercent New LP share percentage in basis points
    function setFeeParameters(
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent
    ) external onlyOwner {
        require(newSwapFeeRate > 0 && newSwapFeeRate <= 1000, "Invalid swap fee rate"); // Max 10%
        require(newLpSharePercent > 0 && newLpSharePercent <= 10000, "Invalid LP share percent"); // Max 100%
        
        swapFeeRate = newSwapFeeRate;
        lpSharePercent = newLpSharePercent;
        
        emit FeeParametersUpdated(newSwapFeeRate, newLpSharePercent);
    }

    /// @notice Update fee parameters for a specific pool (owner or admin)
    /// @param poolAddress The address of the pool to update
    /// @param newSwapFeeRate New swap fee rate in basis points
    /// @param newLpSharePercent New LP share percentage in basis points
    /// @dev This function allows setting custom fee parameters for individual pools
    /// @dev The pool must be owned by this factory (i.e., created by this factory)
    function setPoolFeeParameters(
        address poolAddress,
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent
    ) external onlyOwner {
        require(poolAddress != address(0), "Zero pool address");
        require(newSwapFeeRate > 0 && newSwapFeeRate <= 1000, "Invalid swap fee rate"); // Max 10%
        require(newLpSharePercent > 0 && newLpSharePercent <= 10000, "Invalid LP share percent"); // Max 100%
        
        // Verify the pool belongs to this factory
        require(address(Pool(poolAddress).poolFactory()) == address(this), "Pool does not belong to this factory");
        
        // Call the pool's single setFeeParameters function
        Pool(poolAddress).setFeeParameters(newSwapFeeRate, newLpSharePercent);
        
        emit PoolFeeParametersUpdated(poolAddress, newSwapFeeRate, newLpSharePercent);
    }

    /// @notice Call sync on all pools or select pools
    /// @param pools Array of pool addresses to sync
    /// @dev If no pools are provided, sync all pools
    /// @dev This function is used to sync the pools after a token transfer
    function syncPools(address[] pools) external onlyOwner {
        address[] memory targetPools = pools;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint256 i = 0; i < targetPools.length; i++) {
            Pool(targetPools[i]).sync();
        }
    }

    /// @notice Call skim on all pools or select pools
    /// @param pools Array of pool addresses to skim
    /// @param to Address to skim the pools to
    /// @dev If no pools are provided, skim all pools
    /// @dev This function is used to skim the pools after a token transfer
    function skimPools(address[] pools, address to) external onlyOwner {
        address[] memory targetPools = pools;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint256 i = 0; i < targetPools.length; i++) {
            Pool(targetPools[i]).skim(to);
        }
    }

    // ============ POOL MANAGEMENT ============
    
    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB) external tokensActive(tokenA, tokenB) onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");
        
        // deploy new lp token
        string lpName = ERC20(tokenA).name() + "-" + ERC20(tokenB).name() + " LP Token";
        string lpSymbol = ERC20(tokenA).symbol() + "-" + ERC20(tokenB).symbol() + "-LP";
        
        address lpTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18,
            this
        );

        // deploy new pool first
        address thisOwner = owner();
        pool = address(new Pool(tokenA, tokenB, lpTokenAddress, address(thisOwner)));
        Token(lpTokenAddress).addWhitelist(thisOwner, "mint", pool);
        Token(lpTokenAddress).addWhitelist(thisOwner, "burn", pool);
        Ownable(lpTokenAddress).transferOwnership(thisOwner);

        // update pool registry
        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions
        allPools.push(pool);
        
        emit NewPool(tokenA, tokenB, pool);

        return pool;
    }
    
    /// @notice Transfer all pools to a new factory
    /// @param newFactory Address of the new factory
    function transferPoolsToFactory(address newFactory) external onlyOwner {
        for (uint256 i = 0; i < allPools.length; i++) {
            address pool = allPools[i];
            if (pool != address(0)) {
                // Transfer pool to new factory
                Pool(pool).transferPoolToFactory(newFactory);
            }
        }
        emit PoolsMigrated(address(this), newFactory, allPools.length);
    }

    /// @notice Register pools received from another factory
    /// @param poolAddresses Array of pool addresses to register
    function registerPoolsFromFactory(address[] poolAddresses) external onlyOwner {
        for (uint256 i = 0; i < poolAddresses.length; i++) {
            address pool = poolAddresses[i];
            
            // Verify the pool belongs to this factory
            require(address(Pool(pool).poolFactory()) == address(this), "Pool does not belong to this factory");
            
            // Get tokenA and tokenB from the pool contract
            Pool poolContract = Pool(pool);
            address tokenA = address(poolContract.tokenA());
            address tokenB = address(poolContract.tokenB());
            
            // Only register if pool doesn't already exist
            if (pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0)) {
                pools[tokenA][tokenB] = pool;
                pools[tokenB][tokenA] = pool;
                allPools.push(pool);
            }
        }
        emit PoolsMigrated(address(0), address(this), poolAddresses.length);
    }
}
