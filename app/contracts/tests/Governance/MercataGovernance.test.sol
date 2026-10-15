import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../Util.sol";

// Test-only subclass. Admins are otherwise seeded only at genesis, and admin
// votes only reach the contract through the AdminRegistry that owns it. The
// harness seeds admins directly and lets a seeded admin vote without being the
// owner, so the vote paths can be exercised in isolation.
contract GovernanceHarness is MercataGovernance {
    constructor(address initialOwner) MercataGovernance(initialOwner) { }

    function seedAdmin(address admin) external {
        admins.push(admin);
        adminMap[admin] = admins.length;
    }

    function _checkOwner() internal view override {
        if (adminMap[_msgSender()] == 0) super._checkOwner();
    }
}

// Staking-driven validator management and admin voting on the governance
// contract.
contract Describe_MercataGovernance {
    GovernanceHarness gov;
    User staking;
    User stranger;

    address v1 = address(0x1111);
    address v2 = address(0x2222);
    address v3 = address(0x3333);

    function beforeAll() public {
        staking = new User();
        stranger = new User();
    }

    function beforeEach() public {
        gov = new GovernanceHarness(address(this));
        gov.setStakingContract(address(staking));
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

    // Admin votes on the validator set. An empty set halts consensus for good
    // ("All participants voted out, consensus is stuck."), so the last validator
    // must never be removable by vote, unlike the staking path which declines
    // quietly. Requires inside onlyOwner bodies surface as a generic revert
    // (Ownable re-routes the failure to the owner), so only the revert and the
    // untouched state are asserted.
    function it_never_votes_out_the_last_validator() public {
        User a1 = new User();
        gov.seedAdmin(address(this));
        gov.seedAdmin(address(a1)); // quorum is 2 of 2
        _add(staking, v1, 1);
        _add(staking, v2, 2);

        gov.voteToRemoveValidator(v1);
        a1.doSuccessfully(address(gov), "voteToRemoveValidator(address)", v1);
        require(gov.validatorCount() == 1 && !gov.isValidator(v1), "v1 voted out");

        // Even a first, non-quorum vote against the sole validator is refused.
        bool reverted = false;
        try gov.voteToRemoveValidator(v2) {
        } catch {
            reverted = true;
        }
        require(reverted, "voting out the last validator must revert");
        require(gov.validatorCount() == 1 && gov.isValidator(v2), "v2 remains");
        require(gov.validatorVoteMap(v2, address(this)) == 0, "no vote is left behind");

        // Once another validator exists, v2 can be voted out again.
        _add(staking, v3, 3);
        gov.voteToRemoveValidator(v2);
        a1.doSuccessfully(address(gov), "voteToRemoveValidator(address)", v2);
        require(gov.validatorCount() == 1 && gov.isValidator(v3), "v2 voted out once v3 joined");
    }

    // At genesis the admin list holds exactly one entry (the AdminRegistry), so
    // a single executed vote could empty it and strand the contract: every
    // voteTo* entry point then fails its admin check and nothing can re-seed one.
    function it_removes_admins_by_vote_but_never_the_last_one() public {
        User a1 = new User();
        User a2 = new User();
        gov.seedAdmin(address(this));
        gov.seedAdmin(address(a1));
        gov.seedAdmin(address(a2)); // quorum is 3 of 3

        gov.voteToRemoveAdmin(address(a2));
        a1.doSuccessfully(address(gov), "voteToRemoveAdmin(address)", address(a2));
        require(gov.adminMap(address(a2)) == 3, "no quorum yet");
        a2.doSuccessfully(address(gov), "voteToRemoveAdmin(address)", address(a2));
        require(gov.adminMap(address(a2)) == 0, "a2 voted out");

        gov.voteToRemoveAdmin(address(a1)); // quorum is now 2 of 2
        a1.doSuccessfully(address(gov), "voteToRemoveAdmin(address)", address(a1));
        require(gov.adminMap(address(a1)) == 0, "a1 voted out");
        require(gov.admins(0) == address(this), "one admin left");

        bool reverted = false;
        try gov.voteToRemoveAdmin(address(this)) {
        } catch {
            reverted = true;
        }
        require(reverted, "voting out the last admin must revert");
        require(gov.adminMap(address(this)) == 1, "the last admin remains");
        require(gov.adminVoteMap(address(this), address(this)) == 0, "no vote is left behind");

        // Governance is still usable afterwards.
        gov.voteToAddAdmin(address(stranger));
        require(gov.adminMap(address(stranger)) == 2, "a new admin can still be added");
    }
}
