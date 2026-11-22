import "../Util.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Admin/FeeCollector.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Lending/LendingRegistry.sol";
import "../../concrete/Lending/CollateralVault.sol";
import "../../concrete/Lending/LiquidityPool.sol";
import "../../concrete/Lending/RateStrategy.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../../concrete/Lending/PoolConfigurator.sol";
import "../../concrete/Lending/SafetyModule.sol";
import "../../concrete/Lending/LendingPool.sol";

/**
 * @title LendingPoolSeeder
 * @notice The pre-sunset ways into the pool, reduced to what the harness needs. The new LendingPool
 *         logic reverts every deposit, collateral supply and borrow, so positions are seeded through
 *         this implementation first and the proxy is then repointed at LendingPool, as the mainnet
 *         upgrade will do. Health checks are deliberately absent so positions the live code allowed
 *         (the USDST double count) or never priced can be reproduced.
 */
contract LendingPoolSeeder is LendingPool {
    constructor(address initialOwner) LendingPool(initialOwner) {}

    function seedSupply(address user, uint amount) external {
        _accrue();
        LiquidityPool(_liquidityPool()).deposit(amount, (amount * 1e18) / getExchangeRate(), user);
    }

    function seedCollateral(address user, address asset, uint amount) external {
        CollateralVault(_collateralVault()).addCollateral(user, asset, amount);
    }

    function seedBorrow(address user, uint amount) external {
        _accrue();
        LoanInfo storage loan = userLoan[user];
        uint scaledAdd = (amount * RAY + borrowIndex - 1) / borrowIndex;
        loan.scaledDebt += scaledAdd;
        loan.lastUpdated = block.timestamp;
        totalScaledDebt += scaledAdd;
        LiquidityPool(_liquidityPool()).borrow(amount, user);
    }

    /// Backs seeded safetyUSDST with USDST the way sweepReserves funds the module
    function seedSafetyAssets(uint amount) external {
        uint before = IERC20(borrowableAsset).balanceOf(address(safetyModule));
        require(IERC20(borrowableAsset).transfer(address(safetyModule), amount), "seed: safety transfer failed");
        safetyModule.recordTransfer(amount, before);
    }
}

/**
 * @title AdminUser
 * @notice A second AdminRegistry admin. It votes by calling castVoteOnIssue on the registry.
 */
contract AdminUser {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/**
 * @title Describe_LendingSunsetSweep
 * @notice Standalone harness for LendingPool.sunset and SafetyModule.redeemAllFor.
 * @dev Wires the lending stack directly instead of through BaseCodeCollection, so it compiles on the
 *      local solid-vm-cli. Ownership mirrors mainnet: every proxy is owned by an AdminRegistry (this
 *      test contract is its sole admin, so one vote executes), lendUSDST and safetyUSDST are owned by
 *      the registry with mint/burn whitelisted to LiquidityPool and SafetyModule, the six
 *      LendingRegistry setters are whitelisted to PoolConfigurator, and configuredAssets lists USDST
 *      twice. Positions are seeded on the old logic, stakes through a governance mint backed by the
 *      reserve-sweep path, then both proxies are upgraded.
 */
contract Describe_LendingSunsetSweep {

    string[] emptyArray;

    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    FeeCollector feeCollector;
    PriceOracle oracle;
    LendingRegistry lendingRegistry;
    CollateralVault collateralVault;
    LiquidityPool liquidityPool;
    PoolConfigurator poolConfigurator;
    address lendingPoolAddress;
    address safetyModuleAddress;
    LendingPool lendingPool;
    SafetyModule safetyModule;

    address USDST;
    address GOLDST;    // $4,000
    address SILVST;    // $50
    address lendUSDST;
    address safetyUSDST;

    User supplier1;
    User supplier2;
    User borrower1;    // also a supplier, like the largest mainnet borrower
    User borrower2;
    User holder;       // USDST collateral and no debt
    User staker1;
    User staker2;
    User payer;
    User stranger;

    uint constant PER_SECOND_5PCT = 1000000001547125956666413085; // mainnet perSecondFactorRAY, 5% APR
    uint constant YEAR = 31536000;
    uint constant MAX_UINT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    uint constant TOL = 1e9; // rounding tolerance in wei

    // ============ SETUP ============

    function beforeAll() {
        emptyArray = new string[](0);

        supplier1 = new User();
        supplier2 = new User();
        borrower1 = new User();
        borrower2 = new User();
        holder = new User();
        staker1 = new User();
        staker2 = new User();
        payer = new User();
        stranger = new User();
    }

    function beforeEach() {
        // Governance: this test contract is the sole admin of a proxied AdminRegistry
        adminRegistry = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        adminRegistry.initialize([address(this)]);
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));

        tokenFactory = new TokenFactory(address(this));
        feeCollector = new FeeCollector(address(this));
        oracle = new PriceOracle(address(this));
        oracle.initialize();

        // Lending stack behind proxies, initialized by this contract and then handed to the registry
        lendingRegistry = LendingRegistry(_proxied(address(new LendingRegistry(address(this)))));
        collateralVault = CollateralVault(_proxied(address(new CollateralVault(address(this)))));
        collateralVault.initialize(address(lendingRegistry));
        liquidityPool = LiquidityPool(_proxied(address(new LiquidityPool(address(this)))));
        liquidityPool.initialize(address(lendingRegistry));
        poolConfigurator = PoolConfigurator(_proxied(address(new PoolConfigurator(address(this)))));
        poolConfigurator.initialize(address(lendingRegistry));
        safetyModuleAddress = _proxied(address(new SafetyModule(address(this))));
        safetyModule = SafetyModule(safetyModuleAddress);
        safetyModule.initialize(address(lendingRegistry), address(tokenFactory));
        lendingPoolAddress = _proxied(address(new LendingPoolSeeder(address(this))));
        lendingPool = LendingPool(lendingPoolAddress);
        lendingPool.initialize(address(lendingRegistry), address(poolConfigurator), address(tokenFactory), address(feeCollector), safetyModuleAddress);
        address rateStrategy = address(new RateStrategy());

        Ownable(address(lendingRegistry)).transferOwnership(address(adminRegistry));
        Ownable(address(collateralVault)).transferOwnership(address(adminRegistry));
        Ownable(address(liquidityPool)).transferOwnership(address(adminRegistry));
        Ownable(address(poolConfigurator)).transferOwnership(address(adminRegistry));
        Ownable(safetyModuleAddress).transferOwnership(address(adminRegistry));
        Ownable(lendingPoolAddress).transferOwnership(address(adminRegistry));

        _grant(address(lendingRegistry), "setLendingPool", address(poolConfigurator));
        _grant(address(lendingRegistry), "setLiquidityPool", address(poolConfigurator));
        _grant(address(lendingRegistry), "setCollateralVault", address(poolConfigurator));
        _grant(address(lendingRegistry), "setRateStrategy", address(poolConfigurator));
        _grant(address(lendingRegistry), "setPriceOracle", address(poolConfigurator));
        _grant(address(lendingRegistry), "setAllComponents", address(poolConfigurator));
        adminRegistry.castVoteOnIssue(address(poolConfigurator), "initializeProtocol", lendingPoolAddress, address(liquidityPool), address(collateralVault), rateStrategy, address(oracle), address(tokenFactory), [], [], [], [], [], [], [], 0, 0, 1000);

        // Tokens: assets owned by this contract, protocol tokens owned by the registry (prod layout)
        USDST = _createToken("USDST");
        GOLDST = _createToken("GOLDST");
        SILVST = _createToken("SILVST");
        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLDST, 4000e18);
        oracle.setAssetPrice(SILVST, 50e18);
        lendUSDST = _createProtocolToken("lendUSDST", address(liquidityPool));
        safetyUSDST = _createProtocolToken("safetyUSDST", safetyModuleAddress);

        // Market: mainnet parameters, with USDST listed twice (indexes 0 and 3) as on mainnet
        adminRegistry.castVoteOnIssue(address(poolConfigurator), "setBorrowableAsset", USDST);
        adminRegistry.castVoteOnIssue(address(poolConfigurator), "setMToken", lendUSDST);
        _configure(USDST, 0, 0);
        _configure(GOLDST, 7500, 8000);
        _configure(SILVST, 7500, 8000);
        _configure(USDST, 7500, 8000);
        require(lendingPool.configuredAssets(0) == USDST && lendingPool.configuredAssets(3) == USDST, "fixture lists USDST twice");

        adminRegistry.castVoteOnIssue(safetyModuleAddress, "syncFromRegistry");
        adminRegistry.castVoteOnIssue(safetyModuleAddress, "setTokens", safetyUSDST, USDST);
        adminRegistry.castVoteOnIssue(safetyModuleAddress, "setParams", 1, 432000, 3000);
    }

    // ============ HELPERS ============

    function _proxied(address impl) internal returns (address) {
        return address(new Proxy(impl, address(this)));
    }

    function _grant(address target, string func, address user) internal {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", target, func, user);
    }

    function _createToken(string symbol) internal returns (address token) {
        token = tokenFactory.createToken(symbol, symbol, emptyArray, emptyArray, emptyArray, symbol, 0, 18);
        Token(token).setStatus(2);
        return token;
    }

    function _createProtocolToken(string symbol, address minter) internal returns (address token) {
        token = _createToken(symbol);
        Ownable(token).transferOwnership(address(adminRegistry));
        _grant(token, "mint", minter);
        _grant(token, "burn", minter);
        return token;
    }

    function _configure(address asset, uint ltv, uint liquidationThreshold) internal {
        adminRegistry.castVoteOnIssue(address(poolConfigurator), "configureAsset", asset, ltv, liquidationThreshold, 10500, 500, 1000, PER_SECOND_5PCT);
    }

    function _supply(User u, uint amount) internal {
        Token(USDST).mint(address(u), amount);
        u.do(USDST, "approve", address(liquidityPool), amount);
        LendingPoolSeeder(lendingPoolAddress).seedSupply(address(u), amount);
    }

    function _collateral(User u, address asset, uint amount) internal {
        Token(asset).mint(address(u), amount);
        u.do(asset, "approve", address(collateralVault), amount);
        LendingPoolSeeder(lendingPoolAddress).seedCollateral(address(u), asset, amount);
    }

    function _borrow(User u, uint amount) internal {
        LendingPoolSeeder(lendingPoolAddress).seedBorrow(address(u), amount);
    }

    function _stake(User u, uint amount) internal {
        adminRegistry.castVoteOnIssue(safetyUSDST, "mint", address(u), amount);
        Token(USDST).mint(lendingPoolAddress, amount);
        LendingPoolSeeder(lendingPoolAddress).seedSafetyAssets(amount);
    }

    /// Mainnet in miniature: 5,000 lendUSDST over three suppliers (one of them the main borrower),
    /// two loans worth 3,300 USDST against GOLDST and SILVST, a USDST-only collateral holder with no
    /// debt, two stakers. Pool cash ends at 1,700 USDST.
    function _seed() internal {
        _supply(supplier1, 3000e18);
        _supply(supplier2, 1000e18);
        _supply(borrower1, 1000e18);
        _collateral(borrower1, GOLDST, 1e18);
        _collateral(borrower1, SILVST, 20e18);
        _borrow(borrower1, 3000e18);
        _collateral(borrower2, SILVST, 10e18);
        _borrow(borrower2, 300e18);
        _collateral(holder, USDST, 17e18);
        _stake(staker1, 2200e18);
        _stake(staker2, 74e18);
        require(_bal(USDST, address(liquidityPool)) == 1700e18, "seed cash");
        require(IERC20(lendUSDST).totalSupply() == 5000e18, "seed supply");
        require(IERC20(safetyUSDST).totalSupply() == 2274e18, "seed stakes");
    }

    /// The mainnet upgrade: repoint both proxies at the sunset logic through governance.
    function _upgrade() internal {
        adminRegistry.castVoteOnIssue(lendingPoolAddress, "setLogicContract", address(new LendingPool(address(this))));
        adminRegistry.castVoteOnIssue(safetyModuleAddress, "setLogicContract", address(new SafetyModule(address(this))));
    }

    /// The payer approves the LendingPool to pull USDST during the call, as on mainnet.
    /// Approves the payer's whole balance so a second call tops the allowance up.
    function _fund(uint amount) internal {
        Token(USDST).mint(address(payer), amount);
        payer.do(USDST, "approve", lendingPoolAddress, _bal(USDST, address(payer)));
    }

    function _bal(address token, address who) internal view returns (uint) {
        return IERC20(token).balanceOf(who);
    }

    function _debt(User u) internal view returns (uint) {
        return lendingPool.getUserDebt(address(u));
    }

    function _held(User u, address asset) internal view returns (uint) {
        return collateralVault.userCollaterals(address(u), asset);
    }

    function _assertApprox(uint actual, uint expected, string label) internal {
        uint diff = actual > expected ? actual - expected : expected - actual;
        require(diff <= TOL, label + ": expected " + string(expected) + " got " + string(actual));
    }

    function _one(User a) internal returns (address[]) {
        address[] list = new address[](1);
        list[0] = address(a);
        return list;
    }

    function _two(User a, User b) internal returns (address[]) {
        address[] list = new address[](2);
        list[0] = address(a);
        list[1] = address(b);
        return list;
    }

    function _three(User a, User b, User c) internal returns (address[]) {
        address[] list = new address[](3);
        list[0] = address(a);
        list[1] = address(b);
        list[2] = address(c);
        return list;
    }

    function _none() internal returns (address[]) {
        return new address[](0);
    }

    function _borrowers() internal returns (address[]) { return _two(borrower1, borrower2); }
    function _collateralHolders() internal returns (address[]) { return _three(borrower1, borrower2, holder); }
    function _suppliers() internal returns (address[]) { return _three(supplier1, supplier2, borrower1); }
    function _stakers() internal returns (address[]) { return _two(staker1, staker2); }

    function _sunset(address[] borrowers, address[] collateralHolders, address[] suppliers, address[] stakers) internal returns (uint, uint, uint, uint) {
        (bool executed, variadic ret) = adminRegistry.castVoteOnIssue(lendingPoolAddress, "sunset", borrowers, collateralHolders, suppliers, stakers, address(payer));
        require(executed, "sunset vote did not execute");
        (uint loans, uint collateral, uint supplierCount, uint stakerCount) = ret;
        return (loans, collateral, supplierCount, stakerCount);
    }

    function _sunsetAll() internal returns (uint, uint, uint, uint) {
        return _sunset(_borrowers(), _collateralHolders(), _suppliers(), _stakers());
    }

    function _sunsetReverts(address[] borrowers, address[] collateralHolders, address[] suppliers, address[] stakers) internal returns (bool reverted) {
        try {
            adminRegistry.castVoteOnIssue(lendingPoolAddress, "sunset", borrowers, collateralHolders, suppliers, stakers, address(payer));
        } catch {
            reverted = true;
        }
        return reverted;
    }

    /// The seeded pool, untouched: every balance and position where _seed left it.
    function _requireSeedIntact(uint funded, uint totalDebt, uint cash) internal view {
        require(lendingPool.totalScaledDebt() == totalDebt && _debt(borrower1) == 3000e18 && _debt(borrower2) == 300e18, "debt intact");
        require(_held(borrower1, GOLDST) == 1e18 && _held(borrower1, SILVST) == 20e18 && _held(borrower2, SILVST) == 10e18 && _held(holder, USDST) == 17e18, "collateral intact");
        require(IERC20(lendUSDST).totalSupply() == 5000e18 && _bal(USDST, address(liquidityPool)) == cash, "supply and cash intact");
        require(IERC20(safetyUSDST).totalSupply() == 2274e18 && safetyModule.totalAssets() == 2274e18, "stakes intact");
        require(_bal(USDST, address(payer)) == funded && _bal(USDST, lendingPoolAddress) == 0, "funding still with the payer");
        require(!lendingPool.paused(), "not paused");
    }

    // ============ CLOSED ON DEPLOYMENT ============

    function it_closes_every_way_in() {
        _seed();
        _upgrade();

        Token(USDST).mint(address(supplier1), 10e18);
        supplier1.do(USDST, "approve", address(liquidityPool), MAX_UINT);
        supplier1.doExpectingFailure(lendingPoolAddress, "depositLiquidity", "Lending is closed", 1e18);
        supplier1.doExpectingFailure(lendingPoolAddress, "depositLiquidityOnBehalfOf", "Lending is closed", address(supplier2), 1e18);
        Token(GOLDST).mint(address(borrower1), 1e18);
        borrower1.do(GOLDST, "approve", address(collateralVault), MAX_UINT);
        borrower1.doExpectingFailure(lendingPoolAddress, "supplyCollateral", "Lending is closed", GOLDST, 1e18);
        borrower1.doExpectingFailure(lendingPoolAddress, "borrow", "Lending is closed", 1e18);
        borrower1.doExpectingFailure(lendingPoolAddress, "borrowMax", "Lending is closed");
        staker1.do(USDST, "approve", safetyModuleAddress, MAX_UINT);
        staker1.doExpectingFailure(safetyModuleAddress, "stake", "Staking is closed", 1e18, 0);

        require(IERC20(lendUSDST).totalSupply() == 5000e18, "supply untouched");
        require(IERC20(safetyUSDST).totalSupply() == 2274e18, "stakes untouched");
        require(lendingPool.totalScaledDebt() == 3300e18, "debt untouched");
        require(_held(borrower1, GOLDST) == 1e18, "collateral untouched");
    }

    function it_keeps_every_way_out_open() {
        _seed();
        _upgrade();

        // repay
        borrower2.do(USDST, "approve", address(liquidityPool), MAX_UINT);
        borrower2.do(lendingPoolAddress, "repay", 100e18);
        require(_debt(borrower2) == 200e18, "repay still works");

        // withdraw liquidity
        supplier2.do(lendingPoolAddress, "withdrawLiquidity", 100e18);
        require(_bal(USDST, address(supplier2)) == 100e18, "withdrawLiquidity still works");

        // withdraw collateral while staying healthy
        borrower1.do(lendingPoolAddress, "withdrawCollateral", SILVST, 10e18);
        require(_bal(SILVST, address(borrower1)) == 10e18, "withdrawCollateral still works");

        // liquidation: SILVST falls to $20, borrower2's health drops to 0.8
        oracle.setAssetPrice(SILVST, 20e18);
        Token(USDST).mint(address(stranger), 1000e18);
        stranger.do(USDST, "approve", address(liquidityPool), MAX_UINT);
        stranger.do(lendingPoolAddress, "liquidationCallAll", SILVST, address(borrower2), 0);
        require(_debt(borrower2) < 200e18, "liquidation still works");
        require(_bal(SILVST, address(stranger)) > 0, "liquidator was paid");

        // SafetyModule redeem after the one-second cooldown
        fastForward(1); // the harness clock starts at 0, which startCooldown would read as "not cooling"
        staker2.do(safetyModuleAddress, "startCooldown");
        fastForward(2);
        staker2.do(safetyModuleAddress, "redeem", 74e18, 0);
        require(_bal(USDST, address(staker2)) == 74e18, "redeem still works");
    }

    // ============ THE SUNSET ============

    function it_settles_every_position_in_one_call() {
        _seed();
        _upgrade();
        _fund(3400e18);

        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunsetAll();
        require(loans == 2 && collateral == 3 && suppliers == 3 && stakers == 2, "counts");

        // Loans are gone; the payer holds collateral worth exactly the debt at oracle price
        require(lendingPool.totalScaledDebt() == 0 && _debt(borrower1) == 0 && _debt(borrower2) == 0, "debt zero");
        require(_bal(GOLDST, address(payer)) == 75e16, "payer got 0.75 GOLDST for 3,000 USDST");
        require(_bal(SILVST, address(payer)) == 6e18, "payer got 6 SILVST for 300 USDST");
        require(_bal(USDST, address(payer)) == 100e18, "unused funding left with the payer");

        // Borrowers and the collateral-only holder got everything else back
        require(_bal(GOLDST, address(borrower1)) == 25e16 && _bal(SILVST, address(borrower1)) == 20e18, "borrower1 collateral returned");
        require(_bal(SILVST, address(borrower2)) == 4e18, "borrower2 collateral returned");
        require(_bal(USDST, address(holder)) == 17e18, "USDST collateral returned once despite the duplicate entry");
        require(_bal(GOLDST, address(collateralVault)) == 0 && _bal(SILVST, address(collateralVault)) == 0 && _bal(USDST, address(collateralVault)) == 0, "vault empty");

        // Suppliers redeemed 1:1 (no interest accrued), pool emptied
        require(_bal(USDST, address(supplier1)) == 3000e18, "supplier1 paid");
        require(_bal(USDST, address(supplier2)) == 1000e18, "supplier2 paid");
        require(_bal(USDST, address(borrower1)) == 4000e18, "borrower1 keeps the loan and gets the supply back");
        require(IERC20(lendUSDST).totalSupply() == 0, "lendUSDST supply zero");
        require(_bal(USDST, address(liquidityPool)) == 0, "LiquidityPool empty");
        require(_bal(USDST, address(feeCollector)) == 0, "nothing accrued, nothing swept");

        // Stakers redeemed at 1.0
        require(_bal(USDST, address(staker1)) == 2200e18 && _bal(USDST, address(staker2)) == 74e18, "stakers paid");
        require(IERC20(safetyUSDST).totalSupply() == 0 && safetyModule.totalAssets() == 0 && _bal(USDST, safetyModuleAddress) == 0, "SafetyModule empty");

        require(_bal(USDST, lendingPoolAddress) == 0, "no funding left behind");
        require(lendingPool.paused(), "paused");
    }

    function it_pays_suppliers_at_the_exchange_rate_and_sweeps_reserves() {
        _seed();
        _upgrade();
        fastForward(YEAR);

        uint debt1 = lendingPool.getUserDebtPreview(address(borrower1));
        uint debt2 = lendingPool.getUserDebtPreview(address(borrower2));
        require(debt1 > 3000e18 && debt2 > 300e18, "interest accrued");
        uint interest = debt1 + debt2 - 3300e18;
        uint cashBefore = _bal(USDST, address(liquidityPool));
        _fund(debt1 + debt2 + 10e18);

        _sunsetAll();

        require(lendingPool.totalScaledDebt() == 0, "debt zero");
        require(_bal(USDST, address(payer)) == 10e18, "payer covered exactly the accrued debt");

        // Suppliers share cash + repaid debt - reserves pro rata; the FeeCollector gets the rest
        uint paid = _bal(USDST, address(supplier1)) + _bal(USDST, address(supplier2)) + _bal(USDST, address(borrower1)) - 3000e18;
        uint swept = _bal(USDST, address(feeCollector));
        require(paid + swept == cashBefore + debt1 + debt2, "every wei accounted for");
        _assertApprox(swept, interest / 10, "reserves (10% of interest) swept to the FeeCollector");
        uint distributable = cashBefore + debt1 + debt2 - interest / 10;
        _assertApprox(_bal(USDST, address(supplier1)), (distributable * 3) / 5, "supplier1 share");
        _assertApprox(_bal(USDST, address(supplier2)), distributable / 5, "supplier2 share");
        require(lendingPool.reservesAccrued() == 0, "reserves cleared");
        require(IERC20(lendUSDST).totalSupply() == 0 && _bal(USDST, address(liquidityPool)) == 0, "pool emptied");
    }

    function it_counts_duplicate_usdst_collateral_once() {
        _seed();
        User dupBorrower = new User();

        // The live bug: 100 USDST of collateral gives 150 USDST of borrowing power at 75% LTV
        _collateral(dupBorrower, USDST, 100e18);
        require(lendingPool.calculateMaxBorrowingPower(address(dupBorrower), address(0), 0) == 150e18, "fixture reproduces the double count");
        _borrow(dupBorrower, 140e18);

        _upgrade();
        _fund(3440e18);
        address[] borrowers = _three(borrower1, borrower2, dupBorrower);
        address[] holders = new address[](4);
        holders[0] = address(borrower1);
        holders[1] = address(borrower2);
        holders[2] = address(holder);
        holders[3] = address(dupBorrower);

        // Counted once, 100 USDST does not cover 140: the payer pays all 140, takes all 100 and absorbs 40
        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunset(borrowers, holders, _suppliers(), _stakers());
        require(loans == 3 && collateral == 3 && suppliers == 3 && stakers == 2, "counts");
        require(_debt(dupBorrower) == 0 && _held(dupBorrower, USDST) == 0, "settled, all collateral seized");
        require(_bal(USDST, address(dupBorrower)) == 140e18, "borrower keeps only what it borrowed");
        require(_bal(USDST, address(payer)) == 100e18, "payer: 3,440 paid, 100 of collateral back");
        require(_bal(GOLDST, address(payer)) == 75e16 && _bal(SILVST, address(payer)) == 6e18, "other loans settled as usual");

        // Suppliers whole: 1,560 cash + 3,440 repaid covers 5,000 lendUSDST at 1.0
        require(_bal(USDST, address(supplier1)) == 3000e18 && _bal(USDST, address(supplier2)) == 1000e18, "suppliers paid in full");
        require(IERC20(lendUSDST).totalSupply() == 0 && lendingPool.paused(), "supply zero, paused");
    }

    function it_reverts_when_the_funding_cannot_cover_every_loan() {
        _seed();
        _upgrade();
        _fund(500e18);

        // 500 covers borrower2 but not borrower1: the whole call reverts and nothing moves
        require(_sunsetReverts(_borrowers(), _collateralHolders(), _suppliers(), _stakers()), "short funding must revert");
        _requireSeedIntact(500e18, 3300e18, 1700e18);

        // Topped up to the full debt, it goes through with nothing to refund
        _fund(2800e18);
        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunsetAll();
        require(loans == 2 && collateral == 3 && suppliers == 3 && stakers == 2, "counts");
        require(lendingPool.totalScaledDebt() == 0 && IERC20(lendUSDST).totalSupply() == 0, "settled");
        require(_bal(USDST, address(payer)) == 0 && _bal(GOLDST, address(payer)) == 75e16 && _bal(SILVST, address(payer)) == 6e18, "payer: collateral, no refund");
        require(lendingPool.paused(), "paused");
    }

    function it_takes_only_priced_collateral_and_rejects_an_unpriced_loan() {
        _seed();
        address PAXG = _createToken("PAXG");
        _configure(PAXG, 7500, 8000);
        User mixed = new User();
        User unpriced = new User();
        _collateral(mixed, PAXG, 1e18);
        _collateral(mixed, SILVST, 10e18);
        _borrow(mixed, 300e18);
        _collateral(unpriced, PAXG, 1e18);
        _borrow(unpriced, 100e18);

        _upgrade();
        _fund(3700e18);
        address[] borrowers = new address[](4);
        borrowers[0] = address(borrower1);
        borrowers[1] = address(borrower2);
        borrowers[2] = address(mixed);
        borrowers[3] = address(unpriced);
        address[] holders = new address[](5);
        holders[0] = address(borrower1);
        holders[1] = address(borrower2);
        holders[2] = address(holder);
        holders[3] = address(mixed);
        holders[4] = address(unpriced);

        // Nothing priced backs the unpriced loan: the call reverts, nothing moves
        require(_sunsetReverts(borrowers, holders, _suppliers(), _stakers()), "unpriced loan must revert");
        require(_debt(mixed) == 300e18 && _held(mixed, PAXG) == 1e18 && _held(mixed, SILVST) == 10e18, "mixed intact");
        require(_debt(unpriced) == 100e18 && _held(unpriced, PAXG) == 1e18, "unpriced intact");
        _requireSeedIntact(3700e18, 3700e18, 1300e18);

        // Priced, it settles; mixed is paid from SILVST alone and gets its PAXG back whole
        oracle.setAssetPrice(PAXG, 2000e18);
        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunset(borrowers, holders, _suppliers(), _stakers());
        require(loans == 4 && collateral == 5 && suppliers == 3 && stakers == 2, "counts");
        require(_bal(SILVST, address(payer)) == 6e18 + 6e18 && _bal(SILVST, address(mixed)) == 4e18 && _bal(PAXG, address(mixed)) == 1e18, "mixed settled from SILVST");
        require(_bal(PAXG, address(payer)) == 5e16 && _bal(PAXG, address(unpriced)) == 95e16, "unpriced settled at the new price");
        require(_bal(PAXG, address(collateralVault)) == 0 && lendingPool.paused(), "vault empty, paused");
    }

    function it_rejects_a_safety_module_that_cannot_redeem() {
        _seed();
        _upgrade();
        // A module that rejects the pool: fresh, never synced, so redeemAllFor reverts
        adminRegistry.castVoteOnIssue(address(poolConfigurator), "setSafetyModule", address(new SafetyModule(address(this))));
        _fund(3300e18);

        require(_sunsetReverts(_borrowers(), _collateralHolders(), _suppliers(), _stakers()), "a failing module must fail the call");
        _requireSeedIntact(3300e18, 3300e18, 1700e18);
    }

    function it_rejects_an_incomplete_address_set() {
        _seed();
        _upgrade();
        _fund(3300e18);

        require(_sunsetReverts(_one(borrower1), _collateralHolders(), _suppliers(), _stakers()), "a missing borrower must revert");
        _requireSeedIntact(3300e18, 3300e18, 1700e18);
        require(_sunsetReverts(_borrowers(), _collateralHolders(), _two(supplier1, borrower1), _stakers()), "a missing supplier must revert");
        _requireSeedIntact(3300e18, 3300e18, 1700e18);
        require(_sunsetReverts(_borrowers(), _collateralHolders(), _suppliers(), _one(staker1)), "a missing staker must revert");
        _requireSeedIntact(3300e18, 3300e18, 1700e18);

        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunsetAll();
        require(loans == 2 && collateral == 3 && suppliers == 3 && stakers == 2, "the complete set goes through");
        require(lendingPool.paused(), "paused");
    }

    function it_catches_receipt_tokens_that_moved_after_the_snapshot() {
        _seed();
        _upgrade();
        _fund(3300e18);

        // lendUSDST and safetyUSDST are plain transferable tokens: a holder moves them after the lists were drawn up
        supplier2.do(lendUSDST, "transfer", address(stranger), 400e18);
        staker2.do(safetyUSDST, "transfer", address(stranger), 74e18);
        require(_sunsetReverts(_borrowers(), _collateralHolders(), _suppliers(), _stakers()), "moved balances must revert");

        // Listing the new holder settles everything, each at the balance held at execution
        address[] suppliers = new address[](4);
        suppliers[0] = address(supplier1);
        suppliers[1] = address(supplier2);
        suppliers[2] = address(borrower1);
        suppliers[3] = address(stranger);
        (uint loans, uint collateral, uint supplierCount, uint stakers) = _sunset(_borrowers(), _collateralHolders(), suppliers, _two(staker1, stranger));
        require(loans == 2 && collateral == 3 && supplierCount == 4 && stakers == 2, "counts");
        require(_bal(USDST, address(supplier2)) == 600e18 && _bal(USDST, address(stranger)) == 400e18 + 74e18, "paid by current balance");
        require(IERC20(lendUSDST).totalSupply() == 0 && IERC20(safetyUSDST).totalSupply() == 0, "all redeemed");
    }

    function it_sweeps_with_the_receipt_tokens_paused() {
        _seed();
        _upgrade();
        _fund(3300e18);

        // Pausing both receipt tokens freezes the holder sets; burn is not pause-gated, so the sweep still runs
        adminRegistry.castVoteOnIssue(lendUSDST, "pause");
        adminRegistry.castVoteOnIssue(safetyUSDST, "pause");
        bool blocked = false;
        try {
            supplier2.do(lendUSDST, "transfer", address(stranger), 1e18);
        } catch {
            blocked = true;
        }
        require(blocked, "transfers frozen");

        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunsetAll();
        require(loans == 2 && collateral == 3 && suppliers == 3 && stakers == 2, "counts");
        require(IERC20(lendUSDST).totalSupply() == 0 && IERC20(safetyUSDST).totalSupply() == 0 && lendingPool.paused(), "swept while paused");
    }

    function it_returns_a_forgotten_collateral_holder_on_a_follow_up_call() {
        _seed();
        _upgrade();
        _fund(3300e18);

        // The vault keeps no total, so a holder with no debt left off the list is not detected on-chain
        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunset(_borrowers(), _two(borrower1, borrower2), _suppliers(), _stakers());
        require(loans == 2 && collateral == 2 && suppliers == 3 && stakers == 2, "counts");
        require(_held(holder, USDST) == 17e18 && lendingPool.paused(), "position kept behind the pause");

        // Listing them afterwards returns it; the finished pool still passes the completeness check
        (loans, collateral, suppliers, stakers) = _sunset(_none(), _one(holder), _none(), _none());
        require(loans == 0 && collateral == 1 && suppliers == 0 && stakers == 0, "follow-up counts");
        require(_held(holder, USDST) == 0 && _bal(USDST, address(holder)) == 17e18, "returned");
    }

    function it_is_a_no_op_once_everything_is_settled() {
        _seed();
        _upgrade();
        _fund(3300e18);
        _sunsetAll();

        (uint loans, uint collateral, uint suppliers, uint stakers) = _sunsetAll();
        require(loans == 0 && collateral == 0 && suppliers == 0 && stakers == 0, "nothing left to do");
        require(lendingPool.paused() && _bal(USDST, address(payer)) == 0, "a finished pool passes the completeness check");
    }

    function it_handles_many_accounts_in_one_call() {
        _seed();
        User[] extra = new User[](12);
        address[] suppliers = new address[](15);
        address[] holders = new address[](9);
        suppliers[0] = address(supplier1);
        suppliers[1] = address(supplier2);
        suppliers[2] = address(borrower1);
        holders[0] = address(borrower1);
        holders[1] = address(borrower2);
        holders[2] = address(holder);
        for (uint i = 0; i < 12; i++) {
            extra[i] = new User();
            _supply(extra[i], 10e18);
            suppliers[3 + i] = address(extra[i]);
            if (i < 6) {
                _collateral(extra[i], SILVST, 1e18);
                holders[3 + i] = address(extra[i]);
            }
        }
        require(IERC20(lendUSDST).totalSupply() == 5120e18, "fifteen suppliers");

        _upgrade();
        _fund(3300e18);
        (uint loans, uint collateral, uint supplierCount, uint stakers) = _sunset(_borrowers(), holders, suppliers, _stakers());
        require(loans == 2 && collateral == 9 && supplierCount == 15 && stakers == 2, "counts");
        require(IERC20(lendUSDST).totalSupply() == 0 && _bal(USDST, address(liquidityPool)) == 0, "pool empty");
        require(_bal(SILVST, address(collateralVault)) == 0 && _bal(GOLDST, address(collateralVault)) == 0, "vault empty");
        for (uint j = 0; j < 12; j++) {
            require(_bal(USDST, address(extra[j])) == 10e18, "extra supplier paid");
            if (j < 6) require(_bal(SILVST, address(extra[j])) == 1e18, "extra holder returned");
        }
    }

    // ============ ACCESS CONTROL AND GOVERNANCE ============

    function it_executes_only_through_governance() {
        _seed();
        _upgrade();
        _fund(3400e18);

        bool reverted = false;
        try {
            stranger.do(lendingPoolAddress, "sunset", _borrowers(), _collateralHolders(), _suppliers(), _stakers(), address(payer));
        } catch {
            reverted = true;
        }
        require(reverted, "non-admin sunset must revert");
        require(lendingPool.totalScaledDebt() == 3300e18 && !lendingPool.paused() && _bal(USDST, address(payer)) == 3400e18 && _bal(USDST, lendingPoolAddress) == 0, "nothing moved");

        // SafetyModule.redeemAllFor: strangers are rejected, the owner's vote executes
        stranger.doExpectingFailure(safetyModuleAddress, "redeemAllFor", "SM: not LendingPool or owner", _stakers());
        require(IERC20(safetyUSDST).totalSupply() == 2274e18, "stakes untouched");
        adminRegistry.castVoteOnIssue(safetyModuleAddress, "redeemAllFor", _stakers());
        require(IERC20(safetyUSDST).totalSupply() == 0 && _bal(USDST, address(staker1)) == 2200e18 && _bal(USDST, address(staker2)) == 74e18, "owner vote redeemed every staker");
        require(safetyModule.totalAssets() == 0, "module accounting cleared");
    }

    function it_requires_threshold_votes_before_executing() {
        _seed();
        _upgrade();
        _fund(3400e18);

        // Fresh registry with two admins (this test + admin2): the default threshold needs both votes
        AdminUser admin2 = new AdminUser();
        AdminRegistry twoAdmins = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        twoAdmins.initialize([address(this), address(admin2)]);
        Ownable(address(twoAdmins)).transferOwnership(address(twoAdmins));
        adminRegistry.castVoteOnIssue(lendingPoolAddress, "transferOwnership", address(twoAdmins));
        require(lendingPool.owner() == address(twoAdmins), "two-admin registry owns the pool");

        // First vote: issue created, nothing executes
        twoAdmins.castVoteOnIssue(lendingPoolAddress, "sunset", _borrowers(), _collateralHolders(), _suppliers(), _stakers(), address(payer));
        require(lendingPool.totalScaledDebt() == 3300e18 && !lendingPool.paused(), "first vote must not execute");

        // Second admin votes with identical arguments: executes
        admin2.do(address(twoAdmins), "castVoteOnIssue", lendingPoolAddress, "sunset", _borrowers(), _collateralHolders(), _suppliers(), _stakers(), address(payer));
        require(lendingPool.totalScaledDebt() == 0 && lendingPool.paused(), "second vote executes");
        require(IERC20(lendUSDST).totalSupply() == 0 && IERC20(safetyUSDST).totalSupply() == 0, "everyone paid");
    }
}
