import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

/// Minimal borrower: repays out of its own float.
contract Borrower {
    FlashMint public lender;
    address public token;
    bool public callbackRan;

    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        callbackRan = true;
        return "FlashMint.onFlashMint";
    }
}

/// Audits the bolt-on DEPLOYMENT and GOVERNANCE wiring of FlashMint (see FLASHMINT_DEPLOYMENT.md).
/// Mercata does not deploy the facility; tests stand up the same proxy-owned, closed-at-launch shape.
contract Describe_FlashMintWiring is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;
    address USDST;
    Token usdstT;

    function beforeAll() public {
        bypassAuthorizations = true;
        m     = new Mercata();
        admin = m.adminRegistry();

        fm = new FlashMint(address(admin));
        fm.initialize(
            address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010),
            address(m.feeCollector()),
            0
        );

        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
    }

    // ── W1: Production initialize() pins the facility at the HARD-CODED mainnet USDST,
    //        which does not exist in a fresh deployment, and accepts it.
    function it_w1_ships_pointed_at_a_hardcoded_address() public {
        require(fm.token() == address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010),
            "BaseCodeCollection pinned token");
        require(fm.maxLoan() == 0, "ships with maxLoan 0");
        require(fm.whitelistEnabled(), "ships whitelisted");
    }

    // ── W2: initialize() has NO one-shot guard. It can be re-run to re-point the
    //        facility at a different token, silently resetting every risk dial.
    function it_w2_initialize_is_re_callable_and_repoints_the_token() public {
        address before = fm.token();
        fm.setMaxLoan(123e18);
        fm.setWhitelistEnabled(false);
        require(fm.maxLoan() == 123e18, "dial set");

        fm.initialize(USDST, address(m.feeCollector()), 0);   // second call — must NOT be allowed

        require(fm.token() == USDST && fm.token() != before, "token re-pointed by re-initialize");
        require(fm.maxLoan() == 0, "re-initialize silently reset maxLoan");
        require(fm.whitelistEnabled(), "re-initialize silently re-armed the whitelist");
    }

    // ── W3: A fresh bolt-on never grants AdminRegistry.whitelist[USDST]["mint"|"burn"][FlashMint],
    //        so the facility as deployed cannot mint. Confirm it fails CLOSED, not open.
    function it_w3_no_mint_grant_means_the_facility_fails_closed() public {
        require(!admin.whitelist(USDST, "mint", address(fm)), "no mint grant exists");
        require(!admin.whitelist(USDST, "burn", address(fm)), "no burn grant exists");

        fm.setMaxLoan(1000e18);
        fm.setWhitelistEnabled(false);

        Borrower b = new Borrower();
        b.init(address(fm), USDST);

        uint supplyBefore = usdstT.totalSupply();
        try {
            b.go(100e18);
            require(false, "ungranted facility must not be able to mint");
        } catch { }
        require(usdstT.totalSupply() == supplyBefore, "no supply leaked");
        require(fm.loansServed() == 0, "no loan recorded");
    }

    // ── W4: With the grants in place, pausing USDST must stop the facility.
    function it_w4_pausing_usdst_stops_the_facility() public {
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        fm.setMaxLoan(1000000e18);
        fm.setWhitelistEnabled(false);

        Borrower b = new Borrower();
        b.init(address(fm), USDST);
        b.go(1000e18);                                  // baseline: works
        require(fm.loansServed() == 1, "baseline loan served");

        usdstT.pause();
        require(usdstT.paused(), "USDST is paused");
        require(fm.maxFlashLoan() == 0, "token pause advertises 0");

        Borrower b2 = new Borrower();
        b2.init(address(fm), USDST);
        uint served = fm.loansServed();
        try {
            b2.go(500000e18);
            require(false, "flash mint must revert while USDST is paused");
        } catch { }
        require(fm.loansServed() == served, "no loan while USDST paused");
        usdstT.unpause();

        b2.go(1e18);
        require(fm.loansServed() == served + 1, "unpause restores flashLoan");
    }

    // ── W5: maxLoan has no ceiling of any kind — not absolute, not relative to supply.
    //        2 of 3 admins can raise it past total supply in one transaction, no timelock.
    function it_w5_maxLoan_has_no_ceiling() public {
        uint supply = usdstT.totalSupply();
        fm.setMaxLoan(supply * 1000 + 1e30);
        require(fm.maxLoan() > supply, "maxLoan can exceed total USDST supply");
        fm.setMaxLoan(0);
    }
}
