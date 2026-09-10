import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// Liquidator that draws flash USDST and liquidates a CDP vault, keeping the seized collateral.
contract PauseLiquidator {
    FlashMint public lender;
    CDPEngine public cdp;
    address public usdst;
    address public collateral;
    address public victim;
    uint public seized;

    function init(address _l, address _c, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); usdst = _u;
    }

    /// Draws a flash loan and liquidates. Used to prove token-pause / FlashMint-pause both
    /// stop the loan before any CDP work happens.
    function run(address _coll, address _victim, uint repay) public {
        collateral = _coll; victim = _victim;
        lender.flashLoan(address(this), repay, "");
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        uint before = IERC20(collateral).balanceOf(address(this));
        cdp.liquidate(collateral, victim, amount);           // burns USDST from this contract
        seized = IERC20(collateral).balanceOf(address(this)) - before;
        return "FlashMint.onFlashMint";
    }
}

/// Does the USDST emergency pause actually stop the flash-mint facility and its downstream effects?
contract Describe_FlashMintPauseGap is Authorizable {

    Mercata m;
    FlashMint fm;
    CDPEngine cdp;
    CDPVault cdpVault;
    CDPRegistry reg;
    PriceOracle oracle;
    AdminRegistry admin;
    address USDST; address COLL;
    Token usdstT; Token collT;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        fm = new FlashMint(address(m.adminRegistry())); cdp = m.cdpEngine(); cdpVault = m.cdpVault();
        reg = m.cdpRegistry(); oracle = m.priceOracle(); admin = m.adminRegistry();

        USDST = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        COLL = m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18);
        collT = Token(COLL); collT.setStatus(2);
        oracle.setAssetPrice(COLL, 4595e18);
        // mainnet params: LR 1.50, minCR 1.55, penalty 10%, closeFactor 50%
        cdp.setCollateralAssetParams(COLL, 150e16, 155e16, 1000, 5000, 1e27, 1e18, 1e30, 1e18, false);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);
    }

    /// Pausing USDST must close the facility: views advertise 0 and flashLoan reverts.
    /// FlashMint.paused is independent — the token pause is its own brake.
    function it_p1_pausing_usdst_stops_flashmint_and_liquidation() public {
        // Victim opens a vault: 100 GOLDST @ $4595 = $459,500 collateral, $250,000 debt (CR 1.838)
        User victim = new User();
        collT.mint(address(victim), 100e18);
        victim.callFunction(COLL, "approve", address(cdpVault), 100e18);
        victim.callFunction(address(cdp), "deposit", COLL, 100e18);
        victim.callFunction(address(cdp), "mint", COLL, 250000e18);

        // Gold falls 25% to $3,446 -> collateral $344,600 vs $250,000 debt -> CR 1.378 < 1.50
        oracle.setAssetPrice(COLL, 3446e18);
        require(cdp.collateralizationRatio(address(victim), COLL) < 150e16, "victim must be liquidatable");

        PauseLiquidator liq = new PauseLiquidator();
        liq.init(address(fm), address(cdp), USDST);

        // === EMERGENCY: governance pauses USDST ===
        usdstT.pause();
        require(usdstT.paused(), "USDST paused");
        require(!fm.paused(), "FlashMint.paused is not auto-tripped by the token pause");
        require(fm.maxFlashLoan() == 0, "token pause advertises 0 capacity");
        require(!fm.canBorrow(address(liq)), "token pause closes canBorrow");

        uint repay = 125000e18;                       // 50% close factor
        usdstT.mint(address(liq), repay);
        uint supplyBefore = usdstT.totalSupply();
        uint collBefore = collT.balanceOf(address(liq));
        uint servedBefore = fm.loansServed();

        try {
            liq.run(COLL, address(victim), repay);
            require(false, "flash mint must revert while USDST is paused");
        } catch { }

        require(liq.seized() == 0, "no collateral seized while USDST was paused");
        require(collT.balanceOf(address(liq)) == collBefore, "liquidator got nothing");
        require(usdstT.totalSupply() == supplyBefore, "no debt burned");
        require(fm.loansServed() == servedBefore, "no flash loan served");

        usdstT.unpause();
        oracle.setAssetPrice(COLL, 4595e18);
    }

    /// FlashMint's own switch also stops it. Token pause is a separate brake (see it_p1).
    function it_p2_flashmint_own_pause_does_stop_it() public {
        fm.setPaused(true);
        PauseLiquidator liq = new PauseLiquidator();
        liq.init(address(fm), address(cdp), USDST);
        try {
            liq.run(COLL, address(this), 1e18);
            require(false, "FlashMint.paused must stop the facility");
        } catch { }
        require(fm.maxFlashLoan() == 0, "paused facility advertises 0");
        fm.setPaused(false);
    }
}
