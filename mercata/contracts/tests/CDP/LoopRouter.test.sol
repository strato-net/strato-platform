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

    Token stableColl;
    address stableCollAddr;
    address stablePoolAddr;
    StablePool stablePool;
    // StablePool created via createStablePool(usdstAddr, stableCollAddr),
    // so coins(0)=USDST, coins(1)=stableColl. Use literal 0/1 at call sites
    // because u.do variadic packing doesn't propagate storage-typed uints
    // cleanly into nested StablePool.quoteSwap array indexing.

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

    // ─────────────────── Flash debt helpers ───────────────────
    // D* solver: Newton iteration on f(D) = (amount + X(D)) * P/U * (L-1)/L - D
    // where X(D) is the pool's output for a USDST-in swap of size D.
    // Converges in 6–8 rounds for typical leverage targets.

    function _computeFlashDebtCP(uint amount, uint targetLevWAD) internal returns (uint) {
        // Fixed-point iteration on the identity
        //   D = (amount + X(D)) * P/U * (L-1)/L
        // where X(D) is pool.quoteSwap output for swapping D USDST in.
        // Converges quickly for typical targets; 20 rounds leaves ample margin
        // (error halves each round for this monotone contraction).
        uint D = amount * PRICE / WAD * (targetLevWAD - WAD) / WAD;

        for (uint i = 0; i < 20; i++) {
            uint X = pool.quoteSwap(true, D);
            uint totalColl = amount + X;
            uint targetDebt = totalColl * PRICE / WAD * (targetLevWAD - WAD) / targetLevWAD;
            uint diff = targetDebt > D ? targetDebt - D : D - targetDebt;
            D = targetDebt;
            if (diff < 1e12) break; // 6 decimal-places of D
        }
        return D;
    }

    function _computeFlashDebtStable(uint amount, uint targetLevWAD) internal returns (uint) {
        // stableColl price = $1, unitScale = 1e18.
        uint D = amount * (targetLevWAD - WAD) / WAD;

        for (uint i = 0; i < 20; i++) {
            uint X = stablePool.quoteSwap(0, 1, D);
            uint totalColl = amount + X;
            uint targetDebt = totalColl * (targetLevWAD - WAD) / targetLevWAD;
            uint diff = targetDebt > D ? targetDebt - D : D - targetDebt;
            D = targetDebt;
            if (diff < 1e12) break;
        }
        return D;
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
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(cdpEngine), "flashMint", address(loopRouter));

        // ─── StablePool collateral fixture ───
        stableCollAddr = m.tokenFactory().createToken(
            "stableColl", "Stable Collateral", emptyArray, emptyArray, emptyArray, "SCOL", 1000000000e18, 18
        );
        stableColl = Token(stableCollAddr);
        stableColl.setStatus(2);
        stableColl.mint(address(this), 10000000e18);

        cdpEngine.setCollateralAssetParams(
            stableCollAddr, 150e16, MIN_CR, 1000, 5000,
            RAY + ((RAY * 2) / 100 / 31536000),
            DEBT_FLOOR, DEBT_CEILING, 1e18, false
        );
        priceOracle.setAssetPrice(stableCollAddr, 1e18);

        fastForward(100);
        stablePoolAddr = m.poolFactory().createStablePool(usdstAddr, stableCollAddr);
        stablePool = StablePool(stablePoolAddr);
        // Sanity check coin layout (factory pairs first arg as coin 0)
        require(address(stablePool.coins(0)) == usdstAddr, "USDST must be coin 0");
        require(address(stablePool.coins(1)) == stableCollAddr, "stableColl must be coin 1");

        Token stableLp = stablePool.lpToken();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(stableLp), "mint", stablePoolAddr);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(stableLp), "burn", stablePoolAddr);

        require(ERC20(usdstAddr).approve(stablePoolAddr, 5000000e18), "USDST approve stable");
        require(ERC20(stableCollAddr).approve(stablePoolAddr, 5000000e18), "stableColl approve");
        stablePool.addLiquidityGeneral([5000000e18, 5000000e18], 5000000e18, address(0));
    }

    // ─────────────── Config & access ───────────────

    function it_config() {
        require(address(loopRouter) != address(0), "exists");
        require(address(loopRouter.registry()) == address(cdpRegistry), "registry set");
    }

    function it_whitelist() {
        require(adminRegistry.whitelist(address(cdpEngine), "depositFor", address(loopRouter)), "depositFor");
        require(adminRegistry.whitelist(address(cdpEngine), "mintFor", address(loopRouter)), "mintFor");
        require(adminRegistry.whitelist(address(cdpEngine), "flashMint", address(loopRouter)), "flashMint");
    }

    // ─────────────── Leverage targets (flash) ───────────────

    function it_leverage_15x() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetLev = 15e17;
        uint targetDebt = _computeFlashDebtCP(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll >= amount, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 1.5x");
    }

    function it_leverage_2x() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetLev = 2e18;
        uint targetDebt = _computeFlashDebtCP(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll >= amount, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2x");
    }

    function it_leverage_28x() {
        User u = _freshUser(50000e18);
        uint amount = 5000e18;
        uint targetLev = 28e17;
        uint targetDebt = _computeFlashDebtCP(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        require(coll > amount, "collateral stacked");
        require(debt > 0, "has debt");
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2.8x");
    }

    function it_exact_leverage_check() {
        User u = _freshUser(50000e18);
        uint amount = 10000e18;
        uint targetLev = 2e18;
        uint targetDebt = _computeFlashDebtCP(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), collAddr);
        uint debt = _realDebt(address(u));
        uint actualLev = _leverage(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 100, "leverage within 0.01 WAD of target");
    }

    // ─────────────── Position ownership ───────────────

    function it_position_under_user() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint userColl,) = cdpEngine.vaults(address(u), collAddr);
        require(userColl > 0, "user has position");
        (uint routerColl,) = cdpEngine.vaults(address(loopRouter), collAddr);
        require(routerColl == 0, "router has no position");
    }

    // ─────────────── Existing position ───────────────

    function it_existing_position_leverage() {
        User u = _freshUser(50000e18);

        // First: create a 1.5x position
        uint amount1 = 5000e18;
        uint targetDebt1 = _computeFlashDebtCP(amount1, 15e17);
        u.do(collAddr, "approve", address(loopRouter), amount1);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount1, targetDebt1, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll1,) = cdpEngine.vaults(address(u), collAddr);
        uint debt1 = _realDebt(address(u));
        require(coll1 >= amount1, "first position has collateral");
        require(debt1 > 0, "first position has debt");

        // Second: add more collateral
        uint amount2 = 5000e18;
        uint targetDebt2 = _computeFlashDebtCP(amount2, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount2);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount2, targetDebt2, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        (uint coll2,) = cdpEngine.vaults(address(u), collAddr);
        uint debt2 = _realDebt(address(u));
        require(coll2 > coll1, "collateral increased");
        require(debt2 > debt1, "debt increased");
    }

    // ─────────────── Return values ───────────────

    function it_returns_values() {
        User u = _freshUser(50000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        (uint retColl, uint retDebt) = u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

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
        uint amount = 5e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

        uint debt = _realDebt(address(u));
        require(debt >= DEBT_FLOOR, "real debt meets floor");
    }

    // ─────────────── Residue & rescue ───────────────

    function it_residue_zero_after_success() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);

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

    // ─────────────── Single-swap impact + CR boundary ───────────────

    function it_flash_impact_bounded() {
        // Flash path does one big swap instead of many small ones, so we want an
        // explicit bound on how much the effective exec price drifts from the
        // pool's spot price at swap start. Pool is 5M:5M depth, 1k notional
        // swap → impact should be tiny.
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        require(targetDebt > 0, "debt solver > 0");

        // Pool fixture uses createPool(usdstAddr, collAddr) → tokenA = USDST.
        uint usdstBefore = pool.tokenABalance();
        uint collBefore = pool.tokenBBalance();
        uint spotBefore = usdstBefore * WAD / collBefore;  // USDST per coll at swap start

        u.do(collAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 200, block.timestamp + 3600);

        uint usdstAfter = pool.tokenABalance();
        uint collAfter = pool.tokenBBalance();
        uint usdstIn = usdstAfter - usdstBefore;
        uint collOut = collBefore - collAfter;
        require(usdstIn > 0 && collOut > 0, "swap happened");

        // Effective exec price must be WORSE than spot for the trader (CP math).
        uint effPrice = usdstIn * WAD / collOut;
        require(effPrice >= spotBefore, "effective price worse than spot (trader pays impact)");

        // Bound impact at router's 10% slippage cap.
        uint impactBps = (effPrice - spotBefore) * 10000 / spotBefore;
        require(impactBps < 1000, "swap impact within router's 10% slippage cap");
    }

    function it_reverts_at_cr_boundary() {
        // Precision test: feed a targetDebt above what CR permits, but less
        // egregious than the 10× overshoot in it_reverts_impossible_leverage.
        // Start from the max-leverage (2.8x) debt and push ~20% further — that
        // pushes target leverage past the ~2.82x theoretical max for minCR=155.
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint maxDebt = _computeFlashDebtCP(amount, 28e17);
        require(maxDebt > 0, "max debt solver > 0");

        uint overDebt = maxDebt * 12 / 10;

        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, overDebt, 0, poolAddr, 0, 0, 1, 200, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when targetDebt is over the CR limit");

        // Flash must unwind: vault empty, no debt, no collateral charged.
        (uint coll, uint sd) = cdpEngine.vaults(address(u), collAddr);
        require(coll == 0 && sd == 0, "vault fully rolled back on boundary revert");
    }

    // ─────────────── Revert cases ───────────────

    function it_reverts_impossible_leverage() {
        // CR violation: target debt far above what collateral at minCR permits.
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        // Collateral value ~1159.5 USD; debt of ~10000 USDST busts any CR > 1.0x.
        uint badDebt = amount * 10;
        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, badDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on impossible leverage");
        (uint coll, uint sd) = cdpEngine.vaults(address(u), collAddr);
        require(coll == 0 && sd == 0, "vault unchanged on revert");
    }

    function it_reverts_wrong_pool_direction() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, targetDebt, 0, poolAddr, 0, 1, 0, 100, block.timestamp + 3600);
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
            u.do(address(loopRouter), "leverageUp",
                otherAddr, 1000e18, 1e18, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on wrong token pair");
    }

    function it_reverts_excessive_slippage_param() {
        User u = _freshUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 1001, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on slippage > 10%");
    }

    function it_reverts_below_floor() {
        // Tiny deposit with tiny target debt that's below DEBT_FLOOR.
        // mintFor enforces the floor.
        User u = _freshUser(100e18);
        uint amount = 1e17; // 0.1 token
        // Pick a debt well below the 1 USDST floor.
        uint tinyDebt = 1e16; // 0.01 USDST
        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, tinyDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);
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
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtCP(amount, 2e18);
        u.do(collAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                collAddr, amount, targetDebt, 0, poolAddr, 0, 0, 1, 100, block.timestamp + 3600);
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

    function it_flash_callback_unauthorized_reverts() {
        // Direct external invocation of onFlashLoan must revert — only the
        // engine should ever reach this entry point.
        User u = _freshUser(0);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "onFlashLoan", collAddr, 1e18);
        } catch {
            reverted = true;
        }
        require(reverted, "direct onFlashLoan must revert");
    }

    // ─────────────── StablePool leverage ───────────────

    function _freshStableUser(uint tokens) internal returns (User) {
        User u = new User();
        stableColl.mint(address(u), tokens);
        return u;
    }

    function _realDebtStable(address user) internal returns (uint) {
        (, uint scaledDebt) = cdpEngine.vaults(user, stableCollAddr);
        (uint rateAcc,,) = cdpEngine.collateralGlobalStates(stableCollAddr);
        if (rateAcc == 0) rateAcc = RAY;
        return scaledDebt * rateAcc / RAY;
    }

    function _leverageStable(uint coll, uint debt) internal returns (uint) {
        // stableColl price = $1
        uint collValueUSD = coll * 1e18 / WAD;
        require(collValueUSD > debt, "insolvent");
        return collValueUSD * WAD / (collValueUSD - debt);
    }

    function it_cp_quote_monotonic() {
        uint dy1 = pool.quoteSwap(true, 1e18);
        uint dy2 = pool.quoteSwap(true, 10e18);
        uint dy3 = pool.quoteSwap(true, 100e18);
        require(dy2 > dy1, "dy monotonic 1->10");
        require(dy3 > dy2, "dy monotonic 10->100");
    }

    function it_stable_quote_monotonic() {
        uint dy1 = stablePool.quoteSwap(0, 1, 1e18);
        uint dy2 = stablePool.quoteSwap(0, 1, 10e18);
        uint dy3 = stablePool.quoteSwap(0, 1, 100e18);
        require(dy2 > dy1, "dy monotonic 1->10");
        require(dy3 > dy2, "dy monotonic 10->100");
    }

    // ─────────────── quoteSwap parity ───────────────

    function it_cp_quote_matches_swap() {
        uint[] sizes = new uint[](3);
        sizes[0] = 1e18;
        sizes[1] = 100e18;
        sizes[2] = 10000e18;

        for (uint t = 0; t < sizes.length; t++) {
            uint dx = sizes[t];
            uint quoted = pool.quoteSwap(true, dx);

            User u = new User();
            usdst.mint(address(u), dx);
            u.do(usdstAddr, "approve", poolAddr, dx);
            uint before = collateral.balanceOf(address(u));
            u.do(poolAddr, "swap", true, dx, 1, block.timestamp + 3600);
            uint got = collateral.balanceOf(address(u)) - before;

            uint diff = quoted > got ? quoted - got : got - quoted;
            require(diff <= 1, "CP quote matches swap within 1 wei");
        }
    }

    function it_stable_quote_matches_exchange() {
        uint[] sizes = new uint[](3);
        sizes[0] = 1e18;
        sizes[1] = 100e18;
        sizes[2] = 10000e18;

        for (uint t = 0; t < sizes.length; t++) {
            uint dx = sizes[t];
            uint quoted = stablePool.quoteSwap(0, 1, dx);

            User u = new User();
            usdst.mint(address(u), dx);
            u.do(usdstAddr, "approve", stablePoolAddr, dx);
            uint before = stableColl.balanceOf(address(u));
            u.do(stablePoolAddr, "exchange", 0, 1, dx, 1, address(u));
            uint got = stableColl.balanceOf(address(u)) - before;

            uint diff = quoted > got ? quoted - got : got - quoted;
            require(diff <= 1, "Stable quote matches exchange within 1 wei");
        }
    }

    function it_stable_leverage_15x() {
        User u = _freshStableUser(10000e18);
        uint amount = 1000e18;
        uint targetLev = 15e17;
        uint targetDebt = _computeFlashDebtStable(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
            1, 0, 1, 200, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), stableCollAddr);
        uint debt = _realDebtStable(address(u));
        require(coll >= amount, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverageStable(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 1.5x");
    }

    function it_stable_leverage_2x() {
        User u = _freshStableUser(10000e18);
        uint amount = 1000e18;
        uint targetLev = 2e18;
        uint targetDebt = _computeFlashDebtStable(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
            1, 0, 1, 200, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), stableCollAddr);
        uint debt = _realDebtStable(address(u));
        require(coll >= amount, "collateral deposited");
        require(debt > 0, "has debt");
        uint actualLev = _leverageStable(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2x");
    }

    function it_stable_leverage_28x() {
        // Flash path clears 2.8x against the stable pool too: no binary
        // search, no simulator — D* is closed-form from `quoteSwap`,
        // one on-chain swap/deposit/mint sequence.
        User u = _freshStableUser(50000e18);
        uint amount = 5000e18;
        uint targetLev = 28e17;
        uint targetDebt = _computeFlashDebtStable(amount, targetLev);
        require(targetDebt > 0, "debt solver > 0");

        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        u.do(address(loopRouter), "leverageUp",
            stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
            1, 0, 1, 200, block.timestamp + 3600);

        (uint coll,) = cdpEngine.vaults(address(u), stableCollAddr);
        uint debt = _realDebtStable(address(u));
        require(coll > amount, "collateral stacked");
        require(debt > 0, "has debt");
        uint actualLev = _leverageStable(coll, debt);
        uint diff = actualLev > targetLev ? actualLev - targetLev : targetLev - actualLev;
        require(diff < WAD / 50, "leverage within 0.02 WAD of 2.8x");
    }

    function it_stable_wrong_indices_reverts() {
        User u = _freshStableUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtStable(amount, 15e17);
        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            // Swap coinI/coinJ — USDST must be at coinI
            u.do(address(loopRouter), "leverageUp",
                stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
                1, 1, 0, 200, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on swapped stable indices");
    }

    function it_stable_slippage_reverts() {
        // Slippage param > 10% cap (1001 bps) is rejected by the router.
        User u = _freshStableUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtStable(amount, 2e18);
        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
                1, 0, 1, 1001, block.timestamp + 3600);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on slippage > 10%");
    }

    function it_stable_deadline_reverts() {
        User u = _freshStableUser(10000e18);
        uint amount = 1000e18;
        uint targetDebt = _computeFlashDebtStable(amount, 2e18);
        u.do(stableCollAddr, "approve", address(loopRouter), amount);
        bool reverted = false;
        try {
            u.do(address(loopRouter), "leverageUp",
                stableCollAddr, amount, targetDebt, 0, stablePoolAddr,
                1, 0, 1, 200, block.timestamp - 1);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on expired deadline");
    }

    function it_stable_existing_position_stacks() {
        User u = _freshStableUser(50000e18);

        // First: 1.5x
        uint amount1 = 5000e18;
        uint targetDebt1 = _computeFlashDebtStable(amount1, 15e17);
        u.do(stableCollAddr, "approve", address(loopRouter), amount1);
        u.do(address(loopRouter), "leverageUp",
            stableCollAddr, amount1, targetDebt1, 0, stablePoolAddr,
            1, 0, 1, 200, block.timestamp + 3600);

        (uint coll1,) = cdpEngine.vaults(address(u), stableCollAddr);
        uint debt1 = _realDebtStable(address(u));
        require(coll1 >= amount1, "first stable position collateral");
        require(debt1 > 0, "first stable position debt");

        // Second: add more and scale to 2x
        uint amount2 = 5000e18;
        uint targetDebt2 = _computeFlashDebtStable(amount2, 2e18);
        u.do(stableCollAddr, "approve", address(loopRouter), amount2);
        u.do(address(loopRouter), "leverageUp",
            stableCollAddr, amount2, targetDebt2, 0, stablePoolAddr,
            1, 0, 1, 200, block.timestamp + 3600);

        (uint coll2,) = cdpEngine.vaults(address(u), stableCollAddr);
        uint debt2 = _realDebtStable(address(u));
        require(coll2 > coll1, "stable coll increased");
        require(debt2 > debt1, "stable debt increased");
    }
}
