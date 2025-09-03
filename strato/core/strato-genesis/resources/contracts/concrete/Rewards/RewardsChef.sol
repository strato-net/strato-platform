// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

contract record RewardsChef is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint, uint256 initialBonusMultiplier);
    event AllocationPointsUpdated(uint256 indexed pid, uint256 oldAllocPoint, uint256 newAllocPoint);
    event BonusPeriodAdded(uint256 indexed pid, uint256 startTimestamp, uint256 bonusMultiplier);
    event MinFutureTimeUpdated(uint256 oldMinFutureTime, uint256 newMinFutureTime);

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct UserInfo {
        uint256 amount;      // How many LP tokens the user has provided.
        uint256 rewardDebt;  // Reward debt
    }

    struct BonusPeriod {
        uint256 startTimestamp;   // When this bonus period begins
        uint256 bonusMultiplier;  // The multiplier for this period (not smaller than 1)
    }

    struct PoolInfo {
        address lpToken;             // The LP Token added to the stake pool
        uint256 allocPoint;          // How many allocation points assigned to
	                             // this pool.  Importance of the pool.
        uint256 lastRewardTimestamp; // Last time the CATA distribution occurs
        uint256 accPerToken;         // Accumulated CATA per share (per token)
        BonusPeriod[] bonusPeriods;  // Array of bonus periods for this pool
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

    // Minimum time in the future for new bonus periods
    uint256 public minFutureTime;

    // Info of each of the stake pool.
    PoolInfo[] public pools;

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {
        pools = [];
        minFutureTime = 3600; // Initialize with 1 hour
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STAKE POOL MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function addPool(
        uint256 _allocPoint,
        address _lpToken,
        uint256 _bonusMultiplier
    ) public onlyOwner {
        // Check if LP token already exists in pools. If it does exists, return
        // early
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].lpToken == _lpToken) {
                return;
            }
        }
        require(_bonusMultiplier >= 1, "Bonus multiplier must be at least 1");

        totalAllocPoint = totalAllocPoint.add(_allocPoint);

        // Create new pool info with first bonus period
        PoolInfo memory poolInfo;
        poolInfo.lpToken = _lpToken;
        poolInfo.allocPoint = _allocPoint;
        poolInfo.lastRewardTimestamp = block.timestamp;
        poolInfo.accPerToken = 0;
        poolInfo.bonusPeriods = [];
        poolInfo.bonusPeriods.push(BonusPeriod(block.timestamp, _bonusMultiplier));

        pools.push(poolInfo);

        emit PoolAdded(pools.length - 1, _lpToken, _allocPoint, _bonusMultiplier);
    }

    function updateAllocationPoints(
        uint256 _pid,
        uint256 _allocPoint
    ) public onlyOwner {
        require(_pid < pools.length, "Pool does not exist");

        uint256 oldAllocPoint = pools[_pid].allocPoint;
        totalAllocPoint = totalAllocPoint.sub(oldAllocPoint).add(_allocPoint);
        pools[_pid].allocPoint = _allocPoint;

        emit AllocationPointsUpdated(_pid, oldAllocPoint, _allocPoint);
    }

    function addBonusPeriod(
        uint256 _pid,
        uint256 _startTimestamp,
        uint256 _bonusMultiplier
    ) public onlyOwner {
        require(_pid < pools.length, "Pool does not exist");
        require(_bonusMultiplier >= 1, "Bonus multiplier must be at least 1");
        require(_startTimestamp >= block.timestamp + minFutureTime, "Start timestamp must be far enough in the future");

        // Ensure new period starts after the last period
        uint256 periodsLength = pools[_pid].bonusPeriods.length;
        if (periodsLength > 0) {
            require(_startTimestamp > pools[_pid].bonusPeriods[periodsLength - 1].startTimestamp,
                    "New period must start after the last period");
        }

        pools[_pid].bonusPeriods.push(BonusPeriod(_startTimestamp, _bonusMultiplier));

        emit BonusPeriodAdded(_pid, _startTimestamp, _bonusMultiplier);
    }

    function updateMinFutureTime(uint256 _minFutureTime) public onlyOwner {
        require(_minFutureTime >= 60, "Minimum future time must be at least 60 seconds");
        uint256 oldMinFutureTime = minFutureTime;
        minFutureTime = _minFutureTime;
        emit MinFutureTimeUpdated(oldMinFutureTime, _minFutureTime);
    }

}
