// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract Describe_TokenPausable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardsToken;
    Token lpToken1;
    User user1;
    User user2;
    uint256 initLpTokensPerUser = 1000 * 1e18;

    RewardsChef chef;
    uint256 cataPerSecond;
    uint256 currentTimestamp;

    function beforeAll() {
        // Create test users
        user1 = new User();
        user2 = new User();

        // Create full Mercata infrastructure
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() {
        // Deploy a fresh test token for each test
        address tokenAddress = m.tokenFactory().createToken(
            "TestCATA",
            "Fresh CATA for each test",
            [], [], [], "TESTCATA", 0, 18
        );

        require(tokenAddress != address(0), "Token address is 0");
        rewardsToken = Token(tokenAddress);

        // Create LP token for staking
        address lpToken1Address = m.tokenFactory().createToken(
            "TestLP1",
            "Test LP Token 1",
            [], [], [], "TESTLP1", 0, 18
        );

        require(lpToken1Address != address(0), "LP Token address is 0");
        lpToken1 = Token(lpToken1Address);

        // Mint initLpTokensPerUser LP tokens to each user
        lpToken1.mint(address(user1), initLpTokensPerUser);
        lpToken1.mint(address(user2), initLpTokensPerUser);

	cataPerSecond = 1000;
        currentTimestamp = block.timestamp;

        // Use RewardsChef from Mercata and initialize it
        chef = m.rewardsChef();
        chef.initialize(tokenAddress, cataPerSecond);

        // Transfer ownership of the reward token to the chef so it can mint rewards
        Ownable(tokenAddress).transferOwnership(address(chef));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STAKE POOL MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_start_with_no_pools() {
        (address a, uint b, uint c, uint d) = chef.pools(0);
        require(a == address(0) && b == 0 && c == 0 && d == 0, "Pools list should be empty");
    }

    function it_should_allow_adding_new_pool() {
        // given
        uint256 allocationPoints = 1000;
        uint256 multiplier = 1;

        // when
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // then
        (address a, uint b, uint c, uint d) = chef.pools(1);
        require(a == address(0) && b == 0 && c == 0 && d == 0, "Pools list should have 1 pool");

        (a, b, c, d) = chef.pools(0);
        (uint st, uint bm) = chef.getPoolBonusPeriod(0, 0);
        PoolInfo pool1 = PoolInfo(a,b,c,d,[BonusPeriod(st, bm)]);
        require(pool1.lpToken == address(lpToken1), "LP token address should match");
        require(pool1.allocPoint == allocationPoints, "Allocation points should match");
        require(pool1.lastRewardTimestamp == currentTimestamp, "lastRewardTimestamp should be set to block.timestamp");
        require(pool1.accPerToken == 0, "Initial accPerToken should be 0");
        require(pool1.bonusPeriods.length == 1, "Should have one initial bonus period");
        require(pool1.bonusPeriods[0].startTimestamp == currentTimestamp, "Bonus period should start at currentTimestamp");
        require(pool1.bonusPeriods[0].bonusMultiplier == multiplier, "Bonus period multiplier should match");
        require(chef.totalAllocPoint() == allocationPoints, "Total allocation points should match");
    }

    function it_should_prevent_lp_token_being_same_as_reward_token() {
        // given
        uint256 allocationPoints = 1000;
        uint256 multiplier = 1;

        // when
        bool reverted = false;
        try chef.addPool(allocationPoints, address(rewardsToken), multiplier) {
            // If we get here, the call didn't revert (which is a bug)
            reverted = false;
        } catch {
            reverted = true;
        }
        //then - should revert when trying to add pool with reward token as LP token
        require(reverted, "Adding pool with LP token same as reward token should revert");
    }

    function it_should_prevent_adding_duplicate_pool() {
        // given
        uint256 allocationPoints = 1000;
        uint256 multiplier = 1;

        // given a pool already exists
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // when trying to add the same pool again
        bool reverted = false;
        try chef.addPool(allocationPoints, address(lpToken1), multiplier) {
            // If we get here, the call didn't revert (which is a bug)
            reverted = false;
        } catch {
            reverted = true;
        }

        // then - should revert when trying to add duplicate LP token
        require(reverted, "Adding duplicate LP token should revert");
    }

    function it_should_allow_updating_allocation_points() {
        // given
        uint256 initialAllocationPoints = 500;
        uint256 updatedAllocationPoints = 800;
        uint256 multiplier = 1;
        uint256 poolId = 0;

        chef.addPool(initialAllocationPoints, address(lpToken1), multiplier);

        // when
        chef.updateAllocationPoints(poolId, updatedAllocationPoints);

        // then
        (address a, uint b, uint c, uint d) = chef.pools(poolId);
        PoolInfo pool1 = PoolInfo(a,b,c,d,[]);
        require(pool1.allocPoint == updatedAllocationPoints, "Allocation points should be updated");
        require(chef.totalAllocPoint() == updatedAllocationPoints, "Total allocation points should be updated");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // USER INTERACTIONS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_user_to_deposit_lp_tokens() {
        // given
        uint256 allocationPoints = 100;
        uint256 multiplier = 1;
        uint256 poolId = 0;
        uint256 amount = 10;

        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // when
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, amount);

        // then
        require(ERC20(lpToken1).balanceOf(address(chef)) == amount,
		"Chef should have received the deposited LP tokens");
        require(ERC20(lpToken1).balanceOf(address(user1)) == (initLpTokensPerUser - amount),
		"User1 should not own LP token");
    }

    function it_should_allow_user_to_withdraw_lp_token() {
        // given
        uint256 allocationPoints = 100;
        uint256 multiplier = 1;
        uint256 poolId = 0;
        uint256 amount = 10;

        // given there is a pool
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // given user has deposited lp tokens
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, amount);

        // when
        TestUtils.callAs(user1, address(chef), "withdraw(uint256, uint256)", poolId, amount);

        // then
        require(ERC20(lpToken1).balanceOf(address(chef)) == 0,
		"Chef should not have the deposited LP tokens");
        require(ERC20(lpToken1).balanceOf(address(user1)) == initLpTokensPerUser,
		"User1 should have back his LP tokens");
    }

    function it_should_allow_emergency_withdraw_without_claiming_rewards() {
        // given
        uint256 allocationPoints = 100;
        uint256 multiplier = 1;
        uint256 poolId = 0;
        uint256 amount = 10 * 1e18;

        // given there is a pool
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // given user has deposited lp tokens
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, amount);

        // given time has passed so there are pending rewards
        fastForward(10);

        // Record balances before emergency withdraw
        uint256 userRewardBalanceBefore = ERC20(rewardsToken).balanceOf(address(user1));
        uint256 pendingRewards = chef.pendingCata(poolId, address(user1));

        // Verify there ARE rewards to forfeit
        require(pendingRewards > 0, "There should be pending rewards before emergency withdraw");

        // when - emergency withdraw
        TestUtils.callAs(user1, address(chef), "emergencyWithdraw(uint256)", poolId);

        // then - LP tokens are returned
        require(ERC20(lpToken1).balanceOf(address(chef)) == 0,
		"Chef should not have the deposited LP tokens");
        require(ERC20(lpToken1).balanceOf(address(user1)) == initLpTokensPerUser,
		"User1 should have all LP tokens back");

        // then - rewards are NOT transferred (forfeited)
        require(ERC20(rewardsToken).balanceOf(address(user1)) == userRewardBalanceBefore,
		"User should not receive rewards during emergency withdraw");

        // then - user info is reset
        uint256 userBalance = chef.getBalance(poolId, address(user1));
        require(userBalance == 0, "User balance should be reset to 0");
    }


    function it_should_update_accrued_rewards_for_pool() {
        uint256 allocationPoints = 100;
        uint256 multiplier = 1;
        uint256 poolId = 0;
        uint256 amount = 10 * 1e18;

        // given there is a pool
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // given user has deposited lp tokens
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, amount);

	// given 10 seconds has passed
	uint256 ten_seconds = 10;
	fastForward(10);

        // when
	chef.updatePool(poolId);

        // then
        (address a, uint b, uint c, uint d) = chef.pools(poolId);
        PoolInfo pool1 = PoolInfo(a,b,c,d,[]);
        uint256 lp1Supply = ERC20(lpToken1).balanceOf(address(chef));
        uint256 reward = ten_seconds * cataPerSecond;

	// then reward was minted
        require(ERC20(rewardsToken).balanceOf(address(chef)) == reward,
		"Chef should have minted reward to itself");

	// then accumulated reward per share is properly calculated
        uint256 expectedAccPerToken =
	    (reward * chef.PRECISION_MULTIPLIER()) / lp1Supply;
	require(expectedAccPerToken != 0, "expectedAccPerToken should not be zero");
        require(pool1.accPerToken == expectedAccPerToken, "accPerToken calculation mismatch");
    }

    function it_should_update_all_pools_when_mass_update_is_called() {
        // given - create two pools with different allocation points
        uint256 pool1AllocPoint = 100;
        uint256 pool2AllocPoint = 200;
        uint256 multiplier = 1;
        uint256 amount1 = 10 * 1e18;
        uint256 amount2 = 20 * 1e18;

        // Create second LP token
        address lpToken2Address = m.tokenFactory().createToken(
            "TestLP2",
            "Test LP Token 2",
            [], [], [], "TESTLP2", 0, 18
        );
        require(lpToken2Address != address(0), "LP Token 2 address is 0");
        Token lpToken2 = Token(lpToken2Address);

        // Mint LP tokens to users
        lpToken2.mint(address(user1), initLpTokensPerUser);

        // Add two pools
        chef.addPool(pool1AllocPoint, address(lpToken1), multiplier);
        chef.addPool(pool2AllocPoint, address(lpToken2), multiplier);

        // Users deposit into both pools
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount1);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", 0, amount1);

        TestUtils.callAs(user1, address(lpToken2), "approve(address, uint256)", address(chef), amount2);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", 1, amount2);

        // Record initial state
        (address lp1Before, uint alloc1Before, uint pool1LastRewardBefore, uint pool1AccPerTokenBefore) = chef.pools(0);
        (address lp2Before, uint alloc2Before, uint pool2LastRewardBefore, uint pool2AccPerTokenBefore) = chef.pools(1);

        // Fast forward time
        fastForward(10);

        // when - call massUpdatePools
        chef.massUpdatePools();

        // then - verify both pools were updated
        (address lp1After, uint alloc1After, uint pool1LastRewardAfter, uint pool1AccPerTokenAfter) = chef.pools(0);
        (address lp2After, uint alloc2After, uint pool2LastRewardAfter, uint pool2AccPerTokenAfter) = chef.pools(1);

        require(pool1LastRewardAfter > pool1LastRewardBefore, "Pool 1 lastRewardTimestamp should be updated");
        require(pool2LastRewardAfter > pool2LastRewardBefore, "Pool 2 lastRewardTimestamp should be updated");
        require(pool1AccPerTokenAfter > pool1AccPerTokenBefore, "Pool 1 accPerToken should be updated");
        require(pool2AccPerTokenAfter > pool2AccPerTokenBefore, "Pool 2 accPerToken should be updated");
    }

    function it_should_update_existing_pools_before_adding_new_pool() {
        // given - create first pool and deposit
        uint256 pool1AllocPoint = 100;
        uint256 multiplier = 1;
        uint256 amount1 = 10 * 1e18;

        chef.addPool(pool1AllocPoint, address(lpToken1), multiplier);

        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount1);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", 0, amount1);

        // Fast forward time so pool 0 has pending rewards
        fastForward(10);

        // Record pool 0 state before adding pool 1
        (address lp0, uint alloc0, uint pool0LastRewardBefore, uint pool0AccPerTokenBefore) = chef.pools(0);
        uint256 currentTime = block.timestamp;

        // Create second LP token
        address lpToken2Address = m.tokenFactory().createToken(
            "TestLP2",
            "Test LP Token 2",
            [], [], [], "TESTLP2", 0, 18
        );
        Token lpToken2 = Token(lpToken2Address);

        // when - add second pool (should update pool 0 first)
        chef.addPool(200, address(lpToken2), multiplier);

        // then - pool 0 should have been updated
        (address lp0After, uint alloc0After, uint pool0LastRewardAfter, uint pool0AccPerTokenAfter) = chef.pools(0);

        require(pool0LastRewardAfter == currentTime, "Pool 0 should be updated to current timestamp");
        require(pool0AccPerTokenAfter > pool0AccPerTokenBefore, "Pool 0 accPerToken should increase");
    }

    function it_should_update_all_pools_before_changing_allocation_points() {
        // given - create two pools with deposits
        uint256 multiplier = 1;
        uint256 amount = 10 * 1e18;

        // Create second LP token
        address lpToken2Address = m.tokenFactory().createToken(
            "TestLP2",
            "Test LP Token 2",
            [], [], [], "TESTLP2", 0, 18
        );
        Token lpToken2 = Token(lpToken2Address);
        lpToken2.mint(address(user1), initLpTokensPerUser);

        // Add two pools
        chef.addPool(100, address(lpToken1), multiplier);
        chef.addPool(200, address(lpToken2), multiplier);

        // Deposit into both pools
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", 0, amount);

        TestUtils.callAs(user1, address(lpToken2), "approve(address, uint256)", address(chef), amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", 1, amount);

        // Fast forward time
        fastForward(10);

        // Record state before updating allocation
        (address lp0, uint alloc0, uint pool0LastRewardBefore, uint pool0AccPerTokenBefore) = chef.pools(0);
        (address lp1, uint alloc1, uint pool1LastRewardBefore, uint pool1AccPerTokenBefore) = chef.pools(1);
        uint256 currentTime = block.timestamp;

        // when - update allocation points of pool 0
        chef.updateAllocationPoints(0, 300);

        // then - both pools should be updated
        (address lp0After, uint alloc0After, uint pool0LastRewardAfter, uint pool0AccPerTokenAfter) = chef.pools(0);
        (address lp1After, uint alloc1After, uint pool1LastRewardAfter, uint pool1AccPerTokenAfter) = chef.pools(1);

        require(pool0LastRewardAfter == currentTime, "Pool 0 should be updated to current timestamp");
        require(pool1LastRewardAfter == currentTime, "Pool 1 should be updated to current timestamp");
        require(pool0AccPerTokenAfter > pool0AccPerTokenBefore, "Pool 0 accPerToken should increase");
        require(pool1AccPerTokenAfter > pool1AccPerTokenBefore, "Pool 1 accPerToken should increase");
    }

    function it_should_account_for_old_rewards_before_updating_cata_per_second() {
        // given - initial cataPerSecond is 1000
        uint256 initialCataPerSecond = chef.cataPerSecond();
        require(initialCataPerSecond == 1000, "Initial cataPerSecond should be 1000");

        // given - add pool with 100 allocation points
        uint256 poolId = 0;
        uint256 depositAmount = 1000 * 1e18;
        chef.addPool(100, address(lpToken1), 1);

        // given - user1 deposits LP tokens
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), depositAmount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, depositAmount);

        // given - advance time by 10 seconds to accrue rewards at 1000 CATA/second
        fastForward(10);

        // when - update cataPerSecond to 2000
        chef.updateCataPerSecond(2000);

        // then - check that old rewards were accounted for
        // Expected: 10 seconds * 1000 CATA/second * (100 allocPoint / 100 totalAllocPoint) = 10000 CATA
        (address lp0, uint alloc0, uint lastReward0, uint accPerToken0) = chef.pools(0);
        uint256 expectedAccPerToken = (10000 * 1e18) / depositAmount;
        require(accPerToken0 == expectedAccPerToken, "Pool should have accrued rewards at old rate");

        // then - user should be able to claim the old rewards
        uint256 userBalanceBefore = ERC20(rewardsToken).balanceOf(address(user1));
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, 0);
        uint256 userBalanceAfter = ERC20(rewardsToken).balanceOf(address(user1));
        uint256 claimedRewards = userBalanceAfter - userBalanceBefore;
        require(claimedRewards == 10000, "User should receive rewards accrued at old rate");
    }

    function it_should_accrue_new_rewards_at_new_cata_per_second_rate() {
        // given - initial cataPerSecond is 1000
        uint256 initialCataPerSecond = chef.cataPerSecond();
        require(initialCataPerSecond == 1000, "Initial cataPerSecond should be 1000");

        // given - add pool with 100 allocation points
        uint256 poolId = 0;
        uint256 depositAmount = 1000 * 1e18;
        chef.addPool(100, address(lpToken1), 1);

        // given - user1 deposits LP tokens
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), depositAmount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, depositAmount);

        // given - advance time by 10 seconds at old rate
        fastForward(10);

        // given - claim rewards earned at old rate
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, 0);
        uint256 userBalanceAfterOldRewards = ERC20(rewardsToken).balanceOf(address(user1));

        // when - update cataPerSecond to 2000
        chef.updateCataPerSecond(2000);

        // when - advance time by 10 more seconds at new rate
        fastForward(10);

        // when - claim rewards earned at new rate
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", poolId, 0);
        uint256 userBalanceAfterNewRewards = ERC20(rewardsToken).balanceOf(address(user1));

        // then - new rewards should be calculated at 2000 CATA/second
        // Expected: 10 seconds * 2000 CATA/second * (100 allocPoint / 100 totalAllocPoint) = 20000 CATA
        uint256 newRewards = userBalanceAfterNewRewards - userBalanceAfterOldRewards;
        require(newRewards == 20000, "User should receive rewards accrued at new rate");
    }

    function it_should_update_cata_per_second_for_multiple_pools() {
        // given - add two pools with equal allocation points
        uint256 pool0Id = 0;
        uint256 pool1Id = 1;
        uint256 deposit0Amount = 1000 * 1e18;
        uint256 deposit1Amount = 500 * 1e18;

        chef.addPool(100, address(lpToken1), 1);

        // Create second LP token
        address lpToken2Address = m.tokenFactory().createToken(
            "TestLP2",
            "Test LP Token 2",
            [], [], [], "TESTLP2", 0, 18
        );
        Token lpToken2 = Token(lpToken2Address);
        lpToken2.mint(address(user2), initLpTokensPerUser);
        chef.addPool(100, address(lpToken2), 1);

        // given - users deposit to both pools
        TestUtils.callAs(user1, address(lpToken1), "approve(address, uint256)", address(chef), deposit0Amount);
        TestUtils.callAs(user1, address(chef), "deposit(uint256, uint256)", pool0Id, deposit0Amount);

        TestUtils.callAs(user2, address(lpToken2), "approve(address, uint256)", address(chef), deposit1Amount);
        TestUtils.callAs(user2, address(chef), "deposit(uint256, uint256)", pool1Id, deposit1Amount);

        // given - advance time by 10 seconds at 1000 CATA/second
        fastForward(10);

        // when - update cataPerSecond to 3000
        chef.updateCataPerSecond(3000);

        // then - both pools should have accrued rewards at old rate
        (address lp0, uint alloc0, uint lastReward0, uint accPerToken0) = chef.pools(0);
        (address lp1, uint alloc1, uint lastReward1, uint accPerToken1) = chef.pools(1);

        // Each pool gets 50% of rewards: 10 seconds * 1000 CATA/second * 0.5 = 5000 CATA per pool
        uint256 expectedAccPerToken0 = (5000 * 1e18) / deposit0Amount;
        uint256 expectedAccPerToken1 = (5000 * 1e18) / deposit1Amount;

        require(accPerToken0 == expectedAccPerToken0, "Pool 0 should have correct accPerToken at old rate");
        require(accPerToken1 == expectedAccPerToken1, "Pool 1 should have correct accPerToken at old rate");

        // when - advance time by 10 more seconds at new rate
        fastForward(10);

        // when - update pools to accrue new rewards
        chef.updatePool(0);
        chef.updatePool(1);

        // then - pools should accrue at new rate (3000 CATA/second)
        (lp0, alloc0, lastReward0, accPerToken0) = chef.pools(0);
        (lp1, alloc1, lastReward1, accPerToken1) = chef.pools(1);

        // Each pool now gets: 10 seconds * 3000 CATA/second * 0.5 = 15000 CATA per pool
        uint256 newAccPerToken0 = expectedAccPerToken0 + ((15000 * 1e18) / deposit0Amount);
        uint256 newAccPerToken1 = expectedAccPerToken1 + ((15000 * 1e18) / deposit1Amount);

        require(accPerToken0 == newAccPerToken0, "Pool 0 should have correct accPerToken at new rate");
        require(accPerToken1 == newAccPerToken1, "Pool 1 should have correct accPerToken at new rate");
    }

}
