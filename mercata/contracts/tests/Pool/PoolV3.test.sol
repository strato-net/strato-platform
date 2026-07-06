import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_PoolV3 is Authorizable {

    Mercata m;
    string[] emptyArray;

    PoolV3Factory factory;
    address tokenAAddress;
    address tokenBAddress;
    address poolAddress;
    PoolV3 pool;

    uint constant WAD = 1e18;
    uint constant DEADLINE_OFFSET = 3600;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
        emptyArray = new string[](0);
    }

    function beforeEach() {
        // Create fresh tokens for each test
        tokenAAddress = m.tokenFactory().createToken(
            "Token A", "Test Token A", emptyArray, emptyArray, emptyArray, "TKA", 10000000e18, 18
        );
        tokenBAddress = m.tokenFactory().createToken(
            "Token B", "Test Token B", emptyArray, emptyArray, emptyArray, "TKB", 10000000e18, 18
        );

        // Activate tokens
        Token(tokenAAddress).setStatus(2); // ACTIVE
        Token(tokenBAddress).setStatus(2); // ACTIVE

        // Mint tokens to test contract
        Token(tokenAAddress).mint(address(this), 100000000e18);
        Token(tokenBAddress).mint(address(this), 100000000e18);

        // Create standalone V3 factory owned by this test contract
        factory = new PoolV3Factory(address(this));
        factory.initialize(address(m.tokenFactory()), address(m.feeCollector()));

        // Create pool at the 30bps tier with initial price 1.0 (sqrtPrice = 1e18, tick 0)
        poolAddress = factory.createPoolV3(tokenAAddress, tokenBAddress, 30, WAD);
        pool = PoolV3(poolAddress);
    }

    // ============ HELPERS ============

    function _approveBoth(uint amountA, uint amountB) internal {
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
    }

    function _mintRange(int tickLower, int tickUpper, uint liquidityAmount) internal returns (uint, uint) {
        _approveBoth(100000000e18, 100000000e18);
        return pool.mint(tickLower, tickUpper, liquidityAmount, 100000000e18, 100000000e18, block.timestamp + DEADLINE_OFFSET);
    }

    function _swap(bool isAToB, uint amountIn) internal returns (uint) {
        address tokenIn = isAToB ? tokenAAddress : tokenBAddress;
        require(ERC20(tokenIn).approve(address(pool), amountIn), "Swap approval failed");
        return pool.swap(isAToB, amountIn, 1, 0, block.timestamp + DEADLINE_OFFSET);
    }

    /// @dev Create a user with token balances and pool approvals for both tokens
    function _newUser() internal returns (User) {
        User u = new User();
        Token(tokenAAddress).mint(address(u), 100000000e18);
        Token(tokenBAddress).mint(address(u), 100000000e18);
        u.do(tokenAAddress, "approve", poolAddress, 100000000e18);
        u.do(tokenBAddress, "approve", poolAddress, 100000000e18);
        return u;
    }

    function _userMint(User u, int tickLower, int tickUpper, uint liquidityAmount) internal {
        u.do(poolAddress, "mint", tickLower, tickUpper, liquidityAmount, 100000000e18, 100000000e18, block.timestamp + DEADLINE_OFFSET);
    }

    function _userPoke(User u, int tickLower, int tickUpper) internal {
        u.do(poolAddress, "burn", tickLower, tickUpper, 0, block.timestamp + DEADLINE_OFFSET);
    }

    // ============ FACTORY TESTS ============

    function it_factory_creates_pool_successfully() {
        require(address(pool) != address(0), "Pool should be created");
        require(pool.feeBps() == 30, "Fee should be 30 bps");
        require(pool.tickSpacing() == 60, "Tick spacing should be 60");
        require(pool.sqrtPriceWad() == WAD, "Initial sqrt price should be 1e18");
        require(pool.currentTick() == 0, "Initial tick should be 0");
        require(factory.pools(tokenAAddress, tokenBAddress, 30) == poolAddress, "Registry A->B missing");
        require(factory.pools(tokenBAddress, tokenAAddress, 30) == poolAddress, "Registry B->A missing");
    }

    function it_factory_rejects_duplicate_pool() {
        bool thrown = false;
        try {
            factory.createPoolV3(tokenAAddress, tokenBAddress, 30, WAD);
        } catch {
            thrown = true;
        }
        require(thrown, "Duplicate pool should revert");
    }

    function it_factory_rejects_unknown_fee_tier() {
        bool thrown = false;
        try {
            factory.createPoolV3(tokenAAddress, tokenBAddress, 77, WAD);
        } catch {
            thrown = true;
        }
        require(thrown, "Unknown fee tier should revert");
    }

    function it_factory_allows_same_pair_different_tier() {
        address pool2 = factory.createPoolV3(tokenAAddress, tokenBAddress, 100, WAD);
        require(pool2 != address(0) && pool2 != poolAddress, "Second tier pool should be distinct");
    }

    // ============ TICK MATH TESTS ============

    function it_tick_math_exact_values() {
        // sqrt(1.0001^0) == 1
        require(pool.getSqrtPriceAtTick(0) == WAD, "Tick 0 should be 1e18");
        // sqrt(1.0001^2) == 1.0001 exactly
        require(pool.getSqrtPriceAtTick(2) == 1000100000000000000, "Tick 2 should be 1.0001e18");
        // Negative tick is the reciprocal
        uint p = pool.getSqrtPriceAtTick(100);
        uint n = pool.getSqrtPriceAtTick(-100);
        uint product = (p * n) / WAD;
        require(product >= WAD - 2 && product <= WAD + 2, "p(t) * p(-t) should be ~1");
        // Monotonicity
        require(pool.getSqrtPriceAtTick(1) > WAD, "Tick 1 should be > 1e18");
        require(pool.getSqrtPriceAtTick(-1) < WAD, "Tick -1 should be < 1e18");
    }

    function property_tick_sqrt_price_roundtrip(uint seed) {
        int tick = int(seed % 887273) - 443636; // full [-443636, 443636]
        uint sq = pool.getSqrtPriceAtTick(tick);
        int back = pool.getTickAtSqrtPrice(sq);
        require(back == tick, "Roundtrip failed for tick " + string(tick) + " got " + string(back));
    }

    // ============ MINT TESTS ============

    function it_mint_in_range_takes_both_tokens() {
        (uint amountA, uint amountB) = _mintRange(-600, 600, 1000e18);
        // Symmetric range around price 1.0: amounts should be ~equal and ~2.955% of L
        require(amountA > 29e18 && amountA < 30e18, "amountA out of expected range: " + string(amountA));
        require(amountB > 29e18 && amountB < 30e18, "amountB out of expected range: " + string(amountB));
        require(pool.liquidity() == 1000e18, "Pool liquidity should be active");
        require(pool.tokenABalance() == amountA, "tokenABalance mismatch");
        require(pool.tokenBBalance() == amountB, "tokenBBalance mismatch");
    }

    function it_mint_above_range_takes_only_tokenA() {
        // Range fully above current price: only tokenA needed
        (uint amountA, uint amountB) = _mintRange(600, 1200, 1000e18);
        require(amountA > 0, "Should need tokenA");
        require(amountB == 0, "Should not need tokenB");
        require(pool.liquidity() == 0, "Out-of-range liquidity should not be active");
    }

    function it_mint_below_range_takes_only_tokenB() {
        (uint amountA, uint amountB) = _mintRange(-1200, -600, 1000e18);
        require(amountA == 0, "Should not need tokenA");
        require(amountB > 0, "Should need tokenB");
        require(pool.liquidity() == 0, "Out-of-range liquidity should not be active");
    }

    function it_mint_rejects_bad_ticks() {
        _approveBoth(1000e18, 1000e18);
        bool thrown = false;
        try {
            // 61 is not a multiple of tickSpacing 60
            pool.mint(-61, 61, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Off-spacing ticks should revert");

        thrown = false;
        try {
            pool.mint(600, 600, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Empty range should revert");
    }

    // ============ SWAP TESTS ============

    function it_swap_within_range() {
        _mintRange(-6000, 6000, 100000e18);

        uint amountIn = 10e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountIn), "Approval failed");
        uint balBBefore = ERC20(tokenBAddress).balanceOf(address(this));
        uint amountOut = pool.swap(true, amountIn, 1, 0, block.timestamp + DEADLINE_OFFSET);

        // Price ~1.0, fee 0.3%: expect slightly under 9.97e18 out
        require(amountOut > 99e17 && amountOut < 997e16, "Unexpected output: " + string(amountOut));
        require(ERC20(tokenBAddress).balanceOf(address(this)) == balBBefore + amountOut, "Output not received");
        require(pool.sqrtPriceWad() < WAD, "A->B swap should move price down");
        require(pool.currentTick() < 0, "A->B swap should move tick down");
    }

    function it_swap_both_directions() {
        _mintRange(-6000, 6000, 100000e18);

        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        uint out1 = pool.swap(true, 10e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        require(out1 > 0, "A->B swap failed");

        require(ERC20(tokenBAddress).approve(address(pool), 5e18), "Approval failed");
        uint out2 = pool.swap(false, 5e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        require(out2 > 0, "B->A swap failed");
        require(pool.sqrtPriceWad() < WAD, "Price should still be below start after partial reversal");
    }

    function it_swap_sends_protocol_fee_to_collector() {
        _mintRange(-6000, 6000, 100000e18);

        address collector = factory.feeCollector();
        uint collectorBefore = ERC20(tokenAAddress).balanceOf(collector);

        uint amountIn = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountIn), "Approval failed");
        pool.swap(true, amountIn, 1, 0, block.timestamp + DEADLINE_OFFSET);

        // Total fee = 0.3% of 100e18 = 0.3e18; protocol share = 30% of that = 0.09e18
        uint collectorAfter = ERC20(tokenAAddress).balanceOf(collector);
        uint protocolFee = collectorAfter - collectorBefore;
        require(protocolFee > 89e15 && protocolFee <= 9e16, "Unexpected protocol fee: " + string(protocolFee));
    }

    function it_swap_crosses_tick_and_drops_liquidity() {
        // Wide backstop position + narrow position around current price
        _mintRange(-6000, 6000, 50000e18);
        _mintRange(-60, 60, 50000e18);
        require(pool.liquidity() == 100000e18, "Both positions should be active");

        // Swap enough to push price below tick -60 (narrow range exits)
        uint amountIn = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountIn), "Approval failed");
        uint amountOut = pool.swap(true, amountIn, 1, 0, block.timestamp + DEADLINE_OFFSET);

        require(amountOut > 0, "Cross-tick swap failed");
        require(pool.currentTick() < -60, "Price should have crossed below -60");
        require(pool.liquidity() == 50000e18, "Only the wide position should remain active");
    }

    function it_swap_respects_price_limit() {
        _mintRange(-6000, 6000, 100000e18);

        // Limit barely below current price: swap should stop there, consuming only part of input
        uint limit = pool.getSqrtPriceAtTick(-10);
        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));
        require(ERC20(tokenAAddress).approve(address(pool), 10000e18), "Approval failed");
        pool.swap(true, 10000e18, 1, limit, block.timestamp + DEADLINE_OFFSET);

        require(pool.sqrtPriceWad() == limit, "Price should stop at the limit");
        uint consumed = balABefore - ERC20(tokenAAddress).balanceOf(address(this));
        require(consumed < 10000e18, "Should not consume full input when limit hit");
    }

    function it_swap_reverts_when_no_liquidity() {
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Swap with no liquidity should revert");
    }

    function it_swap_slippage_check() {
        _mintRange(-6000, 6000, 100000e18);
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 100e18, 0, block.timestamp + DEADLINE_OFFSET); // impossible minOut
        } catch {
            thrown = true;
        }
        require(thrown, "Slippage check should revert");
    }

    // ============ FEE / POSITION TESTS ============

    function it_lp_fees_accrue_and_collect() {
        _mintRange(-6000, 6000, 100000e18);

        uint amountIn = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountIn), "Approval failed");
        pool.swap(true, amountIn, 1, 0, block.timestamp + DEADLINE_OFFSET);

        // Poke (burn 0) to accrue fees to the position
        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (uint posLiquidity, uint owedA, uint owedB) = pool.getPosition(address(this), -6000, 6000);
        require(posLiquidity == 100000e18, "Position liquidity wrong");
        // LP fee = 0.3% * 70% of 100e18 = 0.21e18
        require(owedA > 2e17 && owedA <= 21e16, "Unexpected LP fee owed: " + string(owedA));
        require(owedB == 0, "No tokenB fees expected");

        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));
        (uint gotA, uint gotB) = pool.collect(-6000, 6000, 1000000e18, 1000000e18);
        require(gotA == owedA, "Collected amount mismatch");
        require(gotB == 0, "Unexpected tokenB collected");
        require(ERC20(tokenAAddress).balanceOf(address(this)) == balABefore + gotA, "Fees not received");
    }

    function it_out_of_range_position_earns_no_fees() {
        _mintRange(-6000, 6000, 100000e18);
        _mintRange(6000, 12000, 100000e18); // far above price, never in range

        require(ERC20(tokenAAddress).approve(address(pool), 100e18), "Approval failed");
        pool.swap(true, 100e18, 1, 0, block.timestamp + DEADLINE_OFFSET);

        pool.burn(6000, 12000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, uint owedB) = pool.getPosition(address(this), 6000, 12000);
        require(owedA == 0 && owedB == 0, "Out-of-range position should earn nothing");
    }

    function it_burn_and_collect_full_exit() {
        (uint depositedA, uint depositedB) = _mintRange(-600, 600, 1000e18);

        pool.burn(-600, 600, 1000e18, block.timestamp + DEADLINE_OFFSET);
        (uint posLiquidity, uint owedA, uint owedB) = pool.getPosition(address(this), -600, 600);
        require(posLiquidity == 0, "Position should be empty");
        // Rounding favors the pool: owed <= deposited, within a couple wei
        require(owedA <= depositedA && depositedA - owedA <= 2, "TokenA principal mismatch");
        require(owedB <= depositedB && depositedB - owedB <= 2, "TokenB principal mismatch");
        require(pool.liquidity() == 0, "Pool liquidity should be zero");

        (uint gotA, uint gotB) = pool.collect(-600, 600, 1000000e18, 1000000e18);
        require(gotA == owedA && gotB == owedB, "Collect should pay out full owed amounts");
    }

    function it_two_positions_share_fees_pro_rata() {
        _mintRange(-6000, 6000, 75000e18);
        _mintRange(-12000, 12000, 25000e18);
        require(pool.liquidity() == 100000e18, "Total liquidity wrong");

        require(ERC20(tokenAAddress).approve(address(pool), 100e18), "Approval failed");
        pool.swap(true, 100e18, 1, 0, block.timestamp + DEADLINE_OFFSET);

        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        pool.burn(-12000, 12000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedNarrow, ) = pool.getPosition(address(this), -6000, 6000);
        (, uint owedWide, ) = pool.getPosition(address(this), -12000, 12000);

        require(owedNarrow > 0 && owedWide > 0, "Both positions should earn");
        // 75/25 split: narrow should earn ~3x the wide position (allow rounding slack)
        uint ratio = (owedNarrow * 100) / owedWide;
        require(ratio >= 297 && ratio <= 303, "Fee split not pro-rata: ratio*100 = " + string(ratio));
    }

    // ============ TWAP TESTS ============

    function it_twap_accumulator_tracks_tick_over_time() {
        _mintRange(-6000, 6000, 100000e18);

        (int cumStart, ) = pool.observe();

        // Hold tick 0 for 100 seconds: accumulator unchanged (tick 0 contributes 0)
        fastForward(100);
        (int cumAfterHold, ) = pool.observe();
        require(cumAfterHold == cumStart, "Tick 0 should contribute nothing");

        // Move the price down, then hold for 100 seconds
        require(ERC20(tokenAAddress).approve(address(pool), 500e18), "Approval failed");
        pool.swap(true, 500e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        int tickAfterSwap = pool.currentTick();
        require(tickAfterSwap < 0, "Tick should be negative after A->B swap");

        fastForward(100);
        (int cumEnd, uint tEnd) = pool.observe();

        // TWAP tick over the last 100 seconds should equal the post-swap tick
        int twapTick = (cumEnd - cumAfterHold) / 100;
        require(twapTick == tickAfterSwap, "TWAP tick mismatch: " + string(twapTick) + " vs " + string(tickAfterSwap));
    }

    // ============ GUARD TESTS ============

    function it_paused_pool_rejects_swaps_and_mints() {
        _mintRange(-6000, 6000, 100000e18);
        pool.setPaused(true);

        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Paused pool should reject swaps");

        thrown = false;
        try {
            pool.mint(-600, 600, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Paused pool should reject mints");

        // Burn and collect must still work while paused (LP exit path)
        pool.setPaused(false);
        pool.setPaused(true);
        pool.burn(-6000, 6000, 100000e18, block.timestamp + DEADLINE_OFFSET);
        (uint gotA, uint gotB) = pool.collect(-6000, 6000, 1000000e18, 1000000e18);
        require(gotA > 0 && gotB > 0, "Exit while paused should work");
    }

    function it_expired_deadline_rejected() {
        _mintRange(-6000, 6000, 100000e18);
        fastForward(100);
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 1, 0, block.timestamp - 1);
        } catch {
            thrown = true;
        }
        require(thrown, "Expired deadline should revert");
    }

    // ============ FACTORY TESTS (EXTENDED) ============

    function it_factory_rejects_identical_tokens() {
        bool thrown = false;
        try {
            factory.createPoolV3(tokenAAddress, tokenAAddress, 100, WAD);
        } catch {
            thrown = true;
        }
        require(thrown, "Identical tokens should revert");
    }

    function it_factory_rejects_zero_initial_price() {
        bool thrown = false;
        try {
            factory.createPoolV3(tokenAAddress, tokenBAddress, 100, 0);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero initial price should revert");
    }

    function it_factory_rejects_inactive_token() {
        Token(tokenAAddress).setStatus(1); // not ACTIVE
        bool thrown = false;
        try {
            factory.createPoolV3(tokenAAddress, tokenBAddress, 100, WAD);
        } catch {
            thrown = true;
        }
        require(thrown, "Inactive token should revert");
        Token(tokenAAddress).setStatus(2); // restore
    }

    function it_factory_enable_new_fee_tier_and_create_pool() {
        factory.enableFeeTier(50, 10);
        address p50 = factory.createPoolV3(tokenAAddress, tokenBAddress, 50, WAD);
        require(p50 != address(0), "50bps pool should be created");
        require(PoolV3(p50).feeBps() == 50, "Fee should be 50 bps");
        require(PoolV3(p50).tickSpacing() == 10, "Tick spacing should be 10");
    }

    function it_factory_fee_tier_validation() {
        bool thrown = false;
        try {
            factory.enableFeeTier(30, 60); // already exists
        } catch {
            thrown = true;
        }
        require(thrown, "Duplicate fee tier should revert");

        thrown = false;
        try {
            factory.enableFeeTier(0, 60);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero fee should revert");

        thrown = false;
        try {
            factory.enableFeeTier(1001, 60); // > 10%
        } catch {
            thrown = true;
        }
        require(thrown, "Fee over 10% should revert");

        thrown = false;
        try {
            factory.enableFeeTier(40, 0);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero tick spacing should revert");

        thrown = false;
        try {
            factory.enableFeeTier(40, 32769);
        } catch {
            thrown = true;
        }
        require(thrown, "Oversized tick spacing should revert");
    }

    function it_factory_non_owner_cannot_admin() {
        User stranger = new User();
        bool thrown = false;
        try {
            stranger.do(address(factory), "createPoolV3", tokenAAddress, tokenBAddress, 100, WAD);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner createPoolV3 should revert");

        thrown = false;
        try {
            stranger.do(address(factory), "enableFeeTier", 40, 60);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner enableFeeTier should revert");

        thrown = false;
        try {
            stranger.do(address(factory), "setLpSharePercent", 5000);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner setLpSharePercent should revert");
    }

    function it_factory_lp_share_bounds_and_pool_override() {
        bool thrown = false;
        try {
            factory.setLpSharePercent(0);
        } catch {
            thrown = true;
        }
        require(thrown, "Factory LP share 0 should revert");

        thrown = false;
        try {
            factory.setLpSharePercent(10001);
        } catch {
            thrown = true;
        }
        require(thrown, "Factory LP share > 100% should revert");

        // Pool-specific override, then reset to factory default
        factory.setPoolLpSharePercent(poolAddress, 5000);
        require(pool.lpSharePercent() == 5000, "Pool LP share override failed");
        factory.setPoolLpSharePercent(poolAddress, 0);
        require(pool.lpSharePercent() == 0, "Pool LP share reset failed");

        thrown = false;
        try {
            factory.setPoolLpSharePercent(poolAddress, 10001);
        } catch {
            thrown = true;
        }
        require(thrown, "Pool LP share > 100% should revert");
    }

    // ============ TICK MATH TESTS (EXTENDED) ============

    function it_tick_math_bounds() {
        // Exact values at the extremes (verified against high-precision reference:
        // sqrt(1.0001^±443636) * 1e18, relative error < 3e-9)
        require(pool.getSqrtPriceAtTick(-443636) == 232835019, "MIN_TICK sqrt price wrong");
        require(pool.getSqrtPriceAtTick(443636) == 4294886577209892225138997908, "MAX_TICK sqrt price wrong");

        bool thrown = false;
        try {
            pool.getSqrtPriceAtTick(-443637);
        } catch {
            thrown = true;
        }
        require(thrown, "Below MIN_TICK should revert");

        thrown = false;
        try {
            pool.getSqrtPriceAtTick(443637);
        } catch {
            thrown = true;
        }
        require(thrown, "Above MAX_TICK should revert");

        thrown = false;
        try {
            pool.getTickAtSqrtPrice(232835018); // 1 wei below MIN price
        } catch {
            thrown = true;
        }
        require(thrown, "Price below MIN should revert");
    }

    function it_tick_math_matches_uniswap_reference() {
        // Reference values: exact sqrt(1.0001^t) * 1e18 computed at 80-digit precision.
        // The contract's bit-decomposition constants reproduce these to < 1e-18 relative error
        // (tighter than Uniswap V3's Q64.96 TickMath guarantee of 1/2^32).
        require(pool.getSqrtPriceAtTick(60) == 1003004354062741925, "tick 60 mismatch");
        require(pool.getSqrtPriceAtTick(100) == 1005012269623051203, "tick 100 mismatch");
        require(pool.getSqrtPriceAtTick(1000) == 1051268468376766590, "tick 1000 mismatch");
        require(pool.getSqrtPriceAtTick(10000) == 1648680055931175769, "tick 10000 mismatch");
        require(pool.getSqrtPriceAtTick(-60) == 997004645044089219, "tick -60 mismatch");
        require(pool.getSqrtPriceAtTick(-100) == 995012727929250903, "tick -100 mismatch");
        require(pool.getSqrtPriceAtTick(-10000) == 606545822157834757, "tick -10000 mismatch");
    }

    function property_tick_math_monotonic(uint seed) {
        int tick = int(seed % 887272) - 443636; // [-443636, 443635]
        require(pool.getSqrtPriceAtTick(tick) < pool.getSqrtPriceAtTick(tick + 1),
            "sqrt price not strictly increasing at tick " + string(tick));
    }

    function it_tick_at_sqrt_price_boundary_exact() {
        uint sq60 = pool.getSqrtPriceAtTick(60);
        require(pool.getTickAtSqrtPrice(sq60) == 60, "Exact boundary should map to its tick");
        require(pool.getTickAtSqrtPrice(sq60 - 1) == 59, "1 wei below boundary should map to tick-1");
        require(pool.getTickAtSqrtPrice(sq60 + 1) == 60, "1 wei above boundary should stay at tick");
    }

    // ============ AMOUNT MATH TESTS (EXTENDED) ============

    function it_amounts_match_closed_form_reference() {
        // L=1000e18 over [-600,600) at price 1.0. Expected values from exact integer math:
        //   amountA = ceil(L * (sqrtU - sqrtP) * WAD / (sqrtP * sqrtU))
        //   amountB = ceil(L * (sqrtP - sqrtL) / WAD)
        // These match Uniswap V3's LiquidityAmounts formulas (rounding up on mint).
        (uint amountA, uint amountB) = pool.getAmountsForLiquidity(-600, 600, 1000e18);
        require(amountA == 29553010879137169529, "amountA mismatch: " + string(amountA));
        require(amountB == 29553010879137170000, "amountB mismatch: " + string(amountB));
    }

    function it_amounts_at_range_boundaries_single_sided() {
        // Price exactly at lower bound: position is in range but needs only tokenA
        (uint amountA, uint amountB) = pool.getAmountsForLiquidity(0, 60, 100000e18);
        require(amountA > 0, "Lower boundary should need tokenA");
        require(amountB == 0, "Lower boundary should need no tokenB");

        // Price exactly at upper bound: position is out of range (upper-exclusive), all tokenB
        (uint amountA2, uint amountB2) = pool.getAmountsForLiquidity(-60, 0, 100000e18);
        require(amountA2 == 0, "Upper boundary should need no tokenA");
        require(amountB2 > 0, "Upper boundary should need tokenB");

        // Liquidity activation matches: [0,60) is active at tick 0, [-60,0) is not
        _mintRange(0, 60, 100000e18);
        require(pool.liquidity() == 100000e18, "[0,60) should be active at tick 0");
        _mintRange(-60, 0, 100000e18);
        require(pool.liquidity() == 100000e18, "[-60,0) should not be active at tick 0");
    }

    function it_mint_dust_liquidity_rounds_up_against_user() {
        // 1 wei of liquidity: both amounts round up to 1 wei (pool never undercharges)
        (uint amountA, uint amountB) = _mintRange(-60, 60, 1);
        require(amountA == 1, "Dust amountA should round up to 1");
        require(amountB == 1, "Dust amountB should round up to 1");
    }

    // ============ MINT TESTS (EXTENDED) ============

    function it_mint_rejects_zero_liquidity() {
        _approveBoth(1000e18, 1000e18);
        bool thrown = false;
        try {
            pool.mint(-600, 600, 0, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero liquidity mint should revert");
    }

    function it_mint_rejects_expired_deadline() {
        _approveBoth(1000e18, 1000e18);
        fastForward(100);
        bool thrown = false;
        try {
            pool.mint(-600, 600, 1000e18, 1000e18, 1000e18, block.timestamp - 1);
        } catch {
            thrown = true;
        }
        require(thrown, "Expired mint deadline should revert");
    }

    function it_mint_slippage_protection() {
        _approveBoth(100000000e18, 100000000e18);
        bool thrown = false;
        try {
            // Needs ~29.5e18 of each; cap tokenA at 1e18
            pool.mint(-600, 600, 1000e18, 1e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Mint over maxTokenAAmount should revert");

        thrown = false;
        try {
            pool.mint(-600, 600, 1000e18, 1000e18, 1e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Mint over maxTokenBAmount should revert");
    }

    function it_mint_twice_same_range_accumulates() {
        (uint firstA, uint firstB) = _mintRange(-600, 600, 1000e18);
        (uint secondA, uint secondB) = _mintRange(-600, 600, 1000e18);

        // Same price, same liquidity: second deposit should match the first (within 1 wei rounding)
        require(secondA >= firstA - 1 && secondA <= firstA + 1, "Second mint amountA mismatch");
        require(secondB >= firstB - 1 && secondB <= firstB + 1, "Second mint amountB mismatch");

        (uint posLiquidity, , ) = pool.getPosition(address(this), -600, 600);
        require(posLiquidity == 2000e18, "Position should accumulate to 2000e18");
        require(pool.liquidity() == 2000e18, "Pool liquidity should accumulate");
    }

    function it_mint_rejects_out_of_bounds_ticks() {
        _approveBoth(1000e18, 1000e18);
        bool thrown = false;
        try {
            // -443640 is a multiple of 60 but below MIN_TICK
            pool.mint(-443640, 600, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "tickLower below MIN_TICK should revert");

        thrown = false;
        try {
            pool.mint(-600, 443640, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "tickUpper above MAX_TICK should revert");
    }

    function it_mint_multiple_users_positions_independent() {
        User u1 = _newUser();
        User u2 = _newUser();
        _userMint(u1, -600, 600, 30000e18);
        _userMint(u2, -600, 600, 70000e18);

        (uint liq1, , ) = pool.getPosition(address(u1), -600, 600);
        (uint liq2, , ) = pool.getPosition(address(u2), -600, 600);
        require(liq1 == 30000e18, "User1 position liquidity wrong");
        require(liq2 == 70000e18, "User2 position liquidity wrong");
        require(pool.liquidity() == 100000e18, "Pool should sum both positions");

        // u1's burn must not touch u2's position
        u1.do(poolAddress, "burn", int(-600), int(600), 30000e18, block.timestamp + DEADLINE_OFFSET);
        (uint liq1After, , ) = pool.getPosition(address(u1), -600, 600);
        (uint liq2After, , ) = pool.getPosition(address(u2), -600, 600);
        require(liq1After == 0, "User1 position should be empty");
        require(liq2After == 70000e18, "User2 position should be untouched");
        require(pool.liquidity() == 70000e18, "Pool liquidity should reflect burn");
    }

    // ============ BURN TESTS (EXTENDED) ============

    function it_burn_rejects_more_than_position() {
        _mintRange(-600, 600, 1000e18);
        bool thrown = false;
        try {
            pool.burn(-600, 600, 1001e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Burning more than position should revert");
    }

    function it_burn_from_stranger_reverts() {
        _mintRange(-600, 600, 1000e18);
        User stranger = new User();
        bool thrown = false;
        try {
            stranger.do(poolAddress, "burn", int(-600), int(600), 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Stranger burning someone else's position should revert");
    }

    function it_burn_partial_is_proportional() {
        (uint depositedA, uint depositedB) = _mintRange(-600, 600, 1000e18);
        (uint burnedA, uint burnedB) = pool.burn(-600, 600, 500e18, block.timestamp + DEADLINE_OFFSET);

        // Half the liquidity returns half the deposit (rounding favors the pool)
        require(burnedA <= depositedA / 2 && depositedA / 2 - burnedA <= 2, "Partial burn amountA not proportional");
        require(burnedB <= depositedB / 2 && depositedB / 2 - burnedB <= 2, "Partial burn amountB not proportional");

        (uint posLiquidity, , ) = pool.getPosition(address(this), -600, 600);
        require(posLiquidity == 500e18, "Position should have half liquidity left");
        require(pool.liquidity() == 500e18, "Pool liquidity should be halved");
    }

    function it_burn_poke_empty_position_is_noop() {
        // NOTE: divergence from Uniswap V3, which reverts ('NP') when poking a
        // nonexistent position. Here it is a harmless no-op.
        (uint amountA, uint amountB) = pool.burn(-600, 600, 0, block.timestamp + DEADLINE_OFFSET);
        require(amountA == 0 && amountB == 0, "Poking empty position should return zeros");
        (uint posLiquidity, uint owedA, uint owedB) = pool.getPosition(address(this), -600, 600);
        require(posLiquidity == 0 && owedA == 0 && owedB == 0, "Empty position should stay empty");
    }

    function it_burn_after_price_moves_into_range_returns_both_tokens() {
        // Mint above range: all tokenA
        (uint depositedA, uint depositedB) = _mintRange(60, 120, 100000e18);
        require(depositedB == 0, "Above-range mint should take no tokenB");
        require(pool.liquidity() == 0, "Position should start inactive");

        // Swap B->A: price rises through the gap into [60,120)
        _swap(false, 150e18);
        require(pool.currentTick() >= 60 && pool.currentTick() < 120, "Price should be inside the range");
        require(pool.liquidity() == 100000e18, "Position should be active after gap jump");

        // Burn all: position now holds a mix of both tokens
        (uint burnedA, uint burnedB) = pool.burn(60, 120, 100000e18, block.timestamp + DEADLINE_OFFSET);
        require(burnedA > 0, "Should return remaining tokenA");
        require(burnedB > 0, "Should return converted tokenB");
        require(burnedA < depositedA, "Some tokenA must have been sold");
    }

    function it_burn_full_then_remint_no_stale_fees() {
        _mintRange(-600, 600, 100000e18);
        _swap(true, 100e18); // accrue fees

        // Full exit
        pool.burn(-600, 600, 100000e18, block.timestamp + DEADLINE_OFFSET);
        pool.collect(-600, 600, 1000000e18, 1000000e18);

        // Re-mint the same range with a fresh position; poke; no fees should appear
        _mintRange(-600, 600, 50000e18);
        pool.burn(-600, 600, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, uint owedB) = pool.getPosition(address(this), -600, 600);
        require(owedA == 0 && owedB == 0, "Re-minted position must not inherit old fees: " + string(owedA));
    }

    // ============ COLLECT TESTS (EXTENDED) ============

    function it_collect_partial_leaves_remainder() {
        _mintRange(-600, 600, 1000e18);
        (uint burnedA, uint burnedB) = pool.burn(-600, 600, 1000e18, block.timestamp + DEADLINE_OFFSET);

        (uint gotA, uint gotB) = pool.collect(-600, 600, burnedA / 2, 0);
        require(gotA == burnedA / 2, "Partial collect amountA wrong");
        require(gotB == 0, "Capped tokenB collect should be zero");

        (, uint owedA, uint owedB) = pool.getPosition(address(this), -600, 600);
        require(owedA == burnedA - burnedA / 2, "Remainder A wrong");
        require(owedB == burnedB, "TokenB owed should be untouched");

        // Second collect drains the rest
        (uint gotA2, uint gotB2) = pool.collect(-600, 600, 1000000e18, 1000000e18);
        require(gotA2 == owedA && gotB2 == owedB, "Second collect should drain remainder");
        (, uint owedAFinal, uint owedBFinal) = pool.getPosition(address(this), -600, 600);
        require(owedAFinal == 0 && owedBFinal == 0, "Nothing should remain owed");
    }

    function it_collect_empty_position_returns_zero() {
        (uint gotA, uint gotB) = pool.collect(-600, 600, 1000000e18, 1000000e18);
        require(gotA == 0 && gotB == 0, "Collecting empty position should return zeros");
    }

    function it_collect_only_owner_position_pays() {
        User u1 = _newUser();
        _userMint(u1, -6000, 6000, 100000e18);
        _swap(true, 100e18);

        // Test contract has no position at these ticks: collect pays nothing
        (uint gotA, uint gotB) = pool.collect(-6000, 6000, 1000000e18, 1000000e18);
        require(gotA == 0 && gotB == 0, "Non-owner should collect nothing");

        // The actual LP can collect its fees
        _userPoke(u1, -6000, 6000);
        (, uint owedA, ) = pool.getPosition(address(u1), -6000, 6000);
        require(owedA > 0, "LP should have fees owed");
        uint balBefore = ERC20(tokenAAddress).balanceOf(address(u1));
        u1.do(poolAddress, "collect", int(-6000), int(6000), 1000000e18, 1000000e18);
        require(ERC20(tokenAAddress).balanceOf(address(u1)) == balBefore + owedA, "LP should receive its fees");
    }

    // ============ SWAP TESTS (EXTENDED) ============

    function it_swap_output_matches_uniswap_v3_math() {
        // Reference scenario: price 1.0, L = 100000e18, fee 30bps, 10e18 tokenA in.
        // Uniswap V3 core math (Q64.96 SqrtPriceMath, same inputs) yields
        // amountOut = 9969006090092817746; this WAD implementation matches to < 2e-14
        // relative error. Expected exact contract output: 9969006090092800000.
        _mintRange(-6000, 6000, 100000e18);
        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));
        uint amountOut = _swap(true, 10e18);

        require(amountOut > 9969006090092817746 - 1000000 && amountOut < 9969006090092817746 + 1000000,
            "Output deviates from Uniswap V3 math: " + string(amountOut));
        require(balABefore - ERC20(tokenAAddress).balanceOf(address(this)) == 10e18, "Full input should be consumed");

        // Post-swap sqrt price: expected 999900309939099072 (V3 Q96 equivalent: 999900309939099074)
        uint sq = pool.sqrtPriceWad();
        require(sq > 999900309939099072 - 10000 && sq < 999900309939099072 + 10000,
            "Post-swap sqrt price deviates: " + string(sq));
    }

    function it_swap_roundtrip_never_profits_user() {
        _mintRange(-6000, 6000, 100000e18);
        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));

        uint outB = _swap(true, 10e18);
        uint backA = _swap(false, outB);

        // Expected: ~0.6% round-trip loss (two 30bps fees + price impact); reference 9940092972785382157
        require(backA < 10e18, "Round trip must never profit the user");
        uint loss = 10e18 - backA;
        require(loss > 55e15 && loss < 65e15, "Round-trip loss out of expected band: " + string(loss));
        require(ERC20(tokenAAddress).balanceOf(address(this)) == balABefore - 10e18 + backA, "Balance accounting wrong");
    }

    function it_swap_multi_tick_staircase_down() {
        // Three stacked ranges with increasing depth below the price
        _mintRange(-60, 60, 100000e18);
        _mintRange(-180, -60, 200000e18);
        _mintRange(-300, -180, 300000e18);
        require(pool.liquidity() == 100000e18, "Only [-60,60) should start active");

        address collector = factory.feeCollector();
        uint collectorBefore = ERC20(tokenAAddress).balanceOf(collector);

        // Reference (exact integer mirror of V3-style swap stepping): crossing -60 and -180,
        // finishing at tick -213 inside the deepest range, out = 1969258559869827500000
        uint amountOut = _swap(true, 2000e18);

        require(amountOut > 1969258559869827500000 - 1000000000 && amountOut < 1969258559869827500000 + 1000000000,
            "Staircase-down output deviates: " + string(amountOut));
        require(pool.currentTick() == -213, "Final tick should be -213, got " + string(pool.currentTick()));
        require(pool.liquidity() == 300000e18, "Only the deepest range should be active");

        // Protocol fee: 30% of 0.3% of 2000e18 = 1.8e18
        uint protocolFee = ERC20(tokenAAddress).balanceOf(collector) - collectorBefore;
        require(protocolFee >= 18e17 && protocolFee <= 18e17 + 10, "Protocol fee wrong: " + string(protocolFee));
    }

    function it_swap_multi_tick_staircase_up() {
        _mintRange(-60, 60, 100000e18);
        _mintRange(60, 180, 200000e18);
        _mintRange(180, 300, 300000e18);
        require(pool.liquidity() == 100000e18, "Only [-60,60) should start active");

        // Mirror of the down case: B->A crossing 60 and 180, finishing at tick 212
        uint amountOut = _swap(false, 2000e18);

        require(amountOut > 1969258559869827653565 - 1000000000 && amountOut < 1969258559869827653565 + 1000000000,
            "Staircase-up output deviates: " + string(amountOut));
        require(pool.currentTick() == 212, "Final tick should be 212, got " + string(pool.currentTick()));
        require(pool.liquidity() == 300000e18, "Only the top range should be active");
    }

    function it_swap_across_liquidity_gap() {
        // Liquidity at [-60,60) and [-360,-240) with an empty gap between
        _mintRange(-60, 60, 100000e18);
        _mintRange(-360, -240, 100000e18);

        // Reference: drains [-60,60) down to -60, price jumps the gap without trading,
        // then trades inside [-360,-240) to tick -280; out = 492525674171347200000
        uint amountOut = _swap(true, 500e18);

        require(amountOut > 492525674171347200000 - 1000000000 && amountOut < 492525674171347200000 + 1000000000,
            "Gap swap output deviates: " + string(amountOut));
        require(pool.currentTick() == -280, "Final tick should be -280, got " + string(pool.currentTick()));
        require(pool.liquidity() == 100000e18, "Far range should be the only active liquidity");
    }

    function it_swap_partial_fill_when_liquidity_exhausted() {
        // One narrow range; a huge order can only consume what the range holds
        (, uint depositedB) = _mintRange(-60, 60, 100000e18);

        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));
        uint amountOut = _swap(true, 1000e18);
        uint consumed = balABefore - ERC20(tokenAAddress).balanceOf(address(this));

        // Reference: consumes ~301.34e18, outputs ~299.54e18 (everything the range held)
        require(consumed < 1000e18, "Order should only partially fill");
        require(consumed > 300e18 && consumed < 303e18, "Consumed out of band: " + string(consumed));
        require(amountOut > 299e18 && amountOut < 300e18, "Output out of band: " + string(amountOut));
        require(depositedB - amountOut <= 1e10, "Should drain essentially all tokenB");
        require(pool.liquidity() == 0, "No liquidity should remain active");
        require(pool.currentTick() == -443636, "Price should ride to MIN_TICK");
    }

    function it_swap_invalid_price_limits_revert() {
        _mintRange(-6000, 6000, 100000e18);
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), 10e18), "Approval failed");

        bool thrown = false;
        try {
            // A->B moves price down; limit above current price is invalid
            pool.swap(true, 10e18, 1, pool.getSqrtPriceAtTick(100), block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "A->B limit above price should revert");

        thrown = false;
        try {
            // Limit equal to current price is also invalid (strict inequality)
            pool.swap(true, 10e18, 1, pool.sqrtPriceWad(), block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Limit equal to price should revert");

        thrown = false;
        try {
            // B->A moves price up; limit below current price is invalid
            pool.swap(false, 10e18, 1, pool.getSqrtPriceAtTick(-100), block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "B->A limit below price should revert");

        thrown = false;
        try {
            // Below the representable minimum
            pool.swap(true, 10e18, 1, 232835018, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Limit below MIN price should revert");
    }

    function it_swap_rejects_zero_inputs() {
        _mintRange(-6000, 6000, 100000e18);
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");

        bool thrown = false;
        try {
            pool.swap(true, 0, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero amountIn should revert");

        thrown = false;
        try {
            pool.swap(true, 10e18, 0, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Zero minAmountOut should revert");
    }

    function it_swap_dust_input_reverts_without_output() {
        _mintRange(-6000, 6000, 100000e18);
        require(ERC20(tokenAAddress).approve(address(pool), 1), "Approval failed");
        bool thrown = false;
        try {
            // 1 wei in: fee rounding leaves zero net input, zero output -> slippage revert
            pool.swap(true, 1, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Dust swap with zero output should revert");
    }

    function it_swap_protocol_fee_paid_in_input_token_both_directions() {
        _mintRange(-6000, 6000, 100000e18);
        address collector = factory.feeCollector();

        uint collectorABefore = ERC20(tokenAAddress).balanceOf(collector);
        uint collectorBBefore = ERC20(tokenBAddress).balanceOf(collector);

        _swap(true, 100e18);
        uint feeA = ERC20(tokenAAddress).balanceOf(collector) - collectorABefore;
        require(feeA > 89e15 && feeA <= 9e16, "A->B protocol fee in tokenA wrong: " + string(feeA));
        require(ERC20(tokenBAddress).balanceOf(collector) == collectorBBefore, "A->B must not pay tokenB fees");

        _swap(false, 100e18);
        uint feeB = ERC20(tokenBAddress).balanceOf(collector) - collectorBBefore;
        require(feeB > 89e15 && feeB <= 9e16, "B->A protocol fee in tokenB wrong: " + string(feeB));
        require(ERC20(tokenAAddress).balanceOf(collector) == collectorABefore + feeA, "B->A must not pay tokenA fees");
    }

    function it_swap_lp_share_10000_sends_no_protocol_fee() {
        factory.setPoolLpSharePercent(poolAddress, 10000);
        _mintRange(-6000, 6000, 100000e18);

        address collector = factory.feeCollector();
        uint collectorBefore = ERC20(tokenAAddress).balanceOf(collector);
        _swap(true, 100e18);
        require(ERC20(tokenAAddress).balanceOf(collector) == collectorBefore, "Collector should receive nothing");

        // The entire 0.3% fee accrues to the LP
        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, ) = pool.getPosition(address(this), -6000, 6000);
        require(owedA >= 3e17 - 2 && owedA <= 3e17, "LP should earn the full fee: " + string(owedA));
    }

    function it_swap_stop_exactly_on_initialized_tick_boundary() {
        // Regression test for V3 tick-crossing parity: when a swap stops exactly at a
        // price limit that coincides with an initialized tick, the tick must be crossed
        // (Uniswap V3 semantics), otherwise currentTick and active liquidity disagree.
        _mintRange(0, 60, 100000e18);   // active at tick 0
        _mintRange(60, 120, 50000e18);  // above range

        // Swap up with the limit exactly on tick 60's price
        uint limit = pool.getSqrtPriceAtTick(60);
        require(ERC20(tokenBAddress).approve(address(pool), 1000e18), "Approval failed");
        pool.swap(false, 1000e18, 1, limit, block.timestamp + DEADLINE_OFFSET);

        require(pool.sqrtPriceWad() == limit, "Price should stop exactly at the limit");
        require(pool.currentTick() == 60, "Tick should be 60, got " + string(pool.currentTick()));
        // Tick 60 must have been crossed: [0,60) leaves range (-100000e18), [60,120) enters (+50000e18)
        require(pool.liquidity() == 50000e18,
            "Tick 60 not crossed: phantom liquidity " + string(pool.liquidity()));

        // Swapping back down must cross tick 60 again and re-activate [0,60)
        _swap(true, 1e18);
        require(pool.currentTick() < 60, "Price should be back below tick 60");
        require(pool.liquidity() == 100000e18,
            "Cross-back should restore [0,60) liquidity, got " + string(pool.liquidity()));
    }

    // ============ FEE / POSITION TESTS (EXTENDED) ============

    function it_same_range_two_users_split_fees_equally() {
        User u1 = _newUser();
        User u2 = _newUser();
        _userMint(u1, -6000, 6000, 50000e18);
        _userMint(u2, -6000, 6000, 50000e18);

        _swap(true, 100e18);

        _userPoke(u1, -6000, 6000);
        _userPoke(u2, -6000, 6000);
        (, uint owed1, ) = pool.getPosition(address(u1), -6000, 6000);
        (, uint owed2, ) = pool.getPosition(address(u2), -6000, 6000);

        // Total LP fee = 0.3% * 70% of 100e18 = 0.21e18, split 50/50 = 0.105e18 each
        require(owed1 == owed2, "Equal positions must earn equal fees");
        require(owed1 >= 105e15 - 2 && owed1 <= 105e15, "Per-user fee wrong: " + string(owed1));
    }

    function it_fees_stop_when_position_exits_range() {
        _mintRange(-60, 60, 100000e18);     // narrow
        _mintRange(-6000, 6000, 100000e18); // wide backstop

        // Swap 1: pushes price below -60, narrow range exits partway through
        // (reaching tick -60 against 200000e18 of combined liquidity takes ~605e18 of input)
        _swap(true, 800e18);
        require(pool.currentTick() < -60, "Price should be below the narrow range");

        pool.burn(-60, 60, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint narrowOwedAfterExit, ) = pool.getPosition(address(this), -60, 60);
        require(narrowOwedAfterExit > 0, "Narrow position should have earned during swap 1");

        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint wideOwedAfterExit, ) = pool.getPosition(address(this), -6000, 6000);

        // Swap 2: entirely below the narrow range; only the wide position may earn
        _swap(true, 100e18);
        pool.burn(-60, 60, 0, block.timestamp + DEADLINE_OFFSET);
        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint narrowOwedFinal, ) = pool.getPosition(address(this), -60, 60);
        (, uint wideOwedFinal, ) = pool.getPosition(address(this), -6000, 6000);

        require(narrowOwedFinal == narrowOwedAfterExit, "Out-of-range narrow position must not earn");
        require(wideOwedFinal > wideOwedAfterExit, "In-range wide position must keep earning");
    }

    function it_fees_accrue_in_both_tokens() {
        _mintRange(-6000, 6000, 100000e18);
        _swap(true, 100e18);
        _swap(false, 100e18);

        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, uint owedB) = pool.getPosition(address(this), -6000, 6000);
        require(owedA > 0, "Should earn tokenA fees from A->B swap");
        require(owedB > 0, "Should earn tokenB fees from B->A swap");
        // Each direction: 0.21e18 LP fee
        require(owedA >= 21e16 - 2 && owedA <= 21e16, "TokenA fee wrong: " + string(owedA));
        require(owedB >= 21e16 - 2 && owedB <= 21e16, "TokenB fee wrong: " + string(owedB));
    }

    function it_late_lp_earns_no_prior_fees() {
        User u1 = _newUser();
        User u2 = _newUser();
        _userMint(u1, -6000, 6000, 100000e18);

        _swap(true, 100e18); // fees only u1 was present for

        _userMint(u2, -6000, 6000, 100000e18);
        _userPoke(u2, -6000, 6000);
        (, uint owed2, ) = pool.getPosition(address(u2), -6000, 6000);
        require(owed2 == 0, "Late LP must not earn past fees: " + string(owed2));

        _swap(true, 100e18); // now both earn
        _userPoke(u1, -6000, 6000);
        _userPoke(u2, -6000, 6000);
        (, uint owed1After, ) = pool.getPosition(address(u1), -6000, 6000);
        (, uint owed2After, ) = pool.getPosition(address(u2), -6000, 6000);
        require(owed2After > 0, "Late LP should earn from the second swap");
        // u1: full fee from swap 1 (0.21e18) + half of swap 2 (0.105e18); u2: half of swap 2
        require(owed1After > owed2After * 2, "Early LP should have earned strictly more");
    }

    function it_multiple_small_swaps_accumulate_exact_fees() {
        _mintRange(-6000, 6000, 100000e18);

        for (uint i = 0; i < 5; i++) {
            _swap(true, 20e18);
        }

        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, ) = pool.getPosition(address(this), -6000, 6000);
        // Fees are input-denominated: 5 swaps x 20e18 x 0.3% x 70% = 0.21e18 exactly
        require(owedA >= 21e16 - 5 && owedA <= 21e16, "Accumulated fee wrong: " + string(owedA));
    }

    function it_full_exit_after_prior_fee_history_earns_no_phantom_fees() {
        // Regression for V3 tick-clearing order: flipped ticks must be cleared only AFTER
        // the position's final fee accrual. If feeGrowthOutside were zeroed first, a position
        // minted after fee history exists would be credited phantom fees on full burn,
        // scaling with its liquidity (10x the pool's entire fee history here).
        User lp1 = _newUser();
        User lp2 = _newUser();
        _userMint(lp1, -6000, 6000, 100000e18);
        _swap(true, 100e18); // fee history: feeGrowthGlobalA > 0 before lp2 arrives

        // lp2 mints a fresh range spanning the current tick, then exits immediately
        uint balABefore = ERC20(tokenAAddress).balanceOf(address(lp2));
        uint balBBefore = ERC20(tokenBAddress).balanceOf(address(lp2));
        _userMint(lp2, -600, 600, 1000000e18);
        uint depositedA = balABefore - ERC20(tokenAAddress).balanceOf(address(lp2));
        uint depositedB = balBBefore - ERC20(tokenBAddress).balanceOf(address(lp2));

        lp2.do(poolAddress, "burn", int(-600), int(600), 1000000e18, block.timestamp + DEADLINE_OFFSET);
        (, uint owedA, uint owedB) = pool.getPosition(address(lp2), -600, 600);

        // In range for zero swaps: owed must be principal only (rounding favors the pool)
        require(owedA <= depositedA && depositedA - owedA <= 4,
            "Phantom tokenA fees: deposited " + string(depositedA) + " owed " + string(owedA));
        require(owedB <= depositedB && depositedB - owedB <= 4,
            "Phantom tokenB fees: deposited " + string(depositedB) + " owed " + string(owedB));

        // lp1's fees are intact and payable after lp2 leaves
        lp2.do(poolAddress, "collect", int(-600), int(600), 100000000e18, 100000000e18);
        _userPoke(lp1, -6000, 6000);
        (, uint lp1OwedA, ) = pool.getPosition(address(lp1), -6000, 6000);
        require(lp1OwedA >= 21e16 - 2 && lp1OwedA <= 21e16, "LP1 fee wrong: " + string(lp1OwedA));
        lp1.do(poolAddress, "collect", int(-6000), int(6000), 100000000e18, 100000000e18);
        require(ERC20(tokenAAddress).balanceOf(address(pool)) == pool.tokenABalance(), "TokenA sync broken");
        require(ERC20(tokenBAddress).balanceOf(address(pool)) == pool.tokenBBalance(), "TokenB sync broken");
    }

    // ============ INVARIANT TESTS ============

    function it_tracked_balances_match_erc20_balances() {
        _mintRange(-6000, 6000, 100000e18);
        _mintRange(-600, 600, 50000e18);
        _swap(true, 100e18);
        _swap(false, 50e18);
        pool.burn(-600, 600, 25000e18, block.timestamp + DEADLINE_OFFSET);
        pool.collect(-600, 600, 1000000e18, 1000000e18);
        pool.burn(-6000, 6000, 0, block.timestamp + DEADLINE_OFFSET);

        require(ERC20(tokenAAddress).balanceOf(address(pool)) == pool.tokenABalance(),
            "TokenA tracked balance out of sync");
        require(ERC20(tokenBAddress).balanceOf(address(pool)) == pool.tokenBBalance(),
            "TokenB tracked balance out of sync");
    }

    function it_all_lps_can_exit_after_trading() {
        User u1 = _newUser();
        User u2 = _newUser();
        _userMint(u1, -6000, 6000, 100000e18);
        _userMint(u2, -1200, 1200, 50000e18);

        // A batch of trades in both directions, crossing u2's range boundaries
        _swap(true, 300e18);
        _swap(false, 500e18);
        _swap(true, 250e18);

        // Everyone exits completely
        u1.do(poolAddress, "burn", int(-6000), int(6000), 100000e18, block.timestamp + DEADLINE_OFFSET);
        u2.do(poolAddress, "burn", int(-1200), int(1200), 50000e18, block.timestamp + DEADLINE_OFFSET);
        u1.do(poolAddress, "collect", int(-6000), int(6000), 100000000e18, 100000000e18);
        u2.do(poolAddress, "collect", int(-1200), int(1200), 100000000e18, 100000000e18);

        (uint liq1, uint owedA1, uint owedB1) = pool.getPosition(address(u1), -6000, 6000);
        (uint liq2, uint owedA2, uint owedB2) = pool.getPosition(address(u2), -1200, 1200);
        require(liq1 == 0 && owedA1 == 0 && owedB1 == 0, "User1 should be fully exited");
        require(liq2 == 0 && owedA2 == 0 && owedB2 == 0, "User2 should be fully exited");
        require(pool.liquidity() == 0, "No liquidity should remain");

        // Pool remains solvent: only rounding dust is left behind, and it belongs to the pool
        require(ERC20(tokenAAddress).balanceOf(address(pool)) == pool.tokenABalance(), "TokenA sync broken");
        require(ERC20(tokenBAddress).balanceOf(address(pool)) == pool.tokenBBalance(), "TokenB sync broken");
        require(pool.tokenABalance() < 1e6, "Excess tokenA dust: " + string(pool.tokenABalance()));
        require(pool.tokenBBalance() < 1e6, "Excess tokenB dust: " + string(pool.tokenBBalance()));
    }

    function property_mint_burn_roundtrip_never_profits(uint seed) {
        int tickLower = -60 * int(1 + seed % 50);
        int tickUpper = 60 * int(1 + (seed / 50) % 50);
        uint liquidityAmount = 1e18 + (seed % 1000) * 1e18;

        (uint depositedA, uint depositedB) = _mintRange(tickLower, tickUpper, liquidityAmount);
        (uint burnedA, uint burnedB) = pool.burn(tickLower, tickUpper, liquidityAmount, block.timestamp + DEADLINE_OFFSET);

        require(burnedA <= depositedA, "Burn must not return more tokenA than deposited");
        require(burnedB <= depositedB, "Burn must not return more tokenB than deposited");
        require(depositedA - burnedA <= 4, "Excessive tokenA rounding loss: " + string(depositedA - burnedA));
        require(depositedB - burnedB <= 4, "Excessive tokenB rounding loss: " + string(depositedB - burnedB));

        (uint gotA, uint gotB) = pool.collect(tickLower, tickUpper, 100000000e18, 100000000e18);
        require(gotA == burnedA && gotB == burnedB, "Collect should pay exactly what burn credited");
    }

    function property_swap_roundtrip_never_profits(uint seed) {
        _mintRange(-12000, 12000, 200000e18);
        uint amountIn = 1e15 + seed % 5000e18;

        uint balABefore = ERC20(tokenAAddress).balanceOf(address(this));
        uint balBBefore = ERC20(tokenBAddress).balanceOf(address(this));

        uint outB = _swap(true, amountIn);
        uint backA = _swap(false, outB);

        require(backA < amountIn, "Swap round trip must never profit: in " + string(amountIn) + " back " + string(backA));
        require(ERC20(tokenBAddress).balanceOf(address(this)) == balBBefore, "All tokenB should be swapped back");
        require(ERC20(tokenAAddress).balanceOf(address(this)) == balABefore - amountIn + backA, "TokenA accounting wrong");
    }

    // ============ TWAP TESTS (EXTENDED) ============

    function it_twap_time_weighted_average_across_price_changes() {
        _mintRange(-6000, 6000, 100000e18);

        (int cum0, ) = pool.observe();

        // 100 seconds at tick 0 contributes nothing
        fastForward(100);
        (int cum1, ) = pool.observe();
        require(cum1 == cum0, "Tick 0 period should contribute zero");

        // Move price down, hold 300 seconds
        _swap(true, 500e18);
        int tickAfter = pool.currentTick();
        require(tickAfter < 0, "Tick should be negative");
        fastForward(300);
        (int cum2, ) = pool.observe();

        // Window TWAP over the last 300s equals the held tick exactly
        require((cum2 - cum1) / 300 == tickAfter, "300s window TWAP wrong");
        // Whole-window accumulator: 100s * 0 + 300s * tickAfter
        require(cum2 - cum0 == tickAfter * 300, "Full accumulator mismatch");
        // Negative tick means negative accumulation (geometric-mean TWAP below 1.0)
        require(cum2 < cum0, "Accumulator should decrease at negative ticks");
    }

    function it_twap_oracle_updates_on_liquidity_events() {
        _mintRange(-6000, 6000, 100000e18);
        _swap(true, 500e18);
        int tickHeld = pool.currentTick();

        // A mint after 100s must fold the elapsed tick-seconds into storage
        fastForward(100);
        _mintRange(-600, 600, 1000e18);
        require(pool.tickCumulative() == tickHeld * 100, "Mint should update the stored accumulator");
        require(pool.observationTimestamp() == block.timestamp, "Timestamp should advance");
    }

    // ============ GUARD / ADMIN TESTS (EXTENDED) ============

    function it_disabled_pool_freezes_everything_until_reenabled() {
        _mintRange(-6000, 6000, 100000e18);
        pool.setDisabled(true);
        require(pool.isPaused(), "Disable should force pause");

        // NOTE: unlike pause, disable also blocks burn/collect (no LP exit while disabled)
        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Disabled pool should reject swaps");

        thrown = false;
        try {
            pool.burn(-6000, 6000, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Disabled pool should reject burns");

        thrown = false;
        try {
            pool.collect(-6000, 6000, 1e18, 1e18);
        } catch {
            thrown = true;
        }
        require(thrown, "Disabled pool should reject collects");

        thrown = false;
        try {
            pool.setPaused(false);
        } catch {
            thrown = true;
        }
        require(thrown, "Cannot unpause while disabled");

        // Re-enable: disable off leaves pause on; unpause restores trading
        pool.setDisabled(false);
        require(pool.isPaused(), "Pause should persist after re-enable");
        pool.setPaused(false);
        uint amountOut = _swap(true, 10e18);
        require(amountOut > 0, "Swap should work after full re-enable");
    }

    function it_inactive_token_blocks_trading_allows_exit() {
        _mintRange(-6000, 6000, 100000e18);
        _swap(true, 100e18); // accrue some fees first
        Token(tokenAAddress).setStatus(1); // deactivate

        require(ERC20(tokenAAddress).approve(address(pool), 10e18), "Approval failed");
        bool thrown = false;
        try {
            pool.swap(true, 10e18, 1, 0, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Inactive token should block swaps");

        thrown = false;
        try {
            pool.mint(-600, 600, 1000e18, 1000e18, 1000e18, block.timestamp + DEADLINE_OFFSET);
        } catch {
            thrown = true;
        }
        require(thrown, "Inactive token should block mints");

        // LP exit path still works with an inactive token
        pool.burn(-6000, 6000, 100000e18, block.timestamp + DEADLINE_OFFSET);
        (uint gotA, uint gotB) = pool.collect(-6000, 6000, 100000000e18, 100000000e18);
        require(gotA > 0 && gotB > 0, "Exit must work with inactive token");

        Token(tokenAAddress).setStatus(2);
    }

    function it_initialize_only_once() {
        // Re-initializing a live pool would jump the price/tick without crossing ticks,
        // corrupting every position's accounting (Uniswap V3 initialize is one-shot too)
        _mintRange(-600, 600, 1000e18);
        bool thrown = false;
        try {
            // Even the pool owner (this test contract) cannot re-initialize
            pool.initialize(tokenAAddress, tokenBAddress, 30, 60, 2 * WAD, address(factory));
        } catch {
            thrown = true;
        }
        require(thrown, "Re-initialize should revert");
        require(pool.sqrtPriceWad() == WAD && pool.currentTick() == 0, "Pool state must be unchanged");
    }

    function it_non_owner_cannot_admin_pool() {
        User stranger = new User();

        bool thrown = false;
        try {
            stranger.do(poolAddress, "setPaused", true);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner setPaused should revert");

        thrown = false;
        try {
            stranger.do(poolAddress, "setDisabled", true);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner setDisabled should revert");

        thrown = false;
        try {
            stranger.do(poolAddress, "setLpSharePercent", 5000);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-factory setLpSharePercent should revert");

        thrown = false;
        try {
            stranger.do(poolAddress, "transferPoolToFactory", address(stranger));
        } catch {
            thrown = true;
        }
        require(thrown, "Non-factory transferPoolToFactory should revert");

        require(!pool.isPaused() && !pool.isDisabled(), "Pool state must be untouched");
    }

    function it_transfer_pool_to_new_factory() {
        PoolV3Factory factory2 = new PoolV3Factory(address(this));
        factory2.initialize(address(m.tokenFactory()), address(m.feeCollector()));

        pool.transferPoolToFactory(address(factory2));
        require(address(pool.poolV3Factory()) == address(factory2), "Factory pointer should update");

        // Old factory loses admin rights over the pool
        bool thrown = false;
        try {
            factory.setPoolLpSharePercent(poolAddress, 5000);
        } catch {
            thrown = true;
        }
        require(thrown, "Old factory should lose pool admin");

        // New factory gains them
        factory2.setPoolLpSharePercent(poolAddress, 4000);
        require(pool.lpSharePercent() == 4000, "New factory should administer the pool");

        thrown = false;
        try {
            pool.transferPoolToFactory(address(0));
        } catch {
            thrown = true;
        }
        require(thrown, "Zero factory address should revert");
    }
}
