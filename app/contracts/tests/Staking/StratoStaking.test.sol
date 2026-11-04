// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/StratoStaking.sol";
import "../../concrete/Staking/ValidatorRegistry.sol";
import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Util.sol";

// Reproduces state that only a proxy upgraded in place can hold: fields the current
// initialize() always writes, records without an operator field, a consensus set that
// predates its index, seats that predate the self-bond rule, requests the previous logic
// queued, and the retired reward schedule's leftovers. Scales the self-bond minimum down so
// the suite's amounts stay small.
contract UpgradedInPlaceStaking is StratoStaking {
    constructor(address initialOwner) StratoStaking(initialOwner) { }

    function minStake() public view override returns (uint256) {
        return 1000e18;
    }

    function forgetUsdst() public {
        usdstToken = IERC20(address(0));
    }

    function forgetOperatorField(address validator) public {
        operators[validator].operator = address(0);
    }

    // A seat held since before this logic: admitted on self-bond plus delegations.
    function forgetSelfBondRule(address validator) public {
        seatedUnderSelfBondRule[validator] = false;
    }

    function forgetSetIndex() public {
        while (activeValidators.length > 0) {
            uint256 last = activeValidators.length;
            activeValidatorIndex[activeValidators[last - 1]] = 0;
            activeValidators[last - 1] = address(0);
            activeValidators.length--;
        }
    }

    function seedRetiredSchedule(uint256 baseIndex, uint256 stakeIndex, uint256 liability) public {
        baseRewardPerOperatorStored = baseIndex;
        globalStakeRewardPerTokenStored = stakeIndex;
        allocatedRewardLiability += liability;
    }

    function seedRetiredCheckpoints(address validator, uint256 basePaid, uint256 stakePaid, uint256 pendingBase) public {
        operators[validator].baseRewardPerOperatorPaid = basePaid;
        operators[validator].stakeRewardPerTokenPaid = stakePaid;
        operators[validator].pendingBaseRewards = pendingBase;
    }

    function seedRewardReserve(uint256 reserve) public {
        rewardReserve = reserve;
    }

    // What the previous logic's unstake left behind: principal held for a release time.
    function seedLegacyUnbondRequest(address user, uint256 amount, uint256 releaseTime) public {
        uint256 requestId = unbondingRequestCount[user];
        unbondingQueue[user][requestId] = StakingUnbondRequest(amount, releaseTime, false);
        unbondingRequestCount[user] = requestId + 1;
        totalUnbonding += amount;
    }
}

contract Describe_StratoStaking {
    uint256 public INFINITY = 2 ** 256 - 1;
    uint256 constant YEAR = 31536000;
    uint256 constant WEEK = 604800;
    uint256 constant DAY = 86400;
    uint256 constant HOUR = 3600;
    // Calibration used throughout: at 4000 of stake with a full reserve of 10000, one
    // hour of production pays exactly 1 STRATO (8760 hours a year).
    uint256 constant E0 = 8760e18;
    uint256 constant S0 = 4000e18;
    uint256 constant R0 = 10000e18;

    TokenFactory factory;
    Token strato;
    Token usdst;
    UpgradedInPlaceStaking staking;
    ValidatorRegistry registry;
    MercataGovernance gov;

    User user1;
    User user2;
    User operatorA;
    User operatorB;
    User funder;
    // Validator keys: they send their own readiness acknowledgements.
    User validatorA;
    User validatorB;
    // A validator key that registers and operates itself.
    User validatorC;
    User attacker;
    address VALIDATOR_A;
    address VALIDATOR_B;

    function beforeAll() public {
        user1 = new User();
        user2 = new User();
        operatorA = new User();
        operatorB = new User();
        funder = new User();
        validatorA = new User();
        validatorB = new User();
        validatorC = new User();
        attacker = new User();
        VALIDATOR_A = address(validatorA);
        VALIDATOR_B = address(validatorB);
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        usdst = Token(factory.createTokenWithInitialOwner("USDST", "USDST Token", new string[](0), new string[](0), new string[](0), "USDST", 0, 18, address(this)));
        usdst.setStatus(2);

        staking = new UpgradedInPlaceStaking(address(this));
        // 10% commission ceiling, batches of 16
        staking.initialize(address(strato), address(usdst), 1000, 16);

        registry = new ValidatorRegistry(address(this));
        registry.initialize(address(staking));
        staking.setValidatorRegistry(address(registry));

        gov = new MercataGovernance(address(this));
        gov.setStakingContract(address(staking));
        staking.setGovernance(address(gov));

        address[] memory validators = new address[](2);
        validators[0] = VALIDATOR_A;
        validators[1] = VALIDATOR_B;
        address[] memory operatorAddresses = new address[](2);
        operatorAddresses[0] = address(operatorA);
        operatorAddresses[1] = address(operatorB);
        uint256[] memory commissions = new uint256[](2);
        commissions[0] = 500;
        commissions[1] = 0;
        string[] memory names = new string[](2);
        names[0] = "Validator A";
        names[1] = "Validator B";
        string[] memory empty = new string[](2);
        string[] memory protocolValidatorIds = new string[](2);
        protocolValidatorIds[0] = "validator-a";
        protocolValidatorIds[1] = "validator-b";
        registry.addValidators(validators, operatorAddresses, commissions, names, empty, empty, protocolValidatorIds);

        _mintAndApprove(user1, 10000e18);
        _mintAndApprove(user2, 10000e18);
        _mintAndApprove(operatorA, 10000e18);
        _mintAndApprove(operatorB, 10000e18);
        _mintAndApprove(funder, 100000e18);
        _mintAndApprove(validatorC, 10000e18);
        _mintAndApprove(attacker, 10000e18);

        // Start well past the first week, so a clock "a week ago" is representable, and
        // off block 0, where processBlock() cannot latch. Admission opens on the next block.
        fastForward(10 * WEEK, 1);
        staking.setJoinsOpenFromBlock(block.number + 1);
        fastForward(1, 1);
    }

    function _mintAndApprove(User user, uint256 amount) internal {
        strato.mint(address(user), amount);
        user.do(address(strato), "approve(address,uint256)", address(staking), INFINITY);
    }

    function _stake(User user, address validator, uint256 amount) internal {
        user.doSuccessfully(address(staking), "stake(address,uint256)", validator, amount);
    }

    function _list(address validator) internal pure returns (address[] memory validators) {
        validators = new address[](1);
        validators[0] = validator;
    }

    function _pair(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    function _amount(uint256 a) internal pure returns (uint256[] memory list) {
        list = new uint256[](1);
        list[0] = a;
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory list) {
        list = new uint256[](2);
        list[0] = a;
        list[1] = b;
    }

    function _selfBond(User operator, address validator, uint256 amount) internal {
        operator.doSuccessfully(address(staking), "selfBond(address,uint256)", validator, amount);
    }

    function _ack(User key) internal {
        key.doSuccessfully(address(staking), "acknowledgeReadiness");
    }

    // A week passes, so positions placed before it qualify, and the keys acknowledge readiness.
    function _ackAfterWeek(User a, User b) internal {
        fastForward(WEEK, 1);
        _ack(a);
        _ack(b);
    }

    function _ackOneAfterWeek(User a) internal {
        fastForward(WEEK, 1);
        _ack(a);
    }

    function _ackThreeAfterWeek(User a, User b, User c) internal {
        fastForward(WEEK, 1);
        _ack(a);
        _ack(b);
        _ack(c);
    }

    function _activate(address validator) internal {
        staking.tryActivate(validator);
    }

    // A at 1000 of self-bond (5% commission), B at 2000, a week on, both acknowledged and seated.
    function _bondBoth() internal {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        _ackAfterWeek(validatorA, validatorB);
        _activate(VALIDATOR_A);
        _activate(VALIDATOR_B);
    }

    // The validator key registers itself, so it needs no signature.
    function _registerSelf(User key) internal {
        key.doSuccessfully(address(registry), "register", address(key), uint256(0), "Self-operated", "", "", uint8(0), uint256(0), uint256(0));
    }

    // STRATO income pushed onto a validator's record (a discretionary reward).
    function _reward(address validator, uint256 amount) internal {
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(strato)), _amount(amount), _list(validator));
    }

    function _fundReserve(uint256 amount) internal {
        funder.doSuccessfully(address(staking), "fundRewardReserve(uint256)", amount);
    }

    // A block that `producer` produced and the network finalised, closing an interval of
    // `gap` seconds. processBlock pays the parent block's producer for the interval the
    // parent closed, so the block is laid down first and the next block pays for it; the
    // spacer block in between names no producer and so pays nobody for its own second.
    function _producedBlock(address producer, uint256 gap) internal {
        setBlockContext(address(0), address(0), address(0), 0);
        fastForward(gap, 1);
        staking.processBlock();
        setBlockContext(producer, producer, producer, 0);
        fastForward(1, 1);
        staking.processBlock();
    }

    // What the schedule releases for `elapsed` seconds at `stake` and `reserve`, as the
    // contract computes it.
    function _release(uint256 stake, uint256 reserve, uint256 elapsed) internal pure returns (uint256) {
        uint256 annual = (E0 * _sqrt(stake * S0)) / S0;
        annual = (annual * reserve) / R0;
        return (annual * elapsed) / YEAR;
    }

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

    function _commissionOf(address validator) internal returns (uint256) {
        (,,, uint256 commission,,,,,,,,,,,) = staking.operators(validator);
        return commission;
    }

    function _selfBondOf(address validator) internal returns (uint256) {
        (,,,, uint256 bonded,,,,,,,,,,) = staking.operators(validator);
        return bonded;
    }

    function _pendingOperatorRewards(address validator) internal returns (uint256) {
        (,,,,,,, uint256 selfBondRewards, uint256 commission,,,,,,) = staking.operators(validator);
        return selfBondRewards + commission;
    }

    function _pendingOperatorFees(address validator) internal returns (uint256) {
        (,,,,,,,,,, uint256 selfBondFees, uint256 feeCommission,,,) = staking.operators(validator);
        return selfBondFees + feeCommission;
    }

    function _claimOperator(User operator, address validator) internal returns (uint256) {
        uint256 before = strato.balanceOf(address(operator));
        operator.doSuccessfully(address(staking), "claimOperatorRewards(address)", validator);
        return strato.balanceOf(address(operator)) - before;
    }

    function _claimDelegator(User user, address validator) internal returns (uint256) {
        uint256 before = strato.balanceOf(address(user));
        user.doSuccessfully(address(staking), "claimRewards", _list(validator));
        return strato.balanceOf(address(user)) - before;
    }

    // ---- admission ---------------------------------------------------------------------

    function it_seats_eligible_ready_validators_explicitly_and_tracks_weight() public {
        require(staking.status(VALIDATOR_A) == 1, "Registered");
        require(staking.operatorOf(VALIDATOR_A) == address(operatorA), "operator is a field of the validator record");
        require(!gov.isValidator(VALIDATOR_A), "not a validator before bonding");

        _selfBond(operatorA, VALIDATOR_A, 999e18);
        require(!staking.eligible(VALIDATOR_A), "below the minimum");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: not eligible", VALIDATOR_A);

        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.eligible(VALIDATOR_A), "meets the minimum");
        require(!staking.isWaiter(VALIDATOR_A), "not a waiter without readiness evidence");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: no readiness evidence", VALIDATOR_A);

        _ack(validatorA);
        require(staking.isReady(VALIDATOR_A) && staking.isWaiter(VALIDATOR_A), "eligible, ready, not yet seated");
        require(!gov.isValidator(VALIDATOR_A), "joining is explicit");
        attacker.doSuccessfully(address(staking), "tryActivate(address)", VALIDATOR_A);
        require(staking.status(VALIDATOR_A) == 2, "Active");
        require(gov.isValidator(VALIDATOR_A), "registered in governance");
        require(staking.validatorCount() == 1, "counted");
        require(staking.activeValidatorCount() == 1, "indexed");
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "weight = self-bond");
        require(staking.seatedUnderSelfBondRule(VALIDATOR_A), "seated under the self-bond rule");

        _stake(user1, VALIDATOR_A, 500e18);
        require(gov.validatorStake(VALIDATOR_A) == 1500e18, "weight includes delegated stake");
        require(staking.lastSyncedWeight(VALIDATOR_A) == 1500e18, "synced weight");

        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 200e18);
        require(gov.validatorStake(VALIDATOR_A) == 1300e18, "weight follows unstake");
    }

    function it_requires_self_bond_to_meet_the_minimum() public {
        _stake(user1, VALIDATOR_A, 5000e18);
        require(!staking.eligible(VALIDATOR_A), "delegated stake alone does not qualify");
        _selfBond(operatorA, VALIDATOR_A, 999e18);
        require(!staking.eligible(VALIDATOR_A), "self-bond below the minimum, however much is delegated");
        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.eligible(VALIDATOR_A), "self-bond meets the minimum");
    }

    // A seat held since before this logic keeps qualifying on self-bond plus delegations,
    // for as long as the seat lasts under the same operator. Nothing expires it.
    function it_keeps_an_incumbent_on_the_rule_it_was_admitted_under() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        staking.forgetSelfBondRule(VALIDATOR_A);

        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(_selfBondOf(VALIDATOR_A) == 0 && staking.eligible(VALIDATOR_A), "an incumbent qualifies on delegated stake");
        require(gov.isValidator(VALIDATOR_A), "and keeps its seat");
        fastForward(YEAR, 1);
        staking.syncValidator(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "a year later too: there is no deadline");

        // Leaving ends the exemption: coming back needs the self-bond.
        operatorA.doSuccessfully(address(staking), "exit(address)", VALIDATOR_A);
        require(!staking.eligible(VALIDATOR_A), "after an exit the self-bond rule applies");
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        require(staking.eligible(VALIDATOR_A), "with the self-bond it qualifies again");

        // A seat taken under the rule stops qualifying below the minimum (B is the last
        // validator here, so governance keeps it seated; it earns nothing while it stays).
        operatorB.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_B, 1001e18);
        require(!staking.eligible(VALIDATOR_B) && staking.eligibleStake() == 0, "below the minimum, however much is delegated");
    }

    function it_wires_governance_once() public {
        MercataGovernance other = new MercataGovernance(address(this));
        bool rejected = false;
        try staking.setGovernance(address(other)) {
        } catch {
            rejected = true;
        }
        require(rejected, "the governance link has no second wiring and no off switch");
        require(staking.governanceSyncEnabled() && staking.governance() == address(gov), "unchanged");
    }

    // The pre-upgrade contract maintained lastSyncedWeight without ever calling governance,
    // so the cache reported "already synced" while governance held nothing. Overwriting the
    // published weight reproduces that shape.
    function it_republishes_stakes_governance_lost() public {
        _bondBoth();
        gov.setStakingContract(address(this));
        gov.addValidatorFromStaking(VALIDATOR_A, 0);
        gov.setStakingContract(address(staking));
        require(gov.validatorStake(VALIDATOR_A) == 0 && staking.lastSyncedWeight(VALIDATOR_A) == 1000e18, "governance lost the weight; the cache still claims synced");

        attacker.doSuccessfully(address(staking), "syncValidator(address)", VALIDATOR_A);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "republished despite the cache");
    }

    // An admin vote removes a validator in governance without telling staking. A sync
    // must give the seat up rather than add the validator back: anyone can call one.
    function it_does_not_readd_a_validator_governance_removed() public {
        _bondBoth();
        // what voteToRemoveValidator does, as staking sees it
        gov.setStakingContract(address(this));
        require(gov.removeValidatorFromStaking(VALIDATOR_A), "removed in governance");
        gov.setStakingContract(address(staking));
        require(staking.isValidator(VALIDATOR_A), "staking has not heard yet");

        fastForward(1, 1);
        attacker.doSuccessfully(address(staking), "syncValidator(address)", VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "the removal stands");
        require(staking.status(VALIDATOR_A) == 1, "seat given up: Registered");
        require(staking.validatorCount() == 1, "count updated");
        require(staking.activeValidatorCount() == 1, "index updated");

        _stake(user1, VALIDATOR_A, 100e18);
        require(!gov.isValidator(VALIDATOR_A), "staking to it does not bring it back either");

        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "joining again is explicit");
    }

    // The block header cannot express "removed, then added again" for one validator, so
    // governance refuses the re-add until the next block.
    function it_cannot_rejoin_in_the_block_it_left() public {
        _bondBoth();
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1e18);
        require(!gov.isValidator(VALIDATOR_A), "left below the minimum");
        _selfBond(operatorA, VALIDATOR_A, 1e18);

        bool rejected = false;
        try staking.tryActivate(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected, "no re-add in the block of the removal");
        require(!gov.isValidator(VALIDATOR_A), "still out");
        require(staking.status(VALIDATOR_A) == 1, "still Registered");

        fastForward(1, 1);
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "re-added a block later");
    }

    function it_removes_and_readds_validators_around_the_threshold() public {
        _bondBoth();
        require(gov.validatorCount() == 2, "two validators");

        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1e18);
        require(!gov.isValidator(VALIDATOR_A), "removed below the minimum in the same tx");
        require(staking.status(VALIDATOR_A) == 1, "back to Registered");
        require(staking.validatorCount() == 1, "count updated");
        require(staking.activeValidatorCount() == 1, "index updated");
        require(gov.isValidator(VALIDATOR_B), "B unaffected");

        _stake(user1, VALIDATOR_A, 1e18);
        require(!staking.isWaiter(VALIDATOR_A), "delegated stake does not restore eligibility");
        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.isWaiter(VALIDATOR_A), "self-bond does; its readiness is still fresh");
        require(!gov.isValidator(VALIDATOR_A), "no implicit re-activation");
        fastForward(1, 1);
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "re-added on request");

        registry.emergencyRemove(VALIDATOR_A, "test: removed");
        require(!gov.isValidator(VALIDATOR_A), "removed with the listing");
        require(staking.status(VALIDATOR_A) == 3, "Kicked");
    }

    // The last validator is the network's to replace: governance keeps it, it cannot exit,
    // but its funds are its own and its seat earns nothing once it stops qualifying.
    function it_never_removes_the_last_validator_nor_locks_its_funds() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _ackOneAfterWeek(validatorA);
        _activate(VALIDATOR_A);
        operatorA.doExpectingFailure(address(staking), "exit(address)", "SS: last validator", VALIDATOR_A);

        uint256 before = strato.balanceOf(address(operatorA));
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(strato.balanceOf(address(operatorA)) - before == 1000e18, "the whole bond came back at once");
        require(gov.isValidator(VALIDATOR_A), "governance keeps its last validator");
        require(staking.isValidator(VALIDATOR_A), "still tracked until it can be removed");
        require(!staking.eligible(VALIDATOR_A) && staking.eligibleStake() == 0, "a retained seat earns nothing");
    }

    function it_opens_admission_to_everyone_from_the_agreed_block_and_to_nobody_before() public {
        UpgradedInPlaceStaking fresh = new UpgradedInPlaceStaking(address(this));
        fresh.initialize(address(strato), address(usdst), 1000, 16);
        require(fresh.joinsOpenFromBlock() == 0, "no block agreed yet");

        bool rejected = false;
        try fresh.setJoinsOpenFromBlock(block.number) {
        } catch {
            rejected = true;
        }
        require(rejected, "the agreed block must be ahead");

        fresh.setJoinsOpenFromBlock(block.number + 100);
        fresh.setJoinsOpenFromBlock(block.number + 99);
        require(fresh.joinsOpenFromBlock() == block.number + 99, "movable until it passes");
        UpgradedInPlaceStaking opened = new UpgradedInPlaceStaking(address(this));
        opened.initialize(address(strato), address(usdst), 1000, 16);
        opened.setJoinsOpenFromBlock(block.number + 2);
        fastForward(1, 2);
        rejected = false;
        try opened.setJoinsOpenFromBlock(block.number + 100) {
        } catch {
            rejected = true;
        }
        require(rejected, "once open, admission stays open");

        // On the suite's staking contract admission is open; a closed one refuses everyone,
        // the owner included.
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        _ackOneAfterWeek(validatorC);
        validatorC.doExpectingFailure(address(fresh), "reconcileSet", "SS: joins not open", _list(address(validatorC)));
        rejected = false;
        try fresh.reconcileSet(_list(address(validatorC))) {
        } catch {
            rejected = true;
        }
        require(rejected, "closed: not even the owner");
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(gov.isValidator(address(validatorC)), "open: anyone seats a ready validator");
    }

    function it_fills_the_set_then_replaces_the_lowest_with_margin() public {
        staking.setSetParams(2, 50);
        _bondBoth();
        require(staking.validatorCount() == 2, "set full");

        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1049e18);
        _ackOneAfterWeek(validatorC);
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: set full", address(validatorC));

        _selfBond(validatorC, address(validatorC), 1e18);
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(gov.isValidator(address(validatorC)), "newcomer seated");
        require(!gov.isValidator(VALIDATOR_A), "lowest validator replaced");
        require(staking.status(VALIDATOR_A) == 1, "replaced validator is Registered");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "a replacement does not touch the self-bond");
        require(staking.validatorCount() == 2, "set size unchanged");

        bool rejected = false;
        try staking.setSetParams(3, 51) {
        } catch {
            rejected = true;
        }
        require(rejected, "hard cap only lowers");
    }

    function it_reconciles_named_waiters_by_stake_within_the_block_budget() public {
        staking.setSetParams(3, 50);
        _registerSelf(validatorC);
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 3000e18);
        _selfBond(validatorC, address(validatorC), 2000e18);
        _ackThreeAfterWeek(validatorA, validatorB, validatorC);

        address[] memory candidates = new address[](3);
        candidates[0] = VALIDATOR_A;
        candidates[1] = VALIDATOR_B;
        candidates[2] = address(validatorC);
        user2.doSuccessfully(address(staking), "reconcileSet", candidates);
        require(gov.isValidator(VALIDATOR_B), "highest waiter first");
        require(gov.isValidator(address(validatorC)), "second highest");
        require(!gov.isValidator(VALIDATOR_A), "two changes a block");

        fastForward(1, 1);
        user2.doSuccessfully(address(staking), "reconcileSet", _list(VALIDATOR_B));
        require(!gov.isValidator(VALIDATOR_A), "only named candidates are considered");
        user2.doSuccessfully(address(staking), "reconcileSet", candidates);
        require(gov.isValidator(VALIDATOR_A), "promoted in the next block");
        require(staking.validatorCount() == 3, "set full");
    }

    // Two ordinary membership changes a block, removals included; a replacement is two.
    function it_bounds_every_membership_change_per_block() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        _ackOneAfterWeek(validatorC);
        _ack(validatorA);
        _ack(validatorB);

        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        registry.emergencyRemove(VALIDATOR_A, "test: first removal");
        require(!gov.isValidator(VALIDATOR_A), "second change of the block");
        bool rejected = false;
        try registry.emergencyRemove(VALIDATOR_B, "test: one too many") {
        } catch {
            rejected = true;
        }
        require(rejected, "a third change waits for the next block");
        require(gov.isValidator(VALIDATOR_B), "B stays for now");

        fastForward(1, 1);
        registry.emergencyRemove(VALIDATOR_B, "test: second removal");
        require(!gov.isValidator(VALIDATOR_B), "removed in the next block");
    }

    function it_exits_at_once_when_the_set_can_spare_the_validator() public {
        _bondBoth();
        attacker.doExpectingFailure(address(staking), "exit(address)", "SS: not operator", VALIDATOR_A);
        operatorA.doSuccessfully(address(staking), "exit(address)", VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "left the set");
        require(staking.status(VALIDATOR_A) == 1, "Registered");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "self-bond stays bonded");

        uint256 before = strato.balanceOf(address(operatorA));
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(strato.balanceOf(address(operatorA)) - before == 1000e18, "and comes back at once when unbonded");
        require(staking.unbondingRequestCount(address(operatorA)) == 0, "nothing queued");
    }

    // ---- the safe-set rule -------------------------------------------------------------

    // A, B and C seated and ready; then B's evidence goes stale. The set is short of ready
    // weight, so a change that lowers the ready share waits, while removing the unready
    // member is always allowed.
    function _seatThreeWithBStale() internal {
        _registerSelf(validatorC);
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        _selfBond(validatorC, address(validatorC), 1000e18);
        _ackThreeAfterWeek(validatorA, validatorB, validatorC);
        _activate(VALIDATOR_A);
        _activate(VALIDATOR_B);
        fastForward(1, 1);
        _activate(address(validatorC));
        (uint256 total, uint256 ready) = staking.readyWeight();
        require(total == 4000e18 && ready == 4000e18, "all ready");

        fastForward(DAY + 1, 1);
        _ack(validatorA);
        _ack(validatorC);
        (total, ready) = staking.readyWeight();
        require(total == 4000e18 && ready == 2000e18, "B's evidence is a day old: half the weight is ready");
        require(staking.isReady(VALIDATOR_A) && !staking.isReady(VALIDATOR_B), "readiness per validator");
    }

    function it_defers_a_departure_the_ready_set_cannot_absorb() public {
        _seatThreeWithBStale();

        operatorA.doExpectingFailure(address(staking), "exit(address)", "SS: unsafe transition", VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "A's exit is deferred: it would leave 1000 of 3000 ready");
        bool rejected = false;
        try registry.emergencyRemove(address(validatorC), "test: a ready member") {
        } catch {
            rejected = true;
        }
        require(rejected, "removing a ready member is deferred the same way");

        operatorB.doSuccessfully(address(staking), "exit(address)", VALIDATOR_B);
        require(!gov.isValidator(VALIDATOR_B), "the unready member may always leave");
        (uint256 total, uint256 ready) = staking.readyWeight();
        require(total == 2000e18 && ready == 2000e18, "the resulting set is fully ready");
        fastForward(1, 1);
        operatorA.doSuccessfully(address(staking), "exit(address)", VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "and A may leave now");
    }

    function it_defers_weight_changes_that_lower_a_short_ready_share() public {
        _seatThreeWithBStale();

        // ready 2000 of 4000; taking 500 off A would make it 1500 of 3500
        operatorA.doExpectingFailure(address(staking), "unbondSelf(address,uint256)", "SS: unsafe transition", VALIDATOR_A, 500e18);
        // staking onto the unready B would make it 2000 of 5000
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: unsafe transition", VALIDATOR_B, 1000e18);
        // staking onto a ready validator raises the share
        _stake(user1, VALIDATOR_A, 1000e18);
        (uint256 total, uint256 ready) = staking.readyWeight();
        require(total == 5000e18 && ready == 3000e18, "3000 of 5000 ready");
        // and so does taking stake off the unready one
        operatorB.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_B, 500e18);

        _ack(validatorB);
        (total, ready) = staking.readyWeight();
        require(total == ready, "everyone ready again");
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 1000e18);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 500e18);
        require(!gov.isValidator(VALIDATOR_A), "A left below the minimum, the set being safe");
    }

    // A set with no evidence at all (every seat an incumbent on a quiet chain) is not made
    // worse by any change, so nothing is deferred until evidence arrives.
    function it_defers_nothing_while_nobody_has_evidence() public {
        _bondBoth();
        fastForward(2 * DAY, 1);
        (uint256 total, uint256 ready) = staking.readyWeight();
        require(ready == 0 && total == 3000e18, "stale all round");
        operatorA.doSuccessfully(address(staking), "exit(address)", VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "nothing to protect, nothing deferred");
    }

    // ---- readiness evidence --------------------------------------------------------------

    function it_admits_on_a_fresh_acknowledgement_from_the_key_and_keeps_ready_by_producing() public {
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        bool rejected = false;
        try operatorA.do(address(staking), "acknowledgeReadiness") {
        } catch {
            rejected = true;
        }
        require(rejected && staking.readyAt(address(operatorA)) == 0, "only a listed validator key acknowledges");

        _ack(validatorC);
        fastForward(DAY + 1, 1);
        require(!staking.isReady(address(validatorC)), "an acknowledgement is good for a day");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: no readiness evidence", address(validatorC));

        _ack(validatorC);
        require(staking.isReady(address(validatorC)) && staking.isWaiter(address(validatorC)), "fresh evidence");
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(gov.isValidator(address(validatorC)), "seated");

        // Seated, producing is the evidence: a finalised proposal is good for 500 blocks, however long they take.
        setBlockContext(address(validatorC), address(validatorC), address(validatorC), 0);
        fastForward(1, 1);
        staking.processBlock();
        require(staking.lastProposedBlock(address(validatorC)) == block.number - 1, "the parent block it produced");
        fastForward(3 * DAY, 1);
        require(staking.isReady(address(validatorC)), "ready on its proposal, days after the acknowledgement lapsed");
        fastForward(1, 499);
        require(!staking.isReady(address(validatorC)), "and not once the proposal is 500 blocks old");
    }

    function it_counts_proposals_and_misses_once_per_block_and_takes_a_proposal_as_evidence() public {
        _bondBoth();
        fastForward(2 * DAY, 1);
        require(!staking.isReady(VALIDATOR_B), "stale");

        // previous block: A was intended, B proposed (a round change happened)
        setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
        staking.processBlock();
        require(staking.blocksProposed(VALIDATOR_B) == 1, "fill-in proposer credited");
        require(staking.missedProposals(VALIDATOR_A) == 1, "intended proposer missed");
        require(staking.consecutiveMisses(VALIDATOR_A) == 1, "consecutive miss");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "no tokens move on a miss");
        require(gov.isValidator(VALIDATOR_A), "still a validator");
        require(staking.isReady(VALIDATOR_B) && !staking.isReady(VALIDATOR_A), "a finalised proposal is readiness evidence");

        staking.processBlock();
        require(staking.missedProposals(VALIDATOR_A) == 1, "same block is processed once");

        // next block: A proposes as intended
        fastForward(1, 1);
        setBlockContext(VALIDATOR_A, VALIDATOR_A, VALIDATOR_A, 1);
        staking.processBlock();
        require(staking.blocksProposed(VALIDATOR_A) == 1, "proposal counted");
        require(staking.consecutiveMisses(VALIDATOR_A) == 0, "streak reset by proposing");
        require(staking.missedProposals(VALIDATOR_A) == 1, "history kept");
    }

    function it_removes_a_validator_for_missed_proposals_on_evidence() public {
        _bondBoth();
        for (uint256 i = 0; i < 19; i++) {
            setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
            staking.processBlock();
            fastForward(1, 1);
        }
        require(staking.consecutiveMisses(VALIDATOR_A) == 19, "nineteen misses");
        attacker.doExpectingFailure(address(staking), "removeForMissedProposals(address)", "SS: liveness evidence short", VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "nineteen is not evidence enough");

        setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
        staking.processBlock();
        attacker.doSuccessfully(address(staking), "removeForMissedProposals(address)", VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "anyone removes it on the twentieth");
        require(staking.status(VALIDATOR_A) == 1, "Registered, stake untouched");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "no tokens move");
        require(staking.jailedUntil(VALIDATOR_A) == block.timestamp + WEEK, "may be seated again in a week");
        require(!staking.eligible(VALIDATOR_A), "not before");

        fastForward(WEEK, 1);
        require(staking.eligible(VALIDATOR_A) && !staking.isWaiter(VALIDATOR_A), "eligible again, but its evidence lapsed with it");
        _ack(validatorA);
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "back on fresh evidence");
    }

    function it_does_not_count_a_miss_without_a_round_change() public {
        _bondBoth();
        setBlockContext(VALIDATOR_A, VALIDATOR_A, VALIDATOR_A, 0);
        staking.processBlock();
        setBlockContext(VALIDATOR_A, address(0), address(0), 3);
        fastForward(1, 1);
        staking.processBlock();
        require(staking.missedProposals(VALIDATOR_A) == 0, "nothing missed");
        require(staking.blocksProposed(VALIDATOR_A) == 1, "one proposal credited");
    }

    function it_process_block_is_a_noop_before_initialization() public {
        StratoStaking fresh = new StratoStaking(address(this));
        fresh.processBlock();
        require(fresh.lastProcessedBlock() == 0, "nothing processed");
    }

    // ---- production income ---------------------------------------------------------------

    function it_pays_the_producer_of_each_finalised_block_from_the_schedule() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();                                  // A: 1000 self-bond at 5% + 1000 delegated; B: 2000; S = 4000
        staking.qualifyStake(address(user1), VALIDATOR_A);
        require(staking.unqualifiedDelegatedStake(VALIDATOR_A) == 0, "a week in: the delegation qualifies on its touch");
        _fundReserve(10000e18);
        _commit();
        require(staking.emissionAnnualRate() == 8760e18, "the calibration rate at the calibration stake");

        _producedBlock(VALIDATOR_A, HOUR);
        require(staking.totalEmitted() == 1e18, "an hour of production at the calibration: 1 STRATO");
        require(staking.rewardReserve() == 9999e18, "taken from the reserve");
        require(staking.allocatedRewardLiability() == 1e18, "owed to A's record");
        // A: self-bond 1000 of 2000 -> 0.5; delegators 0.5 gross, 5% -> 0.025 + 0.475
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e15, "A's operator: self-bond share + commission");
        require(_pendingOperatorRewards(VALIDATOR_B) == 0, "B produced nothing");
        require(_claimDelegator(user1, VALIDATOR_A) == 475e15, "A's delegator, net of commission");
        require(_claimOperator(operatorA, VALIDATOR_A) == 525e15, "claimed");

        _producedBlock(VALIDATOR_B, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_B) == _release(4000e18, 9999e18, HOUR), "B's block, at the reserve left, all on its self-bond");
        require(staking.allocatedRewardLiability() == _pendingOperatorRewards(VALIDATOR_B), "all else paid out");
        require(staking.rewardReserve() == 9999e18 - _pendingOperatorRewards(VALIDATOR_B), "claims never touch the reserve");
    }

    // Stake determines who proposes; the payment is not weighted by stake again.
    function it_pays_producers_alike_whatever_their_stake() public {
        _bondBoth();                                  // A: 1000, B: 2000
        _fundReserve(10000e18);
        _commit();
        _producedBlock(VALIDATOR_A, HOUR);
        uint256 paidA = _pendingOperatorRewards(VALIDATOR_A);
        _producedBlock(VALIDATOR_B, HOUR);
        uint256 paidB = _pendingOperatorRewards(VALIDATOR_B);
        require(paidA == _release(3000e18, 10000e18, HOUR), "A's hour at a full reserve");
        require(paidB == _release(3000e18, 10000e18 - paidA, HOUR), "B's hour, the same formula on the reserve left");
        require(paidA > paidB && paidA - paidB < paidA / 1000, "the only difference is the reserve's decay");
    }

    function it_pays_the_fill_in_producer_and_not_the_one_that_missed() public {
        _bondBoth();
        _fundReserve(10000e18);
        _commit();
        setBlockContext(address(0), address(0), address(0), 0);
        fastForward(HOUR, 1);
        staking.processBlock();
        // the parent was meant for A and produced by B after a round change
        setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
        fastForward(1, 1);
        staking.processBlock();
        require(_pendingOperatorRewards(VALIDATOR_B) == _release(3000e18, 10000e18, HOUR), "B produced the finalised block and is paid");
        require(_pendingOperatorRewards(VALIDATOR_A) == 0 && staking.missedProposals(VALIDATOR_A) == 1, "A missed and gets nothing");
    }

    function it_leaves_gaps_beyond_the_cap_in_the_reserve() public {
        _bondBoth();
        _fundReserve(10000e18);
        _commit();

        _producedBlock(VALIDATOR_A, 2 * DAY);
        require(_pendingOperatorRewards(VALIDATOR_A) == _release(3000e18, 10000e18, HOUR), "two days without a block pay one hour");
        require(staking.rewardReserve() == 10000e18 - _pendingOperatorRewards(VALIDATOR_A), "the rest stays in the reserve");

        uint256 reserve = staking.rewardReserve();
        _producedBlock(VALIDATOR_B, 600);
        require(_pendingOperatorRewards(VALIDATOR_B) == _release(3000e18, reserve, 600), "ten minutes pay ten minutes");
    }

    // Accounting never manufactures a payment: a quiet chain pays for the blocks it finalises,
    // whenever they are processed, and a claim is not production.
    function it_pays_the_same_for_the_same_blocks_whenever_they_are_processed() public {
        _bondBoth();
        _fundReserve(10000e18);
        _commit();
        _producedBlock(VALIDATOR_A, HOUR);
        uint256 paid = _pendingOperatorRewards(VALIDATOR_A);
        fastForward(30 * DAY, 1);
        require(_claimOperator(operatorA, VALIDATOR_A) == paid, "a month later the claim pays what the block earned");
        require(staking.totalEmitted() == paid, "and nothing accrued for the month without blocks");
    }

    function it_pays_nothing_before_the_start_and_only_the_part_after_it() public {
        _bondBoth();
        _fundReserve(10000e18);
        staking.commitEmissionSchedule(E0, S0, R0, block.timestamp + 2 * HOUR);
        _seedClock();

        _producedBlock(VALIDATOR_A, HOUR);
        require(staking.totalEmitted() == 0, "nothing before the start");
        // the next block closes an interval from one hour before the start to one after it
        _producedBlock(VALIDATOR_A, 2 * HOUR);
        require(staking.totalEmitted() == _release(3000e18, 10000e18, HOUR), "only the hour after the start");
    }

    function it_pays_only_seated_listed_eligible_producers() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 3000e18);   // eligible, not in the set
        _fundReserve(10000e18);
        _commit();
        require(staking.eligibleStake() == 3000e18, "a waiter's stake does not count");

        _producedBlock(address(validatorC), HOUR);
        require(staking.totalEmitted() == 0, "a producer outside the set is paid nothing");

        // A seat kept only because this block's churn budget is spent earns nothing either:
        // C replaces A (two changes), then B drops below the minimum in the same block.
        staking.setSetParams(2, 50);
        _ackOneAfterWeek(validatorC);
        _ack(validatorA);
        _ack(validatorB);
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        operatorB.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_B, 1001e18);
        require(staking.isValidator(VALIDATOR_B) && !staking.eligible(VALIDATOR_B), "B keeps its seat until a later sync");
        require(staking.eligibleStake() == 3000e18, "and counts for nothing: only C");
        _producedBlock(VALIDATOR_B, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_B) == 0, "a retained seat earns nothing");

        // Delisted by governance's quality control: unpaid from there.
        registry.emergencyRemove(address(validatorC), "test: removed");
        _producedBlock(address(validatorC), HOUR);
        require(_pendingOperatorRewards(address(validatorC)) == 0 && staking.totalEmitted() == 0, "nothing for a delisted producer");
    }

    function it_scales_the_release_with_the_root_of_the_stake_and_the_reserve_left() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _ackOneAfterWeek(validatorA);
        _activate(VALIDATOR_A);                       // S = 1000
        _fundReserve(10000e18);
        _commit();
        require(staking.emissionAnnualRate() == 4380e18, "sqrt(1000 / 4000) = 1/2 at a full reserve");

        _producedBlock(VALIDATOR_A, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_A) == 5e17, "half a STRATO for the hour");
        require(staking.emissionAnnualRate() == 4379781e15, "the rate falls with the reserve");

        _stake(user1, VALIDATOR_A, 3000e18);          // S = 4000
        require(staking.emissionAnnualRate() == _release(4000e18, 10000e18 - 5e17, YEAR), "the stake it brings raises the rate");
    }

    function it_commits_the_schedule_once_and_funded() public {
        bool rejected = false;
        try staking.commitEmissionSchedule(E0, S0, R0, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "unfunded: what is advertised must be in the reserve");

        _fundReserve(10000e18);
        _commit();
        require(staking.emissionStartTime() == block.timestamp, "started");
        rejected = false;
        try staking.commitEmissionSchedule(E0, S0, R0, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "committed once: no re-vote, no pause");
        rejected = false;
        try staking.commitEmissionSchedule(0, S0, R0, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "and no zero rate");

        _fundReserve(10000e18);
        require(staking.rewardReserve() == 20000e18 && staking.emissionReserveR0() == R0, "a top-up raises R and leaves the reference alone");
        _bondBoth();
        require(staking.emissionAnnualRate() == _release(3000e18, 20000e18, YEAR), "so the rate doubles");
    }

    function it_keeps_the_reserve_out_of_claims_and_beyond_anyones_reach() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        _fundReserve(100e18);
        require(staking.rewardReserve() == 100e18 && staking.untrackedStrato() == 0, "funded, tracked");
        bool rejected = false;
        try attacker.do(address(staking), "recoverUntrackedStrato(address,uint256)", address(user2), 1e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "there is no recovery call");

        // Rewards on the books that only the reserve could cover are not paid out of it.
        staking.seedRetiredCheckpoints(VALIDATOR_A, 0, 0, 5e18);
        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: rewards unavailable", VALIDATOR_A);
        require(strato.balanceOf(address(staking)) == 2100e18, "principal and reserve intact");

        funder.doExpectingFailure(address(staking), "fundRewardReserve(uint256)", "SS: amount=0", uint256(0));
        strato.mint(address(staking), 7e18);
        require(staking.untrackedStrato() == 7e18, "a direct transfer is nobody's: not stake, not reserve, not recoverable");
    }

    // An upgraded proxy reads the reserve the retired schedule left under the same name, whose
    // backing the logic in between let the owner recover. Until it is reconciled every claim
    // fails against it, and funding would add to a number nothing backs.
    function it_lowers_an_unbacked_reserve_to_what_the_contract_holds() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _reward(VALIDATOR_A, 10e18);                 // held: 1000 of principal and 10 owed
        staking.seedRewardReserve(100e18);
        require(staking.untrackedStrato() == 0, "nothing beyond principal and owed rewards");
        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: rewards unavailable", VALIDATOR_A);

        user2.doSuccessfully(address(staking), "reconcileRewardReserve");
        require(staking.rewardReserve() == 0, "lowered to what is held beyond principal and owed rewards");
        require(_claimOperator(operatorA, VALIDATOR_A) == 10e18, "the claim goes through");

        _fundReserve(10e18);
        require(staking.rewardReserve() == 10e18, "funding lands on the reconciled reserve");
        user2.doSuccessfully(address(staking), "reconcileRewardReserve");
        require(staking.rewardReserve() == 10e18 && staking.untrackedStrato() == 0, "a backed reserve is left alone");
    }

    function it_stops_when_the_reserve_is_spent() public {
        _bondBoth();
        _fundReserve(1e17);
        staking.commitEmissionSchedule(E0, S0, 1e17, 0);  // a full reserve of 0.1, so an hour is worth 1 STRATO
        _producedBlock(VALIDATOR_A, HOUR);
        require(staking.totalEmitted() == 1e17 && staking.rewardReserve() == 0, "capped at the reserve");
        _producedBlock(VALIDATOR_B, HOUR);
        require(staking.totalEmitted() == 1e17, "nothing left to release");
    }

    // ---- qualification ----------------------------------------------------------------------

    function it_pays_a_waiting_position_nothing_until_its_week_and_its_touch() public {
        _bondBoth();
        _fundReserve(10000e18);
        _commit();
        _stake(user2, VALIDATOR_A, 1000e18);
        require(staking.unqualifiedStake(address(user2), VALIDATOR_A) == 1000e18 && staking.unqualifiedDelegatedStake(VALIDATOR_A) == 1000e18, "a new position waits");
        require(gov.validatorStake(VALIDATOR_A) == 2000e18, "but votes at once");

        _producedBlock(VALIDATOR_A, HOUR);
        uint256 block1 = _pendingOperatorRewards(VALIDATOR_A);
        require(block1 == _release(4000e18, 10000e18, HOUR), "the whole block to the self-bond: nobody else qualifies");
        user2.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));

        fastForward(WEEK, 1);
        _producedBlock(VALIDATOR_A, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_A) == block1 + _release(4000e18, 10000e18 - block1, HOUR), "a week on, untouched: still the self-bond's");
        user2.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));

        attacker.doSuccessfully(address(staking), "qualifyStake(address,address)", address(user2), VALIDATOR_A);
        require(staking.unqualifiedDelegatedStake(VALIDATOR_A) == 0, "anyone may touch it; it qualifies");
        uint256 before = _pendingOperatorRewards(VALIDATOR_A);
        uint256 emittedBefore = staking.totalEmitted();
        _producedBlock(VALIDATOR_A, HOUR);
        uint256 block3 = staking.totalEmitted() - emittedBefore;
        // self-bond 1000 of 2000 -> half; delegators the rest gross, 5% commission
        uint256 selfShare = block3 / 2;
        uint256 commission = ((block3 - selfShare) * 500) / 10000;
        uint256 net = block3 - selfShare - commission;
        require(_pendingOperatorRewards(VALIDATOR_A) - before == selfShare + commission, "from here the position shares");
        uint256 claimed = _claimDelegator(user2, VALIDATOR_A);
        require(claimed <= net && net - claimed < 1000, "net of commission, to the index's precision");
    }

    function it_moves_a_positions_clock_with_a_top_up() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        staking.qualifyStake(address(user1), VALIDATOR_A);
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 0, "qualified");
        uint256 placed = staking.stakedSince(address(user1), VALIDATOR_A);

        _stake(user1, VALIDATOR_A, 1);
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 0, "a wei barely moves the clock");

        _stake(user1, VALIDATOR_A, 1000e18);
        uint256 moved = staking.stakedSince(address(user1), VALIDATOR_A);
        require(moved > placed && moved < block.timestamp, "an equal top-up moves the clock halfway");
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 2000e18 + 1, "and the whole position waits");
        require(staking.unqualifiedDelegatedStake(VALIDATOR_A) == 2000e18 + 1, "counted on the validator");

        fastForward(moved + WEEK - block.timestamp - 1, 1);
        staking.qualifyStake(address(user1), VALIDATOR_A);
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 2000e18 + 1, "a second short");
        fastForward(1, 1);
        staking.qualifyStake(address(user1), VALIDATOR_A);
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 0, "qualified a week after the moved clock");
    }

    function it_restarts_the_week_for_moved_stake_and_keeps_past_earnings() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        staking.qualifyStake(address(user1), VALIDATOR_A);
        _fundReserve(10000e18);
        _commit();
        _producedBlock(VALIDATOR_A, HOUR);
        require(staking.pendingDelegatorRewards(address(user1), VALIDATOR_A) == 0, "credited on the next touch");

        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_A, VALIDATOR_B, 1000e18);
        require(staking.pendingDelegatorRewards(address(user1), VALIDATOR_A) == 475e15, "settled on the move");
        require(staking.unqualifiedStake(address(user1), VALIDATOR_B) == 1000e18, "the moved stake starts a new week");
        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_B, VALIDATOR_A, 1000e18);
        require(staking.unqualifiedStake(address(user1), VALIDATOR_A) == 1000e18, "moving back is free, and waits again");
        require(_claimDelegator(user1, VALIDATOR_A) == 475e15, "what it earned is paid");

        _producedBlock(VALIDATOR_A, HOUR);
        user1.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));
    }

    function it_returns_principal_at_once() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        uint256 before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 400e18);
        require(strato.balanceOf(address(user1)) - before == 400e18, "paid in the same transaction");
        require(staking.unbondingRequestCount(address(user1)) == 0 && staking.totalUnbonding() == 0, "nothing queued");
        require(gov.validatorStake(VALIDATOR_A) == 1600e18, "the weight left with it");

        // What the previous logic queued is withdrawable now, whatever release time it set.
        staking.seedLegacyUnbondRequest(address(user2), 5e18, block.timestamp + YEAR);
        strato.mint(address(staking), 5e18);
        user2.doSuccessfully(address(staking), "withdrawUnbonded", _amount(0));
        require(strato.balanceOf(address(user2)) == 10005e18 && staking.totalUnbonding() == 0, "legacy request paid");
    }

    // ---- discretionary rewards -----------------------------------------------------------

    function _fundedToken(string symbol) internal returns (Token) {
        Token token = Token(factory.createTokenWithInitialOwner(symbol, symbol, new string[](0), new string[](0), new string[](0), symbol, 0, 18, address(this)));
        token.setStatus(2);
        token.mint(address(funder), 100000e18);
        funder.do(address(token), "approve(address,uint256)", address(staking), INFINITY);
        return token;
    }

    function it_distributes_strato_and_usdst_across_the_consensus_set_by_weight() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();                                  // A: 2000, B: 2000
        staking.qualifyStake(address(user1), VALIDATOR_A);
        usdst.mint(address(funder), 1000e18);
        funder.do(address(usdst), "approve(address,uint256)", address(staking), INFINITY);

        funder.doSuccessfully(address(staking), "distributeRewards", _pair(address(strato), address(usdst)), _amounts(100e18, 100e18), new address[](0));

        // A gets 50 of each: self-bond 1000 of 2000 -> 25, delegators 25 gross, 5% commission -> 1.25 + 23.75
        require(_pendingOperatorRewards(VALIDATOR_A) == 2625e16, "A operator STRATO");
        require(_pendingOperatorFees(VALIDATOR_A) == 2625e16, "A operator USDST");
        require(_pendingOperatorRewards(VALIDATOR_B) == 50e18 && _pendingOperatorFees(VALIDATOR_B) == 50e18, "B has no delegators");
        require(staking.allocatedRewardLiability() == 100e18, "STRATO owed");
        require(staking.trackedUsdst() == 100e18, "USDST tracked");

        require(_claimDelegator(user1, VALIDATOR_A) == 2375e16, "delegator STRATO");
        user1.doSuccessfully(address(staking), "claimFeeRewards", _list(VALIDATOR_A));
        require(usdst.balanceOf(address(user1)) == 2375e16, "delegator USDST");
        operatorA.doSuccessfully(address(staking), "claimOperatorFeeRewards(address)", VALIDATOR_A);
        require(usdst.balanceOf(address(operatorA)) == 2625e16, "operator USDST");
    }

    function it_gives_other_tokens_to_operators_with_dust_to_the_last_recipient() public {
        _bondBoth(); // A: 1000, B: 2000
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18); // listed, not in the set
        Token cata = _fundedToken("CATA");

        address[] memory three = new address[](3);
        three[0] = VALIDATOR_A;
        three[1] = VALIDATOR_B;
        three[2] = address(validatorC);
        funder.doSuccessfully(address(staking), "distributeRewards", _list(address(cata)), _amount(1001), three);

        require(staking.pendingOperatorTokenRewards(address(operatorA), address(cata)) == 250, "A: 1001 * 1000 / 4000");
        require(staking.pendingOperatorTokenRewards(address(operatorB), address(cata)) == 500, "B: 1001 * 2000 / 4000");
        require(staking.pendingOperatorTokenRewards(address(validatorC), address(cata)) == 251, "C, the last recipient, takes the dust");
        require(staking.tokenRewardLiability(address(cata)) == 1001 && cata.balanceOf(address(staking)) == 1001, "every pulled token is owed");
        require(staking.allocatedRewardLiability() == 0, "nothing credited as STRATO");

        operatorA.doSuccessfully(address(staking), "claimOperatorTokenRewards", _list(address(cata)));
        require(cata.balanceOf(address(operatorA)) == 250, "operator claimed");
        require(staking.tokenRewardLiability(address(cata)) == 751, "liability released");
        operatorA.doExpectingFailure(address(staking), "claimOperatorTokenRewards", "SS: no rewards", _list(address(cata)));
    }

    function it_credits_specific_validators_in_a_batch() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        staking.qualifyStake(address(user1), VALIDATOR_A);
        Token cata = _fundedToken("CATA");

        funder.doSuccessfully(address(staking), "distributeRewardsTo", _pair(address(strato), address(cata)), _amounts(10e18, 7e18), _pair(VALIDATOR_A, VALIDATOR_B));

        // STRATO to A: self-bond 1000 of 2000 -> 5, delegators 5 gross, 5% commission -> 0.25 + 4.75
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e16, "A operator STRATO");
        require(_pendingOperatorRewards(VALIDATOR_B) == 0, "B got no STRATO");
        require(staking.pendingOperatorTokenRewards(address(operatorB), address(cata)) == 7e18, "B's operator got the CATA");
        require(staking.pendingOperatorTokenRewards(address(operatorA), address(cata)) == 0, "A's operator got no CATA");
        require(_claimDelegator(user1, VALIDATOR_A) == 475e16, "delegator STRATO");
    }

    // STRATO pushed onto a record with nothing qualified yet is the operator's: it has
    // already been received, and the operator is the only party there is.
    function it_gives_pushed_income_to_the_operator_while_nothing_qualifies() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        _reward(VALIDATOR_A, 10e18);
        require(_pendingOperatorRewards(VALIDATOR_A) == 10e18, "all of it to the self-bond share");
        user1.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));
    }

    function it_rejects_malformed_or_unfunded_distributions() public {
        funder.doExpectingFailure(address(staking), "distributeRewards", "SS: no validators", _list(address(strato)), _amount(1e18), new address[](0));

        _bondBoth();
        _registerSelf(validatorC);
        funder.doExpectingFailure(address(staking), "distributeRewardsTo", "SS: validator not listed", _list(address(strato)), _amount(1e18), _list(address(0xdead)));
        funder.doExpectingFailure(address(staking), "distributeRewards", "SS: length mismatch", _list(address(strato)), _amounts(1e18, 1e18), new address[](0));
        funder.doExpectingFailure(address(staking), "distributeRewards", "SS: duplicate validator", _list(address(strato)), _amount(1e18), _pair(VALIDATOR_A, VALIDATOR_A));
        funder.doExpectingFailure(address(staking), "distributeRewards", "SS: no stake", _list(address(strato)), _amount(1e18), _list(address(validatorC)));

        Token cata = _fundedToken("CATA");
        bool rejected = false;
        try attacker.do(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(1e18), _list(VALIDATOR_A)) {
        } catch {
            rejected = true;
        }
        require(rejected, "a distribution must be paid for");
        require(staking.tokenRewardLiability(address(cata)) == 0, "nothing credited");

        // A failed distribution leaves nothing behind that blocks the next one.
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(1e18), _list(VALIDATOR_A));
        require(staking.tokenRewardLiability(address(cata)) == 1e18, "later distribution credited");
    }

    function it_recovers_nothing_sent_directly() public {
        _bondBoth();
        Token cata = _fundedToken("CATA");
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(5e18), _list(VALIDATOR_A));
        cata.mint(address(staking), 2e18); // sent directly, owed to nobody
        usdst.mint(address(staking), 3e18);

        bool rejected = false;
        try attacker.do(address(staking), "recoverStrayToken(address,address,uint256)", address(cata), address(user2), 2e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "no stray-token recovery");
        rejected = false;
        try attacker.do(address(staking), "recoverUnattributedFees(address,uint256)", address(user2), 3e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "no fee recovery");
        require(cata.balanceOf(address(staking)) == 7e18 && staking.tokenRewardLiability(address(cata)) == 5e18, "the owed part is still owed; the rest stays");
        setBlockContext(VALIDATOR_A, VALIDATOR_A, VALIDATOR_A, 0);
        fastForward(1, 1);
        staking.processBlock();
        require(_pendingOperatorFees(VALIDATOR_A) == 0 && staking.trackedUsdst() == 0, "USDST sent directly is credited to nobody");
    }

    // ---- in-place upgrade from the operator-keyed layout ---------------------------------

    // What the retired schedule allocated but never paid is credited once, exactly as its
    // own bookkeeping would have, and never again.
    function it_settles_the_retired_reward_schedule_once() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        fastForward(WEEK, 1);
        staking.qualifyStake(address(user1), VALIDATOR_A);   // a position from before the upgrade
        strato.mint(address(staking), 211e18);
        // base index 10 per operator, stake index 0.1 per token, 1 of base already pending
        staking.seedRetiredSchedule(10e18, 1e17, 211e18);
        staking.seedRetiredCheckpoints(VALIDATOR_A, 0, 0, 1e18);

        // operator: 1 pending + 10 base + 100 on its self-bond; delegators: 100 gross, 5% commission
        require(_claimOperator(operatorA, VALIDATOR_A) == 116e18, "operator: 111 + 5 commission");
        require(_claimDelegator(user1, VALIDATOR_A) == 95e18, "delegator: 95");

        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: no rewards", VALIDATOR_A);
        user1.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));
        require(staking.allocatedRewardLiability() == 0, "liability fully discharged");
    }

    function it_sets_usdst_on_a_contract_upgraded_in_place() public {
        UpgradedInPlaceStaking upgraded = new UpgradedInPlaceStaking(address(this));
        upgraded.initialize(address(strato), address(usdst), 1000, 16);
        upgraded.forgetUsdst();
        require(address(upgraded.usdstToken()) == address(0), "starts unset, as on helium");

        usdst.mint(address(upgraded), 7e18);
        upgraded.setUsdstToken(address(usdst));
        require(address(upgraded.usdstToken()) == address(usdst), "usdst wired");
        require(upgraded.trackedUsdst() == 7e18, "a pre-existing balance is owed to nobody");

        bool rejected = false;
        try upgraded.setUsdstToken(address(usdst)) {
        } catch {
            rejected = true;
        }
        require(rejected, "usdst cannot be repointed once set");
    }

    function it_only_lets_the_owner_set_usdst() public {
        UpgradedInPlaceStaking upgraded = new UpgradedInPlaceStaking(address(this));
        upgraded.initialize(address(strato), address(usdst), 1000, 16);
        upgraded.forgetUsdst();

        bool rejected = false;
        try user1.do(address(upgraded), "setUsdstToken", address(usdst)) {
        } catch {
            rejected = true;
        }
        require(rejected, "non-owner rejected");
        require(address(upgraded.usdstToken()) == address(0), "still unset");
    }

    function it_indexes_a_set_that_predates_the_index_and_reads_legacy_operators() public {
        _bondBoth();
        staking.forgetSetIndex();
        require(staking.activeValidatorCount() == 0 && staking.validatorCount() == 2, "helium's shape: counted, not indexed");

        address[] memory claimed = new address[](3);
        claimed[0] = VALIDATOR_A;
        claimed[1] = VALIDATOR_B;
        claimed[2] = address(0xdead);
        user2.doSuccessfully(address(staking), "indexValidatorSet", claimed);
        require(staking.activeValidatorCount() == 2, "only real members indexed");
        user2.doSuccessfully(address(staking), "indexValidatorSet", claimed);
        require(staking.activeValidatorCount() == 2, "idempotent");

        staking.forgetOperatorField(VALIDATOR_A);
        require(staking.operatorOf(VALIDATOR_A) == VALIDATOR_A, "a record without an operator field is operated by its key");
    }

    // A member the backfill left out neither counts in S nor is paid for its blocks until it
    // is indexed; indexing pays it from its next block on, not for the blocks it was missing.
    function it_pays_only_the_indexed_set() public {
        _bondBoth();
        staking.forgetSetIndex();
        user2.doSuccessfully(address(staking), "indexValidatorSet", _list(VALIDATOR_B));
        require(staking.isValidator(VALIDATOR_A) && staking.activeValidatorIndex(VALIDATOR_A) == 0, "A seated, not indexed");
        require(staking.eligibleStake() == 2000e18, "only the indexed validator counts");
        _fundReserve(10000e18);
        _commit();

        _producedBlock(VALIDATOR_A, HOUR);
        require(staking.totalEmitted() == 0, "A's block pays nothing");
        _producedBlock(VALIDATOR_B, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_B) == _release(2000e18, 10000e18, HOUR), "B's block pays at the indexed stake");

        user2.doSuccessfully(address(staking), "indexValidatorSet", _list(VALIDATOR_A));
        require(staking.activeValidatorCount() == 2 && staking.eligibleStake() == 3000e18, "A counts from here");
        uint256 reserve = staking.rewardReserve();
        _producedBlock(VALIDATOR_A, HOUR);
        require(_pendingOperatorRewards(VALIDATOR_A) == _release(3000e18, reserve, HOUR), "and is paid for its next block");
    }

    // ---- operators ---------------------------------------------------------------------

    // The key binds the validator to a new operator in the registry; staking takes that as
    // the announcement.
    function _announceHandover(User key, address validator, User newOperator) internal {
        key.doSuccessfully(address(registry), "setOperator", validator, address(newOperator), uint8(0), uint256(0), uint256(0));
    }

    function it_hands_over_with_consent_notice_and_the_incoming_bond() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();
        _reward(VALIDATOR_A, 100e18);
        Token cata = _fundedToken("CATA");
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(5e18), _list(VALIDATOR_A));

        _announceHandover(validatorA, VALIDATOR_A, operatorB);
        require(registry.operatorOf(VALIDATOR_A) == address(operatorB), "bound in the registry with the key's consent");
        require(staking.pendingOperator(VALIDATOR_A) == address(operatorB) && staking.operatorChangeReadyTime(VALIDATOR_A) == block.timestamp + WEEK, "announced in staking");
        require(staking.operatorOf(VALIDATOR_A) == address(operatorA), "the current operator keeps operating");
        operatorA.doSuccessfully(address(staking), "selfBond(address,uint256)", VALIDATOR_A, 1e18);
        operatorB.doExpectingFailure(address(staking), "selfBond(address,uint256)", "SS: not operator", VALIDATOR_A, 1e18);
        operatorB.doExpectingFailure(address(staking), "acceptOperator(address,uint256)", "SS: handover notice running", VALIDATOR_A, 1000e18);
        attacker.doExpectingFailure(address(staking), "acceptOperator(address,uint256)", "SS: not the pending operator", VALIDATOR_A, 1000e18);

        fastForward(WEEK, 1);
        _ack(validatorA);
        _ack(validatorB);
        operatorB.doExpectingFailure(address(staking), "acceptOperator(address,uint256)", "SS: bond below minimum", VALIDATOR_A, 999e18);
        uint256 beforeA = strato.balanceOf(address(operatorA));
        uint256 beforeB = strato.balanceOf(address(operatorB));
        operatorB.doSuccessfully(address(staking), "acceptOperator(address,uint256)", VALIDATOR_A, 1000e18);

        require(staking.operatorOf(VALIDATOR_A) == address(operatorB), "handed over");
        require(staking.pendingOperator(VALIDATOR_A) == address(0), "nothing pending");
        require(strato.balanceOf(address(operatorA)) - beforeA == 1001e18 + 100e18, "the outgoing operator got its bond and its rewards");
        require(beforeB - strato.balanceOf(address(operatorB)) == 1000e18, "the incoming operator paid its own bond");
        require(_selfBondOf(VALIDATOR_A) == 1000e18 && staking.unqualifiedSelfBond(VALIDATOR_A) == 1000e18, "a fresh bond, waiting its week");
        require(staking.delegatedStake(address(user1), VALIDATOR_A) == 1000e18, "delegations stay");
        require(gov.isValidator(VALIDATOR_A) && gov.validatorStake(VALIDATOR_A) == 2000e18, "still seated, weight republished");
        require(staking.seatedUnderSelfBondRule(VALIDATOR_A), "an incumbent exemption would end here");
        operatorB.doExpectingFailure(address(staking), "claimOperatorTokenRewards", "SS: no rewards", _list(address(cata)));
        operatorA.doSuccessfully(address(staking), "claimOperatorTokenRewards", _list(address(cata)));
        require(cata.balanceOf(address(operatorA)) == 5e18, "the outgoing operator keeps what it earned");

        // Nobody but the key moves the binding.
        attacker.doExpectingFailure(address(registry), "setOperator", "VR: validator did not authorize operator", VALIDATOR_A, address(attacker), uint8(0), uint256(0), uint256(0));
    }

    // Binding back to the record's operator withdraws the handover.
    function it_withdraws_a_handover_when_the_key_binds_back() public {
        _bondBoth();
        _announceHandover(validatorA, VALIDATOR_A, operatorB);
        require(staking.pendingOperator(VALIDATOR_A) == address(operatorB), "announced");
        _announceHandover(validatorA, VALIDATOR_A, operatorA);
        require(staking.pendingOperator(VALIDATOR_A) == address(0) && staking.operatorChangeReadyTime(VALIDATOR_A) == 0, "withdrawn");
        require(registry.operatorOf(VALIDATOR_A) == address(operatorA) && staking.operatorOf(VALIDATOR_A) == address(operatorA), "both agree again");
        fastForward(WEEK, 1);
        operatorB.doExpectingFailure(address(staking), "acceptOperator(address,uint256)", "SS: not the pending operator", VALIDATOR_A, 1000e18);
    }

    function it_rejects_binding_a_validator_without_its_key() public {
        attacker.doExpectingFailure(address(registry), "register", "VR: validator did not authorize operator", address(0xcccc), uint256(0), "x", "", "", uint8(27), uint256(1), uint256(1));
        require(staking.status(address(0xcccc)) == 0, "nothing listed");
        attacker.doExpectingFailure(address(registry), "register", "VR: already registered", VALIDATOR_A, uint256(0), "x", "", "", uint8(27), uint256(1), uint256(1));
        bool rejected = false;
        try attacker.do(address(registry), "adminSetOperator(address,address)", VALIDATOR_A, address(attacker)) {
        } catch {
            rejected = true;
        }
        require(rejected && registry.operatorOf(VALIDATOR_A) == address(operatorA), "there is no unsigned way to move a validator");
    }

    function it_gives_a_weeks_notice_before_a_commission_raise_and_has_no_admin_bypass() public {
        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(300));
        require(_commissionOf(VALIDATOR_A) == 300, "a cut applies at once");

        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(900));
        require(_commissionOf(VALIDATOR_A) == 300, "a raise is only announced");
        require(staking.announcedCommissionBps(VALIDATOR_A) == 900, "announced");
        require(staking.announcedCommissionTime(VALIDATOR_A) == block.timestamp + WEEK, "for a week");
        operatorA.doExpectingFailure(address(staking), "setCommissionBps(address,uint256)", "SS: commission notice running", VALIDATOR_A, uint256(900));
        fastForward(WEEK - 1, 1);
        operatorA.doExpectingFailure(address(staking), "setCommissionBps(address,uint256)", "SS: commission notice running", VALIDATOR_A, uint256(900));

        fastForward(1, 1);
        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(900));
        require(_commissionOf(VALIDATOR_A) == 900, "applied after the notice");

        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(1000));
        require(_commissionOf(VALIDATOR_A) == 900, "each raise needs its own notice");
        bool rejected = false;
        try attacker.do(address(staking), "setValidatorCommissionBps(address,uint256)", VALIDATOR_A, uint256(1000)) {
        } catch {
            rejected = true;
        }
        require(rejected && _commissionOf(VALIDATOR_A) == 900, "nobody sets it for the operator");
    }

    // Commission is charged when income is credited, so a ceiling vote never redistributes
    // what is already on the books.
    function it_keeps_credited_splits_through_a_ceiling_change() public {
        _stake(user1, VALIDATOR_A, 1000e18);
        _bondBoth();                                  // A: 1000 self-bond at 5% + 1000 delegated
        staking.qualifyStake(address(user1), VALIDATOR_A);
        _reward(VALIDATOR_A, 100e18);
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e17, "self-bond 50 + commission 2.5");

        staking.setParams(0, 16);
        require(staking.maxCommissionBps() == 0, "ceiling lowered to zero");
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e17, "the credited split stands");
        require(_claimDelegator(user1, VALIDATOR_A) == 475e17, "and so does the delegator's");

        _reward(VALIDATOR_A, 100e18);
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e17 + 50e18, "no commission under a zero ceiling from here");
    }

    function it_removes_for_cause_with_grounds_and_notice() public {
        _bondBoth();
        bool rejected = false;
        try registry.removeValidator(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected, "a removal is announced first");
        rejected = false;
        try registry.announceRemoval(VALIDATOR_A, "") {
        } catch {
            rejected = true;
        }
        require(rejected, "with its grounds");
        rejected = false;
        try user1.do(address(registry), "announceRemoval", VALIDATOR_A, "squat") {
        } catch {
            rejected = true;
        }
        require(rejected && registry.removalAnnouncedAt(VALIDATOR_A) == 0, "by the owner only");

        registry.announceRemoval(VALIDATOR_A, "test: repeated double-signing, evidence at ipfs://...");
        require(registry.removalAnnouncedAt(VALIDATOR_A) == block.timestamp, "announced");
        rejected = false;
        try registry.removeValidator(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected && gov.isValidator(VALIDATOR_A), "the notice runs for a week");

        fastForward(WEEK, 1);
        uint256 before = strato.balanceOf(address(operatorA));
        registry.removeValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A) && staking.status(VALIDATOR_A) == 3, "delisted");
        require(strato.balanceOf(address(operatorA)) - before == 1000e18, "the bond is the operator's and comes back at once");
        require(registry.removalAnnouncedAt(VALIDATOR_A) == 0, "notice cleared");

        rejected = false;
        try registry.addValidator(VALIDATOR_A, address(operatorA), 500, "Validator A", "", "", "validator-a") {
        } catch {
            rejected = true;
        }
        require(rejected, "no relisting for a week");
        fastForward(WEEK, 1);
        rejected = false;
        try registry.addValidator(VALIDATOR_A, address(operatorB), 500, "Validator A", "", "", "validator-a") {
        } catch {
            rejected = true;
        }
        require(rejected, "and never under another operator without the key");
        registry.addValidator(VALIDATOR_A, address(operatorA), 500, "Validator A", "", "", "validator-a");
        require(staking.status(VALIDATOR_A) == 1, "Registered again, not Active");
    }

    function it_lets_the_owner_withdraw_an_announced_removal() public {
        _bondBoth();
        registry.announceRemoval(VALIDATOR_A, "test: grounds");
        registry.cancelRemoval(VALIDATOR_A);
        fastForward(WEEK, 1);
        bool rejected = false;
        try registry.removeValidator(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected && gov.isValidator(VALIDATOR_A), "withdrawn: nothing to execute");
    }
}
