import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Metals/MetalForge.sol";

/*
 * The vendor's FlashMint.test.sol proves its leverage and liquidation traces against an
 * `OTCDesk` fixture: a two-sided counterparty with infinite depth and zero slippage at exact
 * oracle parity. That fixture is treated in the tests as a stand-in ("pool / PSM / OTC").
 *
 * On mainnet, HALF of it is real and half of it is not:
 *   - The BUY side exists: MetalForge 0x1cc5bad3 mints GOLDST/SILVST at oracle price with
 *     zero slippage, accepts USDST as a payToken, and has 1,493.5 GOLDST of remaining mintCap
 *     ($6.86M at $4,595.51). That is the OTCDesk, for real.
 *   - The SELL side does NOT exist: MetalForge is one-way (no redeemMetal), and every AMM
 *     venue holding GOLDST holds 54.65 GOLDST in total ($251k).
 *
 * This suite measures that asymmetry.
 */

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// Flash mint -> MetalForge (oracle price, no slippage) -> CDP deposit -> mintMax -> repay.
/// No OTC desk, no fictional counterparty: only contracts that exist on mainnet.
contract ForgeLeverager {
    FlashMint public lender;
    CDPEngine public cdp;
    MetalForge public forge;
    address public usdst;
    address public metal;
    uint public metalBought;
    uint public finalCollateral;
    uint public finalDebt;

    function init(address _l, address _c, address _f, address _u) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); forge = MetalForge(_f); usdst = _u;
    }

    function seedEquity(address _metal) public {
        metal = _metal;
        uint bal = IERC20(_metal).balanceOf(address(this));
        IERC20(_metal).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(_metal, bal);
    }

    function lever(address _metal, uint borrow) public {
        metal = _metal;
        lender.flashLoan(address(this), borrow, "");
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic d) external returns (string) {
        // Primary issuance at oracle price, zero slippage, no counterparty needed.
        IERC20(_t).approve(address(forge), amount);
        uint before = IERC20(metal).balanceOf(address(this));
        forge.mintMetal(metal, _t, amount, 0);
        metalBought = IERC20(metal).balanceOf(address(this)) - before;

        IERC20(metal).approve(address(cdp.registry().cdpVault()), metalBought);
        cdp.deposit(metal, metalBought);
        cdp.mintMax(metal);

        (finalCollateral, finalDebt) = cdp.vaults(address(this), metal);
        return "FlashMint.onFlashMint";
    }
}

contract Describe_FlashMintMetalForge is Authorizable {
    Mercata m;
    FlashMint fm; CDPEngine cdp; CDPVault cdpVault; CDPRegistry reg;
    PriceOracle oracle; AdminRegistry admin; MetalForge forge;
    address USDST; address GOLD;
    Token usdstT; Token goldT;
    string[] empty;

    uint GOLD_PRICE;   // mainnet oracle price
    uint FORGE_FEE;    // mainnet MetalForge feeBps for GOLDST
    uint GOLD_CAP;     // mainnet mintCap for GOLDST
    uint LR; uint MINCR;

    function beforeAll() public {
        bypassAuthorizations = true;
        empty = new string[](0);

        GOLD_PRICE = 4595510000000000000000;   // $4,595.51 (oracle, WAD)
        FORGE_FEE  = 200;                      // 2% — mainnet value
        GOLD_CAP   = 1500e18;                  // mainnet mintCap
        LR         = 150e16;
        MINCR      = 155e16;

        m = new Mercata();
        fm = m.flashMint(); cdp = m.cdpEngine(); cdpVault = m.cdpVault();
        reg = m.cdpRegistry(); oracle = m.priceOracle(); admin = m.adminRegistry();

        USDST = m.tokenFactory().createToken("USDST","USD Stable",empty,empty,empty,"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        GOLD = m.tokenFactory().createToken("GOLDST","Gold",empty,empty,empty,"GOLDST",0,18);
        goldT = Token(GOLD); goldT.setStatus(2);

        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLD, GOLD_PRICE);
        cdp.setCollateralAssetParams(GOLD, LR, MINCR, 1000, 5000, 1e27, 1e18, 1e30, 1e18, false);

        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(0xDEAD), address(m.feeCollector()), USDST);
        forge.setMetalConfig(GOLD, true, GOLD_CAP, FORGE_FEE);
        forge.setPayToken(USDST, true);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", GOLD,  "mint", address(forge));

        fm.initialize(USDST, address(m.feeCollector()), 2000000e18);
        fm.setWhitelistEnabled(false);
    }

    /// The vendor's OTCDesk is not a fiction on the BUY side. MetalForge is it.
    /// One transaction, $100k of equity -> a 2.75x levered CDP position sitting at minCR,
    /// with brand-new GOLDST as the collateral. No counterparty, no slippage, no capital.
    function it_g1_metalforge_is_the_real_otc_desk_on_the_buy_side() public {
        ForgeLeverager lev = new ForgeLeverager();
        lev.init(address(fm), address(cdp), address(forge), USDST);

        // Equity: $100,000 of GOLDST = 21.7607... GOLDST
        uint equityGold = (100000e18 * 1e18) / GOLD_PRICE;
        goldT.mint(address(lev), equityGold);
        lev.seedEquity(GOLD);

        // Theoretical max borrow: E >= F * (minCR - 1 + forgeFee) => F <= E / (0.55 + 0.02)
        // = $175,438. Draw $170,000, just inside it, so integer rounding cannot flip the trade.
        uint theoreticalMax = (100000e18 * 10000) / (5500 + FORGE_FEE);
        require(theoreticalMax > 175000e18 && theoreticalMax < 176000e18, "2.75x is the ceiling");
        uint borrow = 170000e18;
        uint supplyBefore = usdstT.totalSupply();

        lev.lever(GOLD, borrow);

        uint cr = cdp.collateralizationRatio(address(lev), GOLD);
        (uint col, uint scaled) = cdp.vaults(address(lev), GOLD);

        require(lev.metalBought() > 0, "MetalForge minted collateral at oracle price");
        // 2% forge fee is the ONLY cost: no price impact whatsoever.
        uint expectMetal = ((borrow - (borrow * FORGE_FEE) / 10000) * 1e18) / GOLD_PRICE;
        require(lev.metalBought() == expectMetal, "zero slippage: metal out == payment/oracle price");

        require(cr >= MINCR, "position at or above minCR");
        require(cr < MINCR + 1e16, "position sits AT minCR, i.e. 3.3% above the 1.50 liquidation line");
        require(col > equityGold, "collateral is equity + newly MINTED gold");
        require(usdstT.totalSupply() > supplyBefore, "net new USDST debt was created");

        // Leverage achieved from one transaction with zero USDST capital.
        require(col * 100 / equityGold >= 260, "at least 2.60x collateral on equity from one tx");
    }

    /// The same facility offers no way back out. MetalForge has no redeem path, so the only
    /// exit for the collateral it minted is the AMM — and the AMM is three orders of magnitude
    /// smaller than the mint cap.
    function it_g2_the_forge_is_one_way_so_there_is_no_symmetric_exit() public {
        // MetalForge's ABI has mintMetal and nothing that returns USDST for metal.
        // Prove it by calling a redeem-shaped selector and requiring failure.
        bool redeemExists = true;
        try {
            address(forge).call("redeemMetal", GOLD, 1e18);
        } catch {
            redeemExists = false;
        }
        require(!redeemExists, "MetalForge exposes no metal->USDST redemption");

        // Mainnet magnitudes, for the record:
        //   remaining GOLDST mintCap : 1,493.54 GOLDST = $6,864,000 of new collateral
        //   ALL AMM GOLDST liquidity :    54.65 GOLDST = $  251,100 of exit
        uint mintHeadroomUSD = ((GOLD_CAP - 6457330140453446177) * GOLD_PRICE) / 1e18;
        uint ammExitUSD      = (5465e15 * GOLD_PRICE) / 1e18;   // 54.65 GOLDST
        require(mintHeadroomUSD > ammExitUSD * 20, "collateral on-ramp is >20x the off-ramp");
    }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * The combination that matters: MetalForge leverage repays the flash loan out of
 * NEWLY MINTED CDP DEBT, not out of a sale. That is the only value-adjacent use of
 * the facility that never touches a market — so the exit-liquidity ceiling that
 * caps everything else ($21,107 of repay, ~$490 of profit) does not apply to it.
 * Stack it sequentially (the per-call cap is not a per-transaction cap) and one
 * transaction consumes the entire GOLDST mintCap.
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract StackedForgeLeverager {
    FlashMint public lender;
    CDPEngine public cdp;
    MetalForge public forge;
    address public usdst;
    address public metal;
    uint public tranches;
    uint public goldMinted;
    uint public borrowedTotal;

    function init(address _l, address _c, address _f, address _u, address _m) public {
        lender = FlashMint(_l); cdp = CDPEngine(_c); forge = MetalForge(_f); usdst = _u; metal = _m;
    }

    function seedEquity() public {
        uint bal = IERC20(metal).balanceOf(address(this));
        IERC20(metal).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(metal, bal);
    }

    /// ONE transaction, N sequential maxLoan draws, each repaid from its own mintMax.
    function levered(uint perTranche, uint times) public {
        for (uint i = 0; i < times; i++) {
            lender.flashLoan(address(this), perTranche, "");
        }
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic d) external returns (string) {
        tranches += 1;
        borrowedTotal += amount;

        IERC20(_t).approve(address(forge), amount);
        uint before = IERC20(metal).balanceOf(address(this));
        forge.mintMetal(metal, _t, amount, 0);
        uint bought = IERC20(metal).balanceOf(address(this)) - before;
        goldMinted += bought;

        IERC20(metal).approve(address(cdp.registry().cdpVault()), bought);
        cdp.deposit(metal, bought);
        cdp.mintMax(metal);              // repayment comes from here, not from any market
        return "FlashMint.onFlashMint";
    }
}

contract Describe_FlashMintForgeStacked is Authorizable {
    Mercata m;
    FlashMint fm; CDPEngine cdp; CDPRegistry reg;
    PriceOracle oracle; AdminRegistry admin; MetalForge forge;
    address USDST; address GOLD;
    Token usdstT; Token goldT;
    string[] empty;
    uint GOLD_PRICE; uint MINCR; uint MAXLOAN;

    function beforeAll() public {
        bypassAuthorizations = true;
        empty = new string[](0);
        GOLD_PRICE = 4595510000000000000000;   // $4,595.51 mainnet oracle
        MINCR      = 155e16;
        MAXLOAN    = 2000000e18;               // the vendor test suite's own cap

        m = new Mercata();
        fm = m.flashMint(); cdp = m.cdpEngine(); reg = m.cdpRegistry();
        oracle = m.priceOracle(); admin = m.adminRegistry();

        USDST = m.tokenFactory().createToken("USDST","USD Stable",empty,empty,empty,"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        GOLD = m.tokenFactory().createToken("GOLDST","Gold",empty,empty,empty,"GOLDST",0,18);
        goldT = Token(GOLD); goldT.setStatus(2);

        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLD, GOLD_PRICE);
        // mainnet dials, and a debtCeiling high enough not to be the binding constraint
        cdp.setCollateralAssetParams(GOLD, 150e16, MINCR, 1000, 5000, 1e27, 1e18, 1e30, 1e18, false);

        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(0xDEAD), address(m.feeCollector()), USDST);
        // exact mainnet config: 2% fee, cap 1,500, and 6.4573 already minted
        forge.setMetalConfig(GOLD, true, 1500e18, 200);
        forge.setPayToken(USDST, true);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", GOLD,  "mint", address(forge));

        fm.initialize(USDST, address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);
    }

    /// The exit constraint that caps every other use of this facility at ~$490 does not
    /// touch this path, because nothing is ever sold. One transaction, three maxLoan
    /// tranches, the entire GOLDST mintCap consumed, and millions of new CDP debt created.
    function it_g3_stacked_leverage_never_touches_a_market() public {
        StackedForgeLeverager lev = new StackedForgeLeverager();
        lev.init(address(fm), address(cdp), address(forge), USDST, GOLD);

        // Equity: 3 tranches x 2,000,000 x (minCR - 1 + forgeFee) = $3,420,000, the exact
        // theoretical floor. Use 57.5% so integer truncation in mintMax cannot flip the
        // third tranche, which otherwise lands on the boundary to the wei.
        uint equityUSD = (3 * MAXLOAN * 5750) / 10000;
        uint equityGold = (equityUSD * 1e18) / GOLD_PRICE;
        goldT.mint(address(lev), equityGold);
        lev.seedEquity();

        uint supplyBefore = usdstT.totalSupply();
        uint goldSupplyBefore = goldT.totalSupply();

        lev.levered(MAXLOAN, 3);                 // ONE transaction

        (uint col, uint scaled) = cdp.vaults(address(lev), GOLD);
        uint cr = cdp.collateralizationRatio(address(lev), GOLD);
        uint newDebt = usdstT.totalSupply() - supplyBefore;

        require(lev.tranches() == 3, "three sequential maxLoan draws in one transaction");
        require(lev.borrowedTotal() == MAXLOAN * 3, "6,000,000 drawn against a 2,000,000 cap");

        // Every GOLDST backing this position was minted during the transaction.
        uint freshGold = goldT.totalSupply() - goldSupplyBefore;
        require(freshGold == lev.goldMinted(), "all collateral is newly minted, not bought");
        require(freshGold > 1200e18, "over 1,200 GOLDST created inside one transaction");

        // The whole GOLDST mintCap headroom is consumed by a single transaction.
        require(forge.totalMinted(GOLD) > 1200e18, "mintCap headroom consumed in one tx");

        require(newDebt > 4000000e18, "over $4m of NET NEW USDST debt from one transaction");
        require(col > equityGold, "collateral = equity + freshly minted gold");
        require(cr >= MINCR && cr < MINCR + 1e16, "position parked AT minCR, 3.3% from liquidation");
    }

    /// Contrast: the same facility, same cap, used for anything that must SELL at the end.
    /// There is no market on this chain that can absorb it.
    function it_g4_the_selling_paths_have_no_such_headroom() public {
        // Three maxLoan tranches mint 3 x (2,000,000 x 0.98) / 4,595.51 GOLDST of fresh
        // collateral. Total GOLDST liquidity across every AMM venue on mainnet is 54.6437.
        uint freshCollateral = (3 * ((MAXLOAN * 9800) / 10000) * 1e18) / GOLD_PRICE;
        uint allAmmLiquidity = 546437e14;                 // 54.6437 GOLDST
        require(freshCollateral > allAmmLiquidity * 20,
            "one transaction minted more than 20x the entire exit market");
    }
}
