// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Rewards/Rewards.sol";

contract Describe_Rewards_Batch is Authorizable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardToken;
    Rewards rewards;
    User user1;
    User user2;
    User user3;

    uint256 liquidityActivityId = 1;
    uint256 swapActivityId = 2;
    uint256 liquidityEmissionRate = 1000; // 1000 CATA per second
    uint256 swapEmissionRate = 500;       // 500 CATA per second

    function beforeAll() {
        bypassAuthorizations = true;
        user1 = new User();
        user2 = new User();
        user3 = new User();
    }

    function beforeEach() {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        address tokenAddress = m.tokenFactory().createToken(
            "TestCATA",
            "Test CATA Token",
            [], [], [], "TESTCATA", 0, 18
        );
        require(tokenAddress != address(0), "Token address is 0");
        rewardToken = Token(tokenAddress);

        rewards = m.rewards();

        m.adminRegistry().castVoteOnIssue(address(rewards), "transferOwnership", address(this));
        Ownable(address(rewards)).transferOwnership(address(this));
        rewards.initialize(tokenAddress);

        // Add Position activity for batchDeposit/batchWithdraw tests
        rewards.addActivity(liquidityActivityId, "Liquidity Pool", ActivityType.Position, liquidityEmissionRate, address(this), address(this));

        // Add OneTime activity for batchOccurred tests
        rewards.addActivity(swapActivityId, "Swap Activity", ActivityType.OneTime, swapEmissionRate, address(this), address(this));

        uint256 fundingAmount = 1000000 * 1e18;
        rewardToken.mint(address(rewards), fundingAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH DEPOSIT TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_batch_deposit_for_multiple_users() {
        // given
        address[] memory users = new address[](3);
        users[0] = address(user1);
        users[1] = address(user2);
        users[2] = address(user3);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100 * 1e18;
        amounts[1] = 200 * 1e18;
        amounts[2] = 300 * 1e18;

        // when
        rewards.batchDeposit(liquidityActivityId, users, amounts);

        // then
        (uint256 stake1, ) = rewards.userInfo(liquidityActivityId, address(user1));
        (uint256 stake2, ) = rewards.userInfo(liquidityActivityId, address(user2));
        (uint256 stake3, ) = rewards.userInfo(liquidityActivityId, address(user3));

        require(stake1 == 100 * 1e18, "User1 stake should be 100");
        require(stake2 == 200 * 1e18, "User2 stake should be 200");
        require(stake3 == 300 * 1e18, "User3 stake should be 300");

        // Check total stake
        (, , , , , uint256 totalStake, , ) = rewards.activities(liquidityActivityId);
        require(totalStake == 600 * 1e18, "Total stake should be 600");
    }

    function it_should_batch_deposit_and_distribute_rewards_correctly() {
        // given - batch deposit
        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 600 * 1e18;  // 60%
        amounts[1] = 400 * 1e18;  // 40%

        rewards.batchDeposit(liquidityActivityId, users, amounts);

        // given - 100 seconds pass
        fastForward(100);

        // when - users claim
        TestUtils.callAs(user1, address(rewards), "claimAllRewards()");
        TestUtils.callAs(user2, address(rewards), "claimAllRewards()");

        // then - rewards split proportionally
        uint256 user1Rewards = rewardToken.balanceOf(address(user1));
        uint256 user2Rewards = rewardToken.balanceOf(address(user2));

        // 100 seconds * 1000 CATA/sec = 100,000 total
        // User1: 60% = 60,000
        // User2: 40% = 40,000
        require(user1Rewards == 60000, "User1 should receive 60% of rewards");
        require(user2Rewards == 40000, "User2 should receive 40% of rewards");
    }

    function it_should_reject_batch_deposit_with_mismatched_arrays() {
        // given
        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100;
        amounts[1] = 200;
        amounts[2] = 300;

        // when/then
        bool reverted = false;
        try rewards.batchDeposit(liquidityActivityId, users, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on array length mismatch");
    }

    function it_should_reject_batch_deposit_on_onetime_activity() {
        // given
        address[] memory users = new address[](1);
        users[0] = address(user1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;

        // when/then
        bool reverted = false;
        try rewards.batchDeposit(swapActivityId, users, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when using batchDeposit on OneTime activity");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH WITHDRAW TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_batch_withdraw_for_multiple_users() {
        // given - first deposit
        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory depositAmounts = new uint256[](2);
        depositAmounts[0] = 1000 * 1e18;
        depositAmounts[1] = 1000 * 1e18;

        rewards.batchDeposit(liquidityActivityId, users, depositAmounts);

        // when - batch withdraw
        uint256[] memory withdrawAmounts = new uint256[](2);
        withdrawAmounts[0] = 400 * 1e18;
        withdrawAmounts[1] = 600 * 1e18;

        rewards.batchWithdraw(liquidityActivityId, users, withdrawAmounts);

        // then
        (uint256 stake1, ) = rewards.userInfo(liquidityActivityId, address(user1));
        (uint256 stake2, ) = rewards.userInfo(liquidityActivityId, address(user2));

        require(stake1 == 600 * 1e18, "User1 stake should be 600 after withdrawal");
        require(stake2 == 400 * 1e18, "User2 stake should be 400 after withdrawal");

        // Check total stake
        (, , , , , uint256 totalStake, , ) = rewards.activities(liquidityActivityId);
        require(totalStake == 1000 * 1e18, "Total stake should be 1000");
    }

    function it_should_reject_batch_withdraw_with_insufficient_stake() {
        // given - deposit first
        address[] memory users = new address[](1);
        users[0] = address(user1);
        uint256[] memory depositAmounts = new uint256[](1);
        depositAmounts[0] = 100 * 1e18;

        rewards.batchDeposit(liquidityActivityId, users, depositAmounts);

        // when/then - try to withdraw more than deposited
        uint256[] memory withdrawAmounts = new uint256[](1);
        withdrawAmounts[0] = 200 * 1e18;

        bool reverted = false;
        try rewards.batchWithdraw(liquidityActivityId, users, withdrawAmounts) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on insufficient stake");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH OCCURRED TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_batch_occurred_for_multiple_users() {
        // given
        address[] memory users = new address[](3);
        users[0] = address(user1);
        users[1] = address(user2);
        users[2] = address(user3);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 50 * 1e18;
        amounts[1] = 100 * 1e18;
        amounts[2] = 150 * 1e18;

        // when
        rewards.batchOccurred(swapActivityId, users, amounts);

        // then
        (uint256 stake1, ) = rewards.userInfo(swapActivityId, address(user1));
        (uint256 stake2, ) = rewards.userInfo(swapActivityId, address(user2));
        (uint256 stake3, ) = rewards.userInfo(swapActivityId, address(user3));

        require(stake1 == 50 * 1e18, "User1 stake should be 50");
        require(stake2 == 100 * 1e18, "User2 stake should be 100");
        require(stake3 == 150 * 1e18, "User3 stake should be 150");
    }

    function it_should_reject_batch_occurred_on_position_activity() {
        // given
        address[] memory users = new address[](1);
        users[0] = address(user1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;

        // when/then
        bool reverted = false;
        try rewards.batchOccurred(liquidityActivityId, users, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when using batchOccurred on Position activity");
    }

    function it_should_accumulate_stakes_with_multiple_batch_occurred_calls() {
        // given - first batch
        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts1 = new uint256[](2);
        amounts1[0] = 100 * 1e18;
        amounts1[1] = 100 * 1e18;

        rewards.batchOccurred(swapActivityId, users, amounts1);

        // when - second batch (same users, more swaps)
        uint256[] memory amounts2 = new uint256[](2);
        amounts2[0] = 50 * 1e18;
        amounts2[1] = 150 * 1e18;

        rewards.batchOccurred(swapActivityId, users, amounts2);

        // then - stakes should accumulate
        (uint256 stake1, ) = rewards.userInfo(swapActivityId, address(user1));
        (uint256 stake2, ) = rewards.userInfo(swapActivityId, address(user2));

        require(stake1 == 150 * 1e18, "User1 stake should be 150 (100 + 50)");
        require(stake2 == 250 * 1e18, "User2 stake should be 250 (100 + 150)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // AUTHORIZATION TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_reject_batch_deposit_from_unauthorized_caller() {
        // given
        address[] memory users = new address[](1);
        users[0] = address(user1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;

        // when/then - user1 tries to call (not the allowed caller)
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "batchDeposit(uint256, address[], uint256[])",
            liquidityActivityId, users, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when called by unauthorized address");
    }

}
