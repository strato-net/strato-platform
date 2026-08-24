// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERSARIAL: FlashMint's own guards.
//   6a  can maxLoan be exceeded / stacked (nesting, intermediary, per-tx)
//   6b  can Ownable.onlyOwner's try/catch swallow a failed Token.mint / Token.burn
//   6c  can `locked` be left stuck true (bricking) via a caught revert
//   6d  pausing the USDST Token itself must stop the facility
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

/// @notice Plain borrower: repays out of its own float.
contract Plain {
    FlashMint public lender;
    address public token;
    uint public seen;

    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        seen = IERC20(_t).balanceOf(address(this));
        return "FlashMint.onFlashMint";
    }
}

/// @notice Deliberately keeps the principal, so repayment must fail.
contract Thief {
    FlashMint public lender;
    address public token;
    address public stash;
    function init(address _l, address _t, address _s) public { lender = FlashMint(_l); token = _t; stash = _s; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        IERC20(_t).transfer(stash, amount);
        return "FlashMint.onFlashMint";
    }
}

/// @notice Borrower whose callback asks a DIFFERENT contract to draw a second loan.
///         Tests whether `locked` is a facility-wide lock or only self-reentrancy.
contract Indirect {
    FlashMint public lender;
    address public token;
    Plain public helper;
    bool public helperTried;
    bool public helperSucceeded;

    function init(address _l, address _t, address _h) public {
        lender = FlashMint(_l); token = _t; helper = Plain(_h);
    }
    function go(uint amount, uint helperAmount) public {
        lender.flashLoan(address(this), amount, helperAmount);
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint helperAmount = uint(data[0]);
        helperTried = true;
        try {
            helper.go(helperAmount);
            helperSucceeded = true;
        } catch { helperSucceeded = false; }
        return "FlashMint.onFlashMint";
    }
}

/// @notice Fires N sequential (non-nested) maxLoan draws inside ONE transaction.
contract Serial {
    FlashMint public lender;
    address public token;
    uint public drawn;
    uint public totalDrawn;

    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }

    function burst(uint amount, uint times) public {
        for (uint i = 0; i < times; i++) {
            lender.flashLoan(address(this), amount, "");
        }
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        drawn += 1;
        totalDrawn += amount;
        return "FlashMint.onFlashMint";
    }
}

/// @notice Re-enters the facility directly and records the exact revert string.
contract NestProbe {
    FlashMint public lender;
    address public token;
    string public err;

    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        err = "NO REVERT";
        try lender.flashLoan(address(this), amount, "") {
            err = "NO REVERT";
        } catch Error(string e) { err = e; }
        return "FlashMint.onFlashMint";
    }
}

/// @notice Swallows a failing flashLoan inside try/catch. Used to probe whether a caught
///         revert rolls back FlashMint's `locked` flag or leaves the facility bricked.
contract Swallower {
    Thief public bad;
    bool public caught;
    function init(address _b) public { bad = Thief(_b); }
    function attempt(uint amount) public {
        try { bad.go(amount); } catch { caught = true; }
    }
}

contract Describe_Adv_Credit_Guards is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;
    PriceOracle oracle;
    AdminRegistry admin;

    address USDST;
    address COLL;
    Token usdstT;
    Token collT;

    uint CAP;
    uint WAD;

    function beforeAll() public {
        bypassAuthorizations = true;
        WAD = 1e18;
        CAP = 2000000e18;   // vendor's own cap = 40% of live USDST float

        m        = new Mercata();
        cdp      = m.cdpEngine();
        cdpVault = m.cdpVault();
        reg      = m.cdpRegistry();
        oracle   = m.priceOracle();
        admin    = m.adminRegistry();
        fm       = m.flashMint();

        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        COLL  = m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18);
        collT = Token(COLL);
        collT.setStatus(2);
        oracle.setAssetPrice(COLL, 100e18);
        // mainnet-shaped: LR 1.50, minCR 1.55, penalty 10%, close factor 50%, no accrual
        cdp.setCollateralAssetParams(COLL, 150e16, 155e16, 1000, 5000, 1e27, 1e18, 1e30, WAD, false);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);
    }

    function beforeEach() public { }

    // ─────────────────────────────────────────────────────────────────────────
    // 6d — USDST PAUSED. mint/burn are only `onlyOwner`, but FlashMint must still
    //      refuse to mint while the token is paused.
    // ─────────────────────────────────────────────────────────────────────────
    function it_da_token_pause_stops_the_facility() public {
        Plain b = new Plain();
        b.init(address(fm), USDST);

        require(!usdstT.paused(), "precondition: USDST unpaused");

        usdstT.pause();
        require(usdstT.paused(), "USDST must be paused");
        require(!fm.paused(), "FlashMint.paused is independent");

        uint supplyBefore = usdstT.totalSupply();
        uint servedBefore = fm.loansServed();

        try {
            b.go(CAP);
            require(false, "flash mint must revert while USDST is paused");
        } catch { }

        require(fm.maxFlashLoan() == 0, "token pause advertises 0");
        require(!fm.canBorrow(address(b)), "token pause closes canBorrow");
        require(fm.loansServed() == servedBefore, "no loan while USDST paused");
        require(usdstT.totalSupply() == supplyBefore, "supply unchanged");

        usdstT.unpause();
        require(!usdstT.paused(), "cleanup: unpaused");
        b.go(1e18);
        require(fm.loansServed() == servedBefore + 1, "unpause restores flashLoan");
    }

    /// @notice A flash-driven CDP unwind is also blocked: the loan never starts.
    function it_db_token_pause_blocks_flash_driven_cdp_repay() public {
        SelfUnwinder su = new SelfUnwinder();
        su.init(address(fm), address(cdp), USDST);
        collT.mint(address(su), 4000e18);           // 4,000 COLL @ $100 = $400,000
        su.open(COLL, 4000e18, 150000e18);          // borrow $150,000
        usdstT.mint(address(su), 200000e18);

        usdstT.pause();
        require(usdstT.paused(), "USDST paused");

        (uint colBefore, uint debtBefore) = cdp.vaults(address(su), COLL);
        try {
            su.unwindNoSale(COLL, 150000e18);
            require(false, "flash unwind must revert while USDST is paused");
        } catch { }
        (uint colAfter, uint debtAfter) = cdp.vaults(address(su), COLL);

        require(debtAfter == debtBefore, "debt untouched");
        require(colAfter == colBefore, "collateral untouched");

        usdstT.unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6a — cap stacking
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice A borrower's callback asking a DIFFERENT contract to draw. If `locked` is
    ///         facility-wide this is blocked; record the exact revert string.
    function it_ea_intermediary_cannot_stack_simultaneous_loans() public {
        Plain helper = new Plain();
        helper.init(address(fm), USDST);
        Indirect ind = new Indirect();
        ind.init(address(fm), USDST, address(helper));

        uint supplyBefore = usdstT.totalSupply();
        ind.go(CAP, CAP);

        log("6a helper tried: " + string(ind.helperTried()) + " helper succeeded: " + string(ind.helperSucceeded()));
        require(ind.helperTried(), "helper path must have been attempted");
        require(!ind.helperSucceeded(), "BLOCKED: nested draw through an intermediary must fail");
        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");

        // Capture the exact revert string from a direct nested attempt.
        NestProbe np = new NestProbe();
        np.init(address(fm), USDST);
        np.go(1e18);
        log("6a exact revert on nested draw: '" + np.err() + "'");
        require(np.err() == "FlashMint: reentrant", "guard must be the nonReentrant lock");
    }

    /// @notice maxLoan is per-CALL, not per-transaction or per-block.
    function it_eb_maxLoan_is_per_call_not_per_transaction() public {
        Serial s = new Serial();
        s.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();

        s.burst(CAP, 5);   // five sequential maxLoan draws inside ONE transaction

        log("6a sequential draws in ONE tx: " + string(s.drawn()));
        log("6a total USDST minted in ONE tx (wei): " + string(s.totalDrawn()));
        log("6a maxLoan (wei): " + string(fm.maxLoan()));

        require(s.drawn() == 5, "five loans must have been served in one tx");
        require(s.totalDrawn() == 5 * CAP, "total flash volume = 5x maxLoan in one tx");
        require(usdstT.totalSupply() == supplyBefore, "supply neutral");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6c — is `locked` left stuck true after a CAUGHT revert?
    // ─────────────────────────────────────────────────────────────────────────
    function it_fa_caught_revert_does_not_brick_the_facility() public {
        Thief t = new Thief();
        t.init(address(fm), USDST, address(this));
        Swallower sw = new Swallower();
        sw.init(address(t));

        uint supplyBefore = usdstT.totalSupply();
        uint sinkBefore = usdstT.balanceOf(address(this));

        // The inner flashLoan reverts (not repaid); the revert is CAUGHT by Swallower,
        // so the outer transaction commits. Question: is `locked` still true?
        sw.attempt(CAP);
        log("6c caught the inner revert: " + string(sw.caught()));

        require(usdstT.totalSupply() == supplyBefore, "no supply leaked through the caught revert");
        require(usdstT.balanceOf(address(this)) == sinkBefore, "no value leaked to the stash");

        // Now try a normal loan. If `locked` stuck true the facility is bricked.
        Plain p = new Plain();
        p.init(address(fm), USDST);
        bool stillWorks = false;
        string err = "";
        try p.go(1e18) { stillWorks = true; } catch Error(string e) { err = e; }

        log("6c facility still usable after caught revert: " + string(stillWorks) + " err='" + err + "'");
        require(stillWorks, "BRICKED: `locked` was left true by a caught revert");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6b — Ownable.onlyOwner runs the BODY inside try{}; can a failed
    //      Token.mint / Token.burn be swallowed into castVoteOnIssue?
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Revoke the "burn" grant but keep "mint". If the failed burn is swallowed,
    ///         the borrower keeps freshly minted USDST -> infinite money printer.
    function it_ga_revoked_burn_grant_cannot_leave_minted_usdst_outstanding() public {
        // Confirm both grants are live first.
        require(admin.whitelist(USDST, "mint", address(fm)), "mint grant present");
        require(admin.whitelist(USDST, "burn", address(fm)), "burn grant present");

        admin.castVoteOnIssue(address(admin), "removeWhitelist", USDST, "burn", address(fm));
        require(!admin.whitelist(USDST, "burn", address(fm)), "burn grant revoked");

        Plain p = new Plain();
        p.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();

        bool succeeded = false;
        string err = "";
        try p.go(500000e18) { succeeded = true; } catch Error(string e) { err = e; }

        uint supplyAfter = usdstT.totalSupply();
        uint stranded = usdstT.balanceOf(address(p));

        log("6b burn-revoked: flashLoan succeeded=" + string(succeeded) + " err='" + err + "'");
        log("6b totalSupply before/after: " + string(supplyBefore) + " -> " + string(supplyAfter));
        log("6b USDST left stranded on the borrower (wei): " + string(stranded));

        require(supplyAfter == supplyBefore, "SWALLOWED BURN: supply grew with no debt behind it");
        require(stranded == 0, "SWALLOWED BURN: borrower kept flash-minted USDST");

        // restore
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        require(admin.whitelist(USDST, "burn", address(fm)), "burn grant restored");
    }

    /// @notice Same probe on the mint side.
    function it_gb_revoked_mint_grant_cannot_produce_a_phantom_loan() public {
        admin.castVoteOnIssue(address(admin), "removeWhitelist", USDST, "mint", address(fm));
        require(!admin.whitelist(USDST, "mint", address(fm)), "mint grant revoked");

        Plain p = new Plain();
        p.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();

        bool succeeded = false;
        string err = "";
        try p.go(500000e18) { succeeded = true; } catch Error(string e) { err = e; }

        log("6b mint-revoked: flashLoan succeeded=" + string(succeeded) + " err='" + err + "'");
        log("6b borrower saw (wei): " + string(p.seen()));
        log("6b totalSupply delta: " + string(usdstT.totalSupply() - supplyBefore));

        require(usdstT.totalSupply() == supplyBefore, "no supply change");

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        require(admin.whitelist(USDST, "mint", address(fm)), "mint grant restored");
    }

    /// @notice initialize() has no once-guard: governance (or an admin) may re-point the
    ///         facility's token at any time. Record the fact.
    function it_ha_initialize_has_no_once_guard() public {
        address before = fm.token();
        fm.initialize(USDST, address(m.feeCollector()), 0);
        log("6b initialize() re-called successfully. token before/after: "
            + string(before) + " / " + string(fm.token()));
        log("6b re-initialize RESET maxLoan to " + string(fm.maxLoan())
            + " and whitelistEnabled to " + string(fm.whitelistEnabled()));
        require(fm.maxLoan() == 0, "re-initialize resets maxLoan (fails closed)");
        fm.setMaxLoan(CAP);
        fm.setWhitelistEnabled(false);
    }
}

/// @notice Vault owner that unwinds itself with a flash mint but sells nothing
///         (it repays the loan out of its own float). Used for the paused-USDST proof.
contract SelfUnwinder {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public collateral;
    uint public withdrawn;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }
    function open(address _coll, uint deposit, uint mintUSD) public {
        collateral = _coll;
        IERC20(_coll).approve(address(cdp.registry().cdpVault()), deposit);
        cdp.deposit(_coll, deposit);
        cdp.mint(_coll, mintUSD);
    }
    function unwindNoSale(address _coll, uint debtAmount) public {
        collateral = _coll;
        lender.flashLoan(address(this), debtAmount, "");
    }
    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        cdp.repayAll(collateral);
        withdrawn = cdp.withdrawMax(collateral);
        return "FlashMint.onFlashMint";
    }
}
