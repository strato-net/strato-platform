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

contract record PoolFactory is Ownable {
    event NewPool(address tokenA, address tokenB, address pool);
    event PoolMigrated(address tokenA, address tokenB, address pool);

    mapping(address => mapping(address => address)) public pools;
    address[] public allPools;
    address public tokenFactory;

    constructor(address initialOwner, address _tokenFactory) Ownable(initialOwner) {
        require(_tokenFactory != address(0), "Zero token factory address");
        tokenFactory = _tokenFactory;
    }

    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB) external returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");
        require(Token(tokenA).status() == TokenStatus.ACTIVE && Token(tokenB).status() == TokenStatus.ACTIVE, "Token not active");
        
        // deploy new pool
        pool = address(new Pool(tokenA, tokenB, tokenFactory));

        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions

        allPools.push(pool);
        emit NewPool(tokenA, tokenB, pool);
    }

    /// @notice Register an existing pool during migration from another factory
    /// @dev Only callable by owner, used to migrate pools from an old factory to a new one
    function migratePool(address tokenA, address tokenB, address pool) external onlyOwner {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pool != address(0), "Invalid pool address");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool already registered");
        
        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool;

        allPools.push(pool);
        emit PoolMigrated(tokenA, tokenB, pool);
    }
}
