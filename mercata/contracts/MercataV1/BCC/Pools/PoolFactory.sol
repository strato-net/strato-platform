/**
 * @title PoolFactory
 * @notice Factory pattern contract that standardizes pool creation and tracking
 * @dev While pools are created here, users interact directly with pool contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized pool creation (owner only)
 * 2. Pool registry - lookup existing pools for token pairs
 * 3. Pool tracking - maintain list of all created pools
 *
 * Similar to Uniswap's factory pattern:
 * - Use factory to find/create pools
 * - All trading/core functions happen directly with pool contracts
 */

import "SimplePool.sol";

abstract contract PoolFactory is Ownable {
    event NewPool(address indexed token, address indexed stablecoin, address pool);

    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    constructor() Ownable(msg.sender) {}

    /// @notice Create a new pool for token/stablecoin
    function createPool(address token, address stablecoin) external returns (address pool) onlyOwner {
        require(token != address(0) && stablecoin != address(0), "Zero address");
        require(token != stablecoin, "Identical addresses");
        require(getPool[token][stablecoin] == address(0) && getPool[stablecoin][token] == address(0), "Pool exists");

        // deploy new pool
        pool = address(new SimplePool(token, stablecoin));

        getPool[token][stablecoin] = pool;
        getPool[stablecoin][token] = pool; // support both directions

        allPools.push(pool);
        emit NewPool(token, stablecoin, pool);
    }

    function getPool(address token, address stablecoin) external view returns (address pool) {
        return getPool[token][stablecoin];
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
