import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_LendingPool_Basic is Authorizable {

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
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
    }

    /**
     * @notice Define an inclusive range for a property test parameter
     * @param value the value to define the range for
     * @param min the minimum value of the range
     * @param max the maximum value of the range
     * @return the value clamped to within the range
     */
    function defineRange(uint value, uint min, uint max) public pure returns (uint) {
        return value % (max - min + 1) + min;
    }

    /**
     * @notice Ceiling division of a by b
     * @param a the numerator
     * @param b the denominator
     * @return the result of the ceiling division
     */
    function ceilDiv(uint a, uint b) public pure returns (uint) {
        return (a + b - 1) / b;
    }

    function require_equal(uint observed, uint expected, string memory message) public {
        require(observed == expected, message + " Got: " + string(observed) + ", expected: " + string(expected));
    }

    function it_lending_aa_can_deploy_Mercata() public {
        require(address(m) != address(0), "address is 0");
    }

    function it_lending_ab_checks_that_contracts_are_set() public {
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
    function it_lending_ac_can_create_and_activate_tokens() public {
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
    function it_lending_ad_can_activate_tokens() public {
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

    function it_lending_ae_can_whitelist_tokens() public {
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.liquidityPool()));
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.liquidityPool()));

        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.safetyModule()));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.safetyModule()));
    }

    // Test complete lending pool configuration with full setup
    function it_lending_af_can_configure_lending_pool() public {
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

    function it_lending_ag_persists_accross_tests() public {
        LendingPool pool = m.lendingPool();
        require(pool.configuredAssets(0) != address(0), "No persistent configured assets");
    }

    // Verify exchange rate calculation works
    function it_lending_ah_can_verify_initial_exchange_rate() public {
        LendingPool pool = m.lendingPool();
        uint exchangeRate = pool.getExchangeRate();
        require(exchangeRate == 1e18, "Exchange rate not 1:1");
    }

    function it_lending_ai_can_set_oracle_prices() public {
        PriceOracle oracle = m.priceOracle();
        
        oracle.setAssetPrice(USDST, 1e18);      // $1 USD
        oracle.setAssetPrice(GOLDST, 2000e18);  // $2000 Gold
        oracle.setAssetPrice(SILVST, 25e18);  // $25 Silver
        
        // Verify oracle prices  
        require(oracle.getAssetPrice(USDST) == 1e18, "USD price not set correctly");
        require(oracle.getAssetPrice(GOLDST) == 2000e18, "Gold price not set correctly");
        require(oracle.getAssetPrice(SILVST) == 25e18, "Silver price not set correctly");
    }

    function it_lending_aj_can_display_logs() public {
        log("Hello, world! We're at " + string(address(m)));
    }

    // Test token minting and burn operations
    function it_lending_ak_can_mint_and_burn_tokens() public {
        // Test minting - simplified
        Token(USDST).mint(address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 1000e18, "Should have 1000 USDST after mint");
        Token(USDST).burn(address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 0, "Should have 0 USDST after burn");
    }

    function it_lending_al_can_simulate_users() public {
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

    function it_lending_am_can_configure_safety_module() public {
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

    function it_lending_an_can_accept_liquidity_deposits() public {
        LendingPool pool = m.lendingPool();

        Token(USDST).mint(address(this), 1000000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 1000000e18, "USDST balance should be 1000000e18 after mint");

        require(pool.getExchangeRate() == 1e18, "Exchange rate should be 1e18 initially");

        IERC20(USDST).approve(address(m.liquidityPool()), 1000000e18);
        pool.depositLiquidity(1000000e18);
        require(IERC20(USDST).balanceOf(address(this)) == 0, "USDST balance should be 0 after deposit");
        require(IERC20(mUSDST).balanceOf(address(this)) == 1000000e18, "mUSDST balance should be 1000000e18 after 1:1 deposit");
    }

    function it_lending_ao_can_accept_safety_module_deposits() public {
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

    function it_lending_ap_can_accept_collateral_vault_deposits() public {
        CollateralVault cv = m.collateralVault();
        LendingPool pool = m.lendingPool();

        Token(GOLDST).mint(address(user1), 1e18);
        require(IERC20(GOLDST).balanceOf(address(user1)) == 1e18, "GOLDST balance should be 1e18 after mint");
        
        user1.do(GOLDST, "approve", address(cv), 1e18);
        user1.do(address(pool), "supplyCollateral", GOLDST, 1e18);

        require(cv.userCollaterals(address(user1), GOLDST) == 1e18, "GOLDST balance should be 1e18 after supply collateral");
    }

    function it_lending_aq_can_accept_borrows() public {
        LendingPool pool = m.lendingPool();

        uint priorDebt = pool.getUserDebt(address(user1)); // used for invariant; should be 0 unless this test is reordered

        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);

        uint amount = price * ltv / 10000; amount = amount * 1/2; // 750 * 1e18 wei
        
        user1.do(address(pool), "borrow", amount);

        require(pool.getUserDebt(address(user1)) == 750*1e18 + priorDebt, "User1 should have " + string(amount) + " additional debt after borrow");
    }

    /// @param x fraction on 1e18 scale (1e18 = 100%) of ltv to borrow, cropped to range [1, 1e18]
    function property_lending_accepts_borrows(uint x) public {
        x = defineRange(x, 1, 1e18); // define acceptable range [1, 1e18]

        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();

        Token(GOLDST).mint(address(user1), 1e18);
        require(IERC20(GOLDST).balanceOf(address(user1)) == 1e18, "GOLDST balance should be 1e18 after mint");
        
        user1.do(GOLDST, "approve", address(cv), 1e18);
        user1.do(address(pool), "supplyCollateral", GOLDST, 1e18);

        uint priorDebt = pool.getUserDebt(address(user1)); // used for invariant; should be 0 unless this test is reordered

        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);

        uint amount = x * price * ltv / (10000 * 1e18); // 1500 * 1e18 wei
        
        user1.do(address(pool), "borrow", amount);

        require(pool.getUserDebt(address(user1)) == amount + priorDebt, "User1 should have " + string(amount) + " additional debt after borrow");
    }

    function ar_can_borrow_max() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();

        Token(GOLDST).mint(address(user2), 1e18);
        require(IERC20(GOLDST).balanceOf(address(user2)) == 1e18, "GOLDST balance should be 1e18 after mint");

        user2.do(GOLDST, "approve", address(cv), 1e18);
        user2.do(address(pool), "supplyCollateral", GOLDST, 1e18);
        
        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);

        uint expectedAmount = price * ltv / (1e18 * 10000);
        
        user2.do(address(pool), "borrowMax");

        require(
            pool.getUserDebt(address(user2)) == expectedAmount,
            "User2 should have "
                + string(expectedAmount)
                + " debt after borrowMax, not "
                + string(pool.getUserDebt(address(user2)))
        );
    }

    function it_lending_ba_can_tank_gold_price() public {
        PriceOracle oracle = m.priceOracle();
        LendingPool pool = m.lendingPool();

        // Ensure user1 is at max debt (1.07 HF) for this test
        user1.do(address(pool), "borrowMax");

        uint price = oracle.getAssetPrice(GOLDST);

        uint newPrice = price / 2;

        oracle.setAssetPrice(GOLDST, newPrice);

        require(oracle.getAssetPrice(GOLDST) == newPrice, "GOLDST price should be 1000e18 after set price");

        uint healthFactor = pool.getHealthFactor(address(user1));

        require(healthFactor < 1e18, "Health factor should be less than 1e18 after set price");
    }

    function it_lending_bb_can_liquidate_borrower() public {
        LendingPool pool = m.lendingPool();

        uint prior_balance = IERC20(USDST).balanceOf(address(this)); // to help with cleanup

        // Liquidation requires USDST balance
        uint amount_needed = m.lendingPool().getUserDebt(address(user1));
        Token(USDST).mint(address(this), amount_needed);
        IERC20(USDST).approve(address(m.liquidityPool()), amount_needed);

        // Perform Liquidation
        pool.liquidationCallAll(GOLDST, address(user1));
        require(
            pool.getHealthFactor(address(user1)) == 2**256-1,
            "Health factor should be inf after liquidation, not " + string(pool.getHealthFactor(address(user1)))
        );

        require(pool.badDebt() != 0, "Bad debt should be nonzero after *bad debt* liquidation");

        LoanInfo memory loan = pool.getUserLoan(address(user1));
        require(loan.scaledDebt == 0, "User loan should be zero after bad debt liquidation");
        require(loan.lastUpdated == 0, "User loan last updated should be zero after bad debt liquidation");

        // Cleanup; note that LiquidityPool approval is not cleaned
        Token(USDST).burn(address(this), IERC20(USDST).balanceOf(address(this)) - prior_balance);
    }

    function it_lending_bs_can_borrow_max_after_borrow() public {
        CollateralVault cv = m.collateralVault();
        LendingPool pool = m.lendingPool();

        User user = new User();

        Token(GOLDST).mint(address(user), 1e18);

        user.do(GOLDST, "approve", address(cv), 1e18);
        user.do(address(pool), "supplyCollateral", GOLDST, 1e18);

        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);
        uint maxAmount = price * ltv / 10000;

        // Borrow 10%
        user.do(address(pool), "borrow", maxAmount * 1000/10000);
        require_equal(IERC20(USDST).balanceOf(address(user)), maxAmount * 1000/10000, "Wrong USDST balance after borrow.");
        require_equal(pool.getUserDebt(address(user)), maxAmount * 1000/10000, "Wrong user debt after borrow.");

        // Borrow rest
        user.do(address(pool), "borrowMax");
        require_equal(pool.getUserDebt(address(user)), IERC20(USDST).balanceOf(address(user)), "User debt doesn't equal USDST balance after borrowMax.");
    }

    function it_lending_bt_can_accept_repays() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();

        // Borrow
        Token(GOLDST).mint(address(user), 1e18);
        user.do(GOLDST, "approve", address(cv), 1e18);
        user.do(address(pool), "supplyCollateral", address(GOLDST), 1e18);
        user.do(address(pool), "borrowMax");

        uint priorDebt = pool.getUserDebt(address(user));

        // Repay
        uint repayAmount = 100e18;
        user.do(USDST, "approve", address(lp), repayAmount);
        user.do(address(pool), "repay", repayAmount);

        require(pool.getUserDebt(address(user)) == priorDebt - repayAmount, "Repayment unsuccessful");
    }

    function it_lending_bu_can_accept_repay_all() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();

        // Borrow
        Token(GOLDST).mint(address(user), 1e18);
        user.do(GOLDST, "approve", address(cv), 1e18);
        user.do(address(pool), "supplyCollateral", address(GOLDST), 1e18);
        user.do(address(pool), "borrowMax");

        // Repay all
        user.do(USDST, "approve", address(lp), INFINITY); // Yes, we actually do this in the mercata backend
        user.do(address(pool), "repayAll");

        // Assert no dust left on the loan balance
        require(pool.getUserDebt(address(user)) == 0, "Repayment unsuccessful");
    }

    function it_lending_bv_can_accept_repay_all_after_repay() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();

        // Borrow
        Token(GOLDST).mint(address(user), 1e18);
        user.do(GOLDST, "approve", address(cv), 1e18);
        user.do(address(pool), "supplyCollateral", address(GOLDST), 1e18);
        user.do(address(pool), "borrowMax");

        uint priorDebt = pool.getUserDebt(address(user));

        // Repay
        uint repayAmount = 100e18;
        user.do(USDST, "approve", address(lp), repayAmount);
        user.do(address(pool), "repay", repayAmount);

        require(pool.getUserDebt(address(user)) == priorDebt - repayAmount, "Repayment unsuccessful");

        // Repay all
        user.do(USDST, "approve", address(lp), INFINITY); // Yes, we actually do this in the mercata backend
        user.do(address(pool), "repayAll");

        // Assert no dust left on the loan balance
        require(pool.getUserDebt(address(user)) == 0, "Repay all unsuccessful");
    }

    /// @param usdstBalance amount of USDST to deposit; range [1, INFINITY]
    function property_lending_bw_can_deposit_lending_liquidity_max(uint usdstBalance) public {
        usdstBalance = defineRange(usdstBalance, 1, INFINITY);

        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();
        Token(USDST).mint(address(user), usdstBalance);
        uint depositAmount = usdstBalance; // No special function to call for max deposit
        uint expectedMUSDST = usdstBalance * 1e18 / pool.getExchangeRate();

        // Deposit
        user.do(USDST, "approve", address(lp), INFINITY);
        user.do(address(pool), "depositLiquidity", depositAmount);

        require(IERC20(mUSDST).balanceOf(address(user)) == expectedMUSDST, "Deposit unsuccessful");
    }

    User user3;
    function it_lending_bx_can_withdraw_liquidity_partial() public {
        LendingPool pool = m.lendingPool();
        LiquidityPool lp = m.liquidityPool();

        user3 = new User();
        uint usdstBalance = 1000e18;
        Token(USDST).mint(address(user3), usdstBalance);
        user3.do(USDST, "approve", address(lp), usdstBalance);
        user3.do(address(pool), "depositLiquidity", usdstBalance);

        uint withdrawalAmount = IERC20(mUSDST).balanceOf(address(user3)) * pool.getExchangeRate() / 1e18 * 1000/10000; // 10% of the dollar value

        // Expected mUSDST balance after withdrawal
        uint expectedMUSDST = IERC20(mUSDST).balanceOf(address(user3)) - ceilDiv(withdrawalAmount * 1e18, pool.getExchangeRate());

        user3.do(address(pool), "withdrawLiquidity", withdrawalAmount);

        require_equal(IERC20(USDST).balanceOf(address(user3)), withdrawalAmount, "Wrong USDST balance after withdrawal.");
        require_equal(IERC20(mUSDST).balanceOf(address(user3)), expectedMUSDST, "Wrong mUSDST balance after withdrawal");
    }

    function it_lending_by_can_withdraw_liquidity_max_after_partial() public {
        LendingPool pool = m.lendingPool();
        LiquidityPool lp = m.liquidityPool();

        user3.do(USDST, "approve", address(lp), INFINITY); // Yes, we actually do this in the mercata backend
        user3.do(address(pool), "withdrawLiquidityAll");

        // Assert no dust mUSDST left
        require(IERC20(mUSDST).balanceOf(address(user3)) == 0, "Withdrawal unsuccessful");
    }

    function property_lending_bz_can_withdraw_liquidity_max(uint depositAmount) public {
        depositAmount = defineRange(depositAmount, 1, INFINITY);
        
        LendingPool pool = m.lendingPool();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();
        Token(USDST).mint(address(user), depositAmount);
        user.do(USDST, "approve", address(lp), depositAmount);
        user.do(address(pool), "depositLiquidity", depositAmount);

        user.do(USDST, "approve", address(lp), INFINITY); // Yes, we actually do this in the mercata backend
        user.do(address(pool), "withdrawLiquidityAll");

        // Assert no dust mUSDST left
        require(IERC20(mUSDST).balanceOf(address(user)) == 0, "Withdrawal unsuccessful");
    }

    function it_lending_cz_gives_correct_health_factors() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        User user = new User();
        uint collateralAmount = 1e18;
        Token(SILVST).mint(address(user), collateralAmount);

        // No Loan takes precedence over no collateral
        require(pool.getHealthFactor(address(user)) == INFINITY, "Health factor should be 0 before supply collateral");

        user.do(SILVST, "approve", address(cv), collateralAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), collateralAmount);
        require(pool.getHealthFactor(address(user)) == INFINITY, "Health factor should be inf before borrowMax");

        user.do(address(pool), "borrowMax");
        (uint ltv, uint liquidationThreshold, uint liquidationBonus, uint _, uint reserveFactor, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        require_equal(pool.getHealthFactor(address(user)), liquidationThreshold * 1e18 / ltv, "Health factor incorrect after borrowMax.");

        uint repayAmount = 1e18;
        user.do(USDST, "approve", address(lp), repayAmount);
        user.do(address(pool), "repay", repayAmount);
        require(pool.getHealthFactor(address(user)) > liquidationThreshold * 1e18 / ltv, "Health factor should be improved after repay");

        user.do(USDST, "approve", address(lp), INFINITY);
        user.do(address(pool), "repayAll");
        require(pool.getHealthFactor(address(user)) == INFINITY, "Health factor should be inf after repayAll");
    }

    /// @dev please implement following clock winding implementation for solid-vm-cli
    function imagine_it_lending_da_calculates_interest_correctly() public {
        // TODO probably multiple test cases, but we'll need to run the clock
        revert("Clock Winding for solid-vm-cli needed");
    }

    /// @dev please enable following clock winding implementation for solid-vm-cli
    function imagine_it_lending_ea_lets_admin_sweep_reserves_partially() public {
        revert("Clock Winding for solid-vm-cli needed");

        LendingPool pool = m.lendingPool();
        PoolConfigurator configurator = m.poolConfigurator();

        uint amount = 100e18;
        require(amount <= pool.reservesAccrued(), "Amount should be greater than reserves accrued");

        configurator.sweepReserves(amount);

        uint toSafety = amount * pool.safetyShareBps() / 10000;
        uint fees = amount - toSafety;

        require_equal(IERC20(USDST).balanceOf(address(m.feeCollector())), fees, "Wrong FeeCollector balance after sweep");
        require_equal(IERC20(USDST).balanceOf(address(m.safetyModule())), toSafety, "Wrong SafetyModule balance after sweep");
    }

    /// @dev please enable following clock winding implementation for solid-vm-cli
    function imagine_it_lending_eb_lets_admin_sweep_reserves_precisely() public {
        revert("Clock Winding for solid-vm-cli needed");

        LendingPool pool = m.lendingPool();
        PoolConfigurator configurator = m.poolConfigurator();

        uint amount = pool.reservesAccrued();
        configurator.sweepReserves(amount);

        uint toSafety = amount * pool.safetyShareBps() / 10000;
        uint fees = amount - toSafety;

        require_equal(IERC20(USDST).balanceOf(address(m.feeCollector())), fees, "Wrong FeeCollector balance after sweep");
        require_equal(IERC20(USDST).balanceOf(address(m.safetyModule())), toSafety, "Wrong SafetyModule balance after sweep");
    }

    /// @dev please enable following clock winding implementation for solid-vm-cli
    function imagine_it_lending_ec_lets_admin_sweep_reserves_insufficiently() public {
        revert("Clock Winding for solid-vm-cli needed");

        LendingPool pool = m.lendingPool();
        PoolConfigurator configurator = m.poolConfigurator();

        uint amount = pool.reservesAccrued() + 100e18;
        configurator.sweepReserves(amount);

        uint toSafety = pool.reservesAccrued() * pool.safetyShareBps() / 10000;
        uint fees = pool.reservesAccrued() - toSafety;

        require_equal(IERC20(USDST).balanceOf(address(m.feeCollector())), fees, "Wrong FeeCollector balance after sweep");
        require_equal(IERC20(USDST).balanceOf(address(m.safetyModule())), toSafety, "Wrong SafetyModule balance after sweep");
    }

    function property_lending_fa_handles_50_pct_liquidation(uint a_collatAmount, uint b_collatStartPrice) public {
        a_collatAmount = defineRange(a_collatAmount, 1e14, INFINITY);
        b_collatStartPrice = defineRange(b_collatStartPrice, 1e14, INFINITY);

        LendingPool pool = m.lendingPool();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        oracle.setAssetPrice(SILVST, b_collatStartPrice);

        User user = new User();
        Token(SILVST).mint(address(user), a_collatAmount);
        user.do(SILVST, "approve", address(cv), a_collatAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), a_collatAmount);
        user.do(address(pool), "borrowMax");

        (uint c_ltv, uint d_liquidationThreshold, uint liquidationBonus, uint _, uint foo, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        oracle.setAssetPrice(SILVST, b_collatStartPrice * c_ltv / d_liquidationThreshold * 99/100);

        require(pool.getHealthFactor(address(user)) < 1e18, "Health factor should be less than 1e18 before liquidation");

        // Liquidate
        Token(USDST).mint(address(this), pool.getUserDebt(address(user))); // more than enough to liquidate
        IERC20(USDST).approve(address(m.liquidityPool()), INFINITY);
        pool.liquidationCallAll(address(SILVST), address(user));

        require(cv.userCollaterals(address(user), address(SILVST)) < a_collatAmount, "Collateral " + string(cv.userCollaterals(address(user), address(SILVST))) + " should be less than the original amount " + string(a_collatAmount) + " after liquidation");

        require(pool.getHealthFactor(address(user)) >= 1e18, "Health factor should be at least 1e18 after liquidation");

        require_equal(pool.getUserDebt(address(user)), ceilDiv(IERC20(USDST).balanceOf(address(user)), 2), "User debt should be halved after 50% liquidation.");
    }

    function property_lending_fb_handles_100_pct_liquidation(uint a_collatAmount, uint b_collatStartPrice) public {
        a_collatAmount = defineRange(a_collatAmount, 1e14, INFINITY);
        b_collatStartPrice = defineRange(b_collatStartPrice, 1e14, INFINITY);

        LendingPool pool = m.lendingPool();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        oracle.setAssetPrice(SILVST, b_collatStartPrice);

        User user = new User();
        Token(SILVST).mint(address(user), a_collatAmount);
        user.do(SILVST, "approve", address(cv), a_collatAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), a_collatAmount);
        user.do(address(pool), "borrowMax");

        (uint c_ltv, uint d_liquidationThreshold, uint liquidationBonus, uint _, uint foo, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        oracle.setAssetPrice(SILVST, b_collatStartPrice * c_ltv / d_liquidationThreshold * 94/100);

        require(pool.getHealthFactor(address(user)) < 1e18, "Health factor should be less than 1e18 before liquidation");

        // Liquidate
        Token(USDST).mint(address(this), pool.getUserDebt(address(user)));
        IERC20(USDST).approve(address(m.liquidityPool()), INFINITY);
        pool.liquidationCallAll(address(SILVST), address(user));

        require(cv.userCollaterals(address(user), address(SILVST)) < a_collatAmount, "Collateral " + string(cv.userCollaterals(address(user), address(SILVST))) + " should be less than the original amount " + string(a_collatAmount) + " after liquidation");

        require(pool.getHealthFactor(address(user)) >= 1e18, "Health factor should be at least 1e18 after liquidation");

        // Assert no dust left on the loan balance
        require(pool.getUserDebt(address(user)) == 0, "User debt should be zero after 100% liquidation");
    }
    
    function it_lending_fc_prevents_self_liquidation() public {
        uint a_collatAmount = 20e18;
        uint b_collatStartPrice = 50e18;

        LendingPool pool = m.lendingPool();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        oracle.setAssetPrice(SILVST, b_collatStartPrice);

        User user = new User();
        Token(SILVST).mint(address(user), a_collatAmount);
        user.do(SILVST, "approve", address(cv), a_collatAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), a_collatAmount);
        user.do(address(pool), "borrowMax");

        (uint c_ltv, uint d_liquidationThreshold, uint liquidationBonus, uint _, uint foo, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        oracle.setAssetPrice(SILVST, b_collatStartPrice * c_ltv / d_liquidationThreshold * 94/100);

        require(pool.getHealthFactor(address(user)) < 1e18, "Health factor should be less than 1e18 before liquidation");

        // Liquidate
        Token(USDST).mint(address(user), pool.getUserDebt(address(user)));
        user.do(USDST, "approve", address(lp), INFINITY);
        try user.do(address(pool), "liquidationCallAll", address(SILVST), address(user)) {revert("Liquidation should fail");}
        catch {/* expected */}
    }
    
    function it_lending_fd_prevents_liquidation_of_healthy_positions() public {
        uint a_collatAmount = 20e18;
        uint b_collatStartPrice = 50e18;

        LendingPool pool = m.lendingPool();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        oracle.setAssetPrice(SILVST, b_collatStartPrice);

        User user = new User();
        Token(SILVST).mint(address(user), a_collatAmount);
        user.do(SILVST, "approve", address(cv), a_collatAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), a_collatAmount);
        user.do(address(pool), "borrowMax");

        (uint c_ltv, uint d_liquidationThreshold, uint liquidationBonus, uint _, uint foo, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        oracle.setAssetPrice(SILVST, b_collatStartPrice * c_ltv / d_liquidationThreshold * 101/100);

        require(pool.getHealthFactor(address(user)) > 1e18, "Health factor should be greater than 1e18 before liquidation attempt");
        require(pool.getHealthFactor(address(user)) < d_liquidationThreshold * 1e18 / c_ltv, "Health factor should be less than LT/LTV before liquidation attempt");

        // Liquidate
        Token(USDST).mint(address(this), pool.getUserDebt(address(user))); // more than enough to liquidate
        IERC20(USDST).approve(address(m.liquidityPool()), INFINITY);
        try pool.liquidationCallAll(address(SILVST), address(user)) {revert("Liquidation should fail");}
        catch {/* expected */}
    }
    
    function it_lending_ga_handles_multiple_collateral_cross_liquidation() public {
        LendingPool pool = m.lendingPool();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();

        uint goldAmount = 1e18;
        uint goldStartPrice = 2000e18;
        uint silverAmount = 30e18;
        uint silverPrice = 50e18;

        oracle.setAssetPrice(GOLDST, goldStartPrice);
        oracle.setAssetPrice(SILVST, silverPrice);

        User user = new User();
        Token(SILVST).mint(address(user), silverAmount);
        Token(GOLDST).mint(address(user), goldAmount);
        user.do(SILVST, "approve", address(cv), silverAmount);
        user.do(GOLDST, "approve", address(cv), goldAmount);
        user.do(address(pool), "supplyCollateral", address(SILVST), silverAmount);
        user.do(address(pool), "supplyCollateral", address(GOLDST), goldAmount);
        user.do(address(pool), "borrowMax");

        (uint c_ltv, uint d_liquidationThreshold, uint liquidationBonus, uint _, uint foo, uint perSecondFactorRAY) = pool.getAssetConfig(SILVST);
        oracle.setAssetPrice(address(GOLDST), 1000e18);

        uint healthFactorAfterDip = pool.getHealthFactor(address(user));
        require(healthFactorAfterDip < 1e18, "Health factor should be less than 1e18 before liquidation");

        // Liquidate
        Token(USDST).mint(address(this), pool.getUserDebt(address(user)));
        IERC20(USDST).approve(address(m.liquidityPool()), INFINITY);
        pool.liquidationCall(address(SILVST), address(user), 300e18); // not the asset who fell in price

        require(cv.userCollaterals(address(user), address(SILVST)) < silverAmount, "Silver collateral should be decreased");
        require(cv.userCollaterals(address(user), address(GOLDST)) == goldAmount, "Gold collateral should be unaffected");
    }

    function it_lending_ha_supports_individual_LR_setters_thru_configurator() public {
        PoolConfigurator configurator = m.poolConfigurator();
        LendingRegistry registry = m.lendingRegistry();

        address lendingPool = address(registry.lendingPool());
        address liquidityPool = address(registry.liquidityPool());
        address collateralVault = address(registry.collateralVault());
        address rateStrategy = address(registry.rateStrategy());
        address priceOracle = address(registry.priceOracle());

        configurator.setLendingPool(address(this));
        configurator.setLiquidityPool(address(this));
        configurator.setCollateralVault(address(this));
        configurator.setRateStrategy(address(this));
        configurator.setPriceOracle(address(this));

        require(address(registry.lendingPool()) == address(this), "Lending pool should be set");
        require(address(registry.liquidityPool()) == address(this), "Liquidity pool should be set");
        require(address(registry.collateralVault()) == address(this), "Collateral vault should be set");
        require(address(registry.rateStrategy()) == address(this), "Rate strategy should be set");
        require(address(registry.priceOracle()) == address(this), "Price oracle should be set");

        // reset to original values
        configurator.setLendingPool(lendingPool);
        configurator.setLiquidityPool(liquidityPool);
        configurator.setCollateralVault(collateralVault);
        configurator.setRateStrategy(rateStrategy);
        configurator.setPriceOracle(priceOracle);

        require(address(registry.lendingPool()) == lendingPool, "Lending pool should be reset");
        require(address(registry.liquidityPool()) == liquidityPool, "Liquidity pool should be reset");
        require(address(registry.collateralVault()) == collateralVault, "Collateral vault should be reset");
        require(address(registry.rateStrategy()) == rateStrategy, "Rate strategy should be reset");
        require(address(registry.priceOracle()) == priceOracle, "Price oracle should be reset");
    }

}
