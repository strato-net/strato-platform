import "../Tokens/Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./ValidatorRegistry.sol";
import "./IStakingGovernance.sol";

// Staking accounting for STRATO validators, keyed by validator (consensus node) address.
// ValidatorRegistry owns listing and the validator -> operator binding; this contract tracks
// stake and rewards per validator, publishes stake weights to governance (consensus proposer
// selection and voting) and keeps liveness counters.
//
// The rules below are the network's commitment, not configuration: the self-bond minimum,
// the seven-day notices, the readiness trial, the liveness limit, the per-block churn bound
// and the emission formula are constants, the emission schedule is committed once, and no
// owner call can pause, redirect, recover or rewrite what the schedule owes. Changing any of
// them is a logic upgrade under the network's extraordinary process.
//
// Income. A validator earns for the blocks it produces and the network finalises
// (block.prevProposer, paid once per block from processBlock): the emission schedule releases
// E = E0 * sqrt(S / S0) * (R / R0) STRATO a year, S the stake behind the eligible consensus
// set and R the reserve still unreleased, and each finalised block earns the producer the
// release for the interval since the previous block, capped at MAX_CREDITED_GAP_SECONDS.
// Stake already decided who proposes, so the payment is not weighted by stake again; a gap
// beyond the cap stays in the reserve and only raises R for later blocks. Discretionary
// rewards (distributeRewards / distributeRewardsTo, anyone, any token) are the other income.
// STRATO and USDST income is split pro rata between the operator's qualified self-bond and the
// qualified delegated stake, delegators net of commission through a per-stake index; other
// tokens go wholly to the operator. Nothing here seizes tokens.
//
// Qualification. A position (a delegation or a self-bond) earns only once it has been in
// place for NOTICE_SECONDS; a top-up moves its clock forward in proportion. Stake that is not
// yet qualified carries its full voting weight but takes no income, so capital cannot chase a
// predictable proposer: the week it waits costs more than the luck it could buy.
//
// The flat block reward and the proposer fee share are gone: FeeRouter's creditBlockReward
// and proposerFeeBps calls find no such functions here and, by the router's own design,
// pay nothing and route the whole fee to the fee sink. Gas pays for the network.
//
// Validator lifecycle (status is derived, not stored):
//   Missing    = no record
//   Registered = listed, not in the consensus set (may receive stake)
//   Active     = in the consensus set (explicit tryActivate / reconcileSet; room or eviction)
//   Kicked     = delisted by the registry (self-bond released to the operator)
// Joining needs the self-bond minimum, the readiness trial (acknowledgements from the
// validator key spanning READINESS_TRIAL_SECONDS with no gap over READINESS_WINDOW_SECONDS)
// and open admission (joinsOpenFromBlock). A seat held since before this logic keeps the
// rule it was admitted under (self-bond plus delegations) until the validator leaves the set
// or changes operator. Every change to the set or to a seated validator's weight must leave
// the resulting set able to finalise on fresh acknowledgements (READY_WEIGHT_BPS of its
// weight ready) or must not lower that share; otherwise it is deferred (the call reverts).
//
// Upgraded in place from an operator-keyed layout that also paid a funded reward schedule.
// SolidVM storage is keyed by name, so historical names are kept (operators, operatorList,
// isValidator, ...) and every one of them is keyed by validator. A record written before
// the switch has no operator field and its key is its operator. The retired schedule's final
// indexes are settled once per record by _settleRetiredSchedule and are otherwise dead.
struct StakingValidator {
    bool exists;
    bool active;
    address operator;
    uint256 commissionBps;
    uint256 selfBond;
    uint256 delegatedStake;
    // STRATO income: the operator's part accrues here, delegators' through the index.
    uint256 delegatorRewardPerStakeStored;
    uint256 pendingSelfBondRewards;
    uint256 pendingCommission;
    // USDST income, split the same way.
    uint256 feePerStakeStored;
    uint256 pendingSelfBondFees;
    uint256 pendingFeeCommission;
    // Retired reward schedule checkpoints (see _settleRetiredSchedule).
    uint256 stakeRewardPerTokenPaid;
    uint256 baseRewardPerOperatorPaid;
    uint256 pendingBaseRewards;
}

// Requests written by the previous logic, which held principal for a period. Principal is
// now paid out at once; this queue only remains so those requests can still be withdrawn.
struct StakingUnbondRequest {
    uint256 amount;
    uint256 releaseTime;
    bool claimed;
}

contract  StratoStaking is Ownable {
    event Initialized(address indexed stratoToken, uint256 maxCommissionBps);
    event UsdstTokenSet(address indexed usdstToken, uint256 trackedFrom);
    event ValidatorRegistrySet(address indexed validatorRegistry);
    event GovernanceSet(address indexed governance);
    event SetParamsUpdated(uint256 maxActiveValidators, uint256 hardCapActiveValidators);
    event JoinsOpenFromBlockSet(uint256 blockNumber);
    event EmissionScheduleCommitted(uint256 e0, uint256 s0, uint256 r0, uint256 startTime);
    event RewardReserveFunded(address indexed funder, uint256 amount, uint256 reserve);
    event RewardReserveReconciled(uint256 reserve);
    event ProductionRewarded(address indexed validator, uint256 amount, uint256 elapsed, uint256 stake, uint256 reserve);
    event ParamsUpdated(uint256 maxCommissionBps, uint256 maxBatchSize);
    event ValidatorRecordSynced(address indexed validator, address indexed operator, bool active, uint256 commissionBps);
    event OperatorChangeAnnounced(address indexed validator, address indexed oldOperator, address indexed newOperator, uint256 readyTime);
    event OperatorChangeCancelled(address indexed validator, address indexed newOperator);
    event OperatorChanged(address indexed validator, address indexed oldOperator, address indexed newOperator);
    event ValidatorSetIndexed(uint256 count);
    event ValidatorEvicted(address indexed operator, address indexed validator, address indexed by);
    event ValidatorExited(address indexed operator, address indexed validator);
    event ValidatorRemovedForLiveness(address indexed validator, uint256 missedProposals, uint256 reentryTime);
    event ReadinessAcknowledged(address indexed validator, uint256 readySince, uint256 readyAt);
    // Shape and emission pattern are relied on by the node's stake-event parser (Delta.hs).
    event ValidatorSynced(address indexed operator, address indexed validator, bool registered, uint256 weight);
    event DiscretionaryRewardCredited(address indexed operator, address indexed validator, address indexed token, address funder, uint256 amount);
    event OperatorTokenRewardsClaimed(address indexed operator, address indexed token, uint256 amount);
    event ProposalMissed(address indexed validator, address indexed operator, uint256 blockNumber);
    event CommissionUpdated(address indexed validator, uint256 oldCommissionBps, uint256 newCommissionBps);
    event CommissionIncreaseAnnounced(address indexed validator, uint256 newCommissionBps, uint256 readyTime);
    event Staked(address indexed user, address indexed validator, uint256 amount);
    event StakeMoved(address indexed user, address indexed fromValidator, address indexed toValidator, uint256 amount);
    event Unstaked(address indexed user, address indexed validator, uint256 amount);
    event StakeQualified(address indexed user, address indexed validator, uint256 amount);
    event UnbondedWithdrawn(address indexed user, uint256 amount);
    event SelfBonded(address indexed operator, address indexed validator, uint256 amount);
    event SelfBondReleased(address indexed operator, address indexed validator, uint256 amount);
    event SelfBondQualified(address indexed validator, uint256 amount);
    event DelegatorRewardsClaimed(address indexed user, uint256 amount);
    event OperatorRewardsClaimed(address indexed operator, address indexed validator, uint256 amount);
    event DelegatorFeesClaimed(address indexed user, uint256 amount);
    event OperatorFeesClaimed(address indexed operator, address indexed validator, uint256 amount);

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public constant YEAR = 31536000; // 365 days

    // ---- the commitment ------------------------------------------------------------------
    // Self-bond a validator needs to join or rejoin the set, in the operator's own STRATO.
    uint256 public constant MIN_SELF_BOND = 10000e18;
    // Seven days: notice before a commission raise or an operator handover, the time a new
    // position waits before it earns, the readiness trial, and the wait before a removed
    // validator may be listed or seated again.
    uint256 public constant NOTICE_SECONDS = 604800;
    // A readiness acknowledgement (or a finalised proposal) is evidence for a day.
    uint256 public constant READINESS_WINDOW_SECONDS = 86400;
    // Share of the resulting set's weight that must be ready before a change goes through.
    uint256 public constant READY_WEIGHT_BPS = 7500;
    // Longest interval one finalised block is paid for; the rest of a gap stays in reserve.
    uint256 public constant MAX_CREDITED_GAP_SECONDS = 3600;
    // Consecutive missed proposals that let anyone remove a validator from the set.
    uint256 public constant LIVENESS_MISS_LIMIT = 20;
    // Ordinary membership changes per block; a replacement counts as two.
    uint256 public constant MAX_SET_MUTATIONS_PER_BLOCK = 2;
    // A waiter must beat the lowest validator's bonded stake by this margin to replace it.
    uint256 public constant EVICTION_MARGIN_BPS = 500;

    Token public stratoToken;
    IERC20 public usdstToken;
    ValidatorRegistry public validatorRegistry;

    // Consensus integration. Governance (MercataGovernance, genesis address 0x100) is
    // what republishes weights as ValidatorStakeUpdated for consensus to read; it
    // authorises this contract through its stakingContract / onlyStaking pair. The link
    // is wired once (setGovernance) and has no off switch.
    address public governance;
    bool public governanceSyncEnabled;

    // Consensus set size.
    uint256 public maxActiveValidators;     // admin-chosen size of the active set
    uint256 public hardCapActiveValidators; // never exceeded (the node has a matching binary cap)
    uint256 public joinsOpenFromBlock;      // first block of permissionless activation (0 = not yet agreed)
    uint256 public validatorCount;
    uint256 public mutationBlock;
    uint256 public setMutationsThisBlock;
    // When a validator was delisted; it may be listed again NOTICE_SECONDS later.
    mapping(address => uint256) public  kickedAt;
    mapping(address => bool) public  isValidator;
    mapping(address => uint256) public  lastSyncedWeight;
    // After a liveness removal, the validator may be seated again from this time.
    mapping(address => uint256) public  jailedUntil;
    // The consensus set itself, so set-wide passes are bounded by the set, not by how many
    // validators have ever been listed. activeValidatorIndex is 1-based; 0 = not indexed.
    address[] public activeValidators;
    mapping(address => uint256) public  activeValidatorIndex;
    // Set by _seat, so a seat that predates this logic reads false: an incumbent keeps
    // qualifying on self-bond plus delegations until it leaves the set or changes operator.
    mapping(address => bool) public  seatedUnderSelfBondRule;

    // Readiness: the last acknowledgement by the validator key (or finalised proposal), and
    // the start of the unbroken run of them.
    mapping(address => uint256) public  readyAt;
    mapping(address => uint256) public  readySince;

    // Liveness, derived from block.prev*.
    mapping(address => uint256) public  blocksProposed;
    mapping(address => uint256) public  missedProposals;
    mapping(address => uint256) public  consecutiveMisses;

    // USDST income (discretionary rewards; proposer fees are history) and its claim path.
    uint256 public trackedUsdst;
    uint256 public lastProcessedBlock;
    mapping(address => mapping(address => uint256)) public  userFeePerStakePaid;
    mapping(address => mapping(address => uint256)) public  pendingDelegatorFees;

    uint256 public maxCommissionBps;
    uint256 public maxBatchSize;

    uint256 public totalUserStake;
    uint256 public totalSelfBond;
    uint256 public totalUnbonding;
    uint256 public totalRewardableStake;

    // STRATO credited as rewards and not yet claimed; kept out of untracked STRATO.
    uint256 public allocatedRewardLiability;

    // Emission schedule, committed once. The reserve is never recoverable and claims never
    // dip into it: it only ever moves into allocatedRewardLiability as blocks are produced.
    uint256 public rewardReserve;
    uint256 public emissionRateE0;
    uint256 public emissionStakeS0;
    uint256 public emissionReserveR0;
    uint256 public emissionStartTime;
    uint256 public totalEmitted;
    // Timestamps of the last two blocks processBlock saw: the parent block is paid for the
    // interval between them.
    uint256 public lastBlockTime;
    uint256 public previousBlockTime;

    // Qualification. A self-bond or delegation that is still waiting is held here in full;
    // what earns is the position less this amount. The clock is the weighted average time the
    // position's STRATO was placed.
    mapping(address => uint256) public  unqualifiedSelfBond;
    mapping(address => uint256) public  selfBondSince;
    mapping(address => uint256) public  unqualifiedDelegatedStake;
    mapping(address => mapping(address => uint256)) public  unqualifiedStake;
    mapping(address => mapping(address => uint256)) public  stakedSince;

    // Discretionary rewards in tokens other than STRATO and USDST, owed to operators:
    // operator => token => amount. Keyed by the operator account rather than the validator, so
    // a later change of operator never hands accrued rewards to the successor.
    mapping(address => mapping(address => uint256)) public  pendingOperatorTokenRewards;
    // Unclaimed discretionary rewards per token.
    mapping(address => uint256) public  tokenRewardLiability;

    // Final indexes of the retired reward schedule. Frozen; read only by _settleRetiredSchedule.
    uint256 public baseRewardPerOperatorStored;
    uint256 public globalStakeRewardPerTokenStored;

    // An operator's announced commission raise and when it may be applied (0 = none).
    mapping(address => uint256) public  announcedCommissionBps;
    mapping(address => uint256) public  announcedCommissionTime;

    // A handover the registry has bound with the validator key's consent: the incoming
    // operator and when it may complete it (0 = none).
    mapping(address => address) public  pendingOperator;
    mapping(address => uint256) public  operatorChangeReadyTime;

    // Every validator ever listed, and its record.
    address[] public  operatorList;
    mapping(address => StakingValidator) public  operators;

    // user => validator => amount / index checkpoints.
    mapping(address => mapping(address => uint256)) public  delegatedStake;
    mapping(address => mapping(address => uint256)) public  userRewardPerStakePaid;
    mapping(address => mapping(address => uint256)) public  pendingDelegatorRewards;
    mapping(address => mapping(uint256 => StakingUnbondRequest)) public  unbondingQueue;
    mapping(address => uint256) public  unbondingRequestCount;

    constructor(address initialOwner) Ownable(initialOwner) { }

    function initialize(
        address _stratoToken,
        address _usdstToken,
        uint256 _maxCommissionBps,
        uint256 _maxBatchSize
    ) external onlyOwner {
        require(address(stratoToken) == address(0), "SS: initialized");
        require(_stratoToken != address(0), "SS: token=0");
        require(_usdstToken != address(0), "SS: usdst=0");
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");

        stratoToken = Token(_stratoToken);
        usdstToken = IERC20(_usdstToken);
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;

        // Today's consensus envelope; admission opens when a block is agreed.
        maxActiveValidators = 50;
        hardCapActiveValidators = 50;

        emit Initialized(_stratoToken, _maxCommissionBps);
    }

    modifier onlyInitialized() {
        require(address(stratoToken) != address(0), "SS: not initialized");
        _;
    }

    modifier onlyListed(address validator) {
        require(operators[validator].exists, "SS: validator missing");
        _;
    }

    modifier onlyOperatorOf(address validator) {
        require(operators[validator].exists, "SS: validator missing");
        require(msg.sender == operatorOf(validator), "SS: not operator");
        _;
    }

    modifier onlyValidatorRegistry() {
        require(msg.sender == address(validatorRegistry), "SS: registry only");
        _;
    }

    function recordCount() external view returns (uint256) {
        return operatorList.length;
    }

    function activeValidatorCount() external view returns (uint256) {
        return activeValidators.length;
    }

    // The self-bond minimum, as a function so a test harness can scale it.
    function minStake() public view virtual returns (uint256) {
        return MIN_SELF_BOND;
    }

    function operatorOf(address validator) public view returns (address) {
        StakingValidator storage v = operators[validator];
        if (!v.exists) return address(0);
        return v.operator == address(0) ? validator : v.operator;
    }

    // USDST joined the income path after this contract was already live, so a deployment
    // upgraded in place can never reach it through initialize(). Any balance already held
    // is owed to nobody and stays untracked.
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

    // Wire the governance link, once. Wiring resyncs the consensus set so governance learns
    // its current weights. There is no way to switch the link off: governance is the
    // authoritative record of who votes with what, and nobody may take it out of step.
    function setGovernance(address _governance) external onlyOwner onlyInitialized {
        require(!governanceSyncEnabled, "SS: governance wired");
        require(_governance != address(0), "SS: governance=0");
        governance = _governance;
        governanceSyncEnabled = true;
        emit GovernanceSet(_governance);
        _syncAllValidators();
    }

    function setSetParams(uint256 _maxActiveValidators, uint256 _hardCapActiveValidators) external onlyOwner onlyInitialized {
        // Unset (0) means the cap was never written; only-lowers applies once set.
        require(_hardCapActiveValidators > 0 && (hardCapActiveValidators == 0 || _hardCapActiveValidators <= hardCapActiveValidators), "SS: hard cap only lowers");
        require(_maxActiveValidators > 0 && _maxActiveValidators <= _hardCapActiveValidators, "SS: max above hard cap");

        maxActiveValidators = _maxActiveValidators;
        hardCapActiveValidators = _hardCapActiveValidators;
        emit SetParamsUpdated(_maxActiveValidators, _hardCapActiveValidators);
    }

    // The agreed block from which anyone may seat an eligible, ready validator. Voted ahead
    // of the height and movable until it passes; once admission is open it stays open.
    function setJoinsOpenFromBlock(uint256 _joinsOpenFromBlock) external onlyOwner onlyInitialized {
        require(joinsOpenFromBlock == 0 || block.number < joinsOpenFromBlock, "SS: joins already open");
        require(_joinsOpenFromBlock > block.number, "SS: block passed");
        joinsOpenFromBlock = _joinsOpenFromBlock;
        emit JoinsOpenFromBlockSet(_joinsOpenFromBlock);
    }

    // The commission ceiling applies where commission is charged, which is when income is
    // credited; income already credited keeps the split it was credited at.
    function setParams(uint256 _maxCommissionBps, uint256 _maxBatchSize) external onlyOwner onlyInitialized {
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");

        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;
        emit ParamsUpdated(_maxCommissionBps, _maxBatchSize);
    }

    // ---- consensus validator lifecycle -------------------------------------------

    function _validatorWeight(StakingValidator storage v) internal view returns (uint256) {
        return v.selfBond + v.delegatedStake;
    }

    // The self-bond minimum, in the operator's own STRATO. A seat held since before this
    // logic was admitted on self-bond plus delegations and keeps that rule while it lasts.
    function _meetsMinStake(address validator, StakingValidator storage v) internal view returns (bool) {
        if (isValidator[validator] && !seatedUnderSelfBondRule[validator]) {
            return _validatorWeight(v) >= minStake();
        }
        return v.selfBond >= minStake();
    }

    // 0 = Missing, 1 = Registered, 2 = Active, 3 = Kicked
    function status(address validator) public view returns (uint8) {
        StakingValidator storage v = operators[validator];
        if (!v.exists) return 0;
        if (!v.active) return 3;
        if (isValidator[validator]) return 2;
        return 1;
    }

    // Eligible to be (or stay) a consensus validator: listed, meets the self-bond minimum,
    // past any liveness reentry wait.
    function eligible(address validator) public view returns (bool) {
        StakingValidator storage v = operators[validator];
        if (!v.exists || !v.active) return false;
        return _meetsMinStake(validator, v) && block.timestamp >= jailedUntil[validator];
    }

    // Fresh evidence of operation: an acknowledgement or a finalised proposal within the window.
    function isReady(address validator) public view returns (bool) {
        return readyAt[validator] > 0 && readyAt[validator] + READINESS_WINDOW_SECONDS >= block.timestamp;
    }

    // The trial: fresh evidence at the end of an unbroken run of it at least NOTICE_SECONDS long.
    function readyForAdmission(address validator) public view returns (bool) {
        return isReady(validator) && readyAt[validator] - readySince[validator] >= NOTICE_SECONDS;
    }

    // A waiter is eligible, ready and not in the set; promotion is explicit.
    function isWaiter(address validator) public view returns (bool) {
        return eligible(validator) && !isValidator[validator] && readyForAdmission(validator);
    }

    // Voting weight of the consensus set. Stake behind listed validators outside the set
    // carries no vote.
    function consensusWeight() public view returns (uint256 total) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            total += _validatorWeight(operators[activeValidators[i]]);
        }
    }

    // The set's weight and the part of it with fresh readiness evidence.
    function readyWeight() public view returns (uint256 total, uint256 ready) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            address validator = activeValidators[i];
            uint256 w = _validatorWeight(operators[validator]);
            total += w;
            if (isReady(validator)) ready += w;
        }
    }

    // A set that can finalise on its ready members alone, with READY_WEIGHT_BPS of its
    // weight ready: strictly more than two thirds, plus the cushion.
    function _isSafe(uint256 total, uint256 ready) internal pure returns (bool) {
        if (total == 0) return true;
        return 3 * ready > 2 * total && ready * BPS_DIVISOR >= total * READY_WEIGHT_BPS;
    }

    // Every change to the set or to a seated validator's weight passes through here with
    // the weights it started from: the resulting set must be safe, or the change must not
    // have lowered the ready share. Removing an unready validator always passes; taking
    // weight or members out of a set that is already short of ready weight is deferred.
    function _requireNotLessSafe(uint256 totalBefore, uint256 readyBefore) internal view {
        (uint256 total, uint256 ready) = readyWeight();
        if (_isSafe(total, ready)) return;
        require(ready * totalBefore >= readyBefore * total, "SS: unsafe transition");
    }

    function effectiveCap() public view returns (uint256) {
        // Zero-valued params read as unset (an upgraded proxy has no storage for fields
        // the old code never wrote); default to a 50-slot set.
        uint256 h = hardCapActiveValidators == 0 ? 50 : hardCapActiveValidators;
        uint256 a = maxActiveValidators == 0 ? h : maxActiveValidators;
        return a < h ? a : h;
    }

    function _mutationsLeft() internal view returns (uint256) {
        if (mutationBlock != block.number) return MAX_SET_MUTATIONS_PER_BLOCK;
        if (setMutationsThisBlock >= MAX_SET_MUTATIONS_PER_BLOCK) return 0;
        return MAX_SET_MUTATIONS_PER_BLOCK - setMutationsThisBlock;
    }

    function _consumeMutations(uint256 n) internal {
        if (mutationBlock != block.number) {
            mutationBlock = block.number;
            setMutationsThisBlock = 0;
        }
        require(setMutationsThisBlock + n <= MAX_SET_MUTATIONS_PER_BLOCK, "SS: mutation cap");
        setMutationsThisBlock += n;
    }

    // Paired so every path that moves isValidator also moves validatorCount, the weight
    // cache and the set index.
    function _seat(address validator, uint256 weight) internal {
        isValidator[validator] = true;
        seatedUnderSelfBondRule[validator] = true;
        lastSyncedWeight[validator] = weight;
        validatorCount += 1;
        if (activeValidatorIndex[validator] == 0) {
            activeValidators.push(validator);
            activeValidatorIndex[validator] = activeValidators.length;
        }
    }

    function _unseat(address validator) internal {
        isValidator[validator] = false;
        lastSyncedWeight[validator] = 0;
        validatorCount -= 1;

        uint256 j = activeValidatorIndex[validator];
        if (j == 0) return;
        uint256 last = activeValidators.length;
        if (j != last) {
            address moved = activeValidators[last - 1];
            activeValidators[j - 1] = moved;
            activeValidatorIndex[moved] = j;
        }
        activeValidators[last - 1] = address(0);
        activeValidators.length--;
        activeValidatorIndex[validator] = 0;
    }

    // One-time backfill for a proxy upgraded in place, whose consensus set predates
    // activeValidators. Permissionless and idempotent: it only indexes validators that
    // isValidator already records. Until it runs, set-wide passes see no members, which
    // fails safe (no resync, no eviction), and a member not yet indexed earns nothing for
    // the blocks it produces.
    function indexValidatorSet(address[] calldata validators) external onlyInitialized {
        for (uint256 i = 0; i < validators.length; i++) {
            address validator = validators[i];
            if (isValidator[validator] && activeValidatorIndex[validator] == 0) {
                activeValidators.push(validator);
                activeValidatorIndex[validator] = activeValidators.length;
            }
        }
        emit ValidatorSetIndexed(activeValidators.length);
    }

    function _activate(address validator) internal {
        uint256 weight = _validatorWeight(operators[validator]);
        // Straight to governance: it is the staking contract's own call (the
        // onlyStaking modifier authorises us), and it is what publishes the
        // weight as ValidatorStakeUpdated from 0x100. addValidatorFromStaking
        // already tolerates a validator that is in the set but not yet
        // staking-managed, which is how the genesis validators arrive.
        IStakingGovernance(governance).addValidatorFromStaking(validator, weight);
        _seat(validator, weight);
        emit ValidatorSynced(operatorOf(validator), validator, true, weight);
    }

    // Governance refuses to drop its last validator, and reports that by returning false
    // rather than reverting; the validator then stays registered.
    function _deactivate(address validator) internal returns (bool) {
        bool removed = IStakingGovernance(governance).removeValidatorFromStaking(validator);
        if (removed) {
            _unseat(validator);
            emit ValidatorSynced(operatorOf(validator), validator, false, 0);
        }
        return removed;
    }

    // Keep governance in step with a validator already in the set: leave when no longer
    // eligible (same transaction, counts as a set mutation), refresh the weight otherwise.
    // With this block's mutation budget spent, a validator that should leave keeps its
    // seat until a later sync: failing instead would block the unstake that got here. It
    // earns nothing while it waits. Joining is never implicit.
    function _syncValidator(address validator) internal {
        if (!governanceSyncEnabled || !isValidator[validator]) return;
        // Governance decides who is in the consensus set. A validator it no longer
        // lists (an admin vote removed it) gives up its seat here: adding it back
        // would undo the vote, and anyone can trigger a sync.
        if (IStakingGovernance(governance).validatorMap(validator) == 0) {
            _unseat(validator);
            emit ValidatorSynced(operatorOf(validator), validator, false, 0);
            return;
        }
        if (!eligible(validator) && _mutationsLeft() > 0) {
            _consumeMutations(1);
            _deactivate(validator);
            return;
        }
        uint256 weight = _validatorWeight(operators[validator]);

        // Publish unconditionally. lastSyncedWeight is only this contract's guess
        // at what governance holds, and a guess is exactly how governance ended up
        // holding no stakes at all: the pre-upgrade logic maintained the cache
        // without ever calling governance, so the cache reported "already synced"
        // forever after. Governance is the authority on what governance knows, and
        // setValidatorStake drops a no-op without emitting, so republishing costs
        // one call and never a spurious ValidatorStakeUpdated.
        //
        // addValidatorFromStaking rather than updateValidatorStake: governance lists
        // the validator at this point, so nothing is added, and it also marks the
        // validator staking-managed, which removeValidatorFromStaking requires (the
        // genesis validators arrive unmanaged).
        IStakingGovernance(governance).addValidatorFromStaking(validator, weight);

        // ValidatorSynced stays change-gated: consensus consumes it as a delta
        // before the switch height, so its emission pattern must not change.
        if (lastSyncedWeight[validator] != weight) {
            lastSyncedWeight[validator] = weight;
            emit ValidatorSynced(operatorOf(validator), validator, true, weight);
        }
    }

    // Lowest validator by (weight asc, address asc): the eviction candidate.
    function _lowestValidator() internal view returns (address lowest, uint256 lowestWeight) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            address validator = activeValidators[i];
            uint256 w = _validatorWeight(operators[validator]);
            if (lowest == address(0) || w < lowestWeight || (w == lowestWeight && uint256(validator) < uint256(lowest))) {
                lowest = validator;
                lowestWeight = w;
            }
        }
    }

    // Best waiter among `candidates` by (weight desc, address asc): the promotion candidate.
    function _bestWaiter(address[] memory candidates) internal view returns (address best, uint256 bestWeight) {
        for (uint256 i = 0; i < candidates.length; i++) {
            address validator = candidates[i];
            if (!isWaiter(validator)) continue;
            uint256 w = _validatorWeight(operators[validator]);
            if (best == address(0) || w > bestWeight || (w == bestWeight && uint256(validator) < uint256(best))) {
                best = validator;
                bestWeight = w;
            }
        }
    }

    // Admission is open to everyone from the agreed block, and to nobody before it.
    function _requireJoinsOpen() internal view {
        require(joinsOpenFromBlock != 0 && block.number >= joinsOpenFromBlock, "SS: joins not open");
        require(governanceSyncEnabled, "SS: governance sync off");
    }

    // Put an eligible, ready validator into the consensus set: into a free slot, or by
    // replacing the lowest validator it beats by EVICTION_MARGIN_BPS. Anyone may call.
    function tryActivate(address validator) external onlyInitialized onlyListed(validator) {
        _requireJoinsOpen();
        require(!isValidator[validator], "SS: already active");
        require(eligible(validator), "SS: not eligible");
        require(readyForAdmission(validator), "SS: readiness trial incomplete");
        (uint256 total, uint256 ready) = readyWeight();

        if (validatorCount < effectiveCap()) {
            _consumeMutations(1);
            _activate(validator);
        } else {
            (address lowest, uint256 lowestWeight) = _lowestValidator();
            uint256 weight = _validatorWeight(operators[validator]);
            require(lowest != address(0) && weight * BPS_DIVISOR >= lowestWeight * (BPS_DIVISOR + EVICTION_MARGIN_BPS), "SS: set full");
            _consumeMutations(2);
            require(_deactivate(lowest), "SS: cannot evict");
            emit ValidatorEvicted(operatorOf(lowest), lowest, validator);
            _activate(validator);
        }
        _requireNotLessSafe(total, ready);
    }

    // Fill free slots with the best waiters among `candidates`, as far as this block's
    // mutation budget allows. The caller names the candidates (an indexer's list of waiters,
    // say), so the work is bounded by the call rather than by every validator ever listed.
    // Seating a ready validator never lowers the set's ready share, so no safety check.
    function reconcileSet(address[] calldata candidates) external onlyInitialized {
        _requireJoinsOpen();
        require(candidates.length <= maxBatchSize, "SS: bad batch");
        uint256 cap = effectiveCap();
        while (validatorCount < cap) {
            if (_mutationsLeft() == 0) break;
            (address best,) = _bestWaiter(candidates);
            if (best == address(0)) break;
            _consumeMutations(1);
            _activate(best);
        }
    }

    // A validator key reports that its node is up and in sync. Acknowledgements must come
    // from the key itself; a finalised proposal counts as one too (_processPrevBlock). An
    // acknowledgement later than the window after the previous one starts a new run.
    function acknowledgeReadiness() external onlyInitialized {
        StakingValidator storage v = operators[msg.sender];
        require(v.exists && v.active, "SS: validator missing");
        _recordReady(msg.sender, true);
    }

    function _recordReady(address validator, bool announce) internal {
        if (readyAt[validator] == 0 || readyAt[validator] + READINESS_WINDOW_SECONDS < block.timestamp) {
            readySince[validator] = block.timestamp;
        }
        readyAt[validator] = block.timestamp;
        if (announce) emit ReadinessAcknowledged(validator, readySince[validator], block.timestamp);
    }

    // An operator takes its validator out of the set, at once if the set can spare it.
    // Self-bond stays bonded until it is unbonded. The last validator cannot leave this way:
    // governance keeps it, and its departure is the network's to coordinate.
    function exit(address validator) external onlyInitialized onlyOperatorOf(validator) {
        require(isValidator[validator], "SS: not active");
        require(governanceSyncEnabled, "SS: governance sync off");
        (uint256 total, uint256 ready) = readyWeight();
        _consumeMutations(1);
        require(_deactivate(validator), "SS: last validator");
        emit ValidatorExited(msg.sender, validator);
        _requireNotLessSafe(total, ready);
    }

    // Evidence-based removal, open to anyone: a validator that has missed
    // LIVENESS_MISS_LIMIT proposals in a row leaves the set and may be seated again after
    // NOTICE_SECONDS, with a fresh readiness trial. Stake is untouched.
    function removeForMissedProposals(address validator) external onlyInitialized onlyListed(validator) {
        require(isValidator[validator], "SS: not active");
        require(consecutiveMisses[validator] >= LIVENESS_MISS_LIMIT, "SS: liveness evidence short");
        require(governanceSyncEnabled, "SS: governance sync off");
        (uint256 total, uint256 ready) = readyWeight();
        _consumeMutations(1);
        require(_deactivate(validator), "SS: last validator");
        jailedUntil[validator] = block.timestamp + NOTICE_SECONDS;
        emit ValidatorRemovedForLiveness(validator, consecutiveMisses[validator], jailedUntil[validator]);
        consecutiveMisses[validator] = 0;
        _requireNotLessSafe(total, ready);
    }

    // Walks the set from the end: a removal swaps the last member into the removed slot,
    // and walking backwards means that member has already been visited.
    function _syncAllValidators() internal {
        uint256 i = activeValidators.length;
        while (i > 0) {
            i -= 1;
            _syncValidator(activeValidators[i]);
        }
    }

    // Governance decides the set, and an admin vote removes a validator without telling
    // staking. Once per block, every seated validator governance no longer lists gives up
    // its seat the way a sync would. Walks from the end for the reason _syncAllValidators does.
    function _reconcileGovernanceSet() internal {
        if (!governanceSyncEnabled) return;
        uint256 i = activeValidators.length;
        while (i > 0) {
            i -= 1;
            address validator = activeValidators[i];
            if (IStakingGovernance(governance).validatorMap(validator) != 0) continue;
            _unseat(validator);
            emit ValidatorSynced(operatorOf(validator), validator, false, 0);
        }
    }

    // Permissionless resync: a validator no longer eligible leaves, subject to the safety rule.
    function syncValidator(address validator) external onlyInitialized onlyListed(validator) {
        (uint256 total, uint256 ready) = readyWeight();
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    // ---- income accounting ---------------------------------------------------------

    function _commissionBps(StakingValidator storage v) internal view returns (uint256) {
        return v.commissionBps < maxCommissionBps ? v.commissionBps : maxCommissionBps;
    }

    function _qualifiedSelfBond(address validator, StakingValidator storage v) internal view returns (uint256) {
        return v.selfBond - unqualifiedSelfBond[validator];
    }

    function _qualifiedDelegatedStake(address validator, StakingValidator storage v) internal view returns (uint256) {
        return v.delegatedStake - unqualifiedDelegatedStake[validator];
    }

    // Delegators' gross share of some income: commission to the operator, the rest into the
    // per-stake index over the qualified delegated stake. With none there is nobody to share
    // with.
    function _creditDelegatorRewards(address validator, StakingValidator storage v, uint256 gross) internal {
        if (gross == 0) return;
        uint256 qualified = _qualifiedDelegatedStake(validator, v);
        if (qualified == 0) {
            v.pendingSelfBondRewards += gross;
            return;
        }
        uint256 commission = (gross * _commissionBps(v)) / BPS_DIVISOR;
        v.pendingCommission += commission;
        v.delegatorRewardPerStakeStored += ((gross - commission) * PRECISION) / qualified;
    }

    // STRATO income, split pro rata between qualified self-bond and qualified delegated
    // stake. False when nothing qualifies yet; the caller decides where the amount goes.
    function _creditRewards(address validator, StakingValidator storage v, uint256 amount) internal returns (bool) {
        uint256 selfBondQualified = _qualifiedSelfBond(validator, v);
        uint256 total = selfBondQualified + _qualifiedDelegatedStake(validator, v);
        if (total == 0) return false;
        uint256 selfBondShare = (amount * selfBondQualified) / total;
        v.pendingSelfBondRewards += selfBondShare;
        _creditDelegatorRewards(validator, v, amount - selfBondShare);
        return true;
    }

    // USDST income, split the same way.
    function _creditFees(address validator, StakingValidator storage v, uint256 amount) internal returns (bool) {
        uint256 selfBondQualified = _qualifiedSelfBond(validator, v);
        uint256 delegatedQualified = _qualifiedDelegatedStake(validator, v);
        uint256 total = selfBondQualified + delegatedQualified;
        if (total == 0) return false;

        uint256 selfBondFee = (amount * selfBondQualified) / total;
        uint256 delegatorGrossFee = amount - selfBondFee;

        v.pendingSelfBondFees += selfBondFee;
        if (delegatorGrossFee > 0 && delegatedQualified > 0) {
            uint256 commission = (delegatorGrossFee * _commissionBps(v)) / BPS_DIVISOR;
            v.pendingFeeCommission += commission;
            v.feePerStakeStored += ((delegatorGrossFee - commission) * PRECISION) / delegatedQualified;
        } else {
            v.pendingSelfBondFees += delegatorGrossFee;
        }
        return true;
    }

    // The retired reward schedule stopped at baseRewardPerOperatorStored and
    // globalStakeRewardPerTokenStored. A record still behind those indexes is owed what the
    // schedule already allocated to it (and counted in allocatedRewardLiability). Credit it
    // exactly as the schedule's own bookkeeping would have on the record's next touch, then
    // level the record so it can never be paid twice. New records start level. Runs before
    // anything that changes a record's stake or commission, since the owed amount depends
    // on both.
    function _settleRetiredSchedule(StakingValidator storage v) internal {
        uint256 baseIndex = baseRewardPerOperatorStored;
        uint256 stakeIndex = globalStakeRewardPerTokenStored;
        if (v.pendingBaseRewards == 0 && v.baseRewardPerOperatorPaid == baseIndex && v.stakeRewardPerTokenPaid == stakeIndex) return;

        uint256 operatorOwed = v.pendingBaseRewards;
        if (v.active) {
            if (baseIndex > v.baseRewardPerOperatorPaid) {
                operatorOwed += baseIndex - v.baseRewardPerOperatorPaid;
            }
            if (stakeIndex > v.stakeRewardPerTokenPaid) {
                uint256 stakeDelta = stakeIndex - v.stakeRewardPerTokenPaid;
                operatorOwed += (v.selfBond * stakeDelta) / PRECISION;
                uint256 delegatorGross = (v.delegatedStake * stakeDelta) / PRECISION;
                if (delegatorGross > 0 && v.delegatedStake > 0) {
                    uint256 commission = (delegatorGross * v.commissionBps) / BPS_DIVISOR;
                    v.pendingCommission += commission;
                    v.delegatorRewardPerStakeStored += ((delegatorGross - commission) * PRECISION) / v.delegatedStake;
                }
            }
        }
        v.pendingSelfBondRewards += operatorOwed;
        v.pendingBaseRewards = 0;
        v.baseRewardPerOperatorPaid = baseIndex;
        v.stakeRewardPerTokenPaid = stakeIndex;
    }

    // A self-bond that has waited its week starts earning on the record's next touch.
    function _refreshSelfBondQualification(address validator, StakingValidator storage v) internal {
        if (unqualifiedSelfBond[validator] == 0) return;
        if (selfBondSince[validator] + NOTICE_SECONDS > block.timestamp) return;
        unqualifiedSelfBond[validator] = 0;
        emit SelfBondQualified(validator, v.selfBond);
    }

    // Everything a record is owed up to now, before anything that changes its stake,
    // membership, commission or operator.
    function _settle(address validator, StakingValidator storage v) internal {
        _settleRetiredSchedule(v);
        _refreshSelfBondQualification(validator, v);
    }

    // Credit a delegator what its qualified stake earned since its checkpoint, then let a
    // position that has waited its week start earning from here. A position that is not
    // yet qualified has its checkpoints moved up without being credited, so the index it
    // missed can never be claimed later. Anyone may touch a position (qualifyStake).
    function _updateUser(address user, address validator) internal {
        StakingValidator storage v = operators[validator];
        if (v.exists) _settle(validator, v);

        uint256 amount = delegatedStake[user][validator];
        uint256 waiting = unqualifiedStake[user][validator];
        uint256 earning = amount - waiting;

        uint256 paid = userRewardPerStakePaid[user][validator];
        uint256 stored = v.delegatorRewardPerStakeStored;
        if (earning > 0 && stored > paid) {
            pendingDelegatorRewards[user][validator] += (earning * (stored - paid)) / PRECISION;
        }
        userRewardPerStakePaid[user][validator] = stored;

        uint256 feePaid = userFeePerStakePaid[user][validator];
        uint256 feeStored = v.feePerStakeStored;
        if (earning > 0 && feeStored > feePaid) {
            pendingDelegatorFees[user][validator] += (earning * (feeStored - feePaid)) / PRECISION;
        }
        userFeePerStakePaid[user][validator] = feeStored;

        if (waiting > 0 && stakedSince[user][validator] + NOTICE_SECONDS <= block.timestamp) {
            unqualifiedStake[user][validator] = 0;
            unqualifiedDelegatedStake[validator] -= waiting;
            emit StakeQualified(user, validator, amount);
        }
    }

    // Touch a position so a qualification that has come due takes effect.
    function qualifyStake(address user, address validator) external onlyInitialized onlyListed(validator) {
        _updateUser(user, validator);
    }

    // Add to a delegation. The position's clock is the weighted average placement time, so
    // a small top-up barely moves it and a large one restarts the week; while the clock is
    // inside the week the whole position waits.
    function _addDelegation(address user, address validator, uint256 added) internal {
        uint256 held = delegatedStake[user][validator];
        uint256 since = held == 0 ? block.timestamp : (held * stakedSince[user][validator] + added * block.timestamp) / (held + added);
        stakedSince[user][validator] = since;
        delegatedStake[user][validator] = held + added;
        operators[validator].delegatedStake += added;
        if (since + NOTICE_SECONDS > block.timestamp) {
            uint256 waiting = unqualifiedStake[user][validator];
            unqualifiedDelegatedStake[validator] += (held + added) - waiting;
            unqualifiedStake[user][validator] = held + added;
        }
    }

    // Take from a delegation; a waiting position shrinks with it.
    function _removeDelegation(address user, address validator, uint256 amount) internal {
        delegatedStake[user][validator] -= amount;
        operators[validator].delegatedStake -= amount;
        uint256 waiting = unqualifiedStake[user][validator];
        if (waiting > 0) {
            uint256 cut = waiting < amount ? waiting : amount;
            unqualifiedStake[user][validator] = waiting - cut;
            unqualifiedDelegatedStake[validator] -= cut;
        }
    }

    function _payRewards(address to, uint256 amount) internal {
        if (amount == 0) return;
        // Whatever the reward bookkeeping says is owed, rewards are never paid out of
        // staked principal, nor out of the unreleased reserve.
        require(IERC20(address(stratoToken)).balanceOf(address(this)) >= principalBalance() + rewardReserve + amount, "SS: rewards unavailable");
        if (amount >= allocatedRewardLiability) {
            allocatedRewardLiability = 0;
        } else {
            allocatedRewardLiability -= amount;
        }
        require(IERC20(address(stratoToken)).transfer(to, amount), "SS: reward transfer failed");
    }

    function _payFees(address to, uint256 amount) internal {
        if (amount == 0) return;
        require(amount <= trackedUsdst, "SS: fees unavailable");
        trackedUsdst -= amount;
        require(usdstToken.transfer(to, amount), "SS: fee transfer failed");
    }

    function _payPrincipal(address to, uint256 amount) internal {
        require(IERC20(address(stratoToken)).transfer(to, amount), "SS: principal transfer failed");
    }

    // Pull `amount` of `token` from the caller and return what actually arrived.
    function _pull(address token, uint256 amount) internal returns (uint256) {
        require(token != address(0), "SS: token=0");
        require(amount > 0, "SS: amount=0");
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "SS: transfer failed");
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: nothing received");
        return received;
    }

    // Return a record's whole self-bond to `to`. It is the operator's property and leaves
    // with it at once.
    function _releaseSelfBond(address validator, StakingValidator storage v, address to) internal {
        if (v.selfBond == 0) return;
        uint256 amount = v.selfBond;
        v.selfBond = 0;
        totalSelfBond -= amount;
        if (v.active) totalRewardableStake -= amount;
        unqualifiedSelfBond[validator] = 0;
        selfBondSince[validator] = 0;
        _payPrincipal(to, amount);
        emit SelfBondReleased(to, validator, amount);
    }

    // ---- registry hooks --------------------------------------------------------------

    // The registry is the canonical source for listing; it syncs accounting here. A record
    // is relisted under the operator it had: a change of operator is a consented handover.
    function syncValidatorRecord(address validator, bool active, uint256 commissionBps, address operator) external onlyInitialized onlyValidatorRegistry {
        require(validator != address(0), "SS: validator=0");
        require(operator != address(0), "SS: operator=0");
        require(commissionBps <= maxCommissionBps, "SS: commission too high");

        StakingValidator storage v = operators[validator];
        if (!v.exists) {
            require(active, "SS: validator missing");
            operators[validator] = StakingValidator(true, true, operator, commissionBps, 0, 0, 0, 0, 0, 0, 0, 0, globalStakeRewardPerTokenStored, baseRewardPerOperatorStored, 0);
            operatorList.push(validator);
            emit ValidatorRecordSynced(validator, operator, true, commissionBps);
            return;
        }

        _settle(validator, v);

        if (active) {
            require(!v.active, "SS: validator active");
            require(block.timestamp >= kickedAt[validator] + NOTICE_SECONDS, "SS: reentry cooldown");
            require(operator == operatorOf(validator), "SS: handover needs consent");
            v.active = true;
            v.commissionBps = commissionBps;
            totalRewardableStake += _validatorWeight(v);
            emit ValidatorRecordSynced(validator, operator, true, commissionBps);
            return;
        }

        require(v.active, "SS: validator inactive");
        (uint256 total, uint256 ready) = readyWeight();
        v.active = false;
        kickedAt[validator] = block.timestamp;
        totalRewardableStake -= _validatorWeight(v);
        _releaseSelfBond(validator, v, operatorOf(validator));
        // A removal is a membership change like any other: bounded per block, and never
        // one that leaves the set unable to finalise.
        if (governanceSyncEnabled && isValidator[validator]) {
            _consumeMutations(1);
            require(_deactivate(validator), "SS: last validator");
        }
        emit ValidatorRecordSynced(validator, operatorOf(validator), false, v.commissionBps);
        _requireNotLessSafe(total, ready);
    }

    // The registry has bound `operator` with the validator key's consent. Here that is an
    // announcement: the record keeps its operator for NOTICE_SECONDS, so delegators can leave
    // and the incoming operator can bond, and acceptOperator completes it. Binding back to
    // the record's operator withdraws the handover.
    function syncValidatorOperator(address validator, address operator) external onlyInitialized onlyValidatorRegistry onlyListed(validator) {
        require(operator != address(0), "SS: operator=0");
        if (operator == operatorOf(validator)) {
            address withdrawn = pendingOperator[validator];
            pendingOperator[validator] = address(0);
            operatorChangeReadyTime[validator] = 0;
            if (withdrawn != address(0)) emit OperatorChangeCancelled(validator, withdrawn);
            return;
        }
        pendingOperator[validator] = operator;
        operatorChangeReadyTime[validator] = block.timestamp + NOTICE_SECONDS;
        emit OperatorChangeAnnounced(validator, operatorOf(validator), operator, operatorChangeReadyTime[validator]);
    }

    // The incoming operator completes a handover announced NOTICE_SECONDS ago, bringing its
    // own qualifying bond. The outgoing operator is paid what it earned and gets its
    // self-bond back; delegations stay where they are. A handover ends an incumbent's
    // exemption: from here the seat is held on the self-bond rule.
    function acceptOperator(address validator, uint256 bondAmount) external onlyInitialized onlyListed(validator) {
        StakingValidator storage v = operators[validator];
        require(v.active, "SS: validator inactive");
        require(pendingOperator[validator] == msg.sender, "SS: not the pending operator");
        require(block.timestamp >= operatorChangeReadyTime[validator], "SS: handover notice running");
        require(bondAmount >= minStake(), "SS: bond below minimum");
        (uint256 total, uint256 ready) = readyWeight();

        _settle(validator, v);
        address oldOperator = operatorOf(validator);
        uint256 rewards = v.pendingSelfBondRewards + v.pendingCommission;
        uint256 fees = v.pendingSelfBondFees + v.pendingFeeCommission;
        v.pendingSelfBondRewards = 0;
        v.pendingCommission = 0;
        v.pendingSelfBondFees = 0;
        v.pendingFeeCommission = 0;
        _releaseSelfBond(validator, v, oldOperator);
        v.operator = msg.sender;
        pendingOperator[validator] = address(0);
        operatorChangeReadyTime[validator] = 0;
        seatedUnderSelfBondRule[validator] = true;

        uint256 received = _pull(address(stratoToken), bondAmount);
        v.selfBond = received;
        totalSelfBond += received;
        totalRewardableStake += received;
        selfBondSince[validator] = block.timestamp;
        unqualifiedSelfBond[validator] = received;

        _payRewards(oldOperator, rewards);
        _payFees(oldOperator, fees);
        emit OperatorChanged(validator, oldOperator, msg.sender);
        emit SelfBonded(msg.sender, validator, received);
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    // ---- commission ------------------------------------------------------------------

    // An operator lowers its commission at once. Raising it takes two calls with the same
    // value, NOTICE_SECONDS apart: the first announces the raise, so delegators can leave
    // before it is charged, and the second applies it. Income already credited keeps its split.
    function setCommissionBps(address validator, uint256 newCommissionBps) external onlyInitialized onlyOperatorOf(validator) {
        StakingValidator storage v = operators[validator];
        require(v.active, "SS: validator inactive");
        require(newCommissionBps <= maxCommissionBps, "SS: commission too high");
        if (newCommissionBps > v.commissionBps) {
            if (announcedCommissionTime[validator] == 0 || announcedCommissionBps[validator] != newCommissionBps) {
                announcedCommissionBps[validator] = newCommissionBps;
                announcedCommissionTime[validator] = block.timestamp + NOTICE_SECONDS;
                emit CommissionIncreaseAnnounced(validator, newCommissionBps, announcedCommissionTime[validator]);
                return;
            }
            require(block.timestamp >= announcedCommissionTime[validator], "SS: commission notice running");
        }
        _settle(validator, v);
        uint256 oldCommissionBps = v.commissionBps;
        v.commissionBps = newCommissionBps;
        announcedCommissionTime[validator] = 0;
        emit CommissionUpdated(validator, oldCommissionBps, newCommissionBps);
    }

    // ---- stake -----------------------------------------------------------------------

    function stake(address validator, uint256 amount) public onlyInitialized onlyListed(validator) {
        require(amount > 0, "SS: amount=0");
        require(operators[validator].active, "SS: validator inactive");
        (uint256 total, uint256 ready) = readyWeight();

        _updateUser(msg.sender, validator);
        uint256 received = _pull(address(stratoToken), amount);
        _addDelegation(msg.sender, validator, received);
        totalUserStake += received;
        totalRewardableStake += received;

        emit Staked(msg.sender, validator, received);
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    function stakeBatch(address[] calldata validators, uint256[] calldata amounts) external onlyInitialized {
        require(validators.length == amounts.length, "SS: length mismatch");
        require(validators.length > 0 && validators.length <= maxBatchSize, "SS: bad batch");

        for (uint256 i = 0; i < validators.length; i++) {
            stake(validators[i], amounts[i]);
        }
    }

    // Moving is free of holds; the moved stake starts a new week on its new validator.
    function moveStake(address fromValidator, address toValidator, uint256 amount) external onlyInitialized onlyListed(fromValidator) onlyListed(toValidator) {
        require(amount > 0, "SS: amount=0");
        require(fromValidator != toValidator, "SS: same validator");
        require(operators[toValidator].active, "SS: target inactive");
        require(delegatedStake[msg.sender][fromValidator] >= amount, "SS: insufficient stake");
        (uint256 total, uint256 ready) = readyWeight();

        _updateUser(msg.sender, fromValidator);
        _updateUser(msg.sender, toValidator);

        _removeDelegation(msg.sender, fromValidator, amount);
        if (operators[fromValidator].active) totalRewardableStake -= amount;
        _addDelegation(msg.sender, toValidator, amount);
        totalRewardableStake += amount;

        emit StakeMoved(msg.sender, fromValidator, toValidator, amount);
        _syncValidator(fromValidator);
        _syncValidator(toValidator);
        _requireNotLessSafe(total, ready);
    }

    // Principal comes back at once: what it earned is settled first and its weight leaves
    // governance in the same transaction.
    function unstake(address validator, uint256 amount) external onlyInitialized onlyListed(validator) {
        require(amount > 0, "SS: amount=0");
        require(delegatedStake[msg.sender][validator] >= amount, "SS: insufficient stake");
        (uint256 total, uint256 ready) = readyWeight();

        _updateUser(msg.sender, validator);
        _removeDelegation(msg.sender, validator, amount);
        totalUserStake -= amount;
        if (operators[validator].active) totalRewardableStake -= amount;
        _payPrincipal(msg.sender, amount);

        emit Unstaked(msg.sender, validator, amount);
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    // Self-bond is the operator's own stake behind a validator: it earns the self-bond share
    // of the validator's income and is what the minimum measures. Its clock works like a
    // delegation's.
    function selfBond(address validator, uint256 amount) external onlyInitialized onlyOperatorOf(validator) {
        require(amount > 0, "SS: amount=0");
        StakingValidator storage v = operators[validator];
        require(v.active, "SS: validator inactive");
        (uint256 total, uint256 ready) = readyWeight();

        _settle(validator, v);
        uint256 received = _pull(address(stratoToken), amount);
        uint256 held = v.selfBond;
        uint256 since = held == 0 ? block.timestamp : (held * selfBondSince[validator] + received * block.timestamp) / (held + received);
        selfBondSince[validator] = since;
        v.selfBond = held + received;
        totalSelfBond += received;
        totalRewardableStake += received;
        if (since + NOTICE_SECONDS > block.timestamp) unqualifiedSelfBond[validator] = v.selfBond;

        emit SelfBonded(msg.sender, validator, received);
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    function unbondSelf(address validator, uint256 amount) external onlyInitialized onlyOperatorOf(validator) {
        require(amount > 0, "SS: amount=0");
        StakingValidator storage v = operators[validator];
        require(v.selfBond >= amount, "SS: insufficient bond");
        (uint256 total, uint256 ready) = readyWeight();

        _settle(validator, v);
        v.selfBond -= amount;
        totalSelfBond -= amount;
        if (v.active) totalRewardableStake -= amount;
        if (unqualifiedSelfBond[validator] > 0) unqualifiedSelfBond[validator] = v.selfBond;
        _payPrincipal(msg.sender, amount);

        emit SelfBondReleased(msg.sender, validator, amount);
        _syncValidator(validator);
        _requireNotLessSafe(total, ready);
    }

    // ---- discretionary rewards -----------------------------------------------------------

    // Anyone may add to validators' income with their own tokens, pulled with transferFrom
    // (approve this contract first). STRATO and USDST are split like production income and
    // are claimed with it. Any other token goes wholly to the validator's operator: sharing
    // it with delegators would mean settling every such token on every stake change, and a
    // permissionless token set would make that unbounded.
    //
    // There is deliberately no reentrancy lock. A token that re-enters during its own transfer
    // can only distort its own balance check, and so only its own ledger; STRATO and USDST are
    // measured separately. A lock, on the other hand, would survive a caller's catch (a SolidVM
    // catch does not roll back) and could block every later distribution.

    // Split each amount across `validators` by stake weight; an empty list means the consensus
    // set. Division dust goes to the last recipient with stake, so every pulled token is credited.
    function distributeRewards(address[] calldata tokens, uint256[] calldata amounts, address[] calldata validators) external onlyInitialized {
        require(tokens.length > 0 && tokens.length <= maxBatchSize, "SS: bad batch");
        require(tokens.length == amounts.length, "SS: length mismatch");

        bool toSet = validators.length == 0;
        uint256 count = toSet ? activeValidators.length : validators.length;
        uint256 hardCap = hardCapActiveValidators == 0 ? 50 : hardCapActiveValidators;
        require(count > 0, "SS: no validators");
        require(count <= hardCap, "SS: too many validators");

        address[] memory recipients = new address[](count);
        uint256[] memory weights = new uint256[](count);
        uint256 totalWeight = 0;
        uint256 lastWeighted = 0;
        for (uint256 i = 0; i < count; i++) {
            address validator = toSet ? activeValidators[i] : validators[i];
            StakingValidator storage v = operators[validator];
            if (!toSet) {
                require(v.exists && v.active, "SS: validator not listed");
                for (uint256 j = 0; j < i; j++) {
                    require(recipients[j] != validator, "SS: duplicate validator");
                }
            }
            recipients[i] = validator;
            // A delisted validator governance kept in the set earns nothing.
            uint256 weight = 0;
            if (v.exists && v.active) {
                weight = _validatorWeight(v);
            }
            weights[i] = weight;
            totalWeight += weight;
            if (weight > 0) lastWeighted = i;
        }
        require(totalWeight > 0, "SS: no stake");

        for (uint256 t = 0; t < tokens.length; t++) {
            uint256 received = _pull(tokens[t], amounts[t]);
            uint256 credited = 0;
            for (uint256 i = 0; i < count; i++) {
                if (weights[i] == 0) continue;
                uint256 share = (received * weights[i]) / totalWeight;
                if (i == lastWeighted) {
                    share = received - credited;
                }
                credited += share;
                _creditDiscretionary(recipients[i], tokens[t], share);
            }
        }
    }

    // Batch of individual credits: amounts[i] of tokens[i], in full, to validators[i].
    function distributeRewardsTo(address[] calldata tokens, uint256[] calldata amounts, address[] calldata validators) external onlyInitialized {
        require(tokens.length > 0 && tokens.length <= maxBatchSize, "SS: bad batch");
        require(tokens.length == amounts.length && tokens.length == validators.length, "SS: length mismatch");
        for (uint256 i = 0; i < validators.length; i++) {
            StakingValidator storage v = operators[validators[i]];
            require(v.exists && v.active, "SS: validator not listed");
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            _creditDiscretionary(validators[i], tokens[i], _pull(tokens[i], amounts[i]));
        }
    }

    // Tokens already received: when nothing on the record qualifies yet, the operator's
    // self-bond share takes them, as the only party there is.
    function _creditDiscretionary(address validator, address token, uint256 amount) internal {
        if (amount == 0) return;
        StakingValidator storage v = operators[validator];
        address operator = operatorOf(validator);
        if (token == address(stratoToken)) {
            _settle(validator, v);
            if (!_creditRewards(validator, v, amount)) v.pendingSelfBondRewards += amount;
            allocatedRewardLiability += amount;
        } else if (token == address(usdstToken)) {
            _settle(validator, v);
            if (!_creditFees(validator, v, amount)) v.pendingSelfBondFees += amount;
            trackedUsdst += amount;
        } else {
            pendingOperatorTokenRewards[operator][token] += amount;
            tokenRewardLiability[token] += amount;
        }
        emit DiscretionaryRewardCredited(operator, validator, token, msg.sender, amount);
    }

    // ---- block processing: liveness and production income ---------------------------------

    // Permissionless and idempotent per block; must never revert since it runs inside
    // the platform's fee payment for every transaction.
    function processBlock() external {
        if (address(stratoToken) == address(0)) return;
        if (lastProcessedBlock == block.number) return;
        // Read the parent's proposal facts before latching. They resolve the parent's
        // BlockSummary out of node-local storage and are the only part of this that can
        // throw; the fee path catches that, and a SolidVM catch does not roll back, so
        // latching first would leave the block marked processed with nothing counted and
        // no way for a later transaction to retry. Everything after this point is local
        // writes, apart from the governance reads in _reconcileGovernanceSet, a view
        // _syncValidator already calls unguarded.
        address actual = block.prevProposer;
        address intended = block.prevIntendedProposer;
        lastProcessedBlock = block.number;
        _processPrevBlock(actual, intended);
        _payProduction(actual);
        _reconcileGovernanceSet();
        previousBlockTime = lastBlockTime;
        lastBlockTime = block.timestamp;
    }

    // Record who proposed the previous block and whether its intended proposer (the one
    // selected for the round the height started at) missed. A finalised proposal is
    // readiness evidence. A miss is consensus-derived but not cryptographically
    // attributable (a round change carries no signed "missed" evidence), so it only costs
    // the block's income and counts toward the liveness limit. No tokens move here.
    function _processPrevBlock(address actual, address intended) internal {
        if (actual != address(0)) {
            blocksProposed[actual] += 1;
            consecutiveMisses[actual] = 0;
            _recordReady(actual, false);
        }
        if (intended == address(0) || intended == actual) return;

        missedProposals[intended] += 1;
        consecutiveMisses[intended] += 1;
        emit ProposalMissed(intended, operatorOf(intended), block.number - 1);
    }

    // Pay the parent block's producer the schedule's release for the interval the block
    // closed: from the block before it (or the schedule's start, whichever is later) to it,
    // capped at MAX_CREDITED_GAP_SECONDS. The rate is the formula at the current eligible
    // stake and reserve. A producer that is not seated, listed and eligible, or whose
    // record has nothing qualified yet, is paid nothing and the amount stays in the reserve.
    function _payProduction(address actual) internal {
        if (actual == address(0) || emissionStartTime == 0 || previousBlockTime == 0) return;
        if (lastBlockTime < emissionStartTime) return;
        uint256 since = previousBlockTime < emissionStartTime ? emissionStartTime : previousBlockTime;
        if (lastBlockTime <= since) return;
        uint256 elapsed = lastBlockTime - since;
        if (elapsed > MAX_CREDITED_GAP_SECONDS) elapsed = MAX_CREDITED_GAP_SECONDS;

        StakingValidator storage v = operators[actual];
        if (!_earns(actual, v)) return;
        uint256 stake = eligibleStake();
        uint256 reserve = rewardReserve;
        if (stake == 0 || reserve == 0) return;
        uint256 amount = _emission(stake, reserve, elapsed);
        if (amount > reserve) amount = reserve;
        if (amount == 0) return;

        _settle(actual, v);
        if (!_creditRewards(actual, v, amount)) return;
        rewardReserve = reserve - amount;
        allocatedRewardLiability += amount;
        totalEmitted += amount;
        emit ProductionRewarded(actual, amount, elapsed, stake, rewardReserve);
    }

    // Earning from the schedule: seated, indexed, listed and still eligible. A seat kept
    // only because its departure is deferred earns nothing for it.
    function _earns(address validator, StakingValidator storage v) internal view returns (bool) {
        return isValidator[validator] && activeValidatorIndex[validator] != 0 && v.exists && v.active && eligible(validator);
    }

    // The stake the schedule's rate is computed on: the weight of the earning part of the set.
    function eligibleStake() public view returns (uint256 total) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            address validator = activeValidators[i];
            StakingValidator storage v = operators[validator];
            if (_earns(validator, v)) total += _validatorWeight(v);
        }
    }

    // E = E0 * sqrt(S / S0) * (R / R0) a year, over `elapsed` seconds. sqrt(S / S0) is taken
    // as sqrt(S * S0) / S0 so the integer root keeps its precision.
    function _emission(uint256 stake, uint256 reserve, uint256 elapsed) internal view returns (uint256) {
        uint256 annual = (emissionRateE0 * _sqrt(stake * emissionStakeS0)) / emissionStakeS0;
        annual = (annual * reserve) / emissionReserveR0;
        return (annual * elapsed) / YEAR;
    }

    // The annual rate at the current stake and reserve, for display.
    function emissionAnnualRate() external view returns (uint256) {
        if (emissionStartTime == 0) return 0;
        uint256 stake = eligibleStake();
        if (stake == 0 || rewardReserve == 0) return 0;
        return _emission(stake, rewardReserve, YEAR);
    }

    // Integer square root, rounded down (Babylonian).
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ---- emission schedule ---------------------------------------------------------------

    // Commit the schedule, once: e0 a year at s0 of eligible stake with r0 in reserve, from
    // startTime (0 = now). The reserve must already hold r0, so what is advertised is
    // funded, and nothing is paid for blocks before the start. There is no pause, no
    // restart and no re-calibration: later top-ups raise R and nothing else.
    function commitEmissionSchedule(uint256 e0, uint256 s0, uint256 r0, uint256 startTime) external onlyOwner onlyInitialized {
        require(emissionStartTime == 0, "SS: schedule committed");
        require(e0 > 0 && s0 > 0 && r0 > 0, "SS: bad schedule");
        _reconcileRewardReserve();
        require(rewardReserve >= r0, "SS: reserve unfunded");
        emissionRateE0 = e0;
        emissionStakeS0 = s0;
        emissionReserveR0 = r0;
        emissionStartTime = startTime > block.timestamp ? startTime : block.timestamp;
        emit EmissionScheduleCommitted(e0, s0, r0, emissionStartTime);
    }

    // Add STRATO to the reserve, pulled from the caller (approve this contract first). Anyone
    // may fund it; nothing takes it back out, and the schedule's reference values stay.
    function fundRewardReserve(uint256 amount) external onlyInitialized {
        _reconcileRewardReserve();
        uint256 received = _pull(address(stratoToken), amount);
        rewardReserve += received;
        emit RewardReserveFunded(msg.sender, received, rewardReserve);
    }

    // The retired schedule kept its own reserve under this name, and the logic that retired
    // it dropped the field, which let the owner of the day recover the STRATO behind it. A
    // proxy upgraded in place can therefore read a reserve nothing backs, against which
    // _payRewards refuses every claim and funding adds to a fiction. Lower it to what the
    // contract actually holds beyond principal and owed rewards. Permissionless and
    // idempotent: it only ever lowers the number, to what is there, moves nothing and leaves
    // a backed reserve alone, so it can run right after the swap, before anything is funded.
    function reconcileRewardReserve() external onlyInitialized {
        _reconcileRewardReserve();
    }

    function _reconcileRewardReserve() internal {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 owed = principalBalance() + allocatedRewardLiability;
        uint256 backed = balance > owed ? balance - owed : 0;
        if (rewardReserve <= backed) return;
        rewardReserve = backed;
        emit RewardReserveReconciled(backed);
    }

    // ---- claims ----------------------------------------------------------------------

    // Delegators' STRATO rewards, net of commission.
    function claimRewards(address[] calldata validators) public onlyInitialized {
        require(validators.length > 0 && validators.length <= maxBatchSize, "SS: bad batch");

        uint256 totalClaimed = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            address validator = validators[i];
            _updateUser(msg.sender, validator);

            uint256 reward = pendingDelegatorRewards[msg.sender][validator];
            if (reward > 0) {
                pendingDelegatorRewards[msg.sender][validator] = 0;
                totalClaimed += reward;
            }
        }

        require(totalClaimed > 0, "SS: no rewards");
        _payRewards(msg.sender, totalClaimed);
        emit DelegatorRewardsClaimed(msg.sender, totalClaimed);
    }

    // Delegators' USDST, net of commission.
    function claimFeeRewards(address[] calldata validators) external onlyInitialized {
        require(validators.length > 0 && validators.length <= maxBatchSize, "SS: bad batch");

        uint256 totalFees = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            address validator = validators[i];
            _updateUser(msg.sender, validator);

            uint256 fees = pendingDelegatorFees[msg.sender][validator];
            if (fees > 0) {
                pendingDelegatorFees[msg.sender][validator] = 0;
                totalFees += fees;
            }
        }

        require(totalFees > 0, "SS: no fees");
        _payFees(msg.sender, totalFees);
        emit DelegatorFeesClaimed(msg.sender, totalFees);
    }

    // The operator's STRATO: self-bond share plus commission.
    function claimOperatorRewards(address validator) external onlyInitialized onlyOperatorOf(validator) {
        StakingValidator storage v = operators[validator];
        _settle(validator, v);

        uint256 amount = v.pendingSelfBondRewards + v.pendingCommission;
        require(amount > 0, "SS: no rewards");
        v.pendingSelfBondRewards = 0;
        v.pendingCommission = 0;

        _payRewards(msg.sender, amount);
        emit OperatorRewardsClaimed(msg.sender, validator, amount);
    }

    // The operator's USDST: self-bond share plus commission.
    function claimOperatorFeeRewards(address validator) external onlyInitialized onlyOperatorOf(validator) {
        StakingValidator storage v = operators[validator];
        uint256 fees = v.pendingSelfBondFees + v.pendingFeeCommission;
        require(fees > 0, "SS: no fees");

        v.pendingSelfBondFees = 0;
        v.pendingFeeCommission = 0;
        _payFees(msg.sender, fees);
        emit OperatorFeesClaimed(msg.sender, validator, fees);
    }

    // The caller's discretionary rewards in tokens other than STRATO and USDST, from every
    // validator it has operated.
    function claimOperatorTokenRewards(address[] calldata tokens) external onlyInitialized {
        require(tokens.length > 0 && tokens.length <= maxBatchSize, "SS: bad batch");

        bool claimed = false;
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 amount = pendingOperatorTokenRewards[msg.sender][token];
            if (amount == 0) continue;

            pendingOperatorTokenRewards[msg.sender][token] = 0;
            tokenRewardLiability[token] -= amount;
            require(IERC20(token).transfer(msg.sender, amount), "SS: reward transfer failed");
            emit OperatorTokenRewardsClaimed(msg.sender, token, amount);
            claimed = true;
        }
        require(claimed, "SS: no rewards");
    }

    // Requests the previous logic queued are withdrawable now, whatever release time it set.
    function withdrawUnbonded(uint256[] calldata requestIds) external onlyInitialized {
        require(requestIds.length > 0 && requestIds.length <= maxBatchSize, "SS: bad batch");

        uint256 totalWithdrawn = 0;
        for (uint256 i = 0; i < requestIds.length; i++) {
            StakingUnbondRequest storage request = unbondingQueue[msg.sender][requestIds[i]];
            require(!request.claimed, "SS: request claimed");
            require(request.amount > 0, "SS: request missing");

            uint256 amount = request.amount;
            request.claimed = true;
            totalWithdrawn += amount;
        }

        totalUnbonding -= totalWithdrawn;
        _payPrincipal(msg.sender, totalWithdrawn);

        emit UnbondedWithdrawn(msg.sender, totalWithdrawn);
    }

    // ---- accounting views --------------------------------------------------------------

    function principalBalance() public view returns (uint256) {
        return totalUserStake + totalSelfBond + totalUnbonding;
    }

    // STRATO held beyond principal, unclaimed rewards and the reserve. A direct transfer
    // lands here: it is nobody's stake, no part of the reserve and recoverable by no one.
    function untrackedStrato() public view returns (uint256) {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 tracked = principalBalance() + allocatedRewardLiability + rewardReserve;
        if (balance <= tracked) return 0;
        return balance - tracked;
    }
}
