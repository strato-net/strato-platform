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

        // Use Rewards from Mercata
        rewards = m.rewards();

        // Whitelist test contract to transfer ownership via adminRegistry voting
        m.adminRegistry().castVoteOnIssue(address(rewards), "transferOwnership", address(this));

        // Transfer ownership to test contract (now whitelisted)
        Ownable(address(rewards)).transferOwnership(address(this));

        // Initialize Rewards contract (now that we own it)
        rewards.initialize(tokenAddress);

        // Add activities - test contract is the allowed caller (simulating the pool)
        rewards.addActivity(liquidityActivityId, "Lending Pool Liquidity", liquidityEmissionRate, address(this));
        rewards.addActivity(borrowActivityId, "Lending Pool Borrows", borrowEmissionRate, address(this));

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

}
