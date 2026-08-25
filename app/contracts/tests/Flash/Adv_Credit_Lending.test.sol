// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERSARIAL ITEM 5 — LendingPool / RateStrategy under a flash-minted supply spike.
//
// Structural facts established by reading the source (both are load-bearing):
//   * There is NO utilization model anywhere in the lending system. RateStrategy.
//     calculateInterest is dead code (no caller in concrete/ or tests/), and
//     LendingPool._currentAprBps():895 is dead too. Accrual uses ONLY the governance
//     constant `perSecondFactorRAY` (LendingPool.sol:910-912). So "spike utilization to
//     move the rate" has no target.
//   * The quantity a utilization model would have driven — the mToken share price — IS
//     computed from a live, donatable balance:
//         LendingPool.getExchangeRate():867
//         cash = IERC20(borrowableAsset).balanceOf(address(_liquidityPool()))
//     and USDST is the borrowable asset, so FlashMint can move `cash` mid-transaction.
//
// Tests are ordered so that the ones which leave a PERMANENT donation run last.
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

/// @notice Zero-slippage desk so a liquidator can exit seized collateral atomically.
contract Desk {
    mapping(address => uint) public priceWad;
    function setPrice(address a, uint p) public { priceWad[a] = p; }
    function settle(address tIn, uint amtIn, address tOut) public returns (uint amtOut) {
        require(priceWad[tIn] > 0 && priceWad[tOut] > 0, "Desk: unpriced");
        amtOut = (amtIn * priceWad[tIn]) / priceWad[tOut];
        require(IERC20(tIn).transferFrom(msg.sender, address(this), amtIn), "Desk: in");
        require(IERC20(tOut).transfer(msg.sender, amtOut), "Desk: out");
        return amtOut;
    }
}

/// @notice Samples borrowIndex / share price with a flash mint live, WITHOUT donating.
contract IndexProbe {
    FlashMint public lender;
    LendingPool public pool;
    address public usdst;
    uint public idxBefore; uint public idxDuring;
    uint public rateBefore; uint public rateDuring;

    function init(address _l, address _p, address _u) public { lender = FlashMint(_l); pool = LendingPool(_p); usdst = _u; }
    function probe(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        idxBefore  = pool.previewBorrowIndex();
        rateBefore = pool.getExchangeRate();
        // The 2,000,000 USDST is sitting in OUR balance right now — the largest single
        // USDST holding in existence at this instant. Nothing in the pool notices.
        idxDuring  = pool.previewBorrowIndex();
        rateDuring = pool.getExchangeRate();
        return "FlashMint.onFlashMint";
    }
}

/// @notice Deposits a flash mint into an ILLIQUID pool and tries to exit with more than
///         it brought — i.e. to jump the withdrawal queue ahead of the other LPs.
contract QueueJumper {
    FlashMint public lender;
    LendingPool public pool;
    address public usdst; address public mtoken; address public liq;

    uint public sharesBefore; uint public sharesAfter;
    uint public cashAtEntry;
    uint public claimAtEntry;
    string public allErr;
    uint public got;
    uint public principal;

    function init(address _l, address _p, address _u, address _m, address _q) public {
        lender = FlashMint(_l); pool = LendingPool(_p); usdst = _u; mtoken = _m; liq = _q;
    }
    function seed(uint amount) public {
        IERC20(usdst).approve(liq, amount);
        pool.depositLiquidity(amount);
    }
    /// @notice Honest exit attempt with no flash mint, for the baseline.
    function seedlessWithdrawAll() public { pool.withdrawLiquidityAll(); }

    function attack(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        principal    = amount;
        sharesBefore = IERC20(mtoken).balanceOf(address(this));
        cashAtEntry  = IERC20(_t).balanceOf(liq);
        claimAtEntry = (sharesBefore * pool.getExchangeRate()) / 1e18;

        IERC20(_t).approve(liq, amount);
        pool.depositLiquidity(amount);              // real deposit: adds exactly `amount` of cash

        // Try to take EVERYTHING: our old claim plus the new deposit.
        allErr = "NO REVERT";
        try pool.withdrawLiquidityAll() { }
        catch Error(string e) { allErr = e; }

        // Fall back to taking exactly the flash principal back out.
        uint b0 = IERC20(_t).balanceOf(address(this));
        try pool.withdrawLiquidity(amount) { }
        catch Error(string e) { }
        got = IERC20(_t).balanceOf(address(this)) - b0;

        sharesAfter = IERC20(mtoken).balanceOf(address(this));
        return "FlashMint.onFlashMint";
    }
}

/// @notice Zero-capital LendingPool liquidator: flash mint -> liquidationCall -> sell -> repay.
contract PoolLiquidator {
    FlashMint public lender;
    LendingPool public pool;
    address public usdst; address public coll; address public victim;
    address public liq; address public desk;
    uint public seized; uint public spent; uint public profit;
    string public err;

    function init(address _l, address _p, address _u, address _q, address _d) public {
        lender = FlashMint(_l); pool = LendingPool(_p); usdst = _u; liq = _q; desk = _d;
    }
    function run(address _coll, address _victim, uint principal) public {
        coll = _coll; victim = _victim;
        lender.flashLoan(address(this), principal, "");
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint c0 = IERC20(coll).balanceOf(address(this));
        uint u0 = IERC20(_t).balanceOf(address(this));

        IERC20(_t).approve(liq, amount);
        err = "NO REVERT";
        try pool.liquidationCall(coll, victim, amount, 0) { }
        catch Error(string e) { err = e; }

        seized = IERC20(coll).balanceOf(address(this)) - c0;
        spent  = u0 - IERC20(_t).balanceOf(address(this));

        if (seized > 0) {
            IERC20(coll).approve(desk, seized);
            Desk(desk).settle(coll, seized, _t);
        }
        profit = IERC20(_t).balanceOf(address(this)) - (amount + fee);
        return "FlashMint.onFlashMint";
    }
}

/// @notice Donates a flash mint into the LiquidityPool (raw transfer, no deposit) and
///         samples the share price. NOTE: the donation is UNRECOVERABLE, so this
///         borrower must repay out of its own float. Left for last: it pollutes the pool.
contract Donor {
    FlashMint public lender;
    LendingPool public pool;
    address public usdst; address public liq;
    uint public rateBefore; uint public rateDuring;
    uint public cashBefore; uint public cashDuring;
    uint public donated;

    function init(address _l, address _p, address _u, address _q) public {
        lender = FlashMint(_l); pool = LendingPool(_p); usdst = _u; liq = _q;
    }
    function probe(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        rateBefore = pool.getExchangeRate();
        cashBefore = IERC20(_t).balanceOf(liq);
        donated = amount;
        IERC20(_t).transfer(liq, amount);
        rateDuring = pool.getExchangeRate();
        cashDuring = IERC20(_t).balanceOf(liq);
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Credit_Lending is Authorizable {

    Mercata m;
    FlashMint fm;
    LendingPool pool;
    LiquidityPool liq;
    CollateralVault cvault;
    PoolConfigurator conf;
    PriceOracle oracle;
    AdminRegistry admin;
    Desk desk;

    address USDST; address MUSDST; address GOLD;
    Token usdstT; Token mT; Token goldT;

    uint RAY; uint CAP;

    function beforeAll() public {
        bypassAuthorizations = true;
        RAY = 1e27;
        CAP = 2000000e18;

        m      = new Mercata();
        fm     = new FlashMint(address(m.adminRegistry()));
        pool   = m.lendingPool();
        liq    = m.liquidityPool();
        cvault = m.collateralVault();
        conf   = m.poolConfigurator();
        oracle = m.priceOracle();
        admin  = m.adminRegistry();

        USDST  = m.tokenFactory().createToken("USDST","USDST",[],[],[],"USDST",0,18);
        MUSDST = m.tokenFactory().createToken("mUSDST","mUSDST",[],[],[],"mUSDST",0,18);
        GOLD   = m.tokenFactory().createToken("GOLDST","GOLDST",[],[],[],"GOLDST",0,18);
        usdstT = Token(USDST); mT = Token(MUSDST); goldT = Token(GOLD);
        usdstT.setStatus(2); mT.setStatus(2); goldT.setStatus(2);

        admin.castVoteOnIssue(address(admin), "addWhitelist", MUSDST, "mint", address(liq));
        admin.castVoteOnIssue(address(admin), "addWhitelist", MUSDST, "burn", address(liq));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        conf.setBorrowableAsset(USDST);
        conf.setMToken(MUSDST);
        conf.setDebtCeilings(100000000e18, 100000000e18);
        conf.setSafetyShareBps(1000);
        // 5% APY on the borrowable asset, 10% reserve factor
        conf.configureAsset(USDST, 0, 0, 11000, 500, 1000, 1000000001547125956666413085);
        conf.configureAsset(GOLD, 7500, 8000, 10500, 0, 0, RAY);

        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLD, 2000e18);

        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);

        desk = new Desk();
        desk.setPrice(USDST, 1e18);
        desk.setPrice(GOLD, 2000e18);
        usdstT.mint(address(desk), 5000000e18);

        // Seed the pool: 1,000,000 USDST of supply.
        usdstT.mint(address(this), 1000000e18);
        IERC20(USDST).approve(address(liq), 1000000e18);
        pool.depositLiquidity(1000000e18);
    }

    function beforeEach() public { }

    // ═════════════════════════════════════════════════════════════════════════
    // 5a — REAL accrual, then a flash mint. Does the biggest USDST balance in
    //      existence perturb the borrow index or the share price? Time is advanced
    //      so the assertion is non-trivial (the harness starts at timestamp 0).
    // ═════════════════════════════════════════════════════════════════════════
    function it_aa_flash_minted_balance_does_not_perturb_index_or_share_price() public {
        // Create real debt, then let a year of interest actually accrue.
        User b = new User();
        goldT.mint(address(b), 500e18);                       // 500 GOLD @ $2,000 = $1,000,000
        b.do(GOLD, "approve", address(cvault), 500e18);
        b.do(address(pool), "supplyCollateral", GOLD, 500e18);
        b.do(address(pool), "borrow", 400000e18);

        uint idx0  = pool.borrowIndex();
        uint debt0 = pool.getUserDebt(address(b));
        fastForward(365 * 24 * 60 * 60);
        uint idxPrev = pool.previewBorrowIndex();
        uint rate0   = pool.getExchangeRate();

        log("5a borrowIndex at t0            : " + string(idx0));
        log("5a previewBorrowIndex at t0+1yr : " + string(idxPrev));
        log("5a borrower debt at t0          : " + string(debt0));
        log("5a borrower debt preview at +1yr: " + string(pool.getUserDebtPreview(address(b))));
        require(idxPrev > idx0, "accrual is live: the index really moved over a year");

        IndexProbe p = new IndexProbe();
        p.init(address(fm), address(pool), USDST);
        usdstT.mint(address(p), 1e18);
        p.probe(CAP);   // 2,000,000 USDST sitting on the borrower's balance sheet

        log("5a index  before/during flash   : " + string(p.idxBefore()) + " / " + string(p.idxDuring()));
        log("5a share price before/during    : " + string(p.rateBefore()) + " / " + string(p.rateDuring()));

        require(p.idxDuring() == p.idxBefore(),
            "CONFIRMED: a flash-minted USDST balance cannot move borrowIndex (no utilization term)");
        require(p.rateDuring() == p.rateBefore(),
            "CONFIRMED: merely HOLDING flash-minted USDST does not move the share price");
    }

    /// @notice ...and the rate has no utilization input at all. Record the config.
    function it_ab_rate_is_a_governance_constant_not_a_utilization_curve() public {
        (uint ltv, uint lt, uint lb, uint ir, uint rf, uint psf) = pool.getAssetConfig(USDST);
        log("5b configured interestRate (bps): " + string(ir) + "  <- stored, only used in an event");
        log("5b perSecondFactorRAY           : " + string(psf) + "  <- the ONLY accrual input");
        log("5b totalScaledDebt              : " + string(pool.totalScaledDebt()));
        log("5b pool cash                    : " + string(usdstT.balanceOf(address(liq))));
        require(psf > RAY, "the only rate input is a governance constant");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5b — ZERO-CAPITAL lending liquidation (the facility's intended use, on this surface).
    // ═════════════════════════════════════════════════════════════════════════
    function it_ba_zero_capital_lending_liquidation() public {
        User v = new User();
        goldT.mint(address(v), 100e18);                 // 100 GOLD @ $2,000 = $200,000
        v.do(GOLD, "approve", address(cvault), 100e18);
        v.do(address(pool), "supplyCollateral", GOLD, 100e18);
        v.do(address(pool), "borrow", 140000e18);       // LTV 75% -> $150k capacity

        log("5c borrower debt                : " + string(pool.getUserDebt(address(v))));
        log("5c health factor before the gap : " + string(pool.getHealthFactor(address(v))));

        oracle.setAssetPrice(GOLD, 1200e18);
        desk.setPrice(GOLD, 1200e18);
        log("5c health factor after the gap  : " + string(pool.getHealthFactor(address(v))));

        PoolLiquidator pl = new PoolLiquidator();
        pl.init(address(fm), address(pool), USDST, address(liq), address(desk));
        require(usdstT.balanceOf(address(pl)) == 0, "liquidator starts with ZERO USDST capital");

        pl.run(GOLD, address(v), 70000e18);

        log("5c liquidationCall result       : '" + pl.err() + "'");
        log("5c USDST spent                  : " + string(pl.spent()));
        log("5c GOLD seized (wei)            : " + string(pl.seized()));
        log("5c seized value @ $1,200        : " + string((pl.seized() * 1200e18) / 1e18));
        log("5c liquidator profit (USDST)    : " + string(pl.profit()));
        log("5c liquidator ending USDST      : " + string(usdstT.balanceOf(address(pl))));

        require(pl.err() == "NO REVERT", "liquidation executed with zero starting capital");
        require(pl.seized() > 0, "DEMONSTRATED: collateral seized without any liquidator capital");
        require(pl.profit() > 0, "DEMONSTRATED: the 5% liquidationBonus captured from zero capital");

        oracle.setAssetPrice(GOLD, 2000e18);
        desk.setPrice(GOLD, 2000e18);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5c — can a flash mint jump the withdrawal queue in a fully-borrowed pool?
    // ═════════════════════════════════════════════════════════════════════════
    function it_ca_flash_mint_cannot_jump_the_withdrawal_queue() public {
        QueueJumper q = new QueueJumper();
        q.init(address(fm), address(pool), USDST, MUSDST, address(liq));
        usdstT.mint(address(q), 200000e18);
        q.seed(200000e18);
        uint sharesSeeded = mT.balanceOf(address(q));

        // Drain the pool's cash so an honest withdrawal is impossible.
        User hog = new User();
        goldT.mint(address(hog), 2000e18);              // $4,000,000 of collateral
        hog.do(GOLD, "approve", address(cvault), 2000e18);
        hog.do(address(pool), "supplyCollateral", GOLD, 2000e18);
        uint cashPre = usdstT.balanceOf(address(liq));
        // Leave $50,000 of free cash: far less than the jumper's $200,000 claim.
        hog.do(address(pool), "borrow", cashPre - 50000e18);

        uint cashNow = usdstT.balanceOf(address(liq));
        log("5d pool cash after draining     : " + string(cashNow));
        log("5d jumper shares                : " + string(sharesSeeded));
        log("5d jumper claim (USDST)         : " + string((sharesSeeded * pool.getExchangeRate()) / 1e18));

        // Honest exit is refused.
        string honest = "NO REVERT";
        try q.seedlessWithdrawAll() { } catch Error(string e) { honest = e; }

        usdstT.mint(address(q), 1000e18);   // dust float only
        uint own0 = usdstT.balanceOf(address(q));
        q.attack(CAP);
        uint own1 = usdstT.balanceOf(address(q));

        log("5d withdrawLiquidityAll during flash: '" + q.allErr() + "'");
        log("5d flash principal deposited        : " + string(q.principal()));
        log("5d underlying pulled back out       : " + string(q.got()));
        log("5d shares before / after            : " + string(q.sharesBefore()) + " / " + string(q.sharesAfter()));
        log("5d own USDST before / after         : " + string(own0) + " / " + string(own1));
        log("5d net extracted                    : " + string(own1) + " - " + string(own0));

        require(own1 <= own0,
            "BLOCKED: a flash-minted deposit buys exactly its own withdrawal, not one wei more");
        require(q.sharesAfter() <= q.sharesBefore(),
            "BLOCKED: the round trip destroys shares (ceil-rounded burn), it never creates them");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 5d — the live-balance share price IS movable, but only with real capital,
    //      because a raw donation into LiquidityPool is unrecoverable.
    //      RUN LAST: this test permanently inflates the pool.
    // ═════════════════════════════════════════════════════════════════════════
    function it_za_share_price_is_donation_movable_but_the_donation_is_unrecoverable() public {
        Donor d = new Donor();
        d.init(address(fm), address(pool), USDST, address(liq));
        // The borrower must repay out of its OWN float, because the donated principal
        // cannot come back: LiquidityPool has no path that returns unaccounted cash.
        usdstT.mint(address(d), CAP);
        uint ownBefore = usdstT.balanceOf(address(d));

        d.probe(CAP);

        uint ownAfter = usdstT.balanceOf(address(d));
        log("5e pool cash before / during    : " + string(d.cashBefore()) + " / " + string(d.cashDuring()));
        log("5e share price before / during  : " + string(d.rateBefore()) + " / " + string(d.rateDuring()));
        log("5e share price AFTER the tx     : " + string(pool.getExchangeRate()));
        log("5e donor own USDST before/after : " + string(ownBefore) + " / " + string(ownAfter));
        log("5e donor net cost               : " + string(ownBefore - ownAfter));

        require(d.rateDuring() > d.rateBefore(),
            "DEMONSTRATED: getExchangeRate() moves on a live, unguarded balanceOf");
        require(pool.getExchangeRate() > d.rateBefore(),
            "DEMONSTRATED: the move is PERMANENT - the donation stays in the pool");
        require(ownBefore - ownAfter == CAP,
            "BOUND: the donor paid the full principal out of its own capital. FlashMint gives no leverage here.");
    }

    /// @notice For contrast: SafetyModule refuses exactly this, via its own _managedAssets
    ///         counter. LiquidityPool has no equivalent.
    function it_zb_no_managed_assets_counter_on_the_liquidity_pool() public {
        uint cash = usdstT.balanceOf(address(liq));
        uint impliedUnderlying = (mT.totalSupply() * pool.getExchangeRate()) / 1e18;
        log("5f LiquidityPool live cash      : " + string(cash));
        log("5f mToken supply x share price  : " + string(impliedUnderlying));
        log("5f reservesAccrued              : " + string(pool.reservesAccrued()));
        log("5f (contrast: SafetyModule.sol:44 keeps a private _managedAssets counter and");
        log("5f  totalAssets():114-118 returns THAT, never balanceOf. LiquidityPool has none.)");
        require(cash > 0, "pool holds the donated cash with no accounting entry of its own");
    }
}
