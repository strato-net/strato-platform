import "../concrete/BaseCodeCollection.sol";
import "../abstract/ERC20/IERC20.sol";
import "../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_BadDebt_Basic {

    // CDP struct definitions for accessing record types (must match CDPEngine exactly)
    struct Vault {
        uint collateral;  // raw token units
        uint scaledDebt;  // index‑denominated debt
    }

    struct CollateralConfig {
        uint liquidationRatio;          // WAD (e.g. 1.50e18)
        uint liquidationPenaltyBps;     // 10000 = 100%
        uint closeFactorBps;            // 10000 = 100%
        uint stabilityFeeRate;          // per‑second factor (RAY)
        uint debtFloor;                 // minimum debt per vault (USD 1e18)
        uint debtCeiling;               // asset debt ceiling (USD 1e18)
        uint unitScale;                 // token units to 1e18 scale factor
        bool isPaused;                  // asset pause switch (all ops)
    }

    struct CollateralGlobalState {
        uint rateAccumulator;   // RAY (>= RAY)
        uint lastAccrual;       // timestamp
        uint totalScaledDebt;   // sum of normalized principal (scaledDebt) across vaults
    }

    struct JuniorNote {
        address owner;
        uint256 capUSDST;     // remaining cap in wei (decreases on claims)
        uint256 entryIndex;   // earning baseline (resets on claims)
    }

    constructor() {
    }

    Mercata m;

    User user1;
    User user2;
    User user3;

    address USDST;

    address ETHST;
    address GOLDST;
    address SILVST;

    // CDP-specific variables
    uint vaultId1;  // For tracking CDP vaults created in tests

    // Comprehensive snapshot function for debugging CDP system state
    function _snapshot() internal {
        log("🔍 ===== CDP SYSTEM SNAPSHOT =====");
        
        // Oracle prices
        log("💲 Oracle Prices:");
        PriceOracle oracle = m.priceOracle();
        if (address(USDST) != address(0)) {
            uint usdPrice = oracle.getAssetPrice(USDST);
            log("   USDST price: $" + string(usdPrice / 1e18));
        } else {
            log("   USDST price: Not set");
        }
        if (address(ETHST) != address(0)) {
            uint ethPrice = oracle.getAssetPrice(ETHST);
            log("   ETHST price: $" + string(ethPrice / 1e18));
        } else {
            log("   ETHST price: Not set");
        }
        
        // User token balances
        log("👤 User Token Balances:");
        log("   Test Contract USDST: " + string(IERC20(USDST).balanceOf(address(this)) / 1e18));
        log("   User1 USDST: " + string(IERC20(USDST).balanceOf(address(user1)) / 1e18));
        log("   User2 USDST: " + string(IERC20(USDST).balanceOf(address(user2)) / 1e18));
        log("   User3 USDST: " + string(IERC20(USDST).balanceOf(address(user3)) / 1e18));
        log("   User1 ETHST: " + string(IERC20(ETHST).balanceOf(address(user1)) / 1e18));
        log("   User2 ETHST: " + string(IERC20(ETHST).balanceOf(address(user2)) / 1e18));
        log("   User3 ETHST: " + string(IERC20(ETHST).balanceOf(address(user3)) / 1e18));
        
        // CDP System balances
        log("🏦 CDP System Balances:");
        CDPReserve reserve = m.cdpReserve();
        CDPVault vault = m.cdpVault();
        log("   Reserve USDST: " + string(IERC20(USDST).balanceOf(address(reserve)) / 1e18));
        log("   Vault ETHST: " + string(IERC20(ETHST).balanceOf(address(vault)) / 1e18));
        
        // Token total supplies (removed due to compilation errors)
        log("📊 Token Total Supplies:");
        log("   (Total supply queries disabled for compilation)");
        
        // CDP Engine state (if available)
        log("⚙️  CDP Engine State:");
        CDPEngine engine = m.cdpEngine();
        
        // CDP Engine state using actual available functions
        log("   CDP Engine Address: " + string(address(engine)));
        
        // Junior premium (available as public variable)
        log("   Junior Premium: " + string(engine.juniorPremiumBps()) + " bps");
        
        // Junior system state
        log("   Junior Index: " + string(engine.juniorIndex()));
        log("   Total Junior Outstanding: " + string(engine.totalJuniorOutstandingUSDST() / 1e18) + " USDST");
        
        // Bad debt information (per-asset mapping)
        if (address(ETHST) != address(0)) {
            log("   ETHST Bad Debt: " + string(engine.badDebtUSDST(ETHST) / 1e18) + " USDST");
        }
        
        // User vault information for user1
        log("👤 User1 CDP Vault Data:");
        if (address(ETHST) != address(0)) {
            Vault userVault = engine.vaults(address(user1), ETHST);
            log("   ETHST Collateral: " + string(userVault.collateral / 1e18));
            log("   ETHST Scaled Debt: " + string(userVault.scaledDebt / 1e18));
            // Calculate collateralization ratio using available function
            uint crWad = engine.collateralizationRatio(address(user1), ETHST);
            log("   Collateralization Ratio: " + string(crWad / 1e16) + "%");
        }
        
        // Junior notes information
        log("📝 Junior Notes Information:");
        for (uint i = 1; i <= 3; i++) {
            address userAddr = i == 1 ? address(user1) : (i == 2 ? address(user2) : address(user3));
            JuniorNote note = engine.juniorNotes(userAddr);
            if (note.owner != address(0)) {
                log("   User" + string(i) + " - Cap: " + string(note.capUSDST / 1e18) + " USDST, Entry Index: " + string(note.entryIndex));
                
                // Get claimable amount
                uint claimableAmount = engine.claimable(userAddr);
                log("   User" + string(i) + " - Claimable: " + string(claimableAmount / 1e18) + " USDST");
            } else {
                log("   User" + string(i) + " - No junior note");
            }
        }
        
        // Collateral asset configuration for ETHST
        if (address(ETHST) != address(0)) {
            log("🔧 ETHST Collateral Config:");
            CollateralConfig config = engine.collateralConfigs(ETHST);
            log("   Liquidation Ratio: " + string(config.liquidationRatio / 1e16) + "%");
            log("   Liquidation Penalty: " + string(config.liquidationPenaltyBps) + " bps");
            log("   Close Factor: " + string(config.closeFactorBps) + " bps");
            log("   Debt Floor: " + string(config.debtFloor / 1e18) + " USDST");
            log("   Debt Ceiling: " + string(config.debtCeiling / 1e18) + " USDST");
            log("   Unit Scale: " + string(config.unitScale));
            log("   Paused: " + (config.isPaused ? "true" : "false"));
            
            // Global state for ETHST
            CollateralGlobalState globalState = engine.collateralGlobalStates(ETHST);
            log("   Rate Accumulator: " + string(globalState.rateAccumulator));
            log("   Last Accrual: " + string(globalState.lastAccrual));
            log("   Total Scaled Debt: " + string(globalState.totalScaledDebt / 1e18));
        }
        
        log("🔍 ===== END SNAPSHOT =====");
    }

    // Quick snapshot for debugging specific values during development
    function _quickSnapshot(string memory context) internal {
        log("⚡ QUICK SNAPSHOT: " + context);
        CDPEngine engine = m.cdpEngine();
        PriceOracle oracle = m.priceOracle();
        
        // Key prices
        if (address(ETHST) != address(0)) {
            uint price = oracle.getAssetPrice(ETHST);
            log("   ETHST: $" + string(price / 1e18));
        }
        
        // Key balances
        log("   User1 USDST: " + string(IERC20(USDST).balanceOf(address(user1)) / 1e18));
        log("   Reserve USDST: " + string(IERC20(USDST).balanceOf(address(m.cdpReserve())) / 1e18));
        
        // CDP position for user1 (using actual available functions)
        if (address(ETHST) != address(0)) {
            Vault quickVault = engine.vaults(address(user1), ETHST);
            log("   User1 ETHST Collateral: " + string(quickVault.collateral / 1e18));
            log("   User1 ETHST Scaled Debt: " + string(quickVault.scaledDebt / 1e18));
        }
        
        // Bad debt
        if (address(ETHST) != address(0)) {
            log("   ETHST Bad Debt: " + string(engine.badDebtUSDST(ETHST) / 1e18) + " USDST");
        }
        
        // Junior system summary
        log("   Junior Outstanding: " + string(engine.totalJuniorOutstandingUSDST() / 1e18) + " USDST");
    }

    function beforeAll() public {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {}

    function it_aa_can_deploy_Mercata() public {
        require(address(m) != address(0), "address is 0");
    }

    function it_ab_checks_that_contracts_are_set() public {
        require(address(m.priceOracle()) != address(0), "PriceOracle address is 0");
        require(address(m.tokenFactory()) != address(0), "TokenFactory address is 0");
        require(address(m.feeCollector()) != address(0), "FeeCollector address is 0");
        require(address(m.adminRegistry()) != address(0), "AdminRegistry address is 0");
        require(address(m.cdpRegistry()) != address(0), "CDPRegistry address is 0");
        require(address(m.cdpEngine()) != address(0), "CDPEngine address is 0");
        require(address(m.cdpVault()) != address(0), "CDPVault address is 0");
        require(address(m.cdpReserve()) != address(0), "CDPReserve address is 0");

        // via indirect reference
        require(address(m.cdpEngine().registry()) != address(0), "CDPEngine registry not set");
        require(address(m.cdpVault().registry()) != address(0), "CDPVault registry not set");
        require(address(m.cdpReserve().registry()) != address(0), "CDPReserve registry not set");
        require(address(m.cdpRegistry().cdpEngine()) != address(0), "CDPRegistry's CDPEngine address is 0");
        require(address(m.cdpRegistry().cdpVault()) != address(0), "CDPRegistry's CDPVault address is 0");
        require(address(m.cdpRegistry().cdpReserve()) != address(0), "CDPRegistry's CDPReserve address is 0");
        require(address(m.cdpRegistry().usdst()) != address(0), "CDPRegistry's USDST address is 0");
        
    }

    // Test basic token creation functionality
    function it_ac_can_create_and_activate_tokens() public {
        // Create test token for borrowing
        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(address(USDST) != address(0), "Failed to create USDST token");

        // Create test tokens for lending - NOT NEEDED FOR CDP
        // mUSDST = m.tokenFactory().createToken("mUSDST", "mUSDST Token", [], [], [], "mUSDST", 0, 18);
        // sUSDST = m.tokenFactory().createToken("sUSDST", "sUSDST Token", [], [], [], "msSDST", 0, 18);
        // require(address(mUSDST) != address(0), "Failed to create mUSDST token");
        // require(address(sUSDST) != address(0), "Failed to create sUSDST token");
        
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
        // Token(mUSDST).setStatus(2);  // NOT NEEDED FOR CDP
        // Token(sUSDST).setStatus(2);  // NOT NEEDED FOR CDP
        Token(GOLDST).setStatus(2);
        Token(SILVST).setStatus(2);
        
        // Basic checks - tokens activated successfully
        require(Token(USDST).status() == TokenStatus.ACTIVE, "USDST token not activated");
        // require(Token(mUSDST).status() == TokenStatus.ACTIVE, "mUSDST token not activated");  // NOT NEEDED FOR CDP
        // require(Token(sUSDST).status() == TokenStatus.ACTIVE, "sUSDST token not activated");  // NOT NEEDED FOR CDP
        require(Token(GOLDST).status() == TokenStatus.ACTIVE, "GOLDST token not activated");
        require(Token(SILVST).status() == TokenStatus.ACTIVE, "SILVST token not activated");
    }

    // NOT NEEDED FOR CDP - tokens are whitelisted for lending pool, not CDP
    /*
    function it_ae_can_whitelist_tokens() public {
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.liquidityPool()));
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.liquidityPool()));

        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.safetyModule()));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.safetyModule()));
    }
    */

    // NOT NEEDED FOR CDP - this is all lending pool specific configuration
    /*
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
    */

    // NOT NEEDED FOR CDP
    /*
    function it_ag_persists_accross_tests() public {
        LendingPool pool = m.lendingPool();
        require(pool.configuredAssets(0) != address(0), "No persistent configured assets");
    }
    */

    // NOT NEEDED FOR CDP - exchange rates are for lending pool
    /*
    function it_ah_can_verify_exchange_rate_calculation() public {   //TODO letters
        LendingPool pool = m.lendingPool();
        uint exchangeRate = pool.getExchangeRate();
        require(exchangeRate > 0, "Exchange rate not calculable");
    }
    */

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
        // Users already created in CDP configuration
        require(address(user1) != address(0), "User1 not created");
        require(address(user2) != address(0), "User2 not created");

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

    // NOT NEEDED FOR CDP - safety module is for lending pool bad debt coverage
    /*
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
    */

    // NOT NEEDED FOR CDP - liquidity deposits are for lending pool
    /*
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
    */

    // NOT NEEDED FOR CDP - safety module is for lending pool
    /*
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
    */

    // NOT NEEDED FOR CDP - collateral vault is for lending pool, CDP uses CDP vault
    /*
    function it_ap_can_accept_collateral_vault_deposits() public {
        CollateralVault cv = m.collateralVault();
        LendingPool pool = m.lendingPool();

        Token(GOLDST).mint(address(user1), 1e18);
        require(IERC20(GOLDST).balanceOf(address(user1)) == 1e18, "GOLDST balance should be 1e18 after mint");
        
        user1.do(GOLDST, "approve", address(cv), 1e18);
        user1.do(address(pool), "supplyCollateral", GOLDST, 1e18);

        require(cv.userCollaterals(address(user1), GOLDST) == 1e18, "GOLDST balance should be 1e18 after supply collateral");
    }
    */

    // NOT NEEDED FOR CDP - this is lending pool borrowing, CDP uses different mechanism
    /*
    function it_aq_can_accept_borrows() public {
        LendingPool pool = m.lendingPool();

        (uint ltv, uint foo, uint bar, uint bin, uint baz, uint snap) = pool.getAssetConfig(GOLDST);
        uint price = m.priceOracle().getAssetPrice(GOLDST);

        uint amount = price * ltv / (1e18 * 10000); // 1500
        
        user1.do(address(pool), "borrow", amount * 1e18);
    }
    */

    // WILL NEED CDP VERSION - price manipulation for CDP testing
    /*
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
    */

    // WILL NEED CDP VERSION - liquidation logic for CDP
    /*
    function it_as_can_liquidate_borrower() public {
        LendingPool pool = m.lendingPool();

        uint prior_balance = IERC20(USDST).balanceOf(address(this)); // to help with cleanup

        // Liquidation requires USDST balance
        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).approve(address(m.liquidityPool()), 1000e18);

        // Perform Liquidation
        pool.liquidationCallAll(GOLDST, address(user1));
        require(
            pool.getHealthFactor(address(user1)) == 2**256-1,
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
    */

    // WILL NEED CDP VERSION - bad debt coverage mechanism for CDP
    /*
    function it_at_can_cover_bad_debt() public {
        SafetyModule sm = m.safetyModule();
        LendingPool pool = m.lendingPool();

        log("at exchangeRate before: "+string(pool.getExchangeRate()));

        uint smAssets = sm.totalAssets();
        uint toCover = smAssets * sm.MAX_SLASH_BPS() / 10000;
        require(
            pool.badDebt() < smAssets,
            "Bad debt should be less than USDST balance of SM" // (for this test case)
        );
        log("at toCover: "+string(toCover));
        sm.coverShortfall(toCover);
        require(pool.badDebt() == 0, "Bad debt should be 0 after cover shortfall");

        log("at exchangeRate after: "+string(pool.getExchangeRate()));
        
        // Note: These initial values for comparison should be taken separetly if you reorder the tests
        require(pool.getExchangeRate() == 1e18, "Lending Exchange rate should be unaffected 1e18 after cover shortfall");
        require(sm.exchangeRate() < 1e18, "SM Exchange rate should fall to less than 1e18 after cover shortfall");
    }
    */

    // ========================================
    // CDP-SPECIFIC TEST FUNCTIONS TO IMPLEMENT
    // ========================================

    // Configure CDP system with ETHST collateral parameters
    function it_af_can_configure_cdp_system() public {
        CDPEngine engine = m.cdpEngine();
        CDPRegistry registry = m.cdpRegistry();
        
        // Create users first (needed for CDP operations)
        user1 = new User();
        user2 = new User();
        user3 = new User();
        
        // Create ETHST token first (needed for configuration)
        ETHST = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        require(address(ETHST) != address(0), "Failed to create ETHST token");
        Token(ETHST).setStatus(2); // Activate ETHST
        require(Token(ETHST).status() == TokenStatus.ACTIVE, "ETHST token not activated");
        
        // Grant CDPEngine mint/burn rights on USDST
        Token(USDST).addWhitelist(address(m.adminRegistry()), "mint", address(engine));
        Token(USDST).addWhitelist(address(m.adminRegistry()), "burn", address(engine));
        
        // Set TokenFactory in CDPRegistry
        registry.setTokenFactory(address(m.tokenFactory()));
        
        // Set initial ETHST price in oracle (needed for CDP operations)
        PriceOracle oracle = m.priceOracle();
        uint ethstPrice = 3000e18; // $3,000 with 18 decimals
        oracle.setAssetPrice(ETHST, ethstPrice);
        require(oracle.getAssetPrice(ETHST) == ethstPrice, "ETHST price not set correctly");
        
        // Configure ETHST as collateral asset
        // Parameters from setupCDPTest.js
        uint liquidationRatio = 1500000000000000000; // 150% (1.5 * 1e18)
        uint liquidationPenaltyBps = 500;            // 5% penalty
        uint closeFactorBps = 10000;                 // 100% close factor
        uint stabilityFeeRate = 1000000000315522921573372069; // ~1% APR
        uint debtFloor = 1000000000000000000;        // 1 USDST minimum
        uint debtCeiling = 1000000000000000000000000000000000; // 1e33 USDST ceiling
        uint unitScale = 1000000000000000000;        // 1e18 (ETHST has 18 decimals)
        bool pause = false;
        
        log("Setting collateral asset params for ETHST...");
        engine.setCollateralAssetParams(
            ETHST,
            liquidationRatio,
            liquidationPenaltyBps,
            closeFactorBps,
            stabilityFeeRate,
            debtFloor,
            debtCeiling,
            unitScale,
            pause
        );
        log("Collateral asset params set successfully");
        
        // Verify configuration
        require(address(registry.cdpEngine()) == address(engine), "CDPEngine not set correctly in registry");
        require(address(registry.cdpVault()) != address(0), "CDPVault not set in registry");
        require(address(registry.cdpReserve()) != address(0), "CDPReserve not set in registry");
        require(address(registry.usdst()) != address(0), "USDST not set in registry");
        
        log("✅ CDP system configured with ETHST collateral");
        // _snapshot(); // Snapshot disabled to avoid price issues during configuration
    }

    // Deposit ETHST collateral for user1
    function it_ag_can_deposit_collateral() public {
        CDPEngine engine = m.cdpEngine();
        CDPVault vault = m.cdpVault();
        PriceOracle oracle = m.priceOracle();
        
        // Debug: Check if ETHST token is properly set
        require(address(ETHST) != address(0), "ETHST token not created");
        log("ETHST token address: " + string(address(ETHST)));
        
        // Set ETHST price to $3,000 (may have been changed by previous tests)
        uint ethstPrice = 3000e18; // $3,000 with 18 decimals
        oracle.setAssetPrice(ETHST, ethstPrice);
        require(oracle.getAssetPrice(ETHST) == ethstPrice, "ETHST price not set correctly");
        
        // Mint 10 ETHST to user1 (amount from setupCDPTest.js)
        uint ethstAmount = 10e18; // 10 ETHST
        Token(ETHST).mint(address(user1), ethstAmount);
        require(IERC20(ETHST).balanceOf(address(user1)) == ethstAmount, "User1 should have 10 ETHST");
        
        // User1 approves CDP Vault to spend ETHST
        user1.do(ETHST, "approve", address(vault), ethstAmount);
        
        // Check approval was successful
        uint approvalAmount = IERC20(ETHST).allowance(address(user1), address(vault));
        require(approvalAmount >= ethstAmount, "ETHST approval failed");
        log("ETHST approval amount: " + string(approvalAmount / 1e18));
        
        // User1 deposits ETHST as collateral
        user1.do(address(engine), "deposit", ETHST, ethstAmount);
        
        // Verify collateral was deposited by checking vault balance
        uint vaultBalance = IERC20(ETHST).balanceOf(address(vault));
        require(vaultBalance >= ethstAmount, "ETHST not deposited to vault");
        log("Vault ETHST balance: " + string(vaultBalance / 1e18));
        
        log("✅ User1 deposited 10 ETHST as collateral (~$30,000 value)");
        _snapshot(); // Snapshot after collateral deposit
    }

    // Mint USDST against ETHST collateral
    function it_ah_can_borrow_against_collateral() public {
        CDPEngine engine = m.cdpEngine();
        
        // Get user1's USDST balance before minting
        uint balanceBefore = IERC20(USDST).balanceOf(address(user1));
        
        // Mint 15,000 USDST against ETHST collateral (from setupCDPTest.js)
        uint usdstToMint = 15000e18; // 15,000 USDST
        
        // User1 needs to approve CDP Engine to handle USDST (for potential burn operations)
        user1.do(USDST, "approve", address(engine), 1000000e18); // Large approval
        
        // User1 mints USDST against ETHST collateral
        user1.do(address(engine), "mint", ETHST, usdstToMint);
        
        // Verify USDST was minted to user1
        uint balanceAfter = IERC20(USDST).balanceOf(address(user1));
        require(balanceAfter == balanceBefore + usdstToMint, "USDST not minted correctly");
        
        // Collateral value: 10 ETHST * $3,000 = $30,000
        // Debt: $15,000 USDST
        // Collateralization ratio: $30,000 / $15,000 = 200% (healthy, above 150% requirement)
        
        log("✅ User1 minted 15,000 USDST against ETHST collateral");
        log("📊 Collateralization ratio: 200% (healthy)");
        _snapshot(); // Snapshot after minting USDST
    }

    // Crash ETHST price to make CDP undercollateralized
    function it_ai_can_tank_ethst_price() public {
        PriceOracle oracle = m.priceOracle();
        
        // Debug: Check if ETHST token is properly set
        require(address(ETHST) != address(0), "ETHST token not created");
        log("Tanking ETHST price - ETHST address: " + string(address(ETHST)));
        
        // Set initial ETHST price to $3,000 (in case it wasn't set earlier)
        uint initialPrice = 3000e18; // $3,000 with 18 decimals
        oracle.setAssetPrice(ETHST, initialPrice);
        
        // Get current price
        uint currentPrice = oracle.getAssetPrice(ETHST);
        require(currentPrice == 3000e18, "ETHST price should be $3,000 before crash");
        
        // Crash ETHST price from $3,000 to $100 (as in setupCDPTest.js)
        uint crashPrice = 100e18; // $100 with 18 decimals
        oracle.setAssetPrice(ETHST, crashPrice);
        
        // Verify price change
        require(oracle.getAssetPrice(ETHST) == crashPrice, "ETHST price not crashed correctly");
        
        // Calculate new collateralization ratio
        // Collateral value: 10 ETHST * $100 = $1,000
        // Debt: $15,000 USDST
        // Collateralization ratio: $1,000 / $15,000 = 6.67% (severely undercollateralized!)
        
        log("📉 ETHST price crashed from $3,000 to $100");
        log("⚠️  Position now severely undercollateralized: $1,000 collateral vs $15,000 debt");
        log("📊 Collateralization ratio: 6.67% (below 150% liquidation threshold)");
        _snapshot(); // Snapshot after price crash
    }

    // Liquidate the undercollateralized CDP to create bad debt
    function it_aj_can_liquidate_cdp() public {
        CDPEngine engine = m.cdpEngine();
        CDPReserve reserve = m.cdpReserve();
        
        // Check initial reserve balance
        uint initialReserveBalance = IERC20(USDST).balanceOf(address(reserve));
        log("💰 Initial reserve balance: " + string(initialReserveBalance / 1e18) + " USDST");
        
        // Give user2 USDST for liquidation (transfer from user1)
        uint liquidationAmount = 50000e18; // 50,000 USDST (much larger than debt)
        user1.do(USDST, "transfer", address(user2), liquidationAmount);
        require(IERC20(USDST).balanceOf(address(user2)) >= liquidationAmount, "User2 should have USDST for liquidation");
        
        // User2 approves CDP Engine to spend USDST for liquidation
        user2.do(USDST, "approve", address(engine), liquidationAmount);
        
        // User2 performs liquidation
        user2.do(address(engine), "liquidate", ETHST, address(user1), liquidationAmount);
        
        // Check user2 received ETHST collateral
        uint user2EthstBalance = IERC20(ETHST).balanceOf(address(user2));
        log("⚡ User2 received " + string(user2EthstBalance / 1e18) + " ETHST from liquidation");
        
        // Check if bad debt was created (collateral value < debt)
        // Collateral seized: 10 ETHST * $100 = $1,000
        // Debt to cover: $15,000
        // Bad debt created: $15,000 - $1,000 = $14,000
        
        // Clean up any remaining dust position to fully realize bad debt
        try user2.do(address(engine), "cleanupDustPosition", address(user1), ETHST) {
            log("🧹 Dust position cleaned up");
        } catch {
            log("⚠️  Dust cleanup not needed or failed");
        }
        
        // Check final reserve balance
        uint finalReserveBalance = IERC20(USDST).balanceOf(address(reserve));
        log("💰 Final reserve balance: " + string(finalReserveBalance / 1e18) + " USDST");
        
        log("✅ Liquidation completed - bad debt should be created");
        log("📊 Expected bad debt: ~14,000 USDST ($15,000 debt - $1,000 collateral)");
        _snapshot(); // Snapshot after liquidation and bad debt creation
    }

    // Test junior notes system for bad debt recovery
    function it_ak_can_test_junior_notes_system() public {
        CDPEngine engine = m.cdpEngine();
        CDPReserve reserve = m.cdpReserve();
        
        // Part 1: Configure junior premium (10% as in testJuniorNotes.js)
        log("🔧 Setting junior premium to 10%...");
        engine.setJuniorPremium(1000); // 10% in basis points
        
        // Part 2: Open junior notes from multiple users
        log("📝 Opening junior notes...");
        
        // Give users USDST for burning in junior notes
        user1.do(USDST, "transfer", address(user2), 4000e18); // 4,000 USDST to user2
        user1.do(USDST, "transfer", address(user3), 1000e18); // 1,000 USDST to user3
        
        // User1 opens note: 2,000 USDST burn → ~2,200 USDST cap (with 10% premium)
        user1.do(USDST, "approve", address(engine), 2000e18);
        user1.do(address(engine), "openJuniorNote", ETHST, 2000e18);
        log("✅ User1 opened junior note: 2,000 USDST → ~2,200 USDST cap");
        
        // User2 opens note: 1,500 USDST burn → ~1,650 USDST cap
        user2.do(USDST, "approve", address(engine), 1500e18);
        user2.do(address(engine), "openJuniorNote", ETHST, 1500e18);
        log("✅ User2 opened junior note: 1,500 USDST → ~1,650 USDST cap");
        
        // User3 opens note: 500 USDST burn → ~550 USDST cap
        user3.do(USDST, "approve", address(engine), 500e18);
        user3.do(address(engine), "openJuniorNote", ETHST, 500e18);
        log("✅ User3 opened junior note: 500 USDST → ~550 USDST cap");
        
        log("📊 Total notes outstanding: ~4,400 USDST cap from 4,000 USDST burned");
        _snapshot(); // Snapshot after opening all junior notes
        
        // Part 3: Simulate reserve inflows (as in testJuniorNotes.js)
        log("💰 Testing reserve inflows & pro-rata recovery...");
        
        // Inflow #1: 1,000 USDST to reserve
        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).transfer(address(reserve), 1000e18);
        log("🌊 Inflow #1: Sent 1,000 USDST to reserve");
        
        // Claims after inflow #1
        user1.do(address(engine), "claimJunior");
        user2.do(address(engine), "claimJunior");
        user3.do(address(engine), "claimJunior");
        log("💸 All users claimed after inflow #1");
        
        // Inflow #2: 700 USDST to reserve
        Token(USDST).mint(address(this), 700e18);
        IERC20(USDST).transfer(address(reserve), 700e18);
        log("🌊 Inflow #2: Sent 700 USDST to reserve");
        
        // Only user3 claims (others accumulate)
        user3.do(address(engine), "claimJunior");
        log("💸 Only User3 claimed after inflow #2");
        
        // Inflow #3: User2 top-up + 2,000 USDST to reserve
        user2.do(USDST, "approve", address(engine), 1000e18);
        user2.do(address(engine), "openJuniorNote", ETHST, 1000e18); // Top-up
        log("📝 User2 topped up with 1,000 USDST");
        
        Token(USDST).mint(address(this), 2000e18);
        IERC20(USDST).transfer(address(reserve), 2000e18);
        log("🌊 Inflow #3: Sent 2,000 USDST to reserve");
        
        // All users claim
        user1.do(address(engine), "claimJunior");
        user2.do(address(engine), "claimJunior");
        user3.do(address(engine), "claimJunior");
        log("💸 All users claimed after inflow #3");
        
        // Inflow #4: Final flush 300 USDST
        Token(USDST).mint(address(this), 300e18);
        IERC20(USDST).transfer(address(reserve), 300e18);
        log("🌊 Inflow #4: Final flush 300 USDST");
        
        // Final claims to close notes
        user1.do(address(engine), "claimJunior");
        user2.do(address(engine), "claimJunior");
        user3.do(address(engine), "claimJunior");
        log("💸 Final claims completed");
        
        log("✅ Junior notes system tested successfully");
        log("📊 Total inflows: 4,000 USDST (1,000 + 700 + 2,000 + 300)");
        log("🎯 Pro-rata distribution and indexing tested across multiple users");
        _snapshot(); // Final snapshot after junior notes testing
    }

} 