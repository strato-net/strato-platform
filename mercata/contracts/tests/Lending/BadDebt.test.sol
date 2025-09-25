import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_BadDebt_Basic {

    struct LoanInfo {
        uint scaledDebt;     // user debt in index-scaled units
        uint lastUpdated;    // optional metadata
    }

    uint INFINITY = 2 ** 256 - 1;

    constructor() {
    }

    Mercata m;

    User user1;
    User user2;

    address USDST;

    address mUSDST;
    address sUSDST;

    address GOLDST;
    address SILVST;

    function beforeAll() public {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
    }

    function it_aa_can_deploy_Mercata() public {
        require(address(m) != address(0), "address is 0");
    }

    function it_ab_checks_that_contracts_are_set() public {
        require(address(m.priceOracle()) != address(0), "PriceOracle address is 0");
        require(address(m.collateralVault()) != address(0), "CollateralVault address is 0");
        require(address(m.liquidityPool()) != address(0), "LiquidityPool address is 0");
        require(address(m.lendingPool()) != address(0), "LendingPool address is 0");
        require(address(m.poolConfigurator()) != address(0), "PoolConfigurator address is 0");
        require(address(m.lendingRegistry()) != address(0), "LendingRegistry address is 0");
        require(address(m.tokenFactory()) != address(0), "TokenFactory address is 0");
        require(address(m.feeCollector()) != address(0), "FeeCollector address is 0");
        require(address(m.adminRegistry()) != address(0), "AdminRegistry address is 0");
        require(address(m.safetyModule()) != address(0), "SafetyModule address is 0");

        // via indirect reference
        require(address(m.collateralVault().registry()) != address(0), "CollateralVault registry not set");
        require(address(m.liquidityPool().registry()) != address(0), "LiquidityPool registry not set");
        require(address(m.collateralVault().registry().lendingPool()) != address(0), "CollateralVault's LendingPool address is 0");
        require(address(m.liquidityPool().registry().lendingPool()) != address(0), "LiquidityPool's LendingPool address is 0");
    }

    // Test basic token creation functionality
    function it_ac_can_create_and_activate_tokens() public {
        // Create test token for borrowing
        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(address(USDST) != address(0), "Failed to create USDST token");

        // Create test tokens for lending
        mUSDST = m.tokenFactory().createToken("mUSDST", "mUSDST Token", [], [], [], "mUSDST", 0, 18);
        sUSDST = m.tokenFactory().createToken("sUSDST", "sUSDST Token", [], [], [], "msSDST", 0, 18);
        require(address(mUSDST) != address(0), "Failed to create mUSDST token");
        require(address(sUSDST) != address(0), "Failed to create sUSDST token");
        
        // Create test tokens for collateral
        GOLDST = m.tokenFactory().createToken("GOLDST", "GOLDST Token", [], [], [], "GOLDST", 0, 18);
        SILVST= m.tokenFactory().createToken("SILVST", "SILVST Token", [], [], [], "SILVST", 0, 18);
        require(address(GOLDST) != address(0), "Failed to create GOLDST token");
        require(address(SILVST) != address(0), "Failed to create SILVST token");
    }

    // Test token activation functionality
    function it_ad_can_activate_tokens() public {
        // Set tokens to active status
        Token(USDST).setStatus(2);
        Token(mUSDST).setStatus(2);
        Token(sUSDST).setStatus(2);
        Token(GOLDST).setStatus(2);
        Token(SILVST).setStatus(2);
        
        // Basic checks - tokens activated successfully
        require(Token(USDST).status() == TokenStatus.ACTIVE, "USDST token not activated");
        require(Token(mUSDST).status() == TokenStatus.ACTIVE, "mUSDST token not activated");
        require(Token(sUSDST).status() == TokenStatus.ACTIVE, "sUSDST token not activated");
        require(Token(GOLDST).status() == TokenStatus.ACTIVE, "GOLDST token not activated");
        require(Token(SILVST).status() == TokenStatus.ACTIVE, "SILVST token not activated");
    }

    function it_ae_can_whitelist_tokens() public {
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.liquidityPool()));
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.liquidityPool()));

        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.safetyModule()));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.safetyModule()));
    }

    // Test complete lending pool configuration with full setup
    function it_af_can_configure_lending_pool() public {
        // Get the lending pool and configurator from Mercata infrastructure
        LendingPool pool = m.lendingPool();
        PoolConfigurator configurator = m.poolConfigurator();
        PriceOracle oracle = m.priceOracle();
        require(address(pool) != address(0), "LendingPool not found");
        require(address(configurator) != address(0), "PoolConfigurator not found");
        require(address(oracle) != address(0), "PriceOracle not found");
        
        // === STEP 1: Configure borrowable asset and mToken ===
        
        // Set the borrowable asset (USD) 
        configurator.setBorrowableAsset(USDST);
        require(pool.borrowableAsset() == USDST, "Borrowable asset not set correctly");
        
        // Set the corresponding mToken
        configurator.setMToken(mUSDST);
        require(pool.mToken() == mUSDST, "mToken not set correctly");
        
        // === STEP 2: Set debt ceilings and safety parameters ===
        
        uint debtCeilingAssetUnits = 10000000e18; // 10M USDST
        uint debtCeilingUSD = 10000000e18;        // 10M USD value 
        uint safetyShareBps = 1000;              // 10% to safety module
        
        configurator.setDebtCeilings(debtCeilingAssetUnits, debtCeilingUSD);
        configurator.setSafetyShareBps(safetyShareBps);
        
        // Verify debt ceiling configuration
        require(pool.debtCeilingAsset() == debtCeilingAssetUnits, "Asset debt ceiling not set");
        require(pool.debtCeilingUSD() == debtCeilingUSD, "USD debt ceiling not set");
        require(pool.safetyShareBps() == safetyShareBps, "Safety share not set");
        
        // === STEP 3: Configure USD borrowable asset parameters ===
        
        uint usdLtv = 0; // USDST can't be used as collateral for borrowing USDST
        uint usdLiquidationThreshold = 0;
        uint usdLiquidationBonus = 11000; // 110%
        uint usdInterestRate = 500;       // completely irrelevant, plucked from smd
        uint usdReserveFactor = 1000;     // 10%
        uint usdPerSecondFactorRAY = 1000000001547125956666413085; // plucked from smd
        
        configurator.configureAsset(
            USDST,
            usdLtv,
            usdLiquidationThreshold, 
            usdLiquidationBonus,
            usdInterestRate,
            usdReserveFactor,
            usdPerSecondFactorRAY
        );
        
        // === STEP 4: Configure collateral assets (Gold and Silver) ===
        
        // Gold configuration - high value collateral
        uint goldLtv = 7500;              // 75% LTV
        uint goldLiquidationThreshold = 8000; // 80% liquidation threshold
        uint goldLiquidationBonus = 10500;    // 5% liquidation bonus
        uint goldInterestRate = 0;        // No interest for collateral
        uint goldReserveFactor = 0;       // No reserves for collateral
        uint goldPerSecondFactorRAY = 1e27; // No compounding for collateral
        
        configurator.configureAsset(
            GOLDST,
            goldLtv,
            goldLiquidationThreshold,
            goldLiquidationBonus, 
            goldInterestRate,
            goldReserveFactor,
            goldPerSecondFactorRAY
        );
        
        // Silver configuration - medium value collateral
        uint silverLtv = 6000;            // 60% LTV (more conservative)
        uint silverLiquidationThreshold = 7000; // 70% liquidation threshold
        uint silverLiquidationBonus = 11000;    // 110% liquidation bonus
        uint silverInterestRate = 0;      // No interest for collateral
        uint silverReserveFactor = 0;     // No reserves for collateral  
        uint silverPerSecondFactorRAY = 1e27; // No compounding for collateral
        
        configurator.configureAsset(
            SILVST,
            silverLtv,
            silverLiquidationThreshold,
            silverLiquidationBonus,
            silverInterestRate, 
            silverReserveFactor,
            silverPerSecondFactorRAY
        );
        
        // === STEP 5: Verify complete asset configurations ===
        
        // Verify USD configuration
        (uint usdLtvRet, uint usdLiqThreshRet, uint usdLiqBonusRet, uint usdIntRateRet, uint usdReserveFactorRet, uint usdPerSecRet) = pool.getAssetConfig(USDST);
        require(usdLtvRet == usdLtv, "USD LTV not configured correctly");
        require(usdLiqThreshRet == usdLiquidationThreshold, "USD liquidation threshold not configured correctly");
        require(usdLiqBonusRet == usdLiquidationBonus, "USD liquidation bonus not configured correctly");
        require(usdIntRateRet == usdInterestRate, "USD interest rate not configured correctly");
        require(usdReserveFactorRet == usdReserveFactor, "USD reserve factor not configured correctly");
        require(usdPerSecRet == usdPerSecondFactorRAY, "USD per-second factor not configured correctly");
        
        // Verify Gold configuration
        (uint goldLtvRet, uint goldLiqThreshRet, uint goldLiqBonusRet, uint goldIntRateRet, uint goldReserveFactorRet, uint goldPerSecRet) = pool.getAssetConfig(GOLDST);
        require(goldLtvRet == goldLtv, "Gold LTV not configured correctly");
        require(goldLiqThreshRet == goldLiquidationThreshold, "Gold liquidation threshold not configured correctly");
        require(goldLiqBonusRet == goldLiquidationBonus, "Gold liquidation bonus not configured correctly");
        require(goldIntRateRet == goldInterestRate, "Gold interest rate not configured correctly");
        require(goldReserveFactorRet == goldReserveFactor, "Gold reserve factor not configured correctly");
        require(goldPerSecRet == goldPerSecondFactorRAY, "Gold per-second factor not configured correctly");
        
        // Verify Silver configuration
        (uint silverLtvRet, uint silverLiqThreshRet, uint silverLiqBonusRet, uint silverIntRateRet, uint silverReserveFactorRet, uint silverPerSecRet) = pool.getAssetConfig(SILVST);
        require(silverLtvRet == silverLtv, "Silver LTV not configured correctly");
        require(silverLiqThreshRet == silverLiquidationThreshold, "Silver liquidation threshold not configured correctly");
        require(silverLiqBonusRet == silverLiquidationBonus, "Silver liquidation bonus not configured correctly");
        require(silverIntRateRet == silverInterestRate, "Silver interest rate not configured correctly");
        require(silverReserveFactorRet == silverReserveFactor, "Silver reserve factor not configured correctly");
        require(silverPerSecRet == silverPerSecondFactorRAY, "Silver per-second factor not configured correctly");
        
        // === STEP 6: Verify registry and infrastructure connections ===
        
        require(address(pool.registry()) != address(0), "Pool registry not set");
        require(address(pool.tokenFactory()) != address(0), "Pool token factory not set");
        require(address(pool.poolConfigurator()) != address(0), "Pool configurator not set");
        require(address(pool.feeCollector()) != address(0), "Fee collector not set");
        
        // === STEP 7: Verify pool is ready for lending operations ===
        
        // Check that pool has borrowable asset configured
        require(pool.borrowableAsset() != address(0), "No borrowable asset configured");
        require(pool.mToken() != address(0), "No mToken configured");
        
        // Verify that assets are properly configured in the pool
        require(pool.configuredAssets(0) == USDST, "USDST not correctly configured in configured assets");
        require(pool.configuredAssets(1) == GOLDST, "GOLDST not correctly configured in configured assets");
        require(pool.configuredAssets(2) == SILVST, "SILVST not correctly configured in configured assets");
        
        // Verify bad debt tracking is initialized
        uint badDebt = pool.badDebt();
        require(badDebt == 0, "Initial bad debt should be zero");
        
        // === STEP 8: Test that configuration parameters are within valid bounds ===
        
        // Verify LTV <= liquidation threshold for collateral assets
        require(goldLtv <= goldLiquidationThreshold, "Gold LTV exceeds liquidation threshold");
        require(silverLtv <= silverLiquidationThreshold, "Silver LTV exceeds liquidation threshold");
    }

    function it_ag_persists_accross_tests() public {
        LendingPool pool = m.lendingPool();
        require(pool.configuredAssets(0) != address(0), "No persistent configured assets");
    }

    // Verify exchange rate calculation works
    function it_ah_can_verify_exchange_rate_calculation() public {   //TODO letters
        LendingPool pool = m.lendingPool();
        uint exchangeRate = pool.getExchangeRate();
        require(exchangeRate > 0, "Exchange rate not calculable");
    }

    function it_ai_can_set_oracle_prices() public {
        PriceOracle oracle = m.priceOracle();
        
        oracle.setAssetPrice(USDST, 1e18);      // $1 USD
        oracle.setAssetPrice(GOLDST, 2000e18);  // $2000 Gold
        oracle.setAssetPrice(SILVST, 25e18);  // $25 Silver
        
        // Verify oracle prices  
        require(oracle.getAssetPrice(USDST) == 1e18, "USD price not set correctly");
        require(oracle.getAssetPrice(GOLDST) == 2000e18, "Gold price not set correctly");
        require(oracle.getAssetPrice(SILVST) == 25e18, "Silver price not set correctly");
    }

    function it_aj_can_display_logs() public {
        log("Hello, world! We're at " + string(address(m)));
    }

    // Test token minting and burn operations
    function it_ak_can_mint_and_burn_tokens() public {
        // Test minting - simplified
        Token(USDST).mint(address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 1000e18, "Should have 1000 USDST after mint");
        Token(USDST).burn(address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 0, "Should have 0 USDST after burn");
    }

    function it_al_can_simulate_users() public {
        user1 = new User();
        user2 = new User();

        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).transfer(address(user1), 1000e18);
        require(IERC20(USDST).balanceOf(address(user1)) == 1000e18, "User1 should have 1000 USDST after receipt");
        user1.do(USDST, "transfer", address(user2), 1000e18);
        require(IERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST after transfer out");
        require(IERC20(USDST).balanceOf(address(user2)) == 1000e18, "User2 should have 1000 USDST after receipt");
        user2.do(USDST, "transfer", address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(user2)) == 0, "User2 should have 0 USDST after transfer out");
        require(IERC20(USDST).balanceOf(address(this)) == 1000e18, "Admin should have 1000 USDST after receipt");
        Token(USDST).burn(address(this), 1000e18);
    }

    function it_am_can_configure_safety_module() public {
        SafetyModule sm = m.safetyModule();

        uint cooldown = 1;
        uint window = 432000;
        uint maxSlashBps = 3000;
        sm.setParams(cooldown, window, maxSlashBps);

        require(sm.COOLDOWN_SECONDS() == cooldown, "Cooldown seconds not set correctly");
        require(sm.UNSTAKE_WINDOW() == window, "Unstake window not set correctly");
        require(sm.MAX_SLASH_BPS() == maxSlashBps, "Max slash BPS not set correctly");

        sm.syncFromRegistry(); // important, took some debugging to determine where in the process to do this
        sm.setTokens(sUSDST, USDST);

        require(sm.asset() == USDST, "Asset not set correctly");
        require(sm.sToken() == sUSDST, "sToken not set correctly");

        require(address(sm.lendingPool()) == address(m.lendingPool()), "Lending pool not set correctly");
        require(address(sm.lendingRegistry()) == address(m.lendingRegistry()), "Lending registry not set correctly");
        require(address(sm.tokenFactory()) == address(m.tokenFactory()), "Token factory not set correctly");
    }

    function it_an_can_accept_liquidity_deposits() public {
        LendingPool pool = m.lendingPool();

        Token(USDST).mint(address(this), 1000000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 1000000e18, "USDST balance should be 1000000e18 after mint");

        require(pool.getExchangeRate() == 1e18, "Exchange rate should be 1e18 initially");

        IERC20(USDST).approve(address(m.liquidityPool()), 1000000e18);
        pool.depositLiquidity(1000000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 0, "USDST balance should be 0 after deposit");
        require(IERC20(mUSDST).balanceOf(address(this)) == 1000000e18, "mUSDST balance should be 1000000e18 after 1:1 deposit");
    }

    function it_ao_can_accept_safety_module_deposits() public {
        SafetyModule sm = m.safetyModule();

        uint amount = 2000e18; // chosen to be big enough to cover the bad debt for the can_cover_bad_debt test

        // Mint USDST
        Token(USDST).mint(address(this), amount);
        require(IERC20(USDST).balanceOf(address(this)) == amount, "USDST balance should be 1000e18 after mint");
        
        // Stake USDST in SafetyModule
        IERC20(USDST).approve(address(sm), amount);
        sm.stake(amount, 0);
        require(IERC20(USDST).balanceOf(address(this)) == 0, "USDST balance should be 0 after stake");
        require(IERC20(sUSDST).balanceOf(address(this)) == amount, "sUSDST balance should be 1000e18 after stake");
    }

    function it_ap_can_accept_collateral_vault_deposits() public {
        CollateralVault cv = m.collateralVault();
        LendingPool pool = m.lendingPool();

        Token(GOLDST).mint(address(user1), 1e18);
        require(IERC20(GOLDST).balanceOf(address(user1)) == 1e18, "GOLDST balance should be 1e18 after mint");
        
        user1.do(GOLDST, "approve", address(cv), 1e18);
        user1.do(address(pool), "supplyCollateral", GOLDST, 1e18);

        require(cv.userCollaterals(address(user1), GOLDST) == 1e18, "GOLDST balance should be 1e18 after supply collateral");
    }

    function it_aq_can_accept_borrows() public {
        LendingPool pool = m.lendingPool();

        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);

        uint amount = price * ltv / (1e18 * 10000); // 1500
        
        user1.do(address(pool), "borrow", amount * 1e18);
    }

    function it_ar_can_tank_gold_price() public {
        PriceOracle oracle = m.priceOracle();
        LendingPool pool = m.lendingPool();

        uint price = oracle.getAssetPrice(GOLDST);

        uint newPrice = price / 2;

        oracle.setAssetPrice(GOLDST, newPrice);

        require(oracle.getAssetPrice(GOLDST) == newPrice, "GOLDST price should be 1000e18 after set price");

        uint healthFactor = pool.getHealthFactor(address(user1));
        log("healthFactor: "+string(healthFactor));
        log("            / "+string(1e18));

        require(healthFactor < 1e18, "Health factor should be less than 1e18 after set price");
    }

    function it_as_can_liquidate_borrower() public {
        LendingPool pool = m.lendingPool();

        uint prior_balance = IERC20(USDST).balanceOf(address(this)); // to help with cleanup

        // Liquidation requires USDST balance
        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).approve(address(m.liquidityPool()), 1000e18);

        // Perform Liquidation
        pool.liquidationCallAll(GOLDST, address(user1));
        require(
            pool.getHealthFactor(address(user1)) == INFINITY,
            "Health factor should be inf after liquidation, not " + string(pool.getHealthFactor(address(user1)))
        );

        require(pool.badDebt() != 0, "Bad debt should be nonzero after *bad debt* liquidation");
        log("as badDebt: "+string(pool.badDebt()));

        LoanInfo memory loan = pool.getUserLoan(address(user1));
        require(loan.scaledDebt == 0, "User loan should be zero after bad debt liquidation");
        require(loan.lastUpdated == 0, "User loan last updated should be zero after bad debt liquidation");

        // Cleanup; note that LiquidityPool approval is not cleaned
        Token(USDST).burn(address(this), IERC20(USDST).balanceOf(address(this)) - prior_balance);
    }

    function it_at_can_cover_bad_debt() public {
        SafetyModule sm = m.safetyModule();
        LendingPool pool = m.lendingPool();

        log("at exchangeRate before: "+string(pool.getExchangeRate()));

        uint smAssets = sm.totalAssets();
        uint toCover = smAssets * sm.MAX_SLASH_BPS() / 10000;
        require(
            pool.badDebt() < toCover,
            "Bad debt should be less than 1 cover from USDST balance of SM" // (for this test case)
        );
        log("at toCover: "+string(toCover));
        sm.coverShortfall(toCover);
        require(pool.badDebt() == 0, "Bad debt should be 0 after cover shortfall");

        log("at exchangeRate after: "+string(pool.getExchangeRate()));
        
        // Note: These initial values for comparison should be taken separetly if you reorder the tests
        require(pool.getExchangeRate() == 1e18, "Lending Exchange rate should be unaffected 1e18 after cover shortfall");
        require(sm.exchangeRate() < 1e18, "SM Exchange rate should fall to less than 1e18 after cover shortfall");
    }

    function it_ba_can_write_off_bad_debt() public {
        SafetyModule sm = m.safetyModule();
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        PriceOracle oracle = m.priceOracle();
        PoolConfigurator configurator = m.poolConfigurator();

        uint initialGoldBalance = IERC20(GOLDST).balanceOf(address(this));

        User user = new User();
        Token(GOLDST).mint(address(user), 1e18);
        user.do(GOLDST, "approve", address(cv), 1e18);
        user.do(address(pool), "supplyCollateral", GOLDST, 1e18);
        user.do(address(pool), "borrowMax");

        uint amountBorrowed = pool.getUserDebt(address(user));

        // 90% fall in price of GOLDST
        oracle.setAssetPrice(GOLDST, oracle.getAssetPrice(GOLDST) * 10/100);

        require(pool.getHealthFactor(address(user)) < 1e18, "Health factor should be less than 1e18 after price fall");

        // Liquidate
        Token(USDST).mint(address(this), amountBorrowed); // enough to cover the debt
        IERC20(USDST).approve(address(m.liquidityPool()), INFINITY);
        pool.liquidationCallAll(GOLDST, address(user));

        require(pool.badDebt() > 0, "Bad debt should be > 0 after liquidation");

        configurator.writeOffBadDebtWithHaircut(pool.badDebt(), "Admin shouldn't actually do this before SM cover");
        require(pool.badDebt() == 0, "Bad debt should be 0 after write off bad debt with haircut");
    }

}
