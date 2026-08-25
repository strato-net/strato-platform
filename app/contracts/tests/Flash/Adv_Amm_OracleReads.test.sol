// SPDX-License-Identifier: MIT
//
// Adv_Amm_OracleReads — Q2 of the brief.
//   (F) EVERY PoolV3 pool on mainnet has observationCardinality == 1. Establish exactly what
//       that does to observe()/observeSingle(): does the TWAP collapse to spot?
//   (G) Is a mid-transaction manipulated pool price actually READ by anything during the
//       flash-mint callback window? Manipulate the deepest v2 pool 87x inside the callback and
//       read every price surface the protocol actually uses.
//
// OUTPUT: it_zz_print_* dump measured numbers via log().

import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Manipulates the v2 pool inside the flash-mint window and samples every price
///         surface the protocol actually consumes, then restores.
contract PriceProbe {
    FlashMint public lender;
    Pool public pool;
    PriceOracle public oracle;
    CDPEngine public cdp;
    address public usdst;
    address public gold;
    address public victim;

    uint public poolPriceBefore;
    uint public poolPriceMid;
    uint public poolPriceAfter;

    uint public oracleBefore;
    uint public oracleMid;
    uint public oracleTwapBefore;
    uint public oracleTwapMid;
    uint public crBefore;
    uint public crMid;

    bool public oracleUnmoved;
    bool public twapUnmoved;
    bool public crUnmoved;

    function init(address _l, address _p, address _o, address _c, address _u, address _g, address _v) public {
        lender = FlashMint(_l); pool = Pool(_p); oracle = PriceOracle(_o); cdp = CDPEngine(_c);
        usdst = _u; gold = _g; victim = _v;
    }

    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function _spot() internal view returns (uint) {
        return (pool.tokenBBalance() * 1e18) / pool.tokenABalance();
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        poolPriceBefore  = _spot();
        oracleBefore     = oracle.getAssetPrice(gold);
        oracleTwapBefore = oracle.getAssetPriceTwap(gold);
        crBefore         = cdp.collateralizationRatio(victim, gold);

        IERC20(usdst).approve(address(pool), amount);
        uint goldOut = pool.swap(false, amount, 1, block.timestamp + 3600);

        poolPriceMid  = _spot();
        oracleMid     = oracle.getAssetPrice(gold);
        oracleTwapMid = oracle.getAssetPriceTwap(gold);
        crMid         = cdp.collateralizationRatio(victim, gold);

        oracleUnmoved = (oracleMid == oracleBefore);
        twapUnmoved   = (oracleTwapMid == oracleTwapBefore);
        crUnmoved     = (crMid == crBefore);

        IERC20(gold).approve(address(pool), goldOut);
        pool.swap(true, goldOut, 1, block.timestamp + 3600);
        poolPriceAfter = _spot();

        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Amm_OracleReads is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;
    PoolFactory pf;
    PoolV3Factory v3f;
    PriceOracle oracle;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;

    address USDST;
    Token usdstT;

    uint constant Q96 = 79228162514264337593543950336;
    uint constant BIG = 100000000e18;
    uint GOLD_RES; uint USDST_RES; uint GOLD_PRICE;
    uint WAD; uint LR; uint MINCR;

    // recorded
    uint card0; uint cardNext0;
    bool sameTxTwapReverted;
    int tickX; int tickY;
    int twapShortAtCard1; int spotAtCard1;
    bool longWindowRevertedAtCard1;
    uint cardAfterGrow;
    int twapLongAtCard4; int spotAtCard4;
    int v3TickBefore; int v3TickMid; int v3TickAfter;
    int v3CumBefore; int v3CumAfter;

    uint probePriceBefore; uint probePriceMid; uint probePriceAfter;
    uint probeOracleBefore; uint probeOracleMid; uint probeCrBefore; uint probeCrMid;

    function beforeAll() public {
        bypassAuthorizations = true;
        WAD = 1e18; LR = 150e16; MINCR = 155e16;
        GOLD_RES = 5371e16;
        USDST_RES = 239376e18;

        m = new Mercata();
        admin = m.adminRegistry(); pf = m.poolFactory(); fm = m.flashMint();
        oracle = m.priceOracle(); cdp = m.cdpEngine(); cdpVault = m.cdpVault(); reg = m.cdpRegistry();

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

        GOLD_PRICE = (USDST_RES * 1e18) / GOLD_RES;

        v3f = new PoolV3Factory(address(this));
        v3f.initialize(address(m.tokenFactory()), address(m.feeCollector()));
    }

    // ── PoolV3 helper: fresh pair + pool at price 1.0, tick 0 ──
    function _newV3(string s0, string s1) internal returns (PoolV3, address, address) {
        address t0 = m.tokenFactory().createToken("T0", "T0", [], [], [], s0, 0, 18);
        address t1 = m.tokenFactory().createToken("T1", "T1", [], [], [], s1, 0, 18);
        Token(t0).setStatus(2); Token(t1).setStatus(2);
        Token(t0).mint(address(this), BIG); Token(t1).mint(address(this), BIG);
        address pa = v3f.createPoolV3(t0, t1, 3000, Q96);
        PoolV3 p = PoolV3(pa);
        require(ERC20(t0).approve(pa, BIG), "a0");
        require(ERC20(t1).approve(pa, BIG), "a1");
        p.mint(address(this), -6000, 6000, 100000e18, BIG, BIG, block.timestamp + 3600);
        return (p, t0, t1);
    }

    function _v3Swap(PoolV3 p, address t0, address t1, bool zeroForOne, uint amountIn) internal returns (uint) {
        address tin = zeroForOne ? t0 : t1;
        require(ERC20(tin).approve(address(p), amountIn), "sa");
        (int a0, int a1) = p.swap(address(this), zeroForOne, int(amountIn), 0, 1, block.timestamp + 3600);
        return uint(-(zeroForOne ? a1 : a0));
    }

    // ─────────────────────────────────────────────────────────────────────
    // F. observationCardinality == 1
    // ─────────────────────────────────────────────────────────────────────

    /// Every PoolV3 is BORN at cardinality 1 and stays there — matching all 5 mainnet pools.
    function it_f1_every_pool_is_born_at_cardinality_one() public {
        (PoolV3 p, address t0, address t1) = _newV3("F1A", "F1B");
        card0 = p.observationCardinality();
        cardNext0 = p.observationCardinalityNext();
        require(card0 == 1, "a fresh PoolV3 has observationCardinality == 1");
        require(cardNext0 == 1, "and next == 1, so swaps never grow the ring");

        // Swapping does not grow it.
        fastForward(60);
        _v3Swap(p, t0, t1, true, 500e18);
        require(p.observationCardinality() == 1, "cardinality stays 1 through swaps forever");
    }

    /// SAME-TRANSACTION TWAP IS IMPOSSIBLE at cardinality 1: the single slot was just
    /// overwritten with this block's timestamp, so any window > 0 predates it and reverts "OLD".
    /// This is why a flash mint cannot feed a manipulated TWAP to a same-tx consumer.
    function it_f2_same_tx_twap_reverts_OLD() public {
        (PoolV3 p, address t0, address t1) = _newV3("F2A", "F2B");
        fastForward(600);
        _v3Swap(p, t0, t1, true, 500e18);          // writes slot 0 with timestamp == now

        // window 0 still works (it is just "the cumulative right now"), a real window does not
        (int cumNow, ) = p.observeSingle(0);
        try {
            p.observeSingle(1);
            sameTxTwapReverted = false;
        } catch {
            sameTxTwapReverted = true;
        }
        require(sameTxTwapReverted, "observeSingle(1) in the swap's own block MUST revert (OLD)");
    }

    /// THE COLLAPSE. Two price regimes (tick X for 600s, then tick Y). At cardinality 1 the only
    /// answerable window is the one that started at the last write, so the "TWAP" returns Y
    /// exactly — the current tick — and any window long enough to include regime X reverts.
    function it_f3_twap_collapses_to_spot_at_cardinality_one() public {
        (PoolV3 p, address t0, address t1) = _newV3("F3A", "F3B");

        fastForward(60);
        _v3Swap(p, t0, t1, true, 500e18);          // regime X
        tickX = p.currentTick();
        fastForward(600);

        _v3Swap(p, t0, t1, true, 5000e18);         // regime Y (further manipulation)
        tickY = p.currentTick();
        require(tickY < tickX, "second swap must push the tick further");

        fastForward(10);
        spotAtCard1 = p.currentTick();

        // A 10s window: answerable, and it is EXACTLY the current tick.
        (int cum0, ) = p.observeSingle(0);
        (int cum10, ) = p.observeSingle(10);
        twapShortAtCard1 = (cum0 - cum10) / 10;
        require(twapShortAtCard1 == spotAtCard1, "10s TWAP == spot tick, bit for bit");

        // A 300s window would have to average across regime X. It cannot be served at all.
        try {
            p.observeSingle(300);
            longWindowRevertedAtCard1 = false;
        } catch {
            longWindowRevertedAtCard1 = true;
        }
        require(longWindowRevertedAtCard1, "300s window MUST revert OLD at cardinality 1");
        require(p.observationCardinality() == 1, "still cardinality 1");
    }

    /// Control: with a grown ring the SAME query returns a genuine time-average that is
    /// materially different from spot. Proves the collapse in F3 is caused by cardinality 1.
    function it_f4_grown_ring_gives_a_real_average() public {
        (PoolV3 p, address t0, address t1) = _newV3("F4A", "F4B");
        p.increaseObservationCardinalityNext(4);

        fastForward(60);
        _v3Swap(p, t0, t1, true, 500e18);          // grows ring, records tick 0 regime
        fastForward(300);
        _v3Swap(p, t0, t1, true, 500e18);
        int tickMid = p.currentTick();
        fastForward(300);
        _v3Swap(p, t0, t1, true, 5000e18);         // sharp manipulation
        fastForward(10);

        cardAfterGrow = p.observationCardinality();
        require(cardAfterGrow > 1, "ring actually grew");

        spotAtCard4 = p.currentTick();
        (int c0, ) = p.observeSingle(0);
        (int c310, ) = p.observeSingle(310);
        twapLongAtCard4 = (c0 - c310) / 310;

        // The long window is now servable AND is not the manipulated spot.
        require(twapLongAtCard4 != spotAtCard4, "a real TWAP differs from spot");
        require(twapLongAtCard4 > spotAtCard4, "and it lags the downward manipulation");
    }

    /// A flash mint that manipulates and restores inside one transaction cannot poison the
    /// oracle at all: the single observation slot keeps the PRE-transaction cumulative, and the
    /// tick it leaves behind is the restored one.
    function it_f5_flash_manipulate_and_restore_leaves_oracle_clean() public {
        (PoolV3 p, address t0, address t1) = _newV3("F5A", "F5B");
        // Move the tick off 0 and let it run, so the cumulative is non-trivially non-zero.
        fastForward(60);
        _v3Swap(p, t0, t1, true, 2000e18);
        fastForward(600);
        v3TickBefore = p.currentTick();
        (int cb, ) = p.observeSingle(0);
        v3CumBefore = cb;
        require(v3CumBefore != 0, "cumulative must be non-zero for this test to mean anything");

        uint got = _v3Swap(p, t0, t1, true, 20000e18);    // manipulate hard
        v3TickMid = p.currentTick();
        _v3Swap(p, t0, t1, false, got);                  // restore in the same block
        v3TickAfter = p.currentTick();
        (int ca, ) = p.observeSingle(0);
        v3CumAfter = ca;

        require(v3TickMid < v3TickBefore - 1000, "manipulation really moved the tick");
        require(v3CumAfter == v3CumBefore, "cumulative is UNCHANGED: the excursion left no trace");
        require(v3TickAfter <= v3TickBefore && v3TickAfter > v3TickBefore - 50,
            "tick returns to (just under) its start");
    }

    // ─────────────────────────────────────────────────────────────────────
    // G. Does anything actually READ a manipulated pool price mid-callback?
    // ─────────────────────────────────────────────────────────────────────

    /// Move the deepest USDST venue ~87x inside the flash-mint callback and read every price
    /// surface the protocol consumes. All of them are push-based and none of them budge.
    function it_g1_no_price_surface_moves_with_the_pool() public {
        // fresh GOLDST + pool at mainnet depth, oracle pinned to pool parity
        address gold = m.tokenFactory().createToken("GOLDST", "Gold", [], [], [], "GG1", 0, 18);
        Token(gold).setStatus(2);
        Token(gold).mint(address(this), 100000e18);
        usdstT.mint(address(this), 20000000e18);
        oracle.setAssetPrice(gold, GOLD_PRICE);
        cdp.setCollateralAssetParams(gold, LR, MINCR, 1000, 5000, 1e27, 1e18, 1e30, WAD, false);

        address pa = pf.createPool(gold, USDST);
        Token lp = Pool(pa).lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", pa);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", pa);
        require(IERC20(gold).approve(pa, GOLD_RES), "ga");
        require(IERC20(USDST).approve(pa, USDST_RES), "ua");
        Pool(pa).addLiquidity(USDST_RES, GOLD_RES, block.timestamp + 3600);

        // A victim CDP vault whose CR is what an attacker would want to move.
        User v = new User();
        Token(gold).mint(address(v), 100e18);
        v.do(gold, "approve", address(cdpVault), 100e18);
        v.do(address(cdp), "deposit", gold, 100e18);
        v.do(address(cdp), "mint", gold, 200000e18);

        PriceProbe probe = new PriceProbe();
        probe.init(address(fm), pa, address(oracle), address(cdp), USDST, gold, address(v));
        usdstT.mint(address(probe), 100000e18);   // float to absorb the round-trip slippage cost
        probe.go(2000000e18);

        probePriceBefore = probe.poolPriceBefore();
        probePriceMid    = probe.poolPriceMid();
        probePriceAfter  = probe.poolPriceAfter();
        probeOracleBefore = probe.oracleBefore();
        probeOracleMid    = probe.oracleMid();
        probeCrBefore = probe.crBefore();
        probeCrMid    = probe.crMid();

        // The pool really was manipulated ~87x mid-callback.
        require(probePriceMid > probePriceBefore * 50, "pool spot moved >50x inside the callback");
        // And nothing that prices anything noticed.
        require(probe.oracleUnmoved(), "PriceOracle.getAssetPrice is unaffected (push-based)");
        require(probe.twapUnmoved(), "PriceOracle.getAssetPriceTwap is unaffected");
        require(probe.crUnmoved(), "CDPEngine.collateralizationRatio is unaffected");
        require(probeCrBefore == probeCrMid, "victim CR identical at 87x pool dislocation");
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRINT CHANNEL
    // ─────────────────────────────────────────────────────────────────────

    function it_zz_print_9_cardinality() public {
        log(
            "POOLV3 CARDINALITY-1 | fresh card=" + string(card0) + " next=" + string(cardNext0) +
            " | same-tx observeSingle(1) reverted=" + string(sameTxTwapReverted ? 1 : 0) +
            " | tickX=" + string(tickX) + " tickY=" + string(tickY) +
            " spot=" + string(spotAtCard1) + " 10s-TWAP=" + string(twapShortAtCard1) +
            " (equal => TWAP IS SPOT) | 300s window reverted=" + string(longWindowRevertedAtCard1 ? 1 : 0) +
            " | control card=" + string(cardAfterGrow) + " 310s-TWAP=" + string(twapLongAtCard4) +
            " vs spot=" + string(spotAtCard4));
    }

    function it_zz_print_10_flash_restore() public {
        log(
            "POOLV3 FLASH MANIPULATE+RESTORE | tickBefore=" + string(v3TickBefore) +
            " tickMid=" + string(v3TickMid) + " tickAfter=" + string(v3TickAfter) +
            " cumBefore=" + string(v3CumBefore) + " cumAfter=" + string(v3CumAfter) +
            " (cum unchanged => no oracle trace)");
    }

    function it_zz_print_11_no_consumers() public {
        log(
            "MID-CALLBACK PRICE READS | v2 pool spot before=" + string(probePriceBefore) +
            " mid=" + string(probePriceMid) + " after=" + string(probePriceAfter) +
            " | PriceOracle.getAssetPrice before=" + string(probeOracleBefore) +
            " mid=" + string(probeOracleMid) +
            " | victim CR before=" + string(probeCrBefore) + " mid=" + string(probeCrMid) +
            " => NOTHING reads the pool");
    }
}
