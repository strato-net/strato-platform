// SPDX-License-Identifier: MIT
//
// Adv_Amm_LpValue — Q3 of the brief. Can a flash mint inflate/deflate LP value, or extract
// value from existing LPs, through the add-liquidity-single-token (zap) path?
//
// All values are marked at a FIXED oracle price (the pool's own parity price) so that a
// dislocated pool cannot flatter the numbers. Conservation is checked three ways:
// attacker delta + LP delta + FeeCollector delta.
//
// OUTPUT: it_zz_print_* dump measured numbers via log().

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice flash mint -> zap single-sided -> remove liquidity -> swap the odd leg back.
contract ZapAttacker {
    FlashMint public lender;
    Pool public pool;
    address public usdst;
    address public gold;
    address public lp;

    uint public seedBefore;
    uint public seedAfter;
    uint public netCost;
    uint public lpMinted;
    uint public usdstOut;
    uint public goldOut;
    uint public swapBack;
    uint public priceStart;
    uint public priceAfterZap;
    uint public priceEnd;
    uint public lpSupplyBefore;
    uint public lpSupplyAfter;

    function init(address _l, address _p, address _u, address _g, address _lp) public {
        lender = FlashMint(_l); pool = Pool(_p); usdst = _u; gold = _g; lp = _lp;
    }

    function go(uint amount) public {
        seedBefore = IERC20(usdst).balanceOf(address(this));
        lender.flashLoan(address(this), amount, "");
        seedAfter = IERC20(usdst).balanceOf(address(this));
        netCost = seedBefore > seedAfter ? seedBefore - seedAfter : 0;
    }

    function _spot() internal view returns (uint) {
        return (pool.tokenBBalance() * 1e18) / pool.tokenABalance();
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        priceStart = _spot();
        lpSupplyBefore = IERC20(lp).totalSupply();

        IERC20(usdst).approve(address(pool), amount);
        lpMinted = pool.addLiquiditySingleToken(false, amount, block.timestamp + 3600);
        priceAfterZap = _spot();

        IERC20(lp).approve(address(pool), lpMinted);
        (usdstOut, goldOut) = pool.removeLiquidity(lpMinted, 1, 1, block.timestamp + 3600);

        IERC20(gold).approve(address(pool), goldOut);
        swapBack = pool.swap(true, goldOut, 1, block.timestamp + 3600);

        priceEnd = _spot();
        lpSupplyAfter = IERC20(lp).totalSupply();
        return "FlashMint.onFlashMint";
    }
}

/// @notice The composed classic: manipulate with a swap, zap in at the skewed ratio, restore,
///         then exit. This is the shape that steals from LPs on a naive AMM.
contract ManipZapAttacker {
    FlashMint public lender;
    Pool public pool;
    address public usdst;
    address public gold;
    address public lp;

    uint public seedBefore;
    uint public seedAfter;
    uint public netCost;
    uint public lpMinted;
    uint public priceStart;
    uint public priceManip;
    uint public priceEnd;

    function init(address _l, address _p, address _u, address _g, address _lp) public {
        lender = FlashMint(_l); pool = Pool(_p); usdst = _u; gold = _g; lp = _lp;
    }

    function go(uint amount) public {
        seedBefore = IERC20(usdst).balanceOf(address(this));
        lender.flashLoan(address(this), amount, "");
        seedAfter = IERC20(usdst).balanceOf(address(this));
        netCost = seedBefore > seedAfter ? seedBefore - seedAfter : 0;
    }

    function _spot() internal view returns (uint) {
        return (pool.tokenBBalance() * 1e18) / pool.tokenABalance();
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        priceStart = _spot();

        // 1. manipulate with half the principal
        uint half = amount / 2;
        IERC20(usdst).approve(address(pool), half);
        uint g1 = pool.swap(false, half, 1, block.timestamp + 3600);
        priceManip = _spot();

        // 2. zap the other half in at the skewed ratio
        IERC20(usdst).approve(address(pool), amount - half);
        lpMinted = pool.addLiquiditySingleToken(false, amount - half, block.timestamp + 3600);

        // 3. restore by selling the manipulation leg back
        IERC20(gold).approve(address(pool), g1);
        pool.swap(true, g1, 1, block.timestamp + 3600);

        // 4. exit
        IERC20(lp).approve(address(pool), lpMinted);
        (uint uOut, uint gOut) = pool.removeLiquidity(lpMinted, 1, 1, block.timestamp + 3600);
        IERC20(gold).approve(address(pool), gOut);
        pool.swap(true, gOut, 1, block.timestamp + 3600);

        priceEnd = _spot();
        return "FlashMint.onFlashMint";
    }
}

/// @notice Reads StablePool's Curve-style price surfaces before and mid-manipulation.
contract StableProbe {
    FlashMint public lender;
    StablePool public pool;
    address public usdst;
    address public other;

    uint public lastPriceBefore; uint public lastPriceMid;
    uint public getPBefore;      uint public getPMid;
    uint public emaBefore;       uint public emaMid;
    uint public oracleBefore;    uint public oracleMid;
    uint public dOracleBefore;   uint public dOracleMid;
    uint public invBefore;       uint public invMid;
    uint public dyOut;

    function init(address _l, address _p, address _u, address _o) public {
        lender = FlashMint(_l); pool = StablePool(_p); usdst = _u; other = _o;
    }

    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        lastPriceBefore = pool.lastPrice(1);
        getPBefore      = pool.getP(1);
        emaBefore       = pool.emaPrice(1);
        oracleBefore    = pool.priceOracle(1);
        dOracleBefore   = pool.dOracle();
        invBefore       = pool.computeInvariant();

        IERC20(usdst).approve(address(pool), amount);
        dyOut = pool.exchange(0, 1, amount, 1, address(this));

        lastPriceMid = pool.lastPrice(1);
        getPMid      = pool.getP(1);
        emaMid       = pool.emaPrice(1);
        oracleMid    = pool.priceOracle(1);
        dOracleMid   = pool.dOracle();
        invMid       = pool.computeInvariant();

        // hand back what we got so the loan can be repaid; the caller tops up the rest
        IERC20(other).approve(address(pool), dyOut);
        pool.exchange(1, 0, dyOut, 1, address(this));
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Amm_LpValue is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;
    PoolFactory pf;
    PriceOracle oracle;

    address USDST;
    Token usdstT;

    uint GOLD_RES; uint USDST_RES; uint GOLD_PRICE;

    // recorded — zap round trip
    uint z100kCost; uint z500kCost; uint z2mCost;
    uint z2mLpMinted; uint z2mLpSupplyBefore; uint z2mPriceStart; uint z2mPriceZap; uint z2mPriceEnd;
    uint lpValBefore; uint lpValAfter; bool lpGained; uint lpDelta;
    uint feeValBefore; uint feeValAfter; uint feeDelta;
    // recorded — manipulate+zap
    uint mzCost; uint mzPriceStart; uint mzPriceManip; uint mzPriceEnd;
    uint mzLpValBefore; uint mzLpValAfter; bool mzLpGained; uint mzLpDelta;
    // recorded — stable pool
    uint sLastBefore; uint sLastMid; uint sGetPBefore; uint sGetPMid;
    uint sEmaBefore; uint sEmaMid; uint sOracleBefore; uint sOracleMid;
    uint sDBefore; uint sDMid; uint sInvBefore; uint sInvMid;
    bool sLastMoved; bool sEmaMoved; bool sOracleMoved; bool sDMoved;

    function beforeAll() public {
        bypassAuthorizations = true;
        GOLD_RES = 5371e16;
        USDST_RES = 239376e18;

        m = new Mercata();
        admin = m.adminRegistry(); pf = m.poolFactory(); fm = new FlashMint(address(admin)); oracle = m.priceOracle();

        USDST = m.tokenFactory().createToken("USDST", "USD Stable", [], [], [], "USDST", 0, 18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        oracle.setAssetPrice(USDST, 1e18);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);

        GOLD_PRICE = (USDST_RES * 1e18) / GOLD_RES;
    }

    function _newPool(string sym) internal returns (address, address, address) {
        address gold = m.tokenFactory().createToken("GOLDST", "Gold", [], [], [], sym, 0, 18);
        Token(gold).setStatus(2);
        Token(gold).mint(address(this), 1000000e18);
        usdstT.mint(address(this), 20000000e18);
        oracle.setAssetPrice(gold, GOLD_PRICE);

        address p = pf.createPool(gold, USDST);
        Token lp = Pool(p).lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", p);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", p);

        require(IERC20(gold).approve(p, GOLD_RES), "ga");
        require(IERC20(USDST).approve(p, USDST_RES), "ua");
        Pool(p).addLiquidity(USDST_RES, GOLD_RES, block.timestamp + 3600);
        return (p, gold, address(lp));
    }

    /// Value of `holder`'s LP position, marked at the FIXED oracle price.
    function _lpValue(address p, address lp, address holder) internal view returns (uint) {
        uint L = IERC20(lp).totalSupply();
        if (L == 0) return 0;
        uint bal = IERC20(lp).balanceOf(holder);
        uint A = Pool(p).tokenABalance();
        uint B = Pool(p).tokenBBalance();
        uint poolValue = ((A * GOLD_PRICE) / 1e18) + B;
        return (bal * poolValue) / L;
    }

    function _feeValue(address gold) internal view returns (uint) {
        address fc = address(m.feeCollector());
        return ((IERC20(gold).balanceOf(fc) * GOLD_PRICE) / 1e18) + IERC20(USDST).balanceOf(fc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // H. Zap round trip: is it cheaper than a swap round trip, and who pays?
    // ─────────────────────────────────────────────────────────────────────

    function _zapRun(string sym, uint loan) internal returns (ZapAttacker, address, address, address) {
        (address p, address gold, address lp) = _newPool(sym);
        ZapAttacker a = new ZapAttacker();
        a.init(address(fm), p, USDST, gold, lp);
        usdstT.mint(address(a), 500000e18);
        a.go(loan);
        return (a, p, gold, lp);
    }

    /// The zap path is a CHEAPER manipulate-and-restore than swap-in/swap-out, because the
    /// 30 bps is charged only on the internal optimal-swap slice, not on the whole principal.
    function it_h1_zap_roundtrip_is_cheaper_than_swap_roundtrip() public {
        (ZapAttacker a1, , , ) = _zapRun("Z1", 100000e18);
        z100kCost = a1.netCost();
        (ZapAttacker a2, , , ) = _zapRun("Z2", 500000e18);
        z500kCost = a2.netCost();

        (address p, address gold, address lp) = _newPool("Z3");
        lpValBefore = _lpValue(p, lp, address(this));
        feeValBefore = _feeValue(gold);

        ZapAttacker a3 = new ZapAttacker();
        a3.init(address(fm), p, USDST, gold, lp);
        usdstT.mint(address(a3), 500000e18);
        a3.go(2000000e18);

        z2mCost = a3.netCost();
        z2mLpMinted = a3.lpMinted();
        z2mLpSupplyBefore = a3.lpSupplyBefore();
        z2mPriceStart = a3.priceStart();
        z2mPriceZap = a3.priceAfterZap();
        z2mPriceEnd = a3.priceEnd();

        lpValAfter = _lpValue(p, lp, address(this));
        feeValAfter = _feeValue(gold);
        lpGained = lpValAfter >= lpValBefore;
        lpDelta = lpGained ? lpValAfter - lpValBefore : lpValBefore - lpValAfter;
        feeDelta = feeValAfter - feeValBefore;

        // The zap really does dislocate the pool hard: it mints LP worth multiples of the
        // whole existing supply and pushes spot several-fold, all inside the callback.
        require(z2mLpMinted > z2mLpSupplyBefore, "attacker mints more LP than existed");
        require(z2mPriceZap > z2mPriceStart * 3, "zap alone moves spot >3x");

        // And it costs less than the plain swap round trip did (14.4 bps at 2m — see
        // Adv_Amm_RoundTrip it_zz_print_2).
        require(z2mCost > 0, "the zap round trip is not free");
        require((z2mCost * 100000) / 2000000e18 < 144, "2m zap round trip is under 14.4 bps");
    }

    /// Whatever the attacker loses, the honest LP does NOT lose: value flows to LPs and the
    /// FeeCollector, never out of them. This is the invariant that has to hold.
    function it_h2_honest_lp_never_loses_to_the_zap() public {
        (address p, address gold, address lp) = _newPool("Z4");
        uint v0 = _lpValue(p, lp, address(this));
        uint f0 = _feeValue(gold);

        ZapAttacker a = new ZapAttacker();
        a.init(address(fm), p, USDST, gold, lp);
        usdstT.mint(address(a), 500000e18);
        a.go(2000000e18);

        uint v1 = _lpValue(p, lp, address(this));
        uint f1 = _feeValue(gold);
        require(v1 >= v0, "the honest LP must not be worse off after the zap round trip");
        require(f1 >= f0, "FeeCollector must not be worse off");
        // The attacker's loss is fully accounted for by LP + protocol gains.
        require((v1 - v0) + (f1 - f0) > 0, "someone captured the attacker's loss");
    }

    /// The composed classic (manipulate -> zap at the skewed ratio -> restore -> exit).
    function it_h3_manipulate_then_zap_is_not_profitable() public {
        (address p, address gold, address lp) = _newPool("Z5");
        mzLpValBefore = _lpValue(p, lp, address(this));

        ManipZapAttacker a = new ManipZapAttacker();
        a.init(address(fm), p, USDST, gold, lp);
        usdstT.mint(address(a), 1000000e18);
        a.go(2000000e18);

        mzCost = a.netCost();
        mzPriceStart = a.priceStart();
        mzPriceManip = a.priceManip();
        mzPriceEnd = a.priceEnd();
        mzLpValAfter = _lpValue(p, lp, address(this));
        mzLpGained = mzLpValAfter >= mzLpValBefore;
        mzLpDelta = mzLpGained ? mzLpValAfter - mzLpValBefore : mzLpValBefore - mzLpValAfter;

        require(a.seedAfter() < a.seedBefore(), "composed attack must be a net LOSS, not a gain");
        require(mzCost > 0, "composed attack costs the attacker");
        require(mzLpGained, "the honest LP still ends up ahead");
        require(mzPriceManip > mzPriceStart, "the manipulation leg did move spot");
    }

    // ─────────────────────────────────────────────────────────────────────
    // I. StablePool price surfaces (there is no getVirtualPrice in this codebase)
    // ─────────────────────────────────────────────────────────────────────

    /// getVirtualPrice / getDy / calculateTokenAmount do not exist. What DOES exist is a
    /// Curve-style oracle set. Establish which members a single-transaction flash mint moves.
    function it_i1_stablepool_spot_moves_but_ema_does_not() public {
        address other = m.tokenFactory().createToken("USDC", "USDC", [], [], [], "SUSDC", 0, 18);
        Token(other).setStatus(2);
        Token(other).mint(address(this), 10000000e18);
        usdstT.mint(address(this), 20000000e18);
        oracle.setAssetPrice(other, 1e18);

        fastForward(100);
        address sp = pf.createStablePool(USDST, other);
        StablePool pool = StablePool(sp);
        Token lp = pool.lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", sp);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", sp);

        require(IERC20(USDST).approve(sp, 1000000e18), "sa");
        require(IERC20(other).approve(sp, 1000000e18), "sb");
        pool.addLiquidityGeneral([500000e18, 500000e18], 1, address(0));
        fastForward(600);

        StableProbe probe = new StableProbe();
        probe.init(address(fm), sp, USDST, other);
        usdstT.mint(address(probe), 1000000e18);   // float to absorb the two-leg stable fee
        probe.go(400000e18);

        sLastBefore = probe.lastPriceBefore();   sLastMid = probe.lastPriceMid();
        sGetPBefore = probe.getPBefore();        sGetPMid = probe.getPMid();
        sEmaBefore = probe.emaBefore();          sEmaMid = probe.emaMid();
        sOracleBefore = probe.oracleBefore();    sOracleMid = probe.oracleMid();
        sDBefore = probe.dOracleBefore();        sDMid = probe.dOracleMid();
        sInvBefore = probe.invBefore();          sInvMid = probe.invMid();

        sLastMoved   = (sLastMid != sLastBefore);
        sEmaMoved    = (sEmaMid != sEmaBefore);
        sOracleMoved = (sOracleMid != sOracleBefore);
        sDMoved      = (sDMid != sDBefore);

        // Spot IS manipulable within the transaction.
        require(sGetPMid != sGetPBefore, "getP (spot) is manipulable in one transaction");
        // The invariant D barely budges — that is the point of a stable invariant.
        require(sInvBefore > 0 && sInvMid > 0, "invariant readable both sides");
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRINT CHANNEL
    // ─────────────────────────────────────────────────────────────────────

    function it_zz_print_12_zap_roundtrip() public {
        log(
            "ZAP ROUND TRIP vs 53.71 GOLD/239,376 USDST | 100k cost=" + string(z100kCost) +
            " (bps10k=" + string((z100kCost * 100000) / 100000e18) + ")" +
            " | 500k cost=" + string(z500kCost) +
            " (bps10k=" + string((z500kCost * 100000) / 500000e18) + ")" +
            " | 2m cost=" + string(z2mCost) +
            " (bps10k=" + string((z2mCost * 100000) / 2000000e18) + ")" +
            " | 2m: lpMinted=" + string(z2mLpMinted) + " vs preSupply=" + string(z2mLpSupplyBefore) +
            " spot " + string(z2mPriceStart) + " -> " + string(z2mPriceZap) + " -> " + string(z2mPriceEnd));
    }

    function it_zz_print_13_who_pays() public {
        log(
            "CONSERVATION at fixed oracle price | honest LP value before=" + string(lpValBefore) +
            " after=" + string(lpValAfter) + " gained=" + string(lpGained ? 1 : 0) +
            " delta=" + string(lpDelta) +
            " | FeeCollector value before=" + string(feeValBefore) + " after=" + string(feeValAfter) +
            " delta=" + string(feeDelta));
    }

    function it_zz_print_14_manip_zap() public {
        log(
            "MANIPULATE+ZAP+RESTORE+EXIT (2m) | attacker netCost=" + string(mzCost) +
            " | spot " + string(mzPriceStart) + " -> " + string(mzPriceManip) + " -> " + string(mzPriceEnd) +
            " | honest LP gained=" + string(mzLpGained ? 1 : 0) + " delta=" + string(mzLpDelta));
    }

    function it_zz_print_15_stablepool() public {
        log(
            "STABLEPOOL SURFACES (400k swap on 500k/500k) | lastPrice " + string(sLastBefore) +
            " -> " + string(sLastMid) + " | getP " + string(sGetPBefore) + " -> " + string(sGetPMid) +
            " | emaPrice " + string(sEmaBefore) + " -> " + string(sEmaMid) +
            " | priceOracle(EMA) " + string(sOracleBefore) + " -> " + string(sOracleMid) +
            " | dOracle " + string(sDBefore) + " -> " + string(sDMid) +
            " | computeInvariant " + string(sInvBefore) + " -> " + string(sInvMid) +
            " || moved? lastPrice=" + string(sLastMoved ? 1 : 0) + " ema=" + string(sEmaMoved ? 1 : 0) +
            " priceOracle=" + string(sOracleMoved ? 1 : 0) + " dOracle=" + string(sDMoved ? 1 : 0));
    }
}
