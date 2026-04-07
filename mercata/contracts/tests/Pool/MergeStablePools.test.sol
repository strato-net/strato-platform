import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_MergeStablePools is Authorizable {

    Mercata m;
    string[] emptyArray;
    User user1;
    User user2;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        user1 = new User();
        user2 = new User();
    }

    // ============ HELPERS ============

    function _createToken(string name, string symbol) internal returns (address) {
        address tokenAddr = m.tokenFactory().createToken(
            name, "Test Token", emptyArray, emptyArray, emptyArray, symbol, 0, 18
        );
        Token(tokenAddr).setStatus(2); // ACTIVE
        return tokenAddr;
    }

    function _createAndSetupStablePool(address tokenA, address tokenB) internal returns (address) {
        fastForward(100);
        address poolAddr = m.poolFactory().createStablePool(tokenA, tokenB);
        Token lpToken = StablePool(poolAddr).lpToken();
        AdminRegistry ar = m.adminRegistry();
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(lpToken), "mint", poolAddr);
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(lpToken), "burn", poolAddr);
        return poolAddr;
    }

    function _whitelistPool(address poolAddr) internal {
        Token lpToken = StablePool(poolAddr).lpToken();
        AdminRegistry ar = m.adminRegistry();
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(lpToken), "mint", poolAddr);
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(lpToken), "burn", poolAddr);
    }

    function _addLiquidity(address poolAddr, address tokenA, address tokenB, uint256 amount) internal {
        Token(tokenA).mint(address(this), amount);
        Token(tokenB).mint(address(this), amount);
        ERC20(tokenA).approve(poolAddr, amount);
        ERC20(tokenB).approve(poolAddr, amount);
        StablePool(poolAddr).addLiquidityGeneral([amount, amount], 1, address(this));
    }

    function _addLiquidityAsUser(User user, address poolAddr, address tokenA, address tokenB, uint256 amount) internal {
        Token(tokenA).mint(address(user), amount);
        Token(tokenB).mint(address(user), amount);
        user.do(tokenA, "approve", poolAddr, amount);
        user.do(tokenB, "approve", poolAddr, amount);
        user.do(poolAddr, "addLiquidityGeneral", [amount, amount], 1, address(user));
    }

    // ============ TESTS ============

    /// @notice Two pools with non-overlapping tokens are merged; all token balances move to the new pool
    function it_merges_two_pools_and_transfers_balances() {
        address tokenA = _createToken("USDC", "USDC");
        address tokenB = _createToken("USDT", "USDT");
        address tokenC = _createToken("DAI", "DAI");
        address tokenD = _createToken("FRAX", "FRAX");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        uint256 amount = 1000e18;
        _addLiquidity(pool1, tokenA, tokenB, amount);
        _addLiquidity(pool2, tokenC, tokenD, amount);

        // Merge
        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(this), address(this)],
            [uint(1), uint(1)]
        );

        // Old pools are drained
        require(ERC20(tokenA).balanceOf(pool1) == 0, "Pool1 tokenA should be 0");
        require(ERC20(tokenB).balanceOf(pool1) == 0, "Pool1 tokenB should be 0");
        require(ERC20(tokenC).balanceOf(pool2) == 0, "Pool2 tokenC should be 0");
        require(ERC20(tokenD).balanceOf(pool2) == 0, "Pool2 tokenD should be 0");

        // New pool has all tokens
        require(ERC20(tokenA).balanceOf(newPool) == amount, "New pool should have tokenA");
        require(ERC20(tokenB).balanceOf(newPool) == amount, "New pool should have tokenB");
        require(ERC20(tokenC).balanceOf(newPool) == amount, "New pool should have tokenC");
        require(ERC20(tokenD).balanceOf(newPool) == amount, "New pool should have tokenD");

        // Holder received new LP tokens
        require(StablePool(newPool).lpToken().balanceOf(address(this)) > 0, "Should have new LP tokens");

        // New pool has 4 coins
        require(StablePool(newPool).getNumCoins() == 4, "New pool should have 4 coins");
    }

    /// @notice Two pools sharing a token; the shared token's balance is summed in the new pool
    function it_merges_pools_with_overlapping_tokens() {
        address tokenA = _createToken("USDC2", "USDC2");
        address tokenB = _createToken("USDT2", "USDT2");
        address tokenC = _createToken("DAI2", "DAI2");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenA, tokenC);

        uint256 amount = 1000e18;
        _addLiquidity(pool1, tokenA, tokenB, amount);
        _addLiquidity(pool2, tokenA, tokenC, amount);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(this), address(this)],
            [uint(1), uint(1)]
        );

        // Shared tokenA is combined
        require(ERC20(tokenA).balanceOf(newPool) == 2 * amount, "New pool should have 2x tokenA");
        require(ERC20(tokenB).balanceOf(newPool) == amount, "New pool should have tokenB");
        require(ERC20(tokenC).balanceOf(newPool) == amount, "New pool should have tokenC");
        require(StablePool(newPool).getNumCoins() == 3, "New pool should have 3 coins");
    }

    /// @notice Two users each provide liquidity to separate pools; after merge both hold new LP tokens
    function it_distributes_lp_proportionally_to_multiple_holders() {
        address tokenA = _createToken("USDC3", "USDC3");
        address tokenB = _createToken("USDT3", "USDT3");
        address tokenC = _createToken("DAI3", "DAI3");
        address tokenD = _createToken("FRAX3", "FRAX3");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        uint256 amount = 1000e18;
        _addLiquidityAsUser(user1, pool1, tokenA, tokenB, amount);
        _addLiquidityAsUser(user2, pool2, tokenC, tokenD, amount);

        require(StablePool(pool1).lpToken().balanceOf(address(user1)) > 0, "User1 should have pool1 LP");
        require(StablePool(pool2).lpToken().balanceOf(address(user2)) > 0, "User2 should have pool2 LP");

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(user1), address(user2)],
            [uint(1), uint(1)]
        );

        Token newLP = StablePool(newPool).lpToken();
        uint256 user1NewLP = newLP.balanceOf(address(user1));
        uint256 user2NewLP = newLP.balanceOf(address(user2));

        require(user1NewLP > 0, "User1 should have new LP tokens");
        require(user2NewLP > 0, "User2 should have new LP tokens");

        // Both pools had equal value, so LP allocations should be approximately equal
        uint256 diff = user1NewLP > user2NewLP ? user1NewLP - user2NewLP : user2NewLP - user1NewLP;
        uint256 avg = (user1NewLP + user2NewLP) / 2;
        require(diff * 100 <= avg, "LP distribution should be approximately equal (within 1%)");
    }

    /// @notice Two users in the same pool; after merge both keep proportional shares
    function it_distributes_lp_to_multiple_holders_in_same_pool() {
        address tokenA = _createToken("USDC4a", "USDC4a");
        address tokenB = _createToken("USDT4a", "USDT4a");
        address tokenC = _createToken("DAI4a", "DAI4a");
        address tokenD = _createToken("FRAX4a", "FRAX4a");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        // User1 adds 1000, user2 adds 2000 to pool1
        _addLiquidityAsUser(user1, pool1, tokenA, tokenB, 1000e18);
        _addLiquidityAsUser(user2, pool1, tokenA, tokenB, 2000e18);

        // This contract adds 3000 to pool2 (same total value as pool1)
        _addLiquidity(pool2, tokenC, tokenD, 3000e18);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(user1), address(user2), address(this)],
            [uint(2), uint(1)]
        );

        Token newLP = StablePool(newPool).lpToken();

        // User2 deposited 2x what user1 deposited in pool1, so user2 should get ~2x the LP
        uint256 user1NewLP = newLP.balanceOf(address(user1));
        uint256 user2NewLP = newLP.balanceOf(address(user2));

        require(user1NewLP > 0, "User1 should have new LP");
        require(user2NewLP > 0, "User2 should have new LP");

        // user2NewLP / user1NewLP should be approximately 2
        // Check: user2NewLP * 100 is within 1% of user1NewLP * 200
        uint256 expected2x = user1NewLP * 2;
        uint256 diffRatio = user2NewLP > expected2x ? user2NewLP - expected2x : expected2x - user2NewLP;
        require(diffRatio * 100 <= expected2x, "User2 should have ~2x user1's LP (within 1%)");
    }

    /// @notice Sole LP holder withdraws from merged pool and gets back approximately the deposited value
    function it_preserves_value_for_lp_holders_after_merge() {
        address tokenA = _createToken("USDC5", "USDC5");
        address tokenB = _createToken("USDT5", "USDT5");
        address tokenC = _createToken("DAI5", "DAI5");
        address tokenD = _createToken("FRAX5", "FRAX5");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        uint256 amount = 1000e18;
        _addLiquidity(pool1, tokenA, tokenB, amount);
        _addLiquidity(pool2, tokenC, tokenD, amount);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(this), address(this)],
            [uint(1), uint(1)]
        );

        // Whitelist new pool so it can burn LP tokens on withdrawal
        _whitelistPool(newPool);

        // Withdraw all liquidity
        StablePool newSP = StablePool(newPool);
        uint256 lpBalance = newSP.lpToken().balanceOf(address(this));
        require(lpBalance > 0, "Should have LP tokens to withdraw");

        uint[] minAmounts = [uint(0), uint(0), uint(0), uint(0)];
        newSP.removeLiquidityGeneral(lpBalance, minAmounts, address(this), false);

        // Verify we got back approximately the deposited amounts (within 0.1%)
        uint256 tolerance = amount / 1000;
        require(ERC20(tokenA).balanceOf(address(this)) >= amount - tolerance, "TokenA withdrawal too low");
        require(ERC20(tokenB).balanceOf(address(this)) >= amount - tolerance, "TokenB withdrawal too low");
        require(ERC20(tokenC).balanceOf(address(this)) >= amount - tolerance, "TokenC withdrawal too low");
        require(ERC20(tokenD).balanceOf(address(this)) >= amount - tolerance, "TokenD withdrawal too low");
    }

    /// @notice Two users withdraw from merged pool and each gets back approximately their deposited value
    function it_preserves_value_for_multiple_holders_after_merge() {
        address tokenA = _createToken("USDC6", "USDC6");
        address tokenB = _createToken("USDT6", "USDT6");
        address tokenC = _createToken("DAI6", "DAI6");
        address tokenD = _createToken("FRAX6", "FRAX6");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        uint256 amount = 1000e18;
        _addLiquidityAsUser(user1, pool1, tokenA, tokenB, amount);
        _addLiquidityAsUser(user2, pool2, tokenC, tokenD, amount);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(user1), address(user2)],
            [uint(1), uint(1)]
        );

        _whitelistPool(newPool);

        StablePool newSP = StablePool(newPool);
        uint[] minAmounts = [uint(0), uint(0), uint(0), uint(0)];

        // User1 withdraws
        uint256 user1LP = newSP.lpToken().balanceOf(address(user1));
        require(user1LP > 0, "User1 should have LP tokens");
        user1.do(newPool, "removeLiquidityGeneral", user1LP, minAmounts, address(user1), false);

        // User2 withdraws
        uint256 user2LP = newSP.lpToken().balanceOf(address(user2));
        require(user2LP > 0, "User2 should have LP tokens");
        user2.do(newPool, "removeLiquidityGeneral", user2LP, minAmounts, address(user2), false);

        // Each user should get back a share of all 4 tokens summing to ~2000e18 total value
        uint256 user1Total = ERC20(tokenA).balanceOf(address(user1))
            + ERC20(tokenB).balanceOf(address(user1))
            + ERC20(tokenC).balanceOf(address(user1))
            + ERC20(tokenD).balanceOf(address(user1));

        uint256 user2Total = ERC20(tokenA).balanceOf(address(user2))
            + ERC20(tokenB).balanceOf(address(user2))
            + ERC20(tokenC).balanceOf(address(user2))
            + ERC20(tokenD).balanceOf(address(user2));

        // Each user deposited 2000e18 total (1000 of each token).
        // After merge into a 4-token pool, their share is 50% of each token.
        // Total withdrawn value per user should be ~2000e18 (within 1%)
        uint256 depositedPerUser = 2 * amount;
        uint256 tolerance = depositedPerUser / 100;
        require(user1Total >= depositedPerUser - tolerance, "User1 total withdrawal too low");
        require(user2Total >= depositedPerUser - tolerance, "User2 total withdrawal too low");
    }

    /// @notice Pools mapping is updated: old pairs cleared, all new pairs registered
    function it_updates_pools_mapping_after_merge() {
        address tokenA = _createToken("USDC7", "USDC7");
        address tokenB = _createToken("USDT7", "USDT7");
        address tokenC = _createToken("DAI7", "DAI7");
        address tokenD = _createToken("FRAX7", "FRAX7");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        // Verify old registrations
        require(m.poolFactory().pools(tokenA, tokenB) == pool1, "Pool1 should be registered A-B");
        require(m.poolFactory().pools(tokenB, tokenA) == pool1, "Pool1 should be registered B-A");
        require(m.poolFactory().pools(tokenC, tokenD) == pool2, "Pool2 should be registered C-D");
        require(m.poolFactory().pools(tokenD, tokenC) == pool2, "Pool2 should be registered D-C");

        uint256 amount = 1000e18;
        _addLiquidity(pool1, tokenA, tokenB, amount);
        _addLiquidity(pool2, tokenC, tokenD, amount);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(this), address(this)],
            [uint(1), uint(1)]
        );

        // Old pool entries should be replaced by new pool
        require(m.poolFactory().pools(tokenA, tokenB) == newPool, "New pool should be registered A-B");
        require(m.poolFactory().pools(tokenB, tokenA) == newPool, "New pool should be registered B-A");
        require(m.poolFactory().pools(tokenC, tokenD) == newPool, "New pool should be registered C-D");
        require(m.poolFactory().pools(tokenD, tokenC) == newPool, "New pool should be registered D-C");

        // Cross-pair registrations should exist
        require(m.poolFactory().pools(tokenA, tokenC) == newPool, "New pool should be registered A-C");
        require(m.poolFactory().pools(tokenC, tokenA) == newPool, "New pool should be registered C-A");
        require(m.poolFactory().pools(tokenA, tokenD) == newPool, "New pool should be registered A-D");
        require(m.poolFactory().pools(tokenD, tokenA) == newPool, "New pool should be registered D-A");
        require(m.poolFactory().pools(tokenB, tokenC) == newPool, "New pool should be registered B-C");
        require(m.poolFactory().pools(tokenC, tokenB) == newPool, "New pool should be registered C-B");
        require(m.poolFactory().pools(tokenB, tokenD) == newPool, "New pool should be registered B-D");
        require(m.poolFactory().pools(tokenD, tokenB) == newPool, "New pool should be registered D-B");
    }

    /// @notice Pools with unequal liquidity: LP allocation reflects value ratio
    function it_handles_pools_with_unequal_liquidity() {
        address tokenA = _createToken("USDC8", "USDC8");
        address tokenB = _createToken("USDT8", "USDT8");
        address tokenC = _createToken("DAI8", "DAI8");
        address tokenD = _createToken("FRAX8", "FRAX8");

        address pool1 = _createAndSetupStablePool(tokenA, tokenB);
        address pool2 = _createAndSetupStablePool(tokenC, tokenD);

        // Pool1 gets 1000, pool2 gets 3000 (3x the value)
        _addLiquidityAsUser(user1, pool1, tokenA, tokenB, 1000e18);
        _addLiquidityAsUser(user2, pool2, tokenC, tokenD, 3000e18);

        address newPool = m.poolFactory().mergeStablePools(
            [pool1, pool2],
            [address(user1), address(user2)],
            [uint(1), uint(1)]
        );

        Token newLP = StablePool(newPool).lpToken();
        uint256 user1NewLP = newLP.balanceOf(address(user1));
        uint256 user2NewLP = newLP.balanceOf(address(user2));

        require(user1NewLP > 0, "User1 should have LP");
        require(user2NewLP > 0, "User2 should have LP");

        // User2 contributed 3x the value, so should have ~3x the LP tokens
        uint256 expected3x = user1NewLP * 3;
        uint256 diff = user2NewLP > expected3x ? user2NewLP - expected3x : expected3x - user2NewLP;
        require(diff * 100 <= expected3x, "User2 should have ~3x user1's LP (within 1%)");

        // Verify value preservation by withdrawal
        _whitelistPool(newPool);
        StablePool newSP = StablePool(newPool);
        uint[] minAmounts = [uint(0), uint(0), uint(0), uint(0)];

        user1.do(newPool, "removeLiquidityGeneral", user1NewLP, minAmounts, address(user1), false);
        user2.do(newPool, "removeLiquidityGeneral", user2NewLP, minAmounts, address(user2), false);

        // User1 deposited 2000e18 total, user2 deposited 6000e18 total
        uint256 user1Total = ERC20(tokenA).balanceOf(address(user1))
            + ERC20(tokenB).balanceOf(address(user1))
            + ERC20(tokenC).balanceOf(address(user1))
            + ERC20(tokenD).balanceOf(address(user1));

        uint256 user2Total = ERC20(tokenA).balanceOf(address(user2))
            + ERC20(tokenB).balanceOf(address(user2))
            + ERC20(tokenC).balanceOf(address(user2))
            + ERC20(tokenD).balanceOf(address(user2));

        uint256 tolerance1 = 2000e18 / 100;
        uint256 tolerance2 = 6000e18 / 100;
        require(user1Total >= 2000e18 - tolerance1, "User1 total withdrawal too low");
        require(user2Total >= 6000e18 - tolerance2, "User2 total withdrawal too low");
    }
}
