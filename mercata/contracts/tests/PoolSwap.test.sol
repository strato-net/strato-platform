import "../concrete/BaseCodeCollection.sol";

contract PoolSwapUser {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_MercataPoolSwap {
    Mercata m;
    uint internal tokenCounter;

    function beforeAll() {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    struct PoolFixture {
        address pool;
        Token tokenA;
        Token tokenB;
        PoolSwapUser trader;
    }

    function _createActiveToken(string baseSymbol) internal returns (Token) {
        tokenCounter += 1;
        string suffix = string(tokenCounter);
        string symbol = baseSymbol + suffix;
        string name = baseSymbol + " Token " + suffix;
        address tokenAddr = m.tokenFactory().createToken(symbol, name, [], [], [], symbol, 0, 18);
        Token(tokenAddr).setStatus(2);
        return Token(tokenAddr);
    }

    function _setupPool(
        uint tokenAAmount,
        uint tokenBAmount,
        uint traderTokenAAmount,
        uint traderTokenBAmount
    ) internal returns (PoolFixture memory) {
        Token tokenA = _createActiveToken("ETHST");
        Token tokenB = _createActiveToken("USDST");

        tokenA.mint(address(this), tokenAAmount);
        tokenB.mint(address(this), tokenBAmount);

        PoolSwapUser trader = new PoolSwapUser();
        if (traderTokenAAmount > 0) {
            tokenA.mint(address(trader), traderTokenAAmount);
        }
        if (traderTokenBAmount > 0) {
            tokenB.mint(address(trader), traderTokenBAmount);
        }

        address pool = m.poolFactory().createPool(address(tokenA), address(tokenB));
        require(pool != address(0), "Failed to create pool");

        require(ERC20(address(tokenA)).approve(pool, tokenAAmount), "Approval failed for tokenA");
        require(ERC20(address(tokenB)).approve(pool, tokenBAmount), "Approval failed for tokenB");

        uint liquidity = Pool(pool).addLiquidity(tokenBAmount, tokenAAmount, block.timestamp + 1000);
        require(liquidity > 0, "Failed to add liquidity");

        return PoolFixture(pool, tokenA, tokenB, trader);
    }

    function it_charges_fees_and_updates_state_on_a_to_b_swaps() {
        uint traderAmount = 10e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount, 0);

        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, traderAmount), "Approval failed");

        uint swapFeeRate = m.poolFactory().swapFeeRate();
        uint lpSharePercent = m.poolFactory().lpSharePercent();
        uint fee = (traderAmount * swapFeeRate) / 10000;
        uint protocolFee = fee - ((fee * lpSharePercent) / 10000);
        uint netInput = traderAmount - fee;

        uint initialTokenABalance = Pool(fixture.pool).tokenABalance();
        uint initialTokenBBalance = Pool(fixture.pool).tokenBBalance();
        uint initialProtocolBalance = ERC20(address(fixture.tokenA)).balanceOf(address(m.feeCollector()));

        uint expectedAmountOut = (netInput * initialTokenBBalance) / (initialTokenABalance + netInput);
        uint minAmountOut = (expectedAmountOut * 9950) / 10000;

        uint amountOut = fixture.trader.do(fixture.pool, "swap", true, traderAmount, minAmountOut, block.timestamp + 1000);

        require(amountOut == expectedAmountOut, "Unexpected output amount: " + string(amountOut));
        require(Pool(fixture.pool).tokenABalance() == initialTokenABalance + netInput, "TokenA balance not updated correctly");
        require(Pool(fixture.pool).tokenBBalance() == initialTokenBBalance - amountOut, "TokenB balance not updated correctly");

        uint protocolBalance = ERC20(address(fixture.tokenA)).balanceOf(address(m.feeCollector()));
        require(protocolBalance == initialProtocolBalance + protocolFee, "Protocol fee not collected correctly");
    }

    function it_supports_swapping_token_b_for_token_a() {
        uint traderAmount = 500000e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, 0, traderAmount);

        require(fixture.trader.do(address(fixture.tokenB), "approve", fixture.pool, traderAmount), "Approval failed");

        uint swapFeeRate = m.poolFactory().swapFeeRate();
        uint lpSharePercent = m.poolFactory().lpSharePercent();
        uint fee = (traderAmount * swapFeeRate) / 10000;
        uint protocolFee = fee - ((fee * lpSharePercent) / 10000);
        uint netInput = traderAmount - fee;

        uint initialTokenABalance = Pool(fixture.pool).tokenABalance();
        uint initialTokenBBalance = Pool(fixture.pool).tokenBBalance();
        uint initialProtocolBalance = ERC20(address(fixture.tokenB)).balanceOf(address(m.feeCollector()));

        uint expectedAmountOut = (netInput * initialTokenABalance) / (initialTokenBBalance + netInput);
        uint minAmountOut = (expectedAmountOut * 9950) / 10000;

        uint amountOut = fixture.trader.do(fixture.pool, "swap", false, traderAmount, minAmountOut, block.timestamp + 1000);

        require(amountOut == expectedAmountOut, "Unexpected tokenA received: " + string(amountOut));
        require(Pool(fixture.pool).tokenABalance() == initialTokenABalance - amountOut, "TokenA reserve incorrect after swap");
        require(Pool(fixture.pool).tokenBBalance() == initialTokenBBalance + netInput, "TokenB reserve incorrect after swap");

        uint protocolBalance = ERC20(address(fixture.tokenB)).balanceOf(address(m.feeCollector()));
        require(protocolBalance == initialProtocolBalance + protocolFee, "Protocol fee not collected correctly");
    }

    function it_reverts_swaps_when_minimum_amount_not_met() {
        uint traderAmount = 5e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount, 0);

        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, traderAmount), "Approval failed");

        uint swapFeeRate = m.poolFactory().swapFeeRate();
        uint fee = (traderAmount * swapFeeRate) / 10000;
        uint netInput = traderAmount - fee;

        uint expectedAmountOut = (netInput * Pool(fixture.pool).tokenBBalance()) /
            (Pool(fixture.pool).tokenABalance() + netInput);
        uint minAmountOut = expectedAmountOut + 1;

        bool didRevert = false;
        try {
            fixture.trader.do(fixture.pool, "swap", true, traderAmount, minAmountOut, block.timestamp + 1000);
        } catch {
            didRevert = true;
        }

        require(didRevert, "Swap should revert when minimum amount is not met");
    }

    function it_reverts_swaps_with_zero_input_amount() {
        uint tokenAReserve = 4000e18;
        uint tokenBReserve = 10000000e18;

        PoolFixture memory fixture = _setupPool(tokenAReserve, tokenBReserve, 1e18, 0);
        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, 1e18), "Approval failed");

        bool didRevert = false;
        try {
            fixture.trader.do(fixture.pool, "swap", true, 0, 1, block.timestamp + 1000);
        } catch {
            didRevert = true;
        }

        require(didRevert, "Swap should revert on zero input amount");
    }

    function it_reverts_swaps_when_deadline_has_passed() {
        uint traderAmount = 2e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount, 0);

        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, traderAmount), "Approval failed");

        bool didRevert = false;
        try {
            fixture.trader.do(fixture.pool, "swap", true, traderAmount, 1, block.timestamp - 1);
        } catch {
            didRevert = true;
        }

        require(didRevert, "Swap should revert when deadline has passed");
    }

    function it_requires_trader_to_grant_allowance_before_swapping() {
        uint traderAmount = 3e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount, 0);

        bool didRevert = false;
        try {
            fixture.trader.do(fixture.pool, "swap", true, traderAmount, 1, block.timestamp + 1000);
        } catch {
            didRevert = true;
        }

        require(didRevert, "Swap should revert without sufficient allowance");
    }

    function it_updates_reserves_between_sequential_swaps() {
        uint traderAmount = 4e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount * 3, 0);

        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, traderAmount * 3), "Approval failed");

        uint swapFeeRate = m.poolFactory().swapFeeRate();

        uint initialTokenABalance = Pool(fixture.pool).tokenABalance();
        uint initialTokenBBalance = Pool(fixture.pool).tokenBBalance();

        uint feePerSwap = (traderAmount * swapFeeRate) / 10000;
        uint netInput = traderAmount - feePerSwap;

        uint expectedFirstOut = (netInput * initialTokenBBalance) / (initialTokenABalance + netInput);
        uint firstOut = fixture.trader.do(fixture.pool, "swap", true, traderAmount, expectedFirstOut, block.timestamp + 1000);
        require(firstOut == expectedFirstOut, "Unexpected first swap amount: " + string(firstOut));

        uint afterFirstTokenABalance = Pool(fixture.pool).tokenABalance();
        uint afterFirstTokenBBalance = Pool(fixture.pool).tokenBBalance();

        require(afterFirstTokenABalance == initialTokenABalance + netInput, "TokenA reserve incorrect after first swap");
        require(afterFirstTokenBBalance == initialTokenBBalance - firstOut, "TokenB reserve incorrect after first swap");

        uint expectedSecondOut = (netInput * afterFirstTokenBBalance) / (afterFirstTokenABalance + netInput);
        uint secondOut = fixture.trader.do(fixture.pool, "swap", true, traderAmount, expectedSecondOut, block.timestamp + 1000);
        require(secondOut == expectedSecondOut, "Unexpected second swap amount: " + string(secondOut));
        require(secondOut < firstOut, "Second swap should experience price impact");

        require(Pool(fixture.pool).tokenABalance() == afterFirstTokenABalance + netInput, "TokenA reserve incorrect after second swap");
        require(Pool(fixture.pool).tokenBBalance() == afterFirstTokenBBalance - secondOut, "TokenB reserve incorrect after second swap");
    }

    function it_accumulates_protocol_fees_across_multiple_swaps() {
        uint traderAmount = 3e18;

        PoolFixture memory fixture = _setupPool(4000e18, 10000000e18, traderAmount * 4, 0);

        require(fixture.trader.do(address(fixture.tokenA), "approve", fixture.pool, traderAmount * 4), "Approval failed");

        uint swapFeeRate = m.poolFactory().swapFeeRate();
        uint lpSharePercent = m.poolFactory().lpSharePercent();

        uint initialTokenABalance = Pool(fixture.pool).tokenABalance();
        uint initialTokenBBalance = Pool(fixture.pool).tokenBBalance();
        uint initialProtocolBalance = ERC20(address(fixture.tokenA)).balanceOf(address(m.feeCollector()));

        uint feePerSwap = (traderAmount * swapFeeRate) / 10000;
        uint protocolFeePerSwap = feePerSwap - ((feePerSwap * lpSharePercent) / 10000);
        uint netInput = traderAmount - feePerSwap;

        uint expectedFirstOut = (netInput * initialTokenBBalance) / (initialTokenABalance + netInput);
        uint firstOut = fixture.trader.do(fixture.pool, "swap", true, traderAmount, expectedFirstOut, block.timestamp + 1000);
        require(firstOut == expectedFirstOut, "Unexpected first swap output");

        uint interimTokenABalance = Pool(fixture.pool).tokenABalance();
        uint interimTokenBBalance = Pool(fixture.pool).tokenBBalance();

        uint expectedSecondOut = (netInput * interimTokenBBalance) / (interimTokenABalance + netInput);
        uint secondOut = fixture.trader.do(fixture.pool, "swap", true, traderAmount, expectedSecondOut, block.timestamp + 1000);
        require(secondOut == expectedSecondOut, "Unexpected second swap output");

        uint expectedProtocolBalance = initialProtocolBalance + (protocolFeePerSwap * 2);
        uint protocolBalance = ERC20(address(fixture.tokenA)).balanceOf(address(m.feeCollector()));

        require(protocolBalance == expectedProtocolBalance, "Protocol fees did not accumulate across swaps");
    }
}
