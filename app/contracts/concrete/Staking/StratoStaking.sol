import "../Tokens/Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./ValidatorRegistry.sol";

// Phase 1 staking accounting for STRATO. Validator profile and lifecycle live in
// ValidatorRegistry; this contract only tracks stake, rewards, and unbonding by operator.
struct StakingOperator {
    bool exists;
    bool active;
    uint256 commissionBps;
    uint256 selfBond;
    uint256 delegatedStake;
    uint256 stakeRewardPerTokenPaid;
    uint256 delegatorRewardPerStakeStored;
    uint256 baseRewardPerOperatorPaid;
    uint256 pendingBaseRewards;
    uint256 pendingSelfBondRewards;
    uint256 pendingCommission;
}

struct StakingUnbondRequest {
    uint256 amount;
    uint256 releaseTime;
    bool claimed;
}

contract  StratoStaking is Ownable {
    event Initialized(address indexed stratoToken, uint256 unbondingSeconds, uint256 baseRewardBps, uint256 maxCommissionBps);
    event ValidatorRegistrySet(address indexed validatorRegistry);
    event OperatorSynced(address indexed operator, bool active, uint256 commissionBps);
    event CommissionUpdated(address indexed operator, uint256 oldCommissionBps, uint256 newCommissionBps);
    event ParamsUpdated(uint256 unbondingSeconds, uint256 baseRewardBps, uint256 maxCommissionBps, uint256 maxBatchSize);
    event RewardsDeposited(address indexed funder, uint256 amount);
    event RewardsFunded(address indexed funder, uint256 amount, uint256 startTime, uint256 duration, uint256 baseRewardRate, uint256 stakeRewardRate, string name, string description);
    event RewardScheduleStopped(address indexed stopper, uint256 remainingReward, uint256 stoppedAt);
    event Staked(address indexed user, address indexed operator, uint256 amount);
    event StakeMoved(address indexed user, address indexed fromOperator, address indexed toOperator, uint256 amount);
    event UnbondingStarted(address indexed user, address indexed operator, uint256 indexed requestId, uint256 amount, uint256 releaseTime);
    event UnbondedWithdrawn(address indexed user, uint256 amount);
    event SelfBonded(address indexed operator, uint256 amount);
    event SelfBondUnbondingStarted(address indexed operator, uint256 indexed requestId, uint256 amount, uint256 releaseTime);
    event DelegatorRewardsClaimed(address indexed user, uint256 amount);
    event OperatorRewardsClaimed(address indexed operator, uint256 amount);
    event RewardReserveRecovered(address indexed to, uint256 amount);
    event UntrackedStratoRecovered(address indexed to, uint256 amount);
    event StrayTokenRecovered(address indexed token, address indexed to, uint256 amount);

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_DIVISOR = 10000;

    Token public stratoToken;
    ValidatorRegistry public validatorRegistry;

    uint256 public unbondingSeconds;
    uint256 public baseRewardBps;
    uint256 public maxCommissionBps;
    uint256 public maxBatchSize;

    uint256 public totalUserStake;
    uint256 public totalSelfBond;
    uint256 public totalUnbonding;
    uint256 public totalRewardableStake;
    uint256 public activeOperatorCount;

    // Reward reserve is the STRATO inventory available for rewards. The schedule fields
    // below are the Phase 1 funding adapter, not the future protocol reward engine.
    uint256 public rewardReserve;
    uint256 public rewardPeriodAmount;
    uint256 public scheduledRewardRemaining;
    uint256 public baseRewardRate;
    uint256 public stakeRewardRate;
    uint256 public periodStart;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    string public rewardPeriodName;
    string public rewardPeriodDescription;

    // Reward indexes keep accrual O(1): actions update only the touched operator/user.
    uint256 public baseRewardPerOperatorStored;
    uint256 public globalStakeRewardPerTokenStored;

    address[] public  operatorList;
    mapping(address => StakingOperator) public  operators;

    // User stake is keyed by operator so user-directed delegation is already represented.
    mapping(address => mapping(address => uint256)) public  delegatedStake;
    mapping(address => mapping(address => uint256)) public  userRewardPerStakePaid;
    mapping(address => mapping(address => uint256)) public  pendingDelegatorRewards;
    mapping(address => mapping(uint256 => StakingUnbondRequest)) public  unbondingQueue;
    mapping(address => uint256) public  unbondingRequestCount;

    // Rewards can leave rewardReserve before they are claimed. This protects
    // accrued-but-unpaid rewards from being treated as recoverable STRATO.
    uint256 public allocatedRewardLiability;

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(
        address _stratoToken,
        uint256 _unbondingSeconds,
        uint256 _baseRewardBps,
        uint256 _maxCommissionBps,
        uint256 _maxBatchSize
    ) external onlyOwner {
        require(address(stratoToken) == address(0), "SS: initialized");
        require(_stratoToken != address(0), "SS: token=0");
        require(_baseRewardBps <= BPS_DIVISOR, "SS: bad base");
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");

        stratoToken = Token(_stratoToken);
        unbondingSeconds = _unbondingSeconds;
        baseRewardBps = _baseRewardBps;
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;
        lastUpdateTime = block.timestamp;

        emit Initialized(_stratoToken, _unbondingSeconds, _baseRewardBps, _maxCommissionBps);
    }

    modifier onlyInitialized() {
        require(address(stratoToken) != address(0), "SS: not initialized");
        _;
    }

    modifier onlyOperator(address operator) {
        require(operators[operator].exists, "SS: operator missing");
        _;
    }

    modifier onlyValidatorRegistry() {
        require(msg.sender == address(validatorRegistry), "SS: registry only");
        _;
    }

    function operatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    function setValidatorRegistry(address _validatorRegistry) external onlyOwner onlyInitialized {
        require(address(validatorRegistry) == address(0), "SS: registry set");
        require(_validatorRegistry != address(0), "SS: registry=0");
        validatorRegistry = ValidatorRegistry(_validatorRegistry);
        emit ValidatorRegistrySet(_validatorRegistry);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        if (periodFinish == 0) return 0;
        if (block.timestamp < periodStart) return periodStart;
        if (block.timestamp < periodFinish) return block.timestamp;
        return periodFinish;
    }

    function principalBalance() public view returns (uint256) {
        return totalUserStake + totalSelfBond + totalUnbonding;
    }

    function rewardBalance() public view returns (uint256) {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 principal = principalBalance();
        if (balance <= principal) return 0;
        return balance - principal;
    }

    function scheduledRewardReserve() public view returns (uint256) {
        if (periodFinish == 0 || block.timestamp >= periodFinish) return 0;
        return scheduledRewardRemaining;
    }

    function hasActiveRewardSchedule() public view returns (bool) {
        return periodFinish > 0 && block.timestamp < periodFinish && scheduledRewardRemaining > 0;
    }

    function recoverableRewardReserve() public view returns (uint256) {
        uint256 scheduled = scheduledRewardReserve();
        if (rewardReserve <= scheduled) return 0;
        return rewardReserve - scheduled;
    }

    function recoverableUntrackedStrato() public view returns (uint256) {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 tracked = principalBalance() + rewardReserve + allocatedRewardLiability;
        if (balance <= tracked) return 0;
        return balance - tracked;
    }

    // Phase 1 adapter: pull streamed scheduled rewards into global indexes. Later
    // protocol rewards should credit validator-specific rewards into the same
    // operator/delegator accounting path, without relying on this global schedule.
    function _updateGlobalRewards() internal {
        uint256 current = lastTimeRewardApplicable();
        if (current <= lastUpdateTime) {
            if (periodFinish > 0 && block.timestamp >= periodFinish) {
                baseRewardRate = 0;
                stakeRewardRate = 0;
                scheduledRewardRemaining = 0;
            }
            return;
        }

        uint256 delta = current - lastUpdateTime;

        if (baseRewardRate > 0 && activeOperatorCount > 0 && scheduledRewardRemaining > 0) {
            uint256 baseAccrued = baseRewardRate * delta;
            if (baseAccrued > scheduledRewardRemaining) baseAccrued = scheduledRewardRemaining;

            uint256 perOperator = baseAccrued / activeOperatorCount;
            uint256 allocatedBase = perOperator * activeOperatorCount;

            if (allocatedBase > 0) {
                baseRewardPerOperatorStored += perOperator;
                rewardReserve -= allocatedBase;
                scheduledRewardRemaining -= allocatedBase;
                allocatedRewardLiability += allocatedBase;
            }
        }

        if (stakeRewardRate > 0 && totalRewardableStake > 0 && scheduledRewardRemaining > 0) {
            uint256 stakeAccrued = stakeRewardRate * delta;
            if (stakeAccrued > scheduledRewardRemaining) stakeAccrued = scheduledRewardRemaining;

            uint256 rewardPerStake = (stakeAccrued * PRECISION) / totalRewardableStake;
            uint256 allocatedStake = (rewardPerStake * totalRewardableStake) / PRECISION;

            if (allocatedStake > 0) {
                globalStakeRewardPerTokenStored += rewardPerStake;
                rewardReserve -= allocatedStake;
                scheduledRewardRemaining -= allocatedStake;
                allocatedRewardLiability += allocatedStake;
            }
        }

        lastUpdateTime = current;
        if (current == periodFinish && block.timestamp >= periodFinish) {
            baseRewardRate = 0;
            stakeRewardRate = 0;
            scheduledRewardRemaining = 0;
        }
    }

    // Generic validator reward accounting: self-bond rewards accrue to the operator,
    // delegator rewards are net of operator commission and credited through an index.
    function _creditOperatorRewardShares(address operator, uint256 selfBondReward, uint256 delegatorGrossReward) internal {
        StakingOperator storage v = operators[operator];

        if (selfBondReward > 0) {
            v.pendingSelfBondRewards += selfBondReward;
        }

        if (delegatorGrossReward > 0 && v.delegatedStake > 0) {
            uint256 commission = (delegatorGrossReward * v.commissionBps) / BPS_DIVISOR;
            uint256 userNet = delegatorGrossReward - commission;

            v.pendingCommission += commission;
            v.delegatorRewardPerStakeStored += (userNet * PRECISION) / v.delegatedStake;
        }
    }

    // Materialize one operator's pending base, self-bond, commission, and delegator indexes.
    function _updateOperator(address operator) internal {
        StakingOperator storage v = operators[operator];
        if (!v.exists) return;

        if (v.active) {
            uint256 baseDelta = baseRewardPerOperatorStored - v.baseRewardPerOperatorPaid;
            if (baseDelta > 0) {
                v.pendingBaseRewards += baseDelta;
                v.baseRewardPerOperatorPaid = baseRewardPerOperatorStored;
            }
        } else {
            v.baseRewardPerOperatorPaid = baseRewardPerOperatorStored;
        }

        if (!v.active) {
            v.stakeRewardPerTokenPaid = globalStakeRewardPerTokenStored;
            return;
        }

        uint256 stakeDelta = globalStakeRewardPerTokenStored - v.stakeRewardPerTokenPaid;
        if (stakeDelta > 0) {
            uint256 selfBondReward = (v.selfBond * stakeDelta) / PRECISION;
            uint256 delegatorGrossReward = (v.delegatedStake * stakeDelta) / PRECISION;
            _creditOperatorRewardShares(operator, selfBondReward, delegatorGrossReward);

            v.stakeRewardPerTokenPaid = globalStakeRewardPerTokenStored;
        }
    }

    function _updateUser(address user, address operator) internal {
        _updateOperator(operator);

        uint256 paid = userRewardPerStakePaid[user][operator];
        uint256 stored = operators[operator].delegatorRewardPerStakeStored;
        uint256 amount = delegatedStake[user][operator];

        if (amount > 0 && stored > paid) {
            pendingDelegatorRewards[user][operator] += (amount * (stored - paid)) / PRECISION;
        }

        userRewardPerStakePaid[user][operator] = stored;
    }

    // Unbonding requests share one queue per address for both users and operators.
    function _createUnbondRequest(address user, uint256 amount) internal returns (uint256) {
        uint256 requestId = unbondingRequestCount[user];
        unbondingQueue[user][requestId] = StakingUnbondRequest(amount, block.timestamp + unbondingSeconds, false);
        unbondingRequestCount[user] = requestId + 1;
        totalUnbonding += amount;
        return requestId;
    }

    function _releaseRewardLiability(uint256 amount) internal {
        if (amount >= allocatedRewardLiability) {
            allocatedRewardLiability = 0;
        } else {
            allocatedRewardLiability -= amount;
        }
    }

    function _depositRewards(uint256 amount) internal returns (uint256) {
        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: fund transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no reward");

        rewardReserve += received;
        emit RewardsDeposited(msg.sender, received);
        return received;
    }

    function _rateStartTime() internal view returns (uint256) {
        if (block.timestamp < periodStart) return periodStart;
        return block.timestamp;
    }

    function _refreshRewardRates() internal {
        uint256 rateStartTime = _rateStartTime();

        if (periodFinish > rateStartTime && scheduledRewardRemaining > 0) {
            uint256 remaining = periodFinish - rateStartTime;
            uint256 totalRate = scheduledRewardRemaining / remaining;
            baseRewardRate = (totalRate * baseRewardBps) / BPS_DIVISOR;
            stakeRewardRate = totalRate - baseRewardRate;
            lastUpdateTime = rateStartTime;
            return;
        }

        baseRewardRate = 0;
        stakeRewardRate = 0;
        scheduledRewardRemaining = 0;
    }

    // Phase 1 adapter: stream an explicit amount from the funded reserve over time.
    function _startRewardSchedule(
        uint256 rewardAmount,
        uint256 startTime,
        uint256 duration,
        uint256 _baseRewardBps,
        string name,
        string description
    ) internal {
        require(rewardAmount > 0, "SS: amount=0");
        require(startTime >= block.timestamp, "SS: start in past");
        require(duration > 0, "SS: duration=0");
        require(_baseRewardBps <= BPS_DIVISOR, "SS: bad base");
        require(!hasActiveRewardSchedule(), "SS: active schedule");
        require(rewardAmount <= rewardReserve, "SS: insufficient reserve");

        baseRewardBps = _baseRewardBps;
        rewardPeriodAmount = rewardAmount;
        scheduledRewardRemaining = rewardAmount;
        periodStart = startTime;
        periodFinish = startTime + duration;
        rewardPeriodName = name;
        rewardPeriodDescription = description;

        uint256 totalRate = rewardAmount / duration;
        require(totalRate > 0, "SS: reward rate=0");

        baseRewardRate = (totalRate * baseRewardBps) / BPS_DIVISOR;
        stakeRewardRate = totalRate - baseRewardRate;
        lastUpdateTime = startTime;

        emit RewardsFunded(msg.sender, rewardAmount, startTime, duration, baseRewardRate, stakeRewardRate, name, description);
    }

    // The registry is the canonical source for operator lifecycle; it syncs accounting here.
    function syncOperator(address operator, bool active, uint256 commissionBps) external onlyInitialized onlyValidatorRegistry {
        require(operator != address(0), "SS: operator=0");
        require(commissionBps <= maxCommissionBps, "SS: commission too high");

        _updateGlobalRewards();

        StakingOperator storage v = operators[operator];
        if (!v.exists) {
            require(active, "SS: operator missing");
            operators[operator] = StakingOperator(true, true, commissionBps, 0, 0, globalStakeRewardPerTokenStored, 0, baseRewardPerOperatorStored, 0, 0, 0);
            operatorList.push(operator);
            activeOperatorCount += 1;
            emit OperatorSynced(operator, true, commissionBps);
            return;
        }

        if (active) {
            require(!v.active, "SS: operator active");
            v.active = true;
            v.commissionBps = commissionBps;
            v.stakeRewardPerTokenPaid = globalStakeRewardPerTokenStored;
            v.baseRewardPerOperatorPaid = baseRewardPerOperatorStored;
            totalRewardableStake += v.selfBond + v.delegatedStake;
            activeOperatorCount += 1;

            emit OperatorSynced(operator, true, commissionBps);
            return;
        }

        require(v.active, "SS: operator inactive");
        _updateOperator(operator);

        v.active = false;
        activeOperatorCount -= 1;
        totalRewardableStake -= v.selfBond + v.delegatedStake;

        if (v.selfBond > 0) {
            uint256 selfBondAmount = v.selfBond;
            v.selfBond = 0;
            totalSelfBond -= selfBondAmount;

            uint256 requestId = _createUnbondRequest(operator, selfBondAmount);
            emit SelfBondUnbondingStarted(operator, requestId, selfBondAmount, block.timestamp + unbondingSeconds);
        }

        emit OperatorSynced(operator, false, v.commissionBps);
    }

    function _requireActiveCommissionsWithinCap(uint256 commissionCapBps) internal view {
        for (uint256 i = 0; i < operatorList.length; i++) {
            StakingOperator storage v = operators[operatorList[i]];
            require(!v.active || v.commissionBps <= commissionCapBps, "SS: active commission too high");
        }
    }

    function setParams(
        uint256 _unbondingSeconds,
        uint256 _baseRewardBps,
        uint256 _maxCommissionBps,
        uint256 _maxBatchSize
    ) external onlyOwner onlyInitialized {
        require(_baseRewardBps <= BPS_DIVISOR, "SS: bad base");
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");
        if (_maxCommissionBps < maxCommissionBps) {
            _requireActiveCommissionsWithinCap(_maxCommissionBps);
        }

        _updateGlobalRewards();

        unbondingSeconds = _unbondingSeconds;
        baseRewardBps = _baseRewardBps;
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;

        _refreshRewardRates();

        emit ParamsUpdated(_unbondingSeconds, _baseRewardBps, _maxCommissionBps, _maxBatchSize);
    }

    // Operators manage their own commission from the operator address; admin override is separate.
    function setCommissionBps(uint256 newCommissionBps) external onlyInitialized onlyOperator(msg.sender) {
        address operator = msg.sender;
        require(operators[operator].active, "SS: operator inactive");
        _setCommissionBps(operator, newCommissionBps);
    }

    function setOperatorCommissionBps(address operator, uint256 newCommissionBps) external onlyOwner onlyInitialized onlyOperator(operator) {
        require(operators[operator].active, "SS: operator inactive");
        _setCommissionBps(operator, newCommissionBps);
    }

    function _setCommissionBps(address operator, uint256 newCommissionBps) internal {
        require(newCommissionBps <= maxCommissionBps, "SS: commission too high");

        _updateGlobalRewards();
        _updateOperator(operator);

        uint256 oldCommissionBps = operators[operator].commissionBps;
        operators[operator].commissionBps = newCommissionBps;

        emit CommissionUpdated(operator, oldCommissionBps, newCommissionBps);
    }

    function depositRewards(uint256 amount) public onlyInitialized {
        require(amount > 0, "SS: amount=0");
        _updateGlobalRewards();
        _depositRewards(amount);
    }

    function startRewardSchedule(
        uint256 rewardAmount,
        uint256 startTime,
        uint256 duration,
        uint256 _baseRewardBps,
        string name,
        string description
    ) external onlyOwner onlyInitialized {
        _updateGlobalRewards();
        _startRewardSchedule(rewardAmount, startTime, duration, _baseRewardBps, name, description);
    }

    function stopRewardSchedule() external onlyOwner onlyInitialized {
        _updateGlobalRewards();

        uint256 remainingReward = scheduledRewardRemaining;
        baseRewardRate = 0;
        stakeRewardRate = 0;
        scheduledRewardRemaining = 0;
        periodStart = block.timestamp;
        periodFinish = block.timestamp;
        lastUpdateTime = block.timestamp;

        emit RewardScheduleStopped(msg.sender, remainingReward, block.timestamp);
    }

    // Delegators choose an operator for reward accounting. Phase 1 stake does not affect consensus.
    function stake(address operator, uint256 amount) public onlyInitialized onlyOperator(operator) {
        require(amount > 0, "SS: amount=0");
        require(operators[operator].active, "SS: operator inactive");

        _updateGlobalRewards();
        _updateUser(msg.sender, operator);

        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: stake transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no stake");

        delegatedStake[msg.sender][operator] += received;
        operators[operator].delegatedStake += received;
        totalUserStake += received;
        totalRewardableStake += received;

        emit Staked(msg.sender, operator, received);
    }

    function stakeBatch(address[] calldata stakeOperators, uint256[] calldata amounts) external onlyInitialized {
        require(stakeOperators.length == amounts.length, "SS: length mismatch");
        require(stakeOperators.length > 0 && stakeOperators.length <= maxBatchSize, "SS: bad batch");

        for (uint256 i = 0; i < stakeOperators.length; i++) {
            stake(stakeOperators[i], amounts[i]);
        }
    }

    function moveStake(address fromOperator, address toOperator, uint256 amount) external onlyInitialized onlyOperator(fromOperator) onlyOperator(toOperator) {
        require(amount > 0, "SS: amount=0");
        require(fromOperator != toOperator, "SS: same operator");
        require(operators[toOperator].active, "SS: target inactive");
        require(delegatedStake[msg.sender][fromOperator] >= amount, "SS: insufficient stake");

        _updateGlobalRewards();
        _updateUser(msg.sender, fromOperator);
        _updateUser(msg.sender, toOperator);

        delegatedStake[msg.sender][fromOperator] -= amount;
        operators[fromOperator].delegatedStake -= amount;
        if (operators[fromOperator].active) totalRewardableStake -= amount;

        delegatedStake[msg.sender][toOperator] += amount;
        operators[toOperator].delegatedStake += amount;
        totalRewardableStake += amount;

        emit StakeMoved(msg.sender, fromOperator, toOperator, amount);
    }

    function unstake(address operator, uint256 amount) external onlyInitialized onlyOperator(operator) {
        require(amount > 0, "SS: amount=0");
        require(delegatedStake[msg.sender][operator] >= amount, "SS: insufficient stake");

        _updateGlobalRewards();
        _updateUser(msg.sender, operator);

        delegatedStake[msg.sender][operator] -= amount;
        operators[operator].delegatedStake -= amount;
        totalUserStake -= amount;
        if (operators[operator].active) totalRewardableStake -= amount;

        uint256 requestId = _createUnbondRequest(msg.sender, amount);

        emit UnbondingStarted(msg.sender, operator, requestId, amount, block.timestamp + unbondingSeconds);
    }

    // Self-bond is operator-owned stake. In Phase 1 it earns rewards but is not slashable.
    function selfBond(uint256 amount) external onlyInitialized onlyOperator(msg.sender) {
        address operator = msg.sender;
        require(amount > 0, "SS: amount=0");
        require(operators[operator].active, "SS: operator inactive");

        _updateGlobalRewards();
        _updateOperator(operator);

        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: bond transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no bond");

        operators[operator].selfBond += received;
        totalSelfBond += received;
        if (operators[operator].active) totalRewardableStake += received;

        emit SelfBonded(operator, received);
    }

    function unbondSelf(uint256 amount) external onlyInitialized onlyOperator(msg.sender) {
        address operator = msg.sender;
        require(amount > 0, "SS: amount=0");
        require(operators[operator].selfBond >= amount, "SS: insufficient bond");

        _updateGlobalRewards();
        _updateOperator(operator);

        operators[operator].selfBond -= amount;
        totalSelfBond -= amount;
        if (operators[operator].active) totalRewardableStake -= amount;

        uint256 requestId = _createUnbondRequest(operator, amount);

        emit SelfBondUnbondingStarted(operator, requestId, amount, block.timestamp + unbondingSeconds);
    }

    // Delegator rewards come only from the stake-based pool net of operator commission.
    function claimRewards(address[] calldata claimOperators) public onlyInitialized {
        require(claimOperators.length > 0 && claimOperators.length <= maxBatchSize, "SS: bad batch");

        _updateGlobalRewards();

        uint256 totalClaimed = 0;
        for (uint256 i = 0; i < claimOperators.length; i++) {
            address operator = claimOperators[i];
            _updateUser(msg.sender, operator);

            uint256 reward = pendingDelegatorRewards[msg.sender][operator];
            if (reward > 0) {
                pendingDelegatorRewards[msg.sender][operator] = 0;
                totalClaimed += reward;
            }
        }

        require(totalClaimed > 0, "SS: no rewards");
        require(rewardBalance() >= totalClaimed, "SS: rewards unavailable");
        _releaseRewardLiability(totalClaimed);
        require(IERC20(address(stratoToken)).transfer(msg.sender, totalClaimed), "SS: reward transfer failed");

        emit DelegatorRewardsClaimed(msg.sender, totalClaimed);
    }

    // Operator rewards include base rewards, self-bond stake rewards, and earned commission.
    function claimOperatorRewards() external onlyInitialized onlyOperator(msg.sender) {
        address operator = msg.sender;
        _updateGlobalRewards();
        _updateOperator(operator);

        StakingOperator storage v = operators[operator];
        uint256 amount = v.pendingBaseRewards + v.pendingSelfBondRewards + v.pendingCommission;
        require(amount > 0, "SS: no rewards");

        v.pendingBaseRewards = 0;
        v.pendingSelfBondRewards = 0;
        v.pendingCommission = 0;

        require(rewardBalance() >= amount, "SS: rewards unavailable");
        _releaseRewardLiability(amount);
        require(IERC20(address(stratoToken)).transfer(msg.sender, amount), "SS: operator reward transfer failed");

        emit OperatorRewardsClaimed(operator, amount);
    }

    function withdrawUnbonded(uint256[] calldata requestIds) external onlyInitialized {
        require(requestIds.length > 0 && requestIds.length <= maxBatchSize, "SS: bad batch");

        uint256 totalWithdrawn = 0;
        for (uint256 i = 0; i < requestIds.length; i++) {
            StakingUnbondRequest storage request = unbondingQueue[msg.sender][requestIds[i]];
            require(!request.claimed, "SS: request claimed");
            require(request.amount > 0, "SS: request missing");
            require(block.timestamp >= request.releaseTime, "SS: request locked");

            uint256 amount = request.amount;
            request.claimed = true;
            totalWithdrawn += amount;
        }

        totalUnbonding -= totalWithdrawn;
        require(IERC20(address(stratoToken)).transfer(msg.sender, totalWithdrawn), "SS: withdraw transfer failed");

        emit UnbondedWithdrawn(msg.sender, totalWithdrawn);
    }

    function recoverRewardReserve(address to, uint256 amount) external onlyOwner onlyInitialized {
        require(to != address(0), "SS: to=0");

        _updateGlobalRewards();
        require(amount <= recoverableRewardReserve(), "SS: reserve protected");
        require(rewardBalance() >= amount, "SS: reserve unavailable");

        rewardReserve -= amount;
        _refreshRewardRates();
        require(IERC20(address(stratoToken)).transfer(to, amount), "SS: reserve transfer failed");

        emit RewardReserveRecovered(to, amount);
    }

    function recoverUntrackedStrato(address to, uint256 amount) external onlyOwner onlyInitialized {
        require(to != address(0), "SS: to=0");
        require(amount <= recoverableUntrackedStrato(), "SS: untracked unavailable");

        require(IERC20(address(stratoToken)).transfer(to, amount), "SS: untracked transfer failed");
        emit UntrackedStratoRecovered(to, amount);
    }

    function recoverStrayToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "SS: to=0");
        require(token != address(stratoToken), "SS: use reserve recovery");

        require(IERC20(token).transfer(to, amount), "SS: recover failed");
        emit StrayTokenRecovered(token, to, amount);
    }
}
