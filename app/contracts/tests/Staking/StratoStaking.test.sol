// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/StratoStaking.sol";
import "../../concrete/Staking/ValidatorRegistry.sol";
import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Util.sol";

// Reproduces state that only a proxy upgraded in place on helium can hold: fields the
// current initialize() always writes, records without an operator field, a consensus set
// that predates its index, seats that predate the self-bond rule, and the retired reward
// schedule's leftovers. It also prices the self-bond minimum at minStake, so amounts stay
// small, unless a test switches the real one on.
contract UpgradedInPlaceStaking is StratoStaking {
    bool public realSelfBondMinimum;

    constructor(address initialOwner) StratoStaking(initialOwner) { }

    function useRealSelfBondMinimum() public {
        realSelfBondMinimum = true;
    }

    function _minSelfBond() internal view override returns (uint256) {
        return realSelfBondMinimum ? super._minSelfBond() : minStake;
    }

    function forgetSelfBondRule(address validator) public {
        seatedUnderSelfBondRule[validator] = false;
    }

    function forgetJoinsOpenFromBlock() public {
        joinsOpenFromBlock = 0;
    }

    // The last processed block carried this timestamp; the test clock only moves forward.
    function stampLastBlockTime(uint256 timestamp) public {
        lastBlockTime = timestamp;
    }

    function forgetUsdst() public {
        usdstToken = IERC20(address(0));
    }

    function forgetSelfBondGrace() public {
        selfBondGraceUntil = 0;
    }

    function forgetOperatorField(address validator) public {
        operators[validator].operator = address(0);
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
}

// Lists validators the way genesis and admin votes do: in the set, not staking-managed.
contract GenesisGovernance is MercataGovernance {
    constructor(address initialOwner) MercataGovernance(initialOwner) { }

    function seedValidator(address validator) public {
        addValidator(validator);
    }

    function seedAdmin(address admin) public {
        admins.push(admin);
        adminMap[admin] = admins.length;
    }
}

// The test runner runs on no network, so the registry is given one: helium's network ID.
contract NetworkValidatorRegistry is ValidatorRegistry {
    constructor(address initialOwner) ValidatorRegistry(initialOwner) { }

    function _chainId() internal view override returns (uint256) {
        return 114784819836269;
    }
}

contract Describe_StratoStaking {
    uint256 public INFINITY = 2 ** 256 - 1;
    address constant VALIDATOR_A = address(0xaaaa);
    address constant VALIDATOR_B = address(0xbbbb);

    TokenFactory factory;
    Token strato;
    Token usdst;
    UpgradedInPlaceStaking staking;
    NetworkValidatorRegistry registry;
    MercataGovernance gov;

    User user1;
    User user2;
    User operatorA;
    User operatorB;
    User funder;
    // A validator key that sends its own transactions (its own operator).
    User validatorC;
    User attacker;

    function beforeAll() public {
        user1 = new User();
        user2 = new User();
        operatorA = new User();
        operatorB = new User();
        funder = new User();
        validatorC = new User();
        attacker = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        usdst = Token(factory.createTokenWithInitialOwner("USDST", "USDST Token", new string[](0), new string[](0), new string[](0), "USDST", 0, 18, address(this)));
        usdst.setStatus(2);

        staking = new UpgradedInPlaceStaking(address(this));
        staking.initialize(address(strato), address(usdst), 100, 1000, 16);

        registry = new NetworkValidatorRegistry(address(this));
        registry.initialize(address(staking));
        staking.setValidatorRegistry(address(registry));

        gov = new MercataGovernance(address(this));
        gov.setStakingContract(address(staking));
        staking.setGovernance(address(gov), true);
        // minStake 1000 of self-bond, 50% proposer fee share; the jail knobs (3 misses, 100s) are stored but inert
        staking.setValidatorParams(1000e18, 5000, 3, 100);
        // set of 50, generous mutation budget, 100s exit notice / unkick cooldown, no stake cap
        staking.setSetParams(50, 50, 500, 10, 100, 100, 0);
        // joins open from the next block, which the fastForward below reaches
        staking.setJoinsOpenFromBlock(block.number + 1);

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

        // Advance one block so every test starts with block.number > 0. processBlock()
        // no-ops while lastProcessedBlock == block.number, and a freshly constructed
        // staking contract has lastProcessedBlock == 0.
        fastForward(1, 1);
    }

    function _mintAndApprove(User user, uint256 amount) internal {
        strato.mint(address(user), amount);
        user.do(address(strato), "approve(address,uint256)", address(staking), INFINITY);
    }

    function _stake(User user, address validator, uint256 amount) internal {
        user.do(address(staking), "stake(address,uint256)", validator, amount);
    }

    function _list(address validator) internal pure returns (address[] memory validators) {
        validators = new address[](1);
        validators[0] = validator;
    }

    function _selfBond(User operator, address validator, uint256 amount) internal {
        operator.doSuccessfully(address(staking), "selfBond(address,uint256)", validator, amount);
    }

    function _activate(address validator) internal {
        staking.tryActivate(validator);
    }

    function _bondBoth() internal {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        _activate(VALIDATOR_A);
        _activate(VALIDATOR_B);
    }

    // The validator key registers itself, so it needs no signature.
    function _registerSelf(User key) internal {
        key.doSuccessfully(address(registry), "register", address(key), uint256(0), "Self-operated", "", "", uint8(0), uint256(0), uint256(0));
    }

    function _reward(address validator, uint256 amount) internal {
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(strato)), _amount(amount), _list(validator));
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

    // ---- set membership -------------------------------------------------------------

    function it_activates_eligible_validators_explicitly_and_tracks_weight() public {
        require(staking.status(VALIDATOR_A) == 1, "Registered");
        require(staking.operatorOf(VALIDATOR_A) == address(operatorA), "operator is a field of the validator record");
        require(!gov.isValidator(VALIDATOR_A), "not a validator before bonding");

        _selfBond(operatorA, VALIDATOR_A, 999e18);
        require(!staking.eligible(VALIDATOR_A), "below minStake");
        bool rejected = false;
        try staking.tryActivate(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected, "cannot activate below minStake");

        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.isWaiter(VALIDATOR_A), "eligible but not yet active");
        require(!gov.isValidator(VALIDATOR_A), "joining is explicit");
        _activate(VALIDATOR_A);
        require(staking.status(VALIDATOR_A) == 2, "Active");
        require(gov.isValidator(VALIDATOR_A), "registered in governance");
        require(staking.validatorCount() == 1, "counted");
        require(staking.activeValidatorCount() == 1, "indexed");
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "weight = self-bond");

        _stake(user1, VALIDATOR_A, 500e18);
        require(gov.validatorStake(VALIDATOR_A) == 1500e18, "weight includes delegated stake");
        require(staking.lastSyncedWeight(VALIDATOR_A) == 1500e18, "synced weight");

        user1.do(address(staking), "unstake(address,uint256)", VALIDATOR_A, 200e18);
        require(gov.validatorStake(VALIDATOR_A) == 1300e18, "weight follows unstake");
    }

    function it_requires_self_bond_to_meet_min_stake() public {
        _stake(user1, VALIDATOR_A, 5000e18);
        require(!staking.eligible(VALIDATOR_A), "delegated stake alone does not qualify");
        _selfBond(operatorA, VALIDATOR_A, 999e18);
        require(!staking.eligible(VALIDATOR_A), "self-bond below minStake, however much is delegated");
        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.eligible(VALIDATOR_A), "self-bond meets minStake");
    }

    // The real rule: 10,000 STRATO of the operator's own bond, however much is delegated.
    function it_needs_ten_thousand_strato_of_own_bond_for_a_new_seat() public {
        staking.useRealSelfBondMinimum();
        _stake(user1, VALIDATOR_A, 10000e18);
        _selfBond(operatorA, VALIDATOR_A, 9999e18);
        require(!staking.eligible(VALIDATOR_A), "delegations never make up the minimum");
        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.eligible(VALIDATOR_A), "10,000 of its own");
        _activate(VALIDATOR_A);
        require(staking.seatedUnderSelfBondRule(VALIDATOR_A), "seated under the rule");
    }

    // Admins can move the new-seat bar. Unset reads as 10,000; a higher bar removes the seats
    // taken under the rule that fall short, and leaves incumbents on minStake.
    function it_lets_admins_set_the_self_bond_minimum() public {
        staking.useRealSelfBondMinimum();
        require(staking.selfBondMinimum() == 0, "never set");
        _selfBond(operatorA, VALIDATOR_A, 5000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        require(!staking.eligible(VALIDATOR_A), "unset reads as 10,000");

        staking.setSelfBondMinimum(2000e18);
        require(staking.eligible(VALIDATOR_A) && staking.eligible(VALIDATOR_B), "a lower bar admits both");
        _activate(VALIDATOR_A);
        _activate(VALIDATOR_B);
        staking.forgetSelfBondRule(VALIDATOR_B);

        fastForward(1, 1);
        staking.setSelfBondMinimum(5001e18);
        require(!gov.isValidator(VALIDATOR_A), "a seat under the rule that falls short leaves at once");
        require(gov.isValidator(VALIDATOR_B), "an incumbent stays on minStake");

        bool rejected = false;
        try staking.setSelfBondMinimum(0) {
        } catch {
            rejected = true;
        }
        require(rejected, "zero is refused");
        rejected = false;
        try user1.do(address(staking), "setSelfBondMinimum", 1e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "non-owner rejected");
        require(staking.selfBondMinimum() == 5001e18, "unchanged");
    }

    // Helium's validators were admitted on delegated stake. A seat from before the self-bond
    // rule keeps that rule while no deadline is written, and leaves it when the admins pick one.
    function it_phases_in_the_self_bond_rule_after_the_grace_deadline() public {
        staking.forgetSelfBondGrace();
        _bondBoth();
        _stake(user1, VALIDATOR_B, 1000e18);
        staking.forgetSelfBondRule(VALIDATOR_B);
        operatorB.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_B, 2000e18);
        require(staking.eligible(VALIDATOR_B), "no deadline set: delegated stake still qualifies an incumbent");
        require(gov.isValidator(VALIDATOR_B), "and keeps its seat");

        staking.setSelfBondGraceUntil(block.timestamp + 100);
        require(gov.isValidator(VALIDATOR_B), "setting a future deadline removes nobody");

        fastForward(101, 1);
        require(!staking.eligible(VALIDATOR_B), "deadline passed: self-bond rule");
        staking.syncValidator(VALIDATOR_B);
        require(!gov.isValidator(VALIDATOR_B), "left the set on the next sync");
        require(gov.isValidator(VALIDATOR_A), "a self-bonded validator is unaffected");
    }

    // A candidate never gets the incumbent rule, and an incumbent loses it by leaving the set
    // or changing operator: from then on it is a new entrant.
    function it_applies_the_self_bond_rule_to_new_and_returning_seats() public {
        staking.forgetSelfBondGrace();
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_B, 1000e18);
        staking.forgetSelfBondRule(VALIDATOR_A);
        staking.forgetSelfBondRule(VALIDATOR_B);

        _registerSelf(validatorC);
        _stake(user2, address(validatorC), 5000e18);
        require(!staking.eligible(address(validatorC)), "a candidate needs its own bond, grace or not");

        operatorA.doSuccessfully(address(staking), "requestExit(address)", VALIDATOR_A);
        fastForward(101, 1);
        staking.syncValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "left after its notice");
        operatorA.doSuccessfully(address(staking), "cancelExit(address)", VALIDATOR_A);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(!staking.eligible(VALIDATOR_A), "returning: delegations no longer qualify it");
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        fastForward(1, 1);
        _activate(VALIDATOR_A);
        require(staking.seatedUnderSelfBondRule(VALIDATOR_A), "back under the rule");

        User incoming = new User();
        registry.adminSetOperator(VALIDATOR_B, address(incoming));
        require(staking.seatedUnderSelfBondRule(VALIDATOR_B), "a change of operator ends the exemption");
        require(!gov.isValidator(VALIDATOR_B), "the new operator has no bond, and delegations no longer count");
    }

    // The pre-upgrade contract maintained lastSyncedWeight without ever calling
    // governance, so the cache reported "already synced" while governance held
    // nothing. A fresh governance that lists the validators but holds no stakes
    // reproduces that shape.
    function it_republishes_stakes_to_a_governance_that_knows_nothing() public {
        _bondBoth();
        uint256 weightA = gov.validatorStake(VALIDATOR_A);
        uint256 weightB = gov.validatorStake(VALIDATOR_B);
        require(weightA == 1000e18 && weightB == 2000e18, "published to the original governance");

        MercataGovernance fresh = new MercataGovernance(address(this));
        fresh.setStakingContract(address(this));
        fresh.addValidatorFromStaking(VALIDATOR_A, 0);
        fresh.addValidatorFromStaking(VALIDATOR_B, 0);
        fresh.setStakingContract(address(staking));
        require(fresh.validatorStake(VALIDATOR_A) == 0, "fresh governance holds no stakes");
        require(staking.lastSyncedWeight(VALIDATOR_A) == weightA, "local cache still claims synced");

        staking.setGovernance(address(fresh), true);

        require(fresh.validatorStake(VALIDATOR_A) == weightA, "republished despite the cache");
        require(fresh.validatorStake(VALIDATOR_B) == weightB, "both validators republished");
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
        attacker.do(address(staking), "syncValidator(address)", VALIDATOR_A);
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
        operatorA.do(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1e18);
        require(!gov.isValidator(VALIDATOR_A), "left below minStake");
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

        operatorA.do(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1e18);
        require(!gov.isValidator(VALIDATOR_A), "removed below minStake in the same tx");
        require(staking.status(VALIDATOR_A) == 1, "back to Registered");
        require(staking.validatorCount() == 1, "count updated");
        require(staking.activeValidatorCount() == 1, "index updated");
        require(gov.isValidator(VALIDATOR_B), "B unaffected");

        _stake(user1, VALIDATOR_A, 1e18);
        require(!staking.isWaiter(VALIDATOR_A), "delegated stake does not restore eligibility");
        _selfBond(operatorA, VALIDATOR_A, 1e18);
        require(staking.isWaiter(VALIDATOR_A), "self-bond does");
        require(!gov.isValidator(VALIDATOR_A), "no implicit re-activation");
        fastForward(1, 1);
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "re-added on request");

        registry.removeValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "removed with the listing");
        require(staking.status(VALIDATOR_A) == 3, "Kicked");
    }

    // Governance keeps its last validator, so that seat cannot be given up. Its operator's
    // bond then stays in: a seat must not vote without it. A delegator is never held back.
    function it_never_removes_the_last_validator() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _activate(VALIDATOR_A);
        _stake(user1, VALIDATOR_A, 400e18);
        operatorA.doExpectingFailure(address(staking), "unbondSelf(address,uint256)", "SS: cannot leave the set", VALIDATOR_A, 500e18);
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "the bond stays behind the seat");
        require(gov.isValidator(VALIDATOR_A), "governance keeps its last validator");
        require(staking.isValidator(VALIDATOR_A), "still seated");
        require(gov.validatorStake(VALIDATOR_A) == 1400e18, "its published weight is still backed");

        // a withdrawal that leaves the seat qualified goes through
        _selfBond(operatorA, VALIDATOR_A, 200e18);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 200e18);
        // and so does a delegator's
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 400e18);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "weight follows the stake");
    }

    function it_reconciles_the_set_when_governance_is_enabled_later() public {
        staking.setGovernance(address(gov), false);
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        require(gov.validatorCount() == 0, "no governance calls while disabled");

        staking.setGovernance(address(gov), true);
        address[] memory candidates = new address[](2);
        candidates[0] = VALIDATOR_A;
        candidates[1] = VALIDATOR_B;
        staking.reconcileSet(candidates);
        require(gov.validatorCount() == 2, "enabled: both promoted");
        require(gov.validatorStake(VALIDATOR_B) == 2000e18, "weights published");
    }

    // ---- income: block rewards and proposer fees ------------------------------------------

    function it_credits_block_rewards_to_the_operator_and_delegators() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18);

        _reward(VALIDATOR_A, 100e18);
        require(staking.allocatedRewardLiability() == 100e18, "credited rewards are a liability");
        // weight 2000: self-bond 1000 -> 50, delegators 50 gross, 5% commission -> 2.5 + 47.5
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e17, "operator self-bond share + commission");

        uint256 before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) - before == 475e17, "delegator claimed its share");

        before = strato.balanceOf(address(operatorA));
        operatorA.doSuccessfully(address(staking), "claimOperatorRewards(address)", VALIDATOR_A);
        require(strato.balanceOf(address(operatorA)) - before == 525e17, "operator claimed its share");
        require(staking.allocatedRewardLiability() == 0, "all paid out");
    }

    function it_refuses_the_flat_block_reward() public {
        _bondBoth();
        uint256 held = strato.balanceOf(address(staking));
        funder.doExpectingFailure(address(staking), "creditBlockReward(address,uint256)", "SS: block reward disabled", VALIDATOR_A, 1e18);
        require(strato.balanceOf(address(staking)) == held, "nothing pulled");
        require(_pendingOperatorRewards(VALIDATOR_A) == 0, "nothing credited");
        require(staking.totalRewardsCredited() == 0, "nothing counted");
    }

    // The retired funded reward schedule is gone: no way in, and a listed validator with no
    // stake that proposes nothing earns nothing.
    function it_has_no_retired_reward_schedule() public {
        _registerSelf(validatorC);
        _bondBoth();
        _reward(VALIDATOR_A, 10e18);
        fastForward(1000, 10);

        validatorC.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: no rewards", address(validatorC));
        bool rejected = false;
        try funder.do(address(staking), "depositRewards(uint256)", 1e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "no reward schedule to fund");
    }

    function it_credits_proposer_fees_to_operator_and_delegators() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18);

        setBlockContext(VALIDATOR_A, address(0), address(0), 0);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();

        require(staking.trackedUsdst() == 100e18, "fees tracked");
        require(staking.totalFeesCredited() == 100e18, "fees credited");
        require(_pendingOperatorFees(VALIDATOR_A) == 525e17, "operator self-bond fees + commission");

        bool rejected = false;
        try user1.do(address(staking), "claimRewards", _list(VALIDATOR_A)) {
        } catch {
            rejected = true;
        }
        require(rejected, "STRATO claim does not pay fees");

        user1.do(address(staking), "claimFeeRewards", _list(VALIDATOR_A));
        require(usdst.balanceOf(address(user1)) == 475e17, "delegator claimed fee share");

        operatorA.do(address(staking), "claimOperatorFeeRewards(address)", VALIDATOR_A);
        require(usdst.balanceOf(address(operatorA)) == 525e17, "operator claimed fees");
        require(staking.trackedUsdst() == 0, "all fees paid out");
    }

    function it_settles_delegator_fees_when_stake_changes() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18);
        setBlockContext(VALIDATOR_A, address(0), address(0), 0);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();

        _stake(user2, VALIDATOR_A, 1000e18);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();
        // block 1: user1 alone gets 47.5; block 2: self-bond 1000 of weight 3000 -> 33.33..,
        // delegators 66.66.. gross, net of 5% -> 63.33.. split evenly -> 31.66.. each
        user1.do(address(staking), "claimFeeRewards", _list(VALIDATOR_A));
        user2.do(address(staking), "claimFeeRewards", _list(VALIDATOR_A));
        uint256 u1 = usdst.balanceOf(address(user1));
        uint256 u2 = usdst.balanceOf(address(user2));
        require(u1 - 475e17 == u2, "user1 kept block 1 and shares block 2 evenly");
        require(u2 > 3166e16 && u2 < 3167e16, "second block share");
    }

    function it_holds_fees_for_unknown_proposers_until_recovered() public {
        setBlockContext(address(0xdead), address(0), address(0), 0);
        usdst.mint(address(staking), 10e18);
        staking.processBlock();
        require(staking.unattributedFees() == 10e18, "held as unattributed");

        staking.recoverUnattributedFees(address(funder), 10e18);
        require(usdst.balanceOf(address(funder)) == 10e18, "recovered by owner");
        require(staking.unattributedFees() == 0, "cleared");

        bool rejected = false;
        try staking.recoverStrayToken(address(usdst), address(funder), 1) {
        } catch {
            rejected = true;
        }
        require(rejected, "usdst is not a stray token");
    }

    // A validator the registry has delisted earns no proposer fees, as it earns no block
    // rewards, even while governance still has it proposing.
    function it_holds_the_fees_of_a_delisted_proposer() public {
        registry.removeValidator(VALIDATOR_A);
        setBlockContext(VALIDATOR_A, address(0), address(0), 0);
        usdst.mint(address(staking), 10e18);
        staking.processBlock();
        require(staking.unattributedFees() == 10e18, "held as unattributed");
        require(_pendingOperatorFees(VALIDATOR_A) == 0, "nothing credited to the delisted record");
    }

    // Reward bookkeeping that claims more than the contract holds beyond principal must
    // fail the payout rather than pay it out of what stakers bonded.
    function it_never_pays_rewards_out_of_principal() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        // 5 owed on the books, nothing held beyond the 2000 of principal
        staking.seedRetiredCheckpoints(VALIDATOR_A, 0, 0, 5e18);
        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: rewards unavailable", VALIDATOR_A);
        require(strato.balanceOf(address(staking)) == 2000e18, "principal intact");
    }

    // ---- emission schedule ---------------------------------------------------------------

    // processBlock in a new block `gap` seconds after the last one, with `producer` as the
    // parent block's producer. It pays `producer` for the interval between the two blocks
    // processed before it, so the first payment comes on the third processed block.
    function _processBlockAfter(uint256 gap, address producer) internal {
        fastForward(gap, 1);
        setBlockContext(producer, producer, producer, 0);
        staking.processBlock();
    }

    function _fundReserve(uint256 amount) internal {
        funder.doSuccessfully(address(staking), "fundEmissionReserve(uint256)", amount);
    }

    function _commitRejected(uint256 e0, uint256 s0, uint256 r0) internal returns (bool) {
        bool rejected = false;
        try staking.commitEmissionSchedule(e0, s0, r0, 0) {
        } catch {
            rejected = true;
        }
        return rejected;
    }

    function it_commits_the_emission_schedule_once_and_only_when_funded() public {
        require(_commitRejected(500e18, 1000e18, 1000e18), "an unfunded schedule cannot be committed");

        _fundReserve(1000e18);
        require(staking.emissionReserve() == 1000e18, "anyone funds the reserve");
        require(_commitRejected(500e18, 1000e18, 1001e18), "the reserve must hold r0");
        require(_commitRejected(0, 1000e18, 1000e18), "a zero rate is no schedule");
        require(_commitRejected(500e18, 0, 1000e18), "nor a zero reference stake");
        require(_commitRejected(500e18, 1000e18, 0), "nor a zero reference reserve");
        bool rejected = false;
        try user1.do(address(staking), "commitEmissionSchedule(uint256,uint256,uint256,uint256)", 500e18, 1000e18, 1000e18, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "only the owner commits");

        staking.commitEmissionSchedule(500e18, 1000e18, 1000e18, 0);
        require(staking.emissionStartTime() == block.timestamp, "a start in the past means now");
        require(_commitRejected(1000e18, 1000e18, 1000e18), "committed once: no re-calibration");
        require(staking.emissionRateE0() == 500e18, "the committed rate stands");
    }

    // E = E0 * sqrt(S / S0) * (R / R0) a year.
    function it_scales_the_rate_with_the_root_of_stake_and_with_the_reserve() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18); // consensus weight 4000
        _fundReserve(10000e18);
        require(staking.emissionAnnualRate() == 0, "nothing before the commitment");
        staking.commitEmissionSchedule(500e18, 1000e18, 10000e18, 0);
        require(staking.emissionAnnualRate() == 1000e18, "4x the reference stake: 2x the rate");

        _fundReserve(10000e18);
        require(staking.emissionAnnualRate() == 2000e18, "twice the reference reserve: twice again");

        _stake(user2, VALIDATOR_B, 5000e18); // consensus weight 9000
        require(staking.emissionAnnualRate() == 3000e18, "9x the reference stake: 3x");
        require(staking.emissionStakeS0() == 1000e18 && staking.emissionReserveR0() == 10000e18, "the reference values stay committed");
    }

    function it_pays_each_producer_the_formula_split_like_the_block_reward() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18); // A: 2000, half of it self-bond; B: 2000
        // 31,536 STRATO a year at the current 4,000 of weight and a full reserve: 1e15 a second
        _fundReserve(10000e18);
        staking.commitEmissionSchedule(31536e18, 4000e18, 10000e18, 0);
        require(staking.emissionAnnualRate() == 31536e18, "S = S0 and R = R0: the reference rate");

        _processBlockAfter(1, VALIDATOR_A);
        _processBlockAfter(60, VALIDATOR_A); // A's block closes 60 seconds
        require(staking.totalEmitted() == 0, "paid in the block after, once the interval is known");
        _processBlockAfter(1, VALIDATOR_A);
        require(staking.totalEmitted() == 6e16, "60 seconds at 1e15 a second");
        require(staking.emissionReserve() == 10000e18 - 6e16, "out of the reserve");
        require(staking.allocatedRewardLiability() == 6e16, "owed like any reward");
        // self-bond 1000 of 2000 -> 3e16, delegators 3e16 gross, 5% commission -> 1.5e15 + 2.85e16
        require(_pendingOperatorRewards(VALIDATOR_A) == 315e14, "operator self-bond share + commission");
        require(_pendingOperatorRewards(VALIDATOR_B) == 0, "only the producer is paid");

        uint256 before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) - before == 285e14, "delegator share");
        operatorA.doSuccessfully(address(staking), "claimOperatorRewards(address)", VALIDATOR_A);
        require(strato.balanceOf(address(staking)) == staking.principalBalance() + staking.emissionReserve(), "claims never touch the reserve");
    }

    function it_pays_nothing_before_the_start_and_caps_a_long_gap() public {
        _bondBoth();
        _fundReserve(10000e18);
        uint256 start = block.timestamp + 100;
        staking.commitEmissionSchedule(31536e18, 3000e18, 10000e18, start);
        require(staking.emissionStartTime() == start, "a future start is kept");

        _processBlockAfter(1, VALIDATOR_A);   // start - 99
        _processBlockAfter(10, VALIDATOR_A);  // start - 89
        _processBlockAfter(60, VALIDATOR_A);  // start - 29: pays for start - 99 .. start - 89
        _processBlockAfter(50, VALIDATOR_A);  // start + 21: pays for start - 89 .. start - 29
        require(staking.totalEmitted() == 0, "nothing before the start");

        uint256 rate = staking.emissionAnnualRate();
        _processBlockAfter(1, VALIDATOR_A);   // pays for start - 29 .. start + 21: only the part after the start
        require(staking.totalEmitted() == (rate * 21) / 31536000, "21 seconds after the start");

        _processBlockAfter(7200, VALIDATOR_A); // two hours later; pays for the second before
        uint256 emitted = staking.totalEmitted();
        rate = staking.emissionAnnualRate();
        _processBlockAfter(1, VALIDATOR_A);    // pays for the two hours
        require(staking.totalEmitted() - emitted == (rate * 3600) / 31536000, "a gap is paid for one hour at most");
    }

    // A block stamped behind its parent closes no interval, and the time it stepped back over
    // is not paid a second time to the block after it.
    function it_never_pays_time_twice_when_a_stamp_goes_backwards() public {
        _bondBoth();
        _fundReserve(10000e18);
        staking.commitEmissionSchedule(31536e18, 3000e18, 10000e18, 0);
        _processBlockAfter(1, VALIDATOR_A);
        _processBlockAfter(100, VALIDATOR_A);
        _processBlockAfter(10, VALIDATOR_A);  // pays the 100 seconds
        uint256 paid = staking.totalEmitted();
        require(paid > 0, "the interval is paid");

        // the block just processed was stamped 50 seconds behind its parent
        uint256 parent = staking.previousBlockTime();
        staking.stampLastBlockTime(parent - 50);
        _processBlockAfter(1, VALIDATOR_A);   // its interval: nothing
        require(staking.totalEmitted() == paid, "a stamp behind its parent pays nothing");
        require(staking.previousBlockTime() == parent, "the start does not move back");

        uint256 rate = staking.emissionAnnualRate();
        _processBlockAfter(1, VALIDATOR_A);   // pays from the parent's stamp, not from the stamp behind it
        require(staking.totalEmitted() - paid == (rate * 11) / 31536000, "only the 11 seconds not yet paid");
    }

    // Pay follows the seat: a seated, listed producer is paid; anything else stays in the
    // reserve. The own-bond rule gates holding a seat, not being paid for a block.
    function it_pays_only_seated_producers() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18); // listed and eligible, not seated
        _fundReserve(10000e18);
        staking.commitEmissionSchedule(31536e18, 3000e18, 10000e18, 0);

        _processBlockAfter(1, address(validatorC));
        _processBlockAfter(60, address(validatorC));
        _processBlockAfter(60, address(validatorC));
        _processBlockAfter(60, address(0xdead));
        _processBlockAfter(60, address(0xdead));
        require(staking.totalEmitted() == 0 && staking.emissionReserve() == 10000e18, "a validator outside the set, or an unknown key, earns nothing");

        operatorA.doSuccessfully(address(staking), "requestExit(address)", VALIDATOR_A);
        _processBlockAfter(101, VALIDATOR_A); // its exit notice is up; nothing has synced it out yet
        require(staking.isValidator(VALIDATOR_A) && !staking.eligible(VALIDATOR_A), "seated, no longer eligible");
        _processBlockAfter(60, VALIDATOR_A);
        uint256 paidToA = staking.totalEmitted();
        require(paidToA > 0 && _pendingOperatorRewards(VALIDATOR_A) == paidToA, "a seat that is due to leave is paid for the blocks it produces until it is synced out");

        _processBlockAfter(60, VALIDATOR_B);
        _processBlockAfter(60, VALIDATOR_B);
        require(staking.totalEmitted() > paidToA && _pendingOperatorRewards(VALIDATOR_B) == staking.totalEmitted() - paidToA, "a seated producer is");
    }

    function it_keeps_the_emission_reserve_out_of_payouts_and_recovery() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _fundReserve(500e18);
        require(staking.recoverableUntrackedStrato() == 0, "the reserve is not untracked STRATO");
        bool rejected = false;
        try staking.recoverUntrackedStrato(address(user2), 1) {
        } catch {
            rejected = true;
        }
        require(rejected, "the owner cannot take the reserve back");

        strato.mint(address(staking), 5e18); // sent directly, owed to nobody
        require(staking.recoverableUntrackedStrato() == 5e18, "only what is owed to nobody");
        staking.recoverUntrackedStrato(address(user2), 5e18);

        // 5 owed on the books, nothing held beyond principal and the reserve
        staking.seedRetiredCheckpoints(VALIDATOR_A, 0, 0, 5e18);
        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: rewards unavailable", VALIDATOR_A);
        require(staking.emissionReserve() == 500e18 && strato.balanceOf(address(staking)) == 1500e18, "reserve intact");
    }

    function it_never_releases_more_than_the_reserve() public {
        _bondBoth();
        // a year at this rate is a million STRATO; the reserve holds one
        _fundReserve(1e18);
        staking.commitEmissionSchedule(1000000e18, 3000e18, 1e18, 0);
        _processBlockAfter(1, VALIDATOR_A);
        _processBlockAfter(3600, VALIDATOR_A);
        _processBlockAfter(1, VALIDATOR_A);
        require(staking.emissionReserve() == 0 && staking.totalEmitted() == 1e18, "capped at what is left");

        _processBlockAfter(60, VALIDATOR_A);
        _processBlockAfter(60, VALIDATOR_A);
        require(staking.totalEmitted() == 1e18, "nothing once the reserve is spent");
        uint256 before = strato.balanceOf(address(operatorA));
        operatorA.doSuccessfully(address(staking), "claimOperatorRewards(address)", VALIDATOR_A);
        require(strato.balanceOf(address(operatorA)) - before == 1e18, "all of it claimable");
    }

    // ---- discretionary rewards -----------------------------------------------------------

    function _fundedToken(string symbol) internal returns (Token) {
        Token token = Token(factory.createTokenWithInitialOwner(symbol, symbol, new string[](0), new string[](0), new string[](0), symbol, 0, 18, address(this)));
        token.setStatus(2);
        token.mint(address(funder), 100000e18);
        funder.do(address(token), "approve(address,uint256)", address(staking), INFINITY);
        return token;
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

    function it_distributes_strato_and_usdst_across_the_consensus_set_by_weight() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18); // A: 2000, B: 2000
        usdst.mint(address(funder), 1000e18);
        funder.do(address(usdst), "approve(address,uint256)", address(staking), INFINITY);

        funder.doSuccessfully(address(staking), "distributeRewards", _pair(address(strato), address(usdst)), _amounts(100e18, 100e18), new address[](0));

        // A gets 50 of each: self-bond 1000 of 2000 -> 25, delegators 25 gross, 5% commission -> 1.25 + 23.75
        require(_pendingOperatorRewards(VALIDATOR_A) == 2625e16, "A operator STRATO");
        require(_pendingOperatorFees(VALIDATOR_A) == 2625e16, "A operator USDST");
        require(_pendingOperatorRewards(VALIDATOR_B) == 50e18 && _pendingOperatorFees(VALIDATOR_B) == 50e18, "B has no delegators");
        require(staking.allocatedRewardLiability() == 100e18, "STRATO owed");
        require(staking.trackedUsdst() == 100e18, "USDST tracked");
        require(staking.totalRewardsCredited() == 0, "block reward counter untouched");

        setBlockContext(VALIDATOR_B, address(0), address(0), 0);
        staking.processBlock();
        require(staking.totalFeesCredited() == 0, "the next fee sync does not re-attribute it to the proposer");

        uint256 before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) - before == 2375e16, "delegator STRATO");
        user1.doSuccessfully(address(staking), "claimFeeRewards", _list(VALIDATOR_A));
        require(usdst.balanceOf(address(user1)) == 2375e16, "delegator USDST");
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
        _bondBoth();
        _stake(user1, VALIDATOR_A, 1000e18);
        Token cata = _fundedToken("CATA");

        funder.doSuccessfully(address(staking), "distributeRewardsTo", _pair(address(strato), address(cata)), _amounts(10e18, 7e18), _pair(VALIDATOR_A, VALIDATOR_B));

        // STRATO to A: self-bond 1000 of 2000 -> 5, delegators 5 gross, 5% commission -> 0.25 + 4.75
        require(_pendingOperatorRewards(VALIDATOR_A) == 525e16, "A operator STRATO");
        require(_pendingOperatorRewards(VALIDATOR_B) == 0, "B got no STRATO");
        require(staking.pendingOperatorTokenRewards(address(operatorB), address(cata)) == 7e18, "B's operator got the CATA");
        require(staking.pendingOperatorTokenRewards(address(operatorA), address(cata)) == 0, "A's operator got no CATA");

        uint256 before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) - before == 475e16, "delegator STRATO");
    }

    function it_keeps_token_rewards_with_the_operator_that_earned_them() public {
        _bondBoth();
        Token cata = _fundedToken("CATA");
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(5e18), _list(VALIDATOR_A));

        registry.adminSetOperator(VALIDATOR_A, address(operatorB));
        operatorB.doExpectingFailure(address(staking), "claimOperatorTokenRewards", "SS: no rewards", _list(address(cata)));
        operatorA.doSuccessfully(address(staking), "claimOperatorTokenRewards", _list(address(cata)));
        require(cata.balanceOf(address(operatorA)) == 5e18, "the outgoing operator keeps what it earned");
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

    function it_never_recovers_owed_token_rewards_as_stray() public {
        _bondBoth();
        Token cata = _fundedToken("CATA");
        funder.doSuccessfully(address(staking), "distributeRewardsTo", _list(address(cata)), _amount(5e18), _list(VALIDATOR_A));
        cata.mint(address(staking), 2e18); // sent directly, owed to nobody

        bool rejected = false;
        try staking.recoverStrayToken(address(cata), address(user2), 3e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "owed rewards are not stray");
        staking.recoverStrayToken(address(cata), address(user2), 2e18);
        require(cata.balanceOf(address(user2)) == 2e18 && cata.balanceOf(address(staking)) == 5e18, "only the unowed part recovered");
    }

    // ---- in-place upgrade from the operator-keyed layout ---------------------------------

    // What the retired schedule allocated but never paid is credited once, exactly as its
    // own bookkeeping would have, and never again.
    function it_settles_the_retired_reward_schedule_once() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        strato.mint(address(staking), 211e18);
        // base index 10 per operator, stake index 0.1 per token, 1 of base already pending
        staking.seedRetiredSchedule(10e18, 1e17, 211e18);
        staking.seedRetiredCheckpoints(VALIDATOR_A, 0, 0, 1e18);

        // operator: 1 pending + 10 base + 100 on its self-bond; delegators: 100 gross, 5% commission
        uint256 before = strato.balanceOf(address(operatorA));
        operatorA.doSuccessfully(address(staking), "claimOperatorRewards(address)", VALIDATOR_A);
        require(strato.balanceOf(address(operatorA)) - before == 116e18, "operator: 111 + 5 commission");

        before = strato.balanceOf(address(user1));
        user1.doSuccessfully(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) - before == 95e18, "delegator: 95");

        operatorA.doExpectingFailure(address(staking), "claimOperatorRewards(address)", "SS: no rewards", VALIDATOR_A);
        user1.doExpectingFailure(address(staking), "claimRewards", "SS: no rewards", _list(VALIDATOR_A));
        require(staking.allocatedRewardLiability() == 0, "liability fully discharged");
    }

    function it_sets_usdst_on_a_contract_upgraded_in_place() public {
        UpgradedInPlaceStaking upgraded = new UpgradedInPlaceStaking(address(this));
        upgraded.initialize(address(strato), address(usdst), 100, 1000, 16);
        upgraded.forgetUsdst();
        require(address(upgraded.usdstToken()) == address(0), "starts unset, as on helium");

        // Fees that arrived before attribution existed stay out of the first credit.
        usdst.mint(address(upgraded), 7e18);
        upgraded.setUsdstToken(address(usdst));
        require(address(upgraded.usdstToken()) == address(usdst), "usdst wired");
        require(upgraded.trackedUsdst() == 7e18, "pre-existing balance is not credited to a proposer");

        bool rejected = false;
        try upgraded.setUsdstToken(address(usdst)) {
        } catch {
            rejected = true;
        }
        require(rejected, "usdst cannot be repointed once set");
    }

    function it_only_lets_the_owner_set_usdst() public {
        UpgradedInPlaceStaking upgraded = new UpgradedInPlaceStaking(address(this));
        upgraded.initialize(address(strato), address(usdst), 100, 1000, 16);
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

        user2.doSuccessfully(address(staking), "indexValidatorSet");
        require(staking.activeValidatorCount() == 2, "the set governance lists is indexed");
        user2.doSuccessfully(address(staking), "indexValidatorSet");
        require(staking.activeValidatorCount() == 2, "idempotent");

        staking.forgetOperatorField(VALIDATOR_A);
        require(staking.operatorOf(VALIDATOR_A) == VALIDATOR_A, "a record without an operator field is operated by its key");
    }

    // Helium's governance held no stakes after the upgrade, so the first weight published
    // would have been the only weight in the set: one weighted validator among unweighted
    // peers is the first-round proposer and a one-validator quorum, and anyone can trigger a
    // validator's publication with a wei of stake. A seat the index does not hold is never
    // published on its own; indexing reads the set from governance and publishes it whole.
    function it_publishes_a_set_that_predates_the_index_whole_or_not_at_all() public {
        _bondBoth();
        staking.forgetSetIndex();

        MercataGovernance fresh = new MercataGovernance(address(this));
        fresh.setStakingContract(address(this));
        fresh.addValidatorFromStaking(VALIDATOR_A, 0);
        fresh.addValidatorFromStaking(VALIDATOR_B, 0);
        fresh.setStakingContract(address(staking));
        staking.setGovernance(address(fresh), true);
        require(fresh.validatorStake(VALIDATOR_A) == 0 && fresh.validatorStake(VALIDATOR_B) == 0, "nothing published while unindexed");

        _stake(user1, VALIDATOR_A, 1);
        user2.doSuccessfully(address(staking), "syncValidator", VALIDATOR_B);
        require(fresh.validatorStake(VALIDATOR_A) == 0 && fresh.validatorStake(VALIDATOR_B) == 0, "a lone seat is not published");

        fresh.setStakingContract(address(this));
        fresh.addValidatorFromStaking(address(0xdead), 0);
        fresh.setStakingContract(address(staking));
        user2.doExpectingFailure(address(staking), "indexValidatorSet", "SS: validator not seated here");
        require(staking.activeValidatorCount() == 0, "a refused backfill indexes nobody");
        user2.doSuccessfully(address(staking), "syncValidator", VALIDATOR_A);
        require(fresh.validatorStake(VALIDATOR_A) == 0, "so no seat can be published alone after it");
        fresh.setStakingContract(address(this));
        require(fresh.removeValidatorFromStaking(address(0xdead)), "test setup: stranger removed");
        fresh.setStakingContract(address(staking));

        user2.doSuccessfully(address(staking), "indexValidatorSet");
        require(staking.activeValidatorCount() == 2, "the set governance lists is indexed");
        require(fresh.validatorStake(VALIDATOR_A) == 1000e18 + 1 && fresh.validatorStake(VALIDATOR_B) == 2000e18, "the whole set is published in one transaction");
    }

    // Governance refuses to drop a validator staking never managed, which is every seat a
    // proxy upgraded in place inherited. One that no longer qualifies would stay in the set
    // without a weight while its peers were published, so the backfill reverts instead.
    function it_does_not_publish_around_a_seat_governance_refuses_to_drop() public {
        _bondBoth();
        staking.forgetSetIndex();

        GenesisGovernance genesis = new GenesisGovernance(address(this));
        genesis.seedValidator(VALIDATOR_A);
        genesis.seedValidator(VALIDATOR_B);
        genesis.setStakingContract(address(staking));
        staking.setGovernance(address(genesis), true);

        operatorA.do(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1e18);
        require(genesis.isValidator(VALIDATOR_A) && !staking.eligible(VALIDATOR_A), "below minStake, kept by governance");

        user2.doExpectingFailure(address(staking), "indexValidatorSet", "SS: validator without weight");
        require(staking.activeValidatorCount() == 0, "nobody indexed");
        require(genesis.validatorStake(VALIDATOR_B) == 0, "the eligible peer is not published alone");

        _selfBond(operatorA, VALIDATOR_A, 1e18);
        user2.doSuccessfully(address(staking), "indexValidatorSet");
        require(genesis.validatorStake(VALIDATOR_A) == 1000e18 && genesis.validatorStake(VALIDATOR_B) == 2000e18, "published whole once every seat qualifies");
    }

    // ---- admin pins --------------------------------------------------------------------

    // Governance owned and administered by this contract alone, so each vote executes at once.
    function _pinningGovernance() internal returns (GenesisGovernance pins) {
        pins = new GenesisGovernance(address(this));
        pins.seedAdmin(address(this));
        pins.setStakingContract(address(staking));
        staking.setGovernance(address(pins), true);
    }

    function it_keeps_a_pinned_validator_whatever_its_stake() public {
        GenesisGovernance pins = _pinningGovernance();
        staking.setSetParams(2, 50, 500, 10, 100, 100, 0);
        _bondBoth();
        _stake(user1, VALIDATOR_A, 300e18);
        pins.voteToAddValidator(VALIDATOR_A);

        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(!staking.eligible(VALIDATOR_A), "no longer qualifies");
        require(pins.isValidator(VALIDATOR_A) && staking.isValidator(VALIDATOR_A), "the pin keeps the seat");
        require(pins.validatorStake(VALIDATOR_A) == 300e18, "its weight still follows its stake");

        // The lowest seat is pinned, so a newcomer has to beat the next one up.
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1050e18);
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: set full", address(validatorC));
        _selfBond(validatorC, address(validatorC), 1050e18);
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(pins.isValidator(VALIDATOR_A) && !pins.isValidator(VALIDATOR_B), "B evicted, the pinned seat kept");

        pins.voteToClearValidatorPin(VALIDATOR_A);
        require(pins.isValidator(VALIDATOR_A), "clearing changes no membership by itself");
        staking.syncValidator(VALIDATOR_A);
        require(!pins.isValidator(VALIDATOR_A) && staking.status(VALIDATOR_A) == 1, "the next sync applies the stake rules again");
    }

    // A validator the admins pin in takes a seat in staking too, whatever its stake and
    // whatever room the set has, so the stake behind it becomes its weight.
    function it_adopts_a_validator_the_admins_pin_in() public {
        GenesisGovernance pins = _pinningGovernance();
        staking.setSetParams(1, 50, 500, 10, 100, 100, 0);
        _selfBond(operatorA, VALIDATOR_A, 100e18);
        _stake(user1, VALIDATOR_A, 400e18);
        require(!staking.eligible(VALIDATOR_A), "below minStake");

        pins.voteToAddValidator(VALIDATOR_A);
        require(pins.isValidator(VALIDATOR_A) && pins.validatorStake(VALIDATOR_A) == 0, "seated by the vote, no weight yet");
        attacker.do(address(staking), "syncValidator(address)", VALIDATOR_A);
        require(staking.isValidator(VALIDATOR_A) && staking.activeValidatorCount() == 1, "staking took the seat");
        require(pins.validatorStake(VALIDATOR_A) == 500e18, "its stake is its weight");

        _selfBond(operatorB, VALIDATOR_B, 1000e18);
        pins.voteToAddValidator(VALIDATOR_B);
        _activate(VALIDATOR_B);
        require(staking.isValidator(VALIDATOR_B) && staking.validatorCount() == 2, "adopted past the cap");
        require(pins.isValidator(VALIDATOR_A), "nobody evicted to make room");
    }

    // A validator the admins pin out leaves at the next sync and cannot come back by stake
    // until the pin is cleared.
    function it_keeps_a_pinned_out_validator_out() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToRemoveValidator(VALIDATOR_A);
        require(!pins.isValidator(VALIDATOR_A), "voted out");
        staking.syncValidator(VALIDATOR_A);
        require(staking.status(VALIDATOR_A) == 1, "seat given up");

        fastForward(1, 1);
        require(staking.eligible(VALIDATOR_A) && !staking.isWaiter(VALIDATOR_A), "eligible, but not a waiter");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: pinned out by governance", VALIDATOR_A);
        staking.reconcileSet(_list(VALIDATOR_A));
        require(!pins.isValidator(VALIDATOR_A), "reconciling passes it over");

        pins.voteToClearValidatorPin(VALIDATOR_A);
        require(staking.isWaiter(VALIDATOR_A), "a waiter again");
        _activate(VALIDATOR_A);
        require(pins.isValidator(VALIDATOR_A), "joins by stake once the pin is cleared");
    }

    // Clearing a pin hands the seat back to staking even when staking never took it: the
    // first sync adopts it, then the stake rules remove it.
    function it_hands_back_a_seat_whose_pin_was_cleared_before_adoption() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 100e18);
        pins.voteToAddValidator(address(validatorC));
        pins.voteToClearValidatorPin(address(validatorC));
        require(pins.isValidator(address(validatorC)) && !staking.isValidator(address(validatorC)), "seated by governance only");

        attacker.do(address(staking), "syncValidator(address)", address(validatorC));
        require(!pins.isValidator(address(validatorC)) && staking.status(address(validatorC)) == 1, "below minStake, so out");
        require(staking.validatorCount() == 2, "counts balance");
    }

    // An eligible seat whose pin was cleared before adoption joins staking's set without
    // taking a slot from anyone.
    function it_activates_a_cleared_seat_without_evicting() public {
        GenesisGovernance pins = _pinningGovernance();
        staking.setSetParams(2, 50, 500, 10, 100, 100, 0);
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1100e18);
        pins.voteToAddValidator(address(validatorC));
        pins.voteToClearValidatorPin(address(validatorC));

        _activate(address(validatorC));
        require(pins.isValidator(VALIDATOR_A) && pins.isValidator(VALIDATOR_B), "nobody evicted");
        require(staking.isValidator(address(validatorC)) && staking.validatorCount() == 3, "adopted");
    }

    // A seat the admins gave before pins existed is listed, unpinned and was never handed to
    // staking. Staking leaves it alone: adopting it would let anyone's sync drop it for its bond.
    function it_leaves_a_seat_governance_never_handed_over_alone() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 100e18);
        pins.seedValidator(address(validatorC));

        attacker.do(address(staking), "syncValidator(address)", address(validatorC));
        require(pins.isValidator(address(validatorC)) && !staking.isValidator(address(validatorC)), "neither adopted nor removed");
        require(staking.validatorCount() == 2, "counts unchanged");

        _selfBond(validatorC, address(validatorC), 900e18);
        require(staking.eligible(address(validatorC)) && pins.isValidator(address(validatorC)), "eligible, and still not taken");
        attacker.doExpectingFailure(address(staking), "tryActivate(address)", "SS: governance seat not handed to staking", address(validatorC));
        require(!staking.isValidator(address(validatorC)), "not taken by activation either");
        require(!staking.isWaiter(address(validatorC)), "an admin seat is not waiting");
        attacker.doSuccessfully(address(staking), "reconcileSet", _list(address(validatorC)));
        require(!staking.isValidator(address(validatorC)) && !pins.stakingManaged(address(validatorC)), "nor taken by reconciliation");
    }

    // A kick overrides a pin: the validator leaves and the pin goes with it.
    function it_kicks_a_pinned_validator() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToAddValidator(VALIDATOR_A);
        registry.removeValidator(VALIDATOR_A);
        require(!pins.isValidator(VALIDATOR_A) && !pins.pinnedIn(VALIDATOR_A), "out, pin dropped");
        require(staking.status(VALIDATOR_A) == 3 && staking.validatorCount() == 1, "Kicked");
    }

    // ---- operators ---------------------------------------------------------------------

    function it_pays_out_and_unbonds_the_outgoing_operator_on_a_handover() public {
        _bondBoth();
        _reward(VALIDATOR_A, 100e18);
        uint256 before = strato.balanceOf(address(operatorA));

        registry.adminSetOperator(VALIDATOR_A, address(operatorB));
        require(staking.operatorOf(VALIDATOR_A) == address(operatorB), "staking follows the registry");
        require(strato.balanceOf(address(operatorA)) - before == 100e18, "outgoing operator paid its rewards");
        (uint256 queued,,) = staking.unbondingQueue(address(operatorA), 0);
        require(queued == 1000e18, "outgoing self-bond unbonds to the outgoing operator");
        require(_selfBondOf(VALIDATOR_A) == 0, "incoming operator starts with no self-bond");
        require(!gov.isValidator(VALIDATOR_A), "without self-bond the validator leaves the set");

        operatorA.doExpectingFailure(address(staking), "selfBond(address,uint256)", "SS: not operator", VALIDATOR_A, 1e18);
        _selfBond(operatorB, VALIDATOR_A, 1000e18);
        require(staking.isWaiter(VALIDATOR_A), "the new operator can requalify it");
    }

    // FINDING 2 regression: nobody binds a validator key they do not hold.
    function it_rejects_binding_a_validator_without_its_key() public {
        attacker.doExpectingFailure(address(registry), "register", "VR: validator did not authorize operator", address(0xcccc), uint256(0), "x", "", "", uint8(27), uint256(1), uint256(1));
        require(staking.status(address(0xcccc)) == 0, "nothing listed");
        attacker.doExpectingFailure(address(registry), "register", "VR: already registered", VALIDATOR_A, uint256(0), "x", "", "", uint8(27), uint256(1), uint256(1));
    }

    // Admission opens at the agreed block for everyone at once: nobody seats anyone before it,
    // the owner included, and the block is fixed once reached.
    function it_register_needs_the_key_and_activation_waits_for_the_agreed_block() public {
        staking.forgetJoinsOpenFromBlock();
        _registerSelf(validatorC);
        require(staking.status(address(validatorC)) == 1, "Registered");
        require(staking.operatorOf(address(validatorC)) == address(validatorC), "self-operated");
        require(!staking.eligible(address(validatorC)), "no stake yet");

        _selfBond(validatorC, address(validatorC), 1000e18);
        require(staking.isWaiter(address(validatorC)), "waiter");

        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: joins not open", address(validatorC));
        bool rejected = false;
        try staking.tryActivate(address(validatorC)) {
        } catch {
            rejected = true;
        }
        require(rejected, "no agreed block: the owner cannot seat anyone either");

        rejected = false;
        try staking.setJoinsOpenFromBlock(block.number) {
        } catch {
            rejected = true;
        }
        require(rejected, "only a future block can be agreed");
        staking.setJoinsOpenFromBlock(block.number + 2);
        fastForward(1, 1);
        user2.doExpectingFailure(address(staking), "reconcileSet", "SS: joins not open", _list(address(validatorC)));
        fastForward(1, 1);
        user2.doSuccessfully(address(staking), "reconcileSet", _list(address(validatorC)));
        require(staking.status(address(validatorC)) == 2, "anyone seats it from the agreed block");

        rejected = false;
        try staking.setJoinsOpenFromBlock(block.number + 10) {
        } catch {
            rejected = true;
        }
        require(rejected, "once reached, the block cannot be moved");
    }

    function it_fills_the_set_then_evicts_the_lowest_with_margin() public {
        staking.setSetParams(2, 50, 500, 10, 100, 100, 0);
        _bondBoth();
        require(staking.validatorCount() == 2, "set full");

        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1049e18);
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: set full", address(validatorC));

        _selfBond(validatorC, address(validatorC), 1e18);
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(gov.isValidator(address(validatorC)), "newcomer activated");
        require(!gov.isValidator(VALIDATOR_A), "lowest validator evicted");
        require(staking.status(VALIDATOR_A) == 1, "evicted validator is Registered");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "eviction does not unbond self-bond");
        require(staking.validatorCount() == 2, "set size unchanged");

        bool rejected = false;
        try staking.setSetParams(3, 51, 500, 10, 100, 100, 0) {
        } catch {
            rejected = true;
        }
        require(rejected, "hard cap only lowers");
    }

    function it_reconciles_named_waiters_by_stake_within_the_mutation_budget() public {
        staking.setSetParams(3, 50, 500, 2, 100, 100, 0);
        _registerSelf(validatorC);
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 3000e18);
        _selfBond(validatorC, address(validatorC), 2000e18);

        address[] memory candidates = new address[](3);
        candidates[0] = VALIDATOR_A;
        candidates[1] = VALIDATOR_B;
        candidates[2] = address(validatorC);
        user2.doSuccessfully(address(staking), "reconcileSet", candidates);
        require(gov.isValidator(VALIDATOR_B), "highest waiter first");
        require(gov.isValidator(address(validatorC)), "second highest");
        require(!gov.isValidator(VALIDATOR_A), "mutation budget exhausted for this block");

        fastForward(1, 1);
        user2.doSuccessfully(address(staking), "reconcileSet", _list(VALIDATOR_B));
        require(!gov.isValidator(VALIDATOR_A), "only named candidates are considered");
        user2.doSuccessfully(address(staking), "reconcileSet", candidates);
        require(gov.isValidator(VALIDATOR_A), "promoted in the next block");
        require(staking.validatorCount() == 3, "set full");
    }

    function it_mutation_cap_fails_closed_but_kicks_bypass_it() public {
        staking.setSetParams(50, 50, 500, 1, 100, 100, 0);
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 2000e18);
        _activate(VALIDATOR_A);
        bool rejected = false;
        try staking.tryActivate(VALIDATOR_B) {
        } catch {
            rejected = true;
        }
        require(rejected, "second mutation in the block rejected");

        fastForward(1, 1);
        _activate(VALIDATOR_B);
        registry.removeValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "kick leaves the set regardless of the cap");
        require(gov.isValidator(VALIDATOR_B), "B stays");
    }

    function it_exits_after_the_notice_period() public {
        _bondBoth();
        operatorA.do(address(staking), "requestExit(address)", VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "still serving during the notice");
        operatorA.do(address(staking), "cancelExit(address)", VALIDATOR_A);
        operatorA.do(address(staking), "requestExit(address)", VALIDATOR_A);

        fastForward(101, 1);
        staking.syncValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "left the set after the notice");
        require(staking.status(VALIDATOR_A) == 1, "Registered");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "self-bond stays bonded");
        require(staking.exitReadyTime(VALIDATOR_A) != 0, "the exit stands until cancelled");
    }

    // A validator that left on an exit stays out until its operator cancels the exit. Without
    // that, anyone's tryActivate or reconcileSet would put it back, bond and all, after its
    // operator has stopped the node.
    function it_keeps_an_exited_validator_out_until_its_operator_cancels() public {
        _bondBoth();
        operatorA.doSuccessfully(address(staking), "requestExit(address)", VALIDATOR_A);
        fastForward(101, 1);
        staking.syncValidator(VALIDATOR_A);
        fastForward(1, 1);
        require(!gov.isValidator(VALIDATOR_A) && !staking.isWaiter(VALIDATOR_A), "out, and not a waiter");

        attacker.doExpectingFailure(address(staking), "tryActivate(address)", "SS: not eligible", VALIDATOR_A);
        attacker.doSuccessfully(address(staking), "reconcileSet", _list(VALIDATOR_A));
        require(!gov.isValidator(VALIDATOR_A), "reconciling passes it over");
        attacker.doExpectingFailure(address(staking), "cancelExit(address)", "SS: not operator", VALIDATOR_A);

        operatorA.doSuccessfully(address(staking), "cancelExit(address)", VALIDATOR_A);
        require(staking.isWaiter(VALIDATOR_A), "a waiter again");
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "and back in the set");
    }

    function it_enforces_the_unkick_cooldown() public {
        _bondBoth();
        registry.removeValidator(VALIDATOR_A);
        require(staking.status(VALIDATOR_A) == 3, "Kicked");
        (uint256 queued,,) = staking.unbondingQueue(address(operatorA), 0);
        require(queued == 1000e18, "kick force-unbonds self-bond to the operator");

        bool rejected = false;
        try registry.addValidator(VALIDATOR_A, address(operatorA), 500, "Validator A", "", "", "validator-a") {
        } catch {
            rejected = true;
        }
        require(rejected, "re-listing blocked during the cooldown");

        fastForward(101, 1);
        registry.addValidator(VALIDATOR_A, address(operatorA), 500, "Validator A", "", "", "validator-a");
        require(staking.status(VALIDATOR_A) == 1, "Registered again, not Active");
    }

    function it_caps_inbound_stake_per_validator() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _selfBond(operatorB, VALIDATOR_B, 1000e18);
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 6000e18);
        _activate(VALIDATOR_A);
        _activate(VALIDATOR_B);
        _activate(address(validatorC));
        // the cap is switched on once the set is bootstrapped (a lone first staker is always 100%)
        staking.setSetParams(50, 50, 500, 10, 100, 100, 3300);

        _stake(user1, VALIDATOR_A, 1500e18); // 2500 / 9500 = 26%
        _stake(user1, VALIDATOR_B, 1000e18); // 2000 / 10500 = 19%
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: above operator stake cap", VALIDATOR_A, 1500e18);
        user1.doExpectingFailure(address(staking), "moveStake(address,address,uint256)", "SS: above operator stake cap", VALIDATOR_B, VALIDATOR_A, 1000e18);
        operatorA.doExpectingFailure(address(staking), "selfBond(address,uint256)", "SS: above operator stake cap", VALIDATOR_A, 2000e18);
        user1.do(address(staking), "unstake(address,uint256)", VALIDATOR_A, 500e18);
        require(staking.delegatedStake(address(user1), VALIDATOR_A) == 1000e18, "unstaking is never capped");
    }

    // A waiter can be over the cap without taking any stake in: it bonded before the cap was
    // switched on, or others have left since. reconcileSet holds each seat it fills to the
    // cap tryActivate applies, and passes over such a waiter rather than failing the batch.
    function it_reconciles_only_waiters_within_the_stake_cap() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 6000e18);
        User fourth = new User();
        _mintAndApprove(fourth, 10000e18);
        _registerSelf(fourth);
        _selfBond(fourth, address(fourth), 1000e18);
        staking.setSetParams(50, 50, 500, 10, 100, 100, 3300);

        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: above operator stake cap", address(validatorC));
        user2.doSuccessfully(address(staking), "reconcileSet", _two(address(validatorC), address(fourth)));
        require(!gov.isValidator(address(validatorC)), "6000 of 9000 is over the cap: passed over");
        require(gov.isValidator(address(fourth)), "1000 of 4000 is under it: seated");
    }

    // Inbound stake is not capped while the set holds none, but a seat is: a newcomer to
    // pinned seats whose stake has gone would hold all of it, so reconcileSet passes it over
    // as tryActivate refuses it.
    function it_holds_a_newcomer_to_the_cap_when_the_set_holds_no_stake() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToAddValidator(VALIDATOR_A);
        pins.voteToAddValidator(VALIDATOR_B);
        staking.setSetParams(50, 50, 500, 10, 100, 100, 3300);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        operatorB.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_B, 2000e18);
        require(staking.consensusWeight() == 0, "pinned seats, no stake");

        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18); // inbound: no cap on an empty set
        require(staking.isWaiter(address(validatorC)), "a waiter");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: above operator stake cap", address(validatorC));
        user2.doSuccessfully(address(staking), "reconcileSet", _list(address(validatorC)));
        require(!pins.isValidator(address(validatorC)), "1000 of 1000 is over the cap: passed over");
    }

    // Stake behind a listed validator outside the set carries no vote, so it gives nobody
    // room under the cap and does not hide a validator that holds over a third of the vote.
    function it_measures_the_stake_cap_and_one_third_against_the_consensus_set() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 6000e18);
        _stake(user1, VALIDATOR_A, 1000e18);
        require(staking.consensusWeight() == 4000e18, "A 2000 + B 2000; C is not in the set");
        require(staking.exceedsOneThird(VALIDATOR_A), "half of the vote, whatever C holds");

        staking.setSetParams(50, 50, 500, 10, 100, 100, 6000);
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: above operator stake cap", VALIDATOR_A, 2000e18); // 4000 / 6000
        _stake(user1, VALIDATOR_B, 500e18); // 2500 / 4500
        // a validator outside the set is measured as if it had joined: 7000 / 11500
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: above operator stake cap", address(validatorC), 1000e18);
    }

    // A leave is never held back by the block's mutation budget and does not use it up: a
    // validator that should leave does so in the transaction that got there, and a join in
    // the same block still has the whole budget.
    function it_never_holds_a_leave_back_for_the_mutation_budget() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        _activate(address(validatorC));
        fastForward(1, 1);
        staking.setSetParams(50, 50, 500, 1, 100, 100, 0);

        // A and C (1000 each) both fall under the new minStake; one mutation is allowed
        staking.setValidatorParams(1500e18, 5000, 3, 100);
        require(gov.validatorCount() == 1 && gov.isValidator(VALIDATOR_B), "both left in this block");
        require(staking.validatorCount() == 1, "and staking agrees");

        // the block's one mutation is still there for a join
        _registerSelf(attacker);
        _selfBond(attacker, address(attacker), 1500e18);
        attacker.doSuccessfully(address(staking), "tryActivate(address)", address(attacker));
        require(gov.isValidator(address(attacker)), "a leave does not spend the budget a join needs");
    }

    function it_gives_notice_before_a_commission_raise() public {
        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(300));
        require(_commissionOf(VALIDATOR_A) == 300, "a cut applies at once");

        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(900));
        require(_commissionOf(VALIDATOR_A) == 300, "a raise is only announced");
        require(staking.announcedCommissionBps(VALIDATOR_A) == 900, "announced");
        operatorA.doExpectingFailure(address(staking), "setCommissionBps(address,uint256)", "SS: commission notice running", VALIDATOR_A, uint256(900));

        fastForward(101, 1);
        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(900));
        require(_commissionOf(VALIDATOR_A) == 900, "applied after the notice");

        operatorA.doSuccessfully(address(staking), "setCommissionBps(address,uint256)", VALIDATOR_A, uint256(1000));
        require(_commissionOf(VALIDATOR_A) == 900, "each raise needs its own notice");
        staking.setValidatorCommissionBps(VALIDATOR_A, 1000);
        require(_commissionOf(VALIDATOR_A) == 1000, "the owner sets it directly");
    }

    // Moving is instant; without a lock a delegator could follow each block's proposer.
    function it_locks_moved_stake_from_moving_on() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 100e18);
        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_A, VALIDATOR_B, 100e18);
        user1.doExpectingFailure(address(staking), "moveStake(address,address,uint256)", "SS: stake recently moved", VALIDATOR_B, VALIDATOR_A, 100e18);
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_B, 10e18);

        fastForward(101, 1);
        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_B, VALIDATOR_A, 90e18);
        require(staking.delegatedStake(address(user1), VALIDATOR_A) == 90e18, "moved after the lock");

        registry.removeValidator(VALIDATOR_A);
        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_A, VALIDATOR_B, 90e18);
        require(staking.delegatedStake(address(user1), VALIDATOR_B) == 90e18, "stake leaves a delisted validator at once");
    }

    // ---- liveness ----------------------------------------------------------------------

    function it_counts_proposals_and_misses_once_per_block() public {
        _bondBoth();

        // previous block: A was intended, B proposed (a round change happened)
        setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
        staking.processBlock();
        require(staking.blocksProposed(VALIDATOR_B) == 1, "fill-in proposer credited");
        require(staking.missedProposals(VALIDATOR_A) == 1, "intended proposer missed");
        require(staking.consecutiveMisses(VALIDATOR_A) == 1, "consecutive miss");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "no tokens move on a miss");
        require(gov.isValidator(VALIDATOR_A), "still a validator");

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

    // Jailing is disabled: maxConsecutiveMisses is 3 here, and missing more than that
    // neither takes the validator out of the set nor opens a jail window.
    function it_never_jails_however_many_proposals_are_missed() public {
        _bondBoth();
        for (uint256 i = 0; i < 5; i++) {
            setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
            staking.processBlock();
            fastForward(1, 1);
        }
        require(staking.missedProposals(VALIDATOR_A) == 5, "misses counted");
        require(staking.consecutiveMisses(VALIDATOR_A) == 5, "streak kept");
        require(staking.jailedUntil(VALIDATOR_A) == 0, "no jail window");
        require(staking.eligible(VALIDATOR_A), "still eligible");
        require(staking.isValidator(VALIDATOR_A), "still seated");
        require(gov.isValidator(VALIDATOR_A), "still in the consensus set");
        require(gov.validatorCount() == 2, "set unchanged");
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

    // ---- a seat and its bond -----------------------------------------------------------

    function _firstRequest() internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = 0;
    }

    // A fresh key lists itself, bonds the minimum and takes a seat by right.
    function _joinByRight(User key) internal {
        _mintAndApprove(key, 10000e18);
        _registerSelf(key);
        _selfBond(key, address(key), 1000e18);
        key.doSuccessfully(address(staking), "tryActivate(address)", address(key));
    }

    // Four joins use the block's four set changes; a fifth validator then takes its whole
    // bond out in the same block. It leaves with the bond: nothing is left to a later sync
    // that nobody is bound to make.
    function it_gives_up_the_seat_with_the_bond_when_the_mutation_budget_is_spent() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        _activate(address(validatorC));
        _stake(user1, address(validatorC), 400e18);
        fastForward(1, 1);
        staking.setSetParams(50, 50, 500, 4, 100, 100, 0);

        _joinByRight(new User());
        _joinByRight(new User());
        _joinByRight(new User());
        _joinByRight(new User());
        User fifth = new User();
        _mintAndApprove(fifth, 10000e18);
        _registerSelf(fifth);
        _selfBond(fifth, address(fifth), 1000e18);
        fifth.doExpectingFailure(address(staking), "tryActivate(address)", "SS: mutation cap", address(fifth));

        validatorC.doSuccessfully(address(staking), "unbondSelf(address,uint256)", address(validatorC), uint256(1000e18));
        require(!gov.isValidator(address(validatorC)) && !staking.isValidator(address(validatorC)), "the seat went with the bond");
        require(gov.validatorStake(address(validatorC)) == 0, "no weight left behind for the delegations to vote through");

        fastForward(101, 5);
        validatorC.doSuccessfully(address(staking), "withdrawUnbonded", _firstRequest());
        require(strato.balanceOf(address(validatorC)) == 10000e18, "principal returned in full");
    }

    // With the governance link off no seat can be given up, so the operator's bond stays
    // in until the link is back. A delegator is never held back.
    function it_keeps_a_seated_bond_in_while_the_governance_link_is_off() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 400e18);
        staking.setGovernance(address(gov), false);

        operatorA.doExpectingFailure(address(staking), "unbondSelf(address,uint256)", "SS: cannot leave the set", VALIDATOR_A, 1000e18);
        require(_selfBondOf(VALIDATOR_A) == 1000e18 && gov.isValidator(VALIDATOR_A), "bond and seat unchanged");
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 400e18);

        staking.setGovernance(address(gov), true);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(!gov.isValidator(VALIDATOR_A), "with the link back the seat leaves with the bond");
    }

    // A seat the admins pinned is held by their vote, not by its bond, so its operator's
    // bond is as free to leave with the link off as with it on.
    function it_lets_a_pinned_seats_bond_out_while_the_governance_link_is_off() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToAddValidator(VALIDATOR_A);
        staking.setGovernance(address(pins), false);

        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(_selfBondOf(VALIDATOR_A) == 0 && pins.isValidator(VALIDATOR_A), "the bond is out and the pin keeps the seat");
        operatorB.doExpectingFailure(address(staking), "unbondSelf(address,uint256)", "SS: cannot leave the set", VALIDATOR_B, 2000e18);
    }

    // A handover releases the outgoing operator's bond, so it follows the same rule: a
    // pinned seat changes hands with the link on or off, an unpinned one only where it
    // can leave.
    function it_hands_over_a_pinned_seat_with_the_governance_link_on_or_off() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToAddValidator(VALIDATOR_A);

        registry.adminSetOperator(VALIDATOR_A, address(user1));
        require(staking.operatorOf(VALIDATOR_A) == address(user1) && _selfBondOf(VALIDATOR_A) == 0, "handed over with the link on, the bond released");
        require(pins.isValidator(VALIDATOR_A) && staking.isValidator(VALIDATOR_A), "the pin keeps the seat");

        staking.setGovernance(address(pins), false);
        registry.adminSetOperator(VALIDATOR_A, address(user2));
        require(staking.operatorOf(VALIDATOR_A) == address(user2) && pins.isValidator(VALIDATOR_A), "and with the link off");

        bool refused = false;
        try registry.adminSetOperator(VALIDATOR_B, address(user1)) {
        } catch {
            refused = true;
        }
        require(refused, "an unpinned seat cannot leave with the link off, so its handover is refused");
        require(staking.operatorOf(VALIDATOR_B) == address(operatorB) && _selfBondOf(VALIDATOR_B) == 2000e18, "operator and bond unchanged");
    }

    // No governance set is not a pin: the bond stays under the seat, as with any link
    // that is off.
    function it_keeps_a_seated_bond_in_while_no_governance_is_set() public {
        _bondBoth();
        staking.setGovernance(address(0), false);
        operatorA.doExpectingFailure(address(staking), "unbondSelf(address,uint256)", "SS: cannot leave the set", VALIDATOR_A, 1000e18);
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "bond unchanged");
    }

    // ---- the door check ----------------------------------------------------------------

    // Governance as a network has it before staking has seated anyone: validators listed by
    // genesis or admin vote, with no weight on record. A newcomer seated beside them would
    // publish the only weight in the set and hold the whole stake-weighted vote.
    function it_seats_no_newcomer_beside_a_validator_without_a_weight() public {
        GenesisGovernance pins = _pinningGovernance();
        pins.seedValidator(VALIDATOR_A);
        pins.seedValidator(VALIDATOR_B);

        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: validator without weight", address(validatorC));
        require(!pins.isValidator(address(validatorC)) && pins.validatorStake(address(validatorC)) == 0, "not seated, nothing published");

        // The admins pin the two in; the stake delegated to each then becomes its weight.
        pins.voteToAddValidator(VALIDATOR_A);
        _stake(user1, VALIDATOR_A, 5000e18);
        require(pins.validatorStake(VALIDATOR_A) == 5000e18 && pins.validatorStake(VALIDATOR_B) == 0, "one of the two has its stake on record");
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: validator without weight", address(validatorC));
        pins.voteToAddValidator(VALIDATOR_B);
        _stake(user2, VALIDATOR_B, 5000e18);
        require(pins.validatorStake(VALIDATOR_A) == 5000e18 && pins.validatorStake(VALIDATOR_B) == 5000e18, "every member has its stake on record");

        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(pins.isValidator(address(validatorC)) && pins.validatorStake(address(validatorC)) == 1000e18, "the newcomer joins with 1000 of 11000");
    }

    // A pinned seat stays whatever its stake, so one whose stake has run out holds a weight of
    // zero for as long as the pin lasts. It does not keep newcomers out meanwhile.
    function it_seats_a_newcomer_beside_a_pinned_seat_without_stake() public {
        GenesisGovernance pins = _pinningGovernance();
        _bondBoth();
        pins.voteToAddValidator(VALIDATOR_A);
        operatorA.doSuccessfully(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 1000e18);
        require(pins.isValidator(VALIDATOR_A) && pins.validatorStake(VALIDATOR_A) == 0, "pinned, with no weight");

        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(pins.isValidator(address(validatorC)) && pins.validatorStake(address(validatorC)) == 1000e18, "the newcomer joins");
    }

    // ---- pay follows the seat ----------------------------------------------------------

    // A seat the admins pinned holds no bond of its operator's own. It is paid for the
    // blocks it produces like any other seat, and its delegators take their share.
    function it_pays_a_pinned_seat_that_holds_no_bond() public {
        GenesisGovernance pins = _pinningGovernance();
        _stake(user1, VALIDATOR_A, 4000e18);
        pins.voteToAddValidator(VALIDATOR_A);
        staking.syncValidator(VALIDATOR_A);
        require(staking.isValidator(VALIDATOR_A) && !staking.eligible(VALIDATOR_A), "seated by the pin, not by a bond");

        _fundReserve(10000e18);
        staking.commitEmissionSchedule(31536e18, 3000e18, 10000e18, 0);
        _processBlockAfter(1, VALIDATOR_A);
        _processBlockAfter(60, VALIDATOR_A);
        _processBlockAfter(60, VALIDATOR_A);
        uint256 paid = staking.totalEmitted();
        require(paid > 0, "the pinned seat is paid for its blocks");

        uint256 before = strato.balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) > before, "and its delegator takes a share");
    }

    // ---- the stake delay ---------------------------------------------------------------

    // New stake earns from the moment it arrives but joins the validator's vote only after
    // the wait: with a delay of 100 seconds, from the start of the window after next.
    function it_counts_new_stake_toward_the_vote_only_after_the_delay() public {
        _bondBoth();
        staking.setStakeDelay(100);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "stake held before the delay was set counts");

        _stake(user1, VALIDATOR_A, 400e18);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "a new delegation does not move the weight");
        require(staking.unmaturedStake(VALIDATOR_A) == 400e18 && staking.votingWeight(VALIDATOR_A) == 1000e18, "it is waiting");

        fastForward(100, 1);
        staking.syncValidator(VALIDATOR_A);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "still waiting one window later");

        fastForward(100, 1);
        require(staking.votingWeight(VALIDATOR_A) == 1400e18 && staking.unmaturedStake(VALIDATOR_A) == 0, "its wait is over");
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "published at the validator's next sync");
        attacker.do(address(staking), "syncValidator(address)", VALIDATOR_A);
        require(gov.validatorStake(VALIDATOR_A) == 1400e18, "which anyone may make");
    }

    // Stake that leaves takes the leaver's waiting stake first, so taking back a stake that
    // never counted takes nothing from the vote, and a stake that did count leaves at once.
    function it_takes_the_leavers_waiting_stake_first() public {
        _bondBoth();
        _stake(user2, VALIDATOR_A, 300e18);
        staking.setStakeDelay(100);
        require(gov.validatorStake(VALIDATOR_A) == 1300e18, "user2's stake counts");

        _stake(user1, VALIDATOR_A, 400e18);
        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 150e18);
        require(staking.unmaturedStake(VALIDATOR_A) == 250e18 && gov.validatorStake(VALIDATOR_A) == 1300e18, "user1 took back part of what was waiting");

        user2.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 300e18);
        require(staking.unmaturedStake(VALIDATOR_A) == 250e18 && gov.validatorStake(VALIDATOR_A) == 1000e18, "user2's counted stake left the vote at once");

        user1.doSuccessfully(address(staking), "unstake(address,uint256)", VALIDATOR_A, 250e18);
        require(staking.unmaturedStake(VALIDATOR_A) == 0 && gov.validatorStake(VALIDATOR_A) == 1000e18, "nothing waiting, the vote untouched");
    }

    // The delay covers a new seat: a seat by right is taken with a bond that has already
    // waited, or a join would go around the delay.
    function it_seats_a_newcomer_only_once_its_bond_has_waited() public {
        _bondBoth();
        staking.setStakeDelay(100);
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 1000e18);
        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: bond not matured", address(validatorC));
        require(!staking.isWaiter(address(validatorC)), "not promoted by reconcileSet either");

        fastForward(200, 1);
        require(staking.isWaiter(address(validatorC)), "a waiter once the bond has waited");
        validatorC.doSuccessfully(address(staking), "tryActivate(address)", address(validatorC));
        require(gov.isValidator(address(validatorC)) && gov.validatorStake(address(validatorC)) == 1000e18, "seated with its whole bond as its weight");
    }

    // Moved stake leaves the old validator's vote at once and waits where it lands.
    function it_makes_moved_stake_wait_where_it_lands() public {
        _bondBoth();
        _stake(user1, VALIDATOR_A, 400e18);
        staking.setStakeDelay(100);
        require(gov.validatorStake(VALIDATOR_A) == 1400e18, "counted before the delay was set");

        user1.doSuccessfully(address(staking), "moveStake(address,address,uint256)", VALIDATOR_A, VALIDATOR_B, 400e18);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "it leaves A's vote at once");
        require(gov.validatorStake(VALIDATOR_B) == 2000e18 && staking.unmaturedStake(VALIDATOR_B) == 400e18, "and waits behind B");

        fastForward(200, 1);
        staking.syncValidator(VALIDATOR_B);
        require(gov.validatorStake(VALIDATOR_B) == 2400e18, "then counts");
    }

    // Changing the delay starts a new generation of windows: what was waiting under the
    // earlier setting counts at once, and with the delay off stake counts as it arrives.
    function it_counts_waiting_stake_at_once_when_the_delay_changes() public {
        _bondBoth();
        staking.setStakeDelay(100);
        _stake(user1, VALIDATOR_A, 400e18);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "waiting");

        staking.setStakeDelay(50);
        require(gov.validatorStake(VALIDATOR_A) == 1400e18 && staking.unmaturedStake(VALIDATOR_A) == 0, "counted when the delay changed");
        _stake(user2, VALIDATOR_A, 100e18);
        require(gov.validatorStake(VALIDATOR_A) == 1400e18, "new stake waits under the new setting");

        staking.setStakeDelay(0);
        require(gov.validatorStake(VALIDATOR_A) == 1500e18, "off: everything counts");
        _stake(user2, VALIDATOR_A, 100e18);
        require(gov.validatorStake(VALIDATOR_A) == 1600e18, "and new stake counts as it arrives");
    }

    // The one-third alert follows the weights governance holds, the ones consensus counts.
    // Stake whose wait is over is not among them until its validator is synced.
    function it_measures_one_third_on_the_weights_governance_holds() public {
        _bondBoth();
        _registerSelf(validatorC);
        _selfBond(validatorC, address(validatorC), 2000e18);
        _activate(address(validatorC));
        _stake(user1, VALIDATOR_A, 1500e18);
        staking.setStakeDelay(100);
        require(staking.exceedsOneThird(VALIDATOR_A) && !staking.exceedsOneThird(VALIDATOR_B), "A holds 2500 of 6500");

        _stake(user2, VALIDATOR_B, 4000e18);
        fastForward(200, 1);
        require(staking.votingWeight(VALIDATOR_B) == 6000e18 && gov.validatorStake(VALIDATOR_B) == 2000e18, "B's new stake has waited and is not published");
        require(staking.exceedsOneThird(VALIDATOR_A) && !staking.exceedsOneThird(VALIDATOR_B), "consensus still counts 2500 of 6500 for A");

        staking.syncValidator(VALIDATOR_B);
        require(!staking.exceedsOneThird(VALIDATOR_A) && staking.exceedsOneThird(VALIDATOR_B), "once published, B holds 6000 of 10500");
    }

    // Stake that is waiting still earns: the delay is on the vote, not on income.
    function it_pays_waiting_stake_its_share_of_income() public {
        _bondBoth();
        staking.setStakeDelay(100);
        _stake(user1, VALIDATOR_A, 1000e18);
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "waiting");
        _reward(VALIDATOR_A, 100e18);
        uint256 before = strato.balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _list(VALIDATOR_A));
        require(strato.balanceOf(address(user1)) > before, "a delegator whose stake is waiting is paid");
    }

    // ---- re-filing an operator's delegations onto its validators -----------------------

    address constant NODE_1 = address(0xc1c1);
    address constant NODE_2 = address(0xc2c2);

    function _two(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    // An operator's record from before the switch to validator-keyed records: keyed by the
    // operator's own address, which is not a consensus validator, with two delegators behind
    // it. The operator's two validators are listed beside it and have nothing.
    function _operatorKeyedRecord() internal {
        _registerSelf(validatorC);
        staking.forgetOperatorField(address(validatorC));
        _stake(user1, address(validatorC), 401e18 + 1);
        _stake(user2, address(validatorC), 300e18);
        registry.addValidator(NODE_1, address(validatorC), 0, "Node 1", "", "", "node-1");
        registry.addValidator(NODE_2, address(validatorC), 0, "Node 2", "", "", "node-2");
    }

    function _refileFailure(address fromRecord, address[] memory toValidators, address[] memory delegators) internal returns (string) {
        string reason = "";
        try staking.refileStake(fromRecord, toValidators, delegators) {
        } catch Error(string e) {
            reason = e;
        }
        return reason;
    }

    function it_refiles_an_operators_delegations_onto_its_validators() public {
        _operatorKeyedRecord();
        _reward(address(validatorC), 70e18);
        staking.setStakeDelay(100);
        uint256 userStake = staking.totalUserStake();
        uint256 rewardable = staking.totalRewardableStake();

        staking.refileStake(address(validatorC), _two(NODE_1, NODE_2), _two(address(user1), address(user2)));

        require(staking.delegatedStake(address(user1), address(validatorC)) == 0 && staking.delegatedStake(address(user2), address(validatorC)) == 0, "nothing left behind the old record");
        require(staking.delegatedStake(address(user1), NODE_1) == 2005e17 + 1 && staking.delegatedStake(address(user1), NODE_2) == 2005e17, "an equal share each, the first takes the odd wei");
        require(staking.delegatedStake(address(user2), NODE_1) == 150e18 && staking.delegatedStake(address(user2), NODE_2) == 150e18, "the second delegator likewise");
        require(staking.totalUserStake() == userStake && staking.totalRewardableStake() == rewardable, "no stake created or lost");
        require(staking.unmaturedStake(NODE_1) == 0 && staking.votingWeight(NODE_1) == 3505e17 + 1, "a re-filing is not new stake: it counts at once");

        // what a delegator earned behind the old record is still claimable there
        uint256 before = strato.balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _list(address(validatorC)));
        require(strato.balanceOf(address(user1)) > before, "rewards earned behind the old record are paid");

        // and it keeps earning behind the new ones
        _reward(NODE_1, 70e18);
        before = strato.balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _list(NODE_1));
        require(strato.balanceOf(address(user1)) > before, "the re-filed stake earns");

        // a batch sent again moves nothing
        staking.refileStake(address(validatorC), _two(NODE_1, NODE_2), _two(address(user1), address(user2)));
        require(staking.delegatedStake(address(user1), NODE_1) == 2005e17 + 1 && staking.delegatedStake(address(user2), NODE_2) == 150e18, "unchanged by the repeat");
    }

    // Stake moves only between records of one operator, and only the owner moves it.
    function it_refiles_only_within_one_operator_and_only_for_the_owner() public {
        _bondBoth();
        _operatorKeyedRecord();
        require(_refileFailure(address(validatorC), _two(NODE_1, VALIDATOR_A), _list(address(user1))) == "SS: another operator's validator", "a delegator is not put behind an operator it did not choose");
        require(_refileFailure(address(validatorC), _two(NODE_1, NODE_1), _list(address(user1))) == "SS: duplicate validator", "each validator once");
        require(_refileFailure(address(validatorC), _two(NODE_1, address(validatorC)), _list(address(user1))) == "SS: same validator", "not onto itself");
        bool refused = false;
        try attacker.do(address(staking), "refileStake", address(validatorC), _two(NODE_1, NODE_2), _list(address(user1))) {
        } catch {
            refused = true;
        }
        require(refused, "only the owner re-files");
        require(staking.delegatedStake(address(user1), address(validatorC)) == 401e18 + 1, "nothing moved");
    }

    // The incumbents are in the consensus set with nothing on record. Pinned, they take the
    // re-filed stake as their weight. Unpinned, the first sync would adopt them and drop
    // them for having no bond, so the re-filing is refused until they are pinned.
    function it_gives_refiled_stake_to_pinned_incumbents_as_their_weight() public {
        GenesisGovernance pins = _pinningGovernance();
        pins.seedValidator(NODE_1);
        pins.seedValidator(NODE_2);
        _operatorKeyedRecord();

        require(_refileFailure(address(validatorC), _two(NODE_1, NODE_2), _two(address(user1), address(user2))) == "SS: pin the validator first", "refused while an incumbent is unpinned");
        require(pins.isValidator(NODE_1) && pins.isValidator(NODE_2), "both still in the consensus set");

        pins.voteToAddValidator(NODE_1);
        pins.voteToAddValidator(NODE_2);
        staking.refileStake(address(validatorC), _two(NODE_1, NODE_2), _two(address(user1), address(user2)));
        require(pins.isValidator(NODE_1) && pins.isValidator(NODE_2) && staking.isValidator(NODE_1) && staking.isValidator(NODE_2), "seated in staking too");
        require(pins.validatorStake(NODE_1) == 3505e17 + 1 && pins.validatorStake(NODE_2) == 3505e17, "each votes with the stake filed behind it");
    }
}
