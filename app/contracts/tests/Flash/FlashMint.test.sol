// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Borrower fixtures. Each one is a realistic shape of the four actionable use
 * cases, driven through the single FlashMint entry point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/// @notice Baseline: repays exactly principal + fee out of its own float.
contract GoodBorrower {
    FlashMint public lender;
    address public token;
    uint public lastAmount;
    uint public lastFee;
    string public lastNote;

    function init(address _lender, address _token) public {
        lender = FlashMint(_lender);
        token = _token;
    }

    function go(uint amount) public {
        lender.flashLoan(address(this), amount, "note");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "GoodBorrower: bad lender");
        lastAmount = amount;
        lastFee = fee;
        lastNote = string(data[0]);
        return "FlashMint.onFlashMint";
    }
}

/// @notice Spends the principal, so repayment fails and the whole tx must unwind.
contract DeadbeatBorrower {
    FlashMint public lender;
    address public token;
    address public sink;

    function init(address _lender, address _token, address _sink) public {
        lender = FlashMint(_lender);
        token = _token;
        sink = _sink;
    }

    function go(uint amount) public {
        lender.flashLoan(address(this), amount, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        IERC20(_token).transfer(sink, amount);
        return "FlashMint.onFlashMint";
    }
}

/// @notice Returns the wrong acknowledgement.
contract LiarBorrower {
    FlashMint public lender;
    address public token;

    function init(address _lender, address _token) public {
        lender = FlashMint(_lender);
        token = _token;
    }

    function go(uint amount) public {
        lender.flashLoan(address(this), amount, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        return "nope";
    }
}

/// @notice Tries to re-enter the facility to stack past the per-tx cap.
contract NestingBorrower {
    FlashMint public lender;
    address public token;
    bool public nested;

    function init(address _lender, address _token) public {
        lender = FlashMint(_lender);
        token = _token;
    }

    function go(uint amount) public {
        lender.flashLoan(address(this), amount, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        nested = true;
        lender.flashLoan(address(this), amount, "");
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 1 — third-party liquidator with zero USDST of its own.
///         flash mint -> liquidate -> sell seized collateral -> repay.
contract Liquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    CDPVault  public cdpVault;
    address public usdst;
    address public collateral;
    address public borrower;
    address public otc;              // atomic counterparty that pays USDST for collateral
    uint public seized;
    uint public profit;

    function init(address _lender, address _cdp, address _cdpVault, address _usdst) public {
        lender = FlashMint(_lender);
        cdp = CDPEngine(_cdp);
        cdpVault = CDPVault(_cdpVault);
        usdst = _usdst;
    }

    function run(address _collateral, address _borrower, address _otc, uint repayAmount) public {
        collateral = _collateral;
        borrower = _borrower;
        otc = _otc;
        lender.flashLoan(address(this), repayAmount, "liq");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint collBefore = IERC20(collateral).balanceOf(address(this));

        IERC20(_token).approve(address(cdp), amount);
        cdp.liquidate(collateral, borrower, amount);

        seized = IERC20(collateral).balanceOf(address(this)) - collBefore;

        // Atomic exit: hand the seized collateral to a pre-agreed buyer who pays USDST in the
        // same transaction. On STRATO this is the realistic exit path — no AMM depth required.
        IERC20(collateral).approve(otc, seized);
        OTCDesk(otc).settle(collateral, seized, usdst);

        profit = IERC20(_token).balanceOf(address(this)) - (amount + fee);
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 2 — the vault owner closes its own position, dodging the 10% penalty.
contract SelfLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public collateral;
    address public otc;
    uint public withdrawn;
    uint public keptCollateral;

    function init(address _lender, address _cdp, address _usdst) public {
        lender = FlashMint(_lender);
        cdp = CDPEngine(_cdp);
        usdst = _usdst;
    }

    function open(address _collateral, uint deposit, uint mintUSD) public {
        collateral = _collateral;
        IERC20(_collateral).approve(address(cdp.registry().cdpVault()), deposit);
        cdp.deposit(_collateral, deposit);
        cdp.mint(_collateral, mintUSD);
    }

    function unwind(address _otc, uint debtAmount, uint collateralToSell) public {
        otc = _otc;
        lender.flashLoan(address(this), debtAmount, collateralToSell);
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        uint collateralToSell = uint(data[0]);

        IERC20(_token).approve(address(cdp), amount);
        cdp.repayAll(collateral);
        withdrawn = cdp.withdrawMax(collateral);

        IERC20(collateral).approve(otc, collateralToSell);
        OTCDesk(otc).settle(collateral, collateralToSell, usdst);

        keptCollateral = IERC20(collateral).balanceOf(address(this));
        return "FlashMint.onFlashMint";
    }
}

/// @notice USE CASE 4 — one-shot leverage: borrow, buy collateral, deposit, re-mint, repay.
contract Leverager {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public collateral;
    address public otc;
    uint public finalCollateral;
    uint public finalDebt;

    function init(address _lender, address _cdp, address _usdst) public {
        lender = FlashMint(_lender);
        cdp = CDPEngine(_cdp);
        usdst = _usdst;
    }

    /// @notice Deposit the starting equity before levering.
    function open_equity(address _collateral, address _cdp) public {
        collateral = _collateral;
        uint bal = IERC20(_collateral).balanceOf(address(this));
        IERC20(_collateral).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(_collateral, bal);
    }

    function lever(address _collateral, address _otc, uint borrowUSDST) public {
        collateral = _collateral;
        otc = _otc;
        lender.flashLoan(address(this), borrowUSDST, "");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        // Buy collateral with the flash-minted USDST.
        IERC20(_token).approve(otc, amount);
        uint bought = OTCDesk(otc).settle(_token, amount, collateral);

        // Deposit everything and mint back up to the minCR limit.
        IERC20(collateral).approve(address(cdp.registry().cdpVault()), IERC20(collateral).balanceOf(address(this)));
        cdp.deposit(collateral, IERC20(collateral).balanceOf(address(this)));
        cdp.mintMax(collateral);

        (finalCollateral, finalDebt) = cdp.vaults(address(this), collateral);
        return "FlashMint.onFlashMint";
    }
}

/// @notice A trivially-priced two-sided desk standing in for a pool / PSM / OTC counterparty.
///         Prices are set by the test so the arithmetic in each trace is exact.
contract OTCDesk {
    mapping(address => uint) public priceWad;   // asset -> USD price, 1e18

    function setPrice(address asset, uint p) public { priceWad[asset] = p; }

    /// @notice Sell `amountIn` of `tokenIn` for `tokenOut` at oracle-parity. Returns amountOut.
    function settle(address tokenIn, uint amountIn, address tokenOut) public returns (uint amountOut) {
        require(priceWad[tokenIn] > 0 && priceWad[tokenOut] > 0, "OTCDesk: unpriced");
        amountOut = (amountIn * priceWad[tokenIn]) / priceWad[tokenOut];
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "OTCDesk: in");
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "OTCDesk: out");
        return amountOut;
    }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Suite
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract Describe_FlashMint is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault  cdpVault;
    CDPRegistry reg;
    PriceOracle oracle;
    AdminRegistry admin;

    address USDST;
    address COLL;
    Token usdstT;
    Token collT;

    OTCDesk desk;

    uint WAD;
    uint LR;
    uint MINCR;
    uint PEN;
    uint CF;
    uint SFR;
    uint FLOOR_;
    uint CEIL_;
    uint CAP;

    function beforeAll() public {
        bypassAuthorizations = true;

        WAD    = 1e18;
        LR     = 150e16;   // 1.50
        MINCR  = 155e16;   // 1.55 — mainnet value
        PEN    = 1000;     // 10%
        CF     = 5000;     // 50%
        SFR    = 1e27;     // no accrual, keeps arithmetic exact
        FLOOR_ = 1e18;
        CEIL_  = 1e30;
        CAP    = 2000000e18;

        m        = new Mercata();
        cdp      = m.cdpEngine();
        cdpVault = m.cdpVault();
        reg      = m.cdpRegistry();
        oracle   = m.priceOracle();
        admin    = m.adminRegistry();
        fm       = new FlashMint(address(admin));

        // USDST
        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        // Collateral
        COLL  = m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18);
        collT = Token(COLL);
        collT.setStatus(2);
        oracle.setAssetPrice(COLL, 100e18);
        cdp.setCollateralAssetParams(COLL, LR, MINCR, PEN, CF, SFR, FLOOR_, CEIL_, WAD, false);

        // The two mint/burn grants — identical in shape to the ones CDPEngine already holds.
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        // Point the facility at this suite's USDST and open it.
        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);

        desk = new OTCDesk();
        desk.setPrice(USDST, 1e18);
        desk.setPrice(COLL, 100e18);
    }

    function beforeEach() public { }

    // ───────────────────────── Wiring & guards ─────────────────────────

    function it_aa_ships_closed_by_default() public {
        FlashMint fresh = new FlashMint(address(this));
        fresh.initialize(USDST, address(m.feeCollector()), 0);
        require(fresh.maxLoan() == 0, "fresh facility must be disabled");
        require(fresh.whitelistEnabled(), "fresh facility must be whitelisted");
        require(fresh.maxFlashLoan() == 0, "fresh maxFlashLoan must be 0");
        require(!fresh.canBorrow(address(this)), "nobody may borrow from a fresh facility");
    }

    // ───────────────────────── Core invariants ─────────────────────────

    function it_ba_happy_path_is_supply_neutral() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);

        uint supplyBefore = usdstT.totalSupply();
        uint servedBefore = fm.loansServed();

        b.go(1000000e18);

        // With a borrower that touches nothing else, the facility's neutrality shows up
        // directly in totalSupply.
        require(usdstT.totalSupply() == supplyBefore, "supply must be unchanged");
        require(usdstT.balanceOf(address(b)) == 0, "borrower must end flat");
        require(b.lastAmount() == 1000000e18, "callback amount");
        require(b.lastFee() == 0, "callback fee");
        require(b.lastNote() == "note", "callback data forwarded");
        require(fm.loansServed() == servedBefore + 1, "loan counted");
        require(fm.largestLoan() >= 1000000e18, "largestLoan tracked");
    }

    function it_bb_non_repayment_unwinds_everything() public {
        DeadbeatBorrower d = new DeadbeatBorrower();
        d.init(address(fm), USDST, address(this));

        uint supplyBefore = usdstT.totalSupply();
        uint sinkBefore   = usdstT.balanceOf(address(this));

        try {
            d.go(500000e18);
            require(false, "unrepaid flash mint must revert");
        } catch { }

        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");
        require(usdstT.balanceOf(address(this)) == sinkBefore, "no value leaked to sink");
    }

    function it_bc_rejects_bad_acknowledgement() public {
        LiarBorrower l = new LiarBorrower();
        l.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();
        try {
            l.go(1e18);
            require(false, "bad ack must revert");
        } catch { }
        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");
    }

    function it_bd_cap_cannot_be_stacked_by_nesting() public {
        NestingBorrower n = new NestingBorrower();
        n.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();
        try {
            n.go(CAP);
            require(false, "re-entry must revert");
        } catch { }
        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");
    }

    function it_be_enforces_per_tx_cap() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        try {
            b.go(CAP + 1);
            require(false, "above-cap loan must revert");
        } catch { }
        b.go(CAP);   // exactly at the cap is fine
        require(usdstT.balanceOf(address(b)) == 0, "borrower flat");
    }

    function it_bf_third_party_cannot_be_named_as_receiver() public {
        GoodBorrower victim = new GoodBorrower();
        victim.init(address(fm), USDST);
        // Calling directly, so msg.sender is this suite while receiver is the victim.
        try {
            fm.flashLoan(address(victim), 1e18, "");
            require(false, "receiver != caller must revert");
        } catch { }
    }

    function it_bg_pause_and_whitelist_close_the_facility() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);

        fm.setPaused(true);
        require(fm.maxFlashLoan() == 0, "paused maxFlashLoan is 0");
        try { b.go(1e18); require(false, "paused must revert"); } catch { }
        fm.setPaused(false);

        fm.setWhitelistEnabled(true);
        try { b.go(1e18); require(false, "non-whitelisted must revert"); } catch { }
        fm.setWhitelist(address(b), true);
        b.go(1e18);
        fm.setWhitelistEnabled(false);
    }

    function it_bh_fee_is_supply_neutral_and_reaches_the_collector() public {
        fm.setFeeBps(50);   // 0.5%

        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        usdstT.mint(address(b), 10000e18);   // borrower's own float pays the fee

        uint supplyBefore  = usdstT.totalSupply();
        uint collectBefore = usdstT.balanceOf(address(m.feeCollector()));
        uint accruedBefore = fm.feesAccrued();

        b.go(1000000e18);

        uint fee = (1000000e18 * 50) / 10000;
        require(usdstT.balanceOf(address(m.feeCollector())) == collectBefore + fee, "fee routed");
        require(usdstT.balanceOf(address(b)) == 10000e18 - fee, "fee paid from own float");
        require(usdstT.totalSupply() == supplyBefore, "supply must be unchanged");
        require(fm.feesAccrued() - accruedBefore == fee, "feesAccrued exact");

        fm.setFeeBps(0);
    }

    /// Has the principal but is 1 wei short of the fee. Must fail the repay require,
    /// not the later ERC20 burn — otherwise a mutated check (`>= amount`) still passes.
    function it_bj_short_the_fee_reverts_not_repaid() public {
        fm.setFeeBps(50);

        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);

        uint amount = 10000e18;
        uint fee = (amount * 50) / 10000;
        usdstT.mint(address(b), fee - 1);

        uint supplyBefore = usdstT.totalSupply();
        string err = "";
        try b.go(amount) { } catch Error(string e) { err = e; }

        require(err == "FlashMint: not repaid", "short the fee must hit the repay check");
        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");
        require(usdstT.balanceOf(address(b)) == fee - 1, "borrower's own float untouched");

        fm.setFeeBps(0);
    }

    function it_bi_whitelisted_borrower_pays_no_fee() public {
        fm.setFeeBps(50);

        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        fm.setWhitelist(address(b), true);

        uint collectBefore = usdstT.balanceOf(address(m.feeCollector()));
        b.go(1000000e18);

        require(b.lastFee() == 0, "whitelisted callback fee");
        require(usdstT.balanceOf(address(m.feeCollector())) == collectBefore, "no fee routed");
        require(usdstT.balanceOf(address(b)) == 0, "borrower ends flat");

        fm.setWhitelist(address(b), false);
        fm.setFeeBps(0);
    }

    // ───────────────────────── S9 / S11 / S12 / S14 ─────────────────────────

    function _strangerMustNotMutate(User stranger, string fn, variadic args) private {
        try {
            stranger.callFunction(address(fm), fn, args);
            require(false, "stranger call must revert");
        } catch { }
    }

    /// S9: every risk dial is owner-only. A stranger cannot open, retarget, or fee-reroute the printer.
    function it_da_stranger_cannot_turn_the_dials() public {
        User stranger = new User();

        address tokenBefore   = fm.token();
        address collectorBefore = fm.feeCollector();
        uint maxBefore        = fm.maxLoan();
        uint feeBefore        = fm.feeBps();
        bool pausedBefore     = fm.paused();
        bool whitelistOnBefore  = fm.whitelistEnabled();
        bool whitelistBefore    = fm.whitelist(address(stranger));

        _strangerMustNotMutate(stranger, "initialize", COLL, address(stranger), uint(1));
        _strangerMustNotMutate(stranger, "setMaxLoan", maxBefore + 1);
        _strangerMustNotMutate(stranger, "setFeeBps", uint(1234));
        _strangerMustNotMutate(stranger, "setFeeCollector", address(stranger));
        _strangerMustNotMutate(stranger, "setPaused", !pausedBefore);
        _strangerMustNotMutate(stranger, "setWhitelistEnabled", !whitelistOnBefore);
        _strangerMustNotMutate(stranger, "setWhitelist", address(stranger), true);

        require(fm.token() == tokenBefore, "token");
        require(fm.feeCollector() == collectorBefore, "feeCollector");
        require(fm.maxLoan() == maxBefore, "maxLoan");
        require(fm.feeBps() == feeBefore, "feeBps");
        require(fm.paused() == pausedBefore, "paused");
        require(fm.whitelistEnabled() == whitelistOnBefore, "whitelistEnabled");
        require(fm.whitelist(address(stranger)) == whitelistBefore, "whitelist");
    }

    /// S11: FlashMint.paused is a complete kill switch — views and flashLoan agree, and unpause restores.
    function it_db_flashmint_pause_is_a_complete_kill_switch() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        require(fm.canBorrow(address(b)), "precondition: borrower can draw");

        fm.setPaused(true);
        require(fm.maxFlashLoan() == 0, "paused maxFlashLoan is 0");
        require(!fm.canBorrow(address(b)), "paused canBorrow is false");
        try { b.go(1e18); require(false, "paused flashLoan must revert"); } catch { }

        fm.setPaused(false);
        require(fm.maxFlashLoan() == CAP, "unpause restores maxFlashLoan");
        require(fm.canBorrow(address(b)), "unpause restores canBorrow");
        uint served = fm.loansServed();
        b.go(1e18);
        require(fm.loansServed() == served + 1, "unpause restores flashLoan");
    }

    /// S11: pausing or disabling the configured token stops the facility without touching FlashMint.paused.
    function it_dc_token_pause_and_disable_stop_the_facility() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        uint served = fm.loansServed();

        usdstT.pause();
        require(usdstT.paused(), "USDST paused");
        require(!fm.paused(), "FlashMint.paused is independent");
        require(fm.maxFlashLoan() == 0, "token pause advertises 0");
        require(!fm.canBorrow(address(b)), "token pause closes canBorrow");
        try { b.go(1e18); require(false, "flashLoan must revert while token is paused"); } catch { }
        require(fm.loansServed() == served, "no loan while token paused");
        usdstT.unpause();

        require(fm.maxFlashLoan() == CAP, "unpause restores maxFlashLoan");
        require(fm.canBorrow(address(b)), "unpause restores canBorrow");

        usdstT.setStatus(3);   // LEGACY
        require(fm.maxFlashLoan() == 0, "disabled token advertises 0");
        require(!fm.canBorrow(address(b)), "disabled token closes canBorrow");
        try { b.go(1e18); require(false, "flashLoan must revert while token is disabled"); } catch { }
        require(fm.loansServed() == served, "no loan while token disabled");
        usdstT.setStatus(2);   // ACTIVE

        b.go(1e18);
        require(fm.loansServed() == served + 1, "restored token allows flashLoan");
    }

    /// S12: maxFlashLoan / canBorrow match the flashLoan gates.
    function it_dd_views_agree_with_the_gates() public {
        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);

        require(fm.maxFlashLoan() == CAP, "live maxFlashLoan");

        fm.setFeeBps(50);
        uint fee = (1000000e18 * 50) / 10000;
        usdstT.mint(address(b), 10000e18);
        uint collectBefore = usdstT.balanceOf(address(m.feeCollector()));
        b.go(1000000e18);
        require(usdstT.balanceOf(address(m.feeCollector())) == collectBefore + fee, "charged fee matches formula");
        fm.setFeeBps(0);

        fm.setWhitelistEnabled(true);
        require(!fm.canBorrow(address(b)), "unlist canBorrow");
        try { b.go(1e18); require(false, "unlist flashLoan must revert"); } catch { }
        fm.setWhitelist(address(b), true);
        require(fm.canBorrow(address(b)), "listed canBorrow");
        fm.setWhitelistEnabled(false);
        require(fm.canBorrow(address(b)), "permissionless canBorrow");
    }

    /// S14: born closed is a real disable; zero amount and maxLoan 0 both block flashLoan.
    function it_de_zero_amount_and_disabled_facility_revert() public {
        FlashMint fresh = new FlashMint(address(this));
        fresh.initialize(USDST, address(m.feeCollector()), 0);
        GoodBorrower fb = new GoodBorrower();
        fb.init(address(fresh), USDST);
        require(fresh.maxFlashLoan() == 0, "fresh maxFlashLoan");
        require(!fresh.canBorrow(address(fb)), "fresh canBorrow");
        try { fb.go(1e18); require(false, "fresh flashLoan must revert"); } catch { }

        GoodBorrower b = new GoodBorrower();
        b.init(address(fm), USDST);
        try { b.go(0); require(false, "zero amount must revert"); } catch { }

        uint served = fm.loansServed();
        fm.setMaxLoan(0);
        require(fm.maxFlashLoan() == 0, "maxLoan 0 advertises 0");
        require(!fm.canBorrow(address(b)), "maxLoan 0 closes canBorrow");
        try { b.go(1e18); require(false, "maxLoan 0 flashLoan must revert"); } catch { }
        require(fm.loansServed() == served, "no loan while disabled");
        fm.setMaxLoan(CAP);
        b.go(1e18);
        require(fm.loansServed() == served + 1, "restored cap allows flashLoan");
    }

    // ───────────────────────── Use case traces ─────────────────────────

    /// USE CASE 1: liquidator with no USDST clears a $1.5m-shaped vault.
    function it_ca_liquidation_with_zero_liquidator_capital() public {
        // Borrower opens: 40,000 COLL @ $100 = $4,000,000 collateral, $1,500,000 debt (CR 2.67)
        User borrower = new User();
        collT.mint(address(borrower), 40000e18);
        borrower.callFunction(COLL, "approve", address(cdpVault), 40000e18);
        borrower.callFunction(address(cdp), "deposit", COLL, 40000e18);
        borrower.callFunction(address(cdp), "mint", COLL, 1500000e18);

        // Price drops 45%: collateral $2,200,000 vs debt $1,500,000 -> CR 1.4667 < 1.50
        oracle.setAssetPrice(COLL, 55e18);
        desk.setPrice(COLL, 55e18);
        require(cdp.collateralizationRatio(address(borrower), COLL) < LR, "must be liquidatable");

        // Fund the desk so it can pay for seized collateral.
        usdstT.mint(address(desk), 2000000e18);

        Liquidator liq = new Liquidator();
        liq.init(address(fm), address(cdp), address(cdpVault), USDST);
        require(usdstT.balanceOf(address(liq)) == 0, "liquidator starts with zero USDST");

        uint supplyBefore = usdstT.totalSupply();
        uint repay = 750000e18;   // 50% close factor

        liq.run(COLL, address(borrower), address(desk), repay);

        // Debt burned, so supply falls by exactly the repay: flash mint added nothing.
        require(usdstT.totalSupply() == supplyBefore - repay, "supply drops by repay only");
        // 10% bonus on $750k = $75k, paid in collateral at $55.
        uint expectedSeize = ((repay + repay / 10) * WAD) / 55e18;
        require(liq.seized() == expectedSeize, "seized = (repay + 10%) / price");
        require(liq.profit() == repay / 10, "profit = the liquidation bonus");
        require(usdstT.balanceOf(address(liq)) == repay / 10, "liquidator keeps the bonus");

        oracle.setAssetPrice(COLL, 100e18);
        desk.setPrice(COLL, 100e18);
    }

    /// USE CASE 2: the vault owner unwinds itself and keeps the 10% it would have lost.
    function it_cb_self_liquidation_avoids_the_penalty() public {
        SelfLiquidator sl = new SelfLiquidator();
        sl.init(address(fm), address(cdp), USDST);

        // 40,000 COLL @ $100 = $4,000,000; borrow $1,500,000.
        collT.mint(address(sl), 40000e18);
        sl.open(COLL, 40000e18, 1500000e18);

        // Drop to $55: CR 1.4667, i.e. liquidatable. A liquidator would take $75k of it.
        oracle.setAssetPrice(COLL, 55e18);
        desk.setPrice(COLL, 55e18);
        require(cdp.collateralizationRatio(address(sl), COLL) < LR, "must be liquidatable");

        usdstT.mint(address(desk), 2000000e18);
        uint supplyBefore = usdstT.totalSupply();

        // Sell only enough collateral to clear the debt: $1.5m / $55 = 27272.72... COLL
        uint toSell = (1500000e18 * WAD) / 55e18 + 1;
        sl.unwind(address(desk), 1500000e18, toSell);

        require(usdstT.totalSupply() == supplyBefore - 1500000e18, "supply drops by the debt only");
        require(sl.withdrawn() == 40000e18, "all collateral released");
        (uint colAfter, uint debtAfter) = cdp.vaults(address(sl), COLL);
        require(colAfter == 0 && debtAfter == 0, "vault fully closed");

        // Kept collateral: 40,000 - 27,272.7 = 12,727.3 COLL @ $55 = ~$700k.
        // A 50% liquidation would instead have cost 10% of $750k = $75k.
        require(sl.keptCollateral() == 40000e18 - toSell, "keeps the rest of the collateral");
        require(sl.keptCollateral() > 12000e18, "retains ~$700k of collateral");

        oracle.setAssetPrice(COLL, 100e18);
        desk.setPrice(COLL, 100e18);
    }

    /// USE CASE 4: one-shot leverage to the minCR limit.
    function it_cc_one_shot_leverage_reaches_minCR() public {
        Leverager lev = new Leverager();
        lev.init(address(fm), address(cdp), USDST);

        // Seed equity: 1,000 COLL @ $100 = $100,000.
        collT.mint(address(lev), 1000e18);
        collT.mint(address(desk), 100000e18);
        usdstT.mint(address(desk), 5000000e18);

        // Deposit equity first so the levered mint has a base to build on.
        lev.open_equity(COLL, address(cdp));

        // 2.82x theoretical at 1.55 minCR; borrow $150,000 of flash USDST for one turn.
        uint supplyBefore = usdstT.totalSupply();
        lev.lever(COLL, address(desk), 150000e18);

        (uint col, uint scaledDebt) = cdp.vaults(address(lev), COLL);
        uint cr = cdp.collateralizationRatio(address(lev), COLL);

        require(col == 2500e18, "collateral = equity + levered purchase");
        require(cr >= MINCR, "position must sit at or above minCR");
        require(cr < MINCR + 1e15, "position must sit right at minCR");
        // Net new USDST = the levered debt minus the flash principal that was burned.
        require(usdstT.totalSupply() > supplyBefore, "levered debt is real new supply");
    }
}
