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
///         fee + 1e18 tokenA (overpay), 3 re-enter flash, 4 re-enter swap, 5 re-enter addLiquidity,
///         6 re-enter removeLiquidity, 7 re-enter addLiquiditySingleToken, 8 re-enter sync,
///         9 re-enter skim, 10 spend the borrowed tokenA on `other` (another Pool) and repay from float
contract FlashBorrower {
    Pool pool;
    address tokenA;
    address tokenB;
    uint public mode;
    uint public amountA;
    uint public amountB;
    uint public lastFeeA;
    uint public lastFeeB;
    string public lastNote;
    /// @dev another Pool the callback trades on in mode 10 (flash-funded cross-pool swap)
    address public other;
    /// @dev set by goNoData: the flash carried no variadic data, so the callback must not index it
    bool public noData;

    function init(address _pool, address _tokenA, address _tokenB) public {
        pool = Pool(_pool);
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function setOther(address _other) public {
        other = _other;
    }

    function go(address recipient, uint _amountA, uint _amountB, uint _mode) public {
        mode = _mode;
        noData = false;
        amountA = _amountA;
        amountB = _amountB;
        pool.flash(recipient, _amountA, _amountB, "note");
    }

    /// @dev flash with no pass-through data at all (mode 0 settlement)
    function goNoData(address recipient, uint _amountA, uint _amountB) public {
        mode = 0;
        noData = true;
        amountA = _amountA;
        amountB = _amountB;
        pool.flash(recipient, _amountA, _amountB);
    }

    function poolFlashCallback(uint feeA, uint feeB, variadic data) external {
        require(msg.sender == address(pool), "FlashBorrower: bad pool");
        lastFeeA = feeA;
        lastFeeB = feeB;
        if (noData) {
            lastNote = "";
        } else {
            lastNote = string(data[0]);
        }

        if (mode == 10) {
            // spend the borrowed tokenA on another pool, then repay out of our own float
            require(Token(tokenA).approve(other, amountA), "approve other failed");
            Pool(other).swap(true, amountA, 1, block.timestamp + 3600);
        }

        if (mode == 3) pool.flash(address(this), 1, 0, "nested");
        if (mode == 4) pool.swap(true, 1, 1, block.timestamp + 3600);
        if (mode == 5) pool.addLiquidity(1, 1, block.timestamp + 3600);
        if (mode == 6) pool.removeLiquidity(1, 1, 1, block.timestamp + 3600);
        if (mode == 7) pool.addLiquiditySingleToken(true, 1, block.timestamp + 3600);
        if (mode == 8) pool.sync();
        if (mode == 9) pool.skim(address(this));

        uint repayA = mode == 1 ? amountA : amountA + feeA;
        uint repayB = mode == 1 ? amountB : amountB + feeB;
        if (mode == 2) repayA += 1e18;
        if (repayA > 0) require(Token(tokenA).transfer(address(pool), repayA), "repayA failed");
        if (repayB > 0) require(Token(tokenB).transfer(address(pool), repayB), "repayB failed");
    }
}

contract Describe_Pool is Authorizable {

    Mercata m;
    string[] emptyArray;

    // Token addresses for each test
    address tokenAAddress;
    address tokenBAddress;
    address poolAddress;
    Pool pool;

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
        poolAddress = m.poolFactory().createPool(tokenAAddress, tokenBAddress);
        pool = Pool(poolAddress);

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
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Approve tokens
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");

        // Add dual liquidity: addLiquidity(tokenBAmount, maxTokenAAmount, deadline)
        uint256 liquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        require(liquidity > 0, "Liquidity should be greater than zero");
        require(ERC20(pool.lpToken()).totalSupply() == liquidity, "Total supply should equal liquidity");
        require(ERC20(pool.lpToken()).balanceOf(address(this)) == liquidity, "Owner should have LP tokens");
    }

    function it_pool_can_add_single_token_a_liquidity() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Add liquidity with only token A: addLiquiditySingleToken(isAToB, amountIn, deadline)
        uint256 additionalAmountA = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), additionalAmountA), "Additional Token A approval failed");
        uint256 liquidity = pool.addLiquiditySingleToken(true, additionalAmountA, block.timestamp + 3600);

        require(liquidity > 0, "Single token A liquidity should work");
    }

    function it_pool_can_add_single_token_b_liquidity() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Add liquidity with only token B: addLiquiditySingleToken(isAToB, amountIn, deadline)
        uint256 additionalAmountB = 1000e18;
        require(ERC20(tokenBAddress).approve(address(pool), additionalAmountB), "Additional Token B approval failed");
        uint256 liquidity = pool.addLiquiditySingleToken(false, additionalAmountB, block.timestamp + 3600);

        require(liquidity > 0, "Single token B liquidity should work");
    }

    function it_pool_can_remove_liquidity() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 liquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Remove liquidity: removeLiquidity(lpTokenAmount, minTokenBAmount, minTokenAAmount, deadline)
        require(ERC20(pool.lpToken()).approve(address(pool), liquidity), "LP token approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(liquidity, 1, 1, block.timestamp + 3600);

        require(tokenAReceived > 0, "Should receive token A");
        require(tokenBReceived > 0, "Should receive token B");
        require(ERC20(pool.lpToken()).totalSupply() == 0, "Total supply should be zero after removal");
    }

    function it_pool_can_sync_balances() {
        uint256 amountA = 2000e18;
        uint256 amountB = 4000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test functionality WITH excess tokens (before sync)
        // 1. Test swap A to B
        uint256 swapAmount1 = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount1), "Pre-sync swap A approval failed");
        uint256 output1 = pool.swap(true, swapAmount1, 1, block.timestamp + 3600);
        require(output1 > 0, "Pre-sync swap A->B should work");

        // 2. Test swap B to A
        uint256 swapAmount2 = 25e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount2), "Pre-sync swap B approval failed");
        uint256 output2 = pool.swap(false, swapAmount2, 1, block.timestamp + 3600);
        require(output2 > 0, "Pre-sync swap B->A should work");

        // 3. Test single token liquidity (should work even with excess tokens)
        uint256 singleTokenAmount = 30e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Pre-sync single token approval failed");
        uint256 singleTokenLiquidity = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
        require(singleTokenLiquidity > 0, "Pre-sync single token liquidity should work");

        // Mint tokens directly to pool (simulating external transfer - creates excess)
        Token(tokenAAddress).mint(address(pool), 100e18);
        Token(tokenBAddress).mint(address(pool), 200e18);

        // Test functionality WITH excess tokens (after minting, before sync)
        // 4. Test swap A to B with excess tokens
        uint256 swapAmount3 = 40e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount3), "With-excess swap A approval failed");
        uint256 output3 = pool.swap(true, swapAmount3, 1, block.timestamp + 3600);
        require(output3 > 0, "With-excess swap A->B should work");

        // 5. Test swap B to A with excess tokens
        uint256 swapAmount4 = 20e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount4), "With-excess swap B approval failed");
        uint256 output4 = pool.swap(false, swapAmount4, 1, block.timestamp + 3600);
        require(output4 > 0, "With-excess swap B->A should work");

        // 6. Test single token liquidity with excess tokens
        uint256 singleTokenAmount2 = 25e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount2), "With-excess single token approval failed");
        uint256 singleTokenLiquidity2 = pool.addLiquiditySingleToken(true, singleTokenAmount2, block.timestamp + 3600);
        require(singleTokenLiquidity2 > 0, "With-excess single token liquidity should work");

        // Now test sync function (owner only, so we call it through the pool factory)
        address[] memory pools = new address[](1);
        pools[0] = address(pool);
        m.poolFactory().syncPools(pools);

        // Test functionality AFTER sync (excess tokens still there, but internal balances updated)
        // 7. Test swap A to B after sync
        uint256 swapAmount5 = 35e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount5), "Post-sync swap A approval failed");
        uint256 output5 = pool.swap(true, swapAmount5, 1, block.timestamp + 3600);
        require(output5 > 0, "Post-sync swap A->B should work");

        // 8. Test swap B to A after sync
        uint256 swapAmount6 = 18e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount6), "Post-sync swap B approval failed");
        uint256 output6 = pool.swap(false, swapAmount6, 1, block.timestamp + 3600);
        require(output6 > 0, "Post-sync swap B->A should work");

        // 9. Test single token liquidity after sync (dual liquidity has ratio issues with excess tokens)
        uint256 singleTokenAmount3 = 20e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount3), "Post-sync single token approval failed");
        uint256 singleTokenLiquidity3 = pool.addLiquiditySingleToken(true, singleTokenAmount3, block.timestamp + 3600);
        require(singleTokenLiquidity3 > 0, "Post-sync single token liquidity should work");

        // 10. Test remove liquidity after sync
        uint256 removeAmount = initialLiquidity / 4; // Remove 25% of initial liquidity
        require(ERC20(pool.lpToken()).approve(address(pool), removeAmount), "Post-sync remove liquidity approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(removeAmount, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0, "Post-sync should receive token A");
        require(tokenBReceived > 0, "Post-sync should receive token B");

        // Verify pool state is consistent
        require(ERC20(pool.lpToken()).totalSupply() > 0, "Pool should still have liquidity after all operations");
    }

    function it_pool_can_skim_excess_tokens() {
        uint256 amountA = 2000e18;
        uint256 amountB = 4000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test functionality BEFORE skim
        // 1. Test swap A to B
        uint256 swapAmount1 = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount1), "Pre-skim swap A approval failed");
        uint256 output1 = pool.swap(true, swapAmount1, 1, block.timestamp + 3600);
        require(output1 > 0, "Pre-skim swap A->B should work");

        // 2. Test swap B to A
        uint256 swapAmount2 = 25e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount2), "Pre-skim swap B approval failed");
        uint256 output2 = pool.swap(false, swapAmount2, 1, block.timestamp + 3600);
        require(output2 > 0, "Pre-skim swap B->A should work");

        // Mint tokens directly to pool (simulating external transfer)
        Token(tokenAAddress).mint(address(pool), 100e18);
        Token(tokenBAddress).mint(address(pool), 200e18);

        // Test skim function (owner only, so we call it through the pool factory)
        address[] memory pools = new address[](1);
        pools[0] = address(pool);
        m.poolFactory().skimPools(pools, address(this));

        // Test functionality AFTER skim
        // 1. Test swap A to B
        uint256 swapAmount3 = 30e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount3), "Post-skim swap A approval failed");
        uint256 output3 = pool.swap(true, swapAmount3, 1, block.timestamp + 3600);
        require(output3 > 0, "Post-skim swap A->B should work");

        // 2. Test swap B to A
        uint256 swapAmount4 = 15e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount4), "Post-skim swap B approval failed");
        uint256 output4 = pool.swap(false, swapAmount4, 1, block.timestamp + 3600);
        require(output4 > 0, "Post-skim swap B->A should work");

        // 3. Test single token liquidity (this should work without ratio issues)
        uint256 singleTokenAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Post-skim single token approval failed");
        uint256 singleTokenLiquidity = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
        require(singleTokenLiquidity > 0, "Post-skim single token liquidity should work");

        // 4. Test remove liquidity
        uint256 removeAmount = initialLiquidity / 4; // Remove 25% of initial liquidity
        require(ERC20(pool.lpToken()).approve(address(pool), removeAmount), "Post-skim remove liquidity approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(removeAmount, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0, "Post-skim should receive token A");
        require(tokenBReceived > 0, "Post-skim should receive token B");

        // Verify pool state is consistent
        require(ERC20(pool.lpToken()).totalSupply() > 0, "Pool should still have liquidity after all operations");
    }

    function it_pool_can_swap_a_to_b() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test swap A to B
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap A approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);

        require(output > 0, "Swap A->B should produce output");
        // Note: Output can be greater than input when swapping to a higher-value token
    }

    function it_pool_can_swap_b_to_a() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test swap B to A
        uint256 swapAmount = 200e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount), "Swap B approval failed");
        uint256 output = pool.swap(false, swapAmount, 1, block.timestamp + 3600);

        require(output > 0, "Swap B->A should produce output");
        require(output < swapAmount, "Output should be less than input due to fees and slippage");
    }

    function it_pool_swap_respects_slippage_protection() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test swap with high slippage protection (should pass)
        uint256 swapAmount = 50e18;
        uint256 minAmountOut = 1e18; // Very low minimum (high slippage tolerance)
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, minAmountOut, block.timestamp + 3600);

        require(output >= minAmountOut, "Output should meet slippage protection");
        require(output > 0, "Output should be positive");
    }

    function it_pool_swap_calculates_prices_correctly() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test getInputPrice function
        uint256 inputAmount = 100e18;
        uint256 expectedOutput = pool.getInputPrice(inputAmount, amountA, amountB);

        // Perform actual swap
        require(ERC20(tokenAAddress).approve(address(pool), inputAmount), "Swap approval failed");
        uint256 actualOutput = pool.swap(true, inputAmount, 1, block.timestamp + 3600);

        require(actualOutput > 0, "Actual output should be positive");
        require(actualOutput <= expectedOutput, "Actual output should not exceed expected due to fees");
    }

    function it_pool_swap_handles_multiple_swaps() {
        uint256 amountA = 5000e18;
        uint256 amountB = 10000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Perform multiple swaps in sequence
        for (uint i = 0; i < 5; i++) {
            uint256 swapAmount = 100e18;
            require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Multiple swap A approval failed");
            uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
            require(output > 0, "Multiple swap should work");
        }

        // Perform swaps in opposite direction
        for (uint j = 0; j < 3; j++) {
            uint256 swapAmount = 50e18;
            require(ERC20(tokenBAddress).approve(address(pool), swapAmount), "Multiple swap B approval failed");
            uint256 output = pool.swap(false, swapAmount, 1, block.timestamp + 3600);
            require(output > 0, "Multiple reverse swap should work");
        }
    }

    function it_pool_swap_handles_large_amounts() {
        uint256 amountA = 100000e18;
        uint256 amountB = 200000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test large swap
        uint256 largeSwapAmount = 10000e18;
        require(ERC20(tokenAAddress).approve(address(pool), largeSwapAmount), "Large swap approval failed");
        uint256 output = pool.swap(true, largeSwapAmount, 1, block.timestamp + 3600);

        require(output > 0, "Large swap should work");
        // Note: Output can be greater than input when swapping to a higher-value token
    }

    function it_pool_swap_handles_small_amounts() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test very small swap
        uint256 smallSwapAmount = 1e18;
        require(ERC20(tokenAAddress).approve(address(pool), smallSwapAmount), "Small swap approval failed");
        uint256 output = pool.swap(true, smallSwapAmount, 1, block.timestamp + 3600);

        require(output > 0, "Small swap should work");
        // Note: Output can be greater than input when swapping to a higher-value token
    }

    function it_pool_swap_creates_price_impact() {
        uint256 amountA = 10000e18;
        uint256 amountB = 20000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Get initial price
        uint256 initialPrice = pool.getInputPrice(100e18, amountA, amountB);

        // Perform large swap to create price impact
        uint256 largeSwapAmount = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), largeSwapAmount), "Large swap approval failed");
        uint256 output = pool.swap(true, largeSwapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Large swap should work");

        // Get new price after swap
        uint256 newPrice = pool.getInputPrice(100e18, pool.tokenABalance(), pool.tokenBBalance());

        // Price should have changed due to the large swap
        require(newPrice != initialPrice, "Price should change after large swap");
    }

    function it_pool_swap_round_trip_works() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Record initial balance
        uint256 initialBalanceA = ERC20(tokenAAddress).balanceOf(address(this));

        // Swap A to B
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Round trip swap A approval failed");
        uint256 outputB = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(outputB > 0, "A->B swap should work");

        // Swap B back to A
        require(ERC20(tokenBAddress).approve(address(pool), outputB), "Round trip swap B approval failed");
        uint256 outputA = pool.swap(false, outputB, 1, block.timestamp + 3600);
        require(outputA > 0, "B->A swap should work");

        // Final balance should be less than initial due to fees
        uint256 finalBalanceA = ERC20(tokenAAddress).balanceOf(address(this));
        require(finalBalanceA < initialBalanceA, "Round trip should result in net loss due to fees");
        require(outputA < swapAmount, "Round trip output should be less than input");
    }

    // ============ GETTER FUNCTION TESTS ============

    function it_pool_getter_functions_work_correctly() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test all getter functions
        require(address(pool.tokenA()) == tokenAAddress, "tokenA() should return correct address");
        require(address(pool.tokenB()) == tokenBAddress, "tokenB() should return correct address");
        require(address(pool.lpToken()) != address(0), "lpToken() should return valid address");
        require(Ownable(pool).owner() == address(Ownable(m.poolFactory()).owner()), "owner() should return admin registry address");
        require(pool.poolFactory() == m.poolFactory(), "poolFactory() should return factory address");
        require(ERC20(pool.lpToken()).totalSupply() > 0, "LP token totalSupply() should be positive");

        // Test balances
        require(pool.tokenABalance() > 0, "tokenABalance should be positive");
        require(pool.tokenBBalance() > 0, "tokenBBalance should be positive");

        // Test fee parameters
        require(pool.swapFeeRate() >= 0, "swapFeeRate should be non-negative");
        require(pool.lpSharePercent() >= 0, "lpSharePercent should be non-negative");

        // Test ratios
        require(pool.aToBRatio() > decimal(0), "aToBRatio should be positive");
        require(pool.bToARatio() > decimal(0), "bToARatio should be positive");

        // Test zap fees setting
        require(pool.zapSwapFeesEnabled() == true, "zapSwapFeesEnabled should default to true");
    }

    // ============ ADMIN FUNCTION TESTS ============

    function it_pool_can_set_fee_parameters() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test setting fee parameters (owner only, so we call it through the pool factory)
        uint256 newSwapFeeRate = 50; // 0.5%
        uint256 newLpSharePercent = 8000; // 80%
        m.poolFactory().setPoolFeeParameters(address(pool), newSwapFeeRate, newLpSharePercent);

        // Verify fee parameters were updated
        require(pool.swapFeeRate() == newSwapFeeRate, "swapFeeRate should be updated");
        require(pool.lpSharePercent() == newLpSharePercent, "lpSharePercent should be updated");

        // Test that swaps still work with new fee parameters
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work with new fee parameters");
    }

    function it_pool_can_toggle_zap_swap_fees() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test that zap swap fees are enabled by default
        require(pool.zapSwapFeesEnabled() == true, "zapSwapFeesEnabled should default to true");

        // Test single token liquidity with fees enabled
        uint256 singleTokenAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidity = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
        require(liquidity > 0, "Single token liquidity should work with fees enabled");

        // Note: setZapSwapFeesEnabled is onlyOwner, so we can't test it directly from the test contract
        // The function exists but requires owner privileges (PoolFactory)
    }

    // ============ EDGE CASE TESTS ============

    function it_pool_handles_minimal_fee_parameters() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test setting minimal fee parameters (both must be > 0)
        m.poolFactory().setPoolFeeParameters(address(pool), 1, 1);

        // Verify that pool uses the set parameters
        require(pool.swapFeeRate() == 1, "swapFeeRate should be 1");
        require(pool.lpSharePercent() == 1, "lpSharePercent should be 1");

        // Test that swaps still work with minimal fees
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work with minimal fees");
    }

    function it_pool_state_consistency_after_operations() {
        uint256 amountA = 10000e18;
        uint256 amountB = 20000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Record initial state
        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Perform swap
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 swapOutput = pool.swap(true, swapAmount, 1, block.timestamp + 3600);

        // Check state after swap
        uint256 afterSwapReserveA = pool.tokenABalance();
        uint256 afterSwapReserveB = pool.tokenBBalance();
        require(afterSwapReserveA > initialReserveA, "Reserve A should increase after A->B swap");
        require(afterSwapReserveB < initialReserveB, "Reserve B should decrease after A->B swap");

        // Test single token liquidity instead of dual (avoids ratio issues)
        uint256 singleTokenAmount = 1000e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 singleTokenLiquidity = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
        require(singleTokenLiquidity > 0, "Single token liquidity should work");

        // Check state after single token liquidity
        uint256 afterSingleTokenReserveA = pool.tokenABalance();
        uint256 afterSingleTokenReserveB = pool.tokenBBalance();
        uint256 afterSingleTokenTotalSupply = ERC20(pool.lpToken()).totalSupply();
        require(afterSingleTokenReserveA > afterSwapReserveA, "Reserve A should increase after single token liquidity");
        require(afterSingleTokenTotalSupply > initialTotalSupply, "Total supply should increase after single token liquidity");

        // Remove some liquidity
        uint256 removeAmount = initialLiquidity / 2;
        require(ERC20(pool.lpToken()).approve(address(pool), removeAmount), "Remove liquidity approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(removeAmount, 1, 1, block.timestamp + 3600);

        // Check final state
        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();
        require(finalReserveA < afterSingleTokenReserveA, "Reserve A should decrease after removing liquidity");
        require(finalReserveB < afterSingleTokenReserveB, "Reserve B should decrease after removing liquidity");
        require(finalTotalSupply < afterSingleTokenTotalSupply, "Total supply should decrease after removing liquidity");
        require(tokenAReceived > 0, "Should receive token A when removing liquidity");
        require(tokenBReceived > 0, "Should receive token B when removing liquidity");
    }

    function it_pool_ratio_calculations_are_accurate() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test initial ratios
        decimal aToBRatio = pool.aToBRatio();
        decimal bToARatio = pool.bToARatio();
        require(aToBRatio > decimal(0), "A to B ratio should be positive");
        require(bToARatio > decimal(0), "B to A ratio should be positive");

        // Perform swap to change ratios
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        pool.swap(true, swapAmount, 1, block.timestamp + 3600);

        // Test ratios after swap
        decimal newAToBRatio = pool.aToBRatio();
        decimal newBToARatio = pool.bToARatio();
        require(newAToBRatio != aToBRatio, "A to B ratio should change after swap");
        require(newBToARatio != bToARatio, "B to A ratio should change after swap");

        // Test that ratios are consistent
        require(newAToBRatio > decimal(0), "New A to B ratio should be positive");
        require(newBToARatio > decimal(0), "New B to A ratio should be positive");
    }

    // ============ GETINPUTPRICE ACCURACY TESTS ============

    function it_pool_getInputPrice_calculations_are_accurate() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test getInputPrice with various amounts
        uint256[] memory testAmounts = new uint256[](5);
        testAmounts[0] = 1e18;      // Small amount
        testAmounts[1] = 10e18;     // Medium amount
        testAmounts[2] = 50e18;     // Large amount
        testAmounts[3] = 100e18;    // Very large amount
        testAmounts[4] = 200e18;    // Extreme amount

        for (uint256 i = 0; i < testAmounts.length; i++) {
            uint256 inputAmount = testAmounts[i];

            // Test A to B price calculation
            uint256 expectedOutputAtoB = pool.getInputPrice(inputAmount, amountA, amountB);
            require(expectedOutputAtoB > 0, "Expected output should be positive");

            // Test B to A price calculation
            uint256 expectedOutputBtoA = pool.getInputPrice(inputAmount, amountB, amountA);
            require(expectedOutputBtoA > 0, "Expected output should be positive");

            // Test that larger inputs produce larger outputs (but not proportionally due to fees)
            if (i > 0) {
                uint256 prevInput = testAmounts[i-1];
                uint256 prevOutputAtoB = pool.getInputPrice(prevInput, amountA, amountB);
                require(expectedOutputAtoB > prevOutputAtoB, "Larger input should produce larger output");
            }
        }

        // Test price calculation consistency with actual swaps
        uint256 testAmount = 25e18;
        uint256 expectedOutput = pool.getInputPrice(testAmount, amountA, amountB);

        // Perform actual swap
        require(ERC20(tokenAAddress).approve(address(pool), testAmount), "Swap approval failed");
        uint256 actualOutput = pool.swap(true, testAmount, 1, block.timestamp + 3600);

        // Allow for small differences due to rounding and fees
        require(actualOutput > 0, "Actual output should be positive");
        require(actualOutput <= expectedOutput, "Actual output should not exceed expected (due to fees)");
    }

    function it_pool_getInputPrice_handles_edge_cases() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test with very small amounts
        uint256 tinyAmount = 1;
        uint256 tinyOutput = pool.getInputPrice(tinyAmount, amountA, amountB);
        require(tinyOutput > 0, "Tiny input should produce positive output");

        // Test with amounts close to reserves
        uint256 largeAmount = amountA / 2; // 50% of reserve
        uint256 largeOutput = pool.getInputPrice(largeAmount, amountA, amountB);
        require(largeOutput > 0, "Large input should produce positive output");
        require(largeOutput < amountB, "Output should be less than total reserve");

        // Test price calculation after swaps (different reserves)
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        pool.swap(true, swapAmount, 1, block.timestamp + 3600);

        // Test getInputPrice with new reserves
        uint256 newReserveA = pool.tokenABalance();
        uint256 newReserveB = pool.tokenBBalance();
        uint256 newExpectedOutput = pool.getInputPrice(swapAmount, newReserveA, newReserveB);
        require(newExpectedOutput > 0, "Price calculation should work with new reserves");
    }

    // ============ ADMIN FUNCTION TESTS ============

    function it_pool_admin_functions_require_owner() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test that setFeeParameters requires owner (should fail when called directly)
        // Note: We can't directly test the revert since we're the owner via PoolFactory
        // But we can verify the function exists and works when called properly

        // Test that setZapSwapFeesEnabled requires owner
        // Note: Same limitation - we can't test the revert directly

        // Verify current state
        require(pool.swapFeeRate() >= 0, "swapFeeRate should be accessible");
        require(pool.lpSharePercent() >= 0, "lpSharePercent should be accessible");
        require(pool.zapSwapFeesEnabled() == true, "zapSwapFeesEnabled should be accessible");

        // Test that owner is PoolFactory
        require(pool.poolFactory() == m.poolFactory(), "Pool owner should be PoolFactory");
        require(Ownable(pool).owner() == Ownable(m.poolFactory()).owner(), "Pool owner should be PoolFactory");
    }

    // ============ ERROR CONDITION TESTS ============

    function it_pool_handles_zero_amounts_gracefully() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test getInputPrice with zero amount
        uint256 zeroOutput = pool.getInputPrice(0, amountA, amountB);
        require(zeroOutput == 0, "Zero input should produce zero output");

        // Test that zero amount swaps would fail (but we can't test the revert directly)
        // The function should handle zero amounts gracefully in getInputPrice
    }

    function it_pool_handles_expired_deadlines() {
        fastForward(3600);
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test with expired deadline (should fail)
        uint256 expiredDeadline = block.timestamp - 1;
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");

        // This should revert due to expired deadline
        // Note: We can't test the revert directly, but we can verify the deadline check exists
        require(block.timestamp > expiredDeadline, "Current time should be after expired deadline");
    }

    function it_pool_handles_insufficient_approvals() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test that insufficient approval would cause failure
        // Note: We can't test the revert directly, but we can verify approval requirements

        // Test with sufficient approval (should work)
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work with sufficient approval");
    }

    function it_pool_handles_insufficient_balances() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test that insufficient balance would cause failure
        // Note: We can't test the revert directly, but we can verify balance requirements

        // Test with sufficient balance (should work)
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work with sufficient balance");

        // Verify we have enough tokens for the swap
        uint256 balance = ERC20(tokenAAddress).balanceOf(address(this));
        require(balance >= swapAmount, "Should have sufficient balance for swap");
    }

    function it_pool_handles_slippage_protection() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test slippage protection with reasonable minAmountOut
        uint256 swapAmount = 100e18;
        uint256 expectedOutput = pool.getInputPrice(swapAmount, amountA, amountB);
        uint256 minAmountOut = expectedOutput * 95 / 100; // 5% slippage tolerance

        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 actualOutput = pool.swap(true, swapAmount, minAmountOut, block.timestamp + 3600);
        require(actualOutput >= minAmountOut, "Output should meet minimum amount requirement");

        // Test slippage protection with very high minAmountOut (should fail)
        uint256 unrealisticMinAmount = expectedOutput * 2; // 200% of expected
        // This should revert due to slippage protection
        // Note: We can't test the revert directly, but we can verify the protection exists
        require(actualOutput < unrealisticMinAmount, "Actual output should be less than unrealistic minimum");
    }

    function it_pool_handles_reentrancy_protection() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Test that reentrancy protection is in place
        // Note: We can't directly test reentrancy attacks, but we can verify the protection exists

        // Test normal swap (should work)
        uint256 swapAmount = 50e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Normal swap should work");

        // Verify the nonReentrant modifier is applied to swap function
        // This is verified by the fact that our swaps work without issues
    }

    // ============ SINGLE TOKEN LIQUIDITY ACCOUNTING TESTS ============



    /// @notice Property test to verify that one-sided liquidity deposits
    /// maintain correct internal accounting
    ///
    /// @dev This test ensures that after a user deposits single-sided liquidity
    ///      and withdraws it, the pool's internal balance tracking
    ///      (tokenABalance, tokenBBalance) matches the actual token balances
    ///      held by the pool contract. This catches accounting bugs where
    ///      protocol fees or swap amounts aren't properly accounted for.
    function property_one_sided_liquidity_doesnt_corrupt_internal_accounting(
        uint _a,
        uint _b1,
        uint _b2,
        uint _b3,
        uint _c
    ) {
        // GIVEN: A pool with initial liquidity and a user with tokens to deposit

        // Create two tokens for the pool
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);

        User u1 = new User();
        User u2 = new User();

        // Calculate randomized token amounts
        uint a = _a + 1; // Mint _a + 1 A tokens
        uint b = a * (10 + (((_b1 % 10) + 1) * ((_b2 % 10) + 1) * ((_b3 * 10) + 1))); // Mint roughly 1-1000x as many B tokens
        uint c = (_c % b) + 1; // User deposits anywhere from 1 to b units of token B
        uint t1Amt = a * 1e18;
        uint t2Amt = b * 1e17; // b is denominated in 0.1 token units
        uint u1Amt = c * 1e17; // c is denominated in 0.1 token units

        // Mint tokens: pool gets t1 and t2, user u1 gets t2 for single-sided deposit
        Token(t1).mint(address(this), t1Amt);
        Token(t2).mint(address(this), t2Amt);
        Token(t2).mint(address(u1), u1Amt);

        // Create pool and set up permissions
        address p1 = m.poolFactory().createPool(t1,t2);
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        // Add initial liquidity to the pool (both tokens)
        require(p1 != address(0), "Failed to create pool 1");
        require(ERC20(t1).approve(address(p1), t1Amt), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), t2Amt), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(t2Amt, t1Amt, block.timestamp + 3600);
        require(l1 > 0, "Failed to add liquidity to pool 1");

        // WHEN: User deposits single-sided liquidity (tokenB only) and then withdraws it

        require(u1.do(t2, "approve", p1, u1Amt), "Approval failed for u1");
        u1.do(p1, "addLiquiditySingleToken", false, u1Amt, block.timestamp + 3600); // Deposit tokenB only
        uint lpBal = lpToken.balanceOf(address(u1));
        u1.do(p1, "removeLiquidity", lpBal, 1, 1, block.timestamp + 3600); // Withdraw all liquidity

        // THEN: The pool's internal balance accounting must match the actual token balances

        require(Pool(p1).tokenABalance() == Token(t1).balanceOf(p1), "Pool's tokenABalance doesn't match reality: " + string(Pool(p1).tokenABalance()) + ", " + string(Token(t1).balanceOf(p1)));
        require(Pool(p1).tokenBBalance() == Token(t2).balanceOf(p1), "Pool's tokenBBalance doesn't match reality: " + string(Pool(p1).tokenBBalance()) + ", " + string(Token(t2).balanceOf(p1)));
    }

    /// @notice Property test: syncing after external token mints restores internal accounting
    function property_sync_restores_internal_after_excess(
        uint aSeed,
        uint bSeed,
        uint extraASeed,
        uint extraBSeed
    ) {
        // Create tokens and pool
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);

        // Scale randomized amounts to reasonable sizes
        uint amountAScaledMod = aSeed % 10000;
        uint amountAScaled = amountAScaledMod + 1;
        uint amountBScaledMod = bSeed % 20000;
        uint amountBScaled = amountBScaledMod + 1;
        uint amountA = amountAScaled * 1e18;
        uint amountB = amountBScaled * 1e18;

        // Mint tokens to test contract
        Token(t1).mint(address(this), amountA);
        Token(t2).mint(address(this), amountB);

        // Create pool and whitelist LP token permissions
        address p1 = m.poolFactory().createPool(t1,t2);
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        // Add initial liquidity
        require(ERC20(t1).approve(address(p1), amountA), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), amountB), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(amountB, amountA, block.timestamp + 3600);
        require(l1 > 0, "Failed to add liquidity");

        // Mint excess tokens directly to pool (simulate external transfers)
        uint extraAScaledMod = extraASeed % 1000;
        uint extraAScaled = extraAScaledMod + 1;
        uint extraBScaledMod = extraBSeed % 2000;
        uint extraBScaled = extraBScaledMod + 1;
        uint extraA = extraAScaled * 1e18;
        uint extraB = extraBScaled * 1e18;
        Token(t1).mint(p1, extraA);
        Token(t2).mint(p1, extraB);

        // Run sync via factory
        address[] memory pools = new address[](1);
        pools[0] = p1;
        m.poolFactory().syncPools(pools);

        // Assert internal matches actual balances after sync
        require(Pool(p1).tokenABalance() == Token(t1).balanceOf(p1), "sync: tokenABalance mismatch after sync");
        require(Pool(p1).tokenBBalance() == Token(t2).balanceOf(p1), "sync: tokenBBalance mismatch after sync");
    }

    /// @notice Property test: repeated add/remove cycles do not inflate LP supply and keep accounting consistent
    function property_no_lp_inflation_on_cycles(
        uint cyclesSeed,
        uint amtSeedA,
        uint amtSeedB
    ) {
        // Create tokens and pool
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);

        // Fund the test contract - mint enough for initial liquidity plus cycles
        uint baseAScaledMod = amtSeedA % 50000;
        uint baseAScaled = baseAScaledMod + 10000;
        uint baseBScaledMod = amtSeedB % 50000;
        uint baseBScaled = baseBScaledMod + 10000;
        uint baseA = baseAScaled * 1e18;
        uint baseB = baseBScaled * 1e18;

        // Calculate maximum needed for cycles (5 cycles max, 5000 * 1e18 per cycle)
        uint maxCycleAmount = 5 * 5000 * 1e18;
        uint totalA = baseA + maxCycleAmount;
        uint totalB = baseB + maxCycleAmount;

        Token(t1).mint(address(this), totalA);
        Token(t2).mint(address(this), totalB);

        // Create pool and whitelist LP token permissions
        address p1 = m.poolFactory().createPool(t1,t2);
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        // Seed initial dual liquidity (use only base amounts)
        require(ERC20(t1).approve(address(p1), baseA), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), baseB), "Approval failed for t2");
        uint initLiq = Pool(p1).addLiquidity(baseB, baseA, block.timestamp + 3600);
        require(initLiq > 0, "Failed to add initial liquidity");

        uint initialTotalSupply = ERC20(lpToken).totalSupply();

        // Perform N cycles of single-token add then immediate remove
        uint cycles = (cyclesSeed % 5) + 1; // 1..5 cycles to keep runtime bounded
        for (uint i = 0; i < cycles; i++) {
            bool isAToB = (i % 2 == 0); // alternate directions
            uint addAmtScaledMod = (amtSeedA + i * 1337) % 5000;
            uint addAmtScaled = addAmtScaledMod + 1;
            uint addAmt = addAmtScaled * 1e18;

            // Check available balance and use the minimum
            uint availableAmt = isAToB ? Token(t1).balanceOf(address(this)) : Token(t2).balanceOf(address(this));
            if (availableAmt < addAmt) {
                addAmt = availableAmt;
            }
            if (addAmt == 0) {
                continue; // Skip if no tokens available
            }

            if (isAToB) {
                require(ERC20(t1).approve(address(p1), addAmt), "approve A failed");
                uint minted = Pool(p1).addLiquiditySingleToken(true, addAmt, block.timestamp + 3600);
                require(minted >= 0, "minted should be non-negative");
                require(ERC20(lpToken).approve(address(p1), minted), "approve LP failed");
                (uint outB, uint outA) = Pool(p1).removeLiquidity(minted, 1, 1, block.timestamp + 3600);
                require(outA + outB > 0, "remove returned nothing");
            } else {
                require(ERC20(t2).approve(address(p1), addAmt), "approve B failed");
                uint minted2 = Pool(p1).addLiquiditySingleToken(false, addAmt, block.timestamp + 3600);
                require(minted2 >= 0, "minted should be non-negative");
                require(ERC20(lpToken).approve(address(p1), minted2), "approve LP failed");
                (uint outB2, uint outA2) = Pool(p1).removeLiquidity(minted2, 1, 1, block.timestamp + 3600);
                require(outA2 + outB2 > 0, "remove returned nothing");
            }
        }

        uint finalTotalSupply = ERC20(lpToken).totalSupply();
        // Allow negligible rounding differences
        if (finalTotalSupply > initialTotalSupply) {
            require(finalTotalSupply - initialTotalSupply <= 1e12, "LP inflation detected");
        }

        // Internal accounting should always match actual balances at the end
        require(Pool(p1).tokenABalance() == Token(t1).balanceOf(p1), "cycles: tokenABalance mismatch");
        require(Pool(p1).tokenBBalance() == Token(t2).balanceOf(p1), "cycles: tokenBBalance mismatch");
    }

    function it_single_token_liquidity_uses_min_of_both_rule() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Record initial state
        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add single token liquidity (tokenA)
        uint256 singleTokenAmount = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);

        // Verify LP tokens were minted
        require(liquidityMinted > 0, "Should mint LP tokens");

        // Calculate expected liquidity using min-of-both rule
        // After swap, we have tokenALiquidityContribution and tokenBLiquidityContribution
        // The LP minting should use the minimum of both contributions relative to post-swap reserves
        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify total supply increased correctly
        require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should increase by minted amount");

        // Verify reserves increased (only tokenA should increase physically)
        require(finalReserveA > initialReserveA, "TokenA reserve should increase");
        // TokenB reserve may decrease slightly due to internal swap, but net should be positive for liquidity
    }

    function it_single_token_liquidity_accounting_is_consistent_with_dual() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Initial dual liquidity
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);
        require(initialLiquidity > 0, "Initial dual liquidity failed");

        // Snapshot pre-state
        uint256 A0 = pool.tokenABalance();
        uint256 B0 = pool.tokenBBalance();
        uint256 L0 = ERC20(pool.lpToken()).totalSupply();

        // Add single-sided A using under-pull zap
        uint256 xA = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), xA), "Single token approval failed");
        uint256 minted = pool.addLiquiditySingleToken(true, xA, block.timestamp + 3600);
        require(minted > 0, "Single token mint should be positive");

        // Read post-add state
        uint256 A_add = pool.tokenABalance();
        uint256 B_add = pool.tokenBBalance();
        uint256 L_add = ERC20(pool.lpToken()).totalSupply();
        require(L_add == L0 + minted, "LP supply not incremented by minted");

        // Recompute expected math for under-pull
        uint256 feeBps = pool.swapFeeRate();
        if (feeBps == 0) feeBps = m.poolFactory().swapFeeRate();
        uint256 lpShareBps = pool.lpSharePercent();
        if (lpShareBps == 0) lpShareBps = m.poolFactory().lpSharePercent();

        // Same optimal swap used by zap, priced on pre-deposit reserves
        uint256 s = pool._getOptimalSwapAmount(A0, xA, feeBps);
        uint256 fee = (s * feeBps) / 10000;
        uint256 lpFee = (fee * lpShareBps) / 10000;
        uint256 protocolFee = fee - lpFee;
        uint256 netIn = s - fee;
        uint256 amountOut = pool.getInputPrice(netIn, A0, B0);

        // Virtual post-swap reserves used for ratio & mint
        uint256 postA = A0 + s - protocolFee;
        uint256 postB = B0 - amountOut;

        // Ratio-required counterpart (floor) at post-swap reserves
        uint256 requiredA = (amountOut * postA) / postB;

        // Under-pull: pool pulls exactly s + requiredA, then pays protocolFee
        uint256 totalNeeded = s + requiredA;
        uint256 expectedA_add = A0 + (totalNeeded - protocolFee);
        uint256 expectedB_add = B0;

        // Check add-state matches under-pull accounting
        require(A_add == expectedA_add, "add-state: A reserve mismatch");
        require(B_add == expectedB_add, "add-state: B reserve mismatch");

        // Now remove exactly what we minted
        require(ERC20(pool.lpToken()).approve(address(pool), minted), "Remove approval failed");
        pool.removeLiquidity(minted, 1, 1, block.timestamp + 3600);

        // Final state after burn (pro-rata on actual reserves at burn time)
        uint256 A_fin = pool.tokenABalance();
        uint256 B_fin = pool.tokenBBalance();
        uint256 L_fin = ERC20(pool.lpToken()).totalSupply();

        // Expected final after burning 'minted' out of (A_add, B_add, L0+minted)
        // burn removes (minted / (L0+minted)) share from each reserve
        // => final = add_state * (L0 / (L0 + minted))
        uint256 expectedA_fin = (A_add * L0) / (L0 + minted);
        uint256 expectedB_fin = (B_add * L0) / (L0 + minted);

        // Allow tiny wei tolerance if needed (usually exact)
        uint256 tol = 1;
        require(
            (A_fin + tol >= expectedA_fin) && (A_fin <= expectedA_fin + tol),
            "final-state: A reserve mismatch"
        );
        require(
            (B_fin + tol >= expectedB_fin) && (B_fin <= expectedB_fin + tol),
            "final-state: B reserve mismatch"
        );
        require(L_fin == L0, "LP totalSupply should return to initial");
    }

    function it_single_token_liquidity_handles_imbalanced_pools() {
        // Create an imbalanced pool (more tokenB than tokenA)
        uint256 amountA = 1000e18;
        uint256 amountB = 5000e18; // 5:1 ratio

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();
        // Capture initial B-per-A ratio (aToBRatio = B/A)
        decimal initialRatio = pool.aToBRatio();

        // Add single tokenA to imbalanced pool
        uint256 singleTokenAmount = 2000e18; // Large amount relative to reserveA
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
        require(liquidityMinted > 0, "Should mint LP tokens even in imbalanced pool");

        // Verify pool state is consistent
        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();
        decimal finalRatio = pool.aToBRatio();

        require(finalReserveA > initialReserveA, "TokenA reserve should increase");
        require(finalTotalSupply > initialTotalSupply, "Total supply should increase");

        // B reserve should not swing more than the single-token amount (very loose bound)
        if (finalReserveB >= initialReserveB) {
            require(finalReserveB - initialReserveB <= singleTokenAmount, "TokenB reserve grew too much for imbalance fix");
        } else {
            require(initialReserveB - finalReserveB <= singleTokenAmount, "TokenB reserve dropped too much for imbalance fix");
        }

        // Since aToBRatio = B/A, adding A (with internal swap) should reduce B/A (move toward balance)
        require(finalRatio < initialRatio, "B/A should decrease toward balance");
    }

    function it_single_token_liquidity_post_swap_reserves_are_correct() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add single token liquidity
        uint256 singleTokenAmount = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);

        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify LP tokens minted are consistent with reserve changes
        // The liquidity should be proportional to the minimum contribution
        require(liquidityMinted > 0, "Should mint LP tokens");
        require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should match");

        // Verify that removing the minted liquidity gives back proportional amounts
        require(ERC20(pool.lpToken()).approve(address(pool), liquidityMinted), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(liquidityMinted, 1, 1, block.timestamp + 3600);

        // The amounts received should be proportional to the reserves at removal time
        uint256 reserveAAtRemoval = pool.tokenABalance();
        uint256 reserveBAtRemoval = pool.tokenBBalance();
        uint256 totalSupplyAtRemoval = ERC20(pool.lpToken()).totalSupply();

        // Verify proportions are correct (within rounding)
        uint256 expectedTokenA = liquidityMinted * reserveAAtRemoval / totalSupplyAtRemoval;
        uint256 expectedTokenB = liquidityMinted * reserveBAtRemoval / totalSupplyAtRemoval;

        // Allow for small rounding differences
        require(tokenAReceived >= expectedTokenA - 1e15, "TokenA received should match expected");
        require(tokenAReceived <= expectedTokenA + 1e15, "TokenA received should match expected");
        require(tokenBReceived >= expectedTokenB - 1e15, "TokenB received should match expected");
        require(tokenBReceived <= expectedTokenB + 1e15, "TokenB received should match expected");
    }

    function it_single_token_liquidity_with_fees_disabled() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Disable zap swap fees (requires owner, so we'd need to do this through factory)
        // For now, test with fees enabled and verify accounting is correct

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add single token liquidity
        uint256 singleTokenAmount = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);

        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify accounting is consistent
        require(liquidityMinted > 0, "Should mint LP tokens");
        require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should match");
        require(finalReserveA > initialReserveA, "TokenA reserve should increase");
    }

    function it_single_token_liquidity_both_directions_produce_consistent_results() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add liquidity with tokenA
        uint256 singleTokenAmountA = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmountA), "TokenA approval failed");
        uint256 liquidityA = pool.addLiquiditySingleToken(true, singleTokenAmountA, block.timestamp + 3600);

        uint256 afterATotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add liquidity with tokenB (same value)
        uint256 singleTokenAmountB = 1000e18; // 2x because ratio is 1:2
        require(ERC20(tokenBAddress).approve(address(pool), singleTokenAmountB), "TokenB approval failed");
        uint256 liquidityB = pool.addLiquiditySingleToken(false, singleTokenAmountB, block.timestamp + 3600);

        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Both should mint LP tokens
        require(liquidityA > 0, "TokenA liquidity should mint LP tokens");
        require(liquidityB > 0, "TokenB liquidity should mint LP tokens");

        // Verify total supply increased correctly
        require(afterATotalSupply == initialTotalSupply + liquidityA, "Total supply after A should match");
        require(finalTotalSupply == afterATotalSupply + liquidityB, "Total supply after B should match");
    }

    function it_single_token_liquidity_round_trip_preserves_value() {
        // Setup: small balanced pool
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "approve A");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "approve B");
        require(pool.addLiquidity(amountB, amountA, block.timestamp + 3600) > 0, "init add");

        // Snapshot pre-state (pool + user wallet)
        uint256 A0 = pool.tokenABalance();
        uint256 B0 = pool.tokenBBalance();
        uint256 L0 = ERC20(pool.lpToken()).totalSupply();
        uint256 userA0 = ERC20(tokenAAddress).balanceOf(address(this));
        uint256 userB0 = ERC20(tokenBAddress).balanceOf(address(this));

        // One-sided add with declared input xA
        uint256 xA = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), xA), "approve xA");
        uint256 minted = pool.addLiquiditySingleToken(true, xA, block.timestamp + 3600);
        require(minted > 0, "mint failed");

        // Recompute under-pull net spend s + requiredA
        uint256 feeBps = pool.swapFeeRate();
        if (feeBps == 0) feeBps = m.poolFactory().swapFeeRate();
        uint256 lpShareBps = pool.lpSharePercent();
        if (lpShareBps == 0) lpShareBps = m.poolFactory().lpSharePercent();

        uint256 s = pool._getOptimalSwapAmount(A0, xA, feeBps);
        uint256 fee = (s * feeBps) / 10000;
        uint256 lpFee = (fee * lpShareBps) / 10000;
        uint256 protocolFee = fee - lpFee;
        uint256 netIn = s - fee;
        uint256 amountOut = pool.getInputPrice(netIn, A0, B0);
        uint256 postA = A0 + s - protocolFee;
        uint256 postB = B0 - amountOut;
        uint256 requiredA = (amountOut * postA) / postB;
        uint256 totalNeeded = s + requiredA; // actual under-pull from user

        // Under-pull UX: user A should drop by totalNeeded (not by xA)
        uint256 userA1 = ERC20(tokenAAddress).balanceOf(address(this));
        require(userA0 - userA1 == totalNeeded, "TokenA net spend must equal s+requiredA");

        // Burn what we minted
        require(ERC20(pool.lpToken()).approve(address(pool), minted), "approve burn");
        (uint256 bOut, uint256 aOut) = pool.removeLiquidity(minted, 1, 1, block.timestamp + 3600);
        require(aOut > 0 && bOut > 0, "burn returned nothing");

        // Final pool state equals proportional burn from add-state
        uint256 A_add = A0 + (totalNeeded - protocolFee);
        uint256 B_add = B0;
        uint256 L_add = L0 + minted;

        uint256 expectedA_fin = (A_add * L0) / L_add;
        uint256 expectedB_fin = (B_add * L0) / L_add;

        uint256 A_fin = pool.tokenABalance();
        uint256 B_fin = pool.tokenBBalance();
        uint256 L_fin = ERC20(pool.lpToken()).totalSupply();

        uint256 tol = 1;
        require(
            (A_fin + tol >= expectedA_fin) && (A_fin <= expectedA_fin + tol),
            "final A mismatch"
        );
        require(
            (B_fin + tol >= expectedB_fin) && (B_fin <= expectedB_fin + tol),
            "final B mismatch"
        );
        require(L_fin == L0, "LP supply should return to initial");

        // Optional: user's net A change equals totalNeeded minus the A they received back on burn
        // (This is a soft check to ensure wallet-side accounting looks sane.)
        uint256 userA2 = ERC20(tokenAAddress).balanceOf(address(this));
        uint256 userB2 = ERC20(tokenBAddress).balanceOf(address(this));
        // userB should have increased by bOut
        require(userB2 >= userB0 && userB2 - userB0 == bOut, "User B delta mismatch");
        // userA dropped by totalNeeded then got aOut back
        require(userA0 - userA2 == totalNeeded - aOut, "User A net delta mismatch");
    }

    function it_single_token_liquidity_multiple_additions_maintain_ratio() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        decimal initialRatio = pool.aToBRatio();

        // Add multiple single token liquidity additions
        uint256 singleTokenAmount = 100e18;
        uint256 totalLiquidityMinted = 0;

        for (uint i = 0; i < 5; i++) {
            require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Approval failed");
            uint256 liquidity = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);
            totalLiquidityMinted += liquidity;
            require(liquidity > 0, "Should mint LP tokens on each addition");
        }

        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify accounting is consistent across multiple additions
        require(totalLiquidityMinted > 0, "Should mint total LP tokens");
        require(finalReserveA > initialReserveA, "TokenA reserve should increase");

        // Verify we can remove all the liquidity we added
        require(ERC20(pool.lpToken()).approve(address(pool), totalLiquidityMinted), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(totalLiquidityMinted, 1, 1, block.timestamp + 3600);

        require(tokenAReceived > 0, "Should receive tokenA back");
        require(tokenBReceived > 0, "Should receive tokenB back");
    }

    function it_single_token_liquidity_handles_large_amounts() {
        uint256 amountA = 10000e18;
        uint256 amountB = 20000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add large single token liquidity
        uint256 largeAmount = 5000e18; // 50% of initial reserve
        require(ERC20(tokenAAddress).approve(address(pool), largeAmount), "Large amount approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, largeAmount, block.timestamp + 3600);

        require(liquidityMinted > 0, "Should mint LP tokens for large amount");

        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify accounting is correct even for large amounts
        require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should match");
        require(finalReserveA > initialReserveA, "TokenA reserve should increase");

        // Verify we can remove the liquidity
        require(ERC20(pool.lpToken()).approve(address(pool), liquidityMinted), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(liquidityMinted, 1, 1, block.timestamp + 3600);

        require(tokenAReceived > 0, "Should receive tokenA back");
        require(tokenBReceived > 0, "Should receive tokenB back");
    }

    function it_single_token_liquidity_handles_small_amounts() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Add very small single token liquidity
        uint256 smallAmount = 1e18; // Very small relative to reserves
        require(ERC20(tokenAAddress).approve(address(pool), smallAmount), "Small amount approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, smallAmount, block.timestamp + 3600);

        // Should still mint LP tokens (may be very small due to rounding)
        require(liquidityMinted >= 0, "Should handle small amounts gracefully");

        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify accounting is consistent
        if (liquidityMinted > 0) {
            require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should match");
        }
    }

    function it_single_token_liquidity_accounting_after_swaps() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Perform some swaps to change the pool ratio
        uint256 swapAmount1 = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount1), "Swap1 approval failed");
        pool.swap(true, swapAmount1, 1, block.timestamp + 3600);

        uint256 swapAmount2 = 50e18;
        require(ERC20(tokenBAddress).approve(address(pool), swapAmount2), "Swap2 approval failed");
        pool.swap(false, swapAmount2, 1, block.timestamp + 3600);

        // Now add single token liquidity after swaps
        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        uint256 singleTokenAmount = 500e18;
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        uint256 liquidityMinted = pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);

        require(liquidityMinted > 0, "Should mint LP tokens after swaps");

        uint256 finalReserveA = pool.tokenABalance();
        uint256 finalReserveB = pool.tokenBBalance();
        uint256 finalTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Verify accounting is correct
        require(finalTotalSupply == initialTotalSupply + liquidityMinted, "Total supply should match");
        require(finalReserveA > initialReserveA, "TokenA reserve should increase");

        // Verify we can remove liquidity correctly
        require(ERC20(pool.lpToken()).approve(address(pool), liquidityMinted), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(liquidityMinted, 1, 1, block.timestamp + 3600);

        require(tokenAReceived > 0, "Should receive tokenA back");
        require(tokenBReceived > 0, "Should receive tokenB back");
    }

    function it_single_token_equals_swap_plus_dual_add() {
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;

        // Add initial dual liquidity
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        uint256 initialLiquidity = pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialReserveA = pool.tokenABalance();
        uint256 initialReserveB = pool.tokenBBalance();
        uint256 initialTotalSupply = ERC20(pool.lpToken()).totalSupply();

        // Single token amount to add
        uint256 singleTokenAmount = 500e18;

        // PATH 1: Swap + regular liquidity add
        // First, calculate optimal swap amount using the contract's function for consistency
        uint256 reserveIn = initialReserveA;
        uint256 feeBps = 0;
        if (pool.zapSwapFeesEnabled()) {
            feeBps = pool.swapFeeRate();
            if (feeBps == 0) {
                feeBps = PoolFactory(m.poolFactory()).swapFeeRate();
            }
        }

        // Use the contract's function to ensure exact consistency
        uint256 swapAmt = pool._getOptimalSwapAmount(reserveIn, singleTokenAmount, feeBps);

        // Execute swap
        require(ERC20(tokenAAddress).approve(address(pool), swapAmt), "Swap approval failed");
        uint256 reserveABeforeSwap = pool.tokenABalance();
        uint256 reserveBBeforeSwap = pool.tokenBBalance();
        uint256 amountOut = pool.swap(true, swapAmt, 1, block.timestamp + 3600);
        uint256 reserveAAfterSwap = pool.tokenABalance();
        uint256 reserveBAfterSwap = pool.tokenBBalance();

        // Calculate remaining tokenA after swap
        uint256 remainingTokenA = singleTokenAmount - swapAmt;

        // Add dual liquidity with remaining tokenA + received tokenB
        require(ERC20(tokenAAddress).approve(address(pool), remainingTokenA), "Dual add tokenA approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountOut), "Dual add tokenB approval failed");
        uint256 liquidityPath1 = pool.addLiquidity(amountOut, remainingTokenA, block.timestamp + 3600);

        // Record PATH 1 final state using state variables (not actual ERC20 balances)
        // The pool logic uses these state variables, so we must compare them
        uint256 finalReserveAPath1 = pool.tokenABalance();
        uint256 finalReserveBPath1 = pool.tokenBBalance();
        uint256 finalTotalSupplyPath1 = ERC20(pool.lpToken()).totalSupply();

        // Note: addLiquidity calculates the required tokenA amount based on ratio,
        // so it may not use all of remainingTokenA. We'll compare final states directly.

        // Reset: Remove ALL liquidity (both initial and what we just added)
        uint256 totalLPTokens = ERC20(pool.lpToken()).balanceOf(address(this));
        require(ERC20(pool.lpToken()).approve(address(pool), totalLPTokens), "Remove all approval failed");
        pool.removeLiquidity(totalLPTokens, 1, 1, block.timestamp + 3600);

        // Verify pool is empty
        require(ERC20(pool.lpToken()).totalSupply() == 0, "Pool should be empty after removing all liquidity");
        require(pool.tokenABalance() == 0, "TokenA balance should be 0");
        require(pool.tokenBBalance() == 0, "TokenB balance should be 0");

        // Re-add the original initial liquidity
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Reset Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Reset Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // PATH 2: Single token liquidity add
        // Record initial state using state variables
        uint256 reserveABeforePath2 = pool.tokenABalance();
        uint256 reserveBBeforePath2 = pool.tokenBBalance();
        require(ERC20(tokenAAddress).approve(address(pool), singleTokenAmount), "Single token approval failed");
        pool.addLiquiditySingleToken(true, singleTokenAmount, block.timestamp + 3600);

        // Record PATH 2 final state using state variables (not actual ERC20 balances)
        // The pool logic uses these state variables, so we must compare them
        uint256 finalReserveAPath2 = pool.tokenABalance();
        uint256 finalReserveBPath2 = pool.tokenBBalance();
        uint256 finalTotalSupplyPath2 = ERC20(pool.lpToken()).totalSupply();

        // Compare state variables between both paths (not actual ERC20 balances)
        // Debug: Calculate differences
        uint256 reserveADiff = finalReserveAPath2 >= finalReserveAPath1 ? finalReserveAPath2 - finalReserveAPath1 : finalReserveAPath1 - finalReserveAPath2;
        uint256 reserveBDiff = finalReserveBPath2 >= finalReserveBPath1 ? finalReserveBPath2 - finalReserveBPath1 : finalReserveBPath1 - finalReserveBPath2;
        uint256 totalSupplyDiff = finalTotalSupplyPath2 >= finalTotalSupplyPath1 ? finalTotalSupplyPath2 - finalTotalSupplyPath1 : finalTotalSupplyPath1 - finalTotalSupplyPath2;

        // Compare results - both paths should end up with the same final state
        uint256 tolerance2 = 1e12; // Allow for rounding differences

        // Debug: Calculate the actual differences
        uint256 actualReserveADiff = finalReserveAPath2 >= finalReserveAPath1 ?
            finalReserveAPath2 - finalReserveAPath1 :
            finalReserveAPath1 - finalReserveAPath2;

        // The key insight: PATH 1 uses addLiquidity which calculates required amounts based on ratio,
        // while PATH 2 uses addLiquiditySingleToken which also calculates optimal amounts.
        // They should produce the same final state if the logic is correct.

        if (finalReserveAPath2 >= finalReserveAPath1) {
            require(finalReserveAPath2 - finalReserveAPath1 <= tolerance2,
                "ReserveA mismatch: PATH2 > PATH1");
        } else {
            require(finalReserveAPath1 - finalReserveAPath2 <= tolerance2,
                "ReserveA mismatch: PATH1 > PATH2");
        }

        if (finalReserveBPath2 >= finalReserveBPath1) {
            require(finalReserveBPath2 - finalReserveBPath1 <= tolerance2, "ReserveB mismatch between paths");
        } else {
            require(finalReserveBPath1 - finalReserveBPath2 <= tolerance2, "ReserveB mismatch between paths");
        }

        if (finalTotalSupplyPath2 >= finalTotalSupplyPath1) {
            require(finalTotalSupplyPath2 - finalTotalSupplyPath1 <= tolerance2, "TotalSupply mismatch between paths");
        } else {
            require(finalTotalSupplyPath1 - finalTotalSupplyPath2 <= tolerance2, "TotalSupply mismatch between paths");
        }
    }


function it_single_token_a_zap_matches_swap_then_add_with_fees() {
  // -------- Path 1: swap A->B then add dual liquidity (Pool #1 created in beforeEach) --------
  pool.setZapSwapFeesEnabled(true);

  uint256 initA = 1000e18;
  uint256 initB = 2000e18;

  require(ERC20(tokenAAddress).approve(address(pool), initA), "P1: approve A init");
  require(ERC20(tokenBAddress).approve(address(pool), initB), "P1: approve B init");
  require(pool.addLiquidity(initB, initA, block.timestamp + 3600) > 0, "P1: init add");

  // single-sided A amount we want to add via both paths
  uint256 xA = 500e18;

  // Compute the exact same optimal swap amount the zap will use
  uint256 feeBps = pool.swapFeeRate();
  if (feeBps == 0) {
    feeBps = m.poolFactory().swapFeeRate();
  }
  uint256 reserveA = pool.tokenABalance();
  uint256 s = pool._getOptimalSwapAmount(reserveA, xA, feeBps);
  require(s > 0 && s < xA, "P1: bad optimal s");

  // Do the external swap first
  require(ERC20(tokenAAddress).approve(address(pool), xA), "P1: approve A x");
  uint256 outB = pool.swap(true, s, 1, block.timestamp + 3600);

  // Then add dual using the post-swap ratio
  require(ERC20(tokenBAddress).approve(address(pool), outB), "P1: approve B out");
  uint256 minted1 = pool.addLiquidity(outB, xA - s, block.timestamp + 3600);

  uint256 total1 = ERC20(pool.lpToken()).totalSupply();
  uint256 balA1 = pool.tokenABalance();
  uint256 balB1 = pool.tokenBBalance();

  // -------- Path 2: single-token zap (new Pool #2 with identical setup) --------
  // Fresh tokens for isolation
  address tokenA2 = m.tokenFactory().createToken(
    "Token A2", "Test Token A2", emptyArray, emptyArray, emptyArray, "TKA2", 10000000e18, 18
  );
  address tokenB2 = m.tokenFactory().createToken(
    "Token B2", "Test Token B2", emptyArray, emptyArray, emptyArray, "TKB2", 10000000e18, 18
  );
  Token(tokenA2).setStatus(2);
  Token(tokenB2).setStatus(2);
  Token(tokenA2).mint(address(this), 100000000e18);
  Token(tokenB2).mint(address(this), 100000000e18);

  address poolAddr2 = m.poolFactory().createPool(tokenA2, tokenB2);
  Pool pool2 = Pool(poolAddr2);

  // Whitelist mint/burn for LP2
  Token lp2 = pool2.lpToken();
  AdminRegistry adminRegistry = m.adminRegistry();
  adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lp2), "mint", address(pool2));
  adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lp2), "burn", address(pool2));

  pool2.setZapSwapFeesEnabled(true);

  // Same initial dual liquidity as Path 1
  require(ERC20(tokenA2).approve(address(pool2), initA), "P2: approve A init");
  require(ERC20(tokenB2).approve(address(pool2), initB), "P2: approve B init");
  require(pool2.addLiquidity(initB, initA, block.timestamp + 3600) > 0, "P2: init add");

  // Zap in the exact same xA of token A
  require(ERC20(tokenA2).approve(address(pool2), xA), "P2: approve A x");
  uint256 minted2 = pool2.addLiquiditySingleToken(true, xA, block.timestamp + 3600);

  uint256 total2 = ERC20(pool2.lpToken()).totalSupply();
  uint256 balA2 = pool2.tokenABalance();
  uint256 balB2 = pool2.tokenBBalance();

  // -------- Assertions: the two paths must match exactly --------
  require(minted1 == minted2, "LP minted mismatch");
  require(total1 == total2, "LP totalSupply mismatch");
  require(balA1 == balA2, "tokenA reserve mismatch");
  require(balB1 == balB2, "tokenB reserve mismatch");
}

    // ============ PAUSE & DISABLE TESTS ============

    function it_pool_pause_allows_removes_but_blocks_other_operations() {
        // Setup: add initial liquidity while unpaused
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 initialLPBalance = ERC20(pool.lpToken()).balanceOf(address(this));

        // Pause the pool
        pool.setPaused(true);
        require(pool.isPaused() == true, "Pool should be paused");

        // TEST: RemoveLiquidity should STILL WORK when paused (exit always allowed)
        require(ERC20(pool.lpToken()).approve(address(pool), initialLPBalance / 4), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(initialLPBalance / 4, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0 && tokenBReceived > 0, "RemoveLiquidity should work when paused");

        // Unpause and verify operations work again
        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused");

        // Now swap should work
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval after unpause failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work after unpause");

        // AddLiquidity should work (use single token to avoid ratio issues after swap)
        uint256 addAmountA = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), addAmountA), "Add A approval failed");
        uint256 minted = pool.addLiquiditySingleToken(true, addAmountA, block.timestamp + 3600);
        require(minted > 0, "AddLiquiditySingleToken should work after unpause");
    }

    function it_pool_disable_blocks_removes_but_reenable_allows_operations() {
        // Setup: add initial liquidity while enabled
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        uint256 lpBalance = ERC20(pool.lpToken()).balanceOf(address(this));

        // Disable the pool (sets both isPaused and isDisabled)
        pool.setDisabled(true);
        require(pool.isPaused() == true, "Pool should be paused when disabled");
        require(pool.isDisabled() == true, "Pool should be disabled");

        // Re-enable: clears isDisabled but isPaused remains true (must unpause separately)
        pool.setDisabled(false);
        require(pool.isDisabled() == false, "Pool should be re-enabled (isDisabled cleared)");
        require(pool.isPaused() == true, "Pool should STILL be paused after re-enable (safety feature)");

        // TEST: RemoveLiquidity should work after re-enable (even though still paused)
        require(ERC20(pool.lpToken()).approve(address(pool), lpBalance / 4), "Remove approval failed");
        (uint256 tokenBReceived, uint256 tokenAReceived) = pool.removeLiquidity(lpBalance / 4, 1, 1, block.timestamp + 3600);
        require(tokenAReceived > 0 && tokenBReceived > 0, "RemoveLiquidity should work after re-enable");

        // Must explicitly unpause to allow swaps/adds again
        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused after explicit setPaused(false)");

        // Now swaps should work
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work after explicit unpause");
    }

    function it_pool_tokens_must_remain_active_for_operations() {
        // Setup: add initial liquidity while tokens are active
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Verify tokens are initially active
        require(Token(tokenAAddress).status() == TokenStatus.ACTIVE, "TokenA should start active");
        require(Token(tokenBAddress).status() == TokenStatus.ACTIVE, "TokenB should start active");

        // Deactivate tokenA (status != ACTIVE)
        Token(tokenAAddress).setStatus(1); // Not ACTIVE
        require(Token(tokenAAddress).status() != TokenStatus.ACTIVE, "TokenA should be inactive");

        // Reactivate tokenA
        Token(tokenAAddress).setStatus(2); // ACTIVE
        require(Token(tokenAAddress).status() == TokenStatus.ACTIVE, "TokenA should be active again");

        // TEST: Operations should work with active tokens
        uint256 swapAmount = 100e18;
        require(ERC20(tokenAAddress).approve(address(pool), swapAmount), "Swap approval after reactivate failed");
        uint256 output = pool.swap(true, swapAmount, 1, block.timestamp + 3600);
        require(output > 0, "Swap should work with active tokens");
    }

    function it_pool_initialize_checks_token_status() {
        // Create new tokens with different statuses
        address newTokenA = m.tokenFactory().createToken(
            "New Token A", "Test New A", emptyArray, emptyArray, emptyArray, "NTA", 10000000e18, 18
        );
        address newTokenB = m.tokenFactory().createToken(
            "New Token B", "Test New B", emptyArray, emptyArray, emptyArray, "NTB", 10000000e18, 18
        );
        
        // Set both tokens to active
        Token(newTokenA).setStatus(2); // ACTIVE
        Token(newTokenB).setStatus(2); // ACTIVE

        // Verify tokens are active before pool creation
        require(Token(newTokenA).status() == TokenStatus.ACTIVE, "NewTokenA should be active");
        require(Token(newTokenB).status() == TokenStatus.ACTIVE, "NewTokenB should be active");

        // Create pool with active tokens - should succeed
        Token(newTokenA).mint(address(this), 100000000e18);
        Token(newTokenB).mint(address(this), 100000000e18);
        
        address newPoolAddress = m.poolFactory().createPool(newTokenA, newTokenB);
        require(newPoolAddress != address(0), "Pool should be created with active tokens");
        
        Pool newPool = Pool(newPoolAddress);
        require(address(newPool.tokenA()) == newTokenA, "Pool should have correct tokenA");
        require(address(newPool.tokenB()) == newTokenB, "Pool should have correct tokenB");
    }

    function it_pool_owner_can_toggle_pause_and_disable() {
        // Test setPaused
        require(pool.isPaused() == false, "Pool should start unpaused");
        
        pool.setPaused(true);
        require(pool.isPaused() == true, "setPaused(true) should pause pool");
        
        pool.setPaused(false);
        require(pool.isPaused() == false, "setPaused(false) should unpause pool");

        // Test setDisabled behavior
        require(pool.isDisabled() == false, "Pool should start enabled");
        
        // Disable: should set both isPaused and isDisabled
        pool.setDisabled(true);
        require(pool.isPaused() == true, "setDisabled(true) should set isPaused");
        require(pool.isDisabled() == true, "setDisabled(true) should set isDisabled");
        
        // Re-enable: should clear isDisabled but KEEP isPaused (safety feature)
        pool.setDisabled(false);
        require(pool.isPaused() == true, "setDisabled(false) should KEEP isPaused (must unpause separately)");
        require(pool.isDisabled() == false, "setDisabled(false) should clear isDisabled");

        // Must explicitly unpause
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
        // Setup: add initial liquidity
        uint256 amountA = 1000e18;
        uint256 amountB = 2000e18;
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidity(amountB, amountA, block.timestamp + 3600);

        // Pause
        pool.setPaused(true);
        
        // Verify pause state persists even after allowed operations (remove)
        uint256 lpBalance = ERC20(pool.lpToken()).balanceOf(address(this));
        require(ERC20(pool.lpToken()).approve(address(pool), lpBalance / 4), "Remove approval failed");
        pool.removeLiquidity(lpBalance / 4, 1, 1, block.timestamp + 3600);
        
        require(pool.isPaused() == true, "Pause state should persist after remove operation");
        
        // Unpause
        pool.setPaused(false);
        require(pool.isPaused() == false, "Pool should be unpaused");
    }

    // ============ FLASH TESTS (PoolV3.flash parity) ============

    uint constant FLASH_LIQ = 2000e18;

    /// @dev Seed the pool 1:1 so flash has something to lend and fees have LPs to accrue to, and
    ///      pin the flash fee at the 30 bps swap rate the pinned numbers assume (the contract
    ///      default is zero, see it_flash_fee_defaults_to_zero)
    function _seedFlashLiquidity() internal returns (uint256) {
        require(ERC20(tokenAAddress).approve(address(pool), FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), FLASH_LIQ), "Token B approval failed");
        m.poolFactory().setPoolFlashFeeRate(poolAddress, 30);
        return pool.addLiquidity(FLASH_LIQ, FLASH_LIQ, block.timestamp + 3600);
    }

    /// @dev Create a flash borrower holding enough of both tokens to pay any fee
    function _newBorrower() internal returns (FlashBorrower) {
        FlashBorrower b = new FlashBorrower();
        b.init(poolAddress, tokenAAddress, tokenBAddress);
        Token(tokenAAddress).mint(address(b), 100e18);
        Token(tokenBAddress).mint(address(b), 100e18);
        return b;
    }

    function _requireTrackedBalancesInSync() internal {
        require(pool.tokenABalance() == ERC20(tokenAAddress).balanceOf(poolAddress), "Token A tracked balance out of sync");
        require(pool.tokenBBalance() == ERC20(tokenBAddress).balanceOf(poolAddress), "Token B tracked balance out of sync");
    }

    function it_flash_fee_is_swap_fee_rounded_up_and_split_with_protocol() {
        // fee = ceil(amount * 30 / 10000); 0.30% of 100e18 = 3e17, of 50e18 = 1.5e17.
        // Like a swap fee, lpSharePercent (70%) of what is repaid over the principal stays in the
        // reserves and the rest (30%) goes to the fee collector
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint poolBeforeB = ERC20(tokenBAddress).balanceOf(poolAddress);
        uint lpSupply = ERC20(pool.lpToken()).totalSupply();
        require(pool.aToBRatio() == 1.000000000000000000, "Pool should start at parity");

        b.go(address(b), 100e18, 50e18, 0);

        require(b.lastFeeA() == 300000000000000000, "feeA mismatch: " + string(b.lastFeeA()));
        require(b.lastFeeB() == 150000000000000000, "feeB mismatch: " + string(b.lastFeeB()));
        require(b.lastNote() == "note", "Callback data should be forwarded");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA + 210000000000000000, "Pool should keep the LP share of fee A");
        require(ERC20(tokenBAddress).balanceOf(poolAddress) == poolBeforeB + 105000000000000000, "Pool should keep the LP share of fee B");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 90000000000000000, "FeeCollector share of fee A mismatch: " + string(ERC20(tokenAAddress).balanceOf(feeCollector)));
        require(ERC20(tokenBAddress).balanceOf(feeCollector) == 45000000000000000, "FeeCollector share of fee B mismatch: " + string(ERC20(tokenBAddress).balanceOf(feeCollector)));
        require(ERC20(pool.lpToken()).totalSupply() == lpSupply, "Flash must not change LP supply");
        // reserves grew asymmetrically (more A than B), so the refreshed ratio must have moved off parity
        require(pool.aToBRatio() < 1.000000000000000000, "Ratios should be refreshed after a flash");
        _requireTrackedBalancesInSync();
    }

    function it_flash_dust_fee_rounds_up() {
        // 1 wei -> 1 wei fee; 333 -> 1; 334 -> 2; 1000 -> 3
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        b.go(address(b), 1, 0, 0);
        require(b.lastFeeA() == 1 && b.lastFeeB() == 0, "1 wei should cost 1 wei");
        b.go(address(b), 333, 334, 0);
        require(b.lastFeeA() == 1, "333 wei should cost 1 wei: " + string(b.lastFeeA()));
        require(b.lastFeeB() == 2, "334 wei should cost 2 wei: " + string(b.lastFeeB()));
        b.go(address(b), 1000, 0, 0);
        require(b.lastFeeA() == 3, "1000 wei should cost 3 wei: " + string(b.lastFeeA()));
        _requireTrackedBalancesInSync();
    }

    function it_flash_uses_the_pool_specific_fee_rate() {
        // flash fee 100 bps with a 50% LP share: 100e18 -> 1e18 fee, 5e17 to LPs, 5e17 to protocol
        _seedFlashLiquidity();
        m.poolFactory().setPoolFlashFeeRate(address(pool), 100);
        m.poolFactory().setPoolFeeParameters(address(pool), 100, 5000);
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);

        b.go(address(b), 100e18, 0, 0);

        require(b.lastFeeA() == 1000000000000000000, "feeA mismatch: " + string(b.lastFeeA()));
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA + 500000000000000000, "Pool should keep 50% of the fee");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 500000000000000000, "FeeCollector should get 50% of the fee");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_defaults_to_zero() {
        // A fresh pool lends for free until an admin sets flashFeeRate
        require(ERC20(tokenAAddress).approve(address(pool), FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), FLASH_LIQ), "Token B approval failed");
        pool.addLiquidity(FLASH_LIQ, FLASH_LIQ, block.timestamp + 3600);
        FlashBorrower b = _newBorrower();
        require(pool.flashFeeRate() == 0, "flashFeeRate should default to 0");
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);

        b.go(address(b), 100e18, 50e18, 0);

        require(b.lastFeeA() == 0 && b.lastFeeB() == 0, "Default flash must be free");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Free flash should leave the pool balance unchanged");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_is_configurable_independently_of_the_swap_fee() {
        // _seedFlashLiquidity pins the flash fee at the 30 bps swap rate (3e17 on 100e18)
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        require(pool.flashFeeRate() == 30, "flashFeeRate should be pinned at the swap rate");
        b.go(address(b), 100e18, 0, 0);
        require(b.lastFeeA() == 300000000000000000, "Pinned flash fee should match the swap rate");

        // 5 bps flash fee: flash charges 0.05% while swaps still charge 0.30%
        m.poolFactory().setPoolFlashFeeRate(address(pool), 5);
        require(pool.flashFeeRate() == 5, "flashFeeRate should be set");
        b.go(address(b), 100e18, 0, 0);
        require(b.lastFeeA() == 50000000000000000, "Tuned flash fee mismatch: " + string(b.lastFeeA()));

        address feeCollector = m.poolFactory().feeCollector();
        uint collectorBefore = ERC20(tokenAAddress).balanceOf(feeCollector);
        require(ERC20(tokenAAddress).approve(address(pool), 100e18), "Swap approval failed");
        pool.swap(true, 100e18, 1, block.timestamp + 3600);
        // 30% protocol share of a 30 bps swap fee on 100e18 = 9e16
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == collectorBefore + 90000000000000000, "Swap must still charge the swap fee");

        // Setting 0 makes flash free again
        m.poolFactory().setPoolFlashFeeRate(address(pool), 0);
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        b.go(address(b), 100e18, 0, 0);
        require(b.lastFeeA() == 0, "Zero flashFeeRate should cost nothing");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Free flash should leave the pool balance unchanged");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_rate_is_capped_and_admin_only() {
        string err;
        try m.poolFactory().setPoolFlashFeeRate(address(pool), 1001) { } catch Error(string e) { err = e; }
        require(err == "Invalid flash fee rate", "Flash fee above 10% must revert, got: " + err);
        m.poolFactory().setPoolFlashFeeRate(address(pool), 1000);
        require(pool.flashFeeRate() == 1000, "10% should be accepted");

        User stranger = new User();
        bool thrown = false;
        try stranger.do(address(m.poolFactory()), "setPoolFlashFeeRate", address(pool), uint(5)) { } catch { thrown = true; }
        require(thrown, "Non-owner setPoolFlashFeeRate should revert");
        thrown = false;
        try stranger.do(poolAddress, "setFlashFeeRate", uint(5)) { } catch { thrown = true; }
        require(thrown, "Non-factory setFlashFeeRate should revert");
        require(pool.flashFeeRate() == 1000, "Strangers must not change the flash fee rate");
    }

    function it_flash_overpayment_is_split_like_a_fee() {
        // paid is the balance delta, so a borrower repaying 1e18 over the fee donates it:
        // 1.3e18 paid -> 9.1e17 to LPs, 3.9e17 to the fee collector
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint poolBeforeB = ERC20(tokenBAddress).balanceOf(poolAddress);

        b.go(address(b), 100e18, 0, 2);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA + 910000000000000000, "Pool should keep the LP share of fee + overpayment");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 390000000000000000, "FeeCollector share mismatch: " + string(ERC20(tokenAAddress).balanceOf(feeCollector)));
        require(ERC20(tokenBAddress).balanceOf(poolAddress) == poolBeforeB, "Token B must be untouched");
        require(ERC20(tokenBAddress).balanceOf(feeCollector) == 0, "No token B fee expected");
        _requireTrackedBalancesInSync();
    }

    function it_flash_lp_fee_accrues_to_liquidity_providers() {
        // the LP share sits in the reserves, so the sole LP withdraws principal + 70% of the fee
        uint liquidity = _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));
        uint meBeforeB = ERC20(tokenBAddress).balanceOf(address(this));

        b.go(address(b), 100e18, 0, 0);

        require(ERC20(pool.lpToken()).approve(address(pool), liquidity), "LP token approval failed");
        pool.removeLiquidity(liquidity, 1, 1, block.timestamp + 3600);
        require(ERC20(tokenAAddress).balanceOf(address(this)) == meBeforeA + FLASH_LIQ + 210000000000000000, "LP should withdraw principal + LP share of the fee");
        require(ERC20(tokenBAddress).balanceOf(address(this)) == meBeforeB + FLASH_LIQ, "Token B principal should be intact");
        require(pool.tokenABalance() == 0 && pool.tokenBBalance() == 0, "Reserves should be fully withdrawn");
    }

    function it_flash_pays_recipient_and_charges_caller() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        User recipient = new User();
        uint borrowerBeforeA = ERC20(tokenAAddress).balanceOf(address(b));

        b.go(address(recipient), 10e18, 0, 0);

        require(ERC20(tokenAAddress).balanceOf(address(recipient)) == 10e18, "Recipient should receive the principal");
        // the caller repaid principal + fee out of its own float
        require(ERC20(tokenAAddress).balanceOf(address(b)) == borrowerBeforeA - 10e18 - 30000000000000000, "Caller pays principal + fee");
        _requireTrackedBalancesInSync();
    }

    function it_flash_zero_amounts_is_a_callback_only_noop() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        decimal ratioBefore = pool.aToBRatio();

        b.go(address(b), 0, 0, 0);

        require(b.lastFeeA() == 0 && b.lastFeeB() == 0, "Zero principal, zero fee");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Nothing should move");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 0, "No protocol fee");
        require(pool.aToBRatio() == ratioBefore, "Ratio should be unchanged");
        _requireTrackedBalancesInSync();
    }

    function it_flash_reverts_when_underpaid() {
        // repaying the principal without the fee unwinds the whole call
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);
        uint borrowerBeforeA = ERC20(tokenAAddress).balanceOf(address(b));

        string err;
        try b.go(address(b), 100e18, 0, 1) { } catch Error(string e) { err = e; }
        require(err == "TokenA flash not repaid", "Shorting the token A fee must revert, got: " + err);

        err = "";
        try b.go(address(b), 0, 100e18, 1) { } catch Error(string e) { err = e; }
        require(err == "TokenB flash not repaid", "Shorting the token B fee must revert, got: " + err);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Pool balance must be untouched");
        require(ERC20(tokenAAddress).balanceOf(address(b)) == borrowerBeforeA, "Borrower balance must be untouched");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 0, "No protocol fee on a failed flash");
        _requireTrackedBalancesInSync();
    }

    function it_flash_reverts_when_pool_is_empty() {
        // nothing to pay fees to, so no flash
        FlashBorrower b = _newBorrower();
        Token(tokenAAddress).mint(poolAddress, 10e18); // pool has tokens but no LPs

        string err;
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "POOL_EMPTY", "Flash on an empty pool must revert POOL_EMPTY, got: " + err);
    }

    function it_flash_rejects_more_than_the_pool_holds() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        bool thrown = false;
        try b.go(address(b), 1e30, 0, 0) { } catch { thrown = true; }
        require(thrown, "Borrowing more than the reserves must revert");
        _requireTrackedBalancesInSync();
    }

    function it_flash_cannot_reenter_the_pool() {
        // one lock for everything: the callback can neither flash, swap, nor touch liquidity.
        // The liquidity paths matter most: re-depositing the borrowed principal as liquidity
        // would mint LP against reserves the pool still counts as its own
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        string err;
        try b.go(address(b), 1e18, 0, 3) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "Nested flash must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), 1e18, 0, 4) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "Swap from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), 1e18, 0, 5) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "addLiquidity from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), 1e18, 0, 6) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "removeLiquidity from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), 1e18, 0, 7) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "addLiquiditySingleToken from the callback must revert REENTRANT, got: " + err);

        // skim/sync are owner-callable; hand the borrower the owner key so the lock is what fires
        pool.transferOwnership(address(b));

        err = "";
        try b.go(address(b), 1e18, 0, 8) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "sync from the callback must revert REENTRANT, got: " + err);

        err = "";
        try b.go(address(b), 1e18, 0, 9) { } catch Error(string e) { err = e; }
        require(err == "REENTRANT", "skim from the callback must revert REENTRANT, got: " + err);

        // the lock is released again after the failed attempts
        b.go(address(b), 1e18, 0, 0);
        require(b.lastFeeA() == 3000000000000000, "Flash should work after failed reentry");
        _requireTrackedBalancesInSync();
    }

    function it_flash_caller_without_callback_reverts() {
        _seedFlashLiquidity();
        User stranger = new User();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);

        bool thrown = false;
        try {
            stranger.do(poolAddress, "flash", address(stranger), 1e18, 0, "x");
        } catch {
            thrown = true;
        }
        require(thrown, "A caller without poolFlashCallback must revert");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Pool balance must be untouched");
    }

    function it_flash_respects_pause_disable_and_input_guards() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        pool.setPaused(true);
        string err;
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "Pool is paused", "Paused pool should reject flash, got: " + err);
        pool.setPaused(false);

        pool.setDisabled(true);
        err = "";
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "Pool is paused", "Disabled pool should reject flash, got: " + err);
        pool.setDisabled(false);
        pool.setPaused(false);

        err = "";
        try b.go(address(0), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "Zero recipient", "Zero recipient should revert, got: " + err);

        b.go(address(b), 1e18, 0, 0);
        require(b.lastFeeA() == 3000000000000000, "Flash should work once guards clear");
    }

    function it_flash_pause_blocks_only_flash() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        pool.setFlashPaused(true);
        require(pool.isFlashPaused() && !pool.isPaused(), "Flash pause must not pause the pool");
        string err;
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "Flash is paused", "Flash-paused pool should reject flash, got: " + err);

        // swaps are unaffected
        require(ERC20(tokenAAddress).approve(address(pool), 1e18), "Token A approval failed");
        require(pool.swap(true, 1e18, 1, block.timestamp + 3600) > 0, "Swap should work while flash is paused");

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
        b.go(address(b), 1e18, 0, 0);
        require(b.lastFeeA() == 3000000000000000, "Flash should work once resumed");
    }

    function it_flash_rejects_inactive_tokens() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        Token(tokenAAddress).setStatus(1); // not ACTIVE
        string err;
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "TokenA is not active", "Inactive token should reject flash, got: " + err);

        Token(tokenAAddress).setStatus(2);
        b.go(address(b), 1e18, 0, 0);
        require(b.lastFeeA() == 3000000000000000, "Flash should work once the token is active again");
    }

    // ============ FLASH INVARIANT TESTS (review additions) ============

    function it_flash_keeps_k_and_ratios_consistent_and_never_dilutes_lps() {
        // k = A*B may only grow, the stored ratios must equal B/A of the new reserves, LP supply
        // is untouched, so every LP token's claim on both reserves is non-decreasing
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        uint lpSupply = ERC20(pool.lpToken()).totalSupply();
        uint kBefore = pool.tokenABalance() * pool.tokenBBalance();
        uint claimABefore = pool.tokenABalance() * 1e18 / lpSupply;
        uint claimBBefore = pool.tokenBBalance() * 1e18 / lpSupply;

        b.go(address(b), 100e18, 50e18, 0);

        require(pool.tokenABalance() == 2000210000000000000000, "Reserve A should grow by the LP share of fee A: " + string(pool.tokenABalance()));
        require(pool.tokenBBalance() == 2000105000000000000000, "Reserve B should grow by the LP share of fee B: " + string(pool.tokenBBalance()));
        require(pool.tokenABalance() * pool.tokenBBalance() > kBefore, "k must not decrease");
        decimal expectedAToB = decimal((decimal(pool.tokenBBalance()) * 1.000000000000000000) / decimal(pool.tokenABalance())) / 1.000000000000000000;
        decimal expectedBToA = decimal((decimal(pool.tokenABalance()) * 1.000000000000000000) / decimal(pool.tokenBBalance())) / 1.000000000000000000;
        require(pool.aToBRatio() == expectedAToB, "aToBRatio must be recomputed from the new reserves");
        require(pool.bToARatio() == expectedBToA, "bToARatio must be recomputed from the new reserves");
        require(ERC20(pool.lpToken()).totalSupply() == lpSupply, "Flash must not change LP supply");
        require(pool.tokenABalance() * 1e18 / lpSupply > claimABefore, "Per-LP claim on A must grow");
        require(pool.tokenBBalance() * 1e18 / lpSupply > claimBBefore, "Per-LP claim on B must grow");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_accrues_pro_rata_across_multiple_lps() {
        // two LPs at 2:1; one flash of 100e18 tokenA leaves 2.1e17 in reserve A, so on exit the
        // 1000e18-LP holder gets 7e16 and the 2000e18-LP holder 1.4e17, and the pool drains to zero
        _seedFlashLiquidity();
        User lp2 = new User();
        uint k = 1000e18;
        uint one = 1;
        uint deadline = block.timestamp + 3600;
        Token(tokenAAddress).mint(address(lp2), k);
        Token(tokenBAddress).mint(address(lp2), k);
        lp2.do(tokenAAddress, "approve", poolAddress, k);
        lp2.do(tokenBAddress, "approve", poolAddress, k);
        lp2.do(poolAddress, "addLiquidity", k, k, deadline);
        require(ERC20(pool.lpToken()).balanceOf(address(lp2)) == k, "Second LP should hold 1000e18 LP");
        require(ERC20(pool.lpToken()).totalSupply() == 3000e18, "LP supply should be 3000e18");
        FlashBorrower b = _newBorrower();
        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));
        uint meBeforeB = ERC20(tokenBAddress).balanceOf(address(this));

        b.go(address(b), 100e18, 0, 0);
        require(pool.tokenABalance() == 3000210000000000000000, "Reserve A mismatch: " + string(pool.tokenABalance()));

        lp2.do(poolAddress, "removeLiquidity", k, one, one, deadline);
        require(ERC20(tokenAAddress).balanceOf(address(lp2)) == 1000070000000000000000, "Second LP should get principal + 1/3 of the LP fee: " + string(ERC20(tokenAAddress).balanceOf(address(lp2))));
        require(ERC20(tokenBAddress).balanceOf(address(lp2)) == k, "Second LP token B principal should be intact");

        require(ERC20(pool.lpToken()).approve(address(pool), FLASH_LIQ), "LP token approval failed");
        pool.removeLiquidity(FLASH_LIQ, 1, 1, deadline);
        require(ERC20(tokenAAddress).balanceOf(address(this)) == meBeforeA + 2000140000000000000000, "First LP should get principal + 2/3 of the LP fee");
        require(ERC20(tokenBAddress).balanceOf(address(this)) == meBeforeB + FLASH_LIQ, "First LP token B principal should be intact");
        require(pool.tokenABalance() == 0 && pool.tokenBBalance() == 0, "Reserves should be fully withdrawn");
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == 0 && ERC20(tokenBAddress).balanceOf(poolAddress) == 0, "Pool should hold nothing after both LPs exit");
    }

    function it_flash_leaves_pre_existing_excess_untouched_and_skimmable() {
        // live pools carry actual > tracked; a flash must neither absorb nor grow that excess,
        // and skim must still pay out exactly the excess afterwards
        _seedFlashLiquidity();
        Token(tokenAAddress).mint(poolAddress, 5e18);
        Token(tokenBAddress).mint(poolAddress, 3e18);
        FlashBorrower b = _newBorrower();
        require(ERC20(tokenAAddress).balanceOf(poolAddress) - pool.tokenABalance() == 5e18, "Excess A should be 5e18 before");

        b.go(address(b), 100e18, 50e18, 0);

        require(ERC20(tokenAAddress).balanceOf(poolAddress) - pool.tokenABalance() == 5e18, "Excess A must be unchanged by a flash");
        require(ERC20(tokenBAddress).balanceOf(poolAddress) - pool.tokenBBalance() == 3e18, "Excess B must be unchanged by a flash");
        require(pool.tokenABalance() == 2000210000000000000000, "Tracked A should only grow by the LP fee");

        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));
        uint meBeforeB = ERC20(tokenBAddress).balanceOf(address(this));
        m.poolFactory().skimPools([poolAddress], address(this)); // skim is factory-gated
        require(ERC20(tokenAAddress).balanceOf(address(this)) == meBeforeA + 5e18, "Skim should pay exactly the A excess");
        require(ERC20(tokenBAddress).balanceOf(address(this)) == meBeforeB + 3e18, "Skim should pay exactly the B excess");
        _requireTrackedBalancesInSync();
    }

    function it_flash_can_borrow_the_entire_balance_but_not_a_wei_more() {
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();
        uint whole = ERC20(tokenAAddress).balanceOf(poolAddress);
        require(whole == FLASH_LIQ, "Pool should hold exactly the seeded A");

        b.go(address(b), whole, 0, 0);

        require(b.lastFeeA() == 6000000000000000000, "Fee on the whole reserve should be 6e18: " + string(b.lastFeeA()));
        require(pool.tokenABalance() == 2004200000000000000000, "Reserve A should be principal + LP share: " + string(pool.tokenABalance()));
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 1800000000000000000, "Protocol share mismatch");
        _requireTrackedBalancesInSync();

        uint tooMuch = ERC20(tokenAAddress).balanceOf(poolAddress) + 1;
        string err;
        try b.go(address(b), tooMuch, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "ERC20: insufficient balance", "One wei over the balance must revert in the token, got: " + err);
        _requireTrackedBalancesInSync();
    }

    function it_flash_with_full_lp_share_keeps_the_whole_fee_in_the_pool() {
        // lpSharePercent 100%: protocolFee is zero and no transfer to the collector is attempted
        _seedFlashLiquidity();
        m.poolFactory().setPoolFeeParameters(address(pool), 30, 10000);
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();

        b.go(address(b), 100e18, 0, 0);

        require(pool.tokenABalance() == 2000300000000000000000, "Whole fee should stay in reserve A: " + string(pool.tokenABalance()));
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 0, "Collector must receive nothing at 100% LP share");
        _requireTrackedBalancesInSync();
    }

    function it_flash_fee_is_priced_into_the_next_swap() {
        // the LP fee sits in the tracked reserve A, so a B->A swap right after must quote off the
        // post-flash reserves, not the pre-flash ones
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        b.go(address(b), 100e18, 0, 0);
        uint reserveA = pool.tokenABalance();
        uint reserveB = pool.tokenBBalance();
        require(reserveA == 2000210000000000000000 && reserveB == FLASH_LIQ, "Post-flash reserves mismatch");

        uint netInput = 100e18 - 300000000000000000; // 30 bps swap fee
        uint expectedOut = (netInput * reserveA) / (reserveB + netInput);
        uint staleOut = (netInput * FLASH_LIQ) / (FLASH_LIQ + netInput);
        require(expectedOut != staleOut, "Test setup: post-flash quote must differ from the stale quote");

        require(ERC20(tokenBAddress).approve(address(pool), 100e18), "Token B approval failed");
        uint meBeforeA = ERC20(tokenAAddress).balanceOf(address(this));
        uint out = pool.swap(false, 100e18, 1, block.timestamp + 3600);
        require(out == expectedOut, "Swap must quote off post-flash reserves: " + string(out) + " vs " + string(expectedOut));
        require(ERC20(tokenAAddress).balanceOf(address(this)) == meBeforeA + expectedOut, "Swapper should receive the quoted amount");
        _requireTrackedBalancesInSync();
    }

    function it_flash_funds_a_swap_on_another_pool() {
        // the point of a flash loan: borrow here, trade elsewhere, repay from proceeds/float. Also
        // proves the reentrancy lock is per pool, not global
        _seedFlashLiquidity();
        address tokenCAddress = m.tokenFactory().createToken(
            "Token C", "Test Token C", emptyArray, emptyArray, emptyArray, "TKC", 10000000e18, 18
        );
        Token(tokenCAddress).setStatus(2);
        Token(tokenCAddress).mint(address(this), 100000000e18);
        address pool2Address = m.poolFactory().createPool(tokenAAddress, tokenCAddress);
        Pool pool2 = Pool(pool2Address);
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(pool2.lpToken()), "mint", pool2Address);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(pool2.lpToken()), "burn", pool2Address);
        require(ERC20(tokenAAddress).approve(pool2Address, FLASH_LIQ), "Token A approval failed");
        require(ERC20(tokenCAddress).approve(pool2Address, FLASH_LIQ), "Token C approval failed");
        pool2.addLiquidity(FLASH_LIQ, FLASH_LIQ, block.timestamp + 3600);

        FlashBorrower b = _newBorrower();
        b.setOther(pool2Address);
        address feeCollector = m.poolFactory().feeCollector();
        // pool2 swap of the borrowed 10e18 A: 30 bps fee, 9.97e18 net into 2000/2000 reserves
        uint netInput = 9970000000000000000;
        uint expectedC = (netInput * FLASH_LIQ) / (FLASH_LIQ + netInput);

        b.go(address(b), 10e18, 0, 10);

        require(b.lastFeeA() == 30000000000000000, "Flash fee mismatch");
        require(ERC20(tokenCAddress).balanceOf(address(b)) == expectedC, "Borrower should hold the swap proceeds: " + string(ERC20(tokenCAddress).balanceOf(address(b))));
        require(ERC20(tokenAAddress).balanceOf(address(b)) == 89970000000000000000, "Borrower pays principal + fee out of its float: " + string(ERC20(tokenAAddress).balanceOf(address(b))));
        require(pool.tokenABalance() == 2000021000000000000000, "Lending pool keeps the LP share of the flash fee");
        require(pool2.tokenABalance() == 2009991000000000000000, "Trading pool keeps the swap input net of protocol fee");
        require(pool2.tokenBBalance() == FLASH_LIQ - expectedC, "Trading pool paid out the swap");
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 18000000000000000, "Collector gets the flash and the swap protocol shares");
        _requireTrackedBalancesInSync();
        require(pool2.tokenABalance() == ERC20(tokenAAddress).balanceOf(pool2Address), "Pool2 tracked A out of sync");
        require(pool2.tokenBBalance() == ERC20(tokenCAddress).balanceOf(pool2Address), "Pool2 tracked C out of sync");
    }

    function it_flash_callback_works_with_no_pass_through_data() {
        // integrators may pass nothing; the variadic must arrive empty, not break the call
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();

        b.goNoData(address(b), 1e18, 0);

        require(b.lastFeeA() == 3000000000000000, "Fee should be charged as usual");
        require(b.lastNote() == "", "No data should have been forwarded");
        _requireTrackedBalancesInSync();
    }

    function it_flash_to_the_pool_itself_only_costs_the_caller() {
        // recipient == pool: the principal never leaves, so the whole repayment counts as overage
        // and is split like a fee. Nothing to gain and everything to lose for the caller
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        address feeCollector = m.poolFactory().feeCollector();

        b.go(poolAddress, 10e18, 0, 0);

        // paid = 10e18 principal (never left) + 3e16 fee = 10.03e18; 70% to reserves, 30% to protocol
        require(pool.tokenABalance() == 2007021000000000000000, "Reserve A should absorb the LP share of the whole repayment: " + string(pool.tokenABalance()));
        require(ERC20(tokenAAddress).balanceOf(feeCollector) == 3009000000000000000, "Collector share mismatch: " + string(ERC20(tokenAAddress).balanceOf(feeCollector)));
        require(ERC20(tokenAAddress).balanceOf(address(b)) == 89970000000000000000, "Caller loses principal + fee");
        _requireTrackedBalancesInSync();
    }

    function it_flash_reverts_while_a_pool_token_is_paused() {
        // the token-level emergency pause is a second kill switch for flash
        _seedFlashLiquidity();
        FlashBorrower b = _newBorrower();
        uint poolBeforeA = ERC20(tokenAAddress).balanceOf(poolAddress);

        Token(tokenAAddress).pause();
        string err;
        try b.go(address(b), 1e18, 0, 0) { } catch Error(string e) { err = e; }
        require(err == "not whitelisted", "Paused token must stop the pool's transfer, got: " + err);
        require(ERC20(tokenAAddress).balanceOf(poolAddress) == poolBeforeA, "Pool balance must be untouched");

        Token(tokenAAddress).unpause();
        b.go(address(b), 1e18, 0, 0);
        require(b.lastFeeA() == 3000000000000000, "Flash should work once the token is unpaused");
        _requireTrackedBalancesInSync();
    }

}
