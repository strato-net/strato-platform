// SPDX-License-Identifier: MIT
import "../../concrete/BaseCodeCollection.sol";

// Per‑vault state keyed by (user, asset)
struct Vault {
    uint collateral;  // raw token units
    uint scaledDebt;  // index‑denominated debt
}

contract Describe_CDPEngine  {
    Mercata m;
    string[] emptyArray;

    // Test addresses and contracts
    address collateralTokenAddress;
    address usdstAddress;
    CDPEngine cdpEngine;
    CDPVault cdpVault;
    CDPRegistry cdpRegistry;
    CDPReserve cdpReserve;
    Token collateralToken;
    Token usdst;

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

        // Get CDP components
        cdpEngine = m.cdpEngine();
        cdpVault = m.cdpVault();
        cdpRegistry = m.cdpRegistry();
        cdpReserve = m.cdpReserve();

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

        // Grant CDPEngine mint and burn access to the mock USDST
        // Since Token uses onlyOwner for mint/burn, we transfer ownership to CDPEngine
        Ownable(address(mockUSDST)).transferOwnership(address(cdpEngine));

        // Update the registry to use our mock USDST instead of hardcoded address
        cdpRegistry.setUSDST(mockUSDSTAddress);

        // Set up our test references
        usdst = mockUSDST;
        usdstAddress = mockUSDSTAddress;

        // Set up price oracle
        PriceOracle priceOracle = PriceOracle(
            address(cdpRegistry.priceOracle())
        );
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

        // Mint collateral tokens to test contract
        collateralToken.mint(address(this), 10000e18);

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
        PriceOracle priceOracle = PriceOracle(
            address(cdpRegistry.priceOracle())
        );
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
        uint256 depositAmount = 2000e18; // $10000 worth at $1 price
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
        uint256 initialUSDSTBalance = ERC20(usdstAddress).balanceOf(address(this));
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

    // function it_cdp_engine_can_repay_all_debt() {
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

    //     // Approve enough for repayment including potential fees
    //     require(
    //         ERC20(usdstAddress).approve(
    //             address(cdpEngine),
    //             mintAmount + 100e18
    //         ),
    //         "USDST approval failed"
    //     );
    //     cdpEngine.repayAll(collateralTokenAddress);

    //     // Check CR is infinite (no debt)
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(cr == 2 ** 256 - 1, "CR should be max when no debt");
    // }

    // // ============ COLLATERALIZATION RATIO TESTS ============

    // function it_cdp_engine_calculates_collateralization_ratio() {
    //     uint256 depositAmount = 3000e18; // $3000 at $1 price
    //     uint256 mintAmount = 1500e18; // $1500 debt

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

    //     // Check CR
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );

    //     // Expected CR = 3000 / 1500 = 2.0 = 200% = 2e18 WAD
    //     require(
    //         cr >= 190e16 && cr <= 210e16,
    //         "CR should be approximately 200%"
    //     ); // Allow some variance for fees
    // }

    // function it_cdp_engine_returns_max_cr_when_no_debt() {
    //     uint256 depositAmount = 1000e18;

    //     // Deposit without minting
    //     require(
    //         ERC20(collateralTokenAddress).approve(
    //             address(cdpVault),
    //             depositAmount
    //         ),
    //         "Collateral approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, depositAmount);

    //     // Check CR (should be max uint when no debt)
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(cr == 2 ** 256 - 1, "CR should be max when no debt");
    // }

    // // ============ WITHDRAWAL WITH DEBT TESTS ============

    // function it_cdp_engine_prevents_unsafe_withdrawal() {
    //     uint256 depositAmount = 2000e18;
    //     uint256 mintAmount = 1200e18; // Close to liquidation threshold

    //     // Setup: deposit and mint to get close to liquidation ratio
    //     require(
    //         ERC20(collateralTokenAddress).approve(
    //             address(cdpVault),
    //             depositAmount
    //         ),
    //         "Collateral approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, depositAmount);
    //     cdpEngine.mint(collateralTokenAddress, mintAmount);

    //     // Verify position is currently safe
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(cr > LIQUIDATION_RATIO, "Position should be safe initially");

    //     // Test a safe withdrawal
    //     uint256 safeWithdrawAmount = 100e18;
    //     cdpEngine.withdraw(collateralTokenAddress, safeWithdrawAmount);

    //     // Verify withdrawal worked
    //     require(
    //         cdpVault.userCollaterals(address(this), collateralTokenAddress) ==
    //             depositAmount - safeWithdrawAmount,
    //         "Safe withdrawal should work"
    //     );
    // }

    // function it_cdp_engine_withdraw_max_with_debt_respects_liquidation_ratio() {
    //     uint256 depositAmount = 3000e18;
    //     uint256 mintAmount = 1500e18;

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

    //     // Withdraw max
    //     uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);

    //     require(
    //         withdrawnAmount > 0,
    //         "Should be able to withdraw some collateral"
    //     );
    //     require(
    //         withdrawnAmount < depositAmount,
    //         "Should not withdraw all collateral when debt exists"
    //     );

    //     // Verify position is still safe
    //     uint256 cr = cdpEngine.collateralizationRatio(
    //         address(this),
    //         collateralTokenAddress
    //     );
    //     require(
    //         cr >= LIQUIDATION_RATIO,
    //         "CR should be at or above liquidation ratio after withdrawMax"
    //     );
    // }

    // // ============ PAUSE FUNCTIONALITY TESTS ============

    // function it_cdp_engine_can_pause_asset() {
    //     // Pause the asset
    //     cdpEngine.setPaused(collateralTokenAddress, true);

    //     // Verify the pause function exists and works
    //     require(
    //         address(cdpEngine) != address(0),
    //         "CDPEngine should exist for pause functionality"
    //     );
    // }

    // function it_cdp_engine_can_pause_globally() {
    //     // Pause globally
    //     cdpEngine.setPausedGlobal(true);

    //     // Check global pause
    //     require(cdpEngine.globalPaused(), "Engine should be globally paused");

    //     // Unpause for other tests
    //     cdpEngine.setPausedGlobal(false);
    //     require(!cdpEngine.globalPaused(), "Engine should be unpaused");
    // }

    // // ============ FEE ROUTING TESTS ============

    // function it_cdp_engine_can_set_fee_to_reserve_bps() {
    //     uint256 newFeeBps = 3000; // 30% to reserve

    //     // Set fee routing
    //     cdpEngine.setFeeToReserveBps(newFeeBps);

    //     // Verify setting
    //     require(
    //         cdpEngine.feeToReserveBps() == newFeeBps,
    //         "Fee to reserve BPS should be updated"
    //     );
    // }

    // // ============ BAD DEBT AND JUNIOR NOTE TESTS ============

    // function it_cdp_engine_can_set_junior_premium() {
    //     uint256 newPremiumBps = 1500; // 15% premium

    //     // Set junior premium
    //     cdpEngine.setJuniorPremium(newPremiumBps);

    //     // Verify setting
    //     require(
    //         cdpEngine.juniorPremiumBps() == newPremiumBps,
    //         "Junior premium BPS should be updated"
    //     );
    // }

    // function it_cdp_engine_tracks_bad_debt() {
    //     // Initially no bad debt
    //     require(
    //         cdpEngine.badDebtUSDST(collateralTokenAddress) == 0,
    //         "Should have no bad debt initially"
    //     );

    //     // Bad debt would be created through liquidations in real scenarios
    //     // For testing, we verify the tracking mechanism exists
    // }

    // function it_cdp_engine_can_view_claimable_junior_amounts() {
    //     // Initially no junior notes
    //     uint256 claimable = cdpEngine.claimable(address(this));
    //     require(claimable == 0, "Should have no claimable amount initially");
    // }

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
