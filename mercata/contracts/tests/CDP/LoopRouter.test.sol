import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_LoopRouter is Authorizable {
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

    uint WAD = 1e18;
    uint RAY = 1e27;
    uint PRICE = 11595e14; // $1.1595
    uint DEBT_FLOOR = 1e18; // 1 USDST
    uint MIN_CR = 155e16; // 1.55 WAD
    uint DEBT_CEILING = 10000000e18;

    function _freshUser(uint tokens) internal returns (User) {
        User u = new User();
        collateral.mint(address(u), tokens);
        return u;
    }

    function _realDebt(address user) internal returns (uint) {
        (, uint scaledDebt) = cdpEngine.vaults(user, collAddr);
        (uint rateAcc,,) = cdpEngine.collateralGlobalStates(collAddr);
        if (rateAcc == 0) rateAcc = RAY;
        return scaledDebt * rateAcc / RAY;
    }

    function _leverage(uint coll, uint debt) internal returns (uint) {
        uint collValueUSD = coll * PRICE / WAD;
        require(collValueUSD > debt, "insolvent");
        return collValueUSD * WAD / (collValueUSD - debt);
    }

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);

        cdpEngine = m.cdpEngine();
        cdpVault = m.cdpVault();
        cdpRegistry = m.cdpRegistry();
        priceOracle = PriceOracle(address(cdpRegistry.priceOracle()));
        adminRegistry = m.adminRegistry();
        loopRouter = m.loopRouter();

        usdstAddr = m.tokenFactory().createToken(
            "USDST", "USD Stablecoin", emptyArray, emptyArray, emptyArray, "USDST", 1000000000e18, 18
        );
        usdst = Token(usdstAddr);
        usdst.setStatus(2);
        usdst.mint(address(this), 10000000e18);
        Ownable(usdstAddr).transferOwnership(address(cdpEngine));
        cdpRegistry.setUSDST(usdstAddr);
        priceOracle.setAssetPrice(usdstAddr, 1e18);

        collAddr = m.tokenFactory().createToken(
            "syrupUSDC", "Syrup USDC", emptyArray, emptyArray, emptyArray, "syrupUSDC", 1000000000e18, 18
        );
        collateral = Token(collAddr);
        collateral.setStatus(2);
        collateral.mint(address(this), 10000000e18);

        cdpEngine.setCollateralAssetParams(
            collAddr, 150e16, MIN_CR, 1000, 5000,
            RAY + ((RAY * 2) / 100 / 31536000),
            DEBT_FLOOR, DEBT_CEILING, 1e18, false
        );
        priceOracle.setAssetPrice(collAddr, PRICE);

        poolAddr = m.poolFactory().createPool(usdstAddr, collAddr);
        pool = Pool(poolAddr);
        Token lpToken = pool.lpToken();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", poolAddr);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", poolAddr);
        require(ERC20(usdstAddr).approve(poolAddr, 5000000e18), "USDST approve");
        require(ERC20(collAddr).approve(poolAddr, 5000000e18), "COLL approve");
        pool.addLiquidity(5000000e18, 5000000e18, block.timestamp + 3600);

        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(cdpEngine), "depositFor", address(loopRouter));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(cdpEngine), "mintFor", address(loopRouter));
    }

    // ─────────────── Config & access ───────────────

    function it_config() {
        require(address(loopRouter) != address(0), "exists");
        require(loopRouter.MAX_LOOPS() == 20, "MAX_LOOPS=20");
    }

    function it_whitelist() {
        require(adminRegistry.whitelist(address(cdpEngine), "depositFor", address(loopRouter)), "depositFor");
        require(adminRegistry.whitelist(address(cdpEngine), "mintFor", address(loopRouter)), "mintFor");
    }

    // ─────────────── Leverage targets ───────────────

    function it_leverage_15x() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 15e17, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll >= 1000e18, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > 15e17 ? actualLev - 15e17 : 15e17 - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 1.5x");
    }

    function it_leverage_2x() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll >= 1000e18, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > 2e18 ? actualLev - 2e18 : 2e18 - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2x");
    }

    function it_leverage_28x() {
        User u = _freshUser(50000e18);
        u.do(collAddr, "approve", address(loopRouter), 5000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 5000e18, 28e17, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll > 5000e18, "collateral looped");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > 28e17 ? actualLev - 28e17 : 28e17 - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2.8x");
    }

    function it_exact_leverage_check() {
        User u = _freshUser(50000e18);
        uint amount = 10000e18;
        uint targetLev = 2e18;

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp", collAddr, amount, targetLev, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 100, "leverage within 0.01 WAD of target");
    }

    function it_exact_leverage_tight_tolerance() {
        User u = _freshUser(50000e18);
        uint amount = 5000e18;
        uint targetLev = 18e17; // 1.8x

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp", collAddr, amount, targetLev, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 200, "leverage within 0.005 WAD of target");
    }

    // ─────────────── Position ownership ───────────────

    function it_position_under_user() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        (uint userColl,) = cdpEngine.vaults(address(u), collAddr);
        require(userColl > 0, "user has position");
        (uint routerColl,) = cdpEngine.vaults(address(loopRouter), collAddr);
        require(routerColl == 0, "router has no position");
    }

    // ─────────────── Existing position ───────────────

    function it_existing_position_leverage() {
        User u = _freshUser(50000e18);

        // First: create a 1.5x position
        u.do(collAddr, "approve", address(loopRouter), 5000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 5000e18, 15e17, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll1,) = cdpEngine.vaults(address(u), collAddr);
        uint debt1 = _realDebt(address(u));
        require(coll1 >= 5000e18, "first position has collateral");
        require(debt1 > 0, "first position has debt");
        uint lev1 = _leverage(coll1, debt1);
        uint diff1 = lev1 > 15e17 ? lev1 - 15e17 : 15e17 - lev1;
        require(diff1 < WAD / 50, "first position near 1.5x");

        // Second: add more collateral and increase to 2x
        u.do(collAddr, "approve", address(loopRouter), 5000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 5000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        (uint coll2,) = cdpEngine.vaults(address(u), collAddr);
        uint debt2 = _realDebt(address(u));
        require(coll2 > coll1, "collateral increased");
        require(debt2 > debt1, "debt increased");
        uint lev2 = _leverage(coll2, debt2);
        uint diff2 = lev2 > 2e18 ? lev2 - 2e18 : 2e18 - lev2;
        require(diff2 < WAD / 50, "final position near 2x");
    }

    // ─────────────── Return values ───────────────

    function it_returns_values() {
        User u = _freshUser(50000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        (uint retColl, uint retDebt) = u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        (uint vaultColl,) = cdpEngine.vaults(address(u), collAddr);
        uint realDebt = _realDebt(address(u));
        require(retColl == vaultColl, "returned collateral matches vault");
        require(retDebt == realDebt, "returned debt matches real debt");
        require(retColl > 0, "returned collateral > 0");
        require(retDebt > 0, "returned debt > 0");
    }

    // ─────────────── Debt floor ───────────────

    function it_debt_floor() {
        User u = _freshUser(100e18);
        u.do(collAddr, "approve", address(loopRouter), 5e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 5e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        uint debt = _realDebt(address(u));
        require(debt >= DEBT_FLOOR, "real debt meets floor");
    }

    // ─────────────── Residue & rescue ───────────────

    function it_residue_zero_after_success() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);

        uint routerAsset = IERC20(collAddr).balanceOf(address(loopRouter));
        uint routerUsdst = IERC20(usdstAddr).balanceOf(address(loopRouter));
        require(routerAsset == 0, "router has zero collateral after success");
        require(routerUsdst == 0, "router has zero USDST after success");
    }

    function it_rescue_blocks_usdst() {
        bool reverted = false;
        try {
            loopRouter.rescueTokens(usdstAddr, address(this), 1);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on USDST rescue");
    }

    function it_rescue_blocks_collateral() {
        bool reverted = false;
        try {
            loopRouter.rescueTokens(collAddr, address(this), 1);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on collateral rescue");
    }

    function it_rescue_allows_unrelated_token() {
        address strayAddr = m.tokenFactory().createToken(
            "STRAY", "Stray Token", emptyArray, emptyArray, emptyArray, "STRAY", 1000000e18, 18
        );
        Token stray = Token(strayAddr);
        stray.setStatus(2);
        stray.mint(address(loopRouter), 100e18);

        uint balBefore = IERC20(strayAddr).balanceOf(address(this));
        loopRouter.rescueTokens(strayAddr, address(this), 100e18);
        uint balAfter = IERC20(strayAddr).balanceOf(address(this));
        require(balAfter == balBefore + 100e18, "rescued stray tokens");
    }

    // ─────────────── Revert cases ───────────────

    function it_reverts_impossible_leverage() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 10e18, poolAddr, true, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on impossible leverage");
    }

    function it_reverts_wrong_pool_direction() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, false, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on pool direction mismatch");
    }

    function it_reverts_wrong_token_pair() {
        address otherAddr = m.tokenFactory().createToken(
            "OTHER", "Other Token", emptyArray, emptyArray, emptyArray, "OTHER", 1000000e18, 18
        );
        Token other = Token(otherAddr);
        other.setStatus(2);
        cdpEngine.setCollateralAssetParams(otherAddr, 150e16, MIN_CR, 1000, 5000, RAY, 0, DEBT_CEILING, 1e18, false);
        priceOracle.setAssetPrice(otherAddr, 1e18);

        User u = new User();
        other.mint(address(u), 10000e18);
        u.do(otherAddr, "approve", address(loopRouter), 1000e18);
        bool reverted = false;
        try {
            // poolAddr is USDST/COLL — OTHER does not match
            u.do(address(loopRouter), "leverageUp", otherAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on wrong token pair");
    }

    function it_reverts_excessive_slippage_param() {
        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 1001, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on slippage > 10%");
    }

    function it_reverts_below_floor() {
        User u = _freshUser(100e18);
        u.do(collAddr, "approve", address(loopRouter), 1e17);
        bool reverted = false;
        try {
            // 0.1 tokens at 1.5x: target debt ~0.039 USDST, below floor of 1 USDST
            u.do(address(loopRouter), "leverageUp", collAddr, 1e17, 15e17, poolAddr, true, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when target debt below floor");
    }

    function it_reverts_debt_ceiling() {
        // Temporarily set ceiling to 1 wei (floor must also be lowered)
        cdpEngine.setCollateralAssetParams(
            collAddr, 150e16, MIN_CR, 1000, 5000,
            RAY + ((RAY * 2) / 100 / 31536000),
            0, 1, 1e18, false
        );

        User u = _freshUser(10000e18);
        u.do(collAddr, "approve", address(loopRouter), 1000e18);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp", collAddr, 1000e18, 2e18, poolAddr, true, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on debt ceiling");

        // Restore original ceiling
        cdpEngine.setCollateralAssetParams(
            collAddr, 150e16, MIN_CR, 1000, 5000,
            RAY + ((RAY * 2) / 100 / 31536000),
            DEBT_FLOOR, DEBT_CEILING, 1e18, false
        );
    }
}
