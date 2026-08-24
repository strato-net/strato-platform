// SPDX-License-Identifier: MIT
//
// Adv_Amm_RoundTrip — adversarial: zero-fee-CPMM round trip under flash mint.
//
// Q1 of the brief: pools 0x...1017 / 0x...101b / 0x...101d report swapFeeRate == 0 and are
// claimed to be "zero fee". Build a REAL Pool (v2) at mainnet reserve ratios and measure the
// exact net USDST cost of a manipulate-and-restore round trip funded by a flash mint.
//
// NOTE ON OUTPUT: solid-vm-cli only surfaces text through a failing require(). The
// it_zz_print_* tests therefore FAIL BY DESIGN — they are the print channel. Every real
// assertion lives in the it_a*/it_b* tests, which must pass.

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Flash-mint borrower that pushes a v2 CPMM as far as it can and swaps straight back.
contract RTAttacker {
    FlashMint public lender;
    Pool public pool;
    address public usdst;
    address public gold;

    uint public seedBefore;
    uint public seedAfter;
    uint public netCost;          // USDST of its own float consumed by the whole round trip

    uint public priceStart;       // USDST per GOLD, 1e18
    uint public priceMid;
    uint public priceEnd;

    uint public goldOut;
    uint public usdstBack;

    bool public ratioMoved;       // did Pool.aToBRatio (the state var consumers read) move?
    bool public ratioRestored;

    function init(address _lender, address _pool, address _usdst, address _gold) public {
        lender = FlashMint(_lender);
        pool = Pool(_pool);
        usdst = _usdst;
        gold = _gold;
    }

    function go(uint amount) public {
        seedBefore = IERC20(usdst).balanceOf(address(this));
        lender.flashLoan(address(this), amount, "");
        seedAfter = IERC20(usdst).balanceOf(address(this));
        netCost = seedBefore - seedAfter;
    }

    function _price() internal view returns (uint) {
        return (pool.tokenBBalance() * 1e18) / pool.tokenABalance();
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        decimal r0 = pool.aToBRatio();
        priceStart = _price();

        IERC20(usdst).approve(address(pool), amount);
        goldOut = pool.swap(false, amount, 1, block.timestamp + 3600);

        decimal r1 = pool.aToBRatio();
        priceMid = _price();
        ratioMoved = r1 > r0;

        IERC20(gold).approve(address(pool), goldOut);
        usdstBack = pool.swap(true, goldOut, 1, block.timestamp + 3600);

        decimal r2 = pool.aToBRatio();
        priceEnd = _price();
        ratioRestored = (r2 > r0 ? r2 - r0 : r0 - r2) < (r0 / 100.000000000000000000);

        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Amm_RoundTrip is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;
    PoolFactory pf;

    address USDST;
    Token usdstT;

    // mainnet 0x...101b : GOLDST 53.71 / USDST 239,376 (the deepest USDST venue)
    uint GOLD_RES;
    uint USDST_RES;

    // recorded results, dumped by the print tests
    uint c100k;  uint c500k;  uint c2m;
    uint p100k;  uint p500k;  uint p2m;   // manipulated mid price
    uint pStart; uint pEnd100k; uint pEnd500k; uint pEnd2m;
    uint zeroFeeDelta100k; uint zeroFeeDelta500k; uint zeroFeeDelta2m;
    uint effFeeSeen;
    uint protoFeeSeen;
    uint minFeeCost2m;
    uint mult100k; uint mult500k; uint mult2m;   // price multiple achieved, x1000

    function beforeAll() public {
        bypassAuthorizations = true;

        GOLD_RES  = 5371e16;      // 53.71e18
        USDST_RES = 239376e18;

        m     = new Mercata();
        admin = m.adminRegistry();
        pf    = m.poolFactory();
        fm    = m.flashMint();

        USDST  = m.tokenFactory().createToken("USDST", "USD Stable", [], [], [], "USDST", 0, 18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);
    }

    // ── helper: fresh GOLDST + fresh pool seeded at mainnet 0x...101b depth ──
    function _newPool(string sym) internal returns (address, address) {
        address gold = m.tokenFactory().createToken("GOLDST", "Gold", [], [], [], sym, 0, 18);
        Token(gold).setStatus(2);
        Token(gold).mint(address(this), 1000000e18);
        usdstT.mint(address(this), 10000000e18);

        address p = pf.createPool(gold, USDST);
        Token lp = Pool(p).lpToken();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "mint", p);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(lp), "burn", p);

        require(IERC20(gold).approve(p, GOLD_RES), "gold approve");
        require(IERC20(USDST).approve(p, USDST_RES), "usdst approve");
        Pool(p).addLiquidity(USDST_RES, GOLD_RES, block.timestamp + 3600);

        require(Pool(p).tokenABalance() == GOLD_RES, "tokenA seeded");
        require(Pool(p).tokenBBalance() == USDST_RES, "tokenB seeded");
        return (p, gold);
    }

    // ─────────────────────────────────────────────────────────────────────
    // A. The premise itself: is swapFeeRate == 0 actually a zero-fee pool?
    // ─────────────────────────────────────────────────────────────────────

    /// A factory-created v2 Pool stores swapFeeRate == 0 (createPool never calls
    /// setFeeParameters) but Pool._swapFeeRate() FALLS BACK to the factory default.
    function it_a1_zero_stored_fee_is_not_a_zero_fee_pool() public {
        (address p, address gold) = _newPool("G1");
        Pool pool = Pool(p);

        require(pool.swapFeeRate() == 0, "stored pool swapFeeRate must be 0 (matches mainnet)");
        require(pf.swapFeeRate() == 30, "factory default is 30 bps");

        // Prove the 30 bps is actually charged: swap 10,000 USDST and compare the realised
        // output against the fee-free constant-product output, and check the exact protocol
        // fee cut that lands at the FeeCollector (30 bps * 30% protocol share = 9 bps).
        uint amt = 10000e18;
        uint feeFree = pool.getInputPrice(amt, USDST_RES, GOLD_RES);
        uint collBefore = IERC20(USDST).balanceOf(address(m.feeCollector()));

        require(IERC20(USDST).approve(p, amt), "approve");
        uint got = pool.swap(false, amt, 1, block.timestamp + 3600);

        require(got < feeFree, "a truly zero-fee pool would have paid feeFree");
        // effective fee in bps of the notional, measured on the output side
        effFeeSeen = ((feeFree - got) * 10000) / feeFree;
        require(effFeeSeen > 0, "output is strictly worse than fee-free");

        // Unambiguous: the FeeCollector receives amt * 30/10000 * 3000/10000 = amt * 9/10000.
        protoFeeSeen = IERC20(USDST).balanceOf(address(m.feeCollector())) - collBefore;
        require(protoFeeSeen == (amt * 9) / 10000, "protocol fee must be exactly 9 bps of input");
    }

    /// Governance cannot even express a zero-fee v2 pool: both setters reject 0.
    function it_a2_true_zero_fee_is_unreachable_by_governance() public {
        (address p, address gold) = _newPool("G2");
        bool poolRejected = false;
        bool factoryRejected = false;
        try { pf.setPoolFeeParameters(p, 0, 7000); } catch { poolRejected = true; }
        try { pf.setFeeParameters(0, 7000); } catch { factoryRejected = true; }
        require(poolRejected, "setPoolFeeParameters(0) must revert");
        require(factoryRejected, "setFeeParameters(0) must revert");
        require(pf.swapFeeRate() == 30, "factory fee untouched");
    }

    // ─────────────────────────────────────────────────────────────────────
    // B. The round trip, funded by a flash mint, at mainnet depth
    // ─────────────────────────────────────────────────────────────────────

    function _roundTrip(string sym, uint loan) internal returns (RTAttacker) {
        (address p, address gold) = _newPool(sym);
        RTAttacker a = new RTAttacker();
        a.init(address(fm), p, USDST, gold);
        usdstT.mint(address(a), 500000e18);      // its own float, only to absorb the round-trip loss
        a.go(loan);
        return a;
    }

    /// All three loan sizes in one transaction so the recorded numbers are internally coherent
    /// (a reverted it_ test rolls its state back, so cross-test accumulation is unsafe).
    function it_b1_roundtrips_at_mainnet_depth() public {
        RTAttacker a1 = _roundTrip("G3", 100000e18);
        c100k = a1.netCost();  p100k = a1.priceMid();  pStart = a1.priceStart();  pEnd100k = a1.priceEnd();
        mult100k = (p100k * 1000) / pStart;
        require(a1.ratioMoved(), "aToBRatio must move mid-callback");
        require(a1.ratioRestored(), "aToBRatio must come back within 1%");
        require(mult100k > 1900, "100k must move a 239k pool >1.9x");

        RTAttacker a2 = _roundTrip("G4", 500000e18);
        c500k = a2.netCost();  p500k = a2.priceMid();  pEnd500k = a2.priceEnd();
        mult500k = (p500k * 1000) / a2.priceStart();
        require(a2.ratioMoved() && a2.ratioRestored(), "500k: price moved and returned");
        require(mult500k > 8000, "500k must move price >8x");

        RTAttacker a3 = _roundTrip("G5", 2000000e18);
        c2m = a3.netCost();  p2m = a3.priceMid();  pEnd2m = a3.priceEnd();
        mult2m = (p2m * 1000) / a3.priceStart();
        require(a3.ratioMoved() && a3.ratioRestored(), "2m: price moved and returned");
        require(mult2m > 50000, "2m loan must move a 239k pool >50x");

        // Every round trip costs the attacker something (never net positive).
        require(c100k > 0 && c500k > 0 && c2m > 0, "round trips are never free at 30 bps");
        require(c100k < 100000e18 / 100, "100k cost under 1% of loan");
        require(c500k < 500000e18 / 100, "500k cost under 1% of loan");
        require(c2m   < 2000000e18 / 100, "2m cost under 1% of loan");

        // The headline: the *relative* cost FALLS as the loan grows, because the attacker
        // recaptures the LP fee it just donated when it drains the same side back out.
        require((c2m * 100000) / 2000000e18 < (c500k * 100000) / 500000e18,
            "2m bps cost must be below 500k bps cost");
        require((c500k * 100000) / 500000e18 < (c100k * 100000) / 100000e18,
            "500k bps cost must be below 100k bps cost");
    }

    // ─────────────────────────────────────────────────────────────────────
    // C. What a genuinely zero-fee CPMM would cost — the pool's own arithmetic
    // ─────────────────────────────────────────────────────────────────────

    /// Uses Pool.getInputPrice (the real, pure, on-chain pricing function) with fee == 0 to
    /// establish the wei-level floor: a zero-fee round trip is free to within rounding dust.
    function it_c1_zero_fee_roundtrip_is_free_to_the_wei() public {
        (address p, address gold) = _newPool("G6");
        Pool pool = Pool(p);

        zeroFeeDelta100k  = _zeroFeeDelta(pool, 100000e18);
        zeroFeeDelta500k  = _zeroFeeDelta(pool, 500000e18);
        zeroFeeDelta2m    = _zeroFeeDelta(pool, 2000000e18);

        // Rounding is floor-division on the output, so it can only ever favour the pool.
        // The bound is (reserveOut_after / reserveIn) wei, i.e. ~1e-15 USDST — free in practice.
        require(zeroFeeDelta100k < 1e7, "zero-fee 100k round trip loses < 1e7 wei (1e-11 USDST)");
        require(zeroFeeDelta500k < 1e7, "zero-fee 500k round trip loses < 1e7 wei");
        require(zeroFeeDelta2m   < 1e7, "zero-fee 2m round trip loses < 1e7 wei");
    }

    /// zapSwapFeesEnabled == false would make the internal zap swap fee-free, i.e. a free
    /// price-manipulation path. Check the default that every pool ships with.
    function it_c3_zap_swap_fees_default_on() public {
        (address p, address gold) = _newPool("G8");
        require(Pool(p).zapSwapFeesEnabled(), "zapSwapFeesEnabled must default to true");

        // And it is owner-only (owner == AdminRegistry on mainnet), not attacker-reachable.
        bool blocked = false;
        User u = new User();
        try {
            u.callFunction(p, "setZapSwapFeesEnabled", false);
            if (Pool(p).zapSwapFeesEnabled()) blocked = true;
        } catch { blocked = true; }
        require(blocked, "a random caller must not be able to switch zap fees off");
    }

    function _zeroFeeDelta(Pool pool, uint x) internal returns (uint) {
        uint outG = pool.getInputPrice(x, USDST_RES, GOLD_RES);
        uint b1 = USDST_RES + x;
        uint a1 = GOLD_RES - outG;
        uint backU = pool.getInputPrice(outG, a1, b1);
        require(backU <= x, "zero-fee round trip must never be net positive");
        return x - backU;
    }

    /// The cheapest fee governance CAN express (1 bp, 100% to LPs) — brackets the zero case
    /// with a LIVE swap rather than pure arithmetic.
    function it_c2_min_expressible_fee_roundtrip() public {
        (address p, address gold) = _newPool("G7");
        pf.setPoolFeeParameters(p, 1, 10000);      // 1 bp, all of it to LPs => protocolFee 0
        require(Pool(p).swapFeeRate() == 1, "1 bp set");

        RTAttacker a = new RTAttacker();
        a.init(address(fm), p, USDST, gold);
        usdstT.mint(address(a), 500000e18);
        a.go(2000000e18);

        minFeeCost2m = a.netCost();
        require(a.ratioMoved() && a.ratioRestored(), "price moved and returned");
        require(minFeeCost2m < c2m || c2m == 0, "1 bp round trip must be cheaper than 30 bps");
        require(minFeeCost2m < 2000000e18 / 10000, "1 bp round trip costs under 1 bp of notional");
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRINT CHANNEL (these FAIL on purpose — solid-vm-cli has no other stdout)
    // ─────────────────────────────────────────────────────────────────────

    function it_zz_print_1_premise() public {
        require(false,
            "PREMISE | pool.swapFeeRate=0 factory.swapFeeRate=" + string(pf.swapFeeRate()) +
            " measured_output_penalty_bps=" + string(effFeeSeen) +
            " protocolFee_on_10000e18_input=" + string(protoFeeSeen) +
            " (== 9bps exactly) => the three 'zero fee' mainnet pools charge 30bps, not 0");
    }

    function it_zz_print_2_roundtrip_costs() public {
        require(false,
            "ROUNDTRIP COST vs 239,376 USDST depth, wei | " +
            "loan=100000e18 netCost=" + string(c100k) + " bps10k=" + string((c100k * 100000) / 100000e18) +
            " | loan=500000e18 netCost=" + string(c500k) + " bps10k=" + string((c500k * 100000) / 500000e18) +
            " | loan=2000000e18 netCost=" + string(c2m) + " bps10k=" + string((c2m * 100000) / 2000000e18) +
            " | minfee(1bp) 2m netCost=" + string(minFeeCost2m) +
            "  [bps10k = cost in 1/10 bps]");
    }

    function it_zz_print_3_price_excursion() public {
        require(false,
            "PRICE USDST/GOLD 1e18 | start=" + string(pStart) +
            " mid@100k=" + string(p100k) + " (x1000=" + string(mult100k) + ") end=" + string(pEnd100k) +
            " | mid@500k=" + string(p500k) + " (x1000=" + string(mult500k) + ") end=" + string(pEnd500k) +
            " | mid@2m=" + string(p2m) + " (x1000=" + string(mult2m) + ") end=" + string(pEnd2m));
    }

    function it_zz_print_4_zero_fee_floor() public {
        require(false,
            "ZERO-FEE FLOOR (wei lost to rounding, Pool.getInputPrice) | 100k=" +
            string(zeroFeeDelta100k) + " 500k=" + string(zeroFeeDelta500k) +
            " 2m=" + string(zeroFeeDelta2m) + " (never negative => never profitable)");
    }
}
