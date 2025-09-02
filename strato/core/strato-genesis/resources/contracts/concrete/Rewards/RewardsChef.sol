// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

contract record RewardsChef is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint);

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct UserInfo {
        uint256 amount;      // How many LP tokens the user has provided.
        uint256 rewardDebt;  // Reward debt
    }

    struct PoolInfo {
        address lpToken;             // The LP Token added to the stake pool
        uint256 allocPoint;          // How many allocation points assigned to
	                             // this pool.  Importance of the pool.
        uint256 lastRewardTimestamp; // Last time the CATA distribution occurs
        uint256 accPerToken;         // Accumulated CATA per share (per token)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // Total allocation poitns. Must be the sum of all allocation points in all
    // pools.
    uint256 public totalAllocPoint = 0;

    // Info of each of the stake pool.
    PoolInfo[] public pools;

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {
	pools = [];
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STAKE POOL MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function addPool(
        uint256 _allocPoint,
        address _lpToken,
    ) public onlyOwner {
        // Check if LP token already exists in pools. If it does exists, return
        // early
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].lpToken == _lpToken) {
                return;
            }
        }
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        PoolInfo memory poolInfo = PoolInfo(_lpToken, _allocPoint, block.timestamp, 0);
        pools.push(poolInfo);
        
        emit PoolAdded(pools.length - 1, _lpToken, _allocPoint);
    }

}
