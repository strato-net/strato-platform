// SPDX-License-Identifier: MIT
//
// Adv_Amm_PriceImpact — re-runs the vendor's OWN economic traces against a REAL v2 Pool at
// mainnet depth instead of their infinite-depth zero-slippage OTCDesk fixture.
//
// Mainnet facts used (from the brief):
//   deepest USDST venue, Pool 0x...101b : GOLDST 53.71 / USDST 239,376, effective fee 30 bps
//   GOLDST exists at only ~54.6 tokens across ALL AMM venues
//   CDP: liquidationRatio 1.50, minCR 1.55, closeFactor 5000 bps, liquidationPenalty 1000 bps
//   whale vault debt 1,483,780 USDST  ->  50% close factor = 741,890 USDST
//
// The oracle is deliberately pinned to the pool's own implied price so that NOTHING in the
// measured numbers is a pre-existing arbitrage: every gap below is pure price impact.
//
// OUTPUT: it_zz_print_* dump measured numbers via log(). All it_d*/it_e* tests must pass.

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice The vendor's fixture, copied verbatim: oracle parity, infinite depth, zero slippage.
contract OTCDesk {
    mapping(address => uint) public priceWad;
    function setPrice(address asset, uint p) public { priceWad[asset] = p; }
    function settle(address tokenIn, uint amountIn, address tokenOut) public returns (uint amountOut) {
        require(priceWad[tokenIn] > 0 && priceWad[tokenOut] > 0, "OTCDesk: unpriced");
        amountOut = (amountIn * priceWad[tokenIn]) / priceWad[tokenOut];
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "OTCDesk: in");
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "OTCDesk: out");
        return amountOut;
    }
}

/// @notice USE CASE 1, but the exit is a REAL Pool instead of the desk.
contract PoolLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    Pool public pool;
    address public usdst;
    address public coll;
    address public borrower;

    uint public seized;
    uint public proceeds;
    uint public profit;
    uint public endBalance;

    function init(address _lender, address _cdp, address _pool, address _usdst, address _coll) public {
        lender = FlashMint(_lender);
        cdp = CDPEngine(_cdp);
        pool = Pool(_pool);
        usdst = _usdst;
        coll = _coll;
    }

    function run(address _borrower, uint repay) public {
        borrower = _borrower;
        lender.flashLoan(address(this), repay, "liq");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint collBefore = IERC20(coll).balanceOf(address(this));
        IERC20(_token).approve(address(cdp), amount);
        cdp.liquidate(coll, borrower, amount);
        seized = IERC20(coll).balanceOf(address(this)) - collBefore;

        // Real exit: dump the seized GOLDST into the deepest on-chain USDST venue.
        IERC20(coll).approve(address(pool), seized);
        proceeds = pool.swap(true, seized, 1, block.timestamp + 3600);

        endBalance = IERC20(_token).balanceOf(address(this));
        profit = endBalance > (amount + fee) ? endBalance - (amount + fee) : 0;
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 1 via the vendor's desk, for the comparison column.
contract DeskLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public borrower;
    address public desk;
    uint public seized;
    uint public proceeds;
    uint public profit;

    function init(address _lender, address _cdp, address _usdst, address _coll, address _desk) public {
        lender = FlashMint(_lender); cdp = CDPEngine(_cdp);
        usdst = _usdst; coll = _coll; desk = _desk;
    }

    function run(address _borrower, uint repay) public {
        borrower = _borrower;
        lender.flashLoan(address(this), repay, "liq");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint collBefore = IERC20(coll).balanceOf(address(this));
        IERC20(_token).approve(address(cdp), amount);
        cdp.liquidate(coll, borrower, amount);
        seized = IERC20(coll).balanceOf(address(this)) - collBefore;

        IERC20(coll).approve(desk, seized);
        proceeds = OTCDesk(desk).settle(coll, seized, usdst);

        uint bal = IERC20(_token).balanceOf(address(this));
        profit = bal > (amount + fee) ? bal - (amount + fee) : 0;
        return "FlashMint.onFlashMint";
    }
}

/// @notice Greedy: keep liquidating optimally-sized chunks and dumping them until the pool
///         stops paying enough to recycle. Measures TOTAL single-transaction extraction.
contract GreedyPoolLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    Pool public pool;
    address public usdst;
    address public coll;
    address public borrower;
    uint public chunk;
    uint public maxIters;
    uint public goldPrice;

    uint public iterations;
    uint public totalRepaid;
    uint public netProfit;
    uint public lastExpected;

    function init(address _lender, address _cdp, address _pool, address _usdst, address _coll, uint _price) public {
        lender = FlashMint(_lender); cdp = CDPEngine(_cdp); pool = Pool(_pool);
        usdst = _usdst; coll = _coll; goldPrice = _price;
    }

    function run(address _borrower, uint _chunk, uint _maxIters) public {
        borrower = _borrower; chunk = _chunk; maxIters = _maxIters;
        lender.flashLoan(address(this), _chunk, "greedy");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint i = 0;
        while (i < maxIters) {
            if (IERC20(_token).balanceOf(address(this)) < chunk) break;

            // Only commit to another cycle if the pool will still pay more than the chunk.
            uint g = ((chunk + chunk / 10) * 1e18) / goldPrice;
            uint swapFee = (g * 30) / 10000;
            uint expected = pool.getInputPrice(g - swapFee, pool.tokenABalance(), pool.tokenBBalance());
            lastExpected = expected;
            if (expected <= chunk) break;

            uint collBefore = IERC20(coll).balanceOf(address(this));
            IERC20(_token).approve(address(cdp), chunk);
            cdp.liquidate(coll, borrower, chunk);
            uint got = IERC20(coll).balanceOf(address(this)) - collBefore;
            if (got == 0) break;

            IERC20(coll).approve(address(pool), got);
            pool.swap(true, got, 1, block.timestamp + 3600);

            totalRepaid += chunk;
            i += 1;
        }
        iterations = i;
        uint end = IERC20(_token).balanceOf(address(this));
        netProfit = end > (amount + fee) ? end - (amount + fee) : 0;
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 4, buying collateral from a REAL Pool.
contract PoolLeverager {
    FlashMint public lender;
    CDPEngine public cdp;
    Pool public pool;
    address public usdst;
    address public coll;
    uint public bought;
    uint public finalCollateral;
    uint public finalDebt;
    uint public mintedBack;

    function init(address _lender, address _cdp, address _pool, address _usdst, address _coll) public {
        lender = FlashMint(_lender); cdp = CDPEngine(_cdp); pool = Pool(_pool);
        usdst = _usdst; coll = _coll;
    }

    function openEquity() public {
        uint bal = IERC20(coll).balanceOf(address(this));
        IERC20(coll).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(coll, bal);
    }

    function lever(uint borrowUSDST) public {
        lender.flashLoan(address(this), borrowUSDST, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        IERC20(_token).approve(address(pool), amount);
        bought = pool.swap(false, amount, 1, block.timestamp + 3600);   // USDST -> GOLDST

        IERC20(coll).approve(address(cdp.registry().cdpVault()), bought);
        cdp.deposit(coll, bought);
        mintedBack = cdp.mintMax(coll);

        (finalCollateral, finalDebt) = cdp.vaults(address(this), coll);
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 4 via the desk, for the comparison column.
contract DeskLeverager {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public desk;
    uint public bought;
    uint public finalCollateral;
    uint public finalDebt;
    uint public mintedBack;

    function init(address _lender, address _cdp, address _usdst, address _coll, address _desk) public {
        lender = FlashMint(_lender); cdp = CDPEngine(_cdp);
        usdst = _usdst; coll = _coll; desk = _desk;
    }

    function openEquity() public {
        uint bal = IERC20(coll).balanceOf(address(this));
        IERC20(coll).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(coll, bal);
    }

    function lever(uint borrowUSDST) public {
        lender.flashLoan(address(this), borrowUSDST, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        IERC20(_token).approve(desk, amount);
        bought = OTCDesk(desk).settle(_token, amount, coll);

        IERC20(coll).approve(address(cdp.registry().cdpVault()), bought);
        cdp.deposit(coll, bought);
        mintedBack = cdp.mintMax(coll);

        (finalCollateral, finalDebt) = cdp.vaults(address(this), coll);
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Amm_PriceImpact is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;
    PriceOracle oracle;
    AdminRegistry admin;
    PoolFactory pf;
    OTCDesk desk;

    address USDST;
    Token usdstT;

    uint GOLD_RES;      // 53.71e18
    uint USDST_RES;     // 239,376e18
    uint GOLD_PRICE;    // oracle price, pinned to the pool's implied price
    uint WHALE_DEBT;    // 1,483,780e18
    uint WHALE_REPAY;   // 741,890e18  (50% close factor)

    uint LR; uint MINCR; uint PEN; uint CF; uint SFR; uint FLOOR_; uint CEIL_; uint WAD;

    // recorded
    uint optRepay; uint optProfit; uint breakEven;
    uint whaleSeized; uint whaleProceeds; uint whaleShortfall; uint whaleDeskProfit;
    bool whaleRevertedRealPool;
    uint r50kSeized; uint r50kProceeds; uint r100kProceeds; uint r100kSeized;
    uint greedyIters; uint greedyTotalRepaid; uint greedyProfit;
    uint greedyBest7000; uint greedyBest2000; uint greedyBest500;
    uint greedyIt7000; uint greedyIt2000; uint greedyIt500;
    uint levDeskColl; uint levDeskDebt; uint levDeskMinted;
    uint levPoolBought; uint levPoolShortfall; bool levPoolReverted;
    uint levMaxFeasible; uint levPoolBoughtAtMax; uint levMintedAtMax;
    uint goldFloatAllVenues;

    function beforeAll() public {
        bypassAuthorizations = true;

        WAD = 1e18;
        LR = 150e16; MINCR = 155e16; PEN = 1000; CF = 5000;
        SFR = 1e27; FLOOR_ = 1e18; CEIL_ = 1e30;

        GOLD_RES  = 5371e16;
        USDST_RES = 239376e18;
        WHALE_DEBT  = 1483780e18;
        WHALE_REPAY = 741890e18;
        goldFloatAllVenues = 546e17;    // 54.6 GOLDST across ALL AMM venues

        m = new Mercata();
        cdp = m.cdpEngine(); cdpVault = m.cdpVault(); reg = m.cdpRegistry();
        oracle = m.priceOracle(); admin = m.adminRegistry(); pf = m.poolFactory();
        fm = m.flashMint();

        USDST = m.tokenFactory().createToken("USDST", "USD Stable", [], [], [], "USDST", 0, 18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);

        // The oracle price that makes the pool sit at EXACT parity: 239,376 / 53.71
        GOLD_PRICE = (USDST_RES * 1e18) / GOLD_RES;

        desk = new OTCDesk();
        desk.setPrice(USDST, 1e18);
    }

    // ── fresh GOLDST + pool at mainnet depth, oracle pinned to pool parity ──
    function _newGold(string sym) internal returns (address, address) {
        address gold = m.tokenFactory().createToken("GOLDST", "Gold", [], [], [], sym, 0, 18);
        Token(gold).setStatus(2);
        Token(gold).mint(address(this), 100000e18);
        usdstT.mint(address(this), 20000000e18);

        oracle.setAssetPrice(gold, GOLD_PRICE);
        cdp.setCollateralAssetParams(gold, LR, MINCR, PEN, CF, SFR, FLOOR_, CEIL_, WAD, false);
        desk.setPrice(gold, GOLD_PRICE);

        address p = pf.createPool(gold, USDST);
        Token lp = Pool(p).lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", p);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", p);

        require(IERC20(gold).approve(p, GOLD_RES), "gold approve");
        require(IERC20(USDST).approve(p, USDST_RES), "usdst approve");
        Pool(p).addLiquidity(USDST_RES, GOLD_RES, block.timestamp + 3600);
        require(Pool(p).tokenABalance() == GOLD_RES && Pool(p).tokenBBalance() == USDST_RES, "seeded");
        return (p, gold);
    }

    /// Build a liquidatable vault with an exact debt, at CR ~1.45, without moving the oracle
    /// away from pool parity: mint under a temporarily high price, then restore parity.
    function _newLiquidatableVault(address gold, uint debt) internal returns (address) {
        uint collateral = (145 * debt) / (100 * (GOLD_PRICE / 1e18));   // CR 1.45 at GOLD_PRICE
        Token(gold).mint(address(this), collateral);

        User b = new User();
        Token(gold).transfer(address(b), collateral);

        oracle.setAssetPrice(gold, GOLD_PRICE * 2);                 // temporarily healthy
        b.callFunction(gold, "approve", address(cdpVault), collateral);
        b.callFunction(address(cdp), "deposit", gold, collateral);
        b.callFunction(address(cdp), "mint", gold, debt);
        oracle.setAssetPrice(gold, GOLD_PRICE);                     // back to pool parity

        require(cdp.collateralizationRatio(address(b), gold) < LR, "vault must be liquidatable");
        return address(b);
    }

    // ── pure pricing helpers on the real Pool arithmetic (no state change) ──
    function _saleProceeds(Pool pool, uint goldIn) internal view returns (uint) {
        uint fee = (goldIn * 30) / 10000;              // effective 30 bps
        return pool.getInputPrice(goldIn - fee, GOLD_RES, USDST_RES);
    }

    function _seizeFor(uint repay) internal view returns (uint) {
        return ((repay + repay / 10) * WAD) / GOLD_PRICE;
    }

    // ─────────────────────────────────────────────────────────────────────
    // D. LIQUIDATION: how much of the 10% bonus survives real slippage?
    // ─────────────────────────────────────────────────────────────────────

    /// The headline: a $741,890 liquidation (50% close factor on ONE mainnet whale vault)
    /// cannot be closed atomically against the real AMM — the flash mint cannot be repaid.
    function it_d1_whale_50pct_close_factor_cannot_be_closed_atomically() public {
        (address p, address gold) = _newGold("GA");
        address borrower = _newLiquidatableVault(gold, WHALE_DEBT);

        // What the vendor's desk says: a clean 10% bonus.
        usdstT.mint(address(desk), 5000000e18);
        Token(gold).mint(address(desk), 1e18);
        DeskLiquidator dl = new DeskLiquidator();
        dl.init(address(fm), address(cdp), USDST, gold, address(desk));
        dl.run(borrower, WHALE_REPAY);
        whaleDeskProfit = dl.profit();
        require(whaleDeskProfit + 1e18 >= WHALE_REPAY / 10 && whaleDeskProfit <= WHALE_REPAY / 10,
            "desk reproduces the vendor's clean 10% bonus (to within rounding dust)");

        // What the real pool says. Fresh pool + fresh vault so the desk run above cannot help.
        (address p2, address gold2) = _newGold("GB");
        address borrower2 = _newLiquidatableVault(gold2, WHALE_DEBT);

        whaleSeized = _seizeFor(WHALE_REPAY);
        whaleProceeds = _saleProceeds(Pool(p2), whaleSeized);
        whaleShortfall = WHALE_REPAY - whaleProceeds;

        PoolLiquidator pl = new PoolLiquidator();
        pl.init(address(fm), address(cdp), p2, USDST, gold2);
        try {
            pl.run(borrower2, WHALE_REPAY);
        } catch {
            whaleRevertedRealPool = true;
        }
        require(whaleRevertedRealPool, "$741,890 liquidation MUST revert against the real pool");
        require(whaleProceeds < WHALE_REPAY, "sale proceeds fall short of the principal");
        require(whaleShortfall > 500000e18, "shortfall is over half a million USDST");

        // The seized collateral alone is >3x every GOLDST token in every AMM venue combined.
        require(whaleSeized > goldFloatAllVenues * 3, "seizure dwarfs the entire GOLDST AMM float");
    }

    /// Establish the exact break-even and profit-maximising liquidation sizes.
    function it_d2_break_even_and_optimal_size() public {
        (address p, address gold) = _newGold("GC");
        Pool pool = Pool(p);

        // break-even: largest repay whose seized collateral still sells for >= repay
        uint lo = 1e18;
        uint hi = 2000000e18;
        uint i = 0;
        while (i < 60) {
            uint mid = (lo + hi) / 2;
            if (_saleProceeds(pool, _seizeFor(mid)) >= mid) { lo = mid; } else { hi = mid; }
            i += 1;
        }
        breakEven = lo;
        require(_saleProceeds(pool, _seizeFor(breakEven)) >= breakEven, "break-even holds");
        require(_saleProceeds(pool, _seizeFor(breakEven + 1e18)) < breakEven + 1e18, "and is tight");

        // profit-maximising size, by scan
        uint best = 0; uint bestR = 0;
        uint step = 100e18;
        uint r = step;
        while (r <= 40000e18) {
            uint pr = _saleProceeds(pool, _seizeFor(r));
            if (pr > r) {
                uint gain = pr - r;
                if (gain > best) { best = gain; bestR = r; }
            }
            r += step;
        }
        optRepay = bestR; optProfit = best;

        require(optProfit > 0, "some liquidation size is profitable");
        require(optProfit < 1000e18, "but the max single-shot profit is under $1,000");
        require(breakEven < 25000e18, "break-even repay is under $25k of debt");
        require(breakEven * 25 < WHALE_REPAY, "break-even is under 4% of one whale's close factor");
    }

    /// Mid-size rows for the table, and a LIVE confirmation that a $100k liquidation reverts.
    function it_d3_mid_size_rows_and_live_boundary() public {
        (address p, address gold) = _newGold("GD");
        Pool pool = Pool(p);

        r50kSeized  = _seizeFor(50000e18);
        r50kProceeds = _saleProceeds(pool, r50kSeized);
        r100kSeized = _seizeFor(100000e18);
        r100kProceeds = _saleProceeds(pool, r100kSeized);
        require(r50kProceeds < 50000e18, "50k liquidation is under water");
        require(r100kProceeds < 100000e18, "100k liquidation is under water");

        // LIVE: just under break-even succeeds, well over it reverts.
        address borrower = _newLiquidatableVault(gold, 400000e18);
        PoolLiquidator ok = new PoolLiquidator();
        ok.init(address(fm), address(cdp), p, USDST, gold);
        ok.run(borrower, 5000e18);
        require(ok.profit() > 0, "a small liquidation IS atomically profitable");

        (address p2, address gold2) = _newGold("GE");
        address borrower2 = _newLiquidatableVault(gold2, 400000e18);
        PoolLiquidator bad = new PoolLiquidator();
        bad.init(address(fm), address(cdp), p2, USDST, gold2);
        bool reverted = false;
        try { bad.run(borrower2, 100000e18); } catch { reverted = true; }
        require(reverted, "a 100k liquidation must revert (FlashMint: not repaid)");
    }

    function _greedy(string sym, uint chunk, uint iters) internal returns (uint, uint, uint) {
        (address p, address gold) = _newGold(sym);
        address borrower = _newLiquidatableVault(gold, 1000000e18);
        GreedyPoolLiquidator g = new GreedyPoolLiquidator();
        g.init(address(fm), address(cdp), p, USDST, gold, GOLD_PRICE);
        g.run(borrower, chunk, iters);
        return (g.netProfit(), g.iterations(), g.totalRepaid());
    }

    /// Total value extractable in ONE transaction by recycling chunks. Scans chunk sizes: the
    /// limit of infinitely-fine chunking is the whole area between the AMM curve and oracle
    /// parity, so this is a tight upper bound on single-transaction liquidation MEV.
    function it_d4_total_single_tx_extraction() public {
        (uint pr1, uint it1, uint tr1) = _greedy("GF1", 7000e18, 60);
        (uint pr2, uint it2, uint tr2) = _greedy("GF2", 2000e18, 60);
        (uint pr3, uint it3, uint tr3) = _greedy("GF3", 500e18, 80);

        greedyProfit = pr1; greedyIters = it1; greedyTotalRepaid = tr1;
        if (pr2 > greedyProfit) { greedyProfit = pr2; greedyIters = it2; greedyTotalRepaid = tr2; }
        if (pr3 > greedyProfit) { greedyProfit = pr3; greedyIters = it3; greedyTotalRepaid = tr3; }

        greedyBest7000 = pr1; greedyBest2000 = pr2; greedyBest500 = pr3;
        greedyIt7000 = it1; greedyIt2000 = it2; greedyIt500 = it3;

        require(greedyProfit > 0, "greedy recycling nets something");
        require(greedyProfit < 1000e18, "total single-tx extraction is under $1,000");
        require(it3 > it1, "finer chunking runs more cycles");
    }

    // ─────────────────────────────────────────────────────────────────────
    // E. ONE-SHOT LEVERAGE: the vendor's minCR trace against a real pool
    // ─────────────────────────────────────────────────────────────────────

    /// The desk version reaches minCR exactly as the vendor claims.
    function it_e1_leverage_desk_reaches_mincr() public {
        (address p, address gold) = _newGold("GG");
        Token(gold).mint(address(desk), 100000e18);
        usdstT.mint(address(desk), 10000000e18);

        DeskLeverager d = new DeskLeverager();
        d.init(address(fm), address(cdp), USDST, gold, address(desk));
        // $100,000 of equity, exactly the vendor's shape
        uint equity = (100000e18 * 1e18) / GOLD_PRICE;
        Token(gold).mint(address(d), equity);
        d.openEquity();
        d.lever(150000e18);

        levDeskColl = d.finalCollateral();
        levDeskDebt = d.finalDebt();
        levDeskMinted = d.mintedBack();
        require(levDeskMinted >= 150000e18, "desk leverage covers the flash principal");
        uint cr = cdp.collateralizationRatio(address(d), gold);
        require(cr >= MINCR && cr < MINCR + 1e16, "desk position lands at minCR");
    }

    /// The same trade against the real pool cannot repay the flash mint at all.
    function it_e2_leverage_real_pool_reverts() public {
        (address p, address gold) = _newGold("GH");
        Pool pool = Pool(p);

        uint equity = (100000e18 * 1e18) / GOLD_PRICE;
        PoolLeverager l = new PoolLeverager();
        l.init(address(fm), address(cdp), p, USDST, gold);
        Token(gold).mint(address(l), equity);
        l.openEquity();

        // pre-compute what the pool would actually sell
        uint fee = (150000e18 * 30) / 10000;
        uint bought = pool.getInputPrice(150000e18 - fee, USDST_RES, GOLD_RES);
        levPoolBought = bought;
        uint mintable = ((equity + bought) * GOLD_PRICE / 1e18) * 1e18 / MINCR;
        levPoolShortfall = 150000e18 > mintable ? 150000e18 - mintable : 0;

        try { l.lever(150000e18); } catch { levPoolReverted = true; }
        require(levPoolReverted, "levering 150k against the real pool MUST revert");
        require(levPoolShortfall > 0, "mintMax cannot cover the flash principal");
    }

    /// Largest borrow that a $100,000 equity position can actually lever through the real pool.
    function it_e3_max_feasible_leverage() public {
        (address p, address gold) = _newGold("GI");
        Pool pool = Pool(p);
        uint equity = (100000e18 * 1e18) / GOLD_PRICE;

        uint lo = 1e18; uint hi = 300000e18; uint i = 0;
        while (i < 50) {
            uint mid = (lo + hi) / 2;
            uint fee = (mid * 30) / 10000;
            uint bought = pool.getInputPrice(mid - fee, USDST_RES, GOLD_RES);
            uint mintable = ((equity + bought) * GOLD_PRICE / 1e18) * 1e18 / MINCR;
            if (mintable >= mid) { lo = mid; } else { hi = mid; }
            i += 1;
        }
        levMaxFeasible = lo;
        uint f = (levMaxFeasible * 30) / 10000;
        levPoolBoughtAtMax = pool.getInputPrice(levMaxFeasible - f, USDST_RES, GOLD_RES);
        levMintedAtMax = ((equity + levPoolBoughtAtMax) * GOLD_PRICE / 1e18) * 1e18 / MINCR;

        require(levMaxFeasible < 150000e18, "the vendor's 150k is above what the market allows");
        require(levMaxFeasible > 50000e18, "but some leverage is still reachable");

        // LIVE confirmation at the boundary.
        PoolLeverager l = new PoolLeverager();
        l.init(address(fm), address(cdp), p, USDST, gold);
        Token(gold).mint(address(l), equity);
        l.openEquity();
        l.lever((levMaxFeasible * 99) / 100);
        require(l.mintedBack() > 0, "boundary leverage actually executes");
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRINT CHANNEL
    // ─────────────────────────────────────────────────────────────────────

    function it_zz_print_5_whale() public {
        log(
            "WHALE LIQUIDATION | oracle GOLDST=" + string(GOLD_PRICE) +
            " (== pool parity, zero pre-existing arb) | repay=" + string(WHALE_REPAY) +
            " seized_GOLDST=" + string(whaleSeized) +
            " real_pool_proceeds=" + string(whaleProceeds) +
            " SHORTFALL=" + string(whaleShortfall) +
            " | desk_profit(vendor)=" + string(whaleDeskProfit) +
            " real_pool=REVERTED(" + string(whaleRevertedRealPool ? 1 : 0) + ")");
    }

    function it_zz_print_6_bonus_survival() public {
        log(
            "BONUS SURVIVAL vs 53.71 GOLD/239,376 USDST | optimal_repay=" + string(optRepay) +
            " max_profit=" + string(optProfit) +
            " | break_even_repay=" + string(breakEven) +
            " | 50k: seized=" + string(r50kSeized) + " proceeds=" + string(r50kProceeds) +
            " | 100k: seized=" + string(r100kSeized) + " proceeds=" + string(r100kProceeds));
    }

    function it_zz_print_7_greedy() public {
        log(
            "GREEDY SINGLE-TX EXTRACTION (max liquidation MEV in one tx) | BEST netProfit=" +
            string(greedyProfit) + " iters=" + string(greedyIters) + " totalRepaid=" + string(greedyTotalRepaid) +
            " || chunk7000: profit=" + string(greedyBest7000) + " iters=" + string(greedyIt7000) +
            " | chunk2000: profit=" + string(greedyBest2000) + " iters=" + string(greedyIt2000) +
            " | chunk500: profit=" + string(greedyBest500) + " iters=" + string(greedyIt500));
    }

    function it_zz_print_8_leverage() public {
        log(
            "LEVERAGE 100k equity, borrow 150k | DESK: collateral=" + string(levDeskColl) +
            " debt=" + string(levDeskDebt) + " minted=" + string(levDeskMinted) +
            " | REAL POOL: bought_GOLDST=" + string(levPoolBought) +
            " mintMax_shortfall=" + string(levPoolShortfall) +
            " reverted=" + string(levPoolReverted ? 1 : 0) +
            " | MAX FEASIBLE BORROW=" + string(levMaxFeasible) +
            " bought=" + string(levPoolBoughtAtMax) + " mintable=" + string(levMintedAtMax));
    }
}
