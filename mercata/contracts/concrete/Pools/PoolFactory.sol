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
import "../Tokens/TokenFactory.sol";

contract record PoolFactory is Ownable {
    event NewPool(address tokenA, address tokenB, address pool);
    event PoolsMigrated(address oldFactory, address newFactory, uint256 poolCount);
    event AdminRegistryUpdated(address oldRegistry, address newRegistry);
    event TokenFactoryUpdated(address oldFactory, address newFactory);

    mapping(address => mapping(address => address)) public record pools;
    address[] public record allPools;
    AdminRegistry public adminRegistry;
    TokenFactory public tokenFactory;

    constructor(address initialOwner, address _adminRegistry, address _tokenFactory) Ownable(initialOwner) {
        require(_adminRegistry != address(0), "Zero admin registry address");
        require(_tokenFactory != address(0), "Zero token factory address");
        adminRegistry = AdminRegistry(_adminRegistry);
        tokenFactory = TokenFactory(_tokenFactory);
    }

    modifier onlyOwnerOrAdmin() {
        require(_checkOwner() || adminRegistry.isAdminAddress(msg.sender), "PoolFactory: caller is not owner or admin");
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

    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = AdminRegistry(_adminRegistry);
        emit AdminRegistryUpdated(oldRegistry, _adminRegistry);
    }

    function setTokenFactory(address _tokenFactory) external onlyOwnerOrAdmin {
        require(_tokenFactory != address(0), "Zero token factory address");
        address oldFactory = address(tokenFactory);
        tokenFactory = TokenFactory(_tokenFactory);
        emit TokenFactoryUpdated(oldFactory, _tokenFactory);
    }

    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB) external onlyOwnerOrAdmin tokensActive(tokenA, tokenB) returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");
        
        // deploy new pool
        pool = address(new Pool(tokenA, tokenB, address(tokenFactory)));

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
    }
}
