import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

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
}
