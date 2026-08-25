import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Pools/DirectMintPSM.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/*
 * Risks to the LIVE DirectMintPSM as configured today. No FlashMint anywhere in this file.
 * Mainnet config reproduced: feeBps 0, minReserve 0, maxBalance 0 on both USDC and USDT;
 * PSM holds mint+burn on USDST and NOT transfer/transferFrom (verified on chain).
 */
contract Describe_PSMToday is Authorizable {
    Mercata m;
    AdminRegistry admin;
    DirectMintPSM psm;
    address USDST; address USDC; address USDT;
    Token usdstT; Token usdcT; Token usdtT;
    string[] empty;

    function beforeAll() public {
        bypassAuthorizations = true;
        empty = new string[](0);
        m = new Mercata(); admin = m.adminRegistry();

        USDST = m.tokenFactory().createToken("USDST","USD Stable",empty,empty,empty,"USDST",0,18);
        USDC  = m.tokenFactory().createToken("USDC","STRATO USDC",empty,empty,empty,"USDC",0,18);
        USDT  = m.tokenFactory().createToken("USDT","STRATO USDT",empty,empty,empty,"USDT",0,18);
        usdstT = Token(USDST); usdcT = Token(USDC); usdtT = Token(USDT);
        usdstT.setStatus(2); usdcT.setStatus(2); usdtT.setStatus(2);

        psm = new DirectMintPSM(address(this));
        psm.initialize(USDST, address(m.feeCollector()), [USDC, USDT]);   // sets fee 0 / minReserve 0

        // exactly the two grants the live PSM holds — no transfer/transferFrom
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(psm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(psm));

        // mainnet-shaped reserve: 101,347 USDC + 2,001 USDT
        usdcT.mint(address(psm), 101347e18);
        usdtT.mint(address(psm), 2001e18);
    }

    /// R1 — the pause is ASYMMETRIC across the PSM's two legs, in the wrong direction.
    /// redeem() moves USDST with transferFrom (pause-gated, PSM not whitelisted for it),
    /// but mint() creates USDST with Token.mint (NOT pause-gated). So freezing USDST
    /// stops holders getting out while the PSM keeps issuing more.
    function it_r1_pausing_usdst_stops_redemptions_but_not_issuance() public {
        User u = new User();
        usdcT.mint(address(u), 10000e18);
        usdstT.mint(address(u), 5000e18);
        u.callFunction(USDC,  "approve", address(psm), 10000e18);
        u.callFunction(USDST, "approve", address(psm), 5000e18);

        // baseline: both legs work
        u.callFunction(address(psm), "mint", 1000e18, USDC);
        u.callFunction(address(psm), "redeem", 1000e18, USDC);

        usdstT.pause();
        require(usdstT.paused(), "USDST frozen");

        // REDEEM: blocked, because it needs transferFrom on a paused token
        uint reserveBefore = usdcT.balanceOf(address(psm));
        bool redeemBlocked = false;
        try { u.callFunction(address(psm), "redeem", 1000e18, USDC); } catch { redeemBlocked = true; }
        if (!redeemBlocked) { redeemBlocked = (usdcT.balanceOf(address(psm)) == reserveBefore); }
        require(redeemBlocked, "holders cannot redeem while USDST is paused");

        // MINT: still works. Token.mint carries only onlyOwner.
        uint supplyBefore = usdstT.totalSupply();
        u.callFunction(address(psm), "mint", 1000e18, USDC);
        require(usdstT.totalSupply() == supplyBefore + 1000e18,
            "the PSM STILL ISSUES new USDST while the token is frozen");

        usdstT.unpause();
    }

    /// R2 — a redeemer picks which reserve asset to drain, regardless of what they minted with.
    /// The PSM therefore sheds its most-wanted asset and keeps the least-wanted one.
    function it_r2_redeemers_choose_the_reserve_they_drain() public {
        User u = new User();
        usdtT.mint(address(u), 2000e18);
        u.callFunction(USDT, "approve", address(psm), 2000e18);
        u.callFunction(address(psm), "mint", 2000e18, USDT);      // paid in USDT

        uint usdcBefore = usdcT.balanceOf(address(psm));
        uint usdtBefore = usdtT.balanceOf(address(psm));
        u.callFunction(USDST, "approve", address(psm), 2000e18);
        u.callFunction(address(psm), "redeem", 2000e18, USDC);    // took USDC out

        require(usdcT.balanceOf(address(psm)) == usdcBefore - 2000e18, "drained the OTHER asset");
        require(usdtT.balanceOf(address(psm)) == usdtBefore, "the asset they paid in is untouched");
    }

    /// R3 — minReserve 0 means one caller can take the reserve to exactly zero. No floor,
    /// no queue, no pro-rata: strictly first-come. 2.1% of the float is redeemable at all.
    function it_r3_a_single_caller_can_zero_the_reserve() public {
        User whale = new User();
        uint reserve = usdcT.balanceOf(address(psm));
        require(psm.availableRedemptionLiquidity(USDC) == reserve, "no minReserve floor is set");

        usdstT.mint(address(whale), reserve);
        whale.callFunction(USDST, "approve", address(psm), reserve);
        whale.callFunction(address(psm), "redeem", reserve, USDC);

        require(usdcT.balanceOf(address(psm)) == 0, "entire USDC reserve gone in one call");
        require(psm.availableRedemptionLiquidity(USDC) == 0, "nothing left for anyone else");

        // and the next holder in line simply cannot exit
        User next = new User();
        usdstT.mint(address(next), 1e18);
        next.callFunction(USDST, "approve", address(psm), 1e18);
        bool blocked = false;
        try { next.callFunction(address(psm), "redeem", 1e18, USDC); } catch { blocked = true; }
        if (!blocked) { blocked = (usdcT.balanceOf(address(next)) == 0); }
        require(blocked, "second redeemer gets nothing");

        usdcT.mint(address(psm), reserve);   // restore for any later test
    }
}
