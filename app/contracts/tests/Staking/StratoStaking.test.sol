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
// that predates its index, and the retired reward schedule's leftovers.
contract UpgradedInPlaceStaking is StratoStaking {
    constructor(address initialOwner) StratoStaking(initialOwner) { }

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

contract Describe_StratoStaking {
    uint256 public INFINITY = 2 ** 256 - 1;
    address constant VALIDATOR_A = address(0xaaaa);
    address constant VALIDATOR_B = address(0xbbbb);

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

        registry = new ValidatorRegistry(address(this));
        registry.initialize(address(staking));
        staking.setValidatorRegistry(address(registry));

        gov = new MercataGovernance(address(this));
        gov.setStakingContract(address(staking));
        staking.setGovernance(address(gov), true);
        // minStake 1000 of self-bond, 50% proposer fee share, jail after 3 consecutive misses for 100s
        staking.setValidatorParams(1000e18, 5000, 3, 100);
        // set of 50, generous mutation budget, 100s exit notice / unkick cooldown, no stake cap, joins paused
        staking.setSetParams(50, 50, 500, 10, 100, 100, 0, true);

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
        funder.doSuccessfully(address(staking), "creditBlockReward(address,uint256)", validator, amount);
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

    // Helium's validators were admitted on delegated stake. An upgraded proxy has no
    // deadline written, keeps that rule, and only leaves it when the admins pick a deadline.
    function it_phases_in_the_self_bond_rule_after_the_grace_deadline() public {
        staking.forgetSelfBondGrace();
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _activate(VALIDATOR_A);
        _stake(user1, VALIDATOR_B, 1000e18);
        require(staking.eligible(VALIDATOR_B), "no deadline set: delegated stake still qualifies");
        _activate(VALIDATOR_B);

        staking.setSelfBondGraceUntil(block.timestamp + 100);
        require(gov.isValidator(VALIDATOR_B), "setting a future deadline removes nobody");

        fastForward(101, 1);
        require(!staking.eligible(VALIDATOR_B), "deadline passed: self-bond rule");
        staking.syncValidator(VALIDATOR_B);
        require(!gov.isValidator(VALIDATOR_B), "left the set on the next sync");
        require(gov.isValidator(VALIDATOR_A), "a self-bonded validator is unaffected");
    }

    // The pre-upgrade contract maintained lastSyncedWeight without ever calling
    // governance, so the cache reported "already synced" while governance held
    // nothing. Pointing at a fresh governance reproduces that shape.
    function it_republishes_stakes_to_a_governance_that_knows_nothing() public {
        _bondBoth();
        uint256 weightA = gov.validatorStake(VALIDATOR_A);
        uint256 weightB = gov.validatorStake(VALIDATOR_B);
        require(weightA == 1000e18 && weightB == 2000e18, "published to the original governance");

        MercataGovernance fresh = new MercataGovernance(address(this));
        fresh.setStakingContract(address(staking));
        require(fresh.validatorStake(VALIDATOR_A) == 0, "fresh governance knows nothing");
        require(staking.lastSyncedWeight(VALIDATOR_A) == weightA, "local cache still claims synced");

        staking.setGovernance(address(fresh), true);

        require(fresh.validatorStake(VALIDATOR_A) == weightA, "republished despite the cache");
        require(fresh.validatorStake(VALIDATOR_B) == weightB, "both validators republished");
        require(fresh.isValidator(VALIDATOR_A), "membership reconciled too");
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
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "re-added on request");

        registry.removeValidator(VALIDATOR_A);
        require(!gov.isValidator(VALIDATOR_A), "removed with the listing");
        require(staking.status(VALIDATOR_A) == 3, "Kicked");
    }

    function it_never_removes_the_last_validator() public {
        _selfBond(operatorA, VALIDATOR_A, 1000e18);
        _activate(VALIDATOR_A);
        operatorA.do(address(staking), "unbondSelf(address,uint256)", VALIDATOR_A, 500e18);
        require(gov.isValidator(VALIDATOR_A), "governance keeps its last validator");
        require(staking.isValidator(VALIDATOR_A), "still tracked until it can be removed");
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
        require(staking.totalRewardsCredited() == 100e18, "counted");
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

    function it_only_credits_what_it_is_paid_and_only_to_listed_validators() public {
        uint256 held = strato.balanceOf(address(staking));
        funder.doExpectingFailure(address(staking), "creditBlockReward(address,uint256)", "SS: validator not listed", address(0xdead), 1e18);
        require(strato.balanceOf(address(staking)) == held, "nothing pulled for an unlisted proposer");

        User broke = new User();
        bool rejected = false;
        try broke.do(address(staking), "creditBlockReward(address,uint256)", VALIDATOR_A, 1e18) {
        } catch {
            rejected = true;
        }
        require(rejected, "a credit must be paid for");
        require(_pendingOperatorRewards(VALIDATOR_A) == 0, "nothing credited");
    }

    // The funded reward schedule is gone: no way in, and a listed validator with no stake
    // that proposes nothing earns nothing.
    function it_has_no_funded_reward_schedule() public {
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

    function it_register_needs_the_key_but_activation_is_gated() public {
        _registerSelf(validatorC);
        require(staking.status(address(validatorC)) == 1, "Registered");
        require(staking.operatorOf(address(validatorC)) == address(validatorC), "self-operated");
        require(!staking.eligible(address(validatorC)), "no stake yet");

        _selfBond(validatorC, address(validatorC), 1000e18);
        require(staking.isWaiter(address(validatorC)), "waiter");

        validatorC.doExpectingFailure(address(staking), "tryActivate(address)", "SS: joins paused", address(validatorC));
        staking.tryActivate(address(validatorC));
        require(staking.status(address(validatorC)) == 2, "owner may activate while paused");
    }

    function it_fills_the_set_then_evicts_the_lowest_with_margin() public {
        staking.setSetParams(2, 50, 500, 10, 100, 100, 0, false);
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
        try staking.setSetParams(3, 51, 500, 10, 100, 100, 0, false) {
        } catch {
            rejected = true;
        }
        require(rejected, "hard cap only lowers");
    }

    function it_reconciles_named_waiters_by_stake_within_the_mutation_budget() public {
        staking.setSetParams(3, 50, 500, 2, 100, 100, 0, false);
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
        staking.setSetParams(50, 50, 500, 1, 100, 100, 0, true);
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
        require(staking.exitReadyTime(VALIDATOR_A) == 0, "exit cleared");
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
        // the cap is switched on once the set is bootstrapped (a lone first staker is always 100%)
        staking.setSetParams(50, 50, 500, 10, 100, 100, 3300, true);

        _stake(user1, VALIDATOR_A, 1500e18); // 2500 / 9500 = 26%
        _stake(user1, VALIDATOR_B, 1000e18); // 2000 / 10500 = 19%
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: above operator stake cap", VALIDATOR_A, 1500e18);
        user1.doExpectingFailure(address(staking), "moveStake(address,address,uint256)", "SS: above operator stake cap", VALIDATOR_B, VALIDATOR_A, 1000e18);
        operatorA.doExpectingFailure(address(staking), "selfBond(address,uint256)", "SS: above operator stake cap", VALIDATOR_A, 2000e18);
        user1.do(address(staking), "unstake(address,uint256)", VALIDATOR_A, 500e18);
        require(staking.delegatedStake(address(user1), VALIDATOR_A) == 1000e18, "unstaking is never capped");
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

    function it_jails_after_max_consecutive_misses_and_releases_after_cooldown() public {
        _bondBoth();
        for (uint256 i = 0; i < 3; i++) {
            setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
            staking.processBlock();
            fastForward(1, 1);
        }
        require(!gov.isValidator(VALIDATOR_A), "jailed after 3 consecutive misses");
        require(staking.jailedUntil(VALIDATOR_A) > block.timestamp, "jail window set");
        require(staking.consecutiveMisses(VALIDATOR_A) == 0, "streak reset on jail");
        require(_selfBondOf(VALIDATOR_A) == 1000e18, "stake untouched by jail");

        _selfBond(operatorA, VALIDATOR_A, 1e18);
        bool rejected = false;
        try staking.tryActivate(VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected, "cannot re-activate while jailed");

        fastForward(101, 1);
        _activate(VALIDATOR_A);
        require(gov.isValidator(VALIDATOR_A), "re-activated after the cooldown");
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

    function it_process_block_never_reverts_when_governance_rejects() public {
        _bondBoth();
        gov.setStakingContract(address(0));
        for (uint256 i = 0; i < 3; i++) {
            setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
            staking.processBlock();
            fastForward(1, 1);
        }
        require(staking.jailedUntil(VALIDATOR_A) > block.timestamp, "jail recorded despite governance rejecting the removal");
        require(staking.isValidator(VALIDATOR_A), "registration left as is");
    }

    function it_process_block_is_a_noop_before_initialization() public {
        StratoStaking fresh = new StratoStaking(address(this));
        fresh.processBlock();
        require(fresh.lastProcessedBlock() == 0, "nothing processed");
    }
}
