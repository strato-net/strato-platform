import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

/*
 * The vendor suite's it_bd_cap_cannot_be_stacked_by_nesting only proves that a NESTED
 * re-entry is blocked by the `locked` flag. The flag is released at the end of each call,
 * so SEQUENTIAL loans inside one transaction are not blocked at all. This measures how much
 * cumulative flash-minted work one atomic transaction can actually perform.
 */

/// Draws the cap N times back-to-back inside a single transaction.
contract SequentialBorrower {
    FlashMint public lender;
    address public token;
    uint public loops;
    uint public cumulativeBorrowed;
    uint public peakBalance;

    function init(address _l, address _t) public { lender = FlashMint(_l); token = _t; }

    /// ONE transaction, N separate loans, each repaid before the next begins.
    function drawRepeatedly(uint amount, uint times) public {
        for (uint i = 0; i < times; i++) {
            lender.flashLoan(address(this), amount, "");
        }
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic d) external returns (string) {
        loops += 1;
        cumulativeBorrowed += amount;
        uint bal = IERC20(_t).balanceOf(address(this));
        if (bal > peakBalance) peakBalance = bal;
        return "FlashMint.onFlashMint";
    }
}

contract Describe_FlashMintCapStacking is Authorizable {
    Mercata m; FlashMint fm; AdminRegistry admin; address USDST; Token usdstT;
    uint CAP;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata(); fm = m.flashMint(); admin = m.adminRegistry();
        USDST = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        CAP = 2000000e18;                        // the vendor test's own cap: 40% of mainnet USDST
        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);
    }

    /// One transaction draws 10 x maxLoan = 20,000,000 USDST of cumulative flash-minted
    /// liquidity — 4x the entire mainnet USDST supply — while never breaching the per-tx cap.
    function it_s1_sequential_loans_stack_without_limit() public {
        SequentialBorrower b = new SequentialBorrower();
        b.init(address(fm), USDST);

        uint supplyBefore = usdstT.totalSupply();
        uint servedBefore = fm.loansServed();

        b.drawRepeatedly(CAP, 10);               // ONE transaction

        require(b.loops() == 10, "all 10 loans executed in one transaction");
        require(b.cumulativeBorrowed() == CAP * 10, "cumulative draw is 10x the cap");
        require(b.peakBalance() == CAP, "instantaneous exposure never exceeded the cap");
        require(fm.loansServed() == servedBefore + 10, "10 loans counted");
        require(usdstT.totalSupply() == supplyBefore, "still supply-neutral");
        // largestLoan telemetry cannot distinguish 1 loan from 10 in the same tx
        require(fm.largestLoan() == CAP, "largestLoan only records the per-loan peak");
    }

    /// Nesting really is blocked — so the guard the vendor tests is the only one that exists,
    /// and it is not the one that bounds cumulative atomic work.
    function it_s2_nesting_is_the_only_thing_blocked() public {
        SequentialBorrower b = new SequentialBorrower();
        b.init(address(fm), USDST);
        b.drawRepeatedly(1e18, 3);
        require(b.loops() == 3, "sequential is allowed");
    }

    /// A fee does not bound stacking either: it is charged per loan, so N loans cost N x fee,
    /// but the borrower only needs the fee, never the principal.
    function it_s3_fee_does_not_bound_stacking() public {
        fm.setFeeBps(100);                       // 1%
        SequentialBorrower b = new SequentialBorrower();
        b.init(address(fm), USDST);
        uint smallLoan = 10000e18;
        uint feePerLoan = smallLoan / 100;
        usdstT.mint(address(b), feePerLoan * 5); // only 500 USDST of float
        b.drawRepeatedly(smallLoan, 5);
        require(b.cumulativeBorrowed() == smallLoan * 5, "50,000 drawn on 500 of float");
        require(usdstT.balanceOf(address(b)) == 0, "float fully consumed by fees");
        fm.setFeeBps(0);
    }
}
