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

    function it_pool_can_swap_a_to_b_multiple_times() {
        uint256 amountA = 2000e18;
        uint256 amountB = 2000e18;

        // Add liquidity first
        require(ERC20(tokenAAddress).approve(address(pool), amountA), "Token A approval failed");
        require(ERC20(tokenBAddress).approve(address(pool), amountB), "Token B approval failed");
        pool.addLiquidityGeneral([amountA, amountB], amountB, address(0));

        // Test swap A to B
        uint256 swapAmount = 100e18;
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)));
        require(ERC20(tokenAAddress).approve(address(pool), 50*swapAmount), "Swap A approval failed");
        for (uint i = 0; i < 50; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(0, 1, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14));
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
        uint256 swapAmount = 100e18;
        require(ERC20(tokenBAddress).approve(address(pool), 50*swapAmount), "Swap A approval failed");
        // log(string(ERC20(tokenAAddress).balanceOf(address(pool))/1e14) + "," + string(string(ERC20(tokenBAddress).balanceOf(address(pool))/1e14)));
        for (uint i = 0; i < 50; i++) {
            uint tokenAPre = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPre = ERC20(tokenBAddress).balanceOf(address(pool));
            uint256 output = pool.exchange(1, 0, swapAmount, 1, address(0));
            uint tokenAPost = ERC20(tokenAAddress).balanceOf(address(pool));
            uint tokenBPost = ERC20(tokenBAddress).balanceOf(address(pool));
            // log(string(tokenAPost/1e14) + "," + string(tokenBPost/1e14));
            // log("Point " + string(i+80) + "::" + string(tokenAPre/1e14) + "::" + string(tokenBPre/1e14) + "::" + string(output/1e14) + "::" + string(output/1e14) + "::10::A::1::0::0::0::0;");
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
}