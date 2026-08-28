// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/StratoStakingV2.sol";
import "../../concrete/Staking/ValidatorRegistryV2.sol";
import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Util.sol";

// Helium's staking contract was initialized before USDST joined the fee path, so it
// runs with stratoToken set and usdstToken zero — a state initialize() can no longer
// produce. Dropping usdstToken reproduces it.
contract UpgradedInPlaceStaking is StratoStaking {
    constructor(address initialOwner) StratoStaking(initialOwner) { }
    function forgetUsdst() public {
        usdstToken = IERC20(address(0));
    }
}

contract Describe_StratoStaking {
    uint256 public INFINITY = 2 ** 256 - 1;
    address constant VALIDATOR_A = address(0xaaaa);
    address constant VALIDATOR_B = address(0xbbbb);

    TokenFactory factory;
    Token strato;
    Token usdst;
    StratoStaking staking;
    ValidatorRegistry registry;
    MercataGovernance gov;

    User user1;
    User user2;
    User operatorA;
    User operatorB;
    User funder;

    function beforeAll() public {
        user1 = new User();
        user2 = new User();
        operatorA = new User();
        operatorB = new User();
        funder = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        address tokenAddress = factory.createTokenWithInitialOwner(
            "STRATO",
            "STRATO Token",
            new string[](0),
            new string[](0),
            new string[](0),
            "STRATO",
            0,
            18,
            address(this)
        );
        strato = Token(tokenAddress);
        strato.setStatus(2);
        usdst = Token(factory.createTokenWithInitialOwner(
            "USDST",
            "USDST Token",
            new string[](0),
            new string[](0),
            new string[](0),
            "USDST",
            0,
            18,
            address(this)
        ));
        usdst.setStatus(2);

        staking = new StratoStaking(address(this));
        staking.initialize(address(strato), address(usdst), 100, 5000, 1000, 16);

        registry = new ValidatorRegistry(address(this));
        registry.initialize(address(staking));
        staking.setValidatorRegistry(address(registry));

        gov = new MercataGovernance(address(this));
        gov.setStakingContract(address(staking));
        staking.setGovernance(address(gov), true);
        // minStake 1000 (self + delegated), no self-bond floor, 50% proposer fee share,
        // jail after 3 consecutive misses for 100s
        staking.setValidatorParams(1000e18, 0, 5000, 3, 100);
        // set of 50, generous mutation budget, 100s exit notice / unkick cooldown, no stake cap, joins paused
        staking.setSetParams(50, 50, 500, 10, 100, 100, 0, true);

        address[] memory operatorAddresses = new address[](2);
        operatorAddresses[0] = address(operatorA);
        operatorAddresses[1] = address(operatorB);

        uint256[] memory commissions = new uint256[](2);
        commissions[0] = 500;
        commissions[1] = 0;

        string[] memory names = new string[](2);
        names[0] = "Validator A";
        names[1] = "Validator B";

        string[] memory descriptions = new string[](2);
        descriptions[0] = "First validator";
        descriptions[1] = "Second validator";

        string[] memory metadataURIs = new string[](2);
        metadataURIs[0] = "";
        metadataURIs[1] = "";

        string[] memory protocolValidatorIds = new string[](2);
        protocolValidatorIds[0] = "validator-a";
        protocolValidatorIds[1] = "validator-b";

        address[] memory validatorAddresses = new address[](2);
        validatorAddresses[0] = VALIDATOR_A;
        validatorAddresses[1] = VALIDATOR_B;

        registry.addOperators(operatorAddresses, commissions, names, descriptions, metadataURIs, protocolValidatorIds, validatorAddresses);

        _mintAndApprove(user1, 10000e18);
        _mintAndApprove(user2, 10000e18);
        _mintAndApprove(operatorA, 10000e18);
        _mintAndApprove(operatorB, 10000e18);
        _mintAndApprove(funder, 100000e18);
    }

    function _mintAndApprove(User user, uint256 amount) internal {
        strato.mint(address(user), amount);
        user.do(address(strato), "approve(address,uint256)", address(staking), INFINITY);
    }

    function _stake(User user, address operator, uint256 amount) internal {
        user.do(address(staking), "stake(address,uint256)", operator, amount);
    }

    function _claimOperators(address operator) internal pure returns (address[] memory operators) {
        operators = new address[](1);
        operators[0] = operator;
    }

    function _requestIds(uint256 requestId) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = requestId;
    }

    function _startRewards(uint256 amount, uint256 duration, uint256 baseRewardBps) internal {
        funder.do(address(staking), "depositRewards(uint256)", amount);
        staking.startRewardSchedule(amount, block.timestamp, duration, baseRewardBps, "Test Period", "Test rewards");
    }

    function it_registry_stores_and_updates_operator_profile() public {
        (bool exists, bool active, string name,,,,) = registry.operators(address(operatorA));

        require(exists, "Profile exists");
        require(active, "Profile active");
        require(keccak256(name) == keccak256("Validator A"), "Profile name");

        operatorA.do(
            address(registry),
            "updateProfile",
            address(operatorA),
            "Validator A Updated",
            "Updated validator",
            "ipfs://validator-a",
            "validator-a-protocol"
        );

        (,, string updatedName, string description, string metadataURI, string protocolValidatorId) = _profileText(address(operatorA));

        require(keccak256(updatedName) == keccak256("Validator A Updated"), "Updated name");
        require(keccak256(description) == keccak256("Updated validator"), "Updated description");
        require(keccak256(metadataURI) == keccak256("ipfs://validator-a"), "Updated metadata URI");
        require(keccak256(protocolValidatorId) == keccak256("validator-a-protocol"), "Updated protocol id");
    }

    function _profileText(address operator) internal returns (
        bool exists,
        bool active,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) {
        address validatorAddress;
        (exists, active, name, description, metadataURI, protocolValidatorId, validatorAddress) = registry.operators(operator);
    }

    function it_rejects_direct_staking_operator_sync_outside_registry() public {
        bool rejected = false;
        try staking.syncOperator(address(0x1234), true, 0, address(0)) {
        } catch {
            rejected = true;
        }
        require(rejected, "Only registry should sync operators");
    }

    function it_stakes_and_moves_user_directed_delegation() public {
        _stake(user1, address(operatorA), 600e18);
        _stake(user1, address(operatorB), 400e18);

        require(staking.delegatedStake(address(user1), address(operatorA)) == 600e18, "User stake to operator A");
        require(staking.delegatedStake(address(user1), address(operatorB)) == 400e18, "User stake to operator B");
        require(staking.totalUserStake() == 1000e18, "Total user stake");
        require(staking.totalRewardableStake() == 1000e18, "Total rewardable stake");

        user1.do(address(staking), "moveStake(address,address,uint256)", address(operatorA), address(operatorB), 100e18);

        require(staking.delegatedStake(address(user1), address(operatorA)) == 500e18, "Moved stake from A");
        require(staking.delegatedStake(address(user1), address(operatorB)) == 500e18, "Moved stake to B");
        require(staking.totalUserStake() == 1000e18, "Move should not change total user stake");
        require(staking.totalRewardableStake() == 1000e18, "Move should not change total rewardable stake");
    }

    function it_batch_stakes_and_unbonds_operator_self_bond() public {
        address[] memory operators = new address[](2);
        operators[0] = address(operatorA);
        operators[1] = address(operatorB);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 250e18;
        amounts[1] = 750e18;

        user1.do(address(staking), "stakeBatch", operators, amounts);

        require(staking.delegatedStake(address(user1), address(operatorA)) == 250e18, "Batch stake to A");
        require(staking.delegatedStake(address(user1), address(operatorB)) == 750e18, "Batch stake to B");
        require(staking.totalUserStake() == 1000e18, "Batch total user stake");

        operatorB.do(address(staking), "selfBond(uint256)", 200e18);
        operatorB.do(address(staking), "unbondSelf(uint256)", 75e18);

        (,,, uint256 selfBond,,,,,,,,,,) = staking.operators(address(operatorB));
        (uint256 amount,, bool claimed) = staking.unbondingQueue(address(operatorB), 0);

        require(selfBond == 125e18, "Self-bond reduced");
        require(amount == 75e18, "Self-bond queued");
        require(!claimed, "Self-bond unbonding open");
        require(staking.totalUnbonding() == 75e18, "Self-bond unbonding total");
    }

    function it_streams_rewards_to_delegators_operators_and_base_pool() public {
        _stake(user1, address(operatorA), 1000e18);
        operatorA.do(address(staking), "selfBond(uint256)", 1000e18);

        _startRewards(10000e18, 100, 5000);
        fastForward(10);

        uint256 userBefore = IERC20(address(strato)).balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA)));
        uint256 userAfter = IERC20(address(strato)).balanceOf(address(user1));

        uint256 operatorABefore = IERC20(address(strato)).balanceOf(address(operatorA));
        operatorA.do(address(staking), "claimOperatorRewards()");
        uint256 operatorAAfter = IERC20(address(strato)).balanceOf(address(operatorA));

        uint256 operatorBBefore = IERC20(address(strato)).balanceOf(address(operatorB));
        operatorB.do(address(staking), "claimOperatorRewards()");
        uint256 operatorBAfter = IERC20(address(strato)).balanceOf(address(operatorB));

        require(userAfter - userBefore == 2375e17, "User receives stake rewards net of commission");
        require(operatorAAfter - operatorABefore == 5125e17, "Operator A receives base self-bond and commission");
        require(operatorBAfter - operatorBBefore == 250e18, "Operator B receives base reward");
    }

    function it_starts_named_reward_period_at_scheduled_time() public {
        _stake(user1, address(operatorA), 1000e18);

        funder.do(address(staking), "depositRewards(uint256)", 10000e18);

        uint256 startTime = block.timestamp + 10;
        staking.startRewardSchedule(10000e18, startTime, 100, 0, "Season 1", "Launch staking rewards");

        require(staking.periodStart() == startTime, "Period start");
        require(staking.periodFinish() == startTime + 100, "Period finish");
        require(keccak256(staking.rewardPeriodName()) == keccak256("Season 1"), "Period name");
        require(keccak256(staking.rewardPeriodDescription()) == keccak256("Launch staking rewards"), "Period description");

        fastForward(5);

        bool earlyClaimRejected = false;
        try user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA))) {
        } catch {
            earlyClaimRejected = true;
        }
        require(earlyClaimRejected, "No rewards before start");

        fastForward(10);

        uint256 userBefore = IERC20(address(strato)).balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA)));
        uint256 userAfter = IERC20(address(strato)).balanceOf(address(user1));

        require(userAfter - userBefore == 475e18, "User receives post-start rewards");
    }

    function it_streams_only_explicit_reward_schedule_amount() public {
        _stake(user1, address(operatorA), 1000e18);

        funder.do(address(staking), "depositRewards(uint256)", 10000e18);
        staking.startRewardSchedule(4000e18, block.timestamp, 100, 0, "Limited Period", "Partial reserve schedule");

        fastForward(10);

        uint256 userBefore = IERC20(address(strato)).balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA)));
        uint256 userAfter = IERC20(address(strato)).balanceOf(address(user1));

        require(userAfter - userBefore == 380e18, "Only scheduled reward amount streams");

        bool excessRecoveryRejected = false;
        try staking.recoverRewardReserve(address(this), 6001e18) {
        } catch {
            excessRecoveryRejected = true;
        }
        require(excessRecoveryRejected, "Scheduled reserve remains protected");

        staking.recoverRewardReserve(address(this), 6000e18);
        require(staking.rewardReserve() == 3600e18, "Only idle reserve recovered");
        require(staking.scheduledRewardRemaining() == 3600e18, "Scheduled remainder still tracked");
    }

    function it_requires_active_reward_schedule_to_be_stopped_before_replacement() public {
        _stake(user1, address(operatorA), 1000e18);

        funder.do(address(staking), "depositRewards(uint256)", 10000e18);
        staking.startRewardSchedule(4000e18, block.timestamp, 100, 0, "Season 1", "First schedule");

        bool replacementRejected = false;
        try staking.startRewardSchedule(1000e18, block.timestamp, 100, 0, "Season 2", "Replacement schedule") {
        } catch {
            replacementRejected = true;
        }
        require(replacementRejected, "Active schedule should block replacement");

        fastForward(10);
        staking.stopRewardSchedule();

        require(!staking.hasActiveRewardSchedule(), "Schedule stopped");
        require(staking.scheduledRewardRemaining() == 0, "Scheduled remainder released");
        require(staking.baseRewardRate() == 0, "Base rate stopped");
        require(staking.stakeRewardRate() == 0, "Stake rate stopped");
        require(staking.recoverableRewardReserve() == 9600e18, "Undistributed rewards recoverable");

        staking.startRewardSchedule(1000e18, block.timestamp, 100, 0, "Season 2", "Replacement schedule");
        require(staking.hasActiveRewardSchedule(), "Replacement schedule active");
        require(staking.rewardPeriodAmount() == 1000e18, "Replacement amount");
    }

    function it_unstakes_into_queue_and_withdraws_after_unbonding() public {
        _stake(user1, address(operatorA), 1000e18);

        user1.do(address(staking), "unstake(address,uint256)", address(operatorA), 400e18);

        (uint256 amount, uint256 releaseTime, bool claimed) = staking.unbondingQueue(address(user1), 0);
        require(amount == 400e18, "Unbonding amount");
        require(releaseTime == block.timestamp + 100, "Release time");
        require(!claimed, "Request should be open");
        require(staking.totalUserStake() == 600e18, "Stake removed from active total");
        require(staking.totalUnbonding() == 400e18, "Unbonding total");

        bool locked = false;
        try user1.do(address(staking), "withdrawUnbonded", _requestIds(0)) {
        } catch {
            locked = true;
        }
        require(locked, "Locked request should not withdraw");

        uint256 balanceBefore = IERC20(address(strato)).balanceOf(address(user1));
        fastForward(100);
        user1.do(address(staking), "withdrawUnbonded", _requestIds(0));
        uint256 balanceAfter = IERC20(address(strato)).balanceOf(address(user1));

        (,, bool isClaimed) = staking.unbondingQueue(address(user1), 0);
        require(balanceAfter - balanceBefore == 400e18, "Unbonded principal returned");
        require(isClaimed, "Request should be claimed");
        require(staking.totalUnbonding() == 0, "Unbonding total cleared");
    }

    function it_removes_operator_queues_self_bond_and_allows_delegators_to_move() public {
        _stake(user1, address(operatorA), 500e18);
        operatorA.do(address(staking), "selfBond(uint256)", 300e18);

        registry.removeOperator(address(operatorA));

        (, bool active,,,,,,,,,,,,) = staking.operators(address(operatorA));
        require(!active, "Operator should be inactive");
        require(staking.activeOperatorCount() == 1, "Active operator count");
        require(staking.totalSelfBond() == 0, "Self-bond removed from active accounting");
        require(staking.totalRewardableStake() == 0, "Inactive operator stake not rewardable");

        (uint256 selfBondAmount,, bool claimed) = staking.unbondingQueue(address(operatorA), 0);
        require(selfBondAmount == 300e18, "Self-bond queued");
        require(!claimed, "Self-bond request open");

        bool stakeRejected = false;
        try user2.do(address(staking), "stake(address,uint256)", address(operatorA), 100e18) {
        } catch {
            stakeRejected = true;
        }
        require(stakeRejected, "Inactive operator should reject new stake");

        user1.do(address(staking), "moveStake(address,address,uint256)", address(operatorA), address(operatorB), 500e18);

        require(staking.delegatedStake(address(user1), address(operatorA)) == 0, "Stake moved away from inactive operator");
        require(staking.delegatedStake(address(user1), address(operatorB)) == 500e18, "Stake moved to active operator");
        require(staking.totalRewardableStake() == 500e18, "Moved stake becomes rewardable");

        fastForward(101); // unkick cooldown
        registry.addOperator(address(operatorA), 700, "Validator A", "Reactivated validator", "", "validator-a", VALIDATOR_A);

        (, bool reactivated, uint256 commissionBps,,,,,,,,,,,) = staking.operators(address(operatorA));
        require(reactivated, "Operator should reactivate through registry");
        require(commissionBps == 700, "Reactivation commission syncs to staking");
        require(staking.activeOperatorCount() == 2, "Reactivation restores active count");
    }

    function it_does_not_accrue_stake_rewards_after_operator_removal() public {
        _stake(user1, address(operatorA), 1000e18);
        _stake(user2, address(operatorB), 1000e18);

        _startRewards(10000e18, 100, 0);
        fastForward(10);

        registry.removeOperator(address(operatorA));

        uint256 user1Before = IERC20(address(strato)).balanceOf(address(user1));
        user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA)));
        uint256 user1After = IERC20(address(strato)).balanceOf(address(user1));
        require(user1After - user1Before == 475e18, "Removed delegator receives only pre-removal reward");

        uint256 operatorABefore = IERC20(address(strato)).balanceOf(address(operatorA));
        operatorA.do(address(staking), "claimOperatorRewards()");
        uint256 operatorAAfter = IERC20(address(strato)).balanceOf(address(operatorA));
        require(operatorAAfter - operatorABefore == 25e18, "Removed operator receives only pre-removal commission");

        fastForward(10);

        bool userClaimRejected = false;
        try user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA))) {
        } catch {
            userClaimRejected = true;
        }
        require(userClaimRejected, "Removed delegator should not accrue after removal");

        bool operatorClaimRejected = false;
        try operatorA.do(address(staking), "claimOperatorRewards()") {
        } catch {
            operatorClaimRejected = true;
        }
        require(operatorClaimRejected, "Removed operator should not accrue after removal");

        uint256 user2Before = IERC20(address(strato)).balanceOf(address(user2));
        user2.do(address(staking), "claimRewards", _claimOperators(address(operatorB)));
        uint256 user2After = IERC20(address(strato)).balanceOf(address(user2));
        require(user2After - user2Before == 1500e18, "Active delegator receives active stake rewards");
    }

    function it_removed_operator_delegators_earn_zero_when_removed_before_accrual() public {
        _stake(user1, address(operatorA), 1000e18);
        _stake(user2, address(operatorB), 1000e18);

        _startRewards(10000e18, 100, 0);
        registry.removeOperator(address(operatorA));
        fastForward(10);

        bool userClaimRejected = false;
        try user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA))) {
        } catch {
            userClaimRejected = true;
        }
        require(userClaimRejected, "Removed delegator should have zero reward");
        require(staking.pendingDelegatorRewards(address(user1), address(operatorA)) == 0, "Removed delegator pending reward");

        bool operatorClaimRejected = false;
        try operatorA.do(address(staking), "claimOperatorRewards()") {
        } catch {
            operatorClaimRejected = true;
        }
        require(operatorClaimRejected, "Removed operator should have zero commission");

        uint256 user2Before = IERC20(address(strato)).balanceOf(address(user2));
        user2.do(address(staking), "claimRewards", _claimOperators(address(operatorB)));
        uint256 user2After = IERC20(address(strato)).balanceOf(address(user2));
        require(user2After - user2Before == 1000e18, "Active delegator receives reward");
    }

    function it_enforces_operator_commission_cap() public {
        operatorA.do(address(staking), "setCommissionBps(uint256)", 1000);

        (,, uint256 commissionBps,,,,,,,,,,,) = staking.operators(address(operatorA));
        require(commissionBps == 1000, "Operator updated commission to cap");

        operatorA.do(address(staking), "setCommissionBps(uint256)", 500);

        (,, uint256 operatorCommissionBps,,,,,,,,,,,) = staking.operators(address(operatorA));
        require(operatorCommissionBps == 500, "Operator updated commission");

        staking.setOperatorCommissionBps(address(operatorA), 250);

        (,, uint256 adminCommissionBps,,,,,,,,,,,) = staking.operators(address(operatorA));
        require(adminCommissionBps == 250, "Admin can update operator commission");

        bool rejected = false;
        try operatorA.do(address(staking), "setCommissionBps(uint256)", 1001) {
        } catch {
            rejected = true;
        }
        require(rejected, "Commission above cap should revert");

        bool unauthorized = false;
        try user1.do(address(staking), "setCommissionBps(uint256)", 100) {
        } catch {
            unauthorized = true;
        }
        require(unauthorized, "Unrelated user should not update commission");
    }

    function it_rejects_lowering_commission_cap_below_active_operator_commission() public {
        operatorA.do(address(staking), "setCommissionBps(uint256)", 900);

        bool rejected = false;
        try staking.setParams(100, 5000, 800, 16) {
        } catch {
            rejected = true;
        }
        require(rejected, "Cannot lower cap below active commission");

        staking.setOperatorCommissionBps(address(operatorA), 800);
        staking.setParams(100, 5000, 800, 16);

        require(staking.maxCommissionBps() == 800, "Cap lowered after commission update");
    }

    function it_keeps_principal_separate_from_recoverable_reward_reserve() public {
        _stake(user1, address(operatorA), 1000e18);
        funder.do(address(staking), "depositRewards(uint256)", 1500e18);
        staking.startRewardSchedule(1000e18, block.timestamp, 100, 5000, "Test Period", "Test rewards");

        staking.recoverRewardReserve(address(this), 500e18);

        require(staking.totalUserStake() == 1000e18, "Principal accounting unchanged");
        require(IERC20(address(strato)).balanceOf(address(staking)) >= staking.principalBalance(), "Principal remains collateralized");

        bool rejected = false;
        try staking.recoverRewardReserve(address(this), 1) {
        } catch {
            rejected = true;
        }
        require(rejected, "Cannot recover scheduled reward reserve");
    }

    function it_protects_accrued_unclaimed_rewards_from_untracked_recovery() public {
        _stake(user1, address(operatorA), 1000e18);
        _startRewards(1000e18, 100, 0);

        fastForward(10);
        staking.stopRewardSchedule();

        require(staking.allocatedRewardLiability() == 100e18, "Accrued rewards tracked as liability");
        require(staking.recoverableUntrackedStrato() == 0, "Accrued rewards are not untracked");

        bool accruedRecoveryRejected = false;
        try staking.recoverUntrackedStrato(address(this), 1) {
        } catch {
            accruedRecoveryRejected = true;
        }
        require(accruedRecoveryRejected, "Cannot recover accrued rewards as untracked");

        strato.mint(address(this), 250e18);
        require(IERC20(address(strato)).transfer(address(staking), 250e18), "Direct STRATO transfer");
        require(staking.recoverableUntrackedStrato() == 250e18, "Only direct STRATO transfer is untracked");

        staking.recoverUntrackedStrato(address(this), 250e18);
        require(staking.recoverableUntrackedStrato() == 0, "Direct transfer recovered");

        user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA)));
        require(staking.allocatedRewardLiability() == 5e18, "Commission liability remains");

        operatorA.do(address(staking), "claimOperatorRewards()");
        require(staking.allocatedRewardLiability() == 0, "Liability cleared after claims");
    }

    function it_rejects_repointing_validator_registry_after_wiring() public {
        ValidatorRegistry replacement = new ValidatorRegistry(address(this));

        bool rejected = false;
        try staking.setValidatorRegistry(address(replacement)) {
        } catch {
            rejected = true;
        }
        require(rejected, "Registry should only be set once");
        require(address(staking.validatorRegistry()) == address(registry), "Registry unchanged");
    }

    function it_recovers_only_untracked_strato_transfers() public {
        _stake(user1, address(operatorA), 1000e18);
        funder.do(address(staking), "depositRewards(uint256)", 500e18);

        strato.mint(address(this), 250e18);
        require(IERC20(address(strato)).transfer(address(staking), 250e18), "Direct STRATO transfer");

        require(staking.recoverableUntrackedStrato() == 250e18, "Untracked STRATO detected");

        bool reserveRecoveryRejected = false;
        try staking.recoverRewardReserve(address(this), 750e18) {
        } catch {
            reserveRecoveryRejected = true;
        }
        require(reserveRecoveryRejected, "Untracked STRATO is not reward reserve");

        uint256 beforeBalance = IERC20(address(strato)).balanceOf(address(this));
        staking.recoverUntrackedStrato(address(this), 250e18);
        uint256 afterBalance = IERC20(address(strato)).balanceOf(address(this));

        require(afterBalance - beforeBalance == 250e18, "Recovered untracked STRATO");
        require(staking.recoverableUntrackedStrato() == 0, "No untracked STRATO remains");
        require(staking.rewardReserve() == 500e18, "Reward reserve unchanged");
        require(IERC20(address(strato)).balanceOf(address(staking)) >= staking.principalBalance() + staking.rewardReserve(), "Tracked balances protected");
    }

    // ---- consensus integration: governance sync, proposer fees, liveness slashing ----

    function _selfBond(User operator, uint256 amount) internal {
        operator.do(address(staking), "selfBond(uint256)", amount);
    }

    function _activate(User operator) internal {
        staking.tryActivate(address(operator));
    }

    function _bondBoth() internal {
        _selfBond(operatorA, 1000e18);
        _selfBond(operatorB, 2000e18);
        _activate(operatorA);
        _activate(operatorB);
    }

    function _register(User who, address validator) internal {
        who.doSuccessfully(address(registry), "register", uint256(0), "Operator", "", "", "", validator);
    }

    function _selfBondOf(address operator) internal returns (uint256) {
        (,,, uint256 selfBond,,,,,,,,,,) = staking.operators(operator);
        return selfBond;
    }

    function _pendingOperatorFees(address operator) internal returns (uint256) {
        (,,,,,,,,,,,, uint256 pendingSelfBondFees, uint256 pendingFeeCommission) = staking.operators(operator);
        return pendingSelfBondFees + pendingFeeCommission;
    }

    function it_activates_eligible_validators_explicitly_and_tracks_weight() public {
        require(staking.status(address(operatorA)) == 1, "Registered");
        require(!gov.isValidator(VALIDATOR_A), "not a validator before bonding");

        _selfBond(operatorA, 999e18);
        require(!staking.eligible(address(operatorA)), "below minStake");
        bool rejected = false;
        try staking.tryActivate(address(operatorA)) {
        } catch {
            rejected = true;
        }
        require(rejected, "cannot activate below minStake");

        _selfBond(operatorA, 1e18);
        require(staking.isWaiter(address(operatorA)), "eligible but not yet active");
        require(!gov.isValidator(VALIDATOR_A), "joining is explicit");
        _activate(operatorA);
        require(staking.status(address(operatorA)) == 2, "Active");
        require(gov.isValidator(VALIDATOR_A), "registered in governance");
        require(staking.validatorCount() == 1, "counted");
        require(gov.validatorStake(VALIDATOR_A) == 1000e18, "weight = self-bond");

        _stake(user1, address(operatorA), 500e18);
        require(gov.validatorStake(VALIDATOR_A) == 1500e18, "weight includes delegated stake");
        require(staking.lastSyncedWeight(address(operatorA)) == 1500e18, "synced weight");

        user1.do(address(staking), "unstake(address,uint256)", address(operatorA), 200e18);
        require(gov.validatorStake(VALIDATOR_A) == 1300e18, "weight follows unstake");
    }

    // The pre-upgrade contract maintained lastSyncedWeight without ever calling
    // governance, so the cache reported "already synced" while governance held
    // nothing — and kept reporting it, suppressing every later publish. Pointing
    // at a fresh governance reproduces that exact shape: local cache correct,
    // governance empty. A resync has to republish anyway.
    function it_republishes_stakes_to_a_governance_that_knows_nothing() public {
        _bondBoth();
        uint256 weightA = gov.validatorStake(VALIDATOR_A);
        uint256 weightB = gov.validatorStake(VALIDATOR_B);
        require(weightA == 1000e18 && weightB == 2000e18, "published to the original governance");

        MercataGovernance fresh = new MercataGovernance(address(this));
        fresh.setStakingContract(address(staking));
        require(fresh.validatorStake(VALIDATOR_A) == 0, "fresh governance knows nothing");
        require(staking.lastSyncedWeight(address(operatorA)) == weightA, "local cache still claims synced");

        staking.setGovernance(address(fresh), true);

        require(fresh.validatorStake(VALIDATOR_A) == weightA, "republished despite the cache");
        require(fresh.validatorStake(VALIDATOR_B) == weightB, "both validators republished");
        require(fresh.isValidator(VALIDATOR_A), "membership reconciled too");
    }

    function it_removes_and_readds_validators_around_the_threshold() public {
        _bondBoth();
        require(gov.validatorCount() == 2, "two validators");

        operatorA.do(address(staking), "unbondSelf(uint256)", 1e18);
        require(!gov.isValidator(VALIDATOR_A), "removed below minStake in the same tx");
        require(staking.status(address(operatorA)) == 1, "back to Registered");
        require(staking.validatorCount() == 1, "count updated");
        require(gov.isValidator(VALIDATOR_B), "B unaffected");

        _stake(user1, address(operatorA), 1e18);
        require(staking.isWaiter(address(operatorA)), "delegated stake counts towards minStake");
        require(!gov.isValidator(VALIDATOR_A), "no implicit re-activation");
        _activate(operatorA);
        require(gov.isValidator(VALIDATOR_A), "re-added on request");

        registry.removeOperator(address(operatorA));
        require(!gov.isValidator(VALIDATOR_A), "removed with the operator");
        require(staking.status(address(operatorA)) == 3, "Kicked");
    }

    function it_enforces_a_self_bond_floor_when_set() public {
        staking.setValidatorParams(1000e18, 500e18, 5000, 0, 0);
        _stake(user1, address(operatorA), 1000e18);
        require(!staking.eligible(address(operatorA)), "delegated stake alone does not meet the self-bond floor");
        _selfBond(operatorA, 500e18);
        require(staking.eligible(address(operatorA)), "eligible once self-bond floor met");
    }

    function it_never_removes_the_last_validator() public {
        _selfBond(operatorA, 1000e18);
        _activate(operatorA);
        operatorA.do(address(staking), "unbondSelf(uint256)", 500e18);
        require(gov.isValidator(VALIDATOR_A), "governance keeps its last validator");
        require(staking.isValidator(address(operatorA)), "still tracked until it can be removed");
    }

    function it_requires_a_validator_address_and_swaps_registration_on_change() public {
        _bondBoth();
        registry.setValidatorAddress(address(operatorA), address(0));
        require(!gov.isValidator(VALIDATOR_A), "no validator address, no validator");
        require(staking.operatorOf(VALIDATOR_A) == address(0), "reverse map cleared");

        registry.setValidatorAddress(address(operatorA), address(0xa1));
        require(staking.validatorOf(address(operatorA)) == address(0xa1), "forward map");
        _activate(operatorA);
        require(gov.isValidator(address(0xa1)), "registered under the new address");

        registry.setValidatorAddress(address(operatorA), address(0xa2));
        require(!gov.isValidator(address(0xa1)), "old address retired");
        require(gov.isValidator(address(0xa2)), "an active validator keeps its slot under the new address");

        bool rejected = false;
        try registry.setValidatorAddress(address(operatorB), address(0xa2)) {
        } catch {
            rejected = true;
        }
        require(rejected, "validator address must be unique");
    }

    function it_reconciles_the_set_when_governance_is_enabled_later() public {
        staking.setGovernance(address(gov), false);
        _selfBond(operatorA, 1000e18);
        _selfBond(operatorB, 2000e18);
        require(gov.validatorCount() == 0, "no governance calls while disabled");

        staking.setGovernance(address(gov), true);
        staking.reconcileSet();
        require(gov.validatorCount() == 2, "enabled: both promoted");
        require(gov.validatorStake(VALIDATOR_B) == 2000e18, "weights published");
    }

    function it_credits_proposer_fees_to_operator_and_delegators() public {
        _bondBoth();
        _stake(user1, address(operatorA), 1000e18);

        setBlockContext(VALIDATOR_A, address(0), address(0), 0);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();

        require(staking.trackedUsdst() == 100e18, "fees tracked");
        require(staking.totalFeesCredited() == 100e18, "fees credited");
        // weight 2000: self-bond 1000 -> 50, delegators 50 gross, 5% commission -> 2.5 + 47.5
        require(_pendingOperatorFees(address(operatorA)) == 525e17, "operator self-bond fees + commission");

        bool rejected = false;
        try user1.do(address(staking), "claimRewards", _claimOperators(address(operatorA))) {
        } catch {
            rejected = true;
        }
        require(rejected, "STRATO claim does not pay fees");

        user1.do(address(staking), "claimFeeRewards", _claimOperators(address(operatorA)));
        require(usdst.balanceOf(address(user1)) == 475e17, "delegator claimed fee share");

        operatorA.do(address(staking), "claimOperatorFeeRewards()");
        require(usdst.balanceOf(address(operatorA)) == 525e17, "operator claimed fees");
        require(staking.trackedUsdst() == 0, "all fees paid out");
    }

    function it_settles_delegator_fees_when_stake_changes() public {
        _bondBoth();
        _stake(user1, address(operatorA), 1000e18);
        setBlockContext(VALIDATOR_A, address(0), address(0), 0);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();

        _stake(user2, address(operatorA), 1000e18);
        usdst.mint(address(staking), 100e18);
        staking.processBlock();
        // block 1: user1 alone gets 47.5; block 2: self-bond 1000 of weight 3000 -> 33.33.., delegators 66.66.. gross,
        // net of 5% -> 63.33.. split evenly -> 31.66.. each
        user1.do(address(staking), "claimFeeRewards", _claimOperators(address(operatorA)));
        user2.do(address(staking), "claimFeeRewards", _claimOperators(address(operatorA)));
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

    function it_sets_usdst_on_a_contract_upgraded_in_place() public {
        UpgradedInPlaceStaking upgraded = new UpgradedInPlaceStaking(address(this));
        upgraded.initialize(address(strato), address(usdst), 100, 5000, 1000, 16);
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
        upgraded.initialize(address(strato), address(usdst), 100, 5000, 1000, 16);
        upgraded.forgetUsdst();

        bool rejected = false;
        try user1.do(address(upgraded), "setUsdstToken", address(usdst)) {
        } catch {
            rejected = true;
        }
        require(rejected, "non-owner rejected");
        require(address(upgraded.usdstToken()) == address(0), "still unset");
    }

    function it_counts_proposals_and_misses_once_per_block() public {
        _bondBoth();

        // previous block: A was intended, B proposed (a round change happened)
        setBlockContext(VALIDATOR_B, VALIDATOR_B, VALIDATOR_A, 1);
        staking.processBlock();
        require(staking.blocksProposed(VALIDATOR_B) == 1, "fill-in proposer credited");
        require(staking.missedProposals(VALIDATOR_A) == 1, "intended proposer missed");
        require(staking.consecutiveMisses(VALIDATOR_A) == 1, "consecutive miss");
        require(_selfBondOf(address(operatorA)) == 1000e18, "no tokens move on a miss");
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
        require(staking.jailedUntil(address(operatorA)) > block.timestamp, "jail window set");
        require(staking.consecutiveMisses(VALIDATOR_A) == 0, "streak reset on jail");
        require(_selfBondOf(address(operatorA)) == 1000e18, "stake untouched by jail");

        _selfBond(operatorA, 1e18);
        bool rejected = false;
        try staking.tryActivate(address(operatorA)) {
        } catch {
            rejected = true;
        }
        require(rejected, "cannot re-activate while jailed");

        fastForward(101, 1);
        _activate(operatorA);
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
        require(staking.jailedUntil(address(operatorA)) > block.timestamp, "jail recorded despite governance rejecting the removal");
        require(staking.isValidator(address(operatorA)), "registration left as is");
    }

    function it_register_is_permissionless_but_activation_is_gated() public {
        _register(user1, address(0xc1));
        require(staking.status(address(user1)) == 1, "Registered");
        require(staking.validatorOf(address(user1)) == address(0xc1), "validator address bound");
        require(!staking.eligible(address(user1)), "no stake yet");

        user1.do(address(staking), "selfBond(uint256)", 1000e18);
        require(staking.isWaiter(address(user1)), "waiter");

        user1.doExpectingFailure(address(staking), "tryActivate(address)", "SS: joins paused", address(user1));
        staking.tryActivate(address(user1));
        require(staking.status(address(user1)) == 2, "owner may activate while paused");

        user2.doExpectingFailure(address(registry), "register", "VR: validator address=0", uint256(0), "X", "", "", "", address(0));
        user1.doExpectingFailure(address(registry), "register", "VR: already registered", uint256(0), "X", "", "", "", address(0xc9));
    }

    function it_fills_the_set_then_evicts_the_lowest_with_margin() public {
        staking.setSetParams(2, 50, 500, 10, 100, 100, 0, false);
        _bondBoth();
        require(staking.validatorCount() == 2, "set full");

        _register(user1, address(0xc1));
        user1.do(address(staking), "selfBond(uint256)", 1049e18);
        user1.doExpectingFailure(address(staking), "tryActivate(address)", "SS: set full", address(user1));

        user1.do(address(staking), "selfBond(uint256)", 1e18);
        user1.doSuccessfully(address(staking), "tryActivate(address)", address(user1));
        require(gov.isValidator(address(0xc1)), "newcomer activated");
        require(!gov.isValidator(VALIDATOR_A), "lowest validator evicted");
        require(staking.status(address(operatorA)) == 1, "evicted operator is Registered");
        require(_selfBondOf(address(operatorA)) == 1000e18, "eviction does not unbond self-bond");
        require(staking.validatorCount() == 2, "set size unchanged");

        bool rejected = false;
        try staking.setSetParams(3, 51, 500, 10, 100, 100, 0, false) {
        } catch {
            rejected = true;
        }
        require(rejected, "hard cap only lowers");
    }

    function it_reconciles_waiters_by_stake_within_the_mutation_budget() public {
        staking.setSetParams(3, 50, 500, 2, 100, 100, 0, false);
        _register(user1, address(0xc1));
        _selfBond(operatorA, 1000e18);
        _selfBond(operatorB, 3000e18);
        user1.do(address(staking), "selfBond(uint256)", 2000e18);

        user2.doSuccessfully(address(staking), "reconcileSet()");
        require(gov.isValidator(VALIDATOR_B), "highest waiter first");
        require(gov.isValidator(address(0xc1)), "second highest");
        require(!gov.isValidator(VALIDATOR_A), "mutation budget exhausted for this block");

        fastForward(1, 1);
        user2.doSuccessfully(address(staking), "reconcileSet()");
        require(gov.isValidator(VALIDATOR_A), "promoted in the next block");
        require(staking.validatorCount() == 3, "set full");
    }

    function it_mutation_cap_fails_closed_but_kicks_bypass_it() public {
        staking.setSetParams(50, 50, 500, 1, 100, 100, 0, true);
        _selfBond(operatorA, 1000e18);
        _selfBond(operatorB, 2000e18);
        _activate(operatorA);
        bool rejected = false;
        try staking.tryActivate(address(operatorB)) {
        } catch {
            rejected = true;
        }
        require(rejected, "second mutation in the block rejected");

        fastForward(1, 1);
        _activate(operatorB);
        registry.removeOperator(address(operatorA));
        require(!gov.isValidator(VALIDATOR_A), "kick leaves the set regardless of the cap");
        require(gov.isValidator(VALIDATOR_B), "B stays");
    }

    function it_exits_after_the_notice_period() public {
        _bondBoth();
        operatorA.do(address(staking), "requestExit()");
        require(gov.isValidator(VALIDATOR_A), "still serving during the notice");
        operatorA.do(address(staking), "cancelExit()");
        operatorA.do(address(staking), "requestExit()");

        fastForward(101, 1);
        staking.syncValidator(address(operatorA));
        require(!gov.isValidator(VALIDATOR_A), "left the set after the notice");
        require(staking.status(address(operatorA)) == 1, "Registered");
        require(_selfBondOf(address(operatorA)) == 1000e18, "self-bond stays bonded");
        require(staking.exitReadyTime(address(operatorA)) == 0, "exit cleared");
    }

    function it_enforces_the_unkick_cooldown() public {
        _bondBoth();
        registry.removeOperator(address(operatorA));
        require(staking.status(address(operatorA)) == 3, "Kicked");
        (uint256 queued,,) = staking.unbondingQueue(address(operatorA), 0);
        require(queued == 1000e18, "kick force-unbonds self-bond");

        bool rejected = false;
        try registry.addOperator(address(operatorA), 500, "Validator A", "", "", "validator-a", VALIDATOR_A) {
        } catch {
            rejected = true;
        }
        require(rejected, "re-listing blocked during the cooldown");

        fastForward(101, 1);
        registry.addOperator(address(operatorA), 500, "Validator A", "", "", "validator-a", VALIDATOR_A);
        require(staking.status(address(operatorA)) == 1, "Registered again, not Active");
    }

    function it_caps_inbound_stake_per_operator() public {
        _selfBond(operatorA, 1000e18);
        _selfBond(operatorB, 1000e18);
        _register(user2, address(0xc1));
        user2.do(address(staking), "selfBond(uint256)", 6000e18);
        // the cap is switched on once the set is bootstrapped (a lone first staker is always 100%)
        staking.setSetParams(50, 50, 500, 10, 100, 100, 3300, true);

        _stake(user1, address(operatorA), 1500e18); // 2500 / 9500 = 26%
        _stake(user1, address(operatorB), 1000e18); // 2000 / 10500 = 19%
        user1.doExpectingFailure(address(staking), "stake(address,uint256)", "SS: above operator stake cap", address(operatorA), 1500e18);
        user1.doExpectingFailure(address(staking), "moveStake(address,address,uint256)", "SS: above operator stake cap", address(operatorB), address(operatorA), 1000e18);
        operatorA.doExpectingFailure(address(staking), "selfBond(uint256)", "SS: above operator stake cap", 2000e18);
        user1.do(address(staking), "unstake(address,uint256)", address(operatorA), 500e18);
        require(staking.delegatedStake(address(user1), address(operatorA)) == 1000e18, "unstaking is never capped");
    }

    function it_process_block_is_a_noop_before_initialization() public {
        StratoStaking fresh = new StratoStaking(address(this));
        fresh.processBlock();
        require(fresh.lastProcessedBlock() == 0, "nothing processed");
    }
}
