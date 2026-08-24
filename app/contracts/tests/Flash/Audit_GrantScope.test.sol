import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

/// Stands in for "whatever code holds the grant" — FlashMint today, its next
/// implementation tomorrow. Does the grant itself constrain the holder at all?
contract GrantHolder {
    function mintTo(address token, address to, uint amt) public { Token(token).mint(to, amt); }
    function burnFrom(address token, address from, uint amt) public { Token(token).burn(from, amt); }
}

/*
 * The question is not what FlashMint.sol does with the grant. It is what the grant
 * PERMITS, because the grant outlives any particular implementation behind the proxy.
 */
contract Describe_MintBurnGrantScope is Authorizable {
    Mercata m; AdminRegistry admin; address USDST; Token usdstT;
    string[] empty;

    function beforeAll() public {
        bypassAuthorizations = true;
        empty = new string[](0);
        m = new Mercata(); admin = m.adminRegistry();
        USDST = m.tokenFactory().createToken("USDST","USD Stable",empty,empty,empty,"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
    }

    /// The grant is "mint", unqualified. No cap, no recipient restriction.
    function it_x1_mint_grant_is_unlimited_and_unrestricted() public {
        GrantHolder g = new GrantHolder();
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(g));

        address stranger = address(0xBEEF);
        uint supplyBefore = usdstT.totalSupply();

        g.mintTo(USDST, stranger, 50000000e18);      // 10x the entire mainnet float

        require(usdstT.balanceOf(stranger) == 50000000e18, "minted to an arbitrary third party");
        require(usdstT.totalSupply() == supplyBefore + 50000000e18, "no cap of any kind applies");
    }

    /// The grant is "burn", unqualified. Token.burn(from, amount) has NO allowance check,
    /// so the holder can burn a balance belonging to someone who never interacted with it.
    function it_x2_burn_grant_reaches_any_holders_balance() public {
        GrantHolder g = new GrantHolder();
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(g));

        // An innocent third party with its own money and no relationship to the grant holder.
        address victim = address(0xCAFE);
        usdstT.mint(victim, 250000e18);
        require(usdstT.allowance(victim, address(g)) == 0, "victim granted NO allowance");

        uint supplyBefore = usdstT.totalSupply();
        g.burnFrom(USDST, victim, 250000e18);        // confiscation, no consent

        require(usdstT.balanceOf(victim) == 0, "third party's balance destroyed without consent");
        require(usdstT.totalSupply() == supplyBefore - 250000e18, "supply reduced");
    }

    /// So the grant is strictly broader than FlashMint's use of it. FlashMint restricts
    /// itself to msg.sender; nothing in the grant requires that of its successor.
    function it_x3_the_grant_does_not_encode_flashmints_self_restriction() public {
        FlashMint fm = m.flashMint();
        // FlashMint's own guard is a line of its source, not a property of the grant.
        try {
            fm.flashLoan(address(0xD00D), 1e18, "");
            require(false, "FlashMint restricts itself");
        } catch { }
        // The proxy that carries the grant is owned by AdminRegistry: a 2-of-3 quorum can
        // replace the logic behind it while the grant stays attached to the same address.
        require(Ownable(address(fm)).owner() == address(admin),
            "the grant sits behind a proxy governance can re-point");
    }
}
