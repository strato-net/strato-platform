import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/// @notice flash() borrower fixture. `mode` selects how the callback settles:
///         0 repay principal + fee, 1 repay principal only (short the fee), 2 repay principal +
///         fee + 1e18 of coin 0 (overpay), 3 try to re-enter flash, 4 try to re-enter exchange,
///         5 try to re-enter addLiquidity, 6 try to re-enter removeLiquidity,
///         7 try to re-enter addLiquiditySingleToken, 8 try to re-enter migrateAllTokens,
///         9 try to re-enter syncAfterMigration, 10 try to re-enter getP
contract FlashBorrower {
    StablePool pool;
    address[] tokens;
    uint public mode;
    uint[] amounts;
    uint[] lastFees;
    string public lastNote;

    function init(address _pool, address[] _tokens) public {
        pool = StablePool(_pool);
        tokens = _tokens;
    }

    function go(address recipient, uint[] _amounts, uint _mode) public {
        mode = _mode;
        amounts = _amounts;
        pool.flash(recipient, _amounts, "note");
    }

    function lastFee(uint i) public view returns (uint) {
        return lastFees[i];
    }

    function stablePoolFlashCallback(uint[] fees, variadic data) external {
        require(msg.sender == address(pool), "FlashBorrower: bad pool");
        lastFees = fees;
        lastNote = string(data[0]);

        if (mode == 3) pool.flash(address(this), amounts, "nested");
        if (mode == 4) pool.exchange(0, 1, 1, 1, address(this));
        if (mode == 5) pool.addLiquidity(1, 1, block.timestamp + 3600);
        if (mode == 6) pool.removeLiquidity(1, 1, 1, block.timestamp + 3600);
        if (mode == 7) pool.addLiquiditySingleToken(true, 1, block.timestamp + 3600);
        if (mode == 8) pool.migrateAllTokens(address(this));
        if (mode == 9) pool.syncAfterMigration();
        if (mode == 10) pool.getP(0);

        for (uint i = 0; i < tokens.length; i++) {
            uint repay = mode == 1 ? amounts[i] : amounts[i] + fees[i];
            if (mode == 2 && i == 0) repay += 1e18;
            if (repay > 0) require(Token(tokens[i]).transfer(address(pool), repay), "repay failed");
        }
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

    uint N = 30;
    uint Q = 28;
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

    // ============ FLASH TESTS (PoolV3.flash parity) ============

    uint constant FLASH_LIQ = 2000e18;

    /// @dev Seed the pool with balanced liquidity so flash has something to lend and fees have LPs
    ///      to accrue to, and pin the flash fee at the 0.30% swap fee the pinned numbers assume (the
    ///      contract default is zero, see it_flash_fee_defaults_to_zero)
    function _seedLiquidity() internal {
        require(ERC20(tokenAAddress).approve(address(pool), FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), FLASH_LIQ), "Token B approval failed");
        pool.setFlashFee(pool.fee());
        pool.addLiquidityGeneral([FLASH_LIQ, FLASH_LIQ], 1, address(0));
    }

    function it_flash_fee_defaults_to_zero() {
        // A fresh pool lends for free until the owner sets flashFee
        require(ERC20(tokenAAddress).approve(address(pool), FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), FLASH_LIQ), "Token B approval failed");
        pool.addLiquidityGeneral([FLASH_LIQ, FLASH_LIQ], 1, address(0));
        FlashBorrower b = _newBorrower();
        uint amountA = 100e18;
        uint amountB = 50e18;
        require(pool.flashFee() == 0, "flashFee should default to 0");
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);

        b.go(address(b), [amountA, amountB], 0);

        require(b.lastFee(0) == 0 && b.lastFee(1) == 0, "Default flash must be free");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Free flash should leave the pool balance unchanged");
        require(pool.adminBalances(tokenAAddress) == 0, "No admin fee on a free flash");
        _requireTrackedBalancesInSync();
    }

    /// @dev Create a flash borrower holding enough of both tokens to pay any fee
    function _newBorrower() internal returns (FlashBorrower) {
        FlashBorrower b = new FlashBorrower();
        b.init(poolAddress, [tokenAAddress, tokenBAddress]);
        Token(tokenAAddress).mint(address(b), 100e18);
        Token(tokenBAddress).mint(address(b), 100e18);
        return b;
    }

    function _requireTrackedBalancesInSync() internal {
        require(pool.tokenBalances(tokenAAddress) == ERC20(tokenAAddress).balanceOf(poolAddress), "Token A tracked balance out of sync");
        require(pool.tokenBalances(tokenBAddress) == ERC20(tokenBAddress).balanceOf(poolAddress), "Token B tracked balance out of sync");
        require(pool.tokenABalance() == pool.tokenBalances(tokenAAddress), "tokenABalance out of sync");
        require(pool.tokenBBalance() == pool.tokenBalances(tokenBAddress), "tokenBBalance out of sync");
    }

    function it_flash_fee_is_pool_fee_rounded_up_and_split_with_admin() {
        // fee = ceil(amount * flashFee / FEE_DENOMINATOR); _seedLiquidity pins flashFee at the 0.30% swap fee:
        // 100e18 -> 3e17, 50e18 -> 1.5e17.
        // adminFee (50%) of what is repaid over the principal goes to adminBalances, the rest to LPs
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint poolBeforeB = ERC20(tokenBAddress).balanceOf(poolAddress);
        uint lpSupply = ERC20(pool.lpToken()).totalSupply();
        uint amountA = 100e18;
        uint amountB = 50e18;

        b.go(address(b), [amountA, amountB], 0);

        require(b.lastFee(0) == 300000000000000000, "feeA mismatch: " + string(b.lastFee(0)));
        require(b.lastFee(1) == 150000000000000000, "feeB mismatch: " + string(b.lastFee(1)));
        require(b.lastNote() == "note", "Callback data should be forwarded");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA + 300000000000000000, "Pool should hold the token A fee");
        require(ERC20(tokenBAddress).balanceOf(poolAddress) == poolBeforeB + 150000000000000000, "Pool should hold the token B fee");
        require(pool.adminBalances(tokenAAddress) == 150000000000000000, "Admin share of fee A mismatch: " + string(pool.adminBalances(tokenAAddress)));
        require(pool.adminBalances(tokenBAddress) == 75000000000000000, "Admin share of fee B mismatch: " + string(pool.adminBalances(tokenBAddress)));
        require(ERC20(pool.lpToken()).totalSupply() == lpSupply, "Flash must not change LP supply");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_is_configurable_independently_of_the_swap_fee() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amountA = 100e18;
        uint zero = 0;
        require(pool.flashFee() == pool.fee(), "Flash fee should be pinned at the swap fee");

        // 1% flash fee, swap fee untouched
        pool.setFlashFee(1e8);
        require(pool.flashFee() == 1e8 && pool.fee() == 30e6, "Only the flash fee should change");
        b.go(address(b), [amountA, zero], 0);
        require(b.lastFee(0) == 1e18, "1% flash fee mismatch: " + string(b.lastFee(0)));
        require(pool.adminBalances(tokenAAddress) == 5e17, "Admin share of 1% fee mismatch");

        // free flash loans
        pool.setFlashFee(0);
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        b.go(address(b), [amountA, zero], 0);
        require(b.lastFee(0) == 0, "Zero flash fee should cost nothing");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Free flash should leave the pool balance unchanged");

        // swaps still pay the swap fee
        require(ERC20(tokenAAddress).approve(address(pool), 100e18), "Swap approval failed");
        uint adminBefore = pool.adminBalances(tokenBAddress);
        pool.exchange(0, 1, 100e18, 1, address(0));
        require(pool.adminBalances(tokenBAddress) > adminBefore, "Swap fee must still accrue");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_is_capped_and_owner_only() {
        string err;
        try pool.setFlashFee(5e9 + 1) { } catch Error(string e) { err = e; }
        require(err == "Cannot set flash fee higher than MAX_FEE", "Flash fee above MAX_FEE must revert, got: " + err);
        pool.setFlashFee(5e9);
        require(pool.flashFee() == 5e9, "MAX_FEE should be accepted");

        User stranger = new User();
        bool thrown = false;
        try stranger.do(poolAddress, "setFlashFee", uint(0)) { } catch { thrown = true; }
        require(thrown, "Non-owner must not set the flash fee");
        require(pool.flashFee() == 5e9, "Flash fee must be unchanged");
    }

    function it_flash_dust_fee_rounds_up() {
        // 1 wei -> 1 wei fee; 333 -> 1; 334 -> 2; 1000 -> 3
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint zero = 0;
        uint one = 1;

        b.go(address(b), [one, zero], 0);
        require(b.lastFee(0) == 1 && b.lastFee(1) == 0, "1 wei should cost 1 wei");
        uint a = 333;
        uint c = 334;
        b.go(address(b), [a, c], 0);
        require(b.lastFee(0) == 1, "333 wei should cost 1 wei: " + string(b.lastFee(0)));
        require(b.lastFee(1) == 2, "334 wei should cost 2 wei: " + string(b.lastFee(1)));
        uint k = 1000;
        b.go(address(b), [k, zero], 0);
        require(b.lastFee(0) == 3, "1000 wei should cost 3 wei: " + string(b.lastFee(0)));
    }

    function it_flash_overpayment_is_split_like_a_fee() {
        // paid is the balance delta, so a borrower repaying 1e18 over the fee donates it:
        // 1.3e18 paid -> 6.5e17 to admin, the rest to LPs
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint amountA = 100e18;
        uint zero = 0;

        b.go(address(b), [amountA, zero], 2);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA + 1300000000000000000, "Pool should hold fee + overpayment");
        require(pool.adminBalances(tokenAAddress) == 650000000000000000, "Admin share mismatch: " + string(pool.adminBalances(tokenAAddress)));
        require(pool.adminBalances(tokenBAddress) == 0, "No token B fee expected");
        _requireTrackedBalancesInSync();
    }

    function it_flash_admin_share_is_collectable() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint amountA = 100e18;
        uint zero = 0;

        b.go(address(b), [amountA, zero], 0);
        pool.withdrawAdminFees();

        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 150000000000000000, "FeeCollector should receive the admin share");
        require(pool.adminBalances(tokenAAddress) == 0, "Admin balance should be cleared");
        _requireTrackedBalancesInSync();
    }

    function it_flash_pays_recipient_and_charges_caller() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        User recipient = new User();
        uint borrowerBeforeA = ERC20(tokenAAddress).balanceOf(address(b));
        uint amountA = 10e18;
        uint zero = 0;

        b.go(address(recipient), [amountA, zero], 0);

        require(ERC20(tokenAAddress).balanceOf(address(recipient)) == 10e18, "Recipient should receive the principal");
        // the caller repaid principal + fee out of its own float
        require(ERC20(tokenAAddress).balanceOf(address(b)) == borrowerBeforeA - 10e18 - 30000000000000000, "Caller pays principal + fee");
    }

    function it_flash_zero_amounts_is_a_callback_only_noop() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint zero = 0;

        b.go(address(b), [zero, zero], 0);

        require(b.lastFee(0) == 0 && b.lastFee(1) == 0, "Zero principal, zero fee");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Nothing should move");
        require(pool.adminBalances(tokenAAddress) == 0 && pool.adminBalances(tokenBAddress) == 0, "No admin fee");
    }

    function it_flash_reverts_when_underpaid() {
        // repaying the principal without the fee unwinds the whole call
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint borrowerBeforeA = ERC20(tokenAAddress).balanceOf(address(b));
        uint amount = 100e18;
        uint zero = 0;

        string err;
        try b.go(address(b), [amount, zero], 1) { } catch Error(string e) { err = e; }
        require(err == "Flash loan not repaid", "Shorting the token A fee must revert, got: " + err);

        err = "";
        try b.go(address(b), [zero, amount], 1) { } catch Error(string e) { err = e; }
        require(err == "Flash loan not repaid", "Shorting the token B fee must revert, got: " + err);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Pool balance must be untouched");
        require(ERC20(tokenAAddress).balanceOf(address(b)) == borrowerBeforeA, "Borrower balance must be untouched");
        require(pool.adminBalances(tokenAAddress) == 0, "No admin fee on a failed flash");
    }

    function it_flash_reverts_when_pool_is_empty() {
        // nothing to pay fees to, so no flash
        FlashBorrower b = _newBorrower();
        Token(tokenAAddress).mint(poolAddress, 10e18); // pool has tokens but no LPs
        uint amount = 1e18;
        uint zero = 0;

        string err;
        try b.go(address(b), [amount, zero], 0) { } catch Error(string e) { err = e; }
        require(err == "POOL_EMPTY", "Flash on an empty pool must revert POOL_EMPTY, got: " + err);
    }

    function it_flash_rejects_more_than_the_pool_holds() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint big = 1e30;
        uint zero = 0;

        bool thrown = false;
        try b.go(address(b), [big, zero], 0) { } catch { thrown = true; }
        require(thrown, "Borrowing more than the reserves must revert");
    }

    function it_flash_cannot_reenter_the_pool() {
        // one lock for everything: the callback can neither flash, exchange, nor touch liquidity.
        // removeLiquidity was the unguarded wrapper around _removeLiquidityGeneral
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amount = 1e18;
        uint zero = 0;

        string err;
        try b.go(address(b), [amount, zero], 3) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "Nested flash must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 4) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "Exchange from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 5) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "addLiquidity from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 6) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "removeLiquidity from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 7) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "addLiquiditySingleToken from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 10) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "getP from the callback must revert REENTRANT, got: " + err);

        // migrate/sync are owner-callable; hand the borrower the owner key so the lock is what fires
        pool.transferOwnership(address(b));

        err = "";
        try b.go(address(b), [amount, zero], 8) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "migrateAllTokens from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), [amount, zero], 9) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "syncAfterMigration from the callback must revert REENTRANT, got: " + err);

        // the lock is released again after the failed attempts
        b.go(address(b), [amount, zero], 0);
        require(b.lastFee(0) == 3000000000000000, "Flash should work after failed reentry");
    }

    function it_flash_caller_without_callback_reverts() {
        _seedLiquidity();
        User stranger = new User();
        uint amount = 1e18;
        uint zero = 0;

        bool thrown = false;
        try {
            stranger.do(poolAddress, "flash", address(stranger), [amount, zero], "x");
        } catch {
            thrown = true;
        }
        require(thrown, "A caller without stablePoolFlashCallback must revert");
    }

    function it_flash_respects_pause_and_input_guards() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amount = 1e18;
        uint zero = 0;

        pool.setPaused(true);
        bool thrown = false;
        try b.go(address(b), [amount, zero], 0) { } catch { thrown = true; }
        require(thrown, "Paused pool should reject flash");
        pool.setPaused(false);

        thrown = false;
        try b.go(address(b), [amount], 0) { } catch { thrown = true; }
        require(thrown, "Wrong amounts length should revert");

        thrown = false;
        try b.go(address(0), [amount, zero], 0) { } catch { thrown = true; }
        require(thrown, "Zero recipient should revert");

        b.go(address(b), [amount, zero], 0);
        require(b.lastFee(0) == 3000000000000000, "Flash should work once guards clear");
    }

    function it_flash_pause_blocks_only_flash() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amount = 1e18;
        uint zero = 0;

        pool.setFlashPaused(true);
        require(pool.isFlashPaused() && !pool.isPaused(), "Flash pause must not pause the pool");
        string err;
        try b.go(address(b), [amount, zero], 0) { } catch Error(string e) { err = e; }
        require(err == "Flash is paused", "Flash-paused pool should reject flash, got: " + err);

        // swaps are unaffected
        require(ERC20(tokenAAddress).approve(address(pool), amount), "Token A approval failed");
        require(pool.exchange(0, 1, amount, 1, address(0)) > 0, "Exchange should work while flash is paused");

        User stranger = new User();
        bool thrown = false;
        try {
            stranger.do(poolAddress, "setFlashPaused", false);
        } catch {
            thrown = true;
        }
        require(thrown, "Non-owner setFlashPaused should revert");
        require(pool.isFlashPaused(), "Stranger must not change the flash pause");

        pool.setFlashPaused(false);
        b.go(address(b), [amount, zero], 0);
        require(b.lastFee(0) == 3000000000000000, "Flash should work once resumed");
    }

    function it_flash_works_on_a_multi_token_pool() {
        // the same path over a 3-coin pool, borrowing only the third coin
        address tokenCAddress = m.tokenFactory().createToken(
            "Token C", "Test Token C", emptyArray, emptyArray, emptyArray, "TKC", 10000000e18, 18
        );
        Token(tokenCAddress).setStatus(2);
        Token(tokenCAddress).mint(address(this), 100000000e18);

        fastForward(100);
        uint one = 1;
        uint rate = 1e18;
        address multiAddress = m.poolFactory().createMultiTokenStablePool(
            [tokenAAddress, tokenBAddress, tokenCAddress],
            [rate, rate, rate],
            [one, one, one],
            [address(0), address(0), address(0)]
        );
        StablePool multi = StablePool(multiAddress);
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(multi.lpToken()), "mint", multiAddress);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(multi.lpToken()), "burn", multiAddress);

        require(ERC20(tokenAAddress).approve(multiAddress, FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(multiAddress, FLASH_LIQ), "Token B approval failed");
        require(ERC20(tokenCAddress).approve(multiAddress, FLASH_LIQ), "Token C approval failed");
        multi.addLiquidityGeneral([FLASH_LIQ, FLASH_LIQ, FLASH_LIQ], 1, address(0));
        multi.setFlashFee(multi.fee()); // pin at the swap fee, as _seedLiquidity does

        FlashBorrower b = new FlashBorrower();
        b.init(multiAddress, [tokenAAddress, tokenBAddress, tokenCAddress]);
        Token(tokenCAddress).mint(address(b), 100e18);
        uint poolBeforeC = ERC20(tokenCAddress).balanceOf(multiAddress);
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(multiAddress);
        uint amountC = 10e18;
        uint zero = 0;

        b.go(address(b), [zero, zero, amountC], 0);

        require(b.lastFee(0) == 0 && b.lastFee(1) == 0, "Unborrowed coins carry no fee");
        require(b.lastFee(2) == 30000000000000000, "feeC mismatch: " + string(b.lastFee(2)));
        require(ERC20(tokenCAddress).balanceOf(multiAddress) == poolBeforeC + 30000000000000000, "Pool should hold the token C fee");
        require(ERC20(tokenAAddress).balanceOf(multiAddress) == poolBeforeA, "Token A must be untouched");
        require(multi.adminBalances(tokenCAddress) == 15000000000000000, "Admin share of fee C mismatch: " + string(multi.adminBalances(tokenCAddress)));
        require(multi.tokenBalances(tokenCAddress) == ERC20(tokenCAddress).balanceOf(multiAddress), "Token C tracked balance out of sync");
    }

    // ============ FLASH INVARIANT TESTS (review additions) ============

    function it_flash_raises_D_and_lps_withdraw_their_share() {
        // the LP half of the fee is real pool value: D grows, and once the admin half is withdrawn
        // the sole LP exits with principal + 1.5e17
        _seedLiquidity();
        uint lp = ERC20(pool.lpToken()).balanceOf(address(this));
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint d0 = pool.computeInvariant();
        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));
        uint meBeforeB = ERC20(tokenBAddress).balanceOf(address(this));
        uint amountA = 100e18;
        uint zero = 0;

        b.go(address(b), [amountA, zero], 0);

        uint d1 = pool.computeInvariant();
        require(d1 > d0, "D must grow by the LP share of the fee: " + string(d0) + " -> " + string(d1));
        require(pool.tokenBalances(tokenAAddress) == 2000300000000000000000, "Tracked A should hold the whole fee");
        require(pool.adminBalances(tokenAAddress) == 150000000000000000, "Admin half mismatch");
        require(ERC20(pool.lpToken()).totalSupply() == lp, "Flash must not change LP supply");
        // oracle bookkeeping stays sane: spot near parity, D oracle populated
        require(pool.lastPrice(0) > 990000000000000000 && pool.lastPrice(0) < 1010000000000000000, "Spot price should stay near parity: " + string(pool.lastPrice(0)));
        require(pool.dOracle() > 0, "D oracle should be populated");

        pool.withdrawAdminFees();
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 150000000000000000, "Collector should get the admin half");
        uint[] mins = [zero, zero];
        pool.removeLiquidityGeneral(lp, mins, address(this), false);
        require(ERC20(tokenAAddress).balanceOf(address(this)) == meBeforeA + FLASH_LIQ + 150000000000000000, "LP should withdraw principal + LP half of the fee: " + string(ERC20(tokenAAddress).balanceOf(address(this)) - meBeforeA));
        require(ERC20(tokenBAddress).balanceOf(address(this)) == meBeforeB + FLASH_LIQ, "Token B principal should be intact");
        require(pool.tokenBalances(tokenAAddress) == 0 && ERC20(tokenAAddress).balanceOf(poolAddress) == 0, "Pool should be empty after the exit");
        require(ERC20(pool.lpToken()).totalSupply() == 0, "LP supply should be zero");
    }

    function it_flash_fee_accrues_pro_rata_across_multiple_lps() {
        // two LPs at 2:1 on a balanced pool (StableSwap mints LP = D, so the 2000/2000 seed holds
        // 4000e18 LP and a balanced 1000/1000 deposit mints ~2000e18); after the admin half is
        // withdrawn the 1.5e17 LP half splits 1e17 / 5e16 (Newton D within a wei) and the pool
        // drains to zero
        _seedLiquidity();
        require(ERC20(pool.lpToken()).totalSupply() == 4000e18, "Seed should mint LP = D = 4000e18: " + string(ERC20(pool.lpToken()).totalSupply()));
        User lp2 = new User();
        uint k = 1000e18;
        uint one = 1;
        uint deadline = block.timestamp + 3600;
        Token(tokenAAddress).mint(address(lp2), k);
        Token(tokenBAddress).mint(address(lp2), k);
        lp2.do(tokenAAddress, "approve", poolAddress, k);
        lp2.do(tokenBAddress, "approve", poolAddress, k);
        lp2.do(poolAddress, "addLiquidity", k, k, deadline);
        uint lp2Amount = ERC20(pool.lpToken()).balanceOf(address(lp2));
        require(lp2Amount >= 2 * k - 2 && lp2Amount <= 2 * k + 2, "Balanced deposit should mint ~2000e18 LP (1/3 of supply): " + string(lp2Amount));
        uint myLp = ERC20(pool.lpToken()).balanceOf(address(this));
        FlashBorrower b = _newBorrower();
        uint amountA = 100e18;
        uint zero = 0;
        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));

        b.go(address(b), [amountA, zero], 0);
        pool.withdrawAdminFees();
        require(pool.tokenBalances(tokenAAddress) == 3000150000000000000000, "Tracked A after admin withdrawal mismatch: " + string(pool.tokenBalances(tokenAAddress)));

        lp2.do(poolAddress, "removeLiquidity", lp2Amount, one, one, deadline);
        uint lp2A = ERC20(tokenAAddress).balanceOf(address(lp2));
        require(lp2A >= 1000050000000000000000 - 3 && lp2A <= 1000050000000000000000 + 3, "Second LP should get principal + 1/3 of the LP half: " + string(lp2A));
        require(ERC20(tokenBAddress).balanceOf(address(lp2)) >= k - 3 && ERC20(tokenBAddress).balanceOf(address(lp2)) <= k + 3, "Second LP token B principal should be intact");

        pool.removeLiquidity(myLp, 1, 1, deadline);
        uint myA = ERC20(tokenAAddress).balanceOf(address(this)) - meBeforeA;
        require(myA >= 2000100000000000000000 - 3 && myA <= 2000100000000000000000 + 3, "First LP should get principal + 2/3 of the LP half: " + string(myA));
        require(lp2A + myA == 3000150000000000000000, "Both exits must drain exactly the tracked A");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == 0 && ERC20(tokenBAddress).balanceOf(poolAddress) == 0, "Pool should hold nothing after both LPs exit");
        require(ERC20(pool.lpToken()).totalSupply() == 0, "LP supply should be zero");
    }

    function it_flash_leaves_no_excess_for_exchangeReceived_to_claim() {
        // exchangeReceived trusts balanceOf - tokenBalances; a flash must leave that gap at zero
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amountA = 100e18;
        uint zero = 0;

        b.go(address(b), [amountA, zero], 0);
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == pool.tokenBalances(tokenAAddress), "No untracked tokens may remain after a flash");

        string err;
        try pool.exchangeReceived(0, 1, 1e18, 1, address(0)) { } catch Error(string e) { err = e; }
        require(err == "Cannot transfer ??", "exchangeReceived without a prior transfer must revert, got: " + err);

        // a genuine optimistic transfer still works
        require(ERC20(tokenAAddress).transfer(poolAddress, 10e18), "Transfer failed");
        uint out = pool.exchangeReceived(0, 1, 10e18, 1, address(0));
        require(out > 0, "Genuine exchangeReceived should work");
        _requireTrackedBalancesInSync();
    }

    function it_flash_can_borrow_the_entire_balance_but_not_a_wei_more() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint whole = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint zero = 0;
        require(whole == FLASH_LIQ, "Pool should hold exactly the seeded A");

        b.go(address(b), [whole, zero], 0);

        require(b.lastFee(0) == 6000000000000000000, "Fee on the whole balance should be 6e18: " + string(b.lastFee(0)));
        require(pool.tokenBalances(tokenAAddress) == 2006000000000000000000, "Tracked A should hold principal + fee");
        require(pool.adminBalances(tokenAAddress) == 3000000000000000000, "Admin half mismatch");
        _requireTrackedBalancesInSync();

        uint tooMuch = ERC20(tokenAAddress).balanceOf(poolAddress) + 1;
        string err;
        try b.go(address(b), [tooMuch, zero], 0) { } catch Error(string e) { err = e; }
        require(err == "ERC20: insufficient balance", "One wei over the balance must revert in the token, got: " + err);
        _requireTrackedBalancesInSync();
    }

    function it_flash_leaves_pre_existing_excess_untouched() {
        _seedLiquidity();
        Token(tokenAAddress).mint(poolAddress, 5e18);
        FlashBorrower b = _newBorrower();
        uint amountA = 100e18;
        uint zero = 0;
        require(ERC20(tokenAAddress).balanceOf(poolAddress) - pool.tokenBalances(tokenAAddress) == 5e18, "Excess should be 5e18 before");

        b.go(address(b), [amountA, zero], 0);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) - pool.tokenBalances(tokenAAddress) == 5e18, "Excess must be unchanged by a flash");
        require(pool.tokenBalances(tokenAAddress) == 2000300000000000000000, "Tracked A should only grow by the fee");
    }

    function it_flash_is_blocked_while_disabled() {
        _seedLiquidity();
        FlashBorrower b = _newBorrower();
        uint amount = 1e18;
        uint zero = 0;

        pool.setDisabled(true);
        string err;
        try b.go(address(b), [amount, zero], 0) { } catch Error(string e) { err = e; }
        require(err == "Pool is paused", "Disabled pool must reject flash, got: " + err);

        pool.setDisabled(false);
        pool.setPaused(false);
        b.go(address(b), [amount, zero], 0);
        require(b.lastFee(0) == 3000000000000000, "Flash should work once re-enabled");
    }
}
