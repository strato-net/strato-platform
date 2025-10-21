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

contract Describe_LiquidationCoverage_Flaw is Authorizable {

    uint INFINITY = 2 ** 256 - 1;
    uint zeroMinCollateralOut = 0; // Used for liquidations when we don't care about minimum collateral

    constructor() {
    }

    Mercata m;
    
    address USDST;
    address SILVST;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        // Create test tokens
        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        SILVST = m.tokenFactory().createToken("SILVST", "SILVST Token", [], [], [], "SILVST", 0, 18);
        
        // Activate tokens
        Token(USDST).setStatus(2);
        Token(SILVST).setStatus(2);
        
        // Configure lending pool
        m.poolConfigurator().setBorrowableAsset(USDST);
        m.poolConfigurator().setMToken(USDST);
    }

    function it_lending_poc_liquidation_coverage_creates_bad_debt() public {
        LendingPool pool = m.lendingPool();
        CollateralVault cv = m.collateralVault();
        LiquidityPool lp = m.liquidityPool();
        PriceOracle oracle = m.priceOracle();
        PoolConfigurator configurator = m.poolConfigurator();

        // Ensure predictable prices and config
        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(SILVST, 2000e18);

        (uint ltv0, uint lt0, uint lb0, uint ir0, uint rf0, uint ps0) = pool.getAssetConfig(SILVST);
        if (ltv0 == 0 || lt0 == 0) {
            uint setLtv = (ltv0 == 0) ? 6000 : ltv0; // 60%
            uint setLt  = (lt0  == 0) ? 7000 : lt0;  // 70%
            uint setLb  = (lb0 == 0) ? 11000 : lb0;  // 10% bonus
            uint setIr  = ir0;
            uint setRf  = rf0;
            uint setPs  = (ps0 == 0) ? 1e27 : ps0;
            configurator.configureAsset(SILVST, setLtv, setLt, setLb, setIr, setRf, setPs);
            (ltv0, lt0, lb0, ir0, rf0, ps0) = (setLtv, setLt, setLb, setIr, setRf, setPs);
        } else if (lb0 < 10500) {
            // ensure non-trivial bonus
            configurator.configureAsset(SILVST, ltv0, lt0, 11000, ir0, rf0, ps0);
            lb0 = 11000;
        }

        // Disable ceilings for the scenario
        uint oldAssetCeiling = pool.debtCeilingAsset();
        uint oldUsdCeiling = pool.debtCeilingUSD();
        configurator.setDebtCeilings(0, 0);

        // Borrower setup: supply collateral and borrow max
        User borrower = new User();
        uint collatAmount = 5e18;
        Token(SILVST).mint(address(borrower), collatAmount);
        borrower.do(SILVST, "approve", address(cv), collatAmount);
        borrower.do(address(pool), "supplyCollateral", address(SILVST), collatAmount);

        // Provide liquidity and borrow
        Token(USDST).mint(address(lp), 1000000e18);
        borrower.do(address(pool), "borrowMax");

        // Make the position under-collateralized so coverage < debt
        oracle.setAssetPrice(SILVST, 200e18); // 10x drop

        uint debtBefore = pool.getUserDebt(address(borrower));
        require(debtBefore > 0, "No debt before");

        // Fund liquidator; use helper that caps at coverage
        Token(USDST).mint(address(this), debtBefore);
        IERC20(USDST).approve(address(lp), INFINITY);

        uint badBefore = pool.badDebt();
        pool.liquidationCallAll(SILVST, address(borrower), zeroMinCollateralOut);

        uint badAfter = pool.badDebt();
        uint debtAfter = pool.getUserDebt(address(borrower));
        uint collAfter = cv.userCollaterals(address(borrower), SILVST);

        // Expect residual bad debt recognized and collateral largely/fully seized
        require(badAfter > badBefore, "Bad debt should increase");
        require(debtAfter == 0, "Debt should be zero after recognition");
        require(collAfter == 0 || collAfter < collatAmount, "Collateral should be reduced");

        // Restore ceilings
        configurator.setDebtCeilings(oldAssetCeiling, oldUsdCeiling);
    }

}
