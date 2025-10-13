// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

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

/**
 * RewardsChef - A staking contract that allows creating pools for various LP
 * tokens, where users earn CATA token rewards over time for staking their LP
 * tokens.
 *
 * The contract owner can create dedicated pools for individual LP tokens. All
 * pools together earn a configurable number of CATA tokens per second (set upon
 * contract creation). This total reward is distributed among all pools
 * proportionally based on their allocation points, which represent the
 * importance of each pool. Some pools can earn extra bonus rewards during
 * special time periods where bonus multipliers apply.
 *
 * Users can deposit their LP tokens into any created pool and receive
 * proportional rewards based on what that pool has earned relative to their
 * stake.
 *
 * I. INSPIRATION: MasterChef V1
 *
 * RewardsChef is heavily inspired by MasterChef V1 with some modifications.
 * Understanding how MasterChef V1 works first will greatly simplify the
 * learning process of understanding the RewardsChef code.
 *
 * II. USAGE
 *
 * 2.1 Pool Management:
 *
 * The contract owner can create pools using addPool(), specifying allocation
 * points which determine the pool's importance and reward share. Allocation
 * points can be updated later with updateAllocationPoints() to rebalance
 * reward distribution among pools.
 *
 * Each pool supports bonus periods that multiply rewards during specific time
 * ranges. Bonus periods are added using addBonusPeriod() but cannot be removed
 * once created. New bonus periods must start sufficiently far in the future
 * (controlled by minFutureTime) to prevent gaming - they cannot be added
 * last-minute before they begin.
 *
 * 2.2 Rewards Calculation Per Pool:
 *
 * The updatePool() function calculates rewards for the entire pool, not
 * individual users yet. It determines how much reward has accrued since the
 * last time this function was called (tracked by lastRewardTimestamp). The
 * calculation is straightforward: CATA per second multiplied by the number of
 * seconds that have passed (with bonus multipliers applied if applicable),
 * scaled to the pool's importance (allocPoints / totalAllocPoints). This
 * calculated amount is minted and sent to the contract address. Finally, it
 * calculates how much of that accrued reward will be available per share
 * (per LP token) for distribution to individual users.
 *
 * 2.3 Staking:
 *
 * Users interact with pools through deposit() and withdraw() functions, which
 * are symmetric operations. Both functions first update the pool's rewards,
 * then calculate and transfer any pending rewards to the user before
 * processing the deposit/withdrawal. The key concept here is rewardDebt,
 * which tracks how much reward the user has already "claimed" based on their
 * current stake to prevent double-counting of rewards.
 *
 * III. IMPLEMENTATION EXPLAINED
 *
 * 3.1 accPerToken
 *
 * accPerToken represents the cumulative amount of reward tokens earned per LP
 * token since the pool was created. It's a global accumulator that grows over
 * time as rewards are distributed to the pool. This value is multiplied by
 * PRECISION_MULTIPLIER to avoid rounding errors in calculations.
 *
 * Key properties:
 * - Always increases (never decreases) as new rewards are added
 * - Represents total historical rewards per LP token, not current rate
 * - Used to calculate individual user rewards by multiplying with user's stake
 *
 * Example progression:
 * - Pool created: accPerToken = 0
 * - After 1 hour: 1000 CATA earned, 100 LP tokens staked →
 *                                       accPerToken = 10 * PRECISION_MULTIPLIER
 * - After 2 hours: 2000 CATA total earned →
 *                                       accPerToken = 20 * PRECISION_MULTIPLIER
 * - A user with 5 LP tokens would
 *   earn: (5 * 20 * PRECISION_MULTIPLIER) / PRECISION_MULTIPLIER = 100 CATA total
 *
 * The accPerToken mechanism allows the contract to efficiently track rewards
 * for all users without iterating through each user individually - it's
 * calculated once per pool update and applied to all users on-demand.
 *
 * 3.2 REWARD DEBT MECHANISM:
 *
 * The rewardDebt system prevents users from claiming rewards that accrued
 * before they joined the pool. When a user deposits, their rewardDebt is set
 * to their potential rewards at that moment. When calculating pending rewards,
 * we subtract this debt to get only the rewards earned since their deposit.
 *
 * Example: Pool has accPerToken = 100 (meaning 100 CATA per LP token earned so
 * far)
 *
 * - User deposits 10 LP tokens → rewardDebt = 10 × 100 = 1000
 * - Pool earns more rewards, accPerToken becomes 150
 * - User's pending reward = (10 × 150) - 1000 = 500 CATA
 * - This 500 CATA represents only rewards earned after their deposit
 *
 * 3.3 PRECISION LOSS PREVENTION:
 *
 * Issue: The reward calculation `(multiplier * cataPerSecond * pool.allocPoint)
 * / totalAllocPoint` can result in precision loss due to Solidity's integer
 * division, causing rewards to be rounded down to zero.
 *
 * Example:
 * - multiplier = 1 (1 second passed)
 * - cataPerSecond = 100 (base units)
 * - pool.allocPoint = 1 (small pool)
 * - totalAllocPoint = 200 (total across all pools)
 * - Result: (1 * 100 * 1) / 200 = 100 / 200 = 0 (rounded down)
 *
 * Solution: Enforce the invariant `cataPerSecond >= totalAllocPoint` to ensure
 * that even the smallest reward calculation (multiplier=1, allocPoint=1)
 * produces a non-zero result.  This prevents active pools from having their
 * rewards rounded down to zero while still allowing disabled pools
 * (allocPoint=0) to correctly receive zero rewards.
 */
contract record RewardsChef is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint, uint256 initialBonusMultiplier);
    event AllocationPointsUpdated(uint256 indexed pid, uint256 oldAllocPoint, uint256 newAllocPoint);
    event BonusPeriodAdded(uint256 indexed pid, uint256 startTimestamp, uint256 bonusMultiplier);
    event MinFutureTimeUpdated(uint256 oldMinFutureTime, uint256 newMinFutureTime);
    event CataPerSecondUpdated(uint256 oldCataPerSecond, uint256 newCataPerSecond);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event CurrentUserAmount(address indexed user, uint256 indexed pid, uint256 currentAmount);

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════
    // Workaround for the lack of `type(uint256).max`, addressed in the
    // https://github.com/blockapps/strato-platform/issues/4672
    uint256 private MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    // Precision multiplier for reward per LP token calculations. Since Solidity doesn't
    // support floating point numbers, we multiply accPerToken by this value to maintain
    // precision. We multiply when storing rewards per token (accPerToken calculation) and
    // divide when calculating individual user rewards to get the actual reward amount.
    // This multiplier also propagates to rewardDebt calculations to maintain consistency.
    uint256 public PRECISION_MULTIPLIER = 1e18;

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════

    // The CATA token (reward token)
    Token public rewardToken;

    // CATA tokens created per second for all pools
    uint256 public cataPerSecond;

    // Total allocation poitns. Must be the sum of all allocation points in all
    // pools.
    uint256 public totalAllocPoint = 0;

    // Minimum time in the future for new bonus periods
    uint256 public minFutureTime;

    // Info of each of the stake pool.
    PoolInfo[] public record pools;

    function getPoolBonusPeriod(uint poolIndex, uint bonusPeriodIndex) public returns (uint, uint) {
        BonusPeriod bp = pools[poolIndex].bonusPeriods[bonusPeriodIndex];
        return (bp.startTimestamp, bp.bonusMultiplier);
    }

    // Tracks whether an LP token is already in use by a pool
    mapping(address => bool) private lpTokenInUse;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public record userInfo;

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(address _rewardToken, uint256 _cataPerSecond) external onlyOwner {
        // important: must be set here for proxied instances; ensure consistency
        // with desired initial values
        MAX_INT = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
        PRECISION_MULTIPLIER = 1e18;

        require(_rewardToken != address(0), "Invalid reward token address");
        rewardToken = Token(_rewardToken);
        cataPerSecond = _cataPerSecond;
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
        require(!lpTokenInUse[_lpToken], "LP token already exists");
        require(_lpToken != address(rewardToken), "LP token cannot be the same as reward token");
        require(_bonusMultiplier >= 1, "Bonus multiplier must be at least 1");

        massUpdatePools();

        totalAllocPoint += _allocPoint;
        require(totalAllocPoint > 0, "Total allocation points must be greater than zero");
        // See 'PRECISION LOSS PREVENTION' section in top comment
        require(cataPerSecond >= totalAllocPoint, "cataPerSecond must be >= totalAllocPoint to prevent precision loss");

        // Create new pool info with first bonus period
        PoolInfo memory poolInfo;
        poolInfo.lpToken = _lpToken;
        poolInfo.allocPoint = _allocPoint;
        poolInfo.lastRewardTimestamp = block.timestamp;
        poolInfo.accPerToken = 0;
        poolInfo.bonusPeriods = [];
        poolInfo.bonusPeriods.push(BonusPeriod(block.timestamp, _bonusMultiplier));

        pools.push(poolInfo);
        lpTokenInUse[_lpToken] = true;

        emit PoolAdded(pools.length - 1, _lpToken, _allocPoint, _bonusMultiplier);
    }

    function updateAllocationPoints(
        uint256 _pid,
        uint256 _allocPoint
    ) public onlyOwner {
        require(_pid < pools.length, "Pool does not exist");

        massUpdatePools();

        uint256 oldAllocPoint = pools[_pid].allocPoint;
        totalAllocPoint = totalAllocPoint - oldAllocPoint + _allocPoint;
        require(totalAllocPoint > 0, "Total allocation points must be greater than zero");
        // See 'PRECISION LOSS PREVENTION' section in top comment
        require(cataPerSecond >= totalAllocPoint, "cataPerSecond must be >= totalAllocPoint to prevent precision loss");
        pools[_pid].allocPoint = _allocPoint;

        emit AllocationPointsUpdated(_pid, oldAllocPoint, _allocPoint);
    }

    function updateCataPerSecond(uint256 _cataPerSecond) public onlyOwner {
        // See 'PRECISION LOSS PREVENTION' section in top comment
        require(_cataPerSecond >= totalAllocPoint, "cataPerSecond must be >= totalAllocPoint to prevent precision loss");

        // Update all pools first to ensure all pending rewards are calculated
        // with the old cataPerSecond rate before we change it
        massUpdatePools();

        uint256 oldCataPerSecond = cataPerSecond;
        cataPerSecond = _cataPerSecond;

        emit CataPerSecondUpdated(oldCataPerSecond, _cataPerSecond);
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
        require(_startTimestamp > pools[_pid].bonusPeriods[periodsLength - 1].startTimestamp,
                "New period must start after the last period");

        pools[_pid].bonusPeriods.push(BonusPeriod(_startTimestamp, _bonusMultiplier));

        emit BonusPeriodAdded(_pid, _startTimestamp, _bonusMultiplier);
    }

    function updateMinFutureTime(uint256 _minFutureTime) public onlyOwner {
        require(_minFutureTime >= 60, "Minimum future time must be at least 60 seconds");
        uint256 oldMinFutureTime = minFutureTime;
        minFutureTime = _minFutureTime;
        emit MinFutureTimeUpdated(oldMinFutureTime, _minFutureTime);
    }

    function getMultiplier(uint256 _pid, uint256 _from, uint256 _to) public view returns (uint256) {
        require(_pid < pools.length, "Pool does not exist");
        require(_from <= _to, "From timestamp must be less than or equal to to timestamp");

        if (_from == _to) {
            return 0;
        }

        BonusPeriod[] storage periods = pools[_pid].bonusPeriods;
        uint256 totalMultipliedTime = 0;
        uint256 currentTime = _from;

        for (uint256 i = 0; i < periods.length && currentTime < _to; i++) {
            uint256 periodStart = periods[i].startTimestamp;
            uint256 periodEnd = (i + 1 < periods.length) ? periods[i + 1].startTimestamp : MAX_INT;

            if (currentTime < periodStart) {
                currentTime = periodStart;
            }

            if (currentTime < _to && currentTime < periodEnd) {
                uint256 segmentEnd = (_to < periodEnd) ? _to : periodEnd;
                uint256 segmentDuration = segmentEnd - currentTime;
                totalMultipliedTime += segmentDuration * (periods[i].bonusMultiplier);
                currentTime = segmentEnd;
            }
        }

        return totalMultipliedTime;
    }

    function updatePool(uint256 _pid) public {
        require(_pid < pools.length, "Pool does not exist");

        PoolInfo storage pool = pools[_pid];
        if (block.timestamp <= pool.lastRewardTimestamp) {
            return;
        }

        uint256 lpSupply = ERC20(pool.lpToken).balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardTimestamp = block.timestamp;
            return;
        }

        uint256 multiplier = getMultiplier(_pid, pool.lastRewardTimestamp, block.timestamp);
        // totalAllocPoint is always greater than zero OR there are no pools yet added
        uint256 cataReward = (multiplier * cataPerSecond * pool.allocPoint) / totalAllocPoint;

        rewardToken.mint(address(this), cataReward);

        pool.accPerToken += (cataReward * PRECISION_MULTIPLIER) / lpSupply;
        pool.lastRewardTimestamp = block.timestamp;
    }

    function massUpdatePools() public {
        uint256 poolCount = pools.length;
        for (uint256 pid = 0; pid < poolCount; pid++) {
            updatePool(pid);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // USER INTERACTIONS
    // ═════════════════════════════════════════════════════════════════════════

    function deposit(uint256 _pid, uint256 _amount) public {
        require(_pid < pools.length, "Pool does not exist");

        PoolInfo storage pool = pools[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        updatePool(_pid);

        if (user.amount > 0) {
            uint256 pending = ((user.amount * pool.accPerToken) / PRECISION_MULTIPLIER) - user.rewardDebt;
            if (pending > 0) {
                rewardToken.transfer(msg.sender, pending);
            }
        }

        if (_amount > 0) {
            ERC20(pool.lpToken).transferFrom(msg.sender, address(this), _amount);
            user.amount += _amount;
        }

        // ═════════════════════════════════════════════════════════════════════
        // WARNING!!
        // ═════════════════════════════════════════════════════════════════════
        // This has to be set in variable and only then applied to
        // user.rewardDebt, otherwise the solidvm throws!
        uint256 rewardDebt = (user.amount * pool.accPerToken) / PRECISION_MULTIPLIER;
        user.rewardDebt = rewardDebt;

        emit CurrentUserAmount(msg.sender, _pid, user.amount);
        emit Deposit(msg.sender, _pid, _amount);
    }

    function withdraw(uint256 _pid, uint256 _amount) public {
        require(_pid < pools.length, "Pool does not exist");

        PoolInfo storage pool = pools[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        require(user.amount >= _amount, "withdraw: not good");

        updatePool(_pid);

        uint256 pending = ((user.amount * pool.accPerToken) / PRECISION_MULTIPLIER) - user.rewardDebt;
        if (pending > 0) {
            ERC20(rewardToken).transfer(msg.sender, pending);
        }

        if (_amount > 0) {
            user.amount -= _amount;
            ERC20(pool.lpToken).transfer(msg.sender, _amount);
        }

        // ═════════════════════════════════════════════════════════════════════
        // WARNING!!
        // ═════════════════════════════════════════════════════════════════════
        // This has to be set in variable and only then applied to
        // user.rewardDebt, otherwise the solidvm throws!
        uint256 rewardDebt = (user.amount * pool.accPerToken) / PRECISION_MULTIPLIER;
        user.rewardDebt = rewardDebt;

        emit CurrentUserAmount(msg.sender, _pid, user.amount);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    function emergencyWithdraw(uint256 _pid) public {
        require(_pid < pools.length, "Pool does not exist");

        PoolInfo storage pool = pools[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        if (amount > 0) {
            ERC20(pool.lpToken).transfer(msg.sender, amount);
        }

        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    function pendingCata(uint256 _pid, address _user) external view returns (uint256) {
        require(_pid < pools.length, "Pool does not exist");

        PoolInfo storage pool = pools[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        uint256 accPerToken = pool.accPerToken;
        uint256 lpSupply = ERC20(pool.lpToken).balanceOf(address(this));

        if (block.timestamp > pool.lastRewardTimestamp && lpSupply != 0) {
            uint256 multiplier = getMultiplier(_pid, pool.lastRewardTimestamp, block.timestamp);
            uint256 cataReward = (multiplier * cataPerSecond * pool.allocPoint) / totalAllocPoint;
            accPerToken += (cataReward * PRECISION_MULTIPLIER) / lpSupply;
        }

        return ((user.amount * accPerToken) / PRECISION_MULTIPLIER) - user.rewardDebt;
    }

    function getBalance(uint256 _pid, address _user) external view returns (uint256) {
        require(_pid < pools.length, "Pool does not exist");
        return userInfo[_pid][_user].amount;
    }
}
