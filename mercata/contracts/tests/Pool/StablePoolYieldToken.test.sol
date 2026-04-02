import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract Describe_StablePool_YieldToken is Authorizable {

    Mercata m;
    string[] emptyArray;

    address usdstAddress;
    address tokenBAddress;
    SaveUSDSTVault vault;
    address vaultAddress;
    StablePool pool;
    PriceOracle oracle;

    uint constant PRECISION = 1e18;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        oracle = m.priceOracle();
        emptyArray = new string[](0);
    }

    function _createStablePool(address coinA, address coinB) internal returns (StablePool) {
        address lpTokenAddr = m.tokenFactory().createToken(
            "LP Token", "LP", emptyArray, emptyArray, emptyArray, "LP", 0, 18
        );
        Token(lpTokenAddr).setStatus(2);

        StablePool p = new StablePool(address(this));
        p.initialize(
            100,                                // amp
            30000000,                            // fee: 30 bps * 1e6
            1e10,                               // offpeg fee multiplier
            block.timestamp,                    // ma exp time
            [coinA, coinB],                     // coins
            [uint(1e18), uint(1e18)],           // rate multipliers
            [uint(1), uint(1)],                 // asset types
            [address(0), address(0)],           // oracles
            lpTokenAddr                         // lp token
        );

        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", lpTokenAddr, "mint", address(p));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", lpTokenAddr, "burn", address(p));

        return p;
    }

    function beforeEach() {
        usdstAddress = m.tokenFactory().createToken(
            "USDST", "USDST Stablecoin", emptyArray, emptyArray, emptyArray, "USDST", 0, 18
        );
        Token(usdstAddress).setStatus(2);
        Token(usdstAddress).mint(address(this), 10000000e18);

        tokenBAddress = m.tokenFactory().createToken(
            "Token B", "Test Token B", emptyArray, emptyArray, emptyArray, "TKB", 0, 18
        );
        Token(tokenBAddress).setStatus(2);
        Token(tokenBAddress).mint(address(this), 10000000e18);

        vault = new SaveUSDSTVault(address(this));
        vault.initialize(usdstAddress, "Save USDST", "saveUSDST");
        vaultAddress = address(vault);

        // Seed the vault: deposit so exchangeRate starts at 1:1
        Token(usdstAddress).approve(vaultAddress, 100000e18);
        vault.deposit(100000e18, address(this));

        // Create pool directly (bypass PoolFactory's tokensActive check)
        fastForward(100);
        pool = _createStablePool(tokenBAddress, vaultAddress);
        pool.setUsdst(usdstAddress);
        pool.setIsYieldToken(vaultAddress, true);
        pool.updateRateOracles(address(0), address(oracle));
    }

    // =====================================================================
    // Test 1: _storedRates returns xRate when underlying is USDST (no oracle multiply)
    // =====================================================================

    function it_returns_exchange_rate_for_yield_token_with_usdst_underlying() {
        require(vault.exchangeRate() == 1e18, "initial exchange rate should be 1e18");

        // Add reward → rate = 1.2
        Token(usdstAddress).transfer(vaultAddress, 20000e18);
        vault.recordRewardTransfer(20000e18);
        require(vault.exchangeRate() == 12e17, "exchange rate should be 1.2e18");

        // coins[0]=tokenB (rate 1e18), coins[1]=saveUSDST (rate 1.2e18)
        // Depositing equal token amounts should value saveUSDST side higher.
        uint amountB = 1200e18;
        uint amountV = 1000e18;
        Token(tokenBAddress).approve(address(pool), amountB);
        ERC20(vaultAddress).approve(address(pool), amountV);
        uint lp = pool.addLiquidityGeneral([amountB, amountV], 1, address(0));
        require(lp > 0, "should mint LP tokens");

        // Swap 10 saveUSDST→tokenB. Since saveUSDST is worth 1.2x tokenB, should get >10 tokenB.
        ERC20(vaultAddress).approve(address(pool), 10e18);
        uint out = pool.exchange(1, 0, 10e18, 1, address(0));
        require(out > 10e18, "saveUSDST should be worth more than tokenB");
        log("Test 1 — xRate=1.2, swap 10 saveUSDST→tokenB, got: " + string(out / 1e14) + " (x1e14)");
    }

    // =====================================================================
    // Test 2: exchange rate growth changes pool pricing
    // =====================================================================

    function it_reflects_exchange_rate_growth_in_pool_pricing() {
        // Seed pool at 1:1 rate
        Token(tokenBAddress).approve(address(pool), 2000e18);
        ERC20(vaultAddress).approve(address(pool), 2000e18);
        pool.addLiquidityGeneral([uint(2000e18), uint(2000e18)], 1, address(0));

        // Swap 100 saveUSDST→tokenB at rate=1.0
        ERC20(vaultAddress).approve(address(pool), 100e18);
        uint outBefore = pool.exchange(1, 0, 100e18, 1, address(0));
        log("Test 2 — rate=1.0, swap 100 saveUSDST→tokenB: " + string(outBefore / 1e14) + " (x1e14)");

        // Inject reward → rate doubles
        Token(usdstAddress).transfer(vaultAddress, 100000e18);
        vault.recordRewardTransfer(100000e18);
        uint newRate = vault.exchangeRate();
        require(newRate > 1e18, "rate should have increased");
        log("Test 2 — new exchange rate: " + string(newRate / 1e14) + " (x1e14)");

        // Get more vault shares to swap
        Token(usdstAddress).approve(vaultAddress, 500e18);
        vault.deposit(500e18, address(this));

        // Swap same amount at higher rate — should get more tokenB
        ERC20(vaultAddress).approve(address(pool), 100e18);
        uint outAfter = pool.exchange(1, 0, 100e18, 1, address(0));
        log("Test 2 — rate increased, swap 100 saveUSDST→tokenB: " + string(outAfter / 1e14) + " (x1e14)");

        require(outAfter > outBefore, "output should increase after exchange rate growth");
    }

    // =====================================================================
    // Test 3: non-USDST underlying composes xRate with oracle price
    // =====================================================================

    function it_composes_exchange_rate_with_oracle_for_non_usdst_underlying() {
        address ethToken = m.tokenFactory().createToken(
            "ETH", "Ethereum", emptyArray, emptyArray, emptyArray, "ETH", 0, 18
        );
        Token(ethToken).setStatus(2);
        Token(ethToken).mint(address(this), 10000000e18);

        SaveUSDSTVault ethVault = new SaveUSDSTVault(address(this));
        ethVault.initialize(ethToken, "Yield ETH", "yETH");
        address ethVaultAddr = address(ethVault);

        // Deposit 1000 ETH, add 20 reward → rate = 1.02
        Token(ethToken).approve(ethVaultAddr, 1000e18);
        ethVault.deposit(1000e18, address(this));
        Token(ethToken).transfer(ethVaultAddr, 20e18);
        ethVault.recordRewardTransfer(20e18);
        require(ethVault.exchangeRate() == 102e16, "ETH vault rate should be 1.02e18");

        // Set ETH oracle price to 2000 USDST
        oracle.setAssetPrice(ethToken, 2000e18);

        // Create pool: tokenB + ethVault
        fastForward(100);
        StablePool ethPool = _createStablePool(tokenBAddress, ethVaultAddr);
        ethPool.setUsdst(usdstAddress);
        ethPool.setIsYieldToken(ethVaultAddr, true);
        ethPool.updateRateOracles(address(0), address(oracle));

        // ethVault rate = xRate * oracle(ETH) / 1e18 = 1.02e18 * 2000e18 / 1e18 = 2040e18
        // tokenB rate = 1e18
        // So 1 ethVault share ≈ 2040 tokenB

        Token(tokenBAddress).approve(address(ethPool), 200000e18);
        ERC20(ethVaultAddr).approve(address(ethPool), 100e18);
        uint lp = ethPool.addLiquidityGeneral([uint(200000e18), uint(100e18)], 1, address(0));
        require(lp > 0, "should mint LP tokens");

        // Swap 1 ethVault→tokenB
        ERC20(ethVaultAddr).approve(address(ethPool), 1e18);
        uint out = ethPool.exchange(1, 0, 1e18, 1, address(0));
        log("Test 3 — 1 yETH→tokenB (expect ~2040): " + string(out / 1e14) + " (x1e14)");

        require(out > 1500e18, "1 ethVault share should swap for significantly more than 1 tokenB");
        require(out < 2100e18, "output should be in reasonable range around 2040");
    }

    // =====================================================================
    // Test 4: USDST oracle price does NOT affect yield token with USDST underlying
    // =====================================================================

    function it_ignores_oracle_for_usdst_underlying_even_when_price_set() {
        // Set USDST oracle price to $2 (simulating depeg or misconfiguration)
        oracle.setAssetPrice(usdstAddress, 2e18);

        // Add reward → rate = 1.5
        Token(usdstAddress).transfer(vaultAddress, 50000e18);
        vault.recordRewardTransfer(50000e18);
        require(vault.exchangeRate() == 15e17, "exchange rate should be 1.5e18");

        // Since underlying==USDST, oracle is bypassed. Rate = xRate = 1.5e18.
        // If oracle were applied: rate = 1.5 * 2 = 3.0 (wrong)

        Token(tokenBAddress).approve(address(pool), 1500e18);
        ERC20(vaultAddress).approve(address(pool), 1000e18);
        pool.addLiquidityGeneral([uint(1500e18), uint(1000e18)], 1, address(0));

        // Swap 100 saveUSDST → tokenB
        ERC20(vaultAddress).approve(address(pool), 100e18);
        uint out = pool.exchange(1, 0, 100e18, 1, address(0));
        log("Test 4 — usdst oracle=$2, xRate=1.5, swap 100 saveUSDST→tokenB: " + string(out / 1e14) + " (x1e14)");

        // With correct bypass: ~150 tokenB (1.5x)
        // With incorrect oracle apply: ~300 tokenB (3.0x)
        require(out > 120e18, "output should reflect ~1.5x rate");
        require(out < 200e18, "output should NOT reflect oracle-doubled 3x rate");
    }
}
