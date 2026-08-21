import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../Util.sol";

// Staking-driven validator management on the governance contract. Admin voting
// cannot be exercised here because admins are only seeded at genesis.
contract Describe_MercataGovernance {
    MercataGovernance gov;
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
        gov = new MercataGovernance(address(this));
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
}
