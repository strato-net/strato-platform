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
import "../Admin/FeeCollector.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/AdminRegistry.sol";
import "../Tokens/TokenFactory.sol";

/// @notice Pool factory contract
contract record PoolFactory is Ownable {
    /// @notice Event emitted when a new pool is created
    event NewPool(address tokenA, address tokenB, address pool);

    /// @notice Event emitted when pools are migrated
    event PoolsMigrated(address oldFactory, address newFactory, uint256 poolCount);

    /// @notice Event emitted when the admin registry is updated
    event AdminRegistryUpdated(address oldRegistry, address newRegistry);
    event TokenFactoryUpdated(address oldFactory, address newFactory);
    event FeeCollectorUpdated(address oldFeeCollector, address newFeeCollector);

    /// @notice Mapping of tokenA/tokenB pairs to pool addresses
    mapping(address => mapping(address => address)) public record pools;

    /// @notice Array of all pool addresses
    address[] public record allPools;

    /// @notice Admin registry contract
    AdminRegistry public adminRegistry;
    TokenFactory public tokenFactory;
    address public feeCollector;

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _adminRegistry The address of the admin registry
    /// @param _feeCollector The address of the fee collector
    constructor(address initialOwner, address _tokenFactory, address _adminRegistry, address _feeCollector) Ownable(initialOwner) {
        require(_adminRegistry != address(0), "Zero admin registry address");
        require(_tokenFactory  != address(0), "Zero token factory address");
        require(_feeCollector  != address(0), "Zero fee collector address");
        adminRegistry = AdminRegistry(_adminRegistry);
        tokenFactory = TokenFactory(_tokenFactory);
        feeCollector = _feeCollector;
    }

    /// @notice Modifier to check if the caller is the owner or an admin
    modifier onlyOwnerOrAdmin() { 
        require(msg.sender == owner() || adminRegistry.isAdminAddress(msg.sender), "PoolFactory: caller is not owner or admin");
        _;
    }
    
    /**
     * @notice Modifier to check if tokens are active.
     * @param tokenA First token address.
     * @param tokenB Second token address.
     */
    modifier tokensActive(address tokenA, address tokenB) {
        require(tokenFactory.isTokenActive(tokenA) && tokenFactory.isTokenActive(tokenB), "Token not active");
        _;
    }

    /// @notice Update the admin registry address (owner only)
    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = AdminRegistry(_adminRegistry);
        emit AdminRegistryUpdated(oldRegistry, _adminRegistry);
    }

    /// @notice Update the token factory address (owner or admin)
    function setTokenFactory(address _tokenFactory) external onlyOwnerOrAdmin {
        require(_tokenFactory != address(0), "Zero token factory address");
        address oldFactory = address(tokenFactory);
        tokenFactory = TokenFactory(_tokenFactory);
        emit TokenFactoryUpdated(oldFactory, _tokenFactory);
    }

    /// @notice Update the fee collector address (owner or admin)
    /// @dev This only affects new pools, existing pools will continue using their original fee collector
    function setFeeCollector(address newFeeCollector) external onlyOwnerOrAdmin {
        require(newFeeCollector != address(0), "Zero fee collector address");
        address oldFeeCollector = feeCollector;
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(oldFeeCollector, newFeeCollector);
    }

    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB) external onlyOwnerOrAdmin tokensActive(tokenA, tokenB) returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");
        
        // deploy new pool with fee collector
        pool = address(new Pool(tokenA, tokenB, address(tokenFactory), feeCollector));

        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions

        allPools.push(pool);
        
        emit NewPool(tokenA, tokenB, pool);
    }
    
    /**
     * @notice Register migrated pools (external function for migration).
     * @param poolsToRegister Array of pool addresses to register.
     */
    function registerMigratedPools(address oldPoolFactory) external onlyOwnerOrAdmin {
        PoolFactory oldFactory = PoolFactory(oldPoolFactory);
        address[] oldAllPools = oldFactory.allPools();
        
        for (uint256 i = 0; i < oldAllPools.length; i++) {
            address pool = oldAllPools[i];
            
            // Get tokenA and tokenB from the pool contract
            Pool poolContract = Pool(pool);
            address tokenA = address(poolContract.tokenA());
            address tokenB = address(poolContract.tokenB());
            
            pools[tokenA][tokenB] = pool;
            pools[tokenB][tokenA] = pool;

            allPools.push(pool);
        }
        emit PoolsMigrated(oldPoolFactory, address(this), allPools.length);
    }
}
