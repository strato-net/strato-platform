// SPDX-License-Identifier: MIT
import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

// User contract for multi-user testing
contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_CDPEngine is Authorizable {
    // Per‑vault state keyed by (user, asset)
    struct Vault {
        uint collateral; // raw token units
        uint scaledDebt; // index‑denominated debt
    }
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
    uint256 DEBT_FLOOR = 1e18; // 1 USDST minimum
    uint256 DEBT_CEILING = 1000000e18; // 1M USD maximum
    uint256 UNIT_SCALE = 1e18; // 18 decimals

    function _openPositionForStabilityFeeMath(uint256 collateralAmount, uint256 mintAmount) internal {
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);
    }

    function beforeAll() {
        bypassAuthorizations = true;
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
            160e16, // minCR = 1.6 WAD (160%) - must be >= liquidationRatio
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

        // Test price max age configuration
        // uint initialPriceMaxAge = cdpEngine.priceMaxAge();
        // uint newPriceMaxAge = 1800; // 30 minutes in seconds

        // Test setter function
        // cdpEngine.setPriceMaxAge(newPriceMaxAge);
        // require(cdpEngine.priceMaxAge() == newPriceMaxAge, "Price max age not updated");

        // Test that price max age is updated
        // cdpEngine.setPriceMaxAge(1200);
        // require(cdpEngine.priceMaxAge() == 1200, "Price max age not updated");
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

        // Verify we're at the min collateral ratio
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        (uint256 _lr1, uint256 _minCR1, uint256 _pen1, uint256 _cf1, uint256 _sfr1, uint256 _floor1, uint256 _ceil1, uint256 _unit1, bool _pause1) = cdpEngine.collateralConfigs(collateralTokenAddress);
        require(
            cr == _minCR1,
            "CR should be equal to min collateral ratio"
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

        (uint _, uint scaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            scaledDebt == mintAmount - repayAmount,
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

        (uint collateral, uint scaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            scaledDebt == mintAmount,
            "Debt should be equal to mint amount when all debt is repaid"
        );

        require(
            collateral == depositAmount,
             "Collateral should be equal to deposit amount when all debt is repaid"
        );

        cdpEngine.repayAll(collateralTokenAddress);

        // Check CR is infinite (no debt)
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        require(cr == 2 ** 256 - 1, "CR should be max when no debt");

        (collateral, scaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            scaledDebt == 0,
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
        (uint _, uint currentDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);

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

        // Verify position is exactly at min collateral ratio (withdrew maximum possible)
        uint256 cr = cdpEngine.collateralizationRatio(
            address(this),
            collateralTokenAddress
        );
        (uint256 _lr2, uint256 _minCR2, uint256 _pen2, uint256 _cf2, uint256 _sfr2, uint256 _floor2, uint256 _ceil2, uint256 _unit2, bool _pause2) = cdpEngine.collateralConfigs(collateralTokenAddress);
        require(
            cr == _minCR2,
            "CR should equal min collateral ratio after withdrawMax (withdrew maximum safe amount)"
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

    // // ============ SUPPORTED ASSET TOGGLE TESTS ============

    function it_cdp_engine_can_toggle_supported_asset_and_block_deposit_and_mint() {
        // Initial deposit should work while supported
        uint256 initialDeposit = 500e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), initialDeposit),
            "Initial collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, initialDeposit);

        // Disable support for the asset
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // Deposit should revert when unsupported
        bool depositReverted = false;
        try {
            cdpEngine.deposit(collateralTokenAddress, 1e18);
        } catch {
            depositReverted = true;
        }
        require(depositReverted, "Deposit should be blocked when asset unsupported");

        // Mint should revert when unsupported
        bool mintReverted = false;
        try {
            cdpEngine.mint(collateralTokenAddress, 1e18);
        } catch {
            mintReverted = true;
        }
        require(mintReverted, "Mint should be blocked when asset unsupported");

        // Re-enable support and verify deposit works again
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), 1e18),
            "Re-enable: collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, 1e18);
    }

    function it_cdp_engine_toggle_supported_asset_blocks_withdraw_and_repay_until_reenabled() {
        // Setup: deposit and mint while supported
        uint256 depositAmount = 1000e18;
        uint256 mintAmount = 100e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Disable support for the asset
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // Withdraw should revert when unsupported
        bool withdrawReverted = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, 1e18);
        } catch {
            withdrawReverted = true;
        }
        require(withdrawReverted, "Withdraw should be blocked when asset unsupported");

        // Repay should revert when unsupported
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), 1e18),
            "USDST approval failed"
        );
        bool repayReverted = false;
        try {
            cdpEngine.repay(collateralTokenAddress, 1e18);
        } catch {
            repayReverted = true;
        }
        require(repayReverted, "Repay should be blocked when asset unsupported");

        // Re-enable support; operations should succeed again
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), 1e18),
            "USDST re-approval failed"
        );
        cdpEngine.repay(collateralTokenAddress, 1e18);
        cdpEngine.withdraw(collateralTokenAddress, 1e18);
    }

    function it_cdp_engine_blocks_mintMax_when_unsupported_and_allows_after_reenable() {
        // Setup: deposit while supported
        uint256 depositAmount = 2000e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Disable support
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // mintMax should revert when unsupported
        bool mintMaxReverted = false;
        try {
            cdpEngine.mintMax(collateralTokenAddress);
        } catch {
            mintMaxReverted = true;
        }
        require(mintMaxReverted, "mintMax should be blocked when asset unsupported");

        // Re-enable and verify mintMax works
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        uint256 minted = cdpEngine.mintMax(collateralTokenAddress);
        require(minted > 0, "mintMax should succeed when re-enabled");
    }

    function it_cdp_engine_blocks_withdrawMax_when_unsupported_and_allows_after_reenable() {
        // Setup: deposit while supported (no debt)
        uint256 depositAmount = 1000e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);

        // Disable support
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // withdrawMax should revert when unsupported
        bool withdrawMaxReverted = false;
        try {
            cdpEngine.withdrawMax(collateralTokenAddress);
        } catch {
            withdrawMaxReverted = true;
        }
        require(withdrawMaxReverted, "withdrawMax should be blocked when asset unsupported");

        // Re-enable and verify withdrawMax returns full deposit (no debt case)
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        uint256 withdrawn = cdpEngine.withdrawMax(collateralTokenAddress);
        require(withdrawn == depositAmount, "withdrawMax should withdraw all when re-enabled and no debt");
    }

    function it_cdp_engine_blocks_repayAll_when_unsupported_and_allows_after_reenable() {
        // Setup: deposit and mint while supported
        uint256 depositAmount = 2000e18;
        uint256 mintAmount = 1000e18;
        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), depositAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, depositAmount);
        cdpEngine.mint(collateralTokenAddress, mintAmount);

        // Disable support
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // repayAll should revert when unsupported
        bool repayAllReverted = false;
        try {
            cdpEngine.repayAll(collateralTokenAddress);
        } catch {
            repayAllReverted = true;
        }
        require(repayAllReverted, "repayAll should be blocked when asset unsupported");

        // Re-enable and verify repayAll works
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), mintAmount + 100e18),
            "USDST approval failed"
        );
        cdpEngine.repayAll(collateralTokenAddress);
        (, uint256 sdAfter) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(sdAfter == 0, "Debt should be fully repaid after re-enable");
    }

    function it_cdp_engine_blocks_liquidate_when_unsupported_and_allows_after_reenable() {
        // Setup: UserB creates a position
        uint256 depositAmount = 2000e18; // $10,000 at $5
        uint256 mintAmount = 6000e18;    // 166% CR initially
        userB.do(collateralTokenAddress, "approve", address(cdpVault), depositAmount);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, depositAmount);
        userB.do(address(cdpEngine), "mint", collateralTokenAddress, mintAmount);

        // Make the position unsafe
        uint256 currentPrice = priceOracle.getAssetPrice(collateralTokenAddress);
        uint256 newPrice = (currentPrice * 3) / 10; // drop to $1.5 (70% drop)
        priceOracle.setAssetPrice(collateralTokenAddress, newPrice);

        // Disable support
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);

        // Liquidation should revert when unsupported
        bool liquidationReverted = false;
        try {
            userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), 1000e18);
        } catch {
            liquidationReverted = true;
        }
        require(liquidationReverted, "Liquidate should be blocked when asset unsupported");

        // Re-enable and verify liquidation proceeds
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        ( , uint256 debtBefore) = cdpEngine.vaults(address(userB), collateralTokenAddress);
        userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), 1000e18);
        ( , uint256 debtAfter) = cdpEngine.vaults(address(userB), collateralTokenAddress);
        require(debtAfter < debtBefore, "Debt should decrease after liquidation when re-enabled");
    }

    function it_cdp_engine_setSupportedAsset_is_onlyOwner() {
        // Non-owner attempt should revert
        bool reverted = false;
        try {
            userA.do(address(cdpEngine), "setSupportedAsset", collateralTokenAddress, false);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-owner should not be able to setSupportedAsset");

        // Owner can call successfully
        cdpEngine.setSupportedAsset(collateralTokenAddress, false);
        require(!cdpEngine.isSupportedAsset(collateralTokenAddress), "Owner call should succeed");
        // Re-enable for cleanliness
        cdpEngine.setSupportedAsset(collateralTokenAddress, true);
        require(cdpEngine.isSupportedAsset(collateralTokenAddress), "Asset should be re-enabled");
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
        (uint _, uint userBDebtBefore) = cdpEngine.vaults(address(userB), collateralTokenAddress);
        uint256 userBCollateralBefore = cdpVault.userCollaterals(address(userB), collateralTokenAddress);
        uint256 userAUSDSTBefore = ERC20(usdstAddress).balanceOf(address(userA));
        uint256 userACollateralBefore = ERC20(collateralTokenAddress).balanceOf(address(userA));

        // UserA liquidates UserB's position
        uint256 debtToCover = 1000e18; // Liquidate part of the debt

        // UserA executes liquidation using do function
        userA.do(address(cdpEngine), "liquidate", collateralTokenAddress, address(userB), debtToCover);

        // Get state after liquidation
        (, uint userBDebtAfter) = cdpEngine.vaults(address(userB), collateralTokenAddress);
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
        (uint256 _, uint256 userBDebtInitial) = cdpEngine.vaults(address(userB), collateralTokenAddress);
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
        (, uint256 userBDebtBefore) = cdpEngine.vaults(address(userB), collateralTokenAddress);

        userB.do(address(cdpEngine), "mint", collateralTokenAddress, borrowAmount);

        uint256 userBUSDSTAfter = ERC20(usdstAddress).balanceOf(address(userB));
        (, uint256 userBDebtAfter) = cdpEngine.vaults(address(userB), collateralTokenAddress);

        require(userBUSDSTAfter == userBUSDSTBefore + borrowAmount, "UserB should receive borrowed USDST");
        require(userBDebtAfter == userBDebtBefore + borrowAmount, "UserB debt should increase by borrow amount");

        uint256 crAfterBorrow = cdpEngine.collateralizationRatio(address(userB), collateralTokenAddress);
        require(crAfterBorrow > LIQUIDATION_RATIO, "Position should be healthy after borrowing");

        uint256 expectedCR = (depositAmount * priceOracle.getAssetPrice(collateralTokenAddress)) / borrowAmount;
        require(crAfterBorrow == expectedCR, "CR should match expected calculation");

        // === PHASE 3: REPAY MAX ===
        uint256 userBUSDSTBeforeRepay = ERC20(usdstAddress).balanceOf(address(userB));
        (uint256 _4, uint256 userBDebtBeforeRepay) = cdpEngine.vaults(address(userB), collateralTokenAddress);
        uint256 userBCollateralBeforeRepay = cdpVault.userCollaterals(address(userB), collateralTokenAddress);

        require(userBDebtBeforeRepay == borrowAmount, "UserB debt should be equal to borrow amount before repayment");
        userB.do(address(cdpEngine), "repayAll", collateralTokenAddress);

        uint256 userBUSDSTAfterRepay = ERC20(usdstAddress).balanceOf(address(userB));
        (uint256 _5, uint256 userBDebtAfterRepay) = cdpEngine.vaults(address(userB), collateralTokenAddress);
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
        uint256 secondMintAmount = 1000e18;        // Additional USDST mint → $1000 total debt (10000% CR)
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

        require(crAfterSecondMint == (totalCollateralAfterSecondDeposit * currentPrice) / totalMinted, "Step 4: CR should be approximately 10000% after second mint");

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
        (uint256 _, uint256 debtAfterRepay) = cdpEngine.vaults(address(this), collateralTokenAddress);
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



        // Verify we're at min collateral ratio threshold
        (uint256 _lr1, uint256 _minCR1, uint256 _pen1, uint256 _cf1, uint256 _sfr1, uint256 _floor1, uint256 _ceil1, uint256 _unit1, bool _pause1) = cdpEngine.collateralConfigs(collateralTokenAddress);
        uint256 crAfterMaxWithdraw = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(
            crAfterMaxWithdraw >= _minCR1 &&
            crAfterMaxWithdraw <= _minCR1 + 1e15,
            "Step 8b: Should be at min collateral ratio threshold"
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
        (, uint256 debtAfterFullRepay) = cdpEngine.vaults(address(this), collateralTokenAddress);
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

        (uint256 _, uint256 debtAfterMint) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(debtAfterMint == mintAmount, "Step 2: Mint verification failed");
        // log("After mint - Debt", debtAfterMint);
        // log("After mint - Collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));

        // STEP 3: repayAll (complete debt repayment)
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), mintAmount),
            "USDST approval for repayAll failed"
        );
        cdpEngine.repayAll(collateralTokenAddress);

        (, uint256 debtAfterRepayAll) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 collateralAfterRepayAll = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        require(debtAfterRepayAll == 0, "Step 3: Debt should be 0 after repayAll");
        // log("After repayAll - Debt", debtAfterRepayAll);
        // log("After repayAll - Collateral", collateralAfterRepayAll);

        // STEP 4: withdrawMax (should withdraw almost everything)
        uint256 withdrawnAmount = cdpEngine.withdrawMax(collateralTokenAddress);

        (uint256 _3, uint256 debtAfterWithdrawMax) = cdpEngine.vaults(address(this), collateralTokenAddress);
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
        (uint256 _4, uint256 finalDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
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

        (uint256 collateral, uint256 _) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            collateral ==
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

        (collateral, _) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            collateral ==
            cdpVault.userCollaterals(address(this), collateralTokenAddress),
            "Step 2: Engine and CDPVault should be in sync after mint"
        );

        // STEP 3: Withdraw maximum safe amount to reach min collateral ratio threshold
        uint256 maxWithdrawable = cdpEngine.withdrawMax(collateralTokenAddress);
        // log("=== AFTER WITHDRAW MAX ===");
        // log("Max withdrawable", maxWithdrawable);
        // log("Engine vault collateral", cdpEngine.vaults(address(this), collateralTokenAddress).collateral);
        // log("CDPVault collateral", cdpVault.userCollaterals(address(this), collateralTokenAddress));
        // log("CR", cdpEngine.collateralizationRatio(address(this), collateralTokenAddress));

        (collateral, _) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(
            collateral ==
            cdpVault.userCollaterals(address(this), collateralTokenAddress),
            "Step 3: Engine and CDPVault should be in sync after withdrawMax"
        );

        // STEP 4: Test failed withdrawal - THIS IS THE CRITICAL TEST
        // log("=== BEFORE FAILED WITHDRAWAL ATTEMPT ===");
        (uint engineCollateralBefore,) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 vaultCollateralBefore = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userBalanceBefore = ERC20(collateralTokenAddress).balanceOf(address(this));

        // log("Engine vault collateral BEFORE", engineCollateralBefore);
        // log("CDPVault collateral BEFORE", vaultCollateralBefore);
        // log("User balance BEFORE", userBalanceBefore);

        // Attempt to withdraw when at min collateral ratio threshold (should fail)
        bool withdrawFailed = false;
        try {
            cdpEngine.withdraw(collateralTokenAddress, 1000000000); // 1 billion wei - should definitely fail
        } catch {
            withdrawFailed = true;
        }

        // log("=== AFTER FAILED WITHDRAWAL ATTEMPT ===");
        (uint engineCollateralAfter, uint _3) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 vaultCollateralAfter = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 userBalanceAfter = ERC20(collateralTokenAddress).balanceOf(address(this));

        // log("Withdrawal failed?", withdrawFailed ? "Yes" : "No");
        // log("Engine vault collateral AFTER", engineCollateralAfter);
        // log("CDPVault collateral AFTER", vaultCollateralAfter);
        // log("User balance AFTER", userBalanceAfter);

        // CRITICAL CHECKS: State should be unchanged after failed withdrawal
        require(withdrawFailed, "Withdrawal should have failed at min collateral ratio threshold");
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

    function it_cdp_engine_accrue_interest_with_fastForward() {
        // log("=== Testing Interest Accrual with FastForward ===");

        // // Fast forward a bit to avoid timestamp 0 issues
        fastForward(1);

        // Update collateral oracle price after time advancement.
        // Avoid touching USDST oracle state here due to SolidVM oracleState index instability.
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        // Set up collateral and mint debt
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 100e18; // 100 USDST

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);

        // // Get initial state
        (, uint256 initialScaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 initialRateAccumulator ,uint256 initialLastAccrual, ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 initialDebt = (initialScaledDebt * initialRateAccumulator) / RAY;

        // log("Initial scaledDebt", initialScaledDebt);
        // log("Initial rateAccumulator", initialRateAccumulator);
        // log("Initial lastAccrual", initialLastAccrual);
        // log("Initial debt (USD)", initialDebt);

        // // Fast forward 1 year (365 days)
        uint256 secondsInYear = 365 * 24 * 60 * 60;
        uint256 timestampBefore = block.timestamp;
        fastForward(secondsInYear);
        uint256 timestampAfter = block.timestamp;

        // Update collateral oracle price after time advancement.
        // Avoid touching USDST oracle state here due to SolidVM oracleState index instability.
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        // log("Time before fastForward", timestampBefore);
        // log("Time after fastForward", timestampAfter);
        require(timestampAfter == timestampBefore + secondsInYear, "FastForward did not work correctly");

        // // Trigger accrual by minting a tiny amount
        cdpEngine.mint(collateralTokenAddress, 1); // 1 wei of USDST

        // // Get state after accrual
        ( ,uint256 afterScaledDebt) =  cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 afterRateAccumulator,uint256 afterLastAccrual , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 debtAfterAccrual = (afterScaledDebt * afterRateAccumulator) / RAY;

        // log("After scaledDebt", afterScaledDebt);
        // log("After rateAccumulator", afterRateAccumulator);
        // log("After lastAccrual timestamp", afterLastAccrual);
        // log("After debt (USD)", debtAfterAccrual);

        // Verify interest accrued
        require(afterRateAccumulator > initialRateAccumulator, "Rate accumulator should increase");
        require(debtAfterAccrual > initialDebt + 1, "Debt should increase by more than just the 1 wei minted");

        // Calculate expected interest
        // With 5% APR stability fee rate
        uint256 actualInterest = debtAfterAccrual - initialDebt - 1; // Subtract the 1 wei we minted to trigger accrual

        uint interestRate = (actualInterest * 100) / debtAmount;
        // log("Actual interest accrued", actualInterest);
        // log("Interest rate achieved", interestRate); // As percentage

        require(interestRate == 5, "Interest rate should be at 5%");
    }

    function it_should_compound_interest_over_multiple_periods() {

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

        (, uint256 initialScaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 initialRateAccumulator, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 initialDebt = (initialScaledDebt * initialRateAccumulator) / RAY;
        // log("Initial scaledDebt", initialScaledDebt);
        // log("Initial debt", initialDebt);

        // Fast forward 6 months
        uint256 sixMonths = 182 * 24 * 60 * 60; // ~6 months
        fastForward(sixMonths);

        // Trigger accrual
        cdpEngine.mint(collateralTokenAddress, 1);

        ( ,uint256 midScaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 midRateAccumulator, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 debtAfterSixMonths = (midScaledDebt * midRateAccumulator) / RAY;
        // log("Debt after 6 months", debtAfterSixMonths);

        // Fast forward another 6 months
        fastForward(sixMonths);

        // Trigger accrual again
        cdpEngine.mint(collateralTokenAddress, 1);

        ( ,uint256 finalScaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 finalRateAccumulator, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 debtAfterOneYear = (finalScaledDebt * finalRateAccumulator) / RAY;
        // log("Debt after 1 year (compound)", debtAfterOneYear);

        // Interest should compound - debt after 1 year should be more than simple interest
        uint256 totalInterest = (debtAfterOneYear - initialDebt - 2) / WAD;
        // log("Total compound interest", totalInterest);

        require(totalInterest == 5, "Compound interest should be 5");
    }

    function it_should_calculate_correct_repayment_after_interest() {
        // log("=== Testing Repayment After Interest Accrual ===");

        // Fast forward to avoid timestamp 0
        fastForward(1);

        // Update oracle prices after time advancement to prevent staleness
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);
        priceOracle.setAssetPrice(usdstAddress, 1e18);

        // Set up position
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 100e18;

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);


        // Fast forward 30 days to accrue some interest
        uint256 thirtyDays = 30 * 24 * 60 * 60;
        fastForward(thirtyDays);

        // Update oracle prices after time advancement to prevent staleness
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);
        priceOracle.setAssetPrice(usdstAddress, 1e18);

        // Trigger accrual with a small mint
        cdpEngine.mint(collateralTokenAddress, 1);

        // Get debt after interest accrual
        ( ,uint256 scaledDebtBefore) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 rateAccumulatorBefore, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 debtBefore = (scaledDebtBefore * rateAccumulatorBefore) / RAY;
        // log("Debt after 30 days", debtBefore);

        // Interest for 30 days at 5% APR should be roughly 0.41% (5% / 12)
        uint256 expectedInterest = debtAmount * 41 / 10000; // ~0.41%
        // log("Expected interest (rough)", expectedInterest);
        // log("Actual interest", (debtBefore - debtAmount) * 100 / WAD);
        // log("Expected interest", expectedInterest * 100 / WAD);
        require((debtBefore - debtAmount) * 100 / WAD == (expectedInterest * 100 / WAD), "Debt after a month should be roughly 0.41%");

        // Prepare to repay the exact amount owed
        require(
            ERC20(usdstAddress).approve(address(cdpEngine), debtBefore),
            "USDST approval failed"
        );

        // Repay all debt
        cdpEngine.repayAll(collateralTokenAddress);

        // Verify debt is fully repaid
        ( ,uint256 scaledDebtAfter) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 rateAccumulatorAfter, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 debtAfter = (scaledDebtAfter * rateAccumulatorAfter) / RAY;
        // log("Debt after repayAll", debtAfter);

        require(debtAfter == 0, "Debt should be fully repaid");

        // Verify the correct amount was burned (principal + interest)
        uint256 totalRepaid = debtBefore;
        // log("Total amount repaid", totalRepaid);
        require(totalRepaid > debtAmount, "Should have paid interest on top of principal");
    }

    function it_stability_fee_manual_example_multi_step_rate_and_fee_split() {
        // Reconfigure with an intentionally simple per-second factor:
        // stabilityFeeRate = 2.0 RAY so each second doubles rateAccumulator.
        // This makes hand calculations exact and easy to verify.
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            2e27, // 2.0 RAY
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(2500); // 25% reserve, 75% collector

        // Open position: scaledDebt = 100e18 because initial rateAccumulator = 1.0 RAY
        _openPositionForStabilityFeeMath(2000e18, 100e18);

        // Snapshot baseline addresses for fee routing assertions
        address reserveAddr = address(cdpReserve);
        address collectorAddr = address(cdpRegistry.feeCollector());
        uint256 reserveBefore = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorBefore = ERC20(usdstAddress).balanceOf(collectorAddr);

        // Step 1 (dt = 1s):
        // oldRate = 1RAY, newRate = 2RAY
        // feeUSD = totalScaledDebt * (new-old)/RAY = 100 * (2-1) = 100
        fastForward(1);
        cdpEngine.repay(collateralTokenAddress, 1); // triggers _accrue, scaledDelta=0 at rate=2RAY

        (uint256 rateAfterStep1, , uint256 totalScaledAfterStep1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        require(rateAfterStep1 == 2e27, "Step1: rateAccumulator should be exactly 2.0 RAY");
        require(totalScaledAfterStep1 == 100e18, "Step1: totalScaledDebt should remain 100");

        uint256 reserveAfterStep1 = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorAfterStep1 = ERC20(usdstAddress).balanceOf(collectorAddr);
        require(reserveAfterStep1 - reserveBefore == 25e18, "Step1: reserve should receive 25");
        require(collectorAfterStep1 - collectorBefore == 75e18, "Step1: collector should receive 75");

        // Step 2 (additional dt = 2s):
        // factor = 2^2 = 4, so newRate = 2 * 4 = 8RAY
        // incremental feeUSD = 100 * (8-2) = 600
        fastForward(2);
        cdpEngine.repay(collateralTokenAddress, 1); // triggers second accrual, scaledDelta still 0

        (uint256 rateAfterStep2, , uint256 totalScaledAfterStep2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        require(rateAfterStep2 == 8e27, "Step2: rateAccumulator should be exactly 8.0 RAY");
        require(totalScaledAfterStep2 == 100e18, "Step2: totalScaledDebt should remain 100");

        uint256 reserveAfterStep2 = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorAfterStep2 = ERC20(usdstAddress).balanceOf(collectorAddr);
        require(reserveAfterStep2 - reserveAfterStep1 == 150e18, "Step2: reserve should receive 150");
        require(collectorAfterStep2 - collectorAfterStep1 == 450e18, "Step2: collector should receive 450");

        // Final debt check from manual math:
        // debtUSD = scaledDebt * rate / RAY = 100 * 8 = 800
        (, uint256 scaledDebtFinal) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 debtFinal = (scaledDebtFinal * rateAfterStep2) / RAY;
        require(debtFinal == 800e18, "Final debt should be exactly 800");
    }

    function it_stability_fee_manual_example_repay_rounding_after_accrual() {
        // Same simple factor for deterministic hand math.
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            2e27, // 2.0 RAY
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );

        _openPositionForStabilityFeeMath(2000e18, 100e18);

        // Move to rate = 8RAY (1s then 2s), keeping scaled debt unchanged at 100.
        fastForward(1);
        cdpEngine.repay(collateralTokenAddress, 1);
        fastForward(2);
        cdpEngine.repay(collateralTokenAddress, 1);

        (uint256 rateBeforeRepay, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        require(rateBeforeRepay == 8e27, "Rate before repay should be exactly 8.0 RAY");

        uint256 userBalanceBeforeRepay = ERC20(usdstAddress).balanceOf(address(this));

        // Manual repay example at rate = 8:
        // repayAmount(request) = 50e18
        // scaledDelta = floor((50e18 * RAY) / 8RAY) = 6.25e18
        // owedForDelta = (6.25e18 * 8RAY) / RAY = 50e18 (this is what burns)
        cdpEngine.repay(collateralTokenAddress, 50e18);

        uint256 userBalanceAfterRepay = ERC20(usdstAddress).balanceOf(address(this));
        require(
            userBalanceBeforeRepay - userBalanceAfterRepay == 50e18,
            "Repay burn should be exactly 50 with fixed-point scaled rounding"
        );

        (, uint256 scaledDebtAfterRepay) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(scaledDebtAfterRepay == 9375e16, "Scaled debt should be 93.75");

        // Debt after repay at unchanged rate:
        // debt = 93.75 * 8 = 750
        uint256 debtAfterRepay = (scaledDebtAfterRepay * rateBeforeRepay) / RAY;
        require(debtAfterRepay == 750e18, "Debt after rounded repay should be exactly 750");
    }

    function it_stability_fee_2pct_one_year_on_100_routes_2_to_fee_collector() {
        // Configure a simple 2% APR scenario and route all fees to FeeCollector.
        uint256 twoPctPerYear = RAY + ((RAY * 2) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            twoPctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(0);

        _openPositionForStabilityFeeMath(2000e18, 100e18);

        address collectorAddr = address(cdpRegistry.feeCollector());
        uint256 collectorBefore = ERC20(usdstAddress).balanceOf(collectorAddr);

        // Advance one year, then trigger accrual.
        fastForward(365 * 24 * 60 * 60);
        cdpEngine.repay(collateralTokenAddress, 1);

        (uint256 rateAfter, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 scaledDebtAfter) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 debtAfter = (scaledDebtAfter * rateAfter) / RAY;
        uint256 feeAccrued = debtAfter - 100e18;

        uint256 collectorAfter = ERC20(usdstAddress).balanceOf(collectorAddr);
        uint256 collectorDelta = collectorAfter - collectorBefore;

        // Exact wei value can include sub-USDST fractions; validate whole-USDST target.
        require(feeAccrued / WAD == 2, "Expected ~2 USDST fees after 1 year on 100 at 2% APR");
        require(collectorDelta / WAD == 2, "FeeCollector should receive ~2 USDST fees");
    }

    function it_stability_fee_2pct_second_borrow_after_6_months_routes_3_to_fee_collector() {
        // Scenario:
        // t0: mint 100
        // t0 + 6 months: mint another 100 (accrues first tranche for ~6 months)
        // t0 + 12 months: accrue again
        // Expected whole-fee check: ~3 USDST total routed to collector.
        uint256 twoPctPerYear = RAY + ((RAY * 2) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            twoPctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(0);

        _openPositionForStabilityFeeMath(3000e18, 100e18);

        address collectorAddr = address(cdpRegistry.feeCollector());
        uint256 collectorBefore = ERC20(usdstAddress).balanceOf(collectorAddr);

        // Half-year passes; second borrow triggers first accrual period.
        fastForward(182 * 24 * 60 * 60);
        cdpEngine.mint(collateralTokenAddress, 100e18);

        // Complete the year from initial borrow, then trigger accrual again.
        fastForward(183 * 24 * 60 * 60);
        cdpEngine.repay(collateralTokenAddress, 1);

        (uint256 rateAfter, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 scaledDebtAfter) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 debtAfter = (scaledDebtAfter * rateAfter) / RAY;
        uint256 feeAccrued = debtAfter - 200e18;

        uint256 collectorAfter = ERC20(usdstAddress).balanceOf(collectorAddr);
        uint256 collectorDelta = collectorAfter - collectorBefore;

        // Why 3 is the right validation criterion:
        // - First 100 accrues for ~1 year => ~2
        // - Second 100 accrues for ~0.5 year => ~1
        // Total whole-fee expectation => 3.
        require(feeAccrued / WAD == 3, "Expected ~3 USDST total fees in staggered-borrow scenario");
        require(collectorDelta / WAD == 3, "FeeCollector should receive ~3 USDST in staggered-borrow scenario");
    }

    function it_stability_fee_2pct_repay_50_at_6_months_tracks_fee_collector_each_accrue() {
        // Scenario (builds on scenario 1):
        // 1) Mint 100 USDST at t0
        // 2) At t0 + 6 months, call repay(50) -> triggers accrual #1
        // 3) At t0 + 12 months, trigger accrual #2
        // Assert FeeCollector balance increments exactly by feeUSD each accrual call.
        uint256 twoPctPerYear = RAY + ((RAY * 2) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            twoPctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(0); // 100% to FeeCollector for direct assertions

        _openPositionForStabilityFeeMath(2000e18, 100e18);

        address collectorAddr = address(cdpRegistry.feeCollector());
        uint256 collectorStart = ERC20(usdstAddress).balanceOf(collectorAddr);

        uint256 halfYearSeconds = 31536000 / 2;

        // ---------- Accrual #1 at 6 months ----------
        fastForward(halfYearSeconds);

        (uint256 rateBefore1, , uint256 totalScaledBefore1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);

        // repay() calls _accrue() first, then applies repayment.
        cdpEngine.repay(collateralTokenAddress, 50e18);

        (uint256 rateAfter1, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 collectorAfter1 = ERC20(usdstAddress).balanceOf(collectorAddr);
        uint256 expectedFee1 = (totalScaledBefore1 * (rateAfter1 - rateBefore1)) / RAY;

        require(
            collectorAfter1 - collectorStart == expectedFee1,
            "Accrual #1: FeeCollector delta must equal exact feeUSD"
        );

        // First 6 months on 100 at 2% APR is ~1 USDST (whole-unit expectation)
        require(
            (collectorAfter1 - collectorStart) / WAD == 1,
            "Accrual #1: expected ~1 USDST routed to FeeCollector"
        );

        // ---------- Accrual #2 at 12 months ----------
        fastForward(halfYearSeconds);

        (uint256 rateBefore2, , uint256 totalScaledBefore2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);

        // Trigger accrual again. Small repay is enough to execute _accrue().
        cdpEngine.repay(collateralTokenAddress, 1);

        (uint256 rateAfter2, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 collectorAfter2 = ERC20(usdstAddress).balanceOf(collectorAddr);
        uint256 expectedFee2 = (totalScaledBefore2 * (rateAfter2 - rateBefore2)) / RAY;

        require(
            collectorAfter2 - collectorAfter1 == expectedFee2,
            "Accrual #2: FeeCollector delta must equal exact feeUSD"
        );

        // After repaying 50 at mid-year, second-half fees are ~0.5 USDST.
        // So cumulative collector after both accruals is ~1.5 USDST.
        uint256 collectorTotalDelta = collectorAfter2 - collectorStart;
        require(
            collectorTotalDelta >= 15e17 && collectorTotalDelta < 16e17,
            "Cumulative collector fees should be ~1.5 USDST after 1 year with mid-year repay"
        );
    }

    function it_stability_fee_ugly_numbers_single_accrue_exact_split() {
        // Stress rounding with ugly principal + ugly dt + uneven split.
        uint256 sevenPctPerYear = RAY + ((RAY * 7) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            sevenPctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(3333); // intentionally uneven split

        uint256 uglyMint = 1234567891234567890123; // 1234.567891234567890123
        _openPositionForStabilityFeeMath(2000e18, uglyMint);

        address reserveAddr = address(cdpReserve);
        address collectorAddr = address(cdpRegistry.feeCollector());

        uint256 reserveBefore = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorBefore = ERC20(usdstAddress).balanceOf(collectorAddr);

        uint256 uglyDt = 1234567;
        fastForward(uglyDt);

        (uint256 rateBefore, , uint256 totalScaledBefore) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.repay(collateralTokenAddress, 1); // trigger accrue
        (uint256 rateAfter, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);

        uint256 feeUSD = (totalScaledBefore * (rateAfter - rateBefore)) / RAY;
        uint256 expectedReserve = (feeUSD * 3333) / 10000;
        uint256 expectedCollector = feeUSD - expectedReserve;

        uint256 reserveAfter = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorAfter = ERC20(usdstAddress).balanceOf(collectorAddr);

        require(
            reserveAfter - reserveBefore == expectedReserve,
            "Ugly single accrue: reserve routing mismatch"
        );
        require(
            collectorAfter - collectorBefore == expectedCollector,
            "Ugly single accrue: collector routing mismatch"
        );
    }

    function it_stability_fee_ugly_numbers_mid_repay_rounding_and_second_accrue() {
        // Stress odd repayment amount and verify exact burn + per-accrual fee routing.
        uint256 threePctPerYear = RAY + ((RAY * 3) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            threePctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(0); // all fees to collector for simpler assertions

        uint256 uglyMint = 987654321987654321000; // 987.654321987654321
        _openPositionForStabilityFeeMath(2000e18, uglyMint);

        address collectorAddr = address(cdpRegistry.feeCollector());
        uint256 collectorStart = ERC20(usdstAddress).balanceOf(collectorAddr);

        // Accrual #1, then repay an ugly amount.
        fastForward(1111111);
        (uint256 rateBefore1, , uint256 totalScaledBefore1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledBefore1) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 userBalanceBeforeRepay = ERC20(usdstAddress).balanceOf(address(this));

        uint256 uglyRepayRequest = 123456789012345678901; // 123.456789012345678901
        cdpEngine.repay(collateralTokenAddress, uglyRepayRequest);

        (uint256 rateAfter1, , uint256 totalScaledAfter1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledAfter1) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 collectorAfter1 = ERC20(usdstAddress).balanceOf(collectorAddr);
        uint256 userBalanceAfterRepay = ERC20(usdstAddress).balanceOf(address(this));

        uint256 expectedFee1 = (totalScaledBefore1 * (rateAfter1 - rateBefore1)) / RAY;
        require(
            collectorAfter1 - collectorStart == expectedFee1,
            "Ugly repay: accrual #1 collector routing mismatch"
        );

        uint256 expectedScaledDelta = (uglyRepayRequest * RAY) / rateAfter1;
        if (expectedScaledDelta > userScaledBefore1) expectedScaledDelta = userScaledBefore1;
        uint256 expectedBurn = (expectedScaledDelta * rateAfter1) / RAY;

        require(
            userBalanceBeforeRepay - userBalanceAfterRepay == expectedBurn,
            "Ugly repay: burn amount mismatch"
        );
        require(
            userScaledBefore1 - userScaledAfter1 == expectedScaledDelta,
            "Ugly repay: scaledDebt delta mismatch"
        );
        require(
            totalScaledBefore1 - totalScaledAfter1 == expectedScaledDelta,
            "Ugly repay: totalScaledDebt delta mismatch"
        );

        // Accrual #2 with updated (post-repay) scaled debt.
        fastForward(777777);
        (uint256 rateBefore2, , uint256 totalScaledBefore2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.repay(collateralTokenAddress, 1);
        (uint256 rateAfter2, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 collectorAfter2 = ERC20(usdstAddress).balanceOf(collectorAddr);

        uint256 expectedFee2 = (totalScaledBefore2 * (rateAfter2 - rateBefore2)) / RAY;
        require(
            collectorAfter2 - collectorAfter1 == expectedFee2,
            "Ugly repay: accrual #2 collector routing mismatch"
        );
    }

    function it_stability_fee_ugly_numbers_two_step_split_with_exact_running_balances() {
        // Verify running reserve/collector balances over two odd accrual windows.
        uint256 elevenPctPerYear = RAY + ((RAY * 11) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            elevenPctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(2718); // odd split percent

        uint256 uglyMint = 432109876543210987654; // 432.109876543210987654
        _openPositionForStabilityFeeMath(2000e18, uglyMint);

        address reserveAddr = address(cdpReserve);
        address collectorAddr = address(cdpRegistry.feeCollector());

        uint256 reserveStart = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorStart = ERC20(usdstAddress).balanceOf(collectorAddr);

        // Window #1
        fastForward(246813);
        (uint256 rateBefore1, , uint256 totalScaledBefore1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.repay(collateralTokenAddress, 1);
        (uint256 rateAfter1, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);

        uint256 fee1 = (totalScaledBefore1 * (rateAfter1 - rateBefore1)) / RAY;
        uint256 reserveExp1 = (fee1 * 2718) / 10000;
        uint256 collectorExp1 = fee1 - reserveExp1;

        uint256 reserveAfter1 = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorAfter1 = ERC20(usdstAddress).balanceOf(collectorAddr);
        require(reserveAfter1 == reserveStart + reserveExp1, "Ugly two-step: reserve after #1 mismatch");
        require(collectorAfter1 == collectorStart + collectorExp1, "Ugly two-step: collector after #1 mismatch");

        // Window #2
        fastForward(135791);
        (uint256 rateBefore2, , uint256 totalScaledBefore2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.repay(collateralTokenAddress, 1);
        (uint256 rateAfter2, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);

        uint256 fee2 = (totalScaledBefore2 * (rateAfter2 - rateBefore2)) / RAY;
        uint256 reserveExp2 = (fee2 * 2718) / 10000;
        uint256 collectorExp2 = fee2 - reserveExp2;

        uint256 reserveAfter2 = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorAfter2 = ERC20(usdstAddress).balanceOf(collectorAddr);
        require(
            reserveAfter2 == reserveStart + reserveExp1 + reserveExp2,
            "Ugly two-step: reserve running balance mismatch"
        );
        require(
            collectorAfter2 == collectorStart + collectorExp1 + collectorExp2,
            "Ugly two-step: collector running balance mismatch"
        );
    }

    function it_stability_fee_ugly_numbers_multiple_mints_and_repays() {
        // Multi-step stress case: ugly mints + ugly repays + odd time windows.
        uint256 ninePctPerYear = RAY + ((RAY * 9) / 100 / 31536000);
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            LIQUIDATION_RATIO,
            160e16,
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            ninePctPerYear,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );
        cdpEngine.setFeeToReserveBps(2468); // ugly split

        // Keep collateral value comfortably above borrow cap.
        uint256 initialMint = 1234567891234567890123;
        _openPositionForStabilityFeeMath(10000e18, initialMint);

        address reserveAddr = address(cdpReserve);
        address collectorAddr = address(cdpRegistry.feeCollector());

        uint256 reserveRunning = ERC20(usdstAddress).balanceOf(reserveAddr);
        uint256 collectorRunning = ERC20(usdstAddress).balanceOf(collectorAddr);

        // -------- Step 1: mint ugly #2 (accrual first) --------
        uint256 mint2 = 2345678912345678901234;
        fastForward(987654);
        (uint256 rateBefore1, , uint256 totalScaledBefore1) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.mint(collateralTokenAddress, mint2);
        (uint256 rateAfter1, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 fee1 = (totalScaledBefore1 * (rateAfter1 - rateBefore1)) / RAY;
        uint256 reserveExp1 = (fee1 * 2468) / 10000;
        uint256 collectorExp1 = fee1 - reserveExp1;
        reserveRunning += reserveExp1;
        collectorRunning += collectorExp1;
        require(
            ERC20(usdstAddress).balanceOf(reserveAddr) == reserveRunning,
            "Multi ugly step1: reserve mismatch"
        );
        require(
            ERC20(usdstAddress).balanceOf(collectorAddr) == collectorRunning,
            "Multi ugly step1: collector mismatch"
        );

        // -------- Step 2: repay ugly #1 (accrual first + rounding-aware burn) --------
        uint256 repay1 = 456789123456789012345;
        fastForward(543210);
        (uint256 rateBefore2, , uint256 totalScaledBefore2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledBefore2) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 userUSDSTBefore2 = ERC20(usdstAddress).balanceOf(address(this));

        cdpEngine.repay(collateralTokenAddress, repay1);

        (uint256 rateAfter2, , uint256 totalScaledAfter2) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledAfter2) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 userUSDSTAfter2 = ERC20(usdstAddress).balanceOf(address(this));

        uint256 fee2 = (totalScaledBefore2 * (rateAfter2 - rateBefore2)) / RAY;
        uint256 reserveExp2 = (fee2 * 2468) / 10000;
        uint256 collectorExp2 = fee2 - reserveExp2;
        reserveRunning += reserveExp2;
        collectorRunning += collectorExp2;
        require(
            ERC20(usdstAddress).balanceOf(reserveAddr) == reserveRunning,
            "Multi ugly step2: reserve mismatch"
        );
        require(
            ERC20(usdstAddress).balanceOf(collectorAddr) == collectorRunning,
            "Multi ugly step2: collector mismatch"
        );

        uint256 expectedScaledDelta2 = (repay1 * RAY) / rateAfter2;
        if (expectedScaledDelta2 > userScaledBefore2) expectedScaledDelta2 = userScaledBefore2;
        uint256 expectedBurn2 = (expectedScaledDelta2 * rateAfter2) / RAY;
        require(userUSDSTBefore2 - userUSDSTAfter2 == expectedBurn2, "Multi ugly step2: burn mismatch");
        require(userScaledBefore2 - userScaledAfter2 == expectedScaledDelta2, "Multi ugly step2: user scaled delta mismatch");
        require(totalScaledBefore2 - totalScaledAfter2 == expectedScaledDelta2, "Multi ugly step2: total scaled delta mismatch");

        // -------- Step 3: mint ugly #3 (accrual first) --------
        uint256 mint3 = 345678912345678901234;
        fastForward(246801);
        (uint256 rateBefore3, , uint256 totalScaledBefore3) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        cdpEngine.mint(collateralTokenAddress, mint3);
        (uint256 rateAfter3, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 fee3 = (totalScaledBefore3 * (rateAfter3 - rateBefore3)) / RAY;
        uint256 reserveExp3 = (fee3 * 2468) / 10000;
        uint256 collectorExp3 = fee3 - reserveExp3;
        reserveRunning += reserveExp3;
        collectorRunning += collectorExp3;
        require(
            ERC20(usdstAddress).balanceOf(reserveAddr) == reserveRunning,
            "Multi ugly step3: reserve mismatch"
        );
        require(
            ERC20(usdstAddress).balanceOf(collectorAddr) == collectorRunning,
            "Multi ugly step3: collector mismatch"
        );

        // -------- Step 4: repay ugly #2 (accrual first + rounding-aware burn) --------
        uint256 repay2 = 321098765432109876543;
        fastForward(135792);
        (uint256 rateBefore4, , uint256 totalScaledBefore4) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledBefore4) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 userUSDSTBefore4 = ERC20(usdstAddress).balanceOf(address(this));

        cdpEngine.repay(collateralTokenAddress, repay2);

        (uint256 rateAfter4, , uint256 totalScaledAfter4) =
            cdpEngine.collateralGlobalStates(collateralTokenAddress);
        (, uint256 userScaledAfter4) = cdpEngine.vaults(address(this), collateralTokenAddress);
        uint256 userUSDSTAfter4 = ERC20(usdstAddress).balanceOf(address(this));

        uint256 fee4 = (totalScaledBefore4 * (rateAfter4 - rateBefore4)) / RAY;
        uint256 reserveExp4 = (fee4 * 2468) / 10000;
        uint256 collectorExp4 = fee4 - reserveExp4;
        reserveRunning += reserveExp4;
        collectorRunning += collectorExp4;
        require(
            ERC20(usdstAddress).balanceOf(reserveAddr) == reserveRunning,
            "Multi ugly step4: reserve mismatch"
        );
        require(
            ERC20(usdstAddress).balanceOf(collectorAddr) == collectorRunning,
            "Multi ugly step4: collector mismatch"
        );

        uint256 expectedScaledDelta4 = (repay2 * RAY) / rateAfter4;
        if (expectedScaledDelta4 > userScaledBefore4) expectedScaledDelta4 = userScaledBefore4;
        uint256 expectedBurn4 = (expectedScaledDelta4 * rateAfter4) / RAY;
        require(userUSDSTBefore4 - userUSDSTAfter4 == expectedBurn4, "Multi ugly step4: burn mismatch");
        require(userScaledBefore4 - userScaledAfter4 == expectedScaledDelta4, "Multi ugly step4: user scaled delta mismatch");
        require(totalScaledBefore4 - totalScaledAfter4 == expectedScaledDelta4, "Multi ugly step4: total scaled delta mismatch");
    }

    // function it_cdp_engine_reverts_mint_with_stale_prices() {
    //     // Set up collateral
    //     uint256 collateralAmount = 1000e18;
    //     require(
    //         ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
    //         "Collateral approval failed"
    //     );
    //     cdpEngine.deposit(collateralTokenAddress, collateralAmount);

    //     // Set initial price
    //     priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

    //     // Advance time beyond the staleness threshold (25 minutes > 20 minutes)
    //     fastForward(1500); // 25 minutes

    //     // Try to mint without updating prices - should fail due to stale price
    //     bool reverted = false;
    //     try cdpEngine.mint(collateralTokenAddress, 100e18) {
    //         // Should not reach here
    //     } catch {
    //         reverted = true;
    //     }
    //     require(reverted, "Mint should revert with stale prices");
    // }

    // ============ MIN COLLATERAL RATIO TESTS ============

    function it_cdp_engine_enforces_min_collateral_ratio_on_withdraw() {
        // Set up position with debt
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 200e18; // This will create a CR of 250% (1000*5/200 = 25), above minCR of 160%

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);

        // Try to withdraw too much collateral that would bring CR below minCR
        // Current CR = 1000*5/200 = 2500% (25x)
        // To get CR = 160%, we need: collateralValue/debt = 1.6
        // So: (collateral * 5) / 200 = 1.6 => collateral = 64
        // We can withdraw up to 1000 - 64 = 936 tokens safely
        // Let's try to withdraw 940 tokens (should fail)

        bool reverted = false;
        try cdpEngine.withdraw(collateralTokenAddress, 940e18) {
            // Should not reach here
        } catch {
            reverted = true;
        }
        require(reverted, "Withdraw should revert when CR would fall below minCR");

        // Try to withdraw 935 tokens (should succeed)
        cdpEngine.withdraw(collateralTokenAddress, 935e18);

        // Verify the withdrawal succeeded
        (uint256 collateralAfter, ) = cdpEngine.vaults(address(this), collateralTokenAddress);
        require(collateralAfter == 65e18, "Should have withdrawn 935 tokens, leaving 65");
    }

    function it_cdp_engine_enforces_min_collateral_ratio_on_mint() {
        // Set up position with some debt
        uint256 collateralAmount = 1000e18;
        uint256 initialDebt = 200e18;

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, initialDebt);

        // Try to mint more debt that would bring CR below minCR
        // Current CR = 1000*5/200 = 2500% (25x)
        // To get CR = 160%, we need: collateralValue/debt = 1.6
        // So: 5000 / debt = 1.6 => debt = 3125
        // We can mint up to 3125 - 200 = 2925 more tokens safely
        // Let's try to mint 3000 tokens (should fail)

        bool reverted = false;
        try cdpEngine.mint(collateralTokenAddress, 3000e18) {
            // Should not reach here
        } catch {
            reverted = true;
        }
        require(reverted, "Mint should revert when CR would fall below minCR");

        // Try to mint 2900 tokens (should succeed)
        cdpEngine.mint(collateralTokenAddress, 2900e18);

        // Verify the mint succeeded
        (, uint256 scaledDebtAfter) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 rateAccumulator, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 totalDebt = (scaledDebtAfter * rateAccumulator) / RAY;
        require(totalDebt == initialDebt + 2900e18, "Should have minted 2900 additional tokens");
    }

    function it_cdp_engine_withdraw_max_respects_min_collateral_ratio() {
        // Set up position with debt
        uint256 collateralAmount = 1000e18;
        uint256 debtAmount = 200e18;

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, debtAmount);

        // Debug: Check actual debt and CR before withdrawMax
        (, uint256 scaledDebt) = cdpEngine.vaults(address(this), collateralTokenAddress);
        (uint256 rateAccumulator, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        uint256 actualDebt = (scaledDebt * rateAccumulator) / RAY;
        uint256 actualCR = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        uint256 collateralInVault = cdpVault.userCollaterals(address(this), collateralTokenAddress);
        uint256 price = priceOracle.getAssetPrice(collateralTokenAddress);
        // log("Actual debt", actualDebt);
        // log("Actual CR", actualCR);
        // log("Collateral in vault", collateralInVault);
        // log("Price", price);

        // Test withdrawMax - should only allow withdrawal that keeps CR >= minCR
        uint256 maxWithdrawable = cdpEngine.withdrawMax(collateralTokenAddress);

        // Debug: Let's see what we actually get
        // log("Actual maxWithdrawable", maxWithdrawable);
        // log("Expected maxWithdrawable", 935e18);

        // Calculate expected max withdrawal
        // To keep CR >= 160%, we need: collateralValue/debt >= 1.6
        // So: (collateral * 5) / debt >= 1.6 => collateral >= debt * 1.6 / 5
        // We can withdraw up to 1000 - requiredCollateral - 1 tokens (1-wei buffer)
        // Due to potential interest accrual, allow some tolerance
        require(maxWithdrawable >= 930e18 && maxWithdrawable <= 940e18, "Max withdrawal should respect minCR constraint");

        // Verify that after withdrawal, CR is still >= minCR
        // Note: withdrawMax() already performs the withdrawal internally, so we just need to check the final state
        (uint256 _lr2, uint256 _minCR2, uint256 _pen2, uint256 _cf2, uint256 _sfr2, uint256 _floor2, uint256 _ceil2, uint256 _unit2, bool _pause2) = cdpEngine.collateralConfigs(collateralTokenAddress);
        uint256 cr = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(cr >= _minCR2, "CR should be >= minCR after max withdrawal");
    }

    function it_cdp_engine_mint_max_respects_min_collateral_ratio() {
        // Set up position with some debt
        uint256 collateralAmount = 1000e18;
        uint256 initialDebt = 200e18;

        require(
            ERC20(collateralTokenAddress).approve(address(cdpVault), collateralAmount),
            "Collateral approval failed"
        );
        cdpEngine.deposit(collateralTokenAddress, collateralAmount);
        cdpEngine.mint(collateralTokenAddress, initialDebt);

        // Test mintMax - should only allow minting that keeps CR >= minCR
        uint256 maxMintable = cdpEngine.mintMax(collateralTokenAddress);

        // Calculate expected max mint
        // To keep CR >= 160%, we need: collateralValue/debt >= 1.6
        // So: 5000 / (currentDebt + mint) >= 1.6 => currentDebt + mint <= 3125 => mint <= 3125 - currentDebt
        // With 1-wei buffer: mint <= (3125 - currentDebt) - 1
        // Due to potential interest accrual, allow some tolerance
        require(maxMintable >= 2900e18 && maxMintable <= 2930e18, "Max mint should respect minCR constraint");

        // Verify that after minting, CR is still >= minCR
        // Note: mintMax() already performs the minting internally, so we just need to check the final state
        (uint256 _lr3, uint256 _minCR3, uint256 _pen3, uint256 _cf3, uint256 _sfr3, uint256 _floor3, uint256 _ceil3, uint256 _unit3, bool _pause3) = cdpEngine.collateralConfigs(collateralTokenAddress);
        uint256 cr = cdpEngine.collateralizationRatio(address(this), collateralTokenAddress);
        require(cr >= _minCR3, "CR should be >= minCR after max mint");
    }

    function it_cdp_engine_validates_min_collateral_ratio_parameter() {
        // Test that minCR must be >= liquidationRatio
        bool reverted = false;
        try cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            150e16, // 150% liquidation ratio
            140e16, // 140% minCR (invalid - less than liquidation ratio)
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            STABILITY_FEE_RATE,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        ) {
            // Should not reach here
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject minCR < liquidationRatio");

        // Test that minCR can equal liquidationRatio
        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            150e16, // 150% liquidation ratio
            150e16, // 150% minCR (valid - equal to liquidation ratio)
            LIQUIDATION_PENALTY_BPS,
            CLOSE_FACTOR_BPS,
            STABILITY_FEE_RATE,
            DEBT_FLOOR,
            DEBT_CEILING,
            UNIT_SCALE,
            false
        );

        // Verify the configuration was set correctly
        (uint256 liquidationRatio, uint256 minCR, , , , , , , ) = cdpEngine.collateralConfigs(collateralTokenAddress);
        require(minCR == 150e16, "minCR should be set to 150%");
        require(liquidationRatio == 150e16, "liquidationRatio should be set to 150%");
    }
}
