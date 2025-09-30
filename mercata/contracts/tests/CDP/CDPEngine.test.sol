// SPDX-License-Identifier: MIT
import "../../concrete/BaseCodeCollection.sol";

// Per‑vault state keyed by (user, asset)
struct Vault {
    uint collateral; // raw token units
    uint scaledDebt; // index‑denominated debt
}
struct CollateralGlobalState {
        uint rateAccumulator;   // RAY (>= RAY)
        uint lastAccrual;       // timestamp
        uint totalScaledDebt;   // sum of normalized principal (scaledDebt) across vaults
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
// User contract for multi-user testing
contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_CDPEngine {
    Mercata m;
    string[] emptyArray;

    // Test addresses and contracts
    address collateralTokenAddress;
    address usdstAddress;
    CDPEngine cdpEngine;
    CDPVault cdpVault;
    CDPRegistry cdpRegistry;
    CDPReserve cdpReserve;
    PriceOracle priceOracle;
    Token collateralToken;
    Token usdst;

    // Test users for liquidation tests
    User userA;
    User userB;

    // Test constants
    uint256 WAD = 1e18;
    uint256 RAY = 1e27;
    uint256 LIQUIDATION_RATIO = 150e16; // 1.5 WAD (150%)
    uint256 LIQUIDATION_PENALTY_BPS = 1000; // 10%
    uint256 CLOSE_FACTOR_BPS = 5000; // 50%
    // 5% APR: RAY * (1 + 0.05)^(1/31536000) ≈ RAY + (RAY * 5 / 100 / 31536000)
    // This is a per-second rate that compounds to ~5% annually
    uint256 STABILITY_FEE_RATE = RAY + ((RAY * 5) / 100 / 31536000); // 5% APR (365 days in seconds)
    uint256 DEBT_FLOOR = 1e18; // 1 USDST minimum
    uint256 DEBT_CEILING = 1000000e18; // 1M USD maximum
    uint256 UNIT_SCALE = 1e18; // 18 decimals

    function beforeAll() {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
        emptyArray = new string[](0);

        // Create test users
        userA = new User();
        userB = new User();

        // Get CDP components
        cdpEngine = m.cdpEngine();
        cdpVault = m.cdpVault();
        cdpRegistry = m.cdpRegistry();
        cdpReserve = m.cdpReserve();
        priceOracle = PriceOracle(address(cdpRegistry.priceOracle()));

        //  Create a mock USDST and set it in the registry
        // This replaces the hardcoded address with a working token
        address mockUSDSTAddress = m.tokenFactory().createToken(
            "USDST",
            "USD Stablecoin Token",
            emptyArray,
            emptyArray,
            emptyArray,
            "USDST",
            1000000000e18,
            18
        );
        Token mockUSDST = Token(mockUSDSTAddress);
        mockUSDST.setStatus(2); // ACTIVE

        // Give ourselves some USDST for testing BEFORE transferring ownership
        mockUSDST.mint(address(this), 1000000e18);
         // Mint USDST to users for liquidation testing
        mockUSDST.mint(address(userA), 100000e18);
        mockUSDST.mint(address(userB), 100000e18);

        // Grant CDPEngine mint and burn access to the mock USDST
        // Since Token uses onlyOwner for mint/burn, we transfer ownership to CDPEngine
        Ownable(address(mockUSDST)).transferOwnership(address(cdpEngine));

        // Update the registry to use our mock USDST instead of hardcoded address
        cdpRegistry.setUSDST(mockUSDSTAddress);

        // Set up our test references
        usdst = mockUSDST;
        usdstAddress = mockUSDSTAddress;

        // Set up price oracle
        priceOracle.setAssetPrice(usdstAddress, 1e18); // $1.00 in 18 decimals
    }

    function beforeEach() {
        // Create fresh collateral token for each test
        collateralTokenAddress = m.tokenFactory().createToken(
            "Collateral Token",
            "Test Collateral",
            emptyArray,
            emptyArray,
            emptyArray,
            "COLL",
            10000000e18,
            18
        );
        collateralToken = Token(collateralTokenAddress);

        // Activate collateral token
        collateralToken.setStatus(2); // ACTIVE

        // Mint collateral tokens to test contract and users
        collateralToken.mint(address(this), 100000e18); // Plenty for all tests
        collateralToken.mint(address(userA), 10000e18);
        collateralToken.mint(address(userB), 10000e18);
        
       

        // Configure collateral asset in CDP engine
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            STABILITY_FEE_RATE,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false // not paused
        );

        // CRITICAL: Set price for collateral token in the price oracle
        // Without this, CDPEngine will fail with "Price not available"
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18); // $5.00 per token (18 decimals)
    }

    // ============ BASIC SETUP TESTS ============

    function it_cdp_engine_creates_successfully() {
        require(
            address(cdpEngine) != address(0),
            "CDPEngine should be created"
        );
        require(address(cdpVault) != address(0), "CDPVault should be created");
        require(
            address(cdpRegistry) != address(0),
            "CDPRegistry should be created"
        );
        require(
            address(cdpReserve) != address(0),
            "CDPReserve should be created"
        );
    }

    function it_cdp_engine_has_correct_constants() {
        require(cdpEngine.WAD() == WAD, "WAD should be 1e18");
        require(cdpEngine.RAY() == RAY, "RAY should be 1e27");
    }

    function it_cdp_engine_can_configure_collateral_asset() {
        // Test that asset was configured correctly
        require(
            cdpEngine.isSupportedAsset(collateralTokenAddress),
            "Asset should be supported"
        );
    }

    // // ============ DEPOSIT TESTS ============

    function it_cdp_engine_can_deposit_collateral() {
        uint256 depositAmount = 1000e18;

        // Approve and deposit
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Check vault custody
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
                depositAmount,
            "CDPVault should hold collateral"
        );
    }

    function it_cdp_engine_can_deposit_multiple_times() {
        uint256 firstDeposit = 500e18;
        uint256 secondDeposit = 300e18;

        // First deposit
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                firstDeposit
            ),
            "First collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, firstDeposit);

        // Second deposit
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                secondDeposit
            ),
            "Second collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, secondDeposit);

        // Check total collateral in vault custody
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
                firstDeposit + secondDeposit,
            "Total collateral should be sum of deposits"
        );
    }

    // // ============ WITHDRAWAL TESTS ============

    function it_cdp_engine_can_withdraw_collateral_without_debt() {
        uint256 depositAmount = 1000e18;
        uint256 withdrawAmount = 400e18;

        // Deposit first
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Withdraw
        cdpEngine.withdraw(collateralTokenAddress, withdrawAmount);

        // Check remaining collateral
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
                depositAmount - withdrawAmount,
            "Remaining collateral should be correct"
        );
    }

    function it_cdp_engine_can_withdraw_max_without_debt() {
        uint256 depositAmount = 1000e18;

        // Deposit first
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Withdraw max (should be all collateral when no debt)
        uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);

        require(
            withdrawnAmount == depositAmount,
            "Should withdraw all collateral when no debt"
        );
        // Check vault is empty
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
                0,
            "Vault should have no collateral after withdrawMax"
        );
    }

    // // ============ MINTING TESTS ============

    function it_cdp_engine_can_mint_usdst() {
        uint256 depositAmount = 2000e18; // $10000 worth at $5 price
        uint256 mintAmount = 1000e18; // $1000 USDST (safe with 150% ratio)

        // Deposit collateral first
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Mint USDST
        uint256 initialBalance = ERC20(usdstAddress).balanceOf(address(this));
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Check USDST balance
        uint256 finalBalance = ERC20(usdstAddress).balanceOf(address(this));
        require(
            finalBalance == initialBalance + mintAmount,
            "USDST balance should increase by mint amount"
        );
    }

    function it_cdp_engine_can_mint_max_usdst() {
        uint256 depositAmount = 2000e18; // $10000 worth at $5 price

        // Deposit collateral first
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        // Mint max USDST
        uint256 initialBalance = ERC20(usdstAddress).balanceOf(address(this));
        uint256 mintedAmount = cdpEngine.mintMax(collateralTokenAddress);

        require(mintedAmount > 0, "Should mint some USDST");

        // Check USDST balance
        uint256 finalBalance = ERC20(usdstAddress).balanceOf(address(this));
        require(
            finalBalance == initialBalance + mintedAmount,
            "USDST balance should increase by minted amount"
        );

        // Verify we're at the liquidation ratio
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(
            cr == LIQUIDATION_RATIO,
            "CR should be equal to liquidation ratio"
        );
    }

    function it_cdp_engine_enforces_debt_floor() {
        uint256 depositAmount = 1000e18; // $5000 worth at $5 price

        // Deposit collateral first
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Try to mint below debt floor (should fail)
        uint256 belowFloorAmount = DEBT_FLOOR - 1; // 99.999... USD

        // This should fail with "CDPEngine: below debt floor"
        bool reverted = false;
        try {
            cdpEngine.mint(collateralTokenAddress, belowFloorAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when minting below debt floor");
    }

    // // ============ REPAYMENT TESTS ============

    function it_cdp_engine_can_repay_debt() {
        uint256 depositAmount = 2000e18;
        uint256 mintAmount = 1000e18;
        uint256 repayAmount = 500e18;

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Get initial state before repayment
        uint256 initialUSDSTBalance = ERC20(usdstAddress).balanceOf(
            address(this)
        );
        uint256 initialCR = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );

        // Repay partial debt
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), repayAmount),
            "USDST approval failed"
        );
        cdpEngine.repay(collateralTokenAddress, repayAmount);

        // Verify repayment worked by checking changes
        uint256 finalUSDSTBalance = ERC20(usdstAddress).balanceOf(address(this));
        uint256 finalCR = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );

        // USDST should be burned (balance decreased)
        require(
            finalUSDSTBalance == initialUSDSTBalance - repayAmount,
            "USDST balance should decrease by repay amount"
        );

        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt == mintAmount - repayAmount,
            "Debt should be reduced by repayment amount"
        );
        
    }

    function it_cdp_engine_can_repay_all_debt() {
        uint256 depositAmount = 2000e18;
        uint256 mintAmount = 1000e18;

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Approve enough for repayment including potential fees
        require(
            ERC20(usdstAddress).approve(
                address(cdpEngine),
                mintAmount + 100e18
            ),
            "USDST approval failed"
        );

        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt == mintAmount,
            "Debt should be equal to mint amount when all debt is repaid"
        );

        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).collateral == depositAmount,
             "Collateral should be equal to deposit amount when all debt is repaid"
        );

        cdpEngine.repayAll(collateralTokenAddress);

        // Check CR is infinite (no debt)
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(cr == 2 ** 256 - 1, "CR should be max when no debt");

        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt == 0,
            "Debt should be 0 when all debt is repaid"
        );
    }

    // // ============ COLLATERALIZATION RATIO TESTS ============

    function it_cdp_engine_calculates_collateralization_ratio() {
        uint256 depositAmount = 3000e18; // $15000 at $5 price
        uint256 mintAmount = 1500e18; // $1500 debt

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Check CR
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );

        // Expected CR = 15000 / 1500 = 10 =  10e18 WAD
        uint256 price = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 expectedCR = (depositAmount * price / mintAmount);

        require(
            cr == expectedCR,
            "CR should be  10"
        );
    }

    function it_cdp_engine_returns_max_cr_when_no_debt() {
        uint256 depositAmount = 1000e18;

        // Deposit without minting
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Check CR (should be max uint when no debt)
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(cr == 2 ** 256 - 1, "CR should be max when no debt");
    }

    // // ============ WITHDRAWAL WITH DEBT TESTS ============

    function it_cdp_engine_allows_safe_withdrawal_with_debt() {
        uint256 depositAmount = 2000e18;
        uint256 mintAmount = 1200e18; 

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Verify position is currently safe
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(cr > LIQUIDATION_RATIO, "Position should be safe initially");

        // Test a safe withdrawal
        uint256 safeWithdrawAmount = 100e18;
        cdpEngine.withdraw(collateralTokenAddress, safeWithdrawAmount);

        // Verify withdrawal worked
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
                depositAmount - safeWithdrawAmount,
            "Safe withdrawal should work"
        );
    }

    function it_cdp_engine_prevents_unsafe_withdrawal() {
        uint256 depositAmount = 2000e18;
        uint256 mintAmount = 1200e18;

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Verify position is currently safe
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(cr > LIQUIDATION_RATIO, "Position should be safe initially");

        // Calculate withdrawal amount that would make position unsafe
        uint256 currentCollateral = cdpVault.userCollaterals(
            address(this),
            collateralTokenAddress
        );
        uint256 currentDebt = cdpEngine
            .vaults(address(this), collateralTokenAddress)
            .scaledDebt;

        // Calculate minimum collateral needed to maintain liquidation ratio
        // minCollateral = debt * liquidationRatio / price
        uint256 price = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 minCollateral = (currentDebt * LIQUIDATION_RATIO) / price;

        // Try to withdraw more than allowed (leaving less than minimum collateral)
        uint256 unsafeWithdrawAmount = currentCollateral - minCollateral + 1;

        // This should revert
        bool reverted = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, unsafeWithdrawAmount); 
        } catch {
            reverted = true;
        }

        require(reverted, "Unsafe withdrawal should have been prevented");
    }

    function it_cdp_engine_withdraw_max_with_debt_respects_liquidation_ratio() {
        uint256 depositAmount = 3000e18;
        uint256 mintAmount = 1500e18;

        // Setup: deposit and mint
        require(
            ERC20(collateralTokenAddress).approve(
                address(cdpVault),
                depositAmount
            ),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Withdraw max
        uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);

        require(
            withdrawnAmount > 0,
            "Should be able to withdraw some collateral"
        );
        require(
            withdrawnAmount < depositAmount,
            "Should not withdraw all collateral when debt exists"
        );

        // Verify position is exactly at liquidation threshold (withdrew maximum possible)
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(
            cr == LIQUIDATION_RATIO,
            "CR should equal liquidation ratio after withdrawMax (withdrew maximum safe amount)"
        );
    }

    // // ============ PAUSE FUNCTIONALITY TESTS ============

    function it_cdp_engine_can_pause_asset() {
        // First verify operations work when not paused
        uint256 depositAmount = 1000e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount); // Should work

        // Pause the asset
        cdpEngine.setPaused(collateralTokenAddress, true);

        // Verify that paused operations are blocked
        bool depositReverted = false;
        try {
            cdpEngine.deposit(collateralTokenAddress, 100e18);
        } catch {
            depositReverted = true;
        }
        require(depositReverted, "Deposit should be blocked when asset is paused");

        bool mintReverted = false;
        try {
            cdpEngine.mint(collateralTokenAddress, 100e18);
        } catch {
            mintReverted = true;
        }
        require(mintReverted, "Mint should be blocked when asset is paused");

        // Unpause and verify operations work again
        cdpEngine.setPaused(collateralTokenAddress, false);
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), 100e18),
            "Additional collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, 100e18); // Should work again
    }

    function it_cdp_engine_can_pause_globally() {
        // Pause globally
        cdpEngine.setPausedGlobal(true);

        // Check global pause
        require(cdpEngine.globalPaused(), "Engine should be globally paused");

        // Unpause for other tests
        cdpEngine.setPausedGlobal(false);
        require(!cdpEngine.globalPaused(), "Engine should be unpaused");
    }

    // ============ LIQUIDATION TESTS ============

    function it_cdp_engine_can_liquidate_unhealthy_position() {
        // Setup: UserB creates a position close to liquidation threshold
        uint256 depositAmount = 2000e18; // 2000 tokens × $5 = $10,000 collateral value
        uint256 mintAmount = 5000e18;    // $6,000 debt = 166% CR ($10,000/$6,000), close to 150% threshold

        // UserB approves and deposits collateral using do function
        userB.do(collateralTokenAddress, "approve", address(cdpVault), depositAmount);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, depositAmount);
        
        // UserB mints USDST
        userB.do(address(cdpEngine), "mint", collateralTokenAddress, mintAmount);

        // Verify position is initially safe
        uint256 initialCR = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(initialCR >= LIQUIDATION_RATIO, "Position should be safe initially");

        // Price crash: Drop collateral price from $5 to $1.5 (70% drop)
        uint256 currentPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 newPrice = currentPrice * 7 / 10;
        priceOracle.setAssetPrice(collateralTokenAddress, newPrice);

        // Verify position is now unsafe
        uint256 newCR = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(newCR < LIQUIDATION_RATIO, "Position should be underwater after price drop");

        // Get state before liquidation
        uint256 userBDebtBefore = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBCollateralBefore = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userAUSDSTBefore = ERC20(usdstAddress).balanceOf(address(userA));
        uint256 userACollateralBefore = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // UserA liquidates UserB's position
        uint256 debtToCover = 1000e18; // Liquidate part of the debt
        
        // UserA executes liquidation using do function
        userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), debtToCover);

        // Get state after liquidation
        uint256 userBDebtAfter = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBCollateralAfter = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userAUSDSTAfter = ERC20(usdstAddress).balanceOf(address(userA));
        uint256 userACollateralAfter = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // Calculate expected changes
        uint256 userBDebtReduced = userBDebtBefore - userBDebtAfter;
        uint256 userBCollateralSeized = userBCollateralBefore - userBCollateralAfter;
        uint256 userAUSDSTBurned = userAUSDSTBefore - userAUSDSTAfter;
        uint256 userACollateralReceived = userACollateralAfter - userACollateralBefore;
        
        // Verify exact liquidation mechanics
        require(userAUSDSTBurned == debtToCover, "UserA should have burned exactly debtToCover USDST");
        require(userBDebtReduced == debtToCover, "UserB debt reduction should be equal to amount covered");
        require(userBCollateralSeized == userACollateralReceived, "UserB collateral seized should equal UserA collateral received");
        
        // Calculate expected collateral seized (debt + penalty)
        uint256 penaltyAmount = (userAUSDSTBurned * LIQUIDATION_PENALTY_BPS) / 10000;
        uint256 totalRepayWithPenalty = userAUSDSTBurned + penaltyAmount;
        uint256 liquidationPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 expectedCollateralSeized = (totalRepayWithPenalty * UNIT_SCALE) / liquidationPrice;
        
        require(
            userBCollateralSeized == expectedCollateralSeized,
            "UserB collateral seized should equal (debt + penalty) / price"
        );

    }

    function it_cdp_engine_can_seize_all_collateral_in_severe_liquidation() {
        // Setup: UserB creates a position with significant debt
        uint256 depositAmount = 2000e18; // 2000 tokens × $5 = $10,000 collateral value
        uint256 mintAmount = 6000e18;    // $6,000 debt = 166% CR initially

        // UserB approves and deposits collateral
        userB.do(collateralTokenAddress, "approve", address(cdpVault), depositAmount);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, depositAmount);
        
        // UserB mints USDST
        userB.do(address(cdpEngine), "mint", collateralTokenAddress, mintAmount);

        // Verify position is initially safe
        uint256 initialCR = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(initialCR >= LIQUIDATION_RATIO, "Position should be safe initially");

        // SEVERE Price crash: Drop collateral price from $5 to $1 (80% drop)
        uint256 currentPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 severelyLowPrice = currentPrice / 5; 
        priceOracle.setAssetPrice(collateralTokenAddress, severelyLowPrice);
        

        // Verify position is severely underwater
        uint256 newCR = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(newCR < LIQUIDATION_RATIO, "Position should be severely underwater after price crash");
        // Get state before liquidation
        uint256 userBCollateralBefore = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userACollateralBefore = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // UserA liquidates UserB's position with a large debt amount
        // This should seize ALL remaining collateral
        uint256 debtToCover = mintAmount; // Liquidate all button
        
        // UserA executes liquidation
        userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), debtToCover);

        // Get state after liquidation
        uint256 userBCollateralAfter = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userACollateralAfter = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // Verify ALL collateral was seized (collateral = 0)
        require(
            userBCollateralAfter == 0,
            "UserB should have ZERO collateral remaining after severe liquidation"
        );

        // Verify UserA received all the seized collateral
        uint256 totalCollateralSeized = userBCollateralBefore; // All of it
        uint256 userACollateralReceived = userACollateralAfter - userACollateralBefore;
        
        require(
            userACollateralReceived == totalCollateralSeized,
            "UserA should receive all seized collateral"
        );

        
    }

    function it_cdp_engine_prevents_liquidation_of_healthy_position() {
        // Setup: UserB creates a safe position
        uint256 depositAmount = 3000e18;
        uint256 mintAmount = 1000e18; // Conservative LTV

        // UserB creates position using do function
        userB.do(collateralTokenAddress, "approve", address(cdpVault), depositAmount);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, depositAmount);
        userB.do(address(cdpEngine), "mint", collateralTokenAddress, mintAmount);

        // Verify position is safe
        uint256 cr = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(cr > LIQUIDATION_RATIO, "Position should be safe");

        // UserA tries to liquidate (should fail)
        uint256 debtToCover = 100e18;
        
        bool liquidationReverted = false;
        try {
            userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), debtToCover);
        } catch {
            liquidationReverted = true;
        }
        
        require(liquidationReverted, "Liquidation of healthy position should revert");
    }

    // ============ FULL FLOW TESTS ============

    function it_cdp_engine_complete_lifecycle_deposit_borrow_repay_max() {
        // Test a complete user lifecycle: deposit -> borrow -> repay max
        uint256 depositAmount = 11e18;  // 11 units of collateral ($55 value)
        uint256 borrowAmount = 1e18;    // 1 USDST

        // === PHASE 1: DEPOSIT ===
        uint256 userBCollateralInitial = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userBDebtInitial = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBTokenBalanceInitial = ERC20(collateralTokenAddress).balanceOf(address(userB));

        require(userBCollateralInitial == 0, "UserB should start with no collateral in vault");
        require(userBDebtInitial == 0, "UserB should start with no debt");
        require(userBTokenBalanceInitial >= depositAmount, "UserB should have enough tokens to deposit");

        userB.do(collateralTokenAddress, "approve", address(cdpVault), depositAmount);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, depositAmount);

        uint256 userBCollateralAfterDeposit = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userBTokenBalanceAfterDeposit = ERC20(collateralTokenAddress).balanceOf(address(userB));
        
        require(userBCollateralAfterDeposit == depositAmount, "UserB should have deposited collateral in vault");
        require(userBTokenBalanceAfterDeposit == userBTokenBalanceInitial - depositAmount, "UserB token balance should decrease by deposit amount");

        // === PHASE 2: BORROW ===
        uint256 userBUSDSTBefore = ERC20(usdstAddress).balanceOf(address(userB));
        uint256 userBDebtBefore = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;

        userB.do(address(cdpEngine), "mint", collateralTokenAddress, borrowAmount);

        uint256 userBUSDSTAfter = ERC20(usdstAddress).balanceOf(address(userB));
        uint256 userBDebtAfter = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        
        require(userBUSDSTAfter == userBUSDSTBefore + borrowAmount, "UserB should receive borrowed USDST");
        require(userBDebtAfter == userBDebtBefore + borrowAmount, "UserB debt should increase by borrow amount");

        uint256 crAfterBorrow = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(crAfterBorrow > LIQUIDATION_RATIO, "Position should be healthy after borrowing");

        uint256 expectedCR = (depositAmount * priceOracle.getAssetPrice(collateralTokenAddress)) / borrowAmount;
        require(crAfterBorrow == expectedCR, "CR should match expected calculation");

        // === PHASE 3: REPAY MAX ===
        uint256 userBUSDSTBeforeRepay = ERC20(usdstAddress).balanceOf(address(userB));
        uint256 userBDebtBeforeRepay = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBCollateralBeforeRepay = cdpVault.userCollaterals(address(userB), collateralTokenAddress);

        require(userBDebtBeforeRepay == borrowAmount, "UserB debt should be equal to borrow amount before repayment");
        userB.do(address(cdpEngine), "repayAll", collateralTokenAddress);

        uint256 userBUSDSTAfterRepay = ERC20(usdstAddress).balanceOf(address(userB));
        uint256 userBDebtAfterRepay = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBCollateralAfterRepay = cdpVault.userCollaterals(address(userB), collateralTokenAddress);

        require(userBDebtAfterRepay == 0, "UserB should have no debt after repayAll");
        require(userBCollateralAfterRepay == userBCollateralBeforeRepay, "UserB collateral should remain unchanged after repayment");
        
        
        require(userBUSDSTBefore == userBUSDSTAfterRepay, "UserB should have burned exactly the borrowed amount");

        uint256 crAfterRepay = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(crAfterRepay == 2**256 - 1, "CR should be max when no debt exists");

        // === PHASE 4: FINAL VERIFICATION ===
        require(userBCollateralAfterRepay == depositAmount, "Final state: UserB should still have all collateral");
       
    }

    function it_cdp_engine_supports_complete_lifecycle() {
        uint256 initialDepositAmount = 2000e18;  // 2000 tokens × $5 = $10,000 collateral
        uint256 firstMintAmount = 5000e18;        // $5000 USDST (200% CR)
        uint256 secondDepositAmount = 200e18;    // Additional deposit → 200 tokens = $1000 total
        uint256 secondMintAmount = 2000e18;        // Additional USDST mint → $1,000 total debt (5000% CR)
        uint256 partialRepayAmount = 1000e18;      // Partial repayment
        uint256 partialWithdrawAmount = 100e18;  // Partial withdrawal
        uint256 princeIncreaseMultiplier = 2;       // Price doubles ($5 → $10)

        // Initial state tracking
        uint256 startingCollateralBalance = ERC20(collateralTokenAddress).balanceOf(address(this));
        uint256 startingUSDSTBalance = ERC20(usdstAddress).balanceOf(address(this));
        // log("starting Collateral Balance", startingCollateralBalance/WAD);
        // log("starting USDST Balance", startingUSDSTBalance/WAD);
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: INITIAL COLLATERAL DEPOSIT
        // ═══════════════════════════════════════════════════════════════════
        
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), initialDepositAmount),
            "Step 1: Collateral approval failed"
        );
        
        cdpEngine.deposit(collateralTokenAddress, initialDepositAmount);
        
        // Verify deposit
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) == initialDepositAmount,
            "Step 1: Initial collateral deposit verification failed"
        );
        
        // Check CR (should be infinite - no debt yet)
        uint256 crAfterDeposit = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(crAfterDeposit == 2**256 - 1, "Step 1: CR should be infinite with no debt");

        // log(" ═══════════════════════════════════════════════════════════════════
        //                 STEP 1: INITIAL COLLATERAL DEPOSIT
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("vault collateral after deposit", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("vault debt after deposit", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 2: FIRST USDST MINT
        // // ═══════════════════════════════════════════════════════════════════
        
        uint256 balanceBeforeFirstMint = ERC20(usdstAddress).balanceOf(address(this));
        cdpEngine.mint(collateralTokenAddress, firstMintAmount);
        
        uint256 balanceAfterFirstMint = ERC20(usdstAddress).balanceOf(address(this));
        require(
            balanceAfterFirstMint == balanceBeforeFirstMint + firstMintAmount,
            "Step 2: First USDST mint balance verification failed"
        );
        
        // Check CR after first mint
        uint256 crAfterFirstMint = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(crAfterFirstMint > LIQUIDATION_RATIO, "Step 2: Position should be healthy after first mint");
        
        // Expected CR: $50,000 / $1,000 = 50.0 (5000%)
        uint256 currentPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        require(crAfterFirstMint == (initialDepositAmount * currentPrice) / firstMintAmount, "Step 2: CR should be 5000%");

        // log(" ═══════════════════════════════════════════════════════════════════
        //                 STEP 2: FIRST USDST MINT
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("vault collateral after first mint", cdpVault.userCollaterals(address(this), collateralTokenAddress)/WAD);
        // log("vault debt after first mint", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 3: ADDITIONAL COLLATERAL DEPOSIT
        // // ═══════════════════════════════════════════════════════════════════
        
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), secondDepositAmount),
            "Step 3: Second collateral approval failed"
        );
        
        cdpEngine.deposit(collateralTokenAddress, secondDepositAmount);
        
        uint256 totalCollateralAfterSecondDeposit = initialDepositAmount + secondDepositAmount;
        require(
            cdpVault.userCollaterals(address(this), collateralTokenAddress) == totalCollateralAfterSecondDeposit,
            "Step 3: Total collateral after second deposit verification failed"
        );

        // log(" ═══════════════════════════════════════════════════════════════════
        //                 STEP 3: ADDITIONAL COLLATERAL DEPOSIT
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("vault collateral after second deposit", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("vault debt after second deposit", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 4: SECOND USDST MINT (LEVERAGING ADDITIONAL COLLATERAL)
        // // ═══════════════════════════════════════════════════════════════════
        
        uint256 balanceBeforeSecondMint = ERC20(usdstAddress).balanceOf(address(this));
        cdpEngine.mint(collateralTokenAddress, secondMintAmount);
        
        uint256 balanceAfterSecondMint = ERC20(usdstAddress).balanceOf(address(this));
        require(
            balanceAfterSecondMint == balanceBeforeSecondMint + secondMintAmount,
            "Step 4: Second USDST mint balance verification failed"
        );
        
        uint256 totalMinted = firstMintAmount + secondMintAmount;
        uint256 crAfterSecondMint = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        
        require(crAfterSecondMint == (totalCollateralAfterSecondDeposit * currentPrice) / totalMinted, "Step 4: CR should be approximately 5000% after second mint");

        // log(" ═══════════════════════════════════════════════════════════════════
        //                 STEP 4: SECOND USDST MINT (LEVERAGING ADDITIONAL COLLATERAL)
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("vault collateral after second mint", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("vault debt after second mint", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("cr after second mint", crAfterSecondMint);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 5: PRICE APPRECIATION SCENARIO
        // // ═══════════════════════════════════════════════════════════════════
        
        // Simulate collateral price doubling from $5 to $10
        uint256 newPrice = currentPrice * princeIncreaseMultiplier;
        priceOracle.setAssetPrice(collateralTokenAddress, newPrice);
        
        uint256 crAfterPriceIncrease = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(
            crAfterPriceIncrease > crAfterSecondMint,
            "Step 5: CR should improve after price appreciation by princeIncreaseMultiplier"
        );
        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 5: PRICE APPRECIATION SCENARIO
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("cr after price appreciation", crAfterPriceIncrease);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 6: PARTIAL DEBT REPAYMENT
        // // ═══════════════════════════════════════════════════════════════════
        
        uint256 balanceBeforeRepay = ERC20(usdstAddress).balanceOf(address(this));
        uint256 crBeforeRepay = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), partialRepayAmount),
            "Step 6: USDST repayment approval failed"
        );
        
        cdpEngine.repay(collateralTokenAddress, partialRepayAmount);
        
        uint256 balanceAfterRepay = ERC20(usdstAddress).balanceOf(address(this));
        uint256 crAfterRepay = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        
        require(
            balanceAfterRepay == balanceBeforeRepay - partialRepayAmount,
            "Step 6: USDST balance should decrease by repayment amount"
        );
        
        require(
            crAfterRepay > crBeforeRepay,
            "Step 6: CR should improve after debt repayment"
        );
        uint256 debtAfterRepay = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        require(
            debtAfterRepay == totalMinted - partialRepayAmount,
            "Step 6: Debt should be reduced by repayment amount"
        );

        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 6: PARTIAL DEBT REPAYMENT
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("collateral after repayment", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("debt after repayment", debtAfterRepay);
        // log("cr after repayment", crAfterRepay);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 7: PARTIAL COLLATERAL WITHDRAWAL
        // // ═══════════════════════════════════════════════════════════════════
        
        uint256 collateralBeforeWithdraw = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userCollateralBalanceBeforeWithdraw = ERC20(collateralTokenAddress).balanceOf(address(this));
        
        cdpEngine.withdraw(collateralTokenAddress, partialWithdrawAmount);
        
        uint256 collateralAfterWithdraw = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userCollateralBalanceAfterWithdraw = ERC20(collateralTokenAddress).balanceOf(address(this));
        
        require(
            collateralAfterWithdraw == collateralBeforeWithdraw - partialWithdrawAmount,
            "Step 7: Vault collateral should decrease by withdrawal amount"
        );
        
        require(
            userCollateralBalanceAfterWithdraw == userCollateralBalanceBeforeWithdraw + partialWithdrawAmount,
            "Step 7: User collateral balance should increase by withdrawal amount"
        );
        
        // Verify position remains healthy after withdrawal
        uint256 crAfterWithdraw = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(crAfterWithdraw > LIQUIDATION_RATIO, "Step 7: Position should remain healthy after withdrawal");

        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 7: PARTIAL COLLATERAL WITHDRAWAL
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("collateral after withdrawal", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("debt after withdrawal", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("cr after withdrawal", crAfterWithdraw);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 8: TEST MAX WITHDRAWAL FUNCTION & LIQUIDATION THRESHOLD
        // // ═══════════════════════════════════════════════════════════════════
        
        // Execute withdrawMax and verify it withdrew something
        uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);
        require(withdrawnAmount > 0, "Step 8a: Should have withdrawn some collateral");

   

        // Verify we're at liquidation threshold
        uint256 crAfterMaxWithdraw = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(
            crAfterMaxWithdraw >= LIQUIDATION_RATIO && 
            crAfterMaxWithdraw <= LIQUIDATION_RATIO + 1e15,
            "Step 8b: Should be at liquidation threshold"
        );

        // // Verify no more withdrawals possible
        // uint256 noMoreWithdrawable = cdpEngine.withdrawMax(collateralTokenAddress);
        // require(noMoreWithdrawable == 0, "Step 8c: No more withdrawals should be possible");

        // Test edge case - try withdrawing a small amount
        bool withdrawFailed = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, 1000000000); // 10 wei should definitely fail
        } catch {
            withdrawFailed = true;
        }
        // require(withdrawFailed, "Step 8d: Large withdrawal should fail when at liquidation threshold");
        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 8: TEST MAX WITHDRAWAL FUNCTION & LIQUIDATION THRESHOLD
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("collateral after withdrawal", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("debt after withdrawal", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("cr after withdrawal", crAfterMaxWithdraw);
        // log("withdrawn amount", withdrawnAmount);
        // log("withdraw failed", withdrawFailed);

        // // ═══════════════════════════════════════════════════════════════════
        // // STEP 9: COMPLETE DEBT REPAYMENT
        // // ═══════════════════════════════════════════════════════════════════
        
        uint256 remainingDebt = totalMinted - partialRepayAmount; 
        
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), remainingDebt), 
            "Step 9: Final USDST approval failed"
        );
        
        cdpEngine.repayAll(collateralTokenAddress);
        
        // Verify no debt remains (CR should be infinite)
        uint256 crAfterFullRepay = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        uint256 debtAfterFullRepay = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        require(debtAfterFullRepay == 0, "Step 9: Debt should be 0 after full repayment");
        require(crAfterFullRepay == 2**256 - 1, "Step 9: CR should be infinite after full repayment");
        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 9: COMPLETE DEBT REPAYMENT
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("collateral after full repayment", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("debt after full repayment", debtAfterFullRepay);
        // log("USDST balance after full repayment", ERC20(usdstAddress).balanceOf(address(this)));
        // log("cr after full repayment", crAfterFullRepay);

        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: FINAL COLLATERAL WITHDRAWAL
        // ═══════════════════════════════════════════════════════════════════
        
        uint256 finalWithdrawAmount = cdpEngine.withdrawMax(collateralTokenAddress);
        require(finalWithdrawAmount > 0, "Step 10: Should be able to withdraw remaining collateral");
        // log("debt after full repayment", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("collateral after full repayment and withdraw", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        
        // Verify all collateral is withdrawn
        // require(
        //     cdpVault.userCollaterals(address(this), collateralTokenAddress) < 2,
        //     "Step 10: All collateral should be withdrawn from vault"
        // );
        // log(   " ═══════════════════════════════════════════════════════════════════
        //                 STEP 10: FINAL COLLATERAL WITHDRAWAL
        //       ═══════════════════════════════════════════════════════════════════ ");
        // log("collateral after final withdrawal", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("debt after final withdrawal", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("colalt in engine", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // ═══════════════════════════════════════════════════════════════════
        // STEP 11: FINAL STATE VERIFICATION
        // ═══════════════════════════════════════════════════════════════════
        
        uint256 finalCollateralBalance = ERC20(collateralTokenAddress).balanceOf(address(this));
        uint256 finalUSDSTBalance = ERC20(usdstAddress).balanceOf(address(this));
        
        // Account for the net changes (some USDST was repaid, some collateral was received)
        // The user should have more collateral than they started with due to price appreciation
        require(
            finalCollateralBalance >= startingCollateralBalance,
            "Step 11: User should have recovered their initial collateral or more"
        );
        
        // Verify the CDP system is in a clean state for this user
        uint256 finalCR = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(finalCR == 2**256 - 1, "Step 11: Final CR should be infinite (no debt)");
        
    }

    // ═══════════════════════════════════════════════════════════════════
    // VULNERABILITY TEST: Safety Buffer Edge Case
    // ═══════════════════════════════════════════════════════════════════
    
    function it_cdp_engine_safety_buffer_vulnerability_test() {
        // Test the complete cycle to verify safety buffer behavior
        uint256 depositAmount = 1000e18;  // 1000 tokens × $5 = $5,000 collateral
        uint256 mintAmount = 500e18;      // $500 USDST (1000% CR)
        
        // STEP 1: Deposit collateral
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        
        uint256 collateralAfterDeposit = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        require(collateralAfterDeposit == depositAmount, "Step 1: Deposit verification failed");
        // log("After deposit - Collateral", collateralAfterDeposit);
        
        // STEP 2: Mint USDST
        cdpEngine.mint(collateralTokenAddress, mintAmount);
        
        uint256 debtAfterMint = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        require(debtAfterMint == mintAmount, "Step 2: Mint verification failed");
        // log("After mint - Debt", debtAfterMint);
        // log("After mint - Collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        
        // STEP 3: repayAll (complete debt repayment)
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), mintAmount),
            "USDST approval for repayAll failed"
        );
        cdpEngine.repayAll(collateralTokenAddress);
        
        uint256 debtAfterRepayAll = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 collateralAfterRepayAll = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        require(debtAfterRepayAll == 0, "Step 3: Debt should be 0 after repayAll");
        // log("After repayAll - Debt", debtAfterRepayAll);
        // log("After repayAll - Collateral", collateralAfterRepayAll);
        
        // STEP 4: withdrawMax (should withdraw almost everything)
        uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);
        
        uint256 debtAfterWithdrawMax = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 collateralAfterWithdrawMax = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        
        // log("After withdrawMax - Withdrawn amount", withdrawnAmount);
        // log("After withdrawMax - Debt", debtAfterWithdrawMax);
        // log("After withdrawMax - Collateral remaining", collateralAfterWithdrawMax);
        
        // VERIFICATION: Expected state according to your hypothesis
        require(debtAfterWithdrawMax == 0, "Debt should still be 0 after withdrawMax");
        
        // This is the key test - you expect collateral remaining due to safety buffer logic
        // log("Testing: What happens when debt=0 but withdrawMax still leaves collateral?");
        
        // STEP 5: Try to withdraw additional amount
        bool additionalWithdrawFailed = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, 1);
        } catch {
            additionalWithdrawFailed = true;
        }
        
        // FINAL STATE LOGGING
        uint256 finalDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 finalCollateral = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        
        // log("FINAL STATE - Debt", finalDebt);
        // log("FINAL STATE - Collateral", finalCollateral);
        // log("Additional withdraw failed?", additionalWithdrawFailed ? 1 : 0);
        
        // Analysis of the vulnerability
        // if (collateralAfterWithdrawMax > 0 && debtAfterWithdrawMax == 0) {
        //     log("POTENTIAL VULNERABILITY: withdrawMax leaves collateral when debt=0");
        //     log("Expected behavior: Should withdraw ALL collateral when debt=0");
        //     log("Actual: Left", collateralAfterWithdrawMax);
            
        //     if (additionalWithdrawFailed) {
        //         log("VULNERABILITY CONFIRMED: Cannot withdraw remaining collateral despite 0 debt");
        //     } else {
        //         log("Vulnerability mitigated: Can still withdraw remaining collateral");
        //     }
        // }
        
        // Summary
        require(finalDebt == 0, "Final verification: Debt should be 0");
        // log("Summary: Starting collateral", depositAmount);
        // log("Summary: Withdrawn via withdrawMax", withdrawnAmount);
        // log("Summary: Remaining collateral", finalCollateral);
        // log("Summary: Total accounted", withdrawnAmount + finalCollateral);
        
        // The key question: Should withdrawMax return ALL collateral when debt=0?
        // if (debtAfterWithdrawMax == 0 && collateralAfterWithdrawMax > 0) {
        //     log("INVESTIGATION: withdrawMax should return ALL when debt=0, but didn't");
        // }
    }

    // ═══════════════════════════════════════════════════════════════════
    // BUG INVESTIGATION: Vault State Divergence
    // ═══════════════════════════════════════════════════════════════════
    
    function it_cdp_engine_vault_state_divergence_bug() {
        uint256 depositAmount = 1000e18;   // 1000 tokens × $5 = $5,000 collateral
        uint256 mintAmount = 500e18;       // $500 USDST (1000% CR)
        
        // log("=== INITIAL STATE ===");
        // log("Engine vault collateral", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // log("CDPVault collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        
        // STEP 1: Deposit collateral
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        
        // log("=== AFTER DEPOSIT ===");
        // log("Engine vault collateral", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // log("CDPVault collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        
        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).collateral == 
            cdpVault.userCollaterals(address(this), collateralTokenAddress),
            "Step 1: Engine and CDPVault should be in sync after deposit"
        );
        
        // STEP 2: Mint USDST to create debt
        cdpEngine.mint(collateralTokenAddress, mintAmount);
        
        // log("=== AFTER MINT ===");
        // log("Engine vault collateral", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // log("CDPVault collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("Debt", cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt);
        // log("CR", cdpEngine.collateralizationRatio(address(this), collateralTokenAddress));
        
        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).collateral == 
            cdpVault.userCollaterals(address(this), collateralTokenAddress),
            "Step 2: Engine and CDPVault should be in sync after mint"
        );
        
        // STEP 3: Withdraw maximum safe amount to reach liquidation threshold
        uint256 maxWithdrawable = cdpEngine.withdrawMax(collateralTokenAddress);
        // log("=== AFTER WITHDRAW MAX ===");
        // log("Max withdrawable", maxWithdrawable);
        // log("Engine vault collateral", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // log("CDPVault collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("CR", cdpEngine.collateralizationRatio(address(this), collateralTokenAddress));
        
        require(
            cdpEngine.vaults(address(this), collateralTokenAddress).collateral == 
            cdpVault.userCollaterals(address(this), collateralTokenAddress),
            "Step 3: Engine and CDPVault should be in sync after withdrawMax"
        );
        
        // STEP 4: Test failed withdrawal - THIS IS THE CRITICAL TEST
        // log("=== BEFORE FAILED WITHDRAWAL ATTEMPT ===");
        uint256 engineCollateralBefore = cdpEngine.vaults(address(this), collateralTokenAddress).collateral;
        uint256 vaultCollateralBefore = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userBalanceBefore = ERC20(collateralTokenAddress).balanceOf(address(this));
        
        // log("Engine vault collateral BEFORE", engineCollateralBefore);
        // log("CDPVault collateral BEFORE", vaultCollateralBefore);
        // log("User balance BEFORE", userBalanceBefore);
        
        // Attempt to withdraw when at liquidation threshold (should fail)
        bool withdrawFailed = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, 1000000000); // 1 billion wei - should definitely fail
        } catch {
            withdrawFailed = true;
        }
        
        // log("=== AFTER FAILED WITHDRAWAL ATTEMPT ===");
        uint256 engineCollateralAfter = cdpEngine.vaults(address(this), collateralTokenAddress).collateral;
        uint256 vaultCollateralAfter = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userBalanceAfter = ERC20(collateralTokenAddress).balanceOf(address(this));
        
        // log("Withdrawal failed?", withdrawFailed ? "Yes" : "No");
        // log("Engine vault collateral AFTER", engineCollateralAfter);
        // log("CDPVault collateral AFTER", vaultCollateralAfter);
        // log("User balance AFTER", userBalanceAfter);
        
        // CRITICAL CHECKS: State should be unchanged after failed withdrawal
        require(withdrawFailed, "Withdrawal should have failed at liquidation threshold");
        require(
            engineCollateralBefore == engineCollateralAfter,
            "BUG: Engine vault collateral changed after failed withdrawal!"
        );
        require(
            vaultCollateralBefore == vaultCollateralAfter,
            "BUG: CDPVault collateral changed after failed withdrawal!"
        );
        require(
            userBalanceBefore == userBalanceAfter,
            "BUG: User balance changed after failed withdrawal!"
        );
        
        require(
            engineCollateralAfter == vaultCollateralAfter,
            "CRITICAL BUG: Engine and CDPVault are out of sync after failed withdrawal!"
        );
        
        // log("=== DIVERGENCE ANALYSIS ===");
        // if (engineCollateralAfter != vaultCollateralAfter) {
        //     log("DIVERGENCE DETECTED!");
        //     log("Engine shows", engineCollateralAfter);
        //     log("CDPVault shows", vaultCollateralAfter);
        //     log("Difference", engineCollateralAfter > vaultCollateralAfter ? 
        //         engineCollateralAfter - vaultCollateralAfter : 
        //         vaultCollateralAfter - engineCollateralAfter);
        // } else {
        //     log("No divergence detected - states are in sync");
        // }
        
        
    }

    function it_should_accrue_interest_with_fastForward() {
        log("=== Testing Interest Accrual with FastForward ===");
        
        // Fast forward a bit to avoid timestamp 0 issues
        fastForward(1);
        
        // Set up collateral and mint debt
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 100e18; // 100 USDST
        
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);
        
        // Get initial state
        uint256 initialScaledDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 initialRateAccumulator = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 initialLastAccrual = cdpEngine.collateralGlobalStates(collateralTokenAddress).lastAccrual;
        uint256 initialDebt = (initialScaledDebt * initialRateAccumulator) / RAY;
        
        log("Initial scaledDebt", initialScaledDebt);
        log("Initial rateAccumulator", initialRateAccumulator);
        log("Initial lastAccrual", initialLastAccrual);
        log("Initial debt (USD)", initialDebt);
        
        // Fast forward 1 year (365 days)
        uint256 secondsInYear = 365 * 24 * 60 * 60;
        uint256 timestampBefore = block.timestamp;
        fastForward(secondsInYear);
        uint256 timestampAfter = block.timestamp;
        
        log("Time before fastForward", timestampBefore);
        log("Time after fastForward", timestampAfter);
        require(timestampAfter == timestampBefore + secondsInYear, "FastForward did not work correctly");
        
        // Trigger accrual by minting a tiny amount
        cdpEngine.mint(collateralTokenAddress, 1); // 1 wei of USDST
        
        // Get state after accrual
        uint256 afterScaledDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 afterRateAccumulator = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 afterLastAccrual = cdpEngine.collateralGlobalStates(collateralTokenAddress).lastAccrual;
        uint256 debtAfterAccrual = (afterScaledDebt * afterRateAccumulator) / RAY;
        
        log("After scaledDebt", afterScaledDebt);
        log("After rateAccumulator", afterRateAccumulator);
        log("After lastAccrual timestamp", afterLastAccrual);
        log("After debt (USD)", debtAfterAccrual);
        
        // Verify interest accrued
        require(afterRateAccumulator > initialRateAccumulator, "Rate accumulator should increase");
        require(debtAfterAccrual > initialDebt + 1, "Debt should increase by more than just the 1 wei minted");
        
        // Calculate expected interest
        // With 5% APR stability fee rate
        uint256 actualInterest = debtAfterAccrual - initialDebt - 1; // Subtract the 1 wei we minted to trigger accrual
        
        log("Actual interest accrued", actualInterest);
        log("Interest rate achieved", actualInterest * 100 / debtAmount); // As percentage
        
        // Allow for some precision differences but ensure it's roughly 5%
        require(actualInterest > 45e17, "Interest should be at least 4.5 USDST"); // > 4.5%
        require(actualInterest < 55e17, "Interest should be less than 5.5 USDST"); // < 5.5%
    }

    function it_should_compound_interest_over_multiple_periods() {
        log("=== Testing Compound Interest with Multiple FastForwards ===");
        
        // Fast forward to avoid timestamp 0
        fastForward(1);
        
        // Set up initial position
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 100e18;
        
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);
        
        // Initialize lastAccrual with a small mint
        cdpEngine.mint(collateralTokenAddress, 1);
        
        uint256 initialScaledDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 initialRateAccumulator = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 initialDebt = (initialScaledDebt * initialRateAccumulator) / RAY;
        log("Initial debt", initialDebt);
        
        // Fast forward 6 months
        uint256 sixMonths = 182 * 24 * 60 * 60; // ~6 months
        fastForward(sixMonths);
        
        // Trigger accrual
        cdpEngine.mint(collateralTokenAddress, 1);
        
        uint256 midScaledDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 midRateAccumulator = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 debtAfterSixMonths = (midScaledDebt * midRateAccumulator) / RAY;
        log("Debt after 6 months", debtAfterSixMonths);
        
        // Fast forward another 6 months
        fastForward(sixMonths);
        
        // Trigger accrual again
        cdpEngine.mint(collateralTokenAddress, 1);
        
        uint256 finalScaledDebt = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 finalRateAccumulator = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 debtAfterOneYear = (finalScaledDebt * finalRateAccumulator) / RAY;
        log("Debt after 1 year (compound)", debtAfterOneYear);
        
        // Interest should compound - debt after 1 year should be more than simple interest
        // We minted: initial 1 wei + 1 wei at 6 months + 1 wei at 1 year = 3 wei total
        uint256 totalInterest = debtAfterOneYear - initialDebt - 2; // Subtract the 2 wei we minted to trigger accruals
        log("Total compound interest", totalInterest);
        
        // With 5% APR compounded, expecting slightly more than 5% due to compounding
        require(totalInterest > 48e17, "Compound interest should be significant"); // > 4.8%
        require(totalInterest < 52e17, "Compound interest too high"); // < 5.2%
    }

    function it_should_calculate_correct_repayment_after_interest() {
        log("=== Testing Repayment After Interest Accrual ===");
        
        // Fast forward to avoid timestamp 0
        fastForward(1);
        
        // Set up position
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 100e18;
        
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);
        
        // Make a small interaction to initialize lastAccrual
        cdpEngine.mint(collateralTokenAddress, 1);
        
        // Fast forward 30 days to accrue some interest
        uint256 thirtyDays = 30 * 24 * 60 * 60;
        fastForward(thirtyDays);
        
        // Trigger accrual with a small mint
        cdpEngine.mint(collateralTokenAddress, 1);
        
        // Get debt after interest accrual
        uint256 scaledDebtBefore = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 rateAccumulatorBefore = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 debtBefore = (scaledDebtBefore * rateAccumulatorBefore) / RAY;
        log("Debt after 30 days", debtBefore);
        
        // Interest for 30 days at 5% APR should be roughly 0.41% (5% / 12)
        uint256 expectedInterest = debtAmount * 41 / 10000; // ~0.41%
        log("Expected interest (rough)", expectedInterest);
        
        // Prepare to repay the exact amount owed
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), debtBefore),
            "USDST approval failed"
        );
        
        // Repay all debt
        cdpEngine.repayAll(collateralTokenAddress);
        
        // Verify debt is fully repaid
        uint256 scaledDebtAfter = cdpEngine.vaults(address(this), collateralTokenAddress).scaledDebt;
        uint256 rateAccumulatorAfter = cdpEngine.collateralGlobalStates(collateralTokenAddress).rateAccumulator;
        uint256 debtAfter = (scaledDebtAfter * rateAccumulatorAfter) / RAY;
        log("Debt after repayAll", debtAfter);
        
        require(debtAfter == 0, "Debt should be fully repaid");
        
        // Verify the correct amount was burned (principal + interest)
        uint256 totalRepaid = debtBefore;
        log("Total amount repaid", totalRepaid);
        require(totalRepaid > debtAmount, "Should have paid interest on top of principal");
    }
}
