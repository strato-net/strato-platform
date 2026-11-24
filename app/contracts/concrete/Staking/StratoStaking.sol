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
//   - the emission schedule: a prefunded reserve released at E0 * sqrt(S / S0) * (R / R0)
//     STRATO a year, paid in processBlock to each block's producer (STRATO)
//   - the block reward FeeRouter.payBlockRewards pushes through creditBlockReward (STRATO;
//     disabled, see creditBlockReward)
//   - the proposer's share of each transaction fee, attributed in processBlock (USDST)
// and from discretionary rewards anyone may send in any token (distributeRewards /
// distributeRewardsTo). STRATO and USDST income is split pro rata between the operator's
// self-bond and delegated stake; delegators get their part net of the validator's commission
// through a per-stake index. Discretionary rewards in any other token go wholly to the
// operator. Nothing here seizes tokens: a missed proposal costs that block's income and is
// counted. Jailing is disabled: no number of misses takes a validator out of the set.
//
// Validator lifecycle (status is derived, not stored):
//   Missing    = no record
//   Registered = listed, not in the consensus set (may receive stake)
//   Active     = in the consensus set (explicit tryActivate / reconcileSet; room or eviction)
//   Kicked     = delisted by the registry owner (self-bond force-unbonded)
// Leaving the set (under minStake, exit notice, kick) is automatic and same-tx;
// joining is explicit and bounded by maxActiveValidators / hardCapActiveValidators.
// Joining is open to anyone from joinsOpenFromBlock and needs selfBondMinimum of the operator's
// own bond; a seat held from before that rule keeps the rule it was admitted under.
//
// Upgraded in place on helium from an operator-keyed layout that also paid a funded reward
// schedule. SolidVM storage is keyed by name, so historical names are kept (operators,
// operatorList, isValidator, ...) and every one of them is now keyed by validator. Helium
// listed each validator as its own operator, so a record written before the switch has no
// operator field and its key is its operator. The retired schedule's final indexes are
// settled once per record by _settleRetiredSchedule and are otherwise dead.
// A staker's arrivals in the two most recent windows of the stake delay (see
// stakeDelaySeconds): the newer window with its amount, and the one just before it.
struct PendingStake {
    uint256 newWindow;
    uint256 newAmount;
    uint256 oldWindow;
    uint256 oldAmount;
}

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
    event SelfBondMinimumSet(uint256 selfBondMinimum);
    event SetParamsUpdated(uint256 maxActiveValidators, uint256 hardCapActiveValidators, uint256 evictionMarginBps, uint256 maxSetMutationsPerBlock, uint256 exitNoticeSeconds, uint256 unkickCooldown, uint256 maxOperatorStakeBps);
    event JoinsOpenFromBlockSet(uint256 blockNumber);
    event StakeDelaySet(uint256 stakeDelaySeconds);
    event StakeRefiled(address indexed fromRecord, uint256 validators, uint256 delegators, uint256 amount);
    event ParamsUpdated(uint256 unbondingSeconds, uint256 maxCommissionBps, uint256 maxBatchSize);
    event EmissionScheduleCommitted(uint256 e0, uint256 s0, uint256 r0, uint256 startTime);
    event EmissionReserveFunded(address indexed funder, uint256 amount, uint256 reserve);
    event EmissionScheduleRecommitted(uint256 e0, uint256 s0, uint256 r0, uint256 swept, uint256 reserve);
    event ProductionRewarded(address indexed operator, address indexed validator, uint256 amount, uint256 elapsed, uint256 stake, uint256 reserve);
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
    event CommissionIncreaseAnnounced(address indexed validator, uint256 newCommissionBps, uint256 readyTime);
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
    // Self-bond a seat taken under the admission rule needs until the admins set
    // selfBondMinimum (see _minSelfBond).
    uint256 public constant DEFAULT_SELF_BOND_MINIMUM = 10000e18;
    // The longest interval one block is paid for by the emission schedule, and the year its
    // rate is quoted over.
    uint256 public constant MAX_CREDITED_GAP_SECONDS = 3600;
    uint256 public constant YEAR = 31536000;
    // The launch schedule recommitEmissionSchedule installs: 500k STRATO a year at 5M of
    // consensus weight with 8M in reserve.
    uint256 public constant RECOMMIT_E0 = 500000e18;
    uint256 public constant RECOMMIT_S0 = 5000000e18;
    uint256 public constant RECOMMIT_R0 = 8000000e18;

    Token public stratoToken;
    IERC20 public usdstToken;
    ValidatorRegistry public validatorRegistry;

    // Consensus integration. Governance (MercataGovernance, genesis address 0x100)
    // is only called while governanceSyncEnabled; the flag is the ops kill switch.
    // Two reads of governance's own state do not wait for it: the pin that excuses a
    // seat from the bond rule, and the published weights exceedsOneThird measures.
    // Staking calls governance directly — governance authorises this contract
    // through its stakingContract / onlyStaking pair — and governance is what
    // republishes weights as ValidatorStakeUpdated for consensus to read.
    address public governance;
    bool public governanceSyncEnabled;
    uint256 public minStake;              // the bar for seats held since before the self-bond rule (see _meetsMinStake)
    // Own bond a candidate, or a seat taken under the self-bond rule, needs (see _minSelfBond).
    // 0 = never set, read as DEFAULT_SELF_BOND_MINIMUM. Not named minSelfBond: an early V2
    // stored a field of that name, which a proxy upgraded in place may still hold.
    uint256 public selfBondMinimum;
    // Applies only to seats held since before the self-bond rule (see _meetsMinStake).
    // Until this time validators qualify on self-bond + delegated stake, the rule the first
    // validators were admitted under; from it on, minStake must be met by self-bond alone.
    // Zero means never set: a proxy upgraded in place keeps the old rule until the admins
    // choose a deadline. initialize() writes 1, so fresh deployments start on self-bond.
    uint256 public selfBondGraceUntil;
    uint256 public proposerFeeBps;        // share of each transaction fee routed here
    // Jailing is disabled, so these two are stored but not acted on, and jailedUntil is
    // never written: it only holds windows set before jailing was switched off.
    uint256 public maxConsecutiveMisses;
    uint256 public jailCooldown;

    // Consensus set size and admission.
    uint256 public maxActiveValidators;     // admin-chosen size of the active set
    uint256 public hardCapActiveValidators; // never exceeded (the node has a matching binary cap)
    uint256 public evictionMarginBps;       // a waiter must beat the lowest validator by this margin
    uint256 public maxSetMutationsPerBlock; // adds/removes per block (kicks bypass)
    uint256 public exitNoticeSeconds;
    uint256 public unkickCooldown;
    uint256 public maxOperatorStakeBps;     // inbound stake cap per validator (0 = off)
    uint256 public joinsOpenFromBlock;      // first block of permissionless activation (0 = not yet agreed)

    // The stake delay. New stake behind a validator (a delegation, the operator's bond,
    // stake moved from another validator) earns from the moment it arrives but counts
    // toward the validator's vote only after a wait, and a seat by right is taken with a
    // bond that has already waited. Without it, weight arrives in the block that brings
    // it: a third of the vote can be bought and used before anyone can respond, and a few
    // wei re-draw the next proposer.
    //
    // Time is cut into windows of stakeDelaySeconds. Stake that arrives in one window
    // counts from the start of the window after next, so the wait is between one and two
    // delays, and what is waiting is always the arrivals of the current window and the
    // one before it: two reads, no queue to walk, and nobody can push another's stake
    // back by adding their own. Stake that leaves takes the leaver's waiting stake first.
    //
    // 0 = off: stake counts at once. Changing the delay starts a new generation of
    // windows, so stake still waiting under the earlier setting counts at once.
    uint256 public stakeDelaySeconds;
    uint256 public stakeDelayGeneration;
    // validator => window => stake that arrived behind it in that window
    mapping(address => mapping(uint256 => uint256)) public pendingWeight;
    // delegator => validator => the delegator's two most recent windows of arrivals
    mapping(address => mapping(address => PendingStake)) public pendingStakeOf;
    // validator => the same for its operator's bond
    mapping(address => PendingStake) public pendingSelfBond;
    uint256 public validatorCount;
    uint256 public mutationBlock;
    uint256 public setMutationsThisBlock;
    mapping(address => uint256) public  exitReadyTime;
    mapping(address => uint256) public  kickedAt;
    mapping(address => bool) public  isValidator;
    // Seats taken under the self-bond rule; a seat held since before it reads false.
    mapping(address => bool) public  seatedUnderSelfBondRule;
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

    // Emission schedule: E0 STRATO a year at S0 of consensus weight with R0 in reserve, scaled
    // by sqrt(S / S0) and R / R0 (see _emission). Committed once, and replaced once by the
    // launch schedule (recommitEmissionSchedule). The reserve leaves only
    // through _payProduction and is kept out of reward payouts and recoverable STRATO. Not
    // named rewardReserve: the retired schedule kept its reserve under that name, and SolidVM
    // storage is keyed by name.
    uint256 public emissionReserve;
    uint256 public emissionRateE0;
    uint256 public emissionStakeS0;
    uint256 public emissionReserveR0;
    uint256 public emissionStartTime;       // 0 = not committed
    bool public emissionRecommitted;        // the launch schedule has replaced the first
    uint256 public totalEmitted;
    // The last processed block's timestamp, and the highest one before it: the interval the
    // last block closed. previousBlockTime never moves back, so no time is paid twice.
    uint256 public lastBlockTime;
    uint256 public previousBlockTime;

    // Discretionary rewards in tokens other than STRATO and USDST, owed to operators:
    // operator => token => amount. Keyed by the operator account rather than the validator, so
    // a later change of operator never hands accrued rewards to the successor.
    mapping(address => mapping(address => uint256)) public  pendingOperatorTokenRewards;
    // Unclaimed discretionary rewards per token; kept out of recoverStrayToken.
    mapping(address => uint256) public  tokenRewardLiability;

    // Final indexes of the retired reward schedule. Frozen; read only by _settleRetiredSchedule.
    uint256 public baseRewardPerOperatorStored;
    uint256 public globalStakeRewardPerTokenStored;

    // An operator's announced commission raise and when it may be applied (0 = none).
    mapping(address => uint256) public  announcedCommissionBps;
    mapping(address => uint256) public  announcedCommissionTime;

    // user => validator => time until which stake moved onto the validator cannot be
    // moved on again.
    mapping(address => mapping(address => uint256)) public  moveLockedUntil;

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

    // Set the own bond a candidate, or a seat taken under the self-bond rule, needs. A higher
    // bar applies to the set at once: such seats that fall short leave, as far as this
    // block's change budget allows. Seats held since before the rule stay on minStake.
    function setSelfBondMinimum(uint256 _selfBondMinimum) external onlyOwner onlyInitialized {
        require(_selfBondMinimum > 0, "SS: self-bond minimum=0");
        selfBondMinimum = _selfBondMinimum;
        emit SelfBondMinimumSet(_selfBondMinimum);
        _syncAllValidators();
    }

    function setSetParams(
        uint256 _maxActiveValidators,
        uint256 _hardCapActiveValidators,
        uint256 _evictionMarginBps,
        uint256 _maxSetMutationsPerBlock,
        uint256 _exitNoticeSeconds,
        uint256 _unkickCooldown,
        uint256 _maxOperatorStakeBps
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
        emit SetParamsUpdated(_maxActiveValidators, _hardCapActiveValidators, _evictionMarginBps, _maxSetMutationsPerBlock, _exitNoticeSeconds, _unkickCooldown, _maxOperatorStakeBps);
    }

    // Agree the block from which anyone may seat an eligible validator. It can be set, or
    // moved, only to a future block and only until it is reached; admission then stays open.
    function setJoinsOpenFromBlock(uint256 _joinsOpenFromBlock) external onlyOwner onlyInitialized {
        require(joinsOpenFromBlock == 0 || block.number < joinsOpenFromBlock, "SS: joins already open");
        require(_joinsOpenFromBlock > block.number, "SS: block passed");
        joinsOpenFromBlock = _joinsOpenFromBlock;
        emit JoinsOpenFromBlockSet(_joinsOpenFromBlock);
    }

    // Set the wait before new stake counts toward a vote (0 = off). The change starts a
    // new generation of windows, so stake waiting under the earlier setting counts at once;
    // every seated validator's weight is republished.
    function setStakeDelay(uint256 _stakeDelaySeconds) external onlyOwner onlyInitialized {
        stakeDelaySeconds = _stakeDelaySeconds;
        stakeDelayGeneration += 1;
        emit StakeDelaySet(_stakeDelaySeconds);
        _syncAllValidators();
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

    // All the stake behind a validator: what it earns on, and what the stake cap and the
    // emission rate measure.
    function _validatorWeight(StakingValidator storage v) internal view returns (uint256) {
        return v.selfBond + v.delegatedStake;
    }

    // ---- stake delay ---------------------------------------------------------------

    uint256 constant WINDOW_SPAN = 2 ** 64;

    // The current window: the generation in the high part, so windows of an earlier
    // setting are never adjacent to this one.
    function _window() internal view returns (uint256) {
        return stakeDelayGeneration * WINDOW_SPAN + block.timestamp / stakeDelaySeconds;
    }

    // Stake behind a validator that does not count toward its vote yet: the arrivals of
    // the current window and the one before it.
    function _unmatured(address validator) internal view returns (uint256) {
        if (stakeDelaySeconds == 0) return 0;
        uint256 w = _window();
        uint256 waiting = pendingWeight[validator][w];
        if (w > 0) waiting += pendingWeight[validator][w - 1];
        return waiting;
    }

    // What a validator votes with: its stake less what is still waiting. This is the
    // weight published to governance and the one seats are compared by.
    function _votingWeight(address validator) internal view returns (uint256) {
        uint256 weight = _validatorWeight(operators[validator]);
        uint256 waiting = _unmatured(validator);
        return waiting >= weight ? 0 : weight - waiting;
    }

    function votingWeight(address validator) external view returns (uint256) {
        return _votingWeight(validator);
    }

    function unmaturedStake(address validator) external view returns (uint256) {
        return _unmatured(validator);
    }

    // How much of a staker's stake behind a validator is still waiting.
    function _waiting(PendingStake storage p) internal view returns (uint256) {
        if (stakeDelaySeconds == 0) return 0;
        uint256 w = _window();
        if (p.newWindow == w) {
            if (w > 0 && p.oldWindow == w - 1) return p.newAmount + p.oldAmount;
            return p.newAmount;
        }
        if (w > 0 && p.newWindow == w - 1) return p.newAmount;
        return 0;
    }

    // Stake arrives: it waits from the current window.
    function _notePending(PendingStake storage p, address validator, uint256 amount) internal {
        if (stakeDelaySeconds == 0) return;
        uint256 w = _window();
        if (p.newWindow != w) {
            if (p.newWindow + 1 == w) {
                // `+ 0` materialises the slot as a value. A storage-to-storage copy of an
                // unwritten (zero) scalar is a silent no-op in SolidVM, which would leave a
                // stale oldAmount/oldWindow behind when newAmount is 0 (same idiom as
                // ValidatorRegistry.operatorAuthorizationDigest). Not redundant.
                p.oldWindow = p.newWindow + 0;
                p.oldAmount = p.newAmount + 0;
            } else {
                p.oldWindow = 0;
                p.oldAmount = 0;
            }
            p.newWindow = w;
            p.newAmount = 0;
        }
        p.newAmount += amount;
        pendingWeight[validator][w] += amount;
    }

    // Stake leaves: the leaver's waiting stake goes first, newest first, so taking back a
    // stake that never counted takes nothing from the vote.
    function _dropPending(PendingStake storage p, address validator, uint256 amount) internal {
        if (stakeDelaySeconds == 0) return;
        uint256 w = _window();
        bool newWaits = p.newWindow == w || (w > 0 && p.newWindow == w - 1);
        if (newWaits && p.newAmount > 0) {
            uint256 take = amount < p.newAmount ? amount : p.newAmount;
            p.newAmount -= take;
            pendingWeight[validator][p.newWindow] -= take;
            amount -= take;
        }
        if (amount > 0 && p.newWindow == w && w > 0 && p.oldWindow == w - 1 && p.oldAmount > 0) {
            uint256 takeOld = amount < p.oldAmount ? amount : p.oldAmount;
            p.oldAmount -= takeOld;
            pendingWeight[validator][p.oldWindow] -= takeOld;
        }
    }

    // A seat by right is taken with a bond that already counts: the delay covers a new
    // seat as it covers new stake, or a join would go around it.
    function _bondMatured(address validator) internal view returns (bool) {
        uint256 bond = operators[validator].selfBond;
        uint256 waiting = _waiting(pendingSelfBond[validator]);
        return bond >= waiting && bond - waiting >= _minSelfBond();
    }

    // A seat taken under this logic, and any candidate for one, needs _minSelfBond() of the
    // operator's own bond: delegations add weight but never qualify it. A seat held since
    // before the rule keeps the one it was admitted under (minStake, with selfBondGraceUntil)
    // until the validator leaves the set or changes operator.
    function _meetsMinStake(address validator, StakingValidator storage v) internal view returns (bool) {
        if (!isValidator[validator] || seatedUnderSelfBondRule[validator]) {
            return v.selfBond >= _minSelfBond();
        }
        if (selfBondGraceUntil == 0 || block.timestamp < selfBondGraceUntil) {
            return _validatorWeight(v) >= minStake;
        }
        return v.selfBond >= minStake;
    }

    // Virtual so a test harness can price it in small amounts.
    function _minSelfBond() internal view virtual returns (uint256) {
        return selfBondMinimum == 0 ? DEFAULT_SELF_BOND_MINIMUM : selfBondMinimum;
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
        return _meetsMinStake(validator, v)
            && block.timestamp >= jailedUntil[validator]
            && (exitReadyTime[validator] == 0 || block.timestamp < exitReadyTime[validator]);
    }

    // A waiter is eligible but not in the set; promotion is explicit (tryActivate / reconcileSet).
    // A validator the admins pinned out is never a waiter, nor is a seat governance lists and
    // never handed to staking (see _handedToStaking).
    function isWaiter(address validator) public view returns (bool) {
        return eligible(validator) && !isValidator[validator] && !_pinnedOut(validator) && !_heldByGovernance(validator) && _bondMatured(validator);
    }

    // Admin pins, read from governance (see MercataGovernance.pinnedIn / pinnedOut).
    function _pinnedIn(address validator) internal view returns (bool) {
        return governanceSyncEnabled && IStakingGovernance(governance).pinnedIn(validator);
    }

    function _pinnedOut(address validator) internal view returns (bool) {
        return governanceSyncEnabled && IStakingGovernance(governance).pinnedOut(validator);
    }

    // A seat governance lists and staking does not hold is staking's to take only when the
    // admins pinned it in or a vote clearing the pin handed it back. Any other (an admin seat
    // from before the pins) is left alone: taking it would let anyone's sync remove it.
    function _handedToStaking(address validator) internal view returns (bool) {
        return IStakingGovernance(governance).pinnedIn(validator) || IStakingGovernance(governance).stakingManaged(validator);
    }

    function _heldByGovernance(address validator) internal view returns (bool) {
        return IStakingGovernance(governance).validatorMap(validator) > 0 && !_handedToStaking(validator);
    }

    // All the stake behind the consensus set, waiting or not: what the emission rate and
    // the stake cap measure. Stake behind listed validators outside the set carries no
    // vote, so it is left out.
    function consensusWeight() public view returns (uint256 total) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            total += _validatorWeight(operators[activeValidators[i]]);
        }
    }

    // More than a third of the vote: can stall a stake-weighted quorum. Measured on the
    // weights governance holds, which are the ones consensus counts. This contract's own
    // figures can run ahead of them: stake that has finished waiting counts here at once
    // and in consensus from the validator's next sync.
    function exceedsOneThird(address validator) external view returns (bool) {
        if (governance == address(0)) return false;
        uint256 total = 0;
        uint256 members = IStakingGovernance(governance).validatorCount();
        for (uint256 i = 0; i < members; i++) {
            total += IStakingGovernance(governance).validatorStake(IStakingGovernance(governance).validators(i));
        }
        return IStakingGovernance(governance).validatorStake(validator) * 3 > total;
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

    function _mutationsLeft() internal view returns (uint256) {
        uint256 cap = _mutationCap();
        if (mutationBlock != block.number) return cap;
        if (setMutationsThisBlock >= cap) return 0;
        return cap - setMutationsThisBlock;
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
        seatedUnderSelfBondRule[validator] = true;
        lastSyncedWeight[validator] = weight;
        validatorCount += 1;
        if (activeValidatorIndex[validator] == 0) {
            activeValidators.push(validator);
            activeValidatorIndex[validator] = activeValidators.length;
        }
    }

    // An exit notice outlives the seat: until its operator cancels it, the validator is not
    // eligible, so nobody's tryActivate or reconcileSet can put it back in the set.
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
    // activeValidators. Permissionless and idempotent. Read the full set from governance
    // so a caller cannot index just one member and publish a partial weight vector; all
    // weights are then synced together. Until it runs, set-wide passes see no members,
    // which fails safe (no resync, no eviction).
    function indexValidatorSet() external onlyInitialized {
        require(governanceSyncEnabled, "SS: governance sync off");
        uint256 count = IStakingGovernance(governance).validatorCount();
        for (uint256 i = 0; i < count; i++) {
            address validator = IStakingGovernance(governance).validators(i);
            require(isValidator[validator], "SS: validator not seated here");
            if (activeValidatorIndex[validator] == 0) {
                activeValidators.push(validator);
                activeValidatorIndex[validator] = activeValidators.length;
            }
        }
        emit ValidatorSetIndexed(activeValidators.length);
        _syncAllValidators();
        // The sync leaves a member without a weight when it no longer qualifies and
        // governance refuses to drop it (a seat staking never managed, or the last one).
        // Its peers' weights alone would be a partial vector, so nothing is published.
        count = IStakingGovernance(governance).validatorCount();
        for (uint256 i = 0; i < count; i++) {
            require(IStakingGovernance(governance).validatorStake(IStakingGovernance(governance).validators(i)) > 0, "SS: validator without weight");
        }
    }

    function _activate(address validator) internal {
        uint256 weight = _votingWeight(validator);
        // The door check. A newcomer's weight is published beside the weights of the
        // validators governance already lists. If one of those has none (a seat whose
        // stake was never put on record, as before the weight snapshot), the newcomer's
        // would be the only vote that counts, so nobody new is seated until every member
        // has a weight. A validator governance already lists (a genesis seat, an admin
        // pin) adds no member and is not held to this. A pinned member staking holds is not
        // counted: it stays whatever its stake, so one whose stake has run out would close the
        // door to everyone. One staking has not taken yet still counts until its first sync,
        // so a pin cannot open the door before its seat's weight is known.
        if (IStakingGovernance(governance).validatorMap(validator) == 0) {
            uint256 members = IStakingGovernance(governance).validatorCount();
            for (uint256 i = 0; i < members; i++) {
                address member = IStakingGovernance(governance).validators(i);
                if (_pinnedIn(member) && isValidator[member]) continue;
                require(IStakingGovernance(governance).validatorStake(member) > 0, "SS: validator without weight");
            }
        }
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
    // eligible (same transaction), refresh the weight otherwise. A leave is never held
    // back by the block's allowance of set changes and does not use it up: the allowance
    // cannot stop a validator switching off, only stop the chain recording that it left,
    // and a seat kept past its bond is retried by nobody. Joining is never implicit,
    // except into a seat governance already gave the validator (an admin pin).
    function _syncValidator(address validator) internal {
        if (!governanceSyncEnabled) return;
        if (!isValidator[validator]) {
            // Governance lists it but staking never seated it. A seat handed to staking (pinned
            // in, or handed back by a vote clearing the pin) is taken here too, whatever its
            // eligibility, so its stake is published as its weight and, without a pin, the
            // rules below decide whether it stays. Not a mutation: governance has already
            // changed the set.
            if (!operators[validator].active || IStakingGovernance(governance).validatorMap(validator) == 0 || !_handedToStaking(validator)) return;
            _activate(validator);
        }
        // Governance decides who is in the consensus set. A validator it no longer
        // lists (an admin vote removed it) gives up its seat here: adding it back
        // would undo the vote, and anyone can trigger a sync.
        if (IStakingGovernance(governance).validatorMap(validator) == 0) {
            _unseat(validator);
            emit ValidatorSynced(operatorOf(validator), validator, false, 0);
            return;
        }
        // A pinned seat stays, and its weight is still republished below.
        if (!eligible(validator) && !_pinnedIn(validator)) {
            _deactivate(validator);
            return;
        }
        // A seated member absent from the index predates the backfill. Do not publish
        // its weight alone; indexValidatorSet syncs the whole governance set at once.
        if (activeValidatorIndex[validator] == 0) return;
        // Stake that is still waiting (see stakeDelaySeconds) is left out. It joins the
        // weight at the first sync after its wait is over; anyone may call syncValidator.
        uint256 weight = _votingWeight(validator);

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

    // After the operator's own bond has been released (unbondSelf, a handover) and the
    // validator synced. A seat that no longer qualifies has left in that sync, with two
    // exceptions where it cannot: governance will not drop its last validator, and with
    // the governance link off no seat can be given up. In both the bond stays in, so a
    // seat never votes without it. A seat that predates the index backfill has no weight
    // published by this contract to outlive its bond. A seat the admins pinned stays by
    // their vote, not by its bond, so the pin is read from governance whether or not the
    // link is on. A delegator's unstake is never refused.
    function _requireNoSeatWithoutBond(address validator) internal view {
        if (!isValidator[validator] || eligible(validator) || activeValidatorIndex[validator] == 0) return;
        require(governance != address(0) && IStakingGovernance(governance).pinnedIn(validator), "SS: cannot leave the set");
    }

    // Lowest validator by (weight asc, address asc): the eviction candidate. A pinned seat
    // is never one.
    function _lowestValidator() internal view returns (address lowest, uint256 lowestWeight) {
        for (uint256 i = 0; i < activeValidators.length; i++) {
            address validator = activeValidators[i];
            if (_pinnedIn(validator)) continue;
            uint256 w = _votingWeight(validator);
            if (lowest == address(0) || w < lowestWeight || (w == lowestWeight && uint256(validator) < uint256(lowest))) {
                lowest = validator;
                lowestWeight = w;
            }
        }
    }

    // Best waiter among `candidates` by (weight desc, address asc): the promotion candidate.
    // A waiter the stake cap would refuse a seat is passed over, as tryActivate refuses it.
    function _bestWaiter(address[] memory candidates) internal view returns (address best, uint256 bestWeight) {
        for (uint256 i = 0; i < candidates.length; i++) {
            address validator = candidates[i];
            if (!isWaiter(validator) || !_admissibleUnderCap(validator)) continue;
            uint256 w = _votingWeight(validator);
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

    // Put an eligible validator into the consensus set: into a free slot, or by evicting
    // the lowest validator it beats by evictionMarginBps. Anyone may call once joins are
    // open.
    function tryActivate(address validator) external onlyInitialized onlyListed(validator) {
        _requireJoinsOpen();
        require(!isValidator[validator], "SS: already active");
        require(eligible(validator), "SS: not eligible");
        require(!_pinnedOut(validator), "SS: pinned out by governance");
        if (IStakingGovernance(governance).validatorMap(validator) > 0) {
            // Already in governance's set: no slot to find and nobody to evict, but only a
            // seat handed to staking is staking's to take.
            require(_handedToStaking(validator), "SS: governance seat not handed to staking");
            _activate(validator);
            return;
        }
        require(_bondMatured(validator), "SS: bond not matured");

        if (validatorCount < effectiveCap()) {
            _consumeMutations(1);
            _activate(validator);
        } else {
            (address lowest, uint256 lowestWeight) = _lowestValidator();
            uint256 weight = _votingWeight(validator);
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

    // Inbound stake may not push a validator above maxOperatorStakeBps of the consensus
    // set's weight (grandfathered validators simply cannot receive more). A validator
    // outside the set is measured as if it had joined. No cap while the set is empty.
    function _withinStakeCap(address validator) internal view returns (bool) {
        if (maxOperatorStakeBps == 0) return true;
        uint256 total = consensusWeight();
        if (total == 0) return true;
        return _shareWithinCap(validator, total);
    }

    // A seat is held to the cap with no exemption: a newcomer to a set holding no stake would
    // hold all of it. This is what tryActivate's check after seating applies.
    function _admissibleUnderCap(address validator) internal view returns (bool) {
        return maxOperatorStakeBps == 0 || _shareWithinCap(validator, consensusWeight());
    }

    function _shareWithinCap(address validator, uint256 total) internal view returns (bool) {
        uint256 weight = _validatorWeight(operators[validator]);
        if (!isValidator[validator]) total += weight;
        return weight * BPS_DIVISOR <= total * maxOperatorStakeBps;
    }

    function _requireWithinStakeCap(address validator) internal view {
        require(_withinStakeCap(validator), "SS: above operator stake cap");
    }

    // An active validator announces it will leave; it keeps serving for exitNoticeSeconds,
    // after which any sync (or syncValidator) takes it out of the set. Self-bond stays bonded,
    // and the validator stays out until its operator cancels the exit.
    function requestExit(address validator) external onlyInitialized onlyOperatorOf(validator) {
        require(isValidator[validator], "SS: not active");
        require(exitReadyTime[validator] == 0, "SS: exit pending");
        exitReadyTime[validator] = block.timestamp + exitNoticeSeconds;
        emit ExitRequested(msg.sender, validator, exitReadyTime[validator]);
    }

    // Withdraws a pending notice, or, once the validator has left, makes it eligible again.
    function cancelExit(address validator) external onlyInitialized onlyOperatorOf(validator) {
        require(exitReadyTime[validator] != 0, "SS: no exit pending");
        exitReadyTime[validator] = 0;
        emit ExitCancelled(msg.sender, validator);
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

    // Permissionless resync (e.g. once an exit notice is up).
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
        // Whatever the reward bookkeeping says is owed, rewards are never paid out of
        // staked or unbonding principal, or out of the unreleased emission reserve.
        require(IERC20(address(stratoToken)).balanceOf(address(this)) >= principalBalance() + emissionReserve + amount, "SS: rewards unavailable");
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
        _dropPending(pendingSelfBond[validator], validator, amount);

        uint256 requestId = _createUnbondRequest(to, amount);
        emit SelfBondUnbondingStarted(to, validator, requestId, amount, block.timestamp + unbondingSeconds);
    }

    // A new operator takes over a record. What the outgoing operator owns leaves with it:
    // its self-bond is queued for unbonding to it and its accrued rewards and fees are paid
    // out, so the incoming operator starts from zero. A seat it takes over is held under the
    // self-bond rule from then on.
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
        seatedUnderSelfBondRule[validator] = true;

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
        // A kick leaves the set immediately, is not bounded by the mutation cap, and
        // overrides an admin pin (governance drops the pin with the seat).
        if (governanceSyncEnabled && IStakingGovernance(governance).removeKickedValidator(validator) && isValidator[validator]) {
            _unseat(validator);
            emit ValidatorSynced(operatorOf(validator), validator, false, 0);
        }
        emit ValidatorRecordSynced(validator, operatorOf(validator), false, v.commissionBps);
    }

    function syncValidatorOperator(address validator, address operator) external onlyInitialized onlyValidatorRegistry onlyListed(validator) {
        require(operator != address(0), "SS: operator=0");
        _changeOperator(validator, operator);
        _syncValidator(validator);
        _requireNoSeatWithoutBond(validator);
    }

    // ---- commission ------------------------------------------------------------------

    // An operator lowers its commission at once. Raising it takes two calls with the same
    // value, unbondingSeconds apart: the first announces the raise, so delegators can
    // leave before it is charged, and the second applies it.
    function setCommissionBps(address validator, uint256 newCommissionBps) external onlyInitialized onlyOperatorOf(validator) {
        require(operators[validator].active, "SS: validator inactive");
        require(newCommissionBps <= maxCommissionBps, "SS: commission too high");
        if (newCommissionBps > operators[validator].commissionBps) {
            if (announcedCommissionTime[validator] == 0 || announcedCommissionBps[validator] != newCommissionBps) {
                announcedCommissionBps[validator] = newCommissionBps;
                announcedCommissionTime[validator] = block.timestamp + unbondingSeconds;
                emit CommissionIncreaseAnnounced(validator, newCommissionBps, announcedCommissionTime[validator]);
                return;
            }
            require(block.timestamp >= announcedCommissionTime[validator], "SS: commission notice running");
        }
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
        announcedCommissionTime[validator] = 0;
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
        _notePending(pendingStakeOf[msg.sender][validator], validator, received);

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
        // Moving is instant, so without this a delegator could follow each block's
        // proposer around and collect a share of every validator's income. Stake on a
        // delisted validator can always be moved away.
        require(!operators[fromValidator].active || block.timestamp >= moveLockedUntil[msg.sender][fromValidator], "SS: stake recently moved");
        moveLockedUntil[msg.sender][toValidator] = block.timestamp + unbondingSeconds;

        // Moved stake is new stake where it lands: it waits there like any other arrival.
        _moveDelegation(msg.sender, fromValidator, toValidator, amount, true);
        _requireWithinStakeCap(toValidator);
        _syncValidator(fromValidator);
        _syncValidator(toValidator);
    }

    // Take a delegator's stake from behind one record and put it behind another, with its
    // rewards settled on both first. `waits` says whether it arrives as new stake (see
    // stakeDelaySeconds). The target must be listed.
    function _moveDelegation(address delegator, address fromValidator, address toValidator, uint256 amount, bool waits) internal {
        _updateUser(delegator, fromValidator);
        _updateUser(delegator, toValidator);

        delegatedStake[delegator][fromValidator] -= amount;
        operators[fromValidator].delegatedStake -= amount;
        if (operators[fromValidator].active) totalRewardableStake -= amount;
        _dropPending(pendingStakeOf[delegator][fromValidator], fromValidator, amount);

        delegatedStake[delegator][toValidator] += amount;
        operators[toValidator].delegatedStake += amount;
        totalRewardableStake += amount;
        if (waits) _notePending(pendingStakeOf[delegator][toValidator], toValidator, amount);

        emit StakeMoved(delegator, fromValidator, toValidator, amount);
    }

    // Re-file delegations from one record onto the validators of the same operator, an
    // equal share to each (the first named takes the remainder).
    //
    // For a network upgraded in place from the operator-keyed layout, where an operator's
    // record is keyed by its own address and its consensus validators are other addresses:
    // the delegators' stake sits behind a record nobody votes with, and the operator's
    // validators have none. Waiting for each delegator to move would bring the weights in
    // piecemeal and leave them to whoever holds the most.
    //
    // - The owner names the delegators, since the contract keeps no list of them, at most
    //   maxBatchSize a call. One with nothing behind the record is skipped, so a batch can
    //   be sent again.
    // - Stake only moves between records of one operator, so no delegator ends up behind an
    //   operator it did not choose. What a delegator earned behind the old record stays
    //   claimable there.
    // - It is a re-filing, not new stake: it counts at once and sets no move lock.
    // - A validator governance lists and staking has not seated is taken into staking's set
    //   only once pinned in or handed back, and a handed-back one leaves at its first sync if
    //   nothing holds it there. So such a validator must be pinned before stake is filed
    //   behind it.
    function refileStake(address fromRecord, address[] calldata toValidators, address[] calldata delegators) external onlyOwner onlyInitialized onlyListed(fromRecord) {
        require(toValidators.length > 0 && toValidators.length <= maxBatchSize, "SS: bad validators");
        require(delegators.length > 0 && delegators.length <= maxBatchSize, "SS: bad batch");
        address operator = operatorOf(fromRecord);
        for (uint256 i = 0; i < toValidators.length; i++) {
            address to = toValidators[i];
            require(to != fromRecord, "SS: same validator");
            require(operators[to].exists && operators[to].active, "SS: target inactive");
            require(operatorOf(to) == operator, "SS: another operator's validator");
            for (uint256 j = 0; j < i; j++) {
                require(toValidators[j] != to, "SS: duplicate validator");
            }
            if (governanceSyncEnabled && !isValidator[to] && IStakingGovernance(governance).validatorMap(to) > 0) {
                require(_pinnedIn(to), "SS: pin the validator first");
            }
        }

        uint256 moved = 0;
        for (uint256 d = 0; d < delegators.length; d++) {
            uint256 amount = delegatedStake[delegators[d]][fromRecord];
            if (amount == 0) continue;
            uint256 share = amount / toValidators.length;
            _moveDelegation(delegators[d], fromRecord, toValidators[0], amount - share * (toValidators.length - 1), false);
            if (share > 0) {
                for (uint256 k = 1; k < toValidators.length; k++) {
                    _moveDelegation(delegators[d], fromRecord, toValidators[k], share, false);
                }
            }
            moved += amount;
        }

        emit StakeRefiled(fromRecord, toValidators.length, delegators.length, moved);
        _syncValidator(fromRecord);
        for (uint256 s = 0; s < toValidators.length; s++) {
            _syncValidator(toValidators[s]);
        }
    }

    function unstake(address validator, uint256 amount) external onlyInitialized onlyListed(validator) {
        require(amount > 0, "SS: amount=0");
        require(delegatedStake[msg.sender][validator] >= amount, "SS: insufficient stake");

        _updateUser(msg.sender, validator);

        delegatedStake[msg.sender][validator] -= amount;
        operators[validator].delegatedStake -= amount;
        totalUserStake -= amount;
        if (operators[validator].active) totalRewardableStake -= amount;
        _dropPending(pendingStakeOf[msg.sender][validator], validator, amount);

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
        _notePending(pendingSelfBond[validator], validator, received);

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
        _dropPending(pendingSelfBond[validator], validator, amount);

        uint256 requestId = _createUnbondRequest(msg.sender, amount);

        emit SelfBondUnbondingStarted(msg.sender, validator, requestId, amount, block.timestamp + unbondingSeconds);
        _syncValidator(validator);
        _requireNoSeatWithoutBond(validator);
    }

    // ---- block rewards, fee routing and liveness ----------------------------------------

    // Block rewards arrive from FeeRouter.payBlockRewards, once per block for block.proposer.
    // The router approves `amount` and this pulls it, so a credit can never exceed what was
    // actually paid in; anyone else calling it simply adds their own STRATO to a validator's
    // income. The router catches a failure, and a SolidVM catch does not roll back, so every
    // check that can fail runs before the first write.
    //
    // Disabled: the emission schedule pays block producers, so the flat reward is refused
    // and stays with the router. Kept so the router's call resolves and v2 stays detectable.
    function creditBlockReward(address validator, uint256 amount) external onlyInitialized {
        require(false, "SS: block reward disabled");
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
            // retry. Everything after this point is local writes.
            address actual = block.prevProposer;
            address intended = block.prevIntendedProposer;
            lastProcessedBlock = block.number;
            _processPrevBlock(actual, intended);
            _payProduction(actual);
            if (lastBlockTime > previousBlockTime) previousBlockTime = lastBlockTime;
            lastBlockTime = block.timestamp;
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
        // A delisted validator governance kept in the set earns nothing.
        if (!v.exists || !v.active) {
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
    // carries no signed "missed" evidence), so it only costs the block's income
    // and feeds the dashboard. No tokens move and the set does not change.
    function _processPrevBlock(address actual, address intended) internal {
        if (actual != address(0)) {
            blocksProposed[actual] += 1;
            consecutiveMisses[actual] = 0;
        }
        if (intended == address(0) || intended == actual) return;

        missedProposals[intended] += 1;
        consecutiveMisses[intended] += 1;
        emit ProposalMissed(intended, operatorOf(intended), block.number - 1);
    }

    // ---- emission schedule -------------------------------------------------------------

    // Pay the previous block's producer the schedule's release for the interval its block
    // closed (from the highest earlier block timestamp, or the start if later), at most
    // MAX_CREDITED_GAP_SECONDS. Block timestamps are set by proposers: one behind its parent
    // closes no interval, and the cap bounds one ahead of it. The rate is the formula at the
    // current consensus weight and reserve. Pay follows the seat: a producer that is seated
    // and listed is paid, whichever rule or admin pin gave it the seat. The own-bond rule
    // gates holding a seat by right (eligible), not being paid for the blocks it produces.
    // A producer that is not seated or not listed is paid nothing; what is not paid stays
    // in the reserve.
    function _payProduction(address producer) internal {
        if (producer == address(0) || emissionStartTime == 0 || previousBlockTime == 0) return;
        uint256 since = previousBlockTime > emissionStartTime ? previousBlockTime : emissionStartTime;
        if (lastBlockTime <= since) return;
        uint256 elapsed = lastBlockTime - since;
        if (elapsed > MAX_CREDITED_GAP_SECONDS) elapsed = MAX_CREDITED_GAP_SECONDS;

        if (!isValidator[producer] || !operators[producer].active) return;
        uint256 stake = consensusWeight();
        uint256 reserve = emissionReserve;
        if (stake == 0 || reserve == 0) return;
        uint256 amount = _emission(stake, reserve, elapsed);
        if (amount > reserve) amount = reserve;
        if (amount == 0) return;

        StakingValidator storage v = operators[producer];
        _settleRetiredSchedule(v);
        _creditRewards(v, amount);
        emissionReserve = reserve - amount;
        allocatedRewardLiability += amount;
        totalEmitted += amount;
        emit ProductionRewarded(operatorOf(producer), producer, amount, elapsed, stake, emissionReserve);
    }

    // E0 * sqrt(S / S0) * (R / R0) a year, over `elapsed` seconds. sqrt(S / S0) is taken as
    // sqrt(S * S0) / S0 so the integer root keeps its precision.
    function _emission(uint256 stake, uint256 reserve, uint256 elapsed) internal view returns (uint256) {
        uint256 annual = (emissionRateE0 * _sqrt(stake * emissionStakeS0)) / emissionStakeS0;
        annual = (annual * reserve) / emissionReserveR0;
        return (annual * elapsed) / YEAR;
    }

    // The yearly release at the current consensus weight and reserve (0 before the commitment).
    function emissionAnnualRate() external view returns (uint256) {
        if (emissionStartTime == 0) return 0;
        uint256 stake = consensusWeight();
        if (stake == 0 || emissionReserve == 0) return 0;
        return _emission(stake, emissionReserve, YEAR);
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

    // Commit the schedule, once: e0 STRATO a year at s0 of consensus weight with r0 in
    // reserve, from startTime (a past time means now). The reserve must already hold r0, so
    // what is advertised is funded. There is no pause or restart, no re-calibration beyond
    // the one recommitEmissionSchedule makes, and no owner call takes the reserve back;
    // later top-ups only raise R.
    function commitEmissionSchedule(uint256 e0, uint256 s0, uint256 r0, uint256 startTime) external onlyOwner onlyInitialized {
        require(emissionStartTime == 0, "SS: schedule committed");
        require(e0 > 0 && s0 > 0 && r0 > 0, "SS: bad schedule");
        require(emissionReserve >= r0, "SS: reserve unfunded");
        emissionRateE0 = e0;
        emissionStakeS0 = s0;
        emissionReserveR0 = r0;
        emissionStartTime = startTime > block.timestamp ? startTime : block.timestamp;
        emit EmissionScheduleCommitted(e0, s0, r0, emissionStartTime);
    }

    // Replace the committed schedule with the launch one, once. STRATO sent straight to this
    // contract (owed to nobody, see recoverableUntrackedStrato) joins the reserve in the same
    // call, so a reserve that large is never priced against the old R0. The reserve must then
    // hold RECOMMIT_R0, so what is advertised is funded; that also refuses a recommit made
    // before that STRATO arrives. The start time and everything already paid or owed stay as
    // they are.
    function recommitEmissionSchedule() external onlyOwner onlyInitialized {
        require(emissionStartTime != 0, "SS: schedule not committed");
        require(!emissionRecommitted, "SS: recommitted");
        uint256 swept = recoverableUntrackedStrato();
        uint256 reserve = emissionReserve + swept;
        require(reserve >= RECOMMIT_R0, "SS: reserve unfunded");
        emissionRecommitted = true;
        emissionReserve = reserve;
        emissionRateE0 = RECOMMIT_E0;
        emissionStakeS0 = RECOMMIT_S0;
        emissionReserveR0 = RECOMMIT_R0;
        emit EmissionScheduleRecommitted(RECOMMIT_E0, RECOMMIT_S0, RECOMMIT_R0, swept, reserve);
    }

    // Add STRATO to the emission reserve, pulled from the caller (approve this contract
    // first). Anyone may fund it, before or after the commitment; nothing takes it back out.
    function fundEmissionReserve(uint256 amount) external onlyInitialized {
        uint256 received = _pullReward(address(stratoToken), amount);
        emissionReserve += received;
        emit EmissionReserveFunded(msg.sender, received, emissionReserve);
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

    // STRATO held beyond principal, unclaimed rewards and the emission reserve (including
    // anything left in the retired schedule's reserve).
    function recoverableUntrackedStrato() public view returns (uint256) {
        uint256 balance = IERC20(address(stratoToken)).balanceOf(address(this));
        uint256 tracked = principalBalance() + allocatedRewardLiability + emissionReserve;
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
