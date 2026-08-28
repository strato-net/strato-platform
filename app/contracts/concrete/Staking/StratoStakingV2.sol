import "../Tokens/Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./ValidatorRegistryV2.sol";
import "./IStakingGovernance.sol";

// Staking accounting for STRATO. Validator profile and lifecycle live in
// ValidatorRegistry; this contract tracks stake, rewards, and unbonding by operator,
// publishes validator stake weights to governance (consensus proposer selection),
// receives the proposer's share of transaction fees (USDST) and keeps liveness
// counters (blocks proposed / proposals missed) per validator. Nothing here seizes
// tokens: a missed proposal costs that block's fees and, optionally after
// maxConsecutiveMisses, a temporary jail.
//
// Validator lifecycle (status is derived, not stored):
//   Missing    = no staking record
//   Registered = listed operator, not in the consensus set (may stake / self-bond)
//   Active     = in the consensus set (explicit tryActivate / reconcileSet; room or eviction)
//   Kicked     = removed by the registry owner (self-bond force-unbonded)
// Leaving the set (under minStake, exit notice, jail, kick) is automatic and same-tx;
// joining is explicit and bounded by maxActiveValidators / hardCapActiveValidators.
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
    // Proposer fee (USDST) accounting, mirroring the STRATO reward fields above.
    uint256 feePerStakeStored;
    uint256 pendingSelfBondFees;
    uint256 pendingFeeCommission;
}

struct StakingUnbondRequest {
    uint256 amount;
    uint256 releaseTime;
    bool claimed;
}

contract  StratoStaking is Ownable {
    event Initialized(address indexed stratoToken, uint256 unbondingSeconds, uint256 baseRewardBps, uint256 maxCommissionBps);
    event UsdstTokenSet(address indexed usdstToken, uint256 trackedFrom);
    event ValidatorRegistrySet(address indexed validatorRegistry);
    event GovernanceSet(address indexed governance, bool syncEnabled);
    event ValidatorParamsUpdated(uint256 minStake, uint256 minSelfBond, uint256 proposerFeeBps, uint256 maxConsecutiveMisses, uint256 jailCooldown);
    event SetParamsUpdated(uint256 maxActiveValidators, uint256 hardCapActiveValidators, uint256 evictionMarginBps, uint256 maxSetMutationsPerBlock, uint256 exitNoticeSeconds, uint256 unkickCooldown, uint256 maxOperatorStakeBps, bool joinsPaused);
    event ValidatorEvicted(address indexed operator, address indexed validator, address indexed by);
    event ExitRequested(address indexed operator, uint256 readyTime);
    event ExitCancelled(address indexed operator);
    event OperatorSynced(address indexed operator, bool active, uint256 commissionBps);
    event ValidatorAddressSynced(address indexed operator, address indexed oldValidator, address indexed newValidator);
    event ValidatorSynced(address indexed operator, address indexed validator, bool registered, uint256 weight);
    event FeesCredited(address indexed operator, address indexed validator, uint256 amount);
    event UnattributedFees(address indexed validator, uint256 amount);
    event ProposalMissed(address indexed validator, address indexed operator, uint256 blockNumber);
    event ValidatorJailed(address indexed operator, address indexed validator, uint256 jailedUntil);
    event DelegatorFeesClaimed(address indexed user, uint256 amount);
    event OperatorFeesClaimed(address indexed operator, uint256 amount);
    event UnattributedFeesRecovered(address indexed to, uint256 amount);
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
    IERC20 public usdstToken;
    ValidatorRegistry public validatorRegistry;

    // Consensus integration. Governance (MercataGovernance, genesis address 0x100)
    // is only called while governanceSyncEnabled; the flag is the ops kill switch.
    // Staking calls governance directly — governance authorises this contract
    // through its stakingContract / onlyStaking pair — and governance is what
    // republishes weights as ValidatorStakeUpdated for consensus to read.
    address public governance;
    bool public governanceSyncEnabled;
    uint256 public minStake;              // self-bond + delegated stake needed to be a validator
    uint256 public minSelfBond;           // self-bond floor (0 until slashing exists)
    uint256 public proposerFeeBps;        // share of each transaction fee routed here
    uint256 public maxConsecutiveMisses;  // 0 = never jail
    uint256 public jailCooldown;

    // Consensus set size and admission.
    uint256 public maxActiveValidators;     // admin-chosen size of the active set
    uint256 public hardCapActiveValidators; // never exceeded (the node has a matching binary cap)
    uint256 public evictionMarginBps;       // a waiter must beat the lowest validator by this margin
    uint256 public maxSetMutationsPerBlock; // adds/removes per block (kicks bypass)
    uint256 public exitNoticeSeconds;
    uint256 public unkickCooldown;
    uint256 public maxOperatorStakeBps;     // inbound stake cap per operator (0 = off)
    bool public joinsPaused;                // permissionless activation switch (owner may still activate)
    uint256 public validatorCount;
    uint256 public mutationBlock;
    uint256 public setMutationsThisBlock;
    mapping(address => uint256) public  exitReadyTime;
    mapping(address => uint256) public  kickedAt;

    // operator <=> consensus validator address (node key), and what governance knows.
    mapping(address => address) public  validatorOf;
    mapping(address => address) public  operatorOf;
    mapping(address => bool) public  isValidator;
    mapping(address => uint256) public  lastSyncedWeight;
    mapping(address => uint256) public  jailedUntil;

    // Liveness, keyed by validator (consensus) address, derived from block.prev*.
    mapping(address => uint256) public  blocksProposed;
    mapping(address => uint256) public  missedProposals;
    mapping(address => uint256) public  consecutiveMisses;

    // Proposer fee (USDST) accounting: fees arrive by transfer, are attributed to
    // block.proposer by balance delta, and are claimed alongside STRATO rewards.
    uint256 public trackedUsdst;
    uint256 public unattributedFees;
    uint256 public totalFeesCredited;
    uint256 public lastProcessedBlock;
    mapping(address => mapping(address => uint256)) public  userFeePerStakePaid;
    mapping(address => mapping(address => uint256)) public  pendingDelegatorFees;

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
        address _usdstToken,
        uint256 _unbondingSeconds,
        uint256 _baseRewardBps,
        uint256 _maxCommissionBps,
        uint256 _maxBatchSize
    ) external onlyOwner {
        require(address(stratoToken) == address(0), "SS: initialized");
        require(_stratoToken != address(0), "SS: token=0");
        require(_usdstToken != address(0), "SS: usdst=0");
        require(_baseRewardBps <= BPS_DIVISOR, "SS: bad base");
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");

        stratoToken = Token(_stratoToken);
        usdstToken = IERC20(_usdstToken);
        unbondingSeconds = _unbondingSeconds;
        baseRewardBps = _baseRewardBps;
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;
        lastUpdateTime = block.timestamp;

        // Set admission defaults: closed joins, today's consensus envelope.
        maxActiveValidators = 50;
        hardCapActiveValidators = 50;
        evictionMarginBps = 500;
        maxSetMutationsPerBlock = 2;
        exitNoticeSeconds = _unbondingSeconds;
        unkickCooldown = _unbondingSeconds;
        joinsPaused = true;

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

    // USDST joined the fee path after this contract was already live, so a deployment
    // upgraded in place can never reach it through initialize(). Any balance already
    // held predates fee attribution and must not be credited to whichever validator
    // proposes the next block.
    function setUsdstToken(address _usdstToken) external onlyOwner onlyInitialized {
        require(address(usdstToken) == address(0), "SS: usdst set");
        require(_usdstToken != address(0), "SS: usdst=0");
        usdstToken = IERC20(_usdstToken);
        trackedUsdst = usdstToken.balanceOf(address(this));
        emit UsdstTokenSet(_usdstToken, trackedUsdst);
    }

    function setValidatorRegistry(address _validatorRegistry) external onlyOwner onlyInitialized {
        require(address(validatorRegistry) == address(0), "SS: registry set");
        require(_validatorRegistry != address(0), "SS: registry=0");
        validatorRegistry = ValidatorRegistry(_validatorRegistry);
        emit ValidatorRegistrySet(_validatorRegistry);
    }

    // Wire (or disable) the governance link. Enabling resyncs every operator so
    // governance learns the current validator set and weights.
    function setGovernance(address _governance, bool syncEnabled) external onlyOwner onlyInitialized {
        require(!syncEnabled || _governance != address(0), "SS: governance=0");
        governance = _governance;
        governanceSyncEnabled = syncEnabled;
        emit GovernanceSet(_governance, syncEnabled);
        _syncAllValidators();
    }

    function setValidatorParams(
        uint256 _minStake,
        uint256 _minSelfBond,
        uint256 _proposerFeeBps,
        uint256 _maxConsecutiveMisses,
        uint256 _jailCooldown
    ) external onlyOwner onlyInitialized {
        require(_proposerFeeBps <= BPS_DIVISOR, "SS: bad fee share");

        minStake = _minStake;
        minSelfBond = _minSelfBond;
        proposerFeeBps = _proposerFeeBps;
        maxConsecutiveMisses = _maxConsecutiveMisses;
        jailCooldown = _jailCooldown;
        emit ValidatorParamsUpdated(_minStake, _minSelfBond, _proposerFeeBps, _maxConsecutiveMisses, _jailCooldown);
        _syncAllValidators();
    }

    function setSetParams(
        uint256 _maxActiveValidators,
        uint256 _hardCapActiveValidators,
        uint256 _evictionMarginBps,
        uint256 _maxSetMutationsPerBlock,
        uint256 _exitNoticeSeconds,
        uint256 _unkickCooldown,
        uint256 _maxOperatorStakeBps,
        bool _joinsPaused
    ) external onlyOwner onlyInitialized {
        // Unset (0) means the cap was never written; only-lowers applies once set.
        require(_hardCapActiveValidators > 0 && (hardCapActiveValidators == 0 || _hardCapActiveValidators <= hardCapActiveValidators), "SS: hard cap only lowers");
        require(_maxActiveValidators <= _hardCapActiveValidators, "SS: max above hard cap");
        require(_maxSetMutationsPerBlock > 0, "SS: bad mutation cap");
        require(_maxOperatorStakeBps <= BPS_DIVISOR, "SS: bad stake cap");

        maxActiveValidators = _maxActiveValidators;
        hardCapActiveValidators = _hardCapActiveValidators;
        evictionMarginBps = _evictionMarginBps;
        maxSetMutationsPerBlock = _maxSetMutationsPerBlock;
        exitNoticeSeconds = _exitNoticeSeconds;
        unkickCooldown = _unkickCooldown;
        maxOperatorStakeBps = _maxOperatorStakeBps;
        joinsPaused = _joinsPaused;
        emit SetParamsUpdated(_maxActiveValidators, _hardCapActiveValidators, _evictionMarginBps, _maxSetMutationsPerBlock, _exitNoticeSeconds, _unkickCooldown, _maxOperatorStakeBps, _joinsPaused);
    }

    // ---- consensus validator lifecycle -------------------------------------------

    function _validatorWeight(StakingOperator storage v) internal view returns (uint256) {
        return v.selfBond + v.delegatedStake;
    }

    // 0 = Missing, 1 = Registered, 2 = Active, 3 = Kicked
    function status(address operator) public view returns (uint8) {
        StakingOperator storage v = operators[operator];
        if (!v.exists) return 0;
        if (!v.active) return 3;
        if (isValidator[operator]) return 2;
        return 1;
    }

    // Eligible to be (or stay) a consensus validator: listed, has a validator address,
    // meets minStake (self-bond + delegated) and minSelfBond, not jailed, no exit due.
    function eligible(address operator) public view returns (bool) {
        StakingOperator storage v = operators[operator];
        return v.exists && v.active && validatorOf[operator] != address(0)
            && _validatorWeight(v) >= minStake && v.selfBond >= minSelfBond
            && block.timestamp >= jailedUntil[operator]
            && (exitReadyTime[operator] == 0 || block.timestamp < exitReadyTime[operator]);
    }

    // A waiter is eligible but not in the set; promotion is explicit (tryActivate / reconcileSet).
    function isWaiter(address operator) public view returns (bool) {
        return eligible(operator) && !isValidator[operator];
    }

    // More than a third of the rewardable stake: can stall a stake-weighted quorum.
    function exceedsOneThird(address operator) external view returns (bool) {
        return isValidator[operator] && _validatorWeight(operators[operator]) * 3 > totalRewardableStake;
    }

    function effectiveCap() public view returns (uint256) {
        // Zero-valued admission params read as unset (an upgraded proxy has no
        // storage for fields the old code never wrote); default to a 50-slot set.
        uint256 h = hardCapActiveValidators == 0 ? 50 : hardCapActiveValidators;
        uint256 a = maxActiveValidators == 0 ? h : maxActiveValidators;
        return a < h ? a : h;
    }

    function _consumeMutations(uint256 n) internal {
        if (mutationBlock != block.number) {
            mutationBlock = block.number;
            setMutationsThisBlock = 0;
        }
        uint256 mutationCap = maxSetMutationsPerBlock == 0 ? 4 : maxSetMutationsPerBlock;
        require(setMutationsThisBlock + n <= mutationCap, "SS: mutation cap");
        setMutationsThisBlock += n;
    }

    function _activate(address operator) internal {
        address validator = validatorOf[operator];
        uint256 weight = _validatorWeight(operators[operator]);
        // Straight to governance: it is the staking contract's own call (the
        // onlyStaking modifier authorises us), and it is what publishes the
        // weight as ValidatorStakeUpdated from 0x100. addValidatorFromStaking
        // already tolerates a validator that is in the set but not yet
        // staking-managed, which is how the genesis validators arrive.
        IStakingGovernance(governance).addValidatorFromStaking(validator, weight);
        isValidator[operator] = true;
        lastSyncedWeight[operator] = weight;
        validatorCount += 1;
        emit ValidatorSynced(operator, validator, true, weight);
    }

    // Governance never drops its last validator; then the operator stays registered.
    function _deactivate(address operator) internal returns (bool) {
        address validator = validatorOf[operator];
        // Governance refuses to drop its last validator, and reports that by
        // returning false rather than reverting.
        bool removed = IStakingGovernance(governance).removeValidatorFromStaking(validator);
        if (removed) {
            isValidator[operator] = false;
            lastSyncedWeight[operator] = 0;
            validatorCount -= 1;
            exitReadyTime[operator] = 0;
            emit ValidatorSynced(operator, validator, false, 0);
        }
        return removed;
    }

    // Keep governance in step with an operator already in the set: leave when no
    // longer eligible (same transaction, counts as a set mutation), refresh the weight
    // otherwise. Joining is never implicit.
    function _syncValidator(address operator) internal {
        if (!governanceSyncEnabled || !isValidator[operator]) return;
        if (!eligible(operator)) {
            _consumeMutations(1);
            _deactivate(operator);
            return;
        }
        uint256 weight = _validatorWeight(operators[operator]);

        // Publish unconditionally. lastSyncedWeight is only this contract's guess
        // at what governance holds, and a guess is exactly how governance ended up
        // holding no stakes at all: the pre-upgrade logic maintained the cache
        // without ever calling governance, so the cache reported "already synced"
        // forever after. Governance is the authority on what governance knows, and
        // setValidatorStake drops a no-op without emitting, so republishing costs
        // one call and never a spurious ValidatorStakeUpdated.
        //
        // addValidatorFromStaking rather than updateValidatorStake: the latter
        // reverts when governance does not already list the validator, which would
        // propagate out of stake() and unstake() and break staking for users. The
        // former reconciles that case instead of failing on it.
        IStakingGovernance(governance).addValidatorFromStaking(validatorOf[operator], weight);

        // ValidatorSynced stays change-gated: consensus consumes it as a delta
        // before the switch height, so its emission pattern must not change.
        if (lastSyncedWeight[operator] != weight) {
            lastSyncedWeight[operator] = weight;
            emit ValidatorSynced(operator, validatorOf[operator], true, weight);
        }
    }

    // Lowest validator by (weight asc, address asc): the eviction candidate.
    function _lowestValidator() internal view returns (address lowest, uint256 lowestWeight) {
        for (uint256 i = 0; i < operatorList.length; i++) {
            address op = operatorList[i];
            if (!isValidator[op]) continue;
            uint256 w = _validatorWeight(operators[op]);
            if (lowest == address(0) || w < lowestWeight || (w == lowestWeight && uint256(op) < uint256(lowest))) {
                lowest = op;
                lowestWeight = w;
            }
        }
    }

    // Best waiter by (weight desc, address asc): the promotion candidate.
    function _bestWaiter() internal view returns (address best, uint256 bestWeight) {
        for (uint256 i = 0; i < operatorList.length; i++) {
            address op = operatorList[i];
            if (!isWaiter(op)) continue;
            uint256 w = _validatorWeight(operators[op]);
            if (best == address(0) || w > bestWeight || (w == bestWeight && uint256(op) < uint256(best))) {
                best = op;
                bestWeight = w;
            }
        }
    }

    function _requireJoinsOpen() internal view {
        require(!joinsPaused || msg.sender == owner(), "SS: joins paused");
        require(governanceSyncEnabled, "SS: governance sync off");
    }

    // Put an eligible operator into the consensus set: into a free slot, or by evicting
    // the lowest validator it beats by evictionMarginBps. Anyone may call once joins are
    // open; the owner may always.
    function tryActivate(address operator) external onlyInitialized onlyOperator(operator) {
        _requireJoinsOpen();
        require(!isValidator[operator], "SS: already active");
        require(eligible(operator), "SS: not eligible");

        if (validatorCount < effectiveCap()) {
            _consumeMutations(1);
            _activate(operator);
        } else {
            (address lowest, uint256 lowestWeight) = _lowestValidator();
            uint256 weight = _validatorWeight(operators[operator]);
            require(lowest != address(0) && weight * BPS_DIVISOR >= lowestWeight * (BPS_DIVISOR + evictionMarginBps), "SS: set full");
            _consumeMutations(2);
            require(_deactivate(lowest), "SS: cannot evict");
            emit ValidatorEvicted(lowest, validatorOf[lowest], operator);
            _activate(operator);
        }
        _requireWithinStakeCap(operator);
    }

    // Fill free slots with the best waiters, as far as this block's mutation budget allows.
    function reconcileSet() external onlyInitialized {
        _requireJoinsOpen();
        uint256 cap = effectiveCap();
        while (validatorCount < cap) {
            if (mutationBlock == block.number && setMutationsThisBlock >= maxSetMutationsPerBlock) break;
            (address best,) = _bestWaiter();
            if (best == address(0)) break;
            _consumeMutations(1);
            _activate(best);
        }
    }

    // Inbound stake may not push an operator above maxOperatorStakeBps of the rewardable
    // stake (grandfathered operators simply cannot receive more).
    function _requireWithinStakeCap(address operator) internal view {
        if (maxOperatorStakeBps == 0 || totalRewardableStake == 0) return;
        require(_validatorWeight(operators[operator]) * BPS_DIVISOR <= totalRewardableStake * maxOperatorStakeBps, "SS: above operator stake cap");
    }

    // An active validator announces it will leave; it keeps serving for exitNoticeSeconds,
    // after which any sync (or syncValidator) takes it out of the set. Self-bond stays bonded.
    function requestExit() external onlyInitialized onlyOperator(msg.sender) {
        require(isValidator[msg.sender], "SS: not active");
        require(exitReadyTime[msg.sender] == 0, "SS: exit pending");
        exitReadyTime[msg.sender] = block.timestamp + exitNoticeSeconds;
        emit ExitRequested(msg.sender, exitReadyTime[msg.sender]);
    }

    function cancelExit() external onlyInitialized onlyOperator(msg.sender) {
        require(exitReadyTime[msg.sender] != 0, "SS: no exit pending");
        exitReadyTime[msg.sender] = 0;
        emit ExitCancelled(msg.sender);
    }

    // Used from the fee path, which must never revert.
    function _trySyncValidator(address operator) internal {
        try _syncValidator(operator) {
        } catch {
        }
    }

    function _syncAllValidators() internal {
        for (uint256 i = 0; i < operatorList.length; i++) {
            _syncValidator(operatorList[i]);
        }
    }

    // Permissionless resync (e.g. after a jail cooldown expires).
    function syncValidator(address operator) external onlyInitialized onlyOperator(operator) {
        _syncValidator(operator);
    }

    function _setValidatorAddress(address operator, address newValidator) internal {
        address oldValidator = validatorOf[operator];
        if (oldValidator == newValidator) return;

        // Retire the old identity from governance (unless the kill switch is on, in
        // which case governance is left for the admins to reconcile); the operator keeps
        // its slot under the new identity.
        bool wasValidator = isValidator[operator] && governanceSyncEnabled;
        if (oldValidator != address(0)) {
            if (wasValidator) {
                require(_deactivate(operator), "SS: cannot retire last validator");
            }
            delete operatorOf[oldValidator];
        }
        if (newValidator != address(0)) {
            require(operatorOf[newValidator] == address(0), "SS: duplicate validator");
            operatorOf[newValidator] = operator;
        }
        validatorOf[operator] = newValidator;
        emit ValidatorAddressSynced(operator, oldValidator, newValidator);
        if (wasValidator && newValidator != address(0) && eligible(operator)) {
            _activate(operator);
        }
    }

    function syncValidatorAddress(address operator, address validatorAddress) external onlyInitialized onlyValidatorRegistry onlyOperator(operator) {
        _setValidatorAddress(operator, validatorAddress);
        _syncValidator(operator);
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

    // Proposer fees (USDST) are pushed per block: split pro rata between self-bond and
    // delegated stake, delegators net of commission via a per-stake index.
    function _creditFees(address operator, uint256 amount) internal {
        StakingOperator storage v = operators[operator];
        uint256 weight = _validatorWeight(v);
        if (weight == 0) {
            v.pendingSelfBondFees += amount;
            return;
        }

        uint256 selfBondFee = (amount * v.selfBond) / weight;
        uint256 delegatorGrossFee = amount - selfBondFee;

        v.pendingSelfBondFees += selfBondFee;
        if (delegatorGrossFee > 0 && v.delegatedStake > 0) {
            uint256 commission = (delegatorGrossFee * v.commissionBps) / BPS_DIVISOR;
            v.pendingFeeCommission += commission;
            v.feePerStakeStored += ((delegatorGrossFee - commission) * PRECISION) / v.delegatedStake;
        } else {
            v.pendingSelfBondFees += delegatorGrossFee;
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

        uint256 feePaid = userFeePerStakePaid[user][operator];
        uint256 feeStored = operators[operator].feePerStakeStored;
        if (amount > 0 && feeStored > feePaid) {
            pendingDelegatorFees[user][operator] += (amount * (feeStored - feePaid)) / PRECISION;
        }
        userFeePerStakePaid[user][operator] = feeStored;
    }

    function _payFees(address to, uint256 amount) internal {
        if (amount == 0) return;
        require(amount <= trackedUsdst, "SS: fees unavailable");
        trackedUsdst -= amount;
        require(usdstToken.transfer(to, amount), "SS: fee transfer failed");
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
    function syncOperator(address operator, bool active, uint256 commissionBps, address validatorAddress) external onlyInitialized onlyValidatorRegistry {
        require(operator != address(0), "SS: operator=0");
        require(commissionBps <= maxCommissionBps, "SS: commission too high");

        _updateGlobalRewards();

        StakingOperator storage v = operators[operator];
        if (!v.exists) {
            require(active, "SS: operator missing");
            operators[operator] = StakingOperator(true, true, commissionBps, 0, 0, globalStakeRewardPerTokenStored, 0, baseRewardPerOperatorStored, 0, 0, 0, 0, 0, 0);
            operatorList.push(operator);
            activeOperatorCount += 1;
            _setValidatorAddress(operator, validatorAddress);
            _syncValidator(operator);
            emit OperatorSynced(operator, true, commissionBps);
            return;
        }

        if (active) {
            require(!v.active, "SS: operator active");
            require(block.timestamp >= kickedAt[operator] + unkickCooldown, "SS: unkick cooldown");
            v.active = true;
            v.commissionBps = commissionBps;
            v.stakeRewardPerTokenPaid = globalStakeRewardPerTokenStored;
            v.baseRewardPerOperatorPaid = baseRewardPerOperatorStored;
            totalRewardableStake += v.selfBond + v.delegatedStake;
            activeOperatorCount += 1;
            _setValidatorAddress(operator, validatorAddress);
            _syncValidator(operator);

            emit OperatorSynced(operator, true, commissionBps);
            return;
        }

        require(v.active, "SS: operator inactive");
        _updateOperator(operator);

        v.active = false;
        kickedAt[operator] = block.timestamp;
        activeOperatorCount -= 1;
        totalRewardableStake -= v.selfBond + v.delegatedStake;

        if (v.selfBond > 0) {
            uint256 selfBondAmount = v.selfBond;
            v.selfBond = 0;
            totalSelfBond -= selfBondAmount;

            uint256 requestId = _createUnbondRequest(operator, selfBondAmount);
            emit SelfBondUnbondingStarted(operator, requestId, selfBondAmount, block.timestamp + unbondingSeconds);
        }
        // A kick leaves the set immediately and is not bounded by the mutation cap.
        if (governanceSyncEnabled && isValidator[operator]) {
            _deactivate(operator);
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
        _requireWithinStakeCap(operator);
        _syncValidator(operator);
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
        _requireWithinStakeCap(toOperator);
        _syncValidator(fromOperator);
        _syncValidator(toOperator);
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
        _syncValidator(operator);
    }

    // Self-bond is operator-owned stake: it earns rewards and counts (with delegated
    // stake) towards validator eligibility.
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
        _requireWithinStakeCap(operator);
        _syncValidator(operator);
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
        _syncValidator(operator);
    }

    // ---- fee routing and liveness accounting (called from the fee path every transaction) ----

    // Permissionless and idempotent per block; must never revert since it runs inside
    // the platform's fee payment for every transaction.
    function processBlock() external {
        if (address(stratoToken) == address(0)) return;
        _syncFees();
        if (lastProcessedBlock != block.number) {
            // Read the parent's proposal facts before latching. They resolve the
            // parent's BlockSummary out of node-local storage and are the only part
            // of this that can throw; the fee path catches that, and a SolidVM catch
            // does not roll back, so latching first would leave the block marked
            // processed with nothing counted and no way for a later transaction to
            // retry. Everything after this point is local writes plus _jail's
            // already-guarded sync.
            address actual = block.prevProposer;
            address intended = block.prevIntendedProposer;
            // Latch before _processPrevBlock, not after: _jail calls out to the
            // AdminRegistry, and a reentrant processBlock must not count twice.
            lastProcessedBlock = block.number;
            _processPrevBlock(actual, intended);
        }
    }

    // Attribute any USDST received since the last call to the current block's proposer.
    function _syncFees() internal {
        uint256 balance = 0;
        try usdstToken.balanceOf(address(this)) returns (uint256 b) {
            balance = b;
        } catch {
            return;
        }
        if (balance <= trackedUsdst) return;
        uint256 received = balance - trackedUsdst;
        trackedUsdst = balance;

        address proposer = block.proposer;
        address operator = operatorOf[proposer];
        if (operator == address(0) || !operators[operator].exists) {
            unattributedFees += received;
            emit UnattributedFees(proposer, received);
            return;
        }
        _creditFees(operator, received);
        totalFeesCredited += received;
        emit FeesCredited(operator, proposer, received);
    }

    // Record who proposed the previous block and whether its intended proposer
    // (the one selected for the round the height started at) missed. A miss is
    // consensus-derived but not cryptographically attributable (a round change
    // carries no signed "missed" evidence), so it only costs the block's fees,
    // feeds the dashboard and — optionally — a temporary jail. No tokens move.
    function _processPrevBlock(address actual, address intended) internal {
        if (actual != address(0)) {
            blocksProposed[actual] += 1;
            consecutiveMisses[actual] = 0;
        }
        if (intended == address(0) || intended == actual) return;

        missedProposals[intended] += 1;
        consecutiveMisses[intended] += 1;
        emit ProposalMissed(intended, operatorOf[intended], block.number - 1);

        if (maxConsecutiveMisses > 0 && consecutiveMisses[intended] >= maxConsecutiveMisses) {
            _jail(operatorOf[intended], intended);
        }
    }

    // Take the operator out of the validator set until jailedUntil; stake is untouched.
    function _jail(address operator, address validator) internal {
        if (operator == address(0)) return;
        consecutiveMisses[validator] = 0;
        jailedUntil[operator] = block.timestamp + jailCooldown;
        emit ValidatorJailed(operator, validator, jailedUntil[operator]);
        _trySyncValidator(operator);
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

    // Proposer fees (USDST) have their own claim path, separate from STRATO rewards.
    function claimFeeRewards(address[] calldata claimOperators) external onlyInitialized {
        require(claimOperators.length > 0 && claimOperators.length <= maxBatchSize, "SS: bad batch");

        address user = msg.sender;
        uint256 totalFees = 0;
        for (uint256 i = 0; i < claimOperators.length; i++) {
            address operator = claimOperators[i];
            _updateGlobalRewards();
            _updateUser(user, operator);

            uint256 fees = pendingDelegatorFees[user][operator];
            if (fees > 0) {
                pendingDelegatorFees[user][operator] = 0;
                totalFees += fees;
            }
        }

        require(totalFees > 0, "SS: no fees");
        _payFees(user, totalFees);
        emit DelegatorFeesClaimed(user, totalFees);
    }

    function claimOperatorFeeRewards() external onlyInitialized onlyOperator(msg.sender) {
        address operator = msg.sender;
        StakingOperator storage v = operators[operator];
        uint256 fees = v.pendingSelfBondFees + v.pendingFeeCommission;
        require(fees > 0, "SS: no fees");

        v.pendingSelfBondFees = 0;
        v.pendingFeeCommission = 0;
        _payFees(operator, fees);
        emit OperatorFeesClaimed(operator, fees);
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

    // Fees attributed to a proposer without a registered operator are held for governance.
    function recoverUnattributedFees(address to, uint256 amount) external onlyOwner onlyInitialized {
        require(to != address(0), "SS: to=0");
        require(amount <= unattributedFees, "SS: unattributed unavailable");
        unattributedFees -= amount;
        _payFees(to, amount);
        emit UnattributedFeesRecovered(to, amount);
    }

    function recoverStrayToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "SS: to=0");
        require(token != address(stratoToken), "SS: use reserve recovery");
        require(token != address(usdstToken), "SS: use fee recovery");

        require(IERC20(token).transfer(to, amount), "SS: recover failed");
        emit StrayTokenRecovered(token, to, amount);
    }
}
