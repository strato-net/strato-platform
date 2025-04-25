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

import "SimplePool.sol";

abstract contract PoolFactory is Ownable {
    event NewPool(address indexed tokenA, address indexed tokenB, address pool);

    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    constructor() Ownable(msg.sender) {}

    /// @notice Create a new pool for tokenA/tokenB
    function createPool(address tokenA, address tokenB) external returns (address pool) onlyOwner {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(getPool[tokenA][tokenB] == address(0) && getPool[tokenB][tokenA] == address(0), "Pool exists");

        // deploy new pool
        pool = address(new SimplePool(tokenA, tokenB));

        getPool[tokenA][tokenB] = pool;
        getPool[tokenB][tokenA] = pool; // support both directions

        allPools.push(pool);
        emit NewPool(tokenA, tokenB, pool);
    }

    function getPool(address tokenA, address tokenB) external view returns (address pool) {
        return getPool[tokenA][tokenB];
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
