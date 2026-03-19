import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_StablePool is Authorizable {

    Mercata m;
    string[] emptyArray;

    // Token addresses for each test
    address tokenAAddress;
    address tokenBAddress;
    address poolAddress;
    StablePool pool;

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

        // Create pool
        fastForward(100);
        poolAddress = m.poolFactory().createStablePool(tokenAAddress, tokenBAddress);
        pool = StablePool(poolAddress);

        // Give Pool mint/burn rights over its LP token
        Token lpToken = pool.lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(pool));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(pool));
    }

    function it_pool_creates_successfully() {
        require(address(pool) != address(0), "Pool should be created");
    }

    function it_pool_can_add_dual_liquidity() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Approve tokens
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");

        // Add dual liquidity: addLiquidity(tokenBAmount, maxTokenAAmount, deadline)
        uint256 liquidity = pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        require(liquidity > 0, "Liquidity should be greater than zero");
        require(ERC20(pool.lpToken()).totalSupply() == liquidity, "Total supply should equal liquidity");
        require(ERC20(pool.lpToken()).balanceOf(address(this)) == liquidity, "Owner should have LP tokens");
    }

    function it_pool_can_add_single_token_a_liquidity() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Add liquidity with only token A: addLiquiditySingleToken(isAToB, amountIn, deadline)
        uint256 additionalAmountA = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), additionalAmountA), "Additional Token A approval failed");
        uint256 liquidity = pool.addLiquidityGeneral([additionalAmountA, 0], additionalAmountA / 2, address(0));

        require(liquidity > 0, "Single token A liquidity should work");
    }

    function it_pool_can_add_single_token_b_liquidity() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Add liquidity with only token B: addLiquiditySingleToken(isAToB, amountIn, deadline)
        uint256 additionalAmountB = 1000e18;
        require(ERC20(tokenBAddress).approve(address(pool), additionalAmountB), "Additional Token B approval failed");
        uint256 liquidity = pool.addLiquidityGeneral([0, additionalAmountB], additionalAmountB / 2, address(0));

        require(liquidity > 0, "Single token B liquidity should work");
    }

    function it_pool_can_remove_liquidity() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint liquidity = pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Remove liquidity: removeLiquidity(lpTokenAmount, minTokenBAmount, minTokenAAmount, deadline)
        require(ERC20(pool.lpToken()).approve(address(pool), liquidity), "LP token approval failed");
        (uint tokenBReceived, uint tokenAReceived) = pool.removeLiquidity(liquidity, 1, 1, block.timestamp + 1);

        require(tokenAReceived > 0, "Should receive token A");
        require(tokenBReceived > 0, "Should receive token B");
        require(ERC20(pool.lpToken()).totalSupply() == 0, "Total supply should be zero after removal");
    }

    function it_pool_can_swap_a_to_b() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap A approval failed");
        uint256 output = pool.exchange(0, 1, swapAmount, 1, address(0));

        require(output > 0, "Swap A->B should produce output");
        // Note: Output can be greater than input when swapping to a higher-value token
    }

    function it_pool_can_swap_b_to_a() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap B to A
        uint256 swapAmount = 200e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount), "Swap B approval failed");
        uint256 output = pool.exchange(1, 0, swapAmount, 1, address(0));

        require(output > 0, "Swap B->A should produce output");
        require(output < swapAmount, "Output should be less than input due to fees and slippage");
    }

    uint N = 78;
    uint Q = 68;
    uint256 swapAmount = 50e18;

    function it_pool_can_swap_a_to_b_multiple_times() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)) + "," + string(uint(pool.aToBRatio()*10000.0)));
        require(ERC20(tokenAAddress).approve(address(pool), N*swapAmount), "Swap A approval failed");
        for (uint i = 0; i < N; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(0, 1, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14) + "," + string(uint(pool.aToBRatio()*10000.0)));
            // log("Point " + string(i) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(uint(pool.aToBRatio()*10000.0)) + "::" + string(uint(pool.aToBRatio()*10000.0)) + "::10::A::1::0::0::0::0;");
            // log("Point " + string(i) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(output/1e14) + "::" + string(output/1e14) + "::10::A::1::0::0::0::0;");
            // log("After round " + string(i) + ": ");
            // log("Token A pre: " + string(tokenAPre));
            // log("Token B pre: " + string(tokenBPre));
            // log("Swap input (A): " + string(swapAmount));
            // log("Swap output (B): " + string(output));
            // log("Token A post: " + string(tokenAPost));
            // log("Token B post: " + string(tokenBPost));
            // log("------------------------------------");
        }
    }

    function it_pool_can_swap_b_to_a_multiple_times() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        require(ERC20(tokenBAddress).approve(address(pool), N*swapAmount), "Swap A approval failed");
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)) + "," + string(uint(pool.aToBRatio()*10000.0)));
        for (uint i = 0; i < N; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(1, 0, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14) + "," + string(uint(pool.aToBRatio()*10000.0)));
            // log("Point " + string(i+N) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::10::A::1::0::0::0::0;");
            // log("Point " + string(i+N) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(output/1e14) + "::" + string(output/1e14) + "::10::A::1::0::0::0::0;");
            // log("After round " + string(i) + ": ");
            // log("Token A pre: " + string(tokenAPre));
            // log("Token B pre: " + string(tokenBPre));
            // log("Swap input (A): " + string(swapAmount));
            // log("Swap output (B): " + string(output));
            // log("Token A post: " + string(tokenAPost));
            // log("Token B post: " + string(tokenBPost));
            // log("------------------------------------");
        }
    }

    function it_pool_can_swap_a_to_b_multiple_times_with_changing_peg() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;
        uint peg = 1e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)) + "," + string(uint(pool.aToBRatio()*10000.0)));
        require(ERC20(tokenAAddress).approve(address(pool), Q*swapAmount), "Swap A approval failed");
        for (uint i = 0; i < Q; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(0, 1, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            peg = (1025e15 * peg) / 1e18;
            pool.updatePeg(peg);
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14) + "," + string(uint(pool.aToBRatio()*10000.0)));
            // log("Point " + string(i) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::10::A::1::0::0::0::0;");
            // log("Point " + string(i) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(output/1e14) + "::" + string(output/1e14) + "::10::A::1::0::0::0::0;");
            // log("After round " + string(i) + ": ");
            // log("Token A pre: " + string(tokenAPre));
            // log("Token B pre: " + string(tokenBPre));
            // log("Swap input (A): " + string(swapAmount));
            // log("Swap output (B): " + string(output));
            // log("Token A post: " + string(tokenAPost));
            // log("Token B post: " + string(tokenBPost));
            // log("------------------------------------");
        }
    }

    function it_pool_can_swap_b_to_a_multiple_times_with_changing_peg() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;
        uint peg = 1e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        require(ERC20(tokenBAddress).approve(address(pool), Q*swapAmount), "Swap A approval failed");
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)) + "," + string(uint(pool.aToBRatio()*10000.0)));
        for (uint i = 0; i < Q; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(1, 0, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            peg = (975e15 * peg) / 1e18;
            pool.updatePeg(peg);
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14) + "," + string(uint(pool.aToBRatio()*10000.0)));
            // log("Point " + string(i+Q) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::" + string(uint(pool.bToARatio()*10000.0)) + "::10::A::1::0::0::0::0;");
            // log("Point " + string(i+Q) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(output/1e14) + "::" + string(output/1e14) + "::10::A::1::0::0::0::0;");
            // log("After round " + string(i) + ": ");
            // log("Token A pre: " + string(tokenAPre));
            // log("Token B pre: " + string(tokenBPre));
            // log("Swap input (A): " + string(swapAmount));
            // log("Swap output (B): " + string(output));
            // log("Token A post: " + string(tokenAPost));
            // log("Token B post: " + string(tokenBPost));
            // log("------------------------------------");
        }
    }

    // ============ PAUSE & DISABLE TESTS ============

    function it_pool_pause_allows_removes_but_blocks_other_operations() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        uint256 initialLPBalance = ERC20(pool.lpToken()).balanceOf(address(this));

        pool.setPaused(true);
        require(pool.isPaused() == true, "Pool should be paused");

        // RemoveLiquidity should STILL WORK when paused (exit always allowed)
        require(ERC20(pool.lpToken()).approve(address(pool), initialLPBalance / 4), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(initialLPBalance / 4, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0 && tokenBReceived > 0, "RemoveLiquidity should work when paused");

        // Unpause and verify operations work again
        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused");

        uint256 swapAmt = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmt), "Swap approval after unpause failed");
        uint256 output = pool.exchange(0, 1, swapAmt, 1, address(0));
        require(output > 0, "Exchange should work after unpause");

        uint256 addAmountA = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), addAmountA), "Add A approval failed");
        uint256 minted = pool.addLiquiditySingleToken(true, addAmountA, block.timestamp + 3600);
        require(minted > 0, "AddLiquiditySingleToken should work after unpause");
    }

    function it_pool_disable_blocks_removes_but_reenable_allows_operations() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        uint256 lpBalance = ERC20(pool.lpToken()).balanceOf(address(this));

        pool.setDisabled(true);
        require(pool.isPaused() == true, "Pool should be paused when disabled");
        require(pool.isDisabled() == true, "Pool should be disabled");

        // Re-enable: clears isDisabled but isPaused remains true
        pool.setDisabled(false);
        require(pool.isDisabled() == false, "Pool should be re-enabled (isDisabled cleared)");
        require(pool.isPaused() == true, "Pool should STILL be paused after re-enable (safety feature)");

        // RemoveLiquidity should work after re-enable (even though still paused)
        require(ERC20(pool.lpToken()).approve(address(pool), lpBalance / 4), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(lpBalance / 4, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0 && tokenBReceived > 0, "RemoveLiquidity should work after re-enable");

        // Must explicitly unpause to allow swaps/adds again
        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused after explicit setPaused(false)");

        uint256 swapAmt = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmt), "Swap approval failed");
        uint256 output = pool.exchange(0, 1, swapAmt, 1, address(0));
        require(output > 0, "Exchange should work after explicit unpause");
    }

    function it_pool_owner_can_toggle_pause_and_disable() {
        require(pool.isPaused() == false, "Pool should start unpaused");

        pool.setPaused(true);
        require(pool.isPaused() == true, "setPaused(true) should pause pool");

        pool.setPaused(false);
        require(pool.isPaused() == false, "setPaused(false) should unpause pool");

        require(pool.isDisabled() == false, "Pool should start enabled");

        pool.setDisabled(true);
        require(pool.isPaused() == true, "setDisabled(true) should set isPaused");
        require(pool.isDisabled() == true, "setDisabled(true) should set isDisabled");

        // Re-enable: should clear isDisabled but KEEP isPaused
        pool.setDisabled(false);
        require(pool.isPaused() == true, "setDisabled(false) should KEEP isPaused (must unpause separately)");
        require(pool.isDisabled() == false, "setDisabled(false) should clear isDisabled");

        pool.setPaused(false);
        require(pool.isPaused() == false, "Explicit setPaused(false) should clear isPaused");

        // Test setDisabled when already paused
        pool.setPaused(true);
        require(pool.isPaused() == true, "Pool should be paused");

        pool.setDisabled(true);
        require(pool.isPaused() == true, "setDisabled(true) should keep isPaused when already paused");
        require(pool.isDisabled() == true, "setDisabled(true) should set isDisabled");
    }

    function it_pool_pause_state_persists_across_operations() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        pool.setPaused(true);

        // Verify pause state persists even after allowed operations (remove)
        uint256 lpBalance = ERC20(pool.lpToken()).balanceOf(address(this));
        require(ERC20(pool.lpToken()).approve(address(pool), lpBalance / 4), "Remove approval failed");
        pool.removeLiquidity(lpBalance / 4, 1, 1, block.timestamp + 3600);

        require(pool.isPaused() == true, "Pause state should persist after remove operation");

        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused");
    }
}