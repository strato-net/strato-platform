// SPDX-License-Identifier: MIT
import "../../concrete/BaseCodeCollection.sol";

// Per‑vault state keyed by (user, asset)
struct Vault {
    uint collateral; // raw token units
    uint scaledDebt; // index‑denominated debt
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
    uint256 STABILITY_FEE_RATE = RAY + ((RAY * 5) / 100 / 31536000); // 5% APR (365 days in seconds)
    uint256 DEBT_FLOOR = 100e18; // 100 USD minimum
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
        mockUSDST.mint(address(this), 100000e18);
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
        collateralToken.mint(address(this), 10000e18);
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
        // log("Initial CR", initialCR);
        // log("Liquidation Ratio", LIQUIDATION_RATIO);
        require(initialCR >= LIQUIDATION_RATIO, "Position should be safe initially");

        // Price crash: Drop collateral price from $5 to $1.5 (70% drop)
        uint256 currentPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 newPrice = currentPrice * 7 / 10;
        priceOracle.setAssetPrice(collateralTokenAddress, newPrice);

        // Verify position is now unsafe
        uint256 newCR = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        // log("New CR after price drop", newCR / WAD);
        require(newCR < LIQUIDATION_RATIO, "Position should be underwater after price drop");

        // Get state before liquidation
        uint256 userBDebtBefore = cdpEngine.vaults(address(userB), collateralTokenAddress).scaledDebt;
        uint256 userBCollateralBefore = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userAUSDSTBefore = ERC20(usdstAddress).balanceOf(address(userA));
        uint256 userACollateralBefore = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // UserA liquidates UserB's position
        uint256 debtToCover = 500e18; // Liquidate part of the debt
        
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
        require(userBDebtReduced <= debtToCover, "UserB debt reduction should not exceed amount covered");
        require(userBCollateralSeized == userACollateralReceived, "UserB collateral seized should equal UserA collateral received");
        
        // Calculate expected collateral seized (debt + penalty)
        uint256 penaltyAmount = (userAUSDSTBurned * LIQUIDATION_PENALTY_BPS) / 10000;
        uint256 totalRepayWithPenalty = userAUSDSTBurned + penaltyAmount;
        uint256 liquidationPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 expectedCollateralSeized = (totalRepayWithPenalty * 1e18) / liquidationPrice;
        
        require(
            userBCollateralSeized == expectedCollateralSeized,
            "UserB collateral seized should equal (debt + penalty) / price"
        );

        // log("UserB debt reduced", userBDebtReduced);
        // log("UserB collateral seized", userBCollateralSeized);
        // log("Expected collateral seized", expectedCollateralSeized);
        // log("UserA USDST burned", userAUSDSTBurned);
        // log("Penalty amount", penaltyAmount);
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

 
    
    // // ============ REGISTRY MANAGEMENT TESTS ============

    // function it_cdp_engine_can_update_registry() {
    //     address currentRegistry = address(cdpEngine.registry());
    //     require(currentRegistry != address(0), "Registry should be set");

    //     // Verify registry components are accessible
    //     require(
    //         address(cdpEngine.registry().cdpVault()) != address(0),
    //         "CDPVault should be accessible via registry"
    //     );
    //     require(
    //         address(cdpEngine.registry().usdst()) != address(0),
    //         "USDST should be accessible via registry"
    //     );
    //     require(
    //         address(cdpEngine.registry().feeCollector()) != address(0),
    //         "FeeCollector should be accessible via registry"
    //     );
    // }

    // // ============ COMPREHENSIVE WORKFLOW TESTS ============

    // function it_cdp_engine_supports_complete_lifecycle() {
    //     uint256 depositAmount = 5000e18;
    //     uint256 mintAmount = 2000e18;
    //     uint256 partialRepayAmount = 500e18;
    //     uint256 withdrawAmount = 1000e18;

    //     // 1. Deposit collateral
    //     require(
    //         ERC20(collateralTokenAddress).approve(
    //             address(cdpVault),
    //             depositAmount
    //         ),
    //         "Collateral approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, depositAmount);

    //     require(
    //         cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
    //             depositAmount,
    //         "Step 1: Collateral deposit should work"
    //     );

    //     // 2. Mint USDST
    //     uint256 initialUSDSTBalance = ERC20(usdstAddress).balanceOf(
    //         address(this)
    //     );
    //     cdpEngine.mint(collateralTokenAddress, mintAmount);

    //     uint256 afterMintBalance = ERC20(usdstAddress).balanceOf(address(this));
    //     require(
    //         afterMintBalance == initialUSDSTBalance + mintAmount,
    //         "Step 2: USDST minting should work"
    //     );

    //     // 3. Partial repayment
    //     require(
    //         ERC20(usdstAddress).approve(address(cdpEngine), partialRepayAmount),
    //         "USDST approval failed"
    //     );
    //     cdpEngine.repay(collateralTokenAddress, partialRepayAmount);

    //     // 4. Withdraw some collateral
    //     cdpEngine.withdraw(collateralTokenAddress, withdrawAmount);

    //     require(
    //         cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
    //             depositAmount - withdrawAmount,
    //         "Step 4: Collateral withdrawal should work"
    //     );

    //     // 5. Check final CR is healthy
    //     uint256 finalCR = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(
    //         finalCR > LIQUIDATION_RATIO,
    //         "Step 5: Final position should be healthy"
    //     );

    //     // 6. Final repayment
    //     require(
    //         ERC20(usdstAddress).approve(address(cdpEngine), mintAmount),
    //         "Final USDST approval failed"
    //     );
    //     cdpEngine.repayAll(collateralTokenAddress);

    //     // 7. Withdraw remaining collateral
    //     uint256 finalWithdrawAmount = cdpEngine.withdrawMax(
    //         collateralTokenAddress
    //     );
    //     require(
    //         finalWithdrawAmount > 0,
    //         "Step 7: Should be able to withdraw remaining collateral"
    //     );

    //     require(
    //         cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
    //             0,
    //         "Step 7: All collateral should be withdrawn"
    //     );
    // }

    // // ============ MULTI-ASSET TESTS ============

    // function it_cdp_engine_supports_multiple_collateral_assets() {
    //     // Create second collateral token
    //     address secondCollateralAddress = m.tokenFactory().createToken(
    //         "Second Collateral",
    //         "Test Collateral 2",
    //         emptyArray,
    //         emptyArray,
    //         emptyArray,
    //         "COLL2",
    //         10000000e18,
    //         18
    //     );
    //     Token secondCollateral = Token(secondCollateralAddress);
    //     secondCollateral.setStatus(2); // ACTIVE
    //     secondCollateral.mint(address(this), 100000000e18);

    //     // Configure second asset
    //     cdpEngine.setCollateralAssetParams(
    //         secondCollateralAddress,
    //         200e16, // 2.0 WAD (200%)
    //         1500, // 15% penalty
    //         7500, // 75% close factor
    //         RAY + ((RAY * 3) / 100 / 31536000), // 3% APR (365 days in seconds)
    //         200e18, // 200 USD floor
    //         500000e18, // 500K USD ceiling
    //         UNIT_SCALE,
    //         false
    //     );

    //     // Test operations on both assets
    //     uint256 deposit1 = 1000e18;
    //     uint256 deposit2 = 2000e18;
    //     uint256 mint1 = 500e18;
    //     uint256 mint2 = 800e18;

    //     // Asset 1 operations
    //     require(
    //         ERC20(collateralTokenAddress).approve(address(cdpVault), deposit1),
    //         "Asset 1 approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, deposit1);
    //     cdpEngine.mint(collateralTokenAddress, mint1);

    //     // Asset 2 operations
    //     require(
    //         ERC20(secondCollateralAddress).approve(address(cdpVault), deposit2),
    //         "Asset 2 approval failed"
    //     );
    //     cdpEngine.deposit(secondCollateralAddress, deposit2);
    //     cdpEngine.mint(secondCollateralAddress, mint2);

    //     // Verify both assets are supported and have collateral
    //     require(
    //         cdpEngine.isSupportedAsset(collateralTokenAddress),
    //         "Asset 1 should be supported"
    //     );
    //     require(
    //         cdpEngine.isSupportedAsset(secondCollateralAddress),
    //         "Asset 2 should be supported"
    //     );

    //     require(
    //         cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
    //             deposit1,
    //         "Asset 1 collateral should be correct"
    //     );
    //     require(
    //         cdpVault.userCollaterals(address(this), secondCollateralAddress) ==
    //             deposit2,
    //         "Asset 2 collateral should be correct"
    //     );

    //     // Verify CRs are positive for both assets
    //     uint256 cr1 = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     uint256 cr2 = cdpEngine.collateralizationRatio(
    //         address(this),
    //         secondCollateralAddress
    //     );

    //     require(cr1 > 0 && cr2 > 0, "Both assets should have positive CRs");
    //     require(
    //         cr1 != cr2,
    //         "CRs should be different due to different parameters"
    //     );
    // }

    // // ============ ACCRUAL MECHANISM TESTS ============

    // function it_cdp_engine_accrues_stability_fees_over_time() {
    //     uint256 depositAmount = 2000e18;
    //     uint256 mintAmount = 1000e18;

    //     // Setup: deposit and mint
    //     require(
    //         ERC20(collateralTokenAddress).approve(
    //             address(cdpVault),
    //             depositAmount
    //         ),
    //         "Collateral approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, depositAmount);
    //     cdpEngine.mint(collateralTokenAddress, mintAmount);

    //     // Verify the accrual mechanism is in place by checking that we have debt
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(
    //         cr > 0 && cr != 2 ** 256 - 1,
    //         "Should have finite CR indicating debt exists"
    //     );

    //     // Note: In a real test environment with time manipulation, we would:
    //     // 1. Advance time
    //     // 2. Trigger accrual (via any operation)
    //     // 3. Verify rate accumulator increased
    //     // 4. Verify debt increased proportionally
    // }
}
