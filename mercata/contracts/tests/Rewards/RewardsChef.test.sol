import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../MockTimeProvider.sol";

contract Describe_TokenPausable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardsToken;
    Token lpToken1;
    User user1;
    User user2;
    uint256 initLpTokensPerUser = 1000;

    RewardsChef chef;
    MockTimeProvider mockTime;
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

        // Create mock time provider
        mockTime = new MockTimeProvider();

        chef = new RewardsChef(address(this), tokenAddress, cataPerSecond, address(mockTime));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STAKE POOL MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_start_with_no_pools() {
        require(chef.pools().length == 0, "Pools list should be empty");
    }

    function it_should_allow_adding_new_pool() {
        // given
        uint256 allocationPoints = 1000;
        uint256 multiplier = 1;

        // when
        chef.addPool(allocationPoints, address(lpToken1), multiplier);

        // then
        require(chef.pools().length == 1, "Pools list should have 1 pool");

        PoolInfo pool1 = chef.pools()[0];
        require(pool1.lpToken == address(lpToken1), "LP token address should match");
        require(pool1.allocPoint == allocationPoints, "Allocation points should match");
        require(pool1.lastRewardTimestamp == currentTimestamp, "lastRewardTimestamp should be set to block.timestamp");
        require(pool1.accPerToken == 0, "Initial accPerToken should be 0");
        require(pool1.bonusPeriods.length == 1, "Should have one initial bonus period");
        require(pool1.bonusPeriods[0].startTimestamp == currentTimestamp, "Bonus period should start at currentTimestamp");
        require(pool1.bonusPeriods[0].bonusMultiplier == multiplier, "Bonus period multiplier should match");
        require(chef.totalAllocPoint() == allocationPoints, "Total allocation points should match");
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
        PoolInfo pool1 = chef.pools()[poolId];
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
}
