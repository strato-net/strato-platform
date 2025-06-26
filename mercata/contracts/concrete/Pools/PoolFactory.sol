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
import "../AdminRegistry/AdminRegistry.sol";

contract record PoolFactory is Ownable {
    event NewPool(address tokenA, address tokenB, address pool);
    event PoolsMigrated(address indexed oldFactory, address indexed newFactory, uint256 poolCount);
    event AdminRegistryUpdated(address oldRegistry, address newRegistry);

    mapping(address => mapping(address => address)) public pools;
    address[] public allPools;
    AdminRegistry public adminRegistry;

    constructor(address initialOwner, address _adminRegistry) Ownable(initialOwner) {
        require(_adminRegistry != address(0), "Zero admin registry address");
        adminRegistry = AdminRegistry(_adminRegistry);
    }
    
    modifier onlyAdmin() {
        require(adminRegistry.isAdminAddress(msg.sender), "PoolFactory: caller is not admin");
        _;
    }
    
    /**
     * @notice Modifier to check if tokens are active.
     * @param tokenA First token address.
     * @param tokenB Second token address.
     */
    modifier tokensActive(address tokenA, address tokenB) {
        require(TokenFactory(adminRegistry.tokenFactory()).isTokenActive(tokenA) && TokenFactory(adminRegistry.tokenFactory()).isTokenActive(tokenB), "Token not active");
        _;
    }

    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = AdminRegistry(_adminRegistry);
        emit AdminRegistryUpdated(oldRegistry, _adminRegistry);
    }

    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB, address feeCollector) external onlyOwner tokensActive(tokenA, tokenB) returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");
        
        // deploy new pool
        pool = address(new Pool(tokenA, tokenB, adminRegistry.tokenFactory()));

        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions

        allPools.push(pool);
        
        emit NewPool(tokenA, tokenB, pool);
    }
    
    /**
     * @notice Register migrated pools (external function for migration).
     * @param poolsToRegister Array of pool addresses to register.
     */
    function registerMigratedPools(address[] poolsToRegister) external onlyAdmin {
        for (uint256 i = 0; i < poolsToRegister.length; i++) {
            address pool = poolsToRegister[i];
            require(pool != address(0), "Invalid pool address");
            
            // Get tokenA and tokenB from the pool contract
            Pool poolContract = Pool(pool);
            address tokenA = address(poolContract.tokenA());
            address tokenB = address(poolContract.tokenB());
            
            require(tokenA != address(0) && tokenB != address(0), "Zero address");
            require(tokenA != tokenB, "Identical addresses");
            require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool already registered");
            
            pools[tokenA][tokenB] = pool;
            pools[tokenB][tokenA] = pool;

            allPools.push(pool);
        }
    }
}
