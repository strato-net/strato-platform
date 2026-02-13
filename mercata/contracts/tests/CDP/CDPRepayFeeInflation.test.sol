// CDPRepayFeeInflation.test.sol
// ──────────────────────────────────────────────────────────────────
// Documents the repay-fee bug in CDPEngine.
//
//   repayAll fee formula:
//     baseUSD = scaledDebtToRemove    (index units, NOT USD)
//     feeUSD  = owed - baseUSD
//
//   This test runs multiple time horizons so we can see exact numbers.
// ──────────────────────────────────────────────────────────────────

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_CDPRepayFeeInflation is Authorizable {
    Mercata m;
    string[] emptyArray;

    address collateralTokenAddress;
    address usdstAddress;
    CDPEngine cdpEngine;
    CDPVault cdpVault;
    CDPRegistry cdpRegistry;
    CDPReserve cdpReserve;
    PriceOracle priceOracle;
    Token collateralToken;
    Token usdst;

    User userB;

    uint256 WAD = 1e18;
    uint256 RAY = 1e27;
    // 2 % APR
    uint256 STABILITY_FEE_RATE = RAY + ((RAY * 2) / 100 / 31536000);

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);

        userB = new User();

        cdpEngine   = m.cdpEngine();
        cdpVault    = m.cdpVault();
        cdpRegistry = m.cdpRegistry();
        cdpReserve  = m.cdpReserve();
        priceOracle = PriceOracle(address(cdpRegistry.priceOracle()));

        address mockUSDSTAddress = m.tokenFactory().createToken(
            "USDST", "USD Stablecoin Token", emptyArray, emptyArray, emptyArray,
            "USDST", 10000000000e18, 18
        );
        Token mockUSDST = Token(mockUSDSTAddress);
        mockUSDST.setStatus(2);
        mockUSDST.mint(address(this), 100000000e18);
        mockUSDST.mint(address(userB), 100000000e18);
        Ownable(address(mockUSDST)).transferOwnership(address(cdpEngine));
        cdpRegistry.setUSDST(mockUSDSTAddress);

        usdst = mockUSDST;
        usdstAddress = mockUSDSTAddress;
        priceOracle.setAssetPrice(usdstAddress, 1e18);
    }

    function beforeEach() {
        collateralTokenAddress = m.tokenFactory().createToken(
            "Collateral Token", "Test Collateral", emptyArray, emptyArray, emptyArray,
            "COLL", 10000000000e18, 18
        );
        collateralToken = Token(collateralTokenAddress);
        collateralToken.setStatus(2);
        collateralToken.mint(address(this), 100000000e18);
        collateralToken.mint(address(userB), 100000000e18);

        cdpEngine.setCollateralAssetParams(
            collateralTokenAddress,
            150e16, 160e16, 1000, 5000,
            STABILITY_FEE_RATE,
            1e18, 100000000e18, 1e18, false
        );
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPER: borrow → wait → repayAll, log everything
    // ═══════════════════════════════════════════════════════════════

    function _runScenario(
        string memory label,
        uint256 waitSeconds
    ) internal {
        log("═══════════════════════════════════════════════════");
        log(label);
        log("═══════════════════════════════════════════════════");

        // Get current rate before borrow
        (uint256 rateBefore, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);
        log("rate before borrow / RAY (x1e18)", (rateBefore * WAD) / RAY);

        // ── borrow 100k ──
        uint256 deposit   = 10000000e18;
        uint256 borrowUSD = 100000e18;

        userB.do(collateralTokenAddress, "approve", address(cdpVault), deposit);
        userB.do(address(cdpEngine), "deposit", collateralTokenAddress, deposit);

        uint256 ubBeforeMint = ERC20(usdstAddress).balanceOf(address(userB));
        userB.do(address(cdpEngine), "mint", collateralTokenAddress, borrowUSD);
        uint256 ubAfterMint = ERC20(usdstAddress).balanceOf(address(userB));

        (, uint256 scaledDebt) = cdpEngine.vaults(address(userB), collateralTokenAddress);
        (uint256 rateAtBorrow, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);

        log("rate at borrow / RAY (x1e18)", (rateAtBorrow * WAD) / RAY);
        log("principal minted (USD)      ", (ubAfterMint - ubBeforeMint) / WAD);
        log("scaledDebt (index units)    ", scaledDebt / WAD);

        // ── wait ──
        if (waitSeconds > 0) {
            fastForward(waitSeconds);
        }

        // ── snapshot fee destinations ──
        address fcAddr = address(cdpRegistry.feeCollector());
        uint256 fcBefore = ERC20(usdstAddress).balanceOf(fcAddr);
        uint256 rsBefore = ERC20(usdstAddress).balanceOf(address(cdpReserve));
        uint256 ubBefore = ERC20(usdstAddress).balanceOf(address(userB));

        // ── repayAll ──
        userB.do(usdstAddress, "approve", address(cdpEngine), 200000e18);
        userB.do(address(cdpEngine), "repayAll", collateralTokenAddress);

        uint256 fcAfter = ERC20(usdstAddress).balanceOf(fcAddr);
        uint256 rsAfter = ERC20(usdstAddress).balanceOf(address(cdpReserve));
        uint256 ubAfter = ERC20(usdstAddress).balanceOf(address(userB));

        (uint256 rateAtRepay, , ) = cdpEngine.collateralGlobalStates(collateralTokenAddress);

        uint256 burned       = ubBefore - ubAfter;
        uint256 feesToFC     = fcAfter  - fcBefore;
        uint256 feesToRS     = rsAfter  - rsBefore;
        uint256 totalFees    = feesToFC + feesToRS;

        log("── results ──");
        log("rate at repay / RAY (x1e18) ", (rateAtRepay * WAD) / RAY);
        log("USDST burned from user      ", burned    / WAD);
        log("fees minted → FeeCollector  ", feesToFC  / WAD);
        log("fees minted → CDPReserve    ", feesToRS  / WAD);
        log("TOTAL fees minted           ", totalFees / WAD);

        // expected interest = burned - principal
        if (burned > borrowUSD) {
            uint256 realInterest = burned - borrowUSD;
            log("real interest (burned-principal)", realInterest / WAD);
            if (totalFees > realInterest) {
                log("PHANTOM excess fees          ", (totalFees - realInterest) / WAD);
            } else {
                log("fees ≤ real interest (OK)     ", 0);
            }
        } else {
            log("real interest (burned-principal)", 0);
            log("PHANTOM excess fees          ", totalFees / WAD);
        }

        log("═══════════════════════════════════════════════════");
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 1 — Fresh system: borrow at rate=RAY, repay after 1 week
    //  (no prior rate growth — the baseline)
    // ═══════════════════════════════════════════════════════════════

    function it_fresh_system_borrow_repay_1_week() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);
        _runScenario("FRESH SYSTEM: borrow 100k, repay after 1 WEEK", 7 * 24 * 3600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 2 — Fresh system: borrow at rate=RAY, repay after 1 year
    // ═══════════════════════════════════════════════════════════════

    function it_fresh_system_borrow_repay_1_year() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);
        _runScenario("FRESH SYSTEM: borrow 100k, repay after 1 YEAR", 365 * 24 * 3600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 3 — System 6 months old, new user borrows, immediate repay
    // ═══════════════════════════════════════════════════════════════

    function it_6mo_system_immediate_repay() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        // Seed position so rate has been accruing for 6 months
        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(182 * 24 * 3600); // ~6 months
        cdpEngine.mint(collateralTokenAddress, 1); // trigger _accrue

        _runScenario("6-MONTH SYSTEM: borrow 100k, immediate repay", 0);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 4 — System 6 months old, new user borrows, repay after 1 week
    // ═══════════════════════════════════════════════════════════════

    function it_6mo_system_repay_1_week() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(182 * 24 * 3600);
        cdpEngine.mint(collateralTokenAddress, 1);

        _runScenario("6-MONTH SYSTEM: borrow 100k, repay after 1 WEEK", 7 * 24 * 3600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 5 — System 6 months old, new user borrows, repay after 1 year
    // ═══════════════════════════════════════════════════════════════

    function it_6mo_system_repay_1_year() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(182 * 24 * 3600);
        cdpEngine.mint(collateralTokenAddress, 1);

        _runScenario("6-MONTH SYSTEM: borrow 100k, repay after 1 YEAR", 365 * 24 * 3600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 6 — System 3 months old, immediate repay
    // ═══════════════════════════════════════════════════════════════

    function it_3mo_system_immediate_repay() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(91 * 24 * 3600); // ~3 months
        cdpEngine.mint(collateralTokenAddress, 1);

        _runScenario("3-MONTH SYSTEM: borrow 100k, immediate repay", 0);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 7 — System 3 months old, repay after 1 week
    // ═══════════════════════════════════════════════════════════════

    function it_3mo_system_repay_1_week() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(91 * 24 * 3600);
        cdpEngine.mint(collateralTokenAddress, 1);

        _runScenario("3-MONTH SYSTEM: borrow 100k, repay after 1 WEEK", 7 * 24 * 3600);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TEST 8 — System 3 months old, repay after 1 year
    // ═══════════════════════════════════════════════════════════════

    function it_3mo_system_repay_1_year() {
        fastForward(1);
        priceOracle.setAssetPrice(collateralTokenAddress, 5e18);

        uint256 seedDeposit = 50000000e18;
        ERC20(collateralTokenAddress).approve(address(cdpVault), seedDeposit);
        cdpEngine.deposit(collateralTokenAddress, seedDeposit);
        cdpEngine.mint(collateralTokenAddress, 1000000e18);

        fastForward(91 * 24 * 3600);
        cdpEngine.mint(collateralTokenAddress, 1);

        _runScenario("3-MONTH SYSTEM: borrow 100k, repay after 1 YEAR", 365 * 24 * 3600);
    }
}
