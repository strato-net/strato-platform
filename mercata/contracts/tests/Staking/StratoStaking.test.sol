// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/StratoStaking.sol";
import "../../concrete/Staking/ValidatorRegistry.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Util.sol";

contract Describe_StratoStaking {
    uint256 public INFINITY = 2 ** 256 - 1;

    TokenFactory factory;
    Token strato;
    StratoStaking staking;
    ValidatorRegistry registry;

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

        staking = new StratoStaking(address(this));
        staking.initialize(address(strato), 100, 5000, 1000, 16);

        registry = new ValidatorRegistry(address(this));
        registry.initialize(address(staking));
        staking.setValidatorRegistry(address(registry));

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

        registry.addOperators(operatorAddresses, commissions, names, descriptions, metadataURIs, protocolValidatorIds);

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
        (bool exists, bool active, string name,,,) = registry.operators(address(operatorA));

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
        (exists, active, name, description, metadataURI, protocolValidatorId) = registry.operators(operator);
    }

    function it_rejects_direct_staking_operator_sync_outside_registry() public {
        bool rejected = false;
        try staking.syncOperator(address(0x1234), true, 0) {
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

        (,,, uint256 selfBond,,,,,,,) = staking.operators(address(operatorB));
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

        (, bool active,,,,,,,,,) = staking.operators(address(operatorA));
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

        registry.addOperator(address(operatorA), 700, "Validator A", "Reactivated validator", "", "validator-a");

        (, bool reactivated, uint256 commissionBps,,,,,,,,) = staking.operators(address(operatorA));
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

        (,, uint256 commissionBps,,,,,,,,) = staking.operators(address(operatorA));
        require(commissionBps == 1000, "Operator updated commission to cap");

        operatorA.do(address(staking), "setCommissionBps(uint256)", 500);

        (,, uint256 operatorCommissionBps,,,,,,,,) = staking.operators(address(operatorA));
        require(operatorCommissionBps == 500, "Operator updated commission");

        staking.setOperatorCommissionBps(address(operatorA), 250);

        (,, uint256 adminCommissionBps,,,,,,,,) = staking.operators(address(operatorA));
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
}
