// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Rewards/Rewards.sol";

contract Describe_Rewards_Earn_and_Claim is Authorizable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardToken;
    Rewards rewards;
    User user1;
    User user2;

    uint256 liquidityActivityId = 1;
    uint256 borrowActivityId = 2;
    uint256 liquidityEmissionRate = 900; // 900 CATA per second
    uint256 borrowEmissionRate = 100;    // 100 CATA per second

    function beforeAll() {
        bypassAuthorizations = true;
        // Create test users once
        user1 = new User();
        user2 = new User();
    }

    function beforeEach() {
        // Create fresh Mercata infrastructure for each test
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        // Deploy reward token
        address tokenAddress = m.tokenFactory().createToken(
            "TestCATA",
            "Test CATA Token",
            [], [], [], "TESTCATA", 0, 18
        );
        require(tokenAddress != address(0), "Token address is 0");
        rewardToken = Token(tokenAddress);

        // Create Rewards contract directly (test contract is owner)
        rewards = new Rewards(address(this));
        rewards.initialize(tokenAddress);

        // Add activities - test contract is the allowed caller (simulating the pool)
        rewards.addActivity(liquidityActivityId, "Lending Pool Liquidity", ActivityType.Position, liquidityEmissionRate, address(this), address(this));
        rewards.addActivity(borrowActivityId, "Lending Pool Borrows", ActivityType.Position, borrowEmissionRate, address(this), address(this));

        // Fund the Rewards contract with CATA tokens
        uint256 fundingAmount = 1000000 * 1e18; // 1 million CATA
        rewardToken.mint(address(rewards), fundingAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO 1: Single user deposits liquidity, time passes, claims rewards
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_accrue_rewards_for_single_liquidity_provider() {
        // given - user1 deposits 1000 units of liquidity
        uint256 depositAmount = 1000 * 1e18;
        rewards.deposit(liquidityActivityId, address(user1), depositAmount);

        // given - 100 seconds pass
        fastForward(100);

        // when - user1 claims rewards
        uint256 balanceBefore = rewardToken.balanceOf(address(user1));
        TestUtils.callAs(user1, address(rewards), "claimAllRewards()");
        uint256 balanceAfter = rewardToken.balanceOf(address(user1));

        // then - user1 should receive 100 seconds * 900 CATA/second = 90,000 CATA
        uint256 expectedRewards = 100 * liquidityEmissionRate;
        uint256 actualRewards = balanceAfter - balanceBefore;
        require(actualRewards == expectedRewards, "User should receive correct rewards");

        // then - unclaimed rewards should be zero
        require(rewards.unclaimedRewards(address(user1)) == 0, "Unclaimed rewards should be zero after claim");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO 2: Multiple users with different stakes (proportional rewards)
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_split_rewards_proportionally_between_two_users() {
        // given - user1 deposits 600 units
        uint256 user1Deposit = 600 * 1e18;
        rewards.deposit(liquidityActivityId, address(user1), user1Deposit);

        // given - user2 deposits 400 units
        uint256 user2Deposit = 400 * 1e18;
        rewards.deposit(liquidityActivityId, address(user2), user2Deposit);

        // given - 100 seconds pass
        fastForward(100);

        // when - both users claim rewards
        TestUtils.callAs(user1, address(rewards), "claimAllRewards()");
        TestUtils.callAs(user2, address(rewards), "claimAllRewards()");

        uint256 user1Rewards = rewardToken.balanceOf(address(user1));
        uint256 user2Rewards = rewardToken.balanceOf(address(user2));

        // then - user1 should receive 60% of rewards (600/1000)
        // 100 seconds * 900 CATA/second * 0.6 = 54,000 CATA
        uint256 expectedUser1Rewards = 100 * liquidityEmissionRate * 60 / 100;
        require(user1Rewards == expectedUser1Rewards, "User1 should receive 60% of rewards");

        // then - user2 should receive 40% of rewards (400/1000)
        // 100 seconds * 900 CATA/second * 0.4 = 36,000 CATA
        uint256 expectedUser2Rewards = 100 * liquidityEmissionRate * 40 / 100;
        require(user2Rewards == expectedUser2Rewards, "User2 should receive 40% of rewards");

        // then - both unclaimed rewards should be zero
        require(rewards.unclaimedRewards(address(user1)) == 0, "User1 unclaimed should be zero");
        require(rewards.unclaimedRewards(address(user2)) == 0, "User2 unclaimed should be zero");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO 3: User participates in BOTH activities (multi-activity rewards)
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_accrue_rewards_from_multiple_activities() {
        // given - user1 deposits liquidity (activity 1)
        uint256 liquidityAmount = 1000 * 1e18;
        rewards.deposit(liquidityActivityId, address(user1), liquidityAmount);

        // given - user1 borrows (activity 2)
        uint256 borrowAmount = 500 * 1e18;
        rewards.deposit(borrowActivityId, address(user1), borrowAmount);

        // given - 100 seconds pass
        fastForward(100);

        // when - user1 claims all rewards
        TestUtils.callAs(user1, address(rewards), "claimAllRewards()");

        uint256 totalRewards = rewardToken.balanceOf(address(user1));

        // then - user1 should receive rewards from both activities
        // Liquidity: 100 seconds * 900 CATA/second = 90,000 CATA
        // Borrow: 100 seconds * 100 CATA/second = 10,000 CATA
        // Total: 100,000 CATA
        uint256 expectedLiquidityRewards = 100 * liquidityEmissionRate;
        uint256 expectedBorrowRewards = 100 * borrowEmissionRate;
        uint256 expectedTotalRewards = expectedLiquidityRewards + expectedBorrowRewards;

        require(totalRewards == expectedTotalRewards, "User should receive rewards from both activities");

        // then - unclaimed rewards should be zero
        require(rewards.unclaimedRewards(address(user1)) == 0, "Unclaimed rewards should be zero");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO 4: Dynamic stake changes (partial withdrawal)
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_handle_partial_withdrawal_and_continue_accruing() {
        // given - user1 deposits 1000 units
        uint256 initialDeposit = 1000 * 1e18;
        rewards.deposit(liquidityActivityId, address(user1), initialDeposit);

        // given - 50 seconds pass
        fastForward(50);

        // when - user1 withdraws 400 units (leaving 600)
        uint256 withdrawAmount = 400 * 1e18;
        rewards.withdraw(liquidityActivityId, address(user1), withdrawAmount);

        // given - another 50 seconds pass
        fastForward(50);

        // when - user1 claims rewards
        TestUtils.callAs(user1, address(rewards), "claimAllRewards()");

        uint256 totalRewards = rewardToken.balanceOf(address(user1));

        // then - user1 should receive:
        // First 50 seconds with 1000 units (100% of pool): 50 * 900 = 45,000 CATA
        // Next 50 seconds with 600 units (still 100% of pool): 50 * 900 = 45,000 CATA
        // Total: 90,000 CATA
        uint256 expectedRewards = (50 * liquidityEmissionRate) + (50 * liquidityEmissionRate);
        require(totalRewards == expectedRewards, "User should receive correct rewards after withdrawal");

        // then - unclaimed rewards should be zero
        require(rewards.unclaimedRewards(address(user1)) == 0, "Unclaimed rewards should be zero");
    }

    // NOTE: Late joiner test removed - will revisit later

}
