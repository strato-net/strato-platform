// SPDX-License-Identifier: MIT
//
// Adv_Amm_V3Skew — the SELF-DIRECTED concentrated-liquidity skew attack, which needs no
// victim transaction and is therefore fully atomic inside a flash-mint callback:
//
//   flash mint USDST -> swap PoolV3 to a skewed sqrtPriceX96 -> mint your OWN position
//   (sized by PositionManagerV3._addLiquidity off the LIVE, manipulated sqrtPriceX96, see
//   concrete/Pools/PositionManagerV3.sol:377) -> swap the price back -> collect fees ->
//   decreaseLiquidity + collect principal -> dump the residual -> repay.
//
// The pre-existing honest LP in the range is the counterparty. Two questions:
//   Q1 sizing:  does minting at a manipulated price buy more liquidity per token deposited,
//               such that unwinding after the restore returns more than was put in?
//   Q2 fees:    does a position minted mid-manipulation collect feeGrowth it was not
//               in-range for? The outbound swap is token1-in, so it accrues token1 fees
//               BEFORE the attacker is minted: the attacker's collected token1 fee must be 0.
//
// Venues (from the brief): 0x910357 USDC 19,130 / USDST 27,212 fee 500 L 5.96e25 tick 8,
// and 0x961d5c GOLDST 0.9259 / USDST 12,249 fee 3000 L 6.02e21 tick 83978.
// USDST is token1 in both (price = USDST per other), and createPoolV3 preserves argument
// order, so the orientation is reproduced exactly.
//
// OUTPUT: it_zz_print_* dump measured numbers via log().

import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../concrete/Pools/PositionManagerV3.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract V3SkewAttacker {
    FlashMint public lender;
    PoolV3 public pool;
    PositionManagerV3 public pm;
    address public usdst;      // token1
    address public other;      // token0
    int public tl;
    int public tu;
    uint public mintUsdstDesired;

    uint constant MAXC = 340282366920938463463374607431768211456; // 2^128

    uint public seedBefore;
    uint public seedAfter;
    uint public netCost;
    uint public netGain;

    uint public sqrt0; uint public sqrtManip; uint public sqrtEnd;
    int  public tick0; int  public tickManip; int  public tickEnd;

    uint public outSpent; uint public outGot; uint public backSpent; uint public backGot;
    uint public mintedL; uint public dep0; uint public dep1;
    int  public inside0AtMint; int public inside1AtMint;
    uint public fee0; uint public fee1;        // PURE fees the attacker collected
    uint public prin0; uint public prin1;      // principal returned
    uint public residual0; uint public residualGot;
    uint public tokenId;

    int public fgg0Pre;  int public fgg1Pre;
    int public fgg0Mid;  int public fgg1Mid;
    int public fgg0Post; int public fgg1Post;

    function init(address _l, address _p, address _pm, address _u, address _o, int _tl, int _tu) public {
        lender = FlashMint(_l); pool = PoolV3(_p); pm = PositionManagerV3(_pm);
        usdst = _u; other = _o; tl = _tl; tu = _tu;
    }

    function go(uint amount, uint _mintUsdstDesired) public {
        mintUsdstDesired = _mintUsdstDesired;
        seedBefore = IERC20(usdst).balanceOf(address(this));
        lender.flashLoan(address(this), amount, "");
        seedAfter = IERC20(usdst).balanceOf(address(this));
        netCost = seedBefore > seedAfter ? seedBefore - seedAfter : 0;
        netGain = seedAfter > seedBefore ? seedAfter - seedBefore : 0;
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint dl = block.timestamp + 3600;

        sqrt0 = pool.sqrtPriceX96();
        tick0 = pool.currentTick();
        fgg0Pre = pool.feeGrowthGlobal0X128();
        fgg1Pre = pool.feeGrowthGlobal1X128();

        // ── 1. outbound skew: token1 (USDST) in, price UP, stop just inside tickUpper ──
        uint upLimit = pool.getSqrtRatioAtTick(tu) - 1;
        IERC20(usdst).approve(address(pool), amount);
        (int oa0, int oa1) = pool.swap(address(this), false, int(amount), upLimit, 1, dl);
        outSpent = uint(oa1);
        outGot   = uint(-oa0);

        sqrtManip = pool.sqrtPriceX96();
        tickManip = pool.currentTick();
        fgg0Mid = pool.feeGrowthGlobal0X128();
        fgg1Mid = pool.feeGrowthGlobal1X128();

        // ── 2. mint our OWN position, sized off the manipulated live sqrtPriceX96 ──
        uint want1 = mintUsdstDesired;
        uint bal1 = IERC20(usdst).balanceOf(address(this));
        if (want1 == 0 || want1 > bal1) want1 = bal1;
        IERC20(other).approve(address(pm), outGot);
        IERC20(usdst).approve(address(pm), want1);
        (tokenId, mintedL, dep0, dep1) =
            pm.mint(address(pool), tl, tu, outGot, want1, 0, 0, address(this), dl);
        (inside0AtMint, inside1AtMint) = pool.getPositionFeeGrowthInside(address(pm), tl, tu);

        // ── 3. restore: token0 in, price DOWN, stop exactly at the starting price ──
        uint have0 = IERC20(other).balanceOf(address(this));
        if (have0 > 0) {
            IERC20(other).approve(address(pool), have0);
            (int ra0, int ra1) = pool.swap(address(this), true, int(have0), sqrt0, 1, dl);
            backSpent = uint(ra0);
            backGot   = uint(-ra1);
        }
        sqrtEnd = pool.sqrtPriceX96();
        tickEnd = pool.currentTick();
        fgg0Post = pool.feeGrowthGlobal0X128();
        fgg1Post = pool.feeGrowthGlobal1X128();

        // ── 4. collect PURE fees (liquidity still staked, so collect pokes the pool) ──
        (fee0, fee1) = pm.collect(tokenId, address(this), MAXC, MAXC);

        // ── 5. unwind the principal ──
        pm.decreaseLiquidity(tokenId, mintedL, 0, 0, dl);
        (prin0, prin1) = pm.collect(tokenId, address(this), MAXC, MAXC);

        // ── 6. dump whatever token0 is left so the loan can be repaid in USDST ──
        residual0 = IERC20(other).balanceOf(address(this));
        if (residual0 > 0) {
            IERC20(other).approve(address(pool), residual0);
            (int da0, int da1) = pool.swap(address(this), true, int(residual0), 0, 1, dl);
            residualGot = uint(-da1);
        }
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Amm_V3Skew is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;
    PoolV3Factory v3f;
    PositionManagerV3 pm;

    address USDST;
    Token usdstT;

    uint constant Q96 = 79228162514264337593543950336;
    uint constant MAXC = 340282366920938463463374607431768211456;
    uint constant BIG = 100000000e18;

    PoolV3 mathPool;   // any initialised pool, used only for its pure TickMath helpers

    // recorded — venue A wide
    uint aHonestDep0; uint aHonestDep1; uint aHonestOut0; uint aHonestOut1;
    uint aHonestFee0; uint aHonestFee1;
    uint aCtlDep0; uint aCtlDep1; uint aCtlOut0; uint aCtlOut1;
    uint aAtkCost; uint aAtkGain; uint aMintedL; uint aDep0; uint aDep1;
    uint aFee0; uint aFee1; uint aPrin0; uint aPrin1;
    int  aTick0; int aTickManip; int aTickEnd;
    uint aHonestL;
    bool aHonestBetterOff; uint aHonestDelta;
    uint aLPerValueHonest; uint aLPerValueManip;
    uint aSizeH0; uint aSizeH1; uint aSizeM0; uint aSizeM1;

    // recorded — sizing sweep
    uint sDomCost; uint sDomGain; uint sDomL; uint sDomFee1;
    uint sMatCost; uint sMatGain; uint sMatL; uint sMatFee1;
    uint sSmlCost; uint sSmlGain; uint sSmlL; uint sSmlFee1;

    // recorded — venue A tight (real mainnet L and range)
    uint tAtkCost; uint tAtkGain; uint tFee1; int tTick0; int tTickManip; int tTickEnd;
    uint tHonestDelta; bool tHonestBetterOff;

    // recorded — venue B one-sided
    uint bAtkCost; uint bAtkGain; uint bFee1; int bTick0; int bTickManip; int bTickEnd;
    uint bHonestDelta; bool bHonestBetterOff; uint bDep0; uint bDep1; uint bPWad;

    function beforeAll() public {
        bypassAuthorizations = true;

        m = new Mercata();
        admin = m.adminRegistry();
        fm = new FlashMint(address(admin));

        USDST = m.tokenFactory().createToken("USDST", "USD Stable", [], [], [], "USDST", 0, 18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);

        v3f = new PoolV3Factory(address(this));
        v3f.initialize(address(m.tokenFactory()), address(m.feeCollector()));

        pm = new PositionManagerV3(address(this));
        pm.initialize(address(v3f));
    }

    /// Create a venue with USDST as token1 (matching both mainnet pools) and seed ONE honest
    /// position over [tl, tu] with exactly `L` units of liquidity.
    function _venue(string sym, uint fee, uint initSqrt, int tl, int tu, uint L)
        internal returns (PoolV3, address, uint, uint)
    {
        address other = m.tokenFactory().createToken("OTHER", "Other", [], [], [], sym, 0, 18);
        Token(other).setStatus(2);
        Token(other).mint(address(this), BIG);
        usdstT.mint(address(this), BIG);

        address pa = v3f.createPoolV3(other, USDST, fee, initSqrt);
        PoolV3 p = PoolV3(pa);
        require(address(p.token1()) == USDST, "USDST must be token1");

        require(IERC20(other).approve(pa, BIG), "a0");
        require(IERC20(USDST).approve(pa, BIG), "a1");
        (uint d0, uint d1) = p.mint(address(this), tl, tu, L, BIG, BIG, block.timestamp + 3600);
        return (p, other, d0, d1);
    }

    /// Fully unwind the honest position: poke+collect fees, then burn+collect principal.
    function _unwindHonest(PoolV3 p, int tl, int tu, uint L)
        internal returns (uint, uint, uint, uint)
    {
        p.burn(tl, tu, 0, block.timestamp + 3600);                       // poke
        (uint f0, uint f1) = p.collect(address(this), tl, tu, MAXC, MAXC);
        p.burn(tl, tu, L, block.timestamp + 3600);
        (uint p0, uint p1) = p.collect(address(this), tl, tu, MAXC, MAXC);
        return (f0, f1, p0, p1);
    }

    function _newAttacker(PoolV3 p, address other, int tl, int tu, uint seed)
        internal returns (V3SkewAttacker)
    {
        V3SkewAttacker a = new V3SkewAttacker();
        a.init(address(fm), address(p), address(pm), USDST, other, tl, tu);
        usdstT.mint(address(a), seed);
        return a;
    }

    // ─────────────────────────────────────────────────────────────────────
    // J. Venue A, widened to ±10% so the attacker has maximum room to skew
    //    (same total venue value as mainnet 0x910357: ~$46.3k)
    // ─────────────────────────────────────────────────────────────────────

    function it_j1_self_directed_skew_conserves_value() public {
        // control pool: identical venue, honest LP mints and immediately unwinds
        (PoolV3 pc, address oc, uint cd0, uint cd1) = _venue("VA0", 500, Q96, -1000, 1000, 475e21);
        mathPool = pc;
        aCtlDep0 = cd0; aCtlDep1 = cd1;
        (uint cf0, uint cf1, uint cp0, uint cp1) = _unwindHonest(pc, -1000, 1000, 475e21);
        aCtlOut0 = cp0 + cf0; aCtlOut1 = cp1 + cf1;

        // attacked pool
        (PoolV3 p, address other, uint d0, uint d1) = _venue("VA1", 500, Q96, -1000, 1000, 475e21);
        aHonestDep0 = d0; aHonestDep1 = d1; aHonestL = 475e21;
        aTick0 = p.currentTick();

        V3SkewAttacker a = _newAttacker(p, other, -1000, 1000, 200000e18);
        a.go(2000000e18, 0);        // 0 = commit the whole balance (maximum skew position)

        aAtkCost = a.netCost(); aAtkGain = a.netGain();
        aMintedL = a.mintedL(); aDep0 = a.dep0(); aDep1 = a.dep1();
        aFee0 = a.fee0(); aFee1 = a.fee1(); aPrin0 = a.prin0(); aPrin1 = a.prin1();
        aTickManip = a.tickManip(); aTickEnd = a.tickEnd();

        (uint hf0, uint hf1, uint hp0, uint hp1) = _unwindHonest(p, -1000, 1000, 475e21);
        aHonestFee0 = hf0; aHonestFee1 = hf1;
        aHonestOut0 = hp0 + hf0; aHonestOut1 = hp1 + hf1;

        // token0 and token1 are both ~$1 here (pool initialised at price 1.0), so value is
        // simply amount0 + amount1 and the conservation table is exact.
        uint ctlIn  = aCtlDep0 + aCtlDep1;
        uint ctlOut = aCtlOut0 + aCtlOut1;
        uint atkIn  = aHonestDep0 + aHonestDep1;
        uint atkOut = aHonestOut0 + aHonestOut1;
        // honest delta = (attacked round trip) - (no-attack round trip)
        int ctlNet = int(ctlOut) - int(ctlIn);
        int atkNet = int(atkOut) - int(atkIn);
        aHonestBetterOff = atkNet > ctlNet;
        aHonestDelta = aHonestBetterOff ? uint(atkNet - ctlNet) : uint(ctlNet - atkNet);

        // ── the attack did happen ──
        require(aTickManip > aTick0 + 900, "outbound swap really skewed the price ~+10%");
        require(aMintedL > aHonestL * 10, "attacker minted >10x the honest liquidity at the skewed price");

        // ── Q1: NOT profitable ──
        require(aAtkGain == 0, "self-directed skew must not be net positive for the attacker");
        require(aAtkCost > 0, "and it costs the attacker real USDST");

        // ── Q2: the mint-time snapshot denies the attacker the outbound (token1) fees ──
        require(aFee1 == 0, "attacker collects ZERO token1 fees - it was not minted for that swap");
        require(aHonestFee1 > 0, "the honest LP collected those token1 fees instead");

        // ── conservation: the honest LP is strictly better off ──
        require(aHonestBetterOff, "honest LP must not lose to the skew");
    }

    /// Q1 restated as a pure sizing question: L bought per token of value deposited, honest
    /// price vs manipulated price. Uses the pool's own view functions, no attack needed.
    function it_j2_manipulated_price_buys_no_extra_liquidity_per_value() public {
        (PoolV3 p, address other, , ) = _venue("VA2", 500, Q96, -1000, 1000, 475e21);

        // honest price (tick 0): what does 1e24 units of liquidity cost?
        (uint h0, uint h1) = p.getAmountsForLiquidity(-1000, 1000, 1e24);
        aLPerValueHonest = (1e24 * 1e18) / (h0 + h1);

        // skew the price to the top of the range, then re-price the SAME liquidity
        require(IERC20(USDST).approve(address(p), BIG), "ap");
        p.swap(address(this), false, int(500000e18), p.getSqrtRatioAtTick(1000) - 1, 1, block.timestamp + 3600);
        (uint s0, uint s1) = p.getAmountsForLiquidity(-1000, 1000, 1e24);
        aLPerValueManip = (1e24 * 1e18) / (s0 + s1);

        // At the top of the range the position is 100% token1, and token1 is the token the
        // manipulation made ARTIFICIALLY EXPENSIVE, so the same liquidity costs MORE value,
        // not less. The sizing helper cannot be gamed into a discount.
        aSizeH0 = h0; aSizeH1 = h1; aSizeM0 = s0; aSizeM1 = s1;

        // one wei inside tickUpper, so the position is token1 to within dust
        require(s0 < h0 / 1000, "at the top of the range the position is token1 to within dust");
        // Marked at the EXTERNAL price (both tokens ~$1), the same liquidity costs MORE value
        // at the manipulated price, so the sizing helper cannot be gamed into a discount.
        require(s0 + s1 > h0 + h1, "same L costs MORE value at the manipulated price");
        require(aLPerValueManip < aLPerValueHonest,
            "manipulated price must not buy MORE liquidity per unit of value deposited");
    }

    /// Sweep the attacker's position size: dominating, matched to the honest LP, and small.
    /// A smaller position damages its own restore less but also captures less fee.
    function it_j3_no_position_size_makes_the_skew_profitable() public {
        // dominating (whole balance)
        (PoolV3 p1, address o1, , ) = _venue("VA3", 500, Q96, -1000, 1000, 475e21);
        V3SkewAttacker a1 = _newAttacker(p1, o1, -1000, 1000, 200000e18);
        a1.go(2000000e18, 0);
        sDomCost = a1.netCost(); sDomGain = a1.netGain(); sDomL = a1.mintedL(); sDomFee1 = a1.fee1();

        // matched to the honest LP: L = 475e21 over [-1000,1000] at tickUpper needs
        // amount1 = L * (sqrtB - sqrtA) / Q96
        (PoolV3 p2, address o2, , ) = _venue("VA4", 500, Q96, -1000, 1000, 475e21);
        uint sA = p2.getSqrtRatioAtTick(-1000);
        uint sB = p2.getSqrtRatioAtTick(1000);
        uint want = (475e21 * (sB - sA)) / Q96;
        V3SkewAttacker a2 = _newAttacker(p2, o2, -1000, 1000, 200000e18);
        a2.go(2000000e18, want);
        sMatCost = a2.netCost(); sMatGain = a2.netGain(); sMatL = a2.mintedL(); sMatFee1 = a2.fee1();

        // small: 10% of the honest LP
        (PoolV3 p3, address o3, , ) = _venue("VA5", 500, Q96, -1000, 1000, 475e21);
        V3SkewAttacker a3 = _newAttacker(p3, o3, -1000, 1000, 200000e18);
        a3.go(2000000e18, want / 10);
        sSmlCost = a3.netCost(); sSmlGain = a3.netGain(); sSmlL = a3.mintedL(); sSmlFee1 = a3.fee1();

        require(sDomGain == 0 && sMatGain == 0 && sSmlGain == 0,
            "no position sizing turns the self-directed skew profitable");
        require(sDomCost > 0 && sMatCost > 0 && sSmlCost > 0, "every sizing loses money");
        require(sDomFee1 == 0 && sMatFee1 == 0 && sSmlFee1 == 0,
            "no sizing lets the attacker claim the pre-mint token1 fees");
        require(sMatL > 0 && sSmlL > 0 && sMatL > sSmlL * 5, "sizings really differed");
    }

    // ─────────────────────────────────────────────────────────────────────
    // K. The ACTUAL mainnet venues
    // ─────────────────────────────────────────────────────────────────────

    /// Venue A at its real razor-thin shape: L = 5.96e25 over one tick-spacing either side.
    function it_k1_mainnet_tight_range_venue_A() public {
        (PoolV3 pc, address oc, uint cd0, uint cd1) = _venue("VB0", 500, Q96, -10, 10, 596e23);
        (uint cf0, uint cf1, uint cp0, uint cp1) = _unwindHonest(pc, -10, 10, 596e23);
        int ctlNet = int(cp0 + cf0 + cp1 + cf1) - int(cd0 + cd1);

        (PoolV3 p, address other, uint d0, uint d1) = _venue("VB1", 500, Q96, -10, 10, 596e23);
        tTick0 = p.currentTick();
        V3SkewAttacker a = _newAttacker(p, other, -10, 10, 200000e18);
        a.go(2000000e18, 0);
        tAtkCost = a.netCost(); tAtkGain = a.netGain(); tFee1 = a.fee1();
        tTickManip = a.tickManip(); tTickEnd = a.tickEnd();

        (uint hf0, uint hf1, uint hp0, uint hp1) = _unwindHonest(p, -10, 10, 596e23);
        int atkNet = int(hp0 + hf0 + hp1 + hf1) - int(d0 + d1);
        tHonestBetterOff = atkNet > ctlNet;
        tHonestDelta = tHonestBetterOff ? uint(atkNet - ctlNet) : uint(ctlNet - atkNet);

        require(tAtkGain == 0, "tight-range skew is not profitable either");
        require(tFee1 == 0, "no pre-mint token1 fee capture");
        require(tHonestBetterOff, "honest LP better off at mainnet-tight range too");
    }

    /// Venue B, the extremely one-sided GOLDST pool: tick 83978, fee 3000, L 6.02e21.
    function it_k2_mainnet_one_sided_venue_B() public {
        require(address(mathPool) != address(0), "needs it_j1 to have run for the math helper");
        uint initSqrt = mathPool.getSqrtRatioAtTick(83978);

        (PoolV3 pc, address oc, uint cd0, uint cd1) = _venue("VC0", 3000, initSqrt, 83400, 84600, 602e19);
        (uint cf0, uint cf1, uint cp0, uint cp1) = _unwindHonest(pc, 83400, 84600, 602e19);

        (PoolV3 p, address other, uint d0, uint d1) = _venue("VC1", 3000, initSqrt, 83400, 84600, 602e19);
        bDep0 = d0; bDep1 = d1;
        bTick0 = p.currentTick();
        require(bTick0 == 83978, "venue B must open at the mainnet tick");

        // USDST per OTHER at the opening tick, WAD (shifted to avoid overflow)
        bPWad = (((initSqrt >> 48) * (initSqrt >> 48)) * 1e18) >> 96;

        V3SkewAttacker a = _newAttacker(p, other, 83400, 84600, 200000e18);
        a.go(2000000e18, 0);
        bAtkCost = a.netCost(); bAtkGain = a.netGain(); bFee1 = a.fee1();
        bTickManip = a.tickManip(); bTickEnd = a.tickEnd();

        (uint hf0, uint hf1, uint hp0, uint hp1) = _unwindHonest(p, 83400, 84600, 602e19);
        // value at the fixed opening price: token0 is worth bPWad USDST each
        int ctlNet = int(((cp0 + cf0) * bPWad) / 1e18 + cp1 + cf1) - int((cd0 * bPWad) / 1e18 + cd1);
        int atkNet = int(((hp0 + hf0) * bPWad) / 1e18 + hp1 + hf1) - int((d0 * bPWad) / 1e18 + d1);
        bHonestBetterOff = atkNet > ctlNet;
        bHonestDelta = bHonestBetterOff ? uint(atkNet - ctlNet) : uint(ctlNet - atkNet);

        require(bAtkGain == 0, "one-sided venue skew is not profitable");
        require(bFee1 == 0, "no pre-mint token1 fee capture on venue B");
        require(bHonestBetterOff, "honest LP better off on venue B too");
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRINT CHANNEL
    // ─────────────────────────────────────────────────────────────────────

    function it_zz_print_16_skew_conservation() public {
        log(
            "V3 SELF-DIRECTED SKEW, venue A widened to +-10% (~$46.3k depth, price 1.0) | " +
            "tick " + string(aTick0) + " -> " + string(aTickManip) + " -> " + string(aTickEnd) +
            " | attacker mintedL=" + string(aMintedL) + " (honest L=" + string(aHonestL) + ")" +
            " dep0=" + string(aDep0) + " dep1=" + string(aDep1) +
            " | attacker COST=" + string(aAtkCost) + " gain=" + string(aAtkGain) +
            " | attacker fees collected: token0=" + string(aFee0) + " token1=" + string(aFee1) +
            " (token1 MUST be 0) | honest LP fees: token0=" + string(aHonestFee0) +
            " token1=" + string(aHonestFee1) +
            " | honest LP betterOff=" + string(aHonestBetterOff ? 1 : 0) +
            " delta=" + string(aHonestDelta));
    }

    function it_zz_print_17_honest_lp_ledger() public {
        log(
            "HONEST LP LEDGER (amount0+amount1, price 1.0) | CONTROL in=" +
            string(aCtlDep0 + aCtlDep1) + " out=" + string(aCtlOut0 + aCtlOut1) +
            " | ATTACKED in=" + string(aHonestDep0 + aHonestDep1) +
            " out=" + string(aHonestOut0 + aHonestOut1) +
            " | attacker principal returned: prin0=" + string(aPrin0) + " prin1=" + string(aPrin1) +
            " | SIZING 1e24 L: honest costs (" + string(aSizeH0) + "," + string(aSizeH1) +
            ") manipulated costs (" + string(aSizeM0) + "," + string(aSizeM1) +
            ") | L per 1e18 value: honest=" + string(aLPerValueHonest) +
            " manipulated=" + string(aLPerValueManip) + " (manipulated is strictly worse)");
    }

    function it_zz_print_18_sizing_sweep() public {
        log(
            "SIZING SWEEP (2m flash mint, venue A +-10%) | DOMINATE L=" + string(sDomL) +
            " cost=" + string(sDomCost) + " gain=" + string(sDomGain) + " fee1=" + string(sDomFee1) +
            " | MATCHED L=" + string(sMatL) + " cost=" + string(sMatCost) +
            " gain=" + string(sMatGain) + " fee1=" + string(sMatFee1) +
            " | SMALL L=" + string(sSmlL) + " cost=" + string(sSmlCost) +
            " gain=" + string(sSmlGain) + " fee1=" + string(sSmlFee1));
    }

    function it_zz_print_19_mainnet_venues() public {
        log(
            "MAINNET VENUES | A tight (L=5.96e25, [-10,10]): tick " + string(tTick0) + " -> " +
            string(tTickManip) + " -> " + string(tTickEnd) + " attackerCost=" + string(tAtkCost) +
            " gain=" + string(tAtkGain) + " fee1=" + string(tFee1) +
            " honestBetterOff=" + string(tHonestBetterOff ? 1 : 0) + " delta=" + string(tHonestDelta) +
            " || B one-sided (L=6.02e21, [83400,84600], P=" + string(bPWad) + "): dep0=" +
            string(bDep0) + " dep1=" + string(bDep1) + " tick " + string(bTick0) + " -> " +
            string(bTickManip) + " -> " + string(bTickEnd) + " attackerCost=" + string(bAtkCost) +
            " gain=" + string(bAtkGain) + " fee1=" + string(bFee1) +
            " honestBetterOff=" + string(bHonestBetterOff ? 1 : 0) + " delta=" + string(bHonestDelta));
    }
}
