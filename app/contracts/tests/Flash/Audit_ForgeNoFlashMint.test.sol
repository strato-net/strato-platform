import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Metals/MetalForge.sol";

/*
 * CONTROL for F1. Does FlashMint actually ENABLE the MetalForge leverage, or does it
 * only compress it into one transaction? MetalForge has zero slippage, so the same
 * position should be reachable by plain iteration with no flash mint at all.
 * If it is, F1's leverage claim is not a FlashMint finding.
 */
contract Iterator {
    CDPEngine public cdp;
    MetalForge public forge;
    address public usdst;
    address public metal;
    uint public rounds;

    function init(address _c, address _f, address _u, address _m) public {
        cdp = CDPEngine(_c); forge = MetalForge(_f); usdst = _u; metal = _m;
    }

    function seedEquity() public {
        uint bal = IERC20(metal).balanceOf(address(this));
        IERC20(metal).approve(address(cdp.registry().cdpVault()), bal);
        cdp.deposit(metal, bal);
    }

    /// No flash mint anywhere. Each round is an ordinary, separately-callable step.
    function grind(uint maxRounds) public {
        for (uint i = 0; i < maxRounds; i++) {
            uint minted = cdp.mintMax(metal);
            if (minted == 0) break;
            IERC20(usdst).approve(address(forge), minted);
            uint before = IERC20(metal).balanceOf(address(this));
            forge.mintMetal(metal, usdst, minted, 0);
            uint bought = IERC20(metal).balanceOf(address(this)) - before;
            if (bought == 0) break;
            IERC20(metal).approve(address(cdp.registry().cdpVault()), bought);
            cdp.deposit(metal, bought);
            rounds += 1;
        }
    }
}

contract Describe_ForgeLeverageWithoutFlashMint is Authorizable {
    Mercata m;
    CDPEngine cdp; CDPRegistry reg; PriceOracle oracle; AdminRegistry admin; MetalForge forge;
    address USDST; address GOLD;
    Token usdstT; Token goldT;
    string[] empty;
    uint GOLD_PRICE; uint MINCR;

    function beforeAll() public {
        bypassAuthorizations = true;
        empty = new string[](0);
        GOLD_PRICE = 4595510000000000000000;
        MINCR = 155e16;

        m = new Mercata();
        cdp = m.cdpEngine(); reg = m.cdpRegistry();
        oracle = m.priceOracle(); admin = m.adminRegistry();

        USDST = m.tokenFactory().createToken("USDST","USD Stable",empty,empty,empty,"USDST",0,18);
        usdstT = Token(USDST); usdstT.setStatus(2);
        GOLD = m.tokenFactory().createToken("GOLDST","Gold",empty,empty,empty,"GOLDST",0,18);
        goldT = Token(GOLD); goldT.setStatus(2);

        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLD, GOLD_PRICE);
        cdp.setCollateralAssetParams(GOLD, 150e16, MINCR, 1000, 5000, 1e27, 1e18, 1e30, 1e18, false);

        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(0xDEAD), address(m.feeCollector()), USDST);
        forge.setMetalConfig(GOLD, true, 100000e18, 200);   // 2% fee, cap not binding
        forge.setPayToken(USDST, true);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(cdp));
        admin.castVoteOnIssue(address(admin), "addWhitelist", GOLD,  "mint", address(forge));
    }

    /// Plain iteration, no flash mint, reaches the SAME position FlashMint reaches in one shot.
    function it_n1_iteration_reaches_the_same_leverage_without_flashmint() public {
        Iterator it = new Iterator();
        it.init(address(cdp), address(forge), USDST, GOLD);

        uint equityGold = (100000e18 * 1e18) / GOLD_PRICE;   // $100,000 of equity
        goldT.mint(address(it), equityGold);
        it.seedEquity();

        // 15 ordinary rounds. The series converges as (1 - r^(n+1))/(1 - r) with
        // r = 0.98/1.55 = 0.6323, so 15 rounds is already 99.9% of the limit.
        it.grind(15);

        (uint col, uint scaled) = cdp.vaults(address(it), GOLD);
        uint cr = cdp.collateralizationRatio(address(it), GOLD);

        require(it.rounds() > 5, "iteration ran many ordinary rounds");
        require(cr >= MINCR && cr < MINCR + 1e16, "converges to exactly minCR");

        // Closed form limit: C = E / (1 - (1-fee)/minCR) = 2.7193 x E
        require(col * 10000 / equityGold > 27100, "reached >2.71x leverage with NO flash mint");
        require(col * 10000 / equityGold < 27300, "and converges to the same 2.7193x ceiling");
    }

    /// The ceiling is a property of minCR and the forge fee, not of FlashMint.
    function it_n2_the_ceiling_is_set_by_minCR_and_the_forge_fee() public {
        // C/E = 1/(1 - (1-f)/minCR). With minCR 1.55, f 2%: 1/(1 - 0.98/1.55) = 2.7193
        uint ceilingBps = (10000 * 10000) / (10000 - (9800 * 10000) / 15500);
        require(ceilingBps > 27100 && ceilingBps < 27300, "closed-form ceiling is 2.71-2.73x");
    }
}
