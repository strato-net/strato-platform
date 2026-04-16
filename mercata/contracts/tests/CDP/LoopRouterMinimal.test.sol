import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract MinUser {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_LoopRouterMinimal is Authorizable {
    Mercata m;
    string[] emptyArray;
    CDPEngine cdpEngine;
    CDPVault cdpVault;
    CDPRegistry cdpRegistry;
    PriceOracle priceOracle;
    AdminRegistry adminRegistry;
    LoopRouter loopRouter;
    Pool pool;
    Token collateral;
    Token usdst;
    address collAddr;
    address usdstAddr;
    address poolAddr;
    MinUser alice;

    uint WAD = 1e18;
    uint RAY = 1e27;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
        alice = new MinUser();

        cdpEngine = m.cdpEngine();
        cdpVault = m.cdpVault();
        cdpRegistry = m.cdpRegistry();
        priceOracle = PriceOracle(address(cdpRegistry.priceOracle()));
        adminRegistry = m.adminRegistry();
        loopRouter = m.loopRouter();

        usdstAddr = m.tokenFactory().createToken("USDST", "USD Stablecoin", emptyArray, emptyArray, emptyArray, "USDST", 1000000000e18, 18);
        usdst = Token(usdstAddr);
        usdst.setStatus(2);
        usdst.mint(address(this), 10000000e18);
        Ownable(usdstAddr).transferOwnership(address(cdpEngine));
        cdpRegistry.setUSDST(usdstAddr);
        priceOracle.setAssetPrice(usdstAddr, 1e18);

        collAddr = m.tokenFactory().createToken("COLL", "Collateral", emptyArray, emptyArray, emptyArray, "COLL", 1000000000e18, 18);
        collateral = Token(collAddr);
        collateral.setStatus(2);
        collateral.mint(address(this), 10000000e18);
        collateral.mint(address(alice), 100000e18);

        cdpEngine.setCollateralAssetParams(collAddr, 150e16, 155e16, 1000, 5000, RAY + ((RAY * 2) / 100 / 31536000), 1e18, 10000000e18, 1e18, false);
        priceOracle.setAssetPrice(collAddr, 11595e14); // $1.1595

        poolAddr = m.poolFactory().createPool(usdstAddr, collAddr);
        pool = Pool(poolAddr);
        Token lpToken = pool.lpToken();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", poolAddr);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", poolAddr);
        require(ERC20(usdstAddr).approve(poolAddr, 5000000e18), "a1");
        require(ERC20(collAddr).approve(poolAddr, 5000000e18), "a2");
        pool.addLiquidity(5000000e18, 5000000e18, block.timestamp + 3600);

        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(cdpEngine), "depositFor", address(loopRouter));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(cdpEngine), "mintFor", address(loopRouter));
    }

    // Direct engine control test — verifies deposit/mint work outside the router
    function it_alice_direct_deposit_mint() {
        alice.do(collAddr, "approve", address(cdpVault), 1000e18);
        alice.do(address(cdpEngine), "deposit", collAddr, 1000e18);
        alice.do(address(cdpEngine), "mint", collAddr, 100e18);
        (uint coll, uint scaledDebt) = cdpEngine.vaults(address(alice), collAddr);
        (uint rateAcc,,) = cdpEngine.collateralGlobalStates(collAddr);
        if (rateAcc == 0) rateAcc = RAY;
        uint realDebt = scaledDebt * rateAcc / RAY;
        require(coll > 0, "has collateral");
        require(realDebt > 0, "has real debt");
    }

    // Single happy-path router test
    function it_router_18x() {
        MinUser u = new MinUser();
        collateral.mint(address(u), 10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 18e17, poolAddr, true, 100, block.timestamp + 3600);
        (uint coll, uint scaledDebt) = cdpEngine.vaults(address(u), collAddr);
        (uint rateAcc,,) = cdpEngine.collateralGlobalStates(collAddr);
        if (rateAcc == 0) rateAcc = RAY;
        uint debt = scaledDebt * rateAcc / RAY;
        require(coll > 1000e18, "collateral looped");
        require(debt > 0, "has debt");
        uint collValueUSD = coll * 11595e14 / WAD;
        uint actualLev = collValueUSD * WAD / (collValueUSD - debt);
        uint diff = actualLev > 18e17 ? actualLev - 18e17 : 18e17 - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 1.8x");
    }
}
