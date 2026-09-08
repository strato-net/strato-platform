import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../Util.sol";

// MercataGovernance seeds its admin list at genesis, which a unit test cannot
// do. This exposes the seeding, and the internal tally, so the admin-override
// paths can be driven -- with more than one admin where the tally is the point.
contract record AdminSeededGovernance is MercataGovernance {
    constructor(address _initialOwner) MercataGovernance(_initialOwner) { }

    function seedAdmin(address a) public {
        require(adminMap[a] == 0, "already an admin");
        admins.push(a);
        adminMap[a] = admins.length;
    }

    function voteAs(address who, address validator, uint direction) public {
        voteForValidator(who, validator, direction);
    }
}

// Staking-driven validator management on the governance contract, and the admin
// override of it.
contract Describe_MercataGovernance {
    MercataGovernance gov;
    AdminSeededGovernance g;
    User staking;
    User stranger;

    address v1 = address(0x1111);
    address v2 = address(0x2222);
    address v3 = address(0x3333);

    address a1 = address(0xAAA1);
    address a2 = address(0xAAA2);
    address a3 = address(0xAAA3);

    uint VOTE_IN = 1;
    uint VOTE_OUT = 2;
    uint VOTE_CLEAR = 3;

    function beforeAll() public {
        staking = new User();
        stranger = new User();
    }

    function beforeEach() public {
        gov = new MercataGovernance(address(this));
        gov.setStakingContract(address(staking));
        g = new AdminSeededGovernance(address(this));
        g.setStakingContract(address(staking));
    }

    // The override tests drive g, whose owner is this contract, so an onlyOwner
    // vote from here passes the ownership check outright. Seeding this contract
    // as the only admin puts the threshold at one, so each vote decides.
    function _soleAdmin() internal {
        g.seedAdmin(address(this));
    }

    function _gadd(address validator, uint256 stake) internal {
        staking.doSuccessfully(address(g), "addValidatorFromStaking(address,uint256)", validator, stake);
    }

    function _gremove(address validator) internal returns (bool) {
        return staking.doSuccessfully(address(g), "removeValidatorFromStaking(address)", validator);
    }

    function _add(User who, address validator, uint256 stake) internal {
        who.doSuccessfully(address(gov), "addValidatorFromStaking(address,uint256)", validator, stake);
    }

    function it_rejects_staking_entrypoints_from_others() public {
        stranger.doExpectingFailure(address(gov), "addValidatorFromStaking(address,uint256)", "Only the staking contract can manage staked validators", v1, uint256(1));
        stranger.doExpectingFailure(address(gov), "updateValidatorStake(address,uint256)", "Only the staking contract can manage staked validators", v1, uint256(1));
        stranger.doExpectingFailure(address(gov), "removeValidatorFromStaking(address)", "Only the staking contract can manage staked validators", v1);
    }

    function it_rejects_staking_entrypoints_when_unset() public {
        gov.setStakingContract(address(0));
        staking.doExpectingFailure(address(gov), "addValidatorFromStaking(address,uint256)", "Only the staking contract can manage staked validators", v1, uint256(1));
    }

    function it_adds_from_staking_idempotently_and_tracks_stake() public {
        _add(staking, v1, 100);
        require(gov.validatorCount() == 1, "one validator");
        require(gov.validatorMap(v1) == 1, "indexed");
        require(gov.isValidator(v1), "is validator");
        require(gov.validatorStake(v1) == 100, "stake recorded");
        require(gov.stakingManaged(v1), "managed");

        _add(staking, v1, 250);
        require(gov.validatorCount() == 1, "still one validator");
        require(gov.validatorStake(v1) == 250, "stake updated");
    }

    function it_updates_stake_only_for_validators() public {
        staking.doExpectingFailure(address(gov), "updateValidatorStake(address,uint256)", "Stake can only be updated for current validators", v1, uint256(5));
        _add(staking, v1, 100);
        staking.doSuccessfully(address(gov), "updateValidatorStake(address,uint256)", v1, uint256(5));
        require(gov.validatorStake(v1) == 5, "stake updated");
    }

    function it_removes_managed_validators_but_never_the_last_one() public {
        _add(staking, v1, 1);
        _add(staking, v2, 2);
        _add(staking, v3, 3);

        bool removed = staking.doSuccessfully(address(gov), "removeValidatorFromStaking(address)", v1);
        require(removed, "removed v1");
        require(gov.validatorCount() == 2, "two left");
        require(gov.validatorMap(v1) == 0, "v1 gone");
        require(gov.validators(0) == v3, "last swapped into slot 0");
        require(gov.validatorMap(v3) == 1, "swap reindexed");
        require(gov.validatorStake(v1) == 0, "stake cleared");
        require(!gov.stakingManaged(v1), "no longer managed");

        removed = staking.doSuccessfully(address(gov), "removeValidatorFromStaking(address)", v3);
        require(removed, "removed the last element");
        require(gov.validatorCount() == 1, "one left");
        require(gov.validators(0) == v2, "v2 remains");

        removed = staking.doSuccessfully(address(gov), "removeValidatorFromStaking(address)", v2);
        require(!removed, "the last validator is never removed");
        require(gov.validatorCount() == 1, "still one");

        removed = staking.doSuccessfully(address(gov), "removeValidatorFromStaking(address)", v1);
        require(!removed, "unknown validators are ignored");
    }

    function it_keeps_state_across_a_logic_upgrade_behind_a_proxy() public {
        MercataGovernance proxied = MercataGovernance(address(new Proxy(address(gov), address(this))));
        proxied.setStakingContract(address(staking));
        staking.doSuccessfully(address(proxied), "addValidatorFromStaking(address,uint256)", v1, uint256(9));

        Proxy(address(proxied)).setLogicContract(address(new MercataGovernance(address(this))));

        require(proxied.validatorCount() == 1, "validators survive the upgrade");
        require(proxied.validatorStake(v1) == 9, "stake survives the upgrade");
        require(proxied.stakingContract() == address(staking), "staking contract survives the upgrade");
    }

    function it_enforces_the_hard_cap_on_both_paths() public {
        _add(staking, v1, 1);
        bool rejected = false;
        try gov.setHardCapValidators(0) {
        } catch {
            rejected = true;
        }
        require(!rejected, "zero disables the cap");
        gov.setHardCapValidators(2);
        _add(staking, v2, 2);
        staking.doExpectingFailure(address(gov), "addValidatorFromStaking(address,uint256)", "Validator set is at its hard cap", v3, uint256(3));
        require(gov.validatorCount() == 2, "capped");
        rejected = false;
        try gov.setHardCapValidators(1) {
        } catch {
            rejected = true;
        }
        require(rejected, "cap cannot drop below the current count");
    }

    // --- admin override of stake-weighted selection ---

    function it_keeps_a_pinned_validator_when_staking_drops_it() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteToAddValidator(v1);
        require(g.forcedInByAdmins(v1), "pinned in");
        require(!g.forcedOutByAdmins(v1), "and not out");

        bool removed = _gremove(v1);
        require(!removed, "staking is told the removal did not happen");
        require(g.isValidator(v1), "still seated");
        require(g.validatorCount() == 2, "set unchanged");
        require(g.validatorStake(v1) == 100, "weight kept");
    }

    function it_keeps_a_barred_validator_out_however_its_stake_moves() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteToRemoveValidator(v2);
        require(g.forcedOutByAdmins(v2), "pinned out");
        require(!g.isValidator(v2), "removed from the set");
        require(g.validatorCount() == 1, "one left");

        _gadd(v2, 5000);
        require(!g.isValidator(v2), "sufficient stake does not readmit it");
        require(g.stakingWeight(v2) == 5000, "weight still tracked");
        require(g.validatorStake(v2) == 0, "and never published to consensus");

        bool removed = _gremove(v2);
        require(removed, "already out is reported as removed");
    }

    function it_bars_a_validator_that_was_never_seated() public {
        _soleAdmin();
        _gadd(v1, 100);

        g.voteToRemoveValidator(v3);
        require(g.forcedOutByAdmins(v3), "pinned out before it ever qualified");
        require(g.validatorCount() == 1, "set unchanged");

        _gadd(v3, 900);
        require(!g.isValidator(v3), "stays out");
        require(g.validatorCount() == 1, "still one");
    }

    function it_seats_a_validator_staking_has_never_reported() public {
        _soleAdmin();
        _gadd(v1, 100);

        g.voteToAddValidator(v3);
        require(g.isValidator(v3), "seated by admin vote alone");
        require(g.validatorCount() == 2, "two validators");
        require(g.validatorStake(v3) == 0, "no weight to publish");
        require(!g.stakingManaged(v3), "staking does not manage it");
    }

    function it_removes_on_clearing_when_staking_wants_it_out() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteToAddValidator(v1);
        _gremove(v1);
        require(g.isValidator(v1), "the pin held");

        g.voteToClearValidatorDesignation(v1);
        require(!g.forcedInByAdmins(v1), "designation cleared");
        require(!g.isValidator(v1), "stake weight takes it out");
        require(g.validatorCount() == 1, "one left");
    }

    function it_readmits_on_clearing_when_staking_wants_it_in() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteToRemoveValidator(v2);
        _gadd(v2, 750);
        require(!g.isValidator(v2), "barred");

        g.voteToClearValidatorDesignation(v2);
        require(!g.forcedOutByAdmins(v2), "designation cleared");
        require(g.isValidator(v2), "stake weight puts it back");
        require(g.validatorStake(v2) == 750, "at the weight staking last reported");
        require(g.stakingManaged(v2), "and staking manages it again");
    }

    function it_leaves_membership_alone_when_staking_has_no_opinion() public {
        _soleAdmin();
        _gadd(v1, 100);

        g.voteToAddValidator(v3);
        require(g.isValidator(v3), "seated");

        g.voteToClearValidatorDesignation(v3);
        require(!g.forcedInByAdmins(v3), "designation cleared");
        require(g.isValidator(v3), "no stake weight to evaluate, so it stays");
    }

    function it_makes_the_two_designations_mutually_exclusive() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteToRemoveValidator(v2);
        require(g.forcedOutByAdmins(v2) && !g.forcedInByAdmins(v2), "out only");

        g.voteToAddValidator(v2);
        require(g.forcedInByAdmins(v2) && !g.forcedOutByAdmins(v2), "in only");
        require(g.isValidator(v2), "and back in the set");
    }

    function it_never_votes_out_the_last_validator() public {
        _soleAdmin();
        _gadd(v1, 100);

        bool rejected = false;
        try g.voteToRemoveValidator(v1) {
        } catch {
            rejected = true;
        }
        require(rejected, "the last validator cannot be voted out");
        require(g.isValidator(v1), "still seated");
        require(!g.forcedOutByAdmins(v1), "and no designation was left behind");
    }

    function it_respects_the_hard_cap_when_seating_by_vote() public {
        _soleAdmin();
        _gadd(v1, 100);
        _gadd(v2, 200);
        g.setHardCapValidators(2);

        bool rejected = false;
        try g.voteToAddValidator(v3) {
        } catch {
            rejected = true;
        }
        require(rejected, "a vote cannot seat past the cap");
        require(g.validatorCount() == 2, "set unchanged");
        require(!g.forcedInByAdmins(v3), "and no designation was left behind");

        // Pinning one that is already seated needs no room.
        g.voteToAddValidator(v2);
        require(g.forcedInByAdmins(v2), "pinned in at the cap");
    }

    function it_never_counts_votes_for_one_outcome_toward_another() public {
        g.seedAdmin(a1);
        g.seedAdmin(a2);
        g.seedAdmin(a3);
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteAs(a1, v2, VOTE_IN);
        g.voteAs(a2, v2, VOTE_IN);
        require(!g.forcedInByAdmins(v2), "two of three is short of the threshold");

        g.voteAs(a3, v2, VOTE_OUT);
        require(!g.forcedOutByAdmins(v2), "two in-votes do not carry an out-vote");
        require(g.validatorVoteDirection(v2) == VOTE_OUT, "the tally now points out");
        require(g.isValidator(v2), "and nothing happened to the set");

        g.voteAs(a1, v2, VOTE_OUT);
        g.voteAs(a2, v2, VOTE_OUT);
        require(g.forcedOutByAdmins(v2), "three out-votes decide");
        require(!g.isValidator(v2), "and remove it");
        require(g.validatorVoteDirection(v2) == 0, "tally reset after execution");
    }

    function it_rejects_a_second_vote_from_the_same_admin() public {
        g.seedAdmin(a1);
        g.seedAdmin(a2);
        g.seedAdmin(a3);
        _gadd(v1, 100);

        g.voteAs(a1, v1, VOTE_IN);
        bool rejected = false;
        try g.voteAs(a1, v1, VOTE_IN) {
        } catch {
            rejected = true;
        }
        require(rejected, "one vote per admin per tally");
    }

    function it_clears_by_vote_at_the_same_threshold() public {
        g.seedAdmin(a1);
        g.seedAdmin(a2);
        g.seedAdmin(a3);
        _gadd(v1, 100);
        _gadd(v2, 200);

        g.voteAs(a1, v2, VOTE_OUT);
        g.voteAs(a2, v2, VOTE_OUT);
        g.voteAs(a3, v2, VOTE_OUT);
        require(g.forcedOutByAdmins(v2) && !g.isValidator(v2), "barred");

        _gadd(v2, 750);

        g.voteAs(a1, v2, VOTE_CLEAR);
        g.voteAs(a2, v2, VOTE_CLEAR);
        require(g.forcedOutByAdmins(v2), "still barred short of the threshold");
        g.voteAs(a3, v2, VOTE_CLEAR);

        require(!g.forcedOutByAdmins(v2), "designation cleared by vote");
        require(g.isValidator(v2), "and stake weight puts it back");
        require(g.validatorStake(v2) == 750, "at its current weight");
    }
}
