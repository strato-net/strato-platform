import "../Tokens/Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./ValidatorRegistry.sol";
import "./IStakingGovernance.sol";

// Staking accounting for STRATO validators, keyed by validator (consensus node) address.
// ValidatorRegistry owns listing and the validator -> operator binding; this contract tracks
// stake, rewards and unbonding per validator, publishes stake weights to governance
// (consensus proposer selection) and keeps liveness counters.
//
// Validators earn from what the chain produces, for blocks they propose:
//   - the block reward FeeRouter.payBlockRewards pushes through creditBlockReward (STRATO)
//   - the proposer's share of each transaction fee, attributed in processBlock (USDST)
// and from discretionary rewards anyone may send in any token (distributeRewards /
// distributeRewardsTo). STRATO and USDST income is split pro rata between the operator's
// self-bond and delegated stake; delegators get their part net of the validator's commission
// through a per-stake index. Discretionary rewards in any other token go wholly to the
// operator. Nothing here seizes tokens: a missed proposal costs that block's income and,
// optionally after maxConsecutiveMisses, a temporary jail.
//
// Validator lifecycle (status is derived, not stored):
//   Missing    = no record
//   Registered = listed, not in the consensus set (may receive stake)
//   Active     = in the consensus set (explicit tryActivate / reconcileSet; room or eviction)
//   Kicked     = delisted by the registry owner (self-bond force-unbonded)
// Leaving the set (under minStake, exit notice, jail, kick) is automatic and same-tx;
// joining is explicit and bounded by maxActiveValidators / hardCapActiveValidators.
//
// Upgraded in place on helium from an operator-keyed layout that also paid a funded reward
// schedule. SolidVM storage is keyed by name, so historical names are kept (operators,
// operatorList, isValidator, ...) and every one of them is now keyed by validator. Helium
// listed each validator as its own operator, so a record written before the switch has no
// operator field and its key is its operator. The retired schedule's final indexes are
// settled once per record by _settleRetiredSchedule and are otherwise dead.
struct StakingValidator {
    bool exists;
    bool active;
    address operator;
    uint256 commissionBps;
    uint256 selfBond;
    uint256 delegatedStake;
    // STRATO block rewards: the operator's part accrues here, delegators' through the index.
    uint256 delegatorRewardPerStakeStored;
    uint256 pendingSelfBondRewards;
    uint256 pendingCommission;
    // USDST proposer fees, split the same way.
    uint256 feePerStakeStored;
    uint256 pendingSelfBondFees;
    uint256 pendingFeeCommission;
    // Retired reward schedule checkpoints (see _settleRetiredSchedule).
    uint256 stakeRewardPerTokenPaid;
    uint256 baseRewardPerOperatorPaid;
    uint256 pendingBaseRewards;
}

struct StakingUnbondRequest {
    uint256 amount;
    uint256 releaseTime;
    bool claimed;
}

contract  StratoStaking is Ownable {
    event Initialized(address indexed stratoToken, uint256 unbondingSeconds, uint256 maxCommissionBps);
    event UsdstTokenSet(address indexed usdstToken, uint256 trackedFrom);
    event ValidatorRegistrySet(address indexed validatorRegistry);
    event GovernanceSet(address indexed governance, bool syncEnabled);
    event ValidatorParamsUpdated(uint256 minStake, uint256 proposerFeeBps, uint256 maxConsecutiveMisses, uint256 jailCooldown);
    event SelfBondGraceSet(uint256 selfBondGraceUntil);
    event SetParamsUpdated(uint256 maxActiveValidators, uint256 hardCapActiveValidators, uint256 evictionMarginBps, uint256 maxSetMutationsPerBlock, uint256 exitNoticeSeconds, uint256 unkickCooldown, uint256 maxOperatorStakeBps, bool joinsPaused);
    event ParamsUpdated(uint256 unbondingSeconds, uint256 maxCommissionBps, uint256 maxBatchSize);
    event ValidatorRecordSynced(address indexed validator, address indexed operator, bool active, uint256 commissionBps);
    event OperatorChanged(address indexed validator, address indexed oldOperator, address indexed newOperator);
    event ValidatorSetIndexed(uint256 count);
    event ValidatorEvicted(address indexed operator, address indexed validator, address indexed by);
    event ExitRequested(address indexed operator, address indexed validator, uint256 readyTime);
    event ExitCancelled(address indexed operator, address indexed validator);
    // Shape and emission pattern are relied on by the node's stake-event parser (Delta.hs).
    event ValidatorSynced(address indexed operator, address indexed validator, bool registered, uint256 weight);
    event BlockRewardCredited(address indexed operator, address indexed validator, address indexed funder, uint256 amount);
    event DiscretionaryRewardCredited(address indexed operator, address indexed validator, address indexed token, address funder, uint256 amount);
    event OperatorTokenRewardsClaimed(address indexed operator, address indexed token, uint256 amount);
    event FeesCredited(address indexed operator, address indexed validator, uint256 amount);
    event UnattributedFees(address indexed validator, uint256 amount);
    event ProposalMissed(address indexed validator, address indexed operator, uint256 blockNumber);
    event ValidatorJailed(address indexed operator, address indexed validator, uint256 jailedUntil);
    event CommissionUpdated(address indexed validator, uint256 oldCommissionBps, uint256 newCommissionBps);
    event Staked(address indexed user, address indexed validator, uint256 amount);
    event StakeMoved(address indexed user, address indexed fromValidator, address indexed toValidator, uint256 amount);
    event UnbondingStarted(address indexed user, address indexed validator, uint256 indexed requestId, uint256 amount, uint256 releaseTime);
    event UnbondedWithdrawn(address indexed user, uint256 amount);
    event SelfBonded(address indexed operator, address indexed validator, uint256 amount);
    event SelfBondUnbondingStarted(address indexed operator, address indexed validator, uint256 indexed requestId, uint256 amount, uint256 releaseTime);
    event DelegatorRewardsClaimed(address indexed user, uint256 amount);
    event OperatorRewardsClaimed(address indexed operator, address indexed validator, uint256 amount);
    event DelegatorFeesClaimed(address indexed user, uint256 amount);
    event OperatorFeesClaimed(address indexed operator, address indexed validator, uint256 amount);
    event UnattributedFeesRecovered(address indexed to, uint256 amount);
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
    uint256 public minStake;              // self-bond a validator must hold (see _meetsMinStake)
    // Until this time validators qualify on self-bond + delegated stake, the rule the first
    // validators were admitted under; from it on, minStake must be met by self-bond alone.
    // Zero means never set: a proxy upgraded in place keeps the old rule until the admins
    // choose a deadline. initialize() writes 1, so fresh deployments start on self-bond.
    uint256 public selfBondGraceUntil;
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
    uint256 public maxOperatorStakeBps;     // inbound stake cap per validator (0 = off)
    bool public joinsPaused;                // permissionless activation switch (owner may still activate)
    uint256 public validatorCount;
    uint256 public mutationBlock;
    uint256 public setMutationsThisBlock;
    mapping(address => uint256) public  exitReadyTime;
    mapping(address => uint256) public  kickedAt;
    mapping(address => bool) public  isValidator;
    mapping(address => uint256) public  lastSyncedWeight;
    mapping(address => uint256) public  jailedUntil;
    // The consensus set itself, so set-wide passes are bounded by the set, not by how many
    // validators have ever been listed. activeValidatorIndex is 1-based; 0 = not indexed.
    address[] public activeValidators;
    mapping(address => uint256) public  activeValidatorIndex;

    // Liveness, derived from block.prev*.
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
    uint256 public maxCommissionBps;
    uint256 public maxBatchSize;

    uint256 public totalUserStake;
    uint256 public totalSelfBond;
    uint256 public totalUnbonding;
    uint256 public totalRewardableStake;

    // STRATO credited as rewards and not yet claimed; kept out of recoverable STRATO.
    uint256 public allocatedRewardLiability;
    uint256 public totalRewardsCredited;

    // Discretionary rewards in tokens other than STRATO and USDST, owed to operators:
    // operator => token => amount. Keyed by the operator account rather than the validator, so
    // a later change of operator never hands accrued rewards to the successor.
    mapping(address => mapping(address => uint256)) public  pendingOperatorTokenRewards;
    // Unclaimed discretionary rewards per token; kept out of recoverStrayToken.
    mapping(address => uint256) public  tokenRewardLiability;

    // Final indexes of the retired reward schedule. Frozen; read only by _settleRetiredSchedule.
    uint256 public baseRewardPerOperatorStored;
    uint256 public globalStakeRewardPerTokenStored;

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
        uint256 _unbondingSeconds,
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
        unbondingSeconds = _unbondingSeconds;
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;
        selfBondGraceUntil = 1;

        // Set admission defaults: closed joins, today's consensus envelope.
        maxActiveValidators = 50;
        hardCapActiveValidators = 50;
        evictionMarginBps = 500;
        maxSetMutationsPerBlock = 2;
        exitNoticeSeconds = _unbondingSeconds;
        unkickCooldown = _unbondingSeconds;
        joinsPaused = true;

        emit Initialized(_stratoToken, _unbondingSeconds, _maxCommissionBps);
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

    function operatorOf(address validator) public view returns (address) {
        StakingValidator storage v = operators[validator];
        if (!v.exists) return address(0);
        return v.operator == address(0) ? validator : v.operator;
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

    // Wire (or disable) the governance link. Enabling resyncs the consensus set so
    // governance learns its current weights.
    function setGovernance(address _governance, bool syncEnabled) external onlyOwner onlyInitialized {
        require(!syncEnabled || _governance != address(0), "SS: governance=0");
        governance = _governance;
        governanceSyncEnabled = syncEnabled;
        emit GovernanceSet(_governance, syncEnabled);
        _syncAllValidators();
    }

    function setValidatorParams(
        uint256 _minStake,
        uint256 _proposerFeeBps,
        uint256 _maxConsecutiveMisses,
        uint256 _jailCooldown
    ) external onlyOwner onlyInitialized {
        require(_proposerFeeBps <= BPS_DIVISOR, "SS: bad fee share");

        minStake = _minStake;
        proposerFeeBps = _proposerFeeBps;
        maxConsecutiveMisses = _maxConsecutiveMisses;
        jailCooldown = _jailCooldown;
        emit ValidatorParamsUpdated(_minStake, _proposerFeeBps, _maxConsecutiveMisses, _jailCooldown);
        _syncAllValidators();
    }

    // Choose (or move) the end of the self-bond grace period. A deadline in the past applies
    // the self-bond rule immediately, so validators without enough self-bond leave the set.
    function setSelfBondGraceUntil(uint256 _selfBondGraceUntil) external onlyOwner onlyInitialized {
        require(_selfBondGraceUntil > 0, "SS: grace=0");
        selfBondGraceUntil = _selfBondGraceUntil;
        emit SelfBondGraceSet(_selfBondGraceUntil);
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

    // Lowering maxCommissionBps needs no pass over the validators: commission is capped
    // where it is charged (_commissionBps).
    function setParams(uint256 _unbondingSeconds, uint256 _maxCommissionBps, uint256 _maxBatchSize) external onlyOwner onlyInitialized {
        require(_maxCommissionBps <= BPS_DIVISOR, "SS: bad commission");
        require(_maxBatchSize > 0, "SS: bad batch");

        unbondingSeconds = _unbondingSeconds;
        maxCommissionBps = _maxCommissionBps;
        maxBatchSize = _maxBatchSize;

        emit ParamsUpdated(_unbondingSeconds, _maxCommissionBps, _maxBatchSize);
    }

    // ---- consensus validator lifecycle -------------------------------------------

    function _validatorWeight(StakingValidator storage v) internal view returns (uint256) {
        return v.selfBond + v.delegatedStake;
    }

    // minStake is a self-bond requirement: a validator must have its own stake at risk, and
    // delegations add weight but cannot qualify it on their own. See selfBondGraceUntil.
    function _meetsMinStake(StakingValidator storage v) internal view returns (bool) {
        if (selfBondGraceUntil == 0 || block.timestamp < selfBondGraceUntil) {
            return _validatorWeight(v) >= minStake;
        }
        return v.selfBond >= minStake;
    }

    // 0 = Missing, 1 = Registered, 2 = Active, 3 = Kicked
    function status(address validator) public view returns (uint8) {
        StakingValidator storage v = operators[validator];
        if (!v.exists) return 0;
        if (!v.active) return 3;
        if (isValidator[validator]) return 2;
        return 1;
    }

    // Eligible to be (or stay) a consensus validator: listed, meets minStake, not jailed,
    // no exit due.
    function eligible(address validator) public view returns (bool) {
        StakingValidator storage v = operators[validator];
        if (!v.exists || !v.active) return false;
        return _meetsMinStake(v)
            && block.timestamp >= jailedUntil[validator]
            && (exitReadyTime[validator] == 0 || block.timestamp < exitReadyTime[validator]);
    }

    // A waiter is eligible but not in the set; promotion is explicit (tryActivate / reconcileSet).
    function isWaiter(address validator) public view returns (bool) {
        return eligible(validator) && !isValidator[validator];
    }

    // More than a third of the rewardable stake: can stall a stake-weighted quorum.
    function exceedsOneThird(address validator) external view returns (bool) {
        return isValidator[validator] && _validatorWeight(operators[validator]) * 3 > totalRewardableStake;
    }

    function effectiveCap() public view returns (uint256) {
        // Zero-valued admission params read as unset (an upgraded proxy has no
        // storage for fields the old code never wrote); default to a 50-slot set.
        uint256 h = hardCapActiveValidators == 0 ? 50 : hardCapActiveValidators;
        uint256 a = maxActiveValidators == 0 ? h : maxActiveValidators;
        return a < h ? a : h;
    }

    function _mutationCap() internal view returns (uint256) {
        return maxSetMutationsPerBlock == 0 ? 4 : maxSetMutationsPerBlock;
    }

    function _consumeMutations(uint256 n) internal {
        if (mutationBlock != block.number) {
            mutationBlock = block.number;
            setMutationsThisBlock = 0;
        }
        require(setMutationsThisBlock + n <= _mutationCap(), "SS: mutation cap");
        setMutationsThisBlock += n;
    }

    // Paired so every path that moves isValidator also moves validatorCount, the weight
    // cache and the set index.
    function _seat(address validator, uint256 weight) internal {
        isValidator[validator] = true;
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
        exitReadyTime[validator] = 0;

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
    // fails safe (no resync, no eviction).
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
    // Joining is never implicit.
    function _syncValidator(address validator) internal {
        if (!governanceSyncEnabled || !isValidator[validator]) return;
        if (!eligible(validator)) {
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
        // addValidatorFromStaking rather than updateValidatorStake: the latter
        // reverts when governance does not already list the validator, which would
        // propagate out of stake() and unstake() and break staking for users. The
        // former reconciles that case instead of failing on it.
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

    function _requireJoinsOpen() internal view {
        require(!joinsPaused || msg.sender == owner(), "SS: joins paused");
        require(governanceSyncEnabled, "SS: governance sync off");
    }

    // Put an eligible validator into the consensus set: into a free slot, or by evicting
    // the lowest validator it beats by evictionMarginBps. Anyone may call once joins are
    // open; the owner may always.
    function tryActivate(address validator) external onlyInitialized onlyListed(validator) {
        _requireJoinsOpen();
        require(!isValidator[validator], "SS: already active");
        require(eligible(validator), "SS: not eligible");

        if (validatorCount < effectiveCap()) {
            _consumeMutations(1);
            _activate(validator);
        } else {
            (address lowest, uint256 lowestWeight) = _lowestValidator();
            uint256 weight = _validatorWeight(operators[validator]);
            require(lowest != address(0) && weight * BPS_DIVISOR >= lowestWeight * (BPS_DIVISOR + evictionMarginBps), "SS: set full");
            _consumeMutations(2);
            require(_deactivate(lowest), "SS: cannot evict");
            emit ValidatorEvicted(operatorOf(lowest), lowest, validator);
            _activate(validator);
        }
        _requireWithinStakeCap(validator);
    }

    // Fill free slots with the best waiters among `candidates`, as far as this block's
    // mutation budget allows. The caller names the candidates (an indexer's list of waiters,
    // say), so the work is bounded by the call rather than by every validator ever listed.
    function reconcileSet(address[] calldata candidates) external onlyInitialized {
        _requireJoinsOpen();
        require(candidates.length <= maxBatchSize, "SS: bad batch");
        uint256 cap = effectiveCap();
        while (validatorCount < cap) {
            if (mutationBlock == block.number && setMutationsThisBlock >= _mutationCap()) break;
            (address best,) = _bestWaiter(candidates);
            if (best == address(0)) break;
            _consumeMutations(1);
            _activate(best);
        }
    }

    // Inbound stake may not push a validator above maxOperatorStakeBps of the rewardable
    // stake (grandfathered validators simply cannot receive more).
    function _requireWithinStakeCap(address validator) internal view {
        if (maxOperatorStakeBps == 0 || totalRewardableStake == 0) return;
        require(_validatorWeight(operators[validator]) * BPS_DIVISOR <= totalRewardableStake * maxOperatorStakeBps, "SS: above operator stake cap");
    }

    // An active validator announces it will leave; it keeps serving for exitNoticeSeconds,
    // after which any sync (or syncValidator) takes it out of the set. Self-bond stays bonded.
    function requestExit(address validator) external onlyInitialized onlyOperatorOf(validator) {
        require(isValidator[validator], "SS: not active");
        require(exitReadyTime[validator] == 0, "SS: exit pending");
        exitReadyTime[validator] = block.timestamp + exitNoticeSeconds;
        emit ExitRequested(msg.sender, validator, exitReadyTime[validator]);
    }

    function cancelExit(address validator) external onlyInitialized onlyOperatorOf(validator) {
        require(exitReadyTime[validator] != 0, "SS: no exit pending");
        exitReadyTime[validator] = 0;
        emit ExitCancelled(msg.sender, validator);
    }

    // Used from the fee path, which must never revert.
    function _trySyncValidator(address validator) internal {
        try _syncValidator(validator) {
        } catch {
        }
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

    // Permissionless resync (e.g. after a jail cooldown expires).
    function syncValidator(address validator) external onlyInitialized onlyListed(validator) {
        _syncValidator(validator);
    }

    // ---- income accounting ---------------------------------------------------------

    function _commissionBps(StakingValidator storage v) internal view returns (uint256) {
        return v.commissionBps < maxCommissionBps ? v.commissionBps : maxCommissionBps;
    }

    // Delegators' gross share of some income: commission to the operator, the rest into the
    // per-stake index. With no delegated stake there is nobody to share with.
    function _creditDelegatorRewards(StakingValidator storage v, uint256 gross) internal {
        if (gross == 0) return;
        if (v.delegatedStake == 0) {
            v.pendingSelfBondRewards += gross;
            return;
        }
        uint256 commission = (gross * _commissionBps(v)) / BPS_DIVISOR;
        v.pendingCommission += commission;
        v.delegatorRewardPerStakeStored += ((gross - commission) * PRECISION) / v.delegatedStake;
    }

    // STRATO income, split pro rata between self-bond and delegated stake.
    function _creditRewards(StakingValidator storage v, uint256 amount) internal {
        uint256 weight = _validatorWeight(v);
        if (weight == 0) {
            v.pendingSelfBondRewards += amount;
            return;
        }
        uint256 selfBondShare = (amount * v.selfBond) / weight;
        v.pendingSelfBondRewards += selfBondShare;
        _creditDelegatorRewards(v, amount - selfBondShare);
    }

    // USDST income, split the same way.
    function _creditFees(StakingValidator storage v, uint256 amount) internal {
        uint256 weight = _validatorWeight(v);
        if (weight == 0) {
            v.pendingSelfBondFees += amount;
            return;
        }

        uint256 selfBondFee = (amount * v.selfBond) / weight;
        uint256 delegatorGrossFee = amount - selfBondFee;

        v.pendingSelfBondFees += selfBondFee;
        if (delegatorGrossFee > 0 && v.delegatedStake > 0) {
            uint256 commission = (delegatorGrossFee * _commissionBps(v)) / BPS_DIVISOR;
            v.pendingFeeCommission += commission;
            v.feePerStakeStored += ((delegatorGrossFee - commission) * PRECISION) / v.delegatedStake;
        } else {
            v.pendingSelfBondFees += delegatorGrossFee;
        }
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

    function _updateUser(address user, address validator) internal {
        StakingValidator storage v = operators[validator];
        if (v.exists) _settleRetiredSchedule(v);

        uint256 amount = delegatedStake[user][validator];

        uint256 paid = userRewardPerStakePaid[user][validator];
        uint256 stored = v.delegatorRewardPerStakeStored;
        if (amount > 0 && stored > paid) {
            pendingDelegatorRewards[user][validator] += (amount * (stored - paid)) / PRECISION;
        }
        userRewardPerStakePaid[user][validator] = stored;

        uint256 feePaid = userFeePerStakePaid[user][validator];
        uint256 feeStored = v.feePerStakeStored;
        if (amount > 0 && feeStored > feePaid) {
            pendingDelegatorFees[user][validator] += (amount * (feeStored - feePaid)) / PRECISION;
        }
        userFeePerStakePaid[user][validator] = feeStored;
    }

    function _payRewards(address to, uint256 amount) internal {
        if (amount == 0) return;
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

    // Unbonding requests share one queue per address for both users and operators.
    function _createUnbondRequest(address user, uint256 amount) internal returns (uint256) {
        uint256 requestId = unbondingRequestCount[user];
        unbondingQueue[user][requestId] = StakingUnbondRequest(amount, block.timestamp + unbondingSeconds, false);
        unbondingRequestCount[user] = requestId + 1;
        totalUnbonding += amount;
        return requestId;
    }

    // Queue a record's whole self-bond for unbonding to `to`.
    function _releaseSelfBond(address validator, StakingValidator storage v, address to) internal {
        if (v.selfBond == 0) return;
        uint256 amount = v.selfBond;
        v.selfBond = 0;
        totalSelfBond -= amount;
        if (v.active) totalRewardableStake -= amount;

        uint256 requestId = _createUnbondRequest(to, amount);
        emit SelfBondUnbondingStarted(to, validator, requestId, amount, block.timestamp + unbondingSeconds);
    }

    // A new operator takes over a record. What the outgoing operator owns leaves with it:
    // its self-bond is queued for unbonding to it and its accrued rewards and fees are paid
    // out, so the incoming operator starts from zero.
    function _changeOperator(address validator, address newOperator) internal {
        address oldOperator = operatorOf(validator);
        if (oldOperator == newOperator) return;

        StakingValidator storage v = operators[validator];
        _settleRetiredSchedule(v);
        uint256 rewards = v.pendingSelfBondRewards + v.pendingCommission;
        uint256 fees = v.pendingSelfBondFees + v.pendingFeeCommission;
        v.pendingSelfBondRewards = 0;
        v.pendingCommission = 0;
        v.pendingSelfBondFees = 0;
        v.pendingFeeCommission = 0;
        _releaseSelfBond(validator, v, oldOperator);
        v.operator = newOperator;

        _payRewards(oldOperator, rewards);
        _payFees(oldOperator, fees);
        emit OperatorChanged(validator, oldOperator, newOperator);
    }

    // ---- registry hooks --------------------------------------------------------------

    // The registry is the canonical source for listing; it syncs accounting here.
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

        _settleRetiredSchedule(v);

        if (active) {
            require(!v.active, "SS: validator active");
            require(block.timestamp >= kickedAt[validator] + unkickCooldown, "SS: unkick cooldown");
            _changeOperator(validator, operator);
            v.active = true;
            v.commissionBps = commissionBps;
            totalRewardableStake += _validatorWeight(v);
            emit ValidatorRecordSynced(validator, operator, true, commissionBps);
            return;
        }

        require(v.active, "SS: validator inactive");
        v.active = false;
        kickedAt[validator] = block.timestamp;
        totalRewardableStake -= _validatorWeight(v);
        _releaseSelfBond(validator, v, operatorOf(validator));
        // A kick leaves the set immediately and is not bounded by the mutation cap.
        if (governanceSyncEnabled && isValidator[validator]) {
            _deactivate(validator);
        }
        emit ValidatorRecordSynced(validator, operatorOf(validator), false, v.commissionBps);
    }

    function syncValidatorOperator(address validator, address operator) external onlyInitialized onlyValidatorRegistry onlyListed(validator) {
        require(operator != address(0), "SS: operator=0");
        _changeOperator(validator, operator);
        _syncValidator(validator);
    }

    // ---- commission ------------------------------------------------------------------

    function setCommissionBps(address validator, uint256 newCommissionBps) external onlyInitialized onlyOperatorOf(validator) {
        require(operators[validator].active, "SS: validator inactive");
        _setCommissionBps(validator, newCommissionBps);
    }

    function setValidatorCommissionBps(address validator, uint256 newCommissionBps) external onlyOwner onlyInitialized onlyListed(validator) {
        require(operators[validator].active, "SS: validator inactive");
        _setCommissionBps(validator, newCommissionBps);
    }

    function _setCommissionBps(address validator, uint256 newCommissionBps) internal {
        require(newCommissionBps <= maxCommissionBps, "SS: commission too high");
        StakingValidator storage v = operators[validator];
        _settleRetiredSchedule(v);

        uint256 oldCommissionBps = v.commissionBps;
        v.commissionBps = newCommissionBps;
        emit CommissionUpdated(validator, oldCommissionBps, newCommissionBps);
    }

    // ---- stake -----------------------------------------------------------------------

    function stake(address validator, uint256 amount) public onlyInitialized onlyListed(validator) {
        require(amount > 0, "SS: amount=0");
        require(operators[validator].active, "SS: validator inactive");

        _updateUser(msg.sender, validator);

        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: stake transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no stake");

        delegatedStake[msg.sender][validator] += received;
        operators[validator].delegatedStake += received;
        totalUserStake += received;
        totalRewardableStake += received;

        emit Staked(msg.sender, validator, received);
        _requireWithinStakeCap(validator);
        _syncValidator(validator);
    }

    function stakeBatch(address[] calldata validators, uint256[] calldata amounts) external onlyInitialized {
        require(validators.length == amounts.length, "SS: length mismatch");
        require(validators.length > 0 && validators.length <= maxBatchSize, "SS: bad batch");

        for (uint256 i = 0; i < validators.length; i++) {
            stake(validators[i], amounts[i]);
        }
    }

    function moveStake(address fromValidator, address toValidator, uint256 amount) external onlyInitialized onlyListed(fromValidator) onlyListed(toValidator) {
        require(amount > 0, "SS: amount=0");
        require(fromValidator != toValidator, "SS: same validator");
        require(operators[toValidator].active, "SS: target inactive");
        require(delegatedStake[msg.sender][fromValidator] >= amount, "SS: insufficient stake");

        _updateUser(msg.sender, fromValidator);
        _updateUser(msg.sender, toValidator);

        delegatedStake[msg.sender][fromValidator] -= amount;
        operators[fromValidator].delegatedStake -= amount;
        if (operators[fromValidator].active) totalRewardableStake -= amount;

        delegatedStake[msg.sender][toValidator] += amount;
        operators[toValidator].delegatedStake += amount;
        totalRewardableStake += amount;

        emit StakeMoved(msg.sender, fromValidator, toValidator, amount);
        _requireWithinStakeCap(toValidator);
        _syncValidator(fromValidator);
        _syncValidator(toValidator);
    }

    function unstake(address validator, uint256 amount) external onlyInitialized onlyListed(validator) {
        require(amount > 0, "SS: amount=0");
        require(delegatedStake[msg.sender][validator] >= amount, "SS: insufficient stake");

        _updateUser(msg.sender, validator);

        delegatedStake[msg.sender][validator] -= amount;
        operators[validator].delegatedStake -= amount;
        totalUserStake -= amount;
        if (operators[validator].active) totalRewardableStake -= amount;

        uint256 requestId = _createUnbondRequest(msg.sender, amount);

        emit UnbondingStarted(msg.sender, validator, requestId, amount, block.timestamp + unbondingSeconds);
        _syncValidator(validator);
    }

    // Self-bond is the operator's own stake behind a validator: it earns the self-bond share
    // of the validator's income and is what minStake measures.
    function selfBond(address validator, uint256 amount) external onlyInitialized onlyOperatorOf(validator) {
        require(amount > 0, "SS: amount=0");
        StakingValidator storage v = operators[validator];
        require(v.active, "SS: validator inactive");

        _settleRetiredSchedule(v);

        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: bond transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no bond");

        v.selfBond += received;
        totalSelfBond += received;
        totalRewardableStake += received;

        emit SelfBonded(msg.sender, validator, received);
        _requireWithinStakeCap(validator);
        _syncValidator(validator);
    }

    function unbondSelf(address validator, uint256 amount) external onlyInitialized onlyOperatorOf(validator) {
        require(amount > 0, "SS: amount=0");
        StakingValidator storage v = operators[validator];
        require(v.selfBond >= amount, "SS: insufficient bond");

        _settleRetiredSchedule(v);

        v.selfBond -= amount;
        totalSelfBond -= amount;
        if (v.active) totalRewardableStake -= amount;

        uint256 requestId = _createUnbondRequest(msg.sender, amount);

        emit SelfBondUnbondingStarted(msg.sender, validator, requestId, amount, block.timestamp + unbondingSeconds);
        _syncValidator(validator);
    }

    // ---- block rewards, fee routing and liveness ----------------------------------------

    // Block rewards arrive from FeeRouter.payBlockRewards, once per block for block.proposer.
    // The router approves `amount` and this pulls it, so a credit can never exceed what was
    // actually paid in; anyone else calling it simply adds their own STRATO to a validator's
    // income. The router catches a failure, and a SolidVM catch does not roll back, so every
    // check that can fail runs before the first write.
    function creditBlockReward(address validator, uint256 amount) external onlyInitialized {
        StakingValidator storage v = operators[validator];
        require(v.exists && v.active, "SS: validator not listed");
        require(amount > 0, "SS: amount=0");

        uint256 balanceBefore = IERC20(address(stratoToken)).balanceOf(address(this));
        require(IERC20(address(stratoToken)).transferFrom(msg.sender, address(this), amount), "SS: reward transfer failed");
        uint256 received = IERC20(address(stratoToken)).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no reward");

        _settleRetiredSchedule(v);
        _creditRewards(v, received);
        allocatedRewardLiability += received;
        totalRewardsCredited += received;
        emit BlockRewardCredited(operatorOf(validator), validator, msg.sender, received);
    }

    // ---- discretionary rewards -----------------------------------------------------------

    // Anyone may add to validators' income with their own tokens, pulled with transferFrom
    // (approve this contract first). STRATO and USDST are split exactly like block rewards and
    // proposer fees and are claimed with them. Any other token goes wholly to the validator's
    // operator: sharing it with delegators would mean settling every such token on every stake
    // change, and a permissionless token set would make that unbounded.
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
            uint256 received = _pullReward(tokens[t], amounts[t]);
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
            _creditDiscretionary(validators[i], tokens[i], _pullReward(tokens[i], amounts[i]));
        }
    }

    // Pull `amount` of `token` from the caller and return what actually arrived.
    function _pullReward(address token, uint256 amount) internal returns (uint256) {
        require(token != address(0), "SS: token=0");
        require(amount > 0, "SS: amount=0");
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "SS: reward transfer failed");
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "SS: no reward");
        return received;
    }

    function _creditDiscretionary(address validator, address token, uint256 amount) internal {
        if (amount == 0) return;
        StakingValidator storage v = operators[validator];
        address operator = operatorOf(validator);
        if (token == address(stratoToken)) {
            _settleRetiredSchedule(v);
            _creditRewards(v, amount);
            allocatedRewardLiability += amount;
        } else if (token == address(usdstToken)) {
            // Tracked now, or the next fee sync would attribute it to the block proposer.
            _creditFees(v, amount);
            trackedUsdst += amount;
        } else {
            pendingOperatorTokenRewards[operator][token] += amount;
            tokenRewardLiability[token] += amount;
        }
        emit DiscretionaryRewardCredited(operator, validator, token, msg.sender, amount);
    }

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
            // Latch before _processPrevBlock, not after: _jail calls out to
            // governance, and a reentrant processBlock must not count twice.
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
        StakingValidator storage v = operators[proposer];
        if (!v.exists) {
            unattributedFees += received;
            emit UnattributedFees(proposer, received);
            return;
        }
        _creditFees(v, received);
        totalFeesCredited += received;
        emit FeesCredited(operatorOf(proposer), proposer, received);
    }

    // Record who proposed the previous block and whether its intended proposer
    // (the one selected for the round the height started at) missed. A miss is
    // consensus-derived but not cryptographically attributable (a round change
    // carries no signed "missed" evidence), so it only costs the block's income,
    // feeds the dashboard and — optionally — a temporary jail. No tokens move.
    function _processPrevBlock(address actual, address intended) internal {
        if (actual != address(0)) {
            blocksProposed[actual] += 1;
            consecutiveMisses[actual] = 0;
        }
        if (intended == address(0) || intended == actual) return;

        missedProposals[intended] += 1;
        consecutiveMisses[intended] += 1;
        emit ProposalMissed(intended, operatorOf(intended), block.number - 1);

        if (maxConsecutiveMisses > 0 && consecutiveMisses[intended] >= maxConsecutiveMisses) {
            _jail(intended);
        }
    }

    // Take the validator out of the set until jailedUntil; stake is untouched.
    function _jail(address validator) internal {
        if (!operators[validator].exists) return;
        consecutiveMisses[validator] = 0;
        jailedUntil[validator] = block.timestamp + jailCooldown;
        emit ValidatorJailed(operatorOf(validator), validator, jailedUntil[validator]);
        _trySyncValidator(validator);
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

    // Delegators' USDST fees, net of commission.
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
        _settleRetiredSchedule(v);

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

    // ---- recovery --------------------------------------------------------------------

    function principalBalance() public view returns (uint256) {
        return totalUserStake + totalSelfBond + totalUnbonding;
    }

    // STRATO held beyond principal and unclaimed rewards (including anything left in the
    // retired schedule's reserve).
    function recoverableUntrackedStrato() public view returns (uint256) {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 tracked = principalBalance() + allocatedRewardLiability;
        if (balance <= tracked) return 0;
        return balance - tracked;
    }

    function recoverUntrackedStrato(address to, uint256 amount) external onlyOwner onlyInitialized {
        require(to != address(0), "SS: to=0");
        require(amount <= recoverableUntrackedStrato(), "SS: untracked unavailable");

        require(IERC20(address(stratoToken)).transfer(to, amount), "SS: untracked transfer failed");
        emit UntrackedStratoRecovered(to, amount);
    }

    // Fees attributed to a proposer without a listed validator are held for governance.
    function recoverUnattributedFees(address to, uint256 amount) external onlyOwner onlyInitialized {
        require(to != address(0), "SS: to=0");
        require(amount <= unattributedFees, "SS: unattributed unavailable");
        unattributedFees -= amount;
        _payFees(to, amount);
        emit UnattributedFeesRecovered(to, amount);
    }

    function recoverStrayToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "SS: to=0");
        require(token != address(stratoToken), "SS: use untracked recovery");
        require(token != address(usdstToken), "SS: use fee recovery");
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 owed = tokenRewardLiability[token];
        require(balance >= owed && amount <= balance - owed, "SS: rewards unavailable");

        require(IERC20(token).transfer(to, amount), "SS: recover failed");
        emit StrayTokenRecovered(token, to, amount);
    }
}
