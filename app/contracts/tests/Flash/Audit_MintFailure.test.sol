import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

contract Borrower {
    FlashMint public lender;
    address public token;
    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }
    function go(uint amount) public { lender.flashLoan(address(this), amount, ""); }
    function onFlashMint(address _t, uint a, uint f, variadic d) external returns (string) {
        return "FlashMint.onFlashMint";
    }
}

/*
 * Ownable.onlyOwner in abstract/ERC20/access/Ownable.sol runs the function BODY inside a
 * try block and falls into a catch that calls AdminRegistry.castVoteOnIssue, which ends in
 * `_target.call(_func, _args)`. If that inner .call fails SILENTLY, then a FlashMint that
 * lacks the USDST "mint" grant would mint nothing, pass the balance check against the
 * borrower's own float, and then BURN the borrower's own money. This test decides it.
 */
contract Describe_FlashMintMintFailure is Authorizable {
    Mercata m; FlashMint fm; AdminRegistry admin; address USDST; Token usdstT;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata(); admin = m.adminRegistry(); fm = new FlashMint(address(admin));
        USDST = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        fm.initialize(USDST, address(m.feeCollector()), 1000000e18);
        fm.setWhitelistEnabled(false);
    }

    /// No mint grant, but the borrower is pre-funded so a silently-failed mint would still
    /// satisfy the repayment balance check. Does FlashMint burn the borrower's own float?
    function it_m1_failed_mint_does_not_silently_burn_the_borrower() public {
        require(!admin.whitelist(USDST, "mint", address(fm)), "no mint grant");
        Borrower b = new Borrower();
        b.init(address(fm), USDST);
        usdstT.mint(address(b), 100e18);              // borrower's OWN money

        uint before = usdstT.balanceOf(address(b));
        uint supplyBefore = usdstT.totalSupply();
        bool reverted = false;
        try { b.go(100e18); } catch { reverted = true; }

        require(reverted, "an ungrantable mint must propagate as a revert, not be swallowed");
        require(usdstT.balanceOf(address(b)) == before, "borrower's own float must be untouched");
        require(usdstT.totalSupply() == supplyBefore, "supply unchanged");
        require(fm.loansServed() == 0, "no loan recorded");
    }

    /// Same shape, but only the BURN grant is missing. The mint has already happened when the
    /// burn fails, so a swallowed burn would leave freshly minted, unbacked USDST behind.
    function it_m2_failed_burn_does_not_leak_unbacked_supply() public {
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        require(admin.whitelist(USDST, "mint", address(fm)), "mint granted");
        require(!admin.whitelist(USDST, "burn", address(fm)), "burn NOT granted");

        Borrower b = new Borrower();
        b.init(address(fm), USDST);
        uint supplyBefore = usdstT.totalSupply();
        bool reverted = false;
        try { b.go(250000e18); } catch { reverted = true; }

        require(reverted, "a failed burn must propagate as a revert");
        require(usdstT.totalSupply() == supplyBefore, "NO unbacked USDST may survive the tx");
        require(usdstT.balanceOf(address(b)) == 0, "borrower keeps nothing");
        require(fm.loansServed() == 0, "no loan recorded");
    }
}
