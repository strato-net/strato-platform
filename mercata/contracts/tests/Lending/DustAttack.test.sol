// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../Util.sol";

/**
 * @title Dust Borrow Attack Prevention Tests
 * @notice Tests demonstrating ceiling division prevents dust borrow attacks
 * @dev A dust borrow attack attempts to exploit rounding errors when borrowing tiny amounts (e.g., 1 wei).
 *      Without ceiling division, an attacker could borrow amounts that round down to zero scaled debt,
 *      effectively getting free loans. Ceiling division ensures scaledDebt is always at least 1,
 *      preventing the protocol from being shortchanged even in extreme edge cases where borrowing
 *      1 wei may result in owing 2 wei due to high interest accrual.
 */
contract Describe_DustAttack is Authorizable {
    using TestUtils for User;

    struct LoanInfo {
        uint scaledDebt;
        uint lastUpdated;
    }

    constructor() {
        bypassAuthorizations = true;
    }

    // Test infrastructure (created fresh in beforeEach)
    Mercata m;
    LendingPool pool;
    CollateralVault vault;
    LiquidityPool liquidity;
    PoolConfigurator configurator;
    PriceOracle oracle;
    AdminRegistry adminRegistry;

    // Tokens (created fresh in beforeEach)
    address usdst;
    address musdst;
    address goldst;

    // Test users (created once in beforeAll)
    User user1;
    User user2;

    // Constants
    uint INFINITY = 2 ** 256 - 1;
    uint RAY = 1e27;

    // Interest rate constants (per-second compound factors in RAY)
    uint APY_5_PERCENT = 1000000001547125956666413085;   // ~5% APY
    uint APY_10_PERCENT = 1000000003022265980097387650;  // ~10% APY

    function beforeAll() public {
        // Create test users once (can be reused across tests)
        user1 = new User();
        user2 = new User();
    }

    /**
     * @notice Setup function to create a fresh test environment with configurable APY
     * @param perSecondFactorRAY The per-second compound factor in RAY (1e27) for the borrowable asset
     *        Use APY_5_PERCENT or APY_10_PERCENT constants defined above
     */
    function setup(uint perSecondFactorRAY) internal {
        // Create fresh Mercata infrastructure
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        pool = m.lendingPool();
        vault = m.collateralVault();
        liquidity = m.liquidityPool();
        configurator = m.poolConfigurator();
        oracle = m.priceOracle();
        adminRegistry = m.adminRegistry();

        // Create tokens
        usdst = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        musdst = m.tokenFactory().createToken("mUSDST", "mUSDST Token", [], [], [], "mUSDST", 0, 18);
        goldst = m.tokenFactory().createToken("GOLDST", "GOLDST Token", [], [], [], "GOLDST", 0, 18);

        // Activate tokens
        Token(usdst).setStatus(2);
        Token(musdst).setStatus(2);
        Token(goldst).setStatus(2);

        // Whitelist mToken
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(musdst), "mint", address(liquidity));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(musdst), "burn", address(liquidity));

        // Configure pool
        configurator.setBorrowableAsset(usdst);
        configurator.setMToken(musdst);
        configurator.setDebtCeilings(10000000e18, 10000000e18);
        configurator.setSafetyShareBps(1000);

        // Configure USDST (borrowable asset) with provided interest rate
        configurator.configureAsset(
            usdst,
            0,      // ltv
            0,      // liquidationThreshold
            11000,  // liquidationBonus
            500,    // interestRate
            1000,   // reserveFactor
            perSecondFactorRAY  // perSecondFactorRAY (configurable APY)
        );

        // Configure GOLDST (collateral)
        configurator.configureAsset(
            goldst,
            7500,   // ltv (75%)
            8000,   // liquidationThreshold (80%)
            10500,  // liquidationBonus (5%)
            0,      // interestRate (no interest for collateral)
            0,      // reserveFactor
            RAY     // perSecondFactorRAY (no compounding)
        );

        // Set oracle prices
        oracle.setAssetPrice(usdst, 1e18);       // $1 USD
        oracle.setAssetPrice(goldst, 2000e18);   // $2000 Gold

        // Provide initial liquidity for tests
        provideLiquidity(usdst, 1000000e18);
    }

    /**
     * @notice Helper: Provide liquidity to the pool
     * @param token Token to provide liquidity with
     * @param amount Amount of token to provide
     */
    function provideLiquidity(address token, uint amount) internal {
        Token(token).mint(address(this), amount);
        IERC20(token).approve(address(liquidity), amount);
        pool.depositLiquidity(amount);
    }

    /**
     * @notice Helper: Setup a user with collateral
     * @param user User to setup
     * @param collateralToken Token to use as collateral
     * @param collateralAmount Amount of collateral to provide
     */
    function setupUserWithCollateral(User user, address collateralToken, uint collateralAmount) internal {
        Token(collateralToken).mint(address(user), collateralAmount);
        TestUtils.callAs(user, collateralToken, "approve(address,uint256)", address(vault), collateralAmount);
        TestUtils.callAs(user, address(pool), "supplyCollateral(address,uint256)", collateralToken, collateralAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // DUST BORROW ATTACK PREVENTION TESTS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @notice Test 1: Normal case - dust borrow (1 wei) with typical interest rate
     * @dev This test demonstrates that dust borrows are allowed but properly tracked.
     *      With a typical 5% APY, borrowing 1 wei results in debt of 1 wei (most common case).
     *      Ceiling division ensures debt >= borrowed amount, preventing free borrows.
     */
    function it_allows_dust_borrow_with_proper_debt_tracking() public {
        // Setup with normal 5% APY
        setup(APY_5_PERCENT);

        // given someone has borrowed to create debt (needed for interest accrual)
        User initialBorrower = new User();
        setupUserWithCollateral(initialBorrower, goldst, 10e18);
        TestUtils.callAs(initialBorrower, address(pool), "borrow(uint256)", 1000e18);

        // given time passes to accrue some interest (1 year at 5% APY)
        fastForward(365 * 24 * 60 * 60);

        // given a user with collateral wants to borrow dust amount
        User dustBorrower = new User();
        setupUserWithCollateral(dustBorrower, goldst, 1e18);

        // when borrowing 1 wei (completely legal operation)
        uint dustAmount = 1;
        TestUtils.callAs(dustBorrower, address(pool), "borrow(uint256)", dustAmount);

        // then user received 1 wei
        uint balance = IERC20(usdst).balanceOf(address(dustBorrower));
        require(balance == dustAmount, "User should receive 1 wei");

        // then debt is >= borrowed amount (ceiling division prevents underpayment)
        // NOTE: In most cases with typical interest rates, debt == amount (both are 1 wei)
        uint debt = pool.getUserDebt(address(dustBorrower));
        require(debt >= dustAmount, "Debt must be >= borrowed amount, preventing free borrows");

        // then scaled debt is non-zero (proving ceiling division prevents zero scaled debt)
        LoanInfo memory loan = pool.getUserLoan(address(dustBorrower));
        require(loan.scaledDebt > 0, "Scaled debt must be > 0, proving no free borrows");
    }

    /**
     * @notice Test 2: Corner case - borrowing 1 wei results in 2 wei debt at doubled borrowIndex
     * @dev This test demonstrates an edge case with ceiling division:
     *      When borrowIndex = 2*RAY (doubled through 10% APY over 10 years),
     *      borrowing 1 wei immediately results in debt of 2 wei.
     *
     *      Mathematical explanation:
     *      - scaledDebt = ceiling(1 * RAY / (2*RAY)) = ceiling(0.5) = 1
     *      - debt = (scaledDebt * borrowIndex) / RAY = (1 * 2*RAY) / RAY = 2
     *
     *      This is NOT a bug - it's intentional behavior to prevent free borrows.
     *      The ceiling division ensures the protocol is never shortchanged.
     */
    function it_demonstrates_corner_case_borrow_1_wei_owe_2_wei() public {
        // Setup with 10% APY to reach borrowIndex ≈ 2*RAY after 10 years
        setup(APY_10_PERCENT);

        // given someone has borrowed to create debt (needed for interest accrual)
        User initialBorrower = new User();
        setupUserWithCollateral(initialBorrower, goldst, 10e18);
        TestUtils.callAs(initialBorrower, address(pool), "borrow(uint256)", 1000e18);

        // given time passes to approximately DOUBLE the borrowIndex (10% APY compounded over 10 years ≈ 2.59x)
        // Fast forward 10 years (10 iterations of 1 year each)
        for (uint i = 0; i < 10; i++) {
            fastForward(365 * 24 * 60 * 60);
        }

        // given a user with collateral wants to borrow dust amount
        User dustBorrower = new User();
        setupUserWithCollateral(dustBorrower, goldst, 1e18);

        // when borrowing 1 wei at borrowIndex ≈ 2*RAY
        uint dustAmount = 1;
        TestUtils.callAs(dustBorrower, address(pool), "borrow(uint256)", dustAmount);

        // then user received 1 wei
        uint balance = IERC20(usdst).balanceOf(address(dustBorrower));
        require(balance == dustAmount, "User should receive 1 wei");

        // then debt is 2 wei (CORNER CASE: borrow 1 wei, owe 2 wei immediately)
        // This happens because ceiling division with borrowIndex = 2*RAY
        // creates scaledDebt=1, which converts back to debt=2
        uint debt = pool.getUserDebt(address(dustBorrower));
        require(debt == 2, "CORNER CASE: Borrowing 1 wei at borrowIndex=2*RAY results in 2 wei debt");

        // then scaled debt is 1 (proving ceiling division: ceiling(0.5) = 1)
        LoanInfo memory loan = pool.getUserLoan(address(dustBorrower));
        require(loan.scaledDebt == 1, "Scaled debt should be 1 (ceiling of 0.5)");
    }
}
