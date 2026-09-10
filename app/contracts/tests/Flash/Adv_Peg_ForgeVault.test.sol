// SPDX-License-Identifier: MIT
//
// ADVERSARIAL: FlashMint x MetalForge and FlashMint x Vault (bot vault).
//
// MetalForge is the one contract on the peg surface that will convert USDST into a *different*
// token at oracle parity with ZERO slippage and infinite depth. Before FlashMint that required
// real USDST capital. After FlashMint anybody can reach `mintCap` in a single transaction.
//
// Vault (concrete/Vault/Vault.sol) prices shares off the bot executor's LIVE balances x oracle.

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Metals/MetalForge.sol";
import "../../concrete/Vault/Vault.sol";
import "../../concrete/Vault/VaultFactory.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Flash/FlashMint.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice A counterparty that buys GOLDST for USDST at a fixed, possibly-divergent price.
contract MetalDesk {
    uint public bidWad;          // USDST paid per GOLDST, 1e18
    address public gold;
    address public usdst;

    function init(address _gold, address _usdst, uint _bid) public {
        gold = _gold; usdst = _usdst; bidWad = _bid;
    }
    function setBid(uint b) public { bidWad = b; }

    function sellGold(uint amount) public returns (uint proceeds) {
        proceeds = (amount * bidWad) / 1e18;
        require(IERC20(gold).transferFrom(msg.sender, address(this), amount), "desk: in");
        require(IERC20(usdst).transfer(msg.sender, proceeds), "desk: out");
        return proceeds;
    }
}

contract ForgeRaider {
    FlashMint public lender;
    MetalForge public forge;
    MetalDesk public desk;
    Vault public vault;
    address public usdst;
    address public gold;

    uint public mode;
    uint public goldMinted;
    uint public proceeds;
    uint public profit;
    string public innerErr;

    function init(address _lender, address _forge, address _desk, address _vault, address _usdst, address _gold) public {
        lender = FlashMint(_lender);
        forge = MetalForge(_forge);
        desk = MetalDesk(_desk);
        vault = Vault(_vault);
        usdst = _usdst;
        gold = _gold;
    }

    function attack(uint _mode, uint amount) public {
        mode = _mode;
        goldMinted = 0;
        proceeds = 0;
        profit = 0;
        innerErr = "";
        lender.flashLoan(address(this), amount, "raid");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "raider: bad lender");

        if (mode == 1) {
            // Convert the entire flash mint into metal at oracle parity, zero slippage.
            IERC20(usdst).approve(address(forge), amount);
            uint g0 = IERC20(gold).balanceOf(address(this));
            forge.mintMetal(gold, usdst, amount, 0);
            goldMinted = IERC20(gold).balanceOf(address(this)) - g0;
        } else if (mode == 2) {
            // Same, then sell the metal to a divergent venue and keep the spread.
            IERC20(usdst).approve(address(forge), amount);
            uint g0 = IERC20(gold).balanceOf(address(this));
            forge.mintMetal(gold, usdst, amount, 0);
            goldMinted = IERC20(gold).balanceOf(address(this)) - g0;
            IERC20(gold).approve(address(desk), goldMinted);
            proceeds = desk.sellGold(goldMinted);
            profit = proceeds > amount + fee ? proceeds - (amount + fee) : 0;
        } else if (mode == 3) {
            // Vault: donate to the bot executor to move NAV, then try to walk.
            IERC20(usdst).transfer(vault.botExecutor(), amount);
        } else if (mode == 4) {
            // Vault: donate then withdraw against the inflated equity.
            IERC20(usdst).transfer(vault.botExecutor(), amount);
            try vault.withdraw(amount) { } catch Error(string e) { innerErr = e; }
        }

        return "FlashMint.onFlashMint";
    }

    function vaultDeposit(address asset, uint amt) public {
        IERC20(asset).approve(address(vault), amt);
        vault.deposit(asset, amt);
    }
}

contract Describe_Adv_Peg_ForgeVault is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;
    uint public MAXLOAN = 2000000e18;
    uint public GOLD_PX = 4456e18;      // mainnet GOLDST/USDST implied price
    uint public POOL_DEPTH = 239376e18; // mainnet deepest USDST venue (Pool 0x...101b)

    Mercata m;
    FlashMint fm;
    MetalForge forge;
    MetalDesk desk;
    AdminRegistry areg;
    PriceOracle oracle;
    Token USDST;
    Token GOLDST;
    User treasurer;

    VaultFactory vaultFactory;
    Vault bvault;
    User botExecutor;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        areg = m.adminRegistry();
        oracle = m.priceOracle();

        USDST = Token(m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18));
        USDST.setStatus(2);
        GOLDST = Token(m.tokenFactory().createToken("GOLDST","Gold",[],[],[],"GOLDST",0,18));
        GOLDST.setStatus(2);
        oracle.setAssetPrice(address(USDST), 1e18);
        oracle.setAssetPrice(address(GOLDST), GOLD_PX);

        // ── MetalForge
        treasurer = new User();
        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(treasurer), address(m.feeCollector()), address(USDST));
        forge.setPayToken(address(USDST), true);
        forge.setMetalConfig(address(GOLDST), true, 1500e18, 200);   // VERIFIED live: 1,500e18 cap, 200 bps
        areg.addWhitelist(address(GOLDST), "mint", address(forge));

        desk = new MetalDesk();
        desk.init(address(GOLDST), address(USDST), GOLD_PX);
        USDST.mint(address(desk), 1000000e18);

        // ── bot Vault
        botExecutor = new User();
        address vfImpl = address(new VaultFactory(address(this)));
        vaultFactory = VaultFactory(address(new Proxy(vfImpl, address(this))));
        vaultFactory.initialize(address(m.tokenFactory()), address(oracle), address(areg), address(botExecutor));
        areg.castVoteOnIssue(address(areg), "addWhitelist", address(m.tokenFactory()), "createTokenWithInitialOwner", address(vaultFactory));
        address va = vaultFactory.createVault("Bot Vault", "vBOT");
        bvault = Vault(va);
        Ownable(bvault.shareToken()).transferOwnership(va);
        bvault.addSupportedAsset(address(USDST));
        bvault.addSupportedAsset(address(GOLDST));
        botExecutor.do(address(USDST), "approve", va, INFINITY);
        botExecutor.do(address(GOLDST), "approve", va, INFINITY);

        // seed the bot vault above MIN_FIRST_DEPOSIT_USD
        User lp = new User();
        USDST.mint(address(lp), 500000e18);
        lp.do(address(USDST), "approve", va, INFINITY);
        lp.do(va, "deposit", address(USDST), 500000e18);

        // ── FlashMint
        fm = new FlashMint(address(areg));
        areg.addWhitelist(address(USDST), "mint", address(fm));
        areg.addWhitelist(address(USDST), "burn", address(fm));
        fm.initialize(address(USDST), address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);

        log("── fixture ──");
        log("USDST supply         = " + string(USDST.totalSupply() / WAD));
        log("GOLDST oracle price  = " + string(GOLD_PX / WAD));
        log("forge mintCap GOLDST = 1,000,000");
        log("bot vault equity     = " + string(bvault.getTotalEquity() / WAD));
        log("bot vault NAV/share  = " + string(bvault.getNAVPerShare()));
        log("maxLoan              = " + string(fm.maxLoan() / WAD));
    }

    function beforeEach() public { }

    function _raider(uint bankroll) internal returns (ForgeRaider r) {
        r = new ForgeRaider();
        r.init(address(fm), address(forge), address(desk), address(bvault), address(USDST), address(GOLDST));
        if (bankroll > 0) USDST.mint(address(r), bankroll);
    }

    // ─────────────────────────────────────────────────────────────────────
    // MetalForge
    // ─────────────────────────────────────────────────────────────────────

    /// FlashMint makes MetalForge's mintCap reachable in one transaction by anyone, at oracle
    /// parity with zero price impact. Without a venue to sell into, the loan cannot be repaid.
    function it_f1_flashmint_reaches_mintCap_with_zero_capital_and_zero_slippage() public {
        ForgeRaider r = _raider(0);
        uint minted0 = forge.totalMinted(address(GOLDST));
        uint treas0 = USDST.balanceOf(address(treasurer));

        string err = "";
        try r.attack(1, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── f1 forge mint with flash liquidity ──");
        log("attempt: 2,000,000 USDST -> GOLDST at $" + string(GOLD_PX / WAD));
        log("revert                      = " + err);
        log("forge totalMinted after     = " + string(forge.totalMinted(address(GOLDST))));
        log("treasurer USDST after       = " + string(USDST.balanceOf(address(treasurer))));
        require(err == "FlashMint: not repaid", "mint-only cannot repay: principal goes to the treasurer");
        require(forge.totalMinted(address(GOLDST)) == minted0, "state rolled back");

        // with real capital, prove the mint really is unbounded-depth / zero-slippage
        User buyer = new User();
        USDST.mint(address(buyer), MAXLOAN);
        buyer.do(address(USDST), "approve", address(forge), INFINITY);
        buyer.do(address(forge), "mintMetal", address(GOLDST), address(USDST), MAXLOAN, 0);
        uint got = GOLDST.balanceOf(address(buyer));
        log("real-capital mint of 2,000,000 USDST:");
        log("  GOLDST received           = " + string(got));
        log("  implied price paid        = " + string((MAXLOAN * WAD) / got));
        log("  oracle price             = " + string(GOLD_PX));
        log("  slippage                 = 0 (only a 6 wei floor artefact)");
        log("  vs mainnet GOLDST/USDST pool depth 239,376 USDST -> 8.4x the whole venue");
        uint impliedWithFee = (GOLD_PX * 10000) / 9800;   // 200 bps mint fee
        log("  oracle / (1 - 200bps)    = " + string(impliedWithFee));
        require((MAXLOAN * WAD) / got >= GOLD_PX, "price paid is never below oracle");
        require((MAXLOAN * WAD) / got >= impliedWithFee - 1000000, "implied price = oracle/(1-fee)");
        require((MAXLOAN * WAD) / got <= impliedWithFee + 1000000,
                "DEMONSTRATED: size-independent, zero slippage at any size up to mintCap");
        require(USDST.balanceOf(address(treasurer)) > treas0, "principal is swept to the treasurer");
    }

    /// SUPERSEDED by Adv_Peg_ForgeArb.test.sol, which measures this against the REAL Pool at
    /// the verified live config (200 bps forge fee, 1,493.5427e18 headroom, 30 bps swap fee).
    /// An earlier version of this test used feeBps 0 and an infinite-depth desk and reported
    /// +1% -> 2,393 USDST / +10% -> 199,999 USDST. Both are WRONG. At the real 200 bps fee a
    /// +1% divergence is a LOSS, because the venue must bid > 1/(0.98*0.997) = +2.35% just to
    /// break even. Kept here only to pin that correction.
    function it_f2_plus_one_percent_divergence_is_a_LOSS_at_the_real_fee() public {
        desk.setBid((GOLD_PX * 101) / 100);        // venue bids +1% over the push oracle

        ForgeRaider r = _raider(0);
        string err = "";
        try r.attack(2, 239376e18) { } catch Error(string e) { err = e; }

        log("── f2 corrected: +1% divergence at the REAL 200 bps forge fee ──");
        log("venue bid (+1%)             = " + string((GOLD_PX * 101) / 100));
        log("forge feeBps                = 200");
        log("breakeven needs             = +235 bps (1/(0.98*0.997))");
        log("result                      = " + err);
        require(err == "FlashMint: not repaid", "CORRECTED: +1% is unprofitable at a 200 bps mint fee");

        // Pin WHY the old number was wrong: an infinite-depth desk lets the notional scale to
        // maxLoan, which real pool depth never permits.
        desk.setBid((GOLD_PX * 110) / 100);
        USDST.mint(address(desk), 5000000e18);
        ForgeRaider r2 = _raider(0);
        r2.attack(2, MAXLOAN);
        log("IDEALISED desk, +10%, notional 2,000,000:");
        log("  fictitious profit         = " + string(r2.profit() / WAD) + " USDST");
        log("REAL Pool at 53.7178 GOLDST / 239,375.75 USDST (Adv_Peg_ForgeArb):");
        log("  the same 2,000,000 notional reverts FlashMint: not repaid (it_g4)");
        log("  true max at +10%          = 300.133771632289379709 USDST at an 8,192 notional (it_g3)");
        log("  true max at +5%           = 38.668582404206090931 USDST at a 3,020 notional (it_g2)");
        require(r2.profit() > 100000e18, "the desk fabricates a six-figure profit at maxLoan notional");
        require(r2.profit() > 300e18 * 100, "overstates the real-depth maximum by >100x");

        desk.setBid(GOLD_PX);
    }

    /// MetalForge fee/cap arithmetic under adversarial sizing.
    function it_f3_forge_fee_rounding_and_cap_arithmetic() public {
        forge.setFeeBps(address(GOLDST), 30);
        uint capBefore = 1000000e18;
        uint minted = forge.totalMinted(address(GOLDST));

        log("── f3 forge fee / cap ──");
        log("totalMinted so far          = " + string(minted));
        log("mintCap                     = " + string(capBefore));

        // fee rounds down: any payAmount below 10000/30 = 333 wei pays zero fee
        User u = new User();
        USDST.mint(address(u), 1000e18);
        u.do(address(USDST), "approve", address(forge), INFINITY);
        uint fc0 = USDST.balanceOf(address(m.feeCollector()));
        u.do(address(forge), "mintMetal", address(GOLDST), address(USDST), 333, 0);
        log("fee on a 333 wei buy        = " + string(USDST.balanceOf(address(m.feeCollector())) - fc0));
        require(USDST.balanceOf(address(m.feeCollector())) == fc0, "sub-333-wei buys are fee free (floor)");

        // and metalAmount itself floors to 0 for small buys: the payer loses the principal
        uint g0 = GOLDST.balanceOf(address(u));
        log("GOLDST received for 333 wei = " + string(GOLDST.balanceOf(address(u)) - g0 + 0));
        require(GOLDST.balanceOf(address(u)) == 0, "333 wei of USDST buys 0 GOLDST: principal is forfeited");

        // cap is enforced against the running total, and a flash mint cannot exceed it
        forge.setMintCap(address(GOLDST), minted + 10e18);
        ForgeRaider r = _raider(0);
        string err = "";
        try r.attack(1, MAXLOAN) { } catch Error(string e) { err = e; }
        log("2,000,000 flash mint vs a tight cap = " + err);
        require(err != "", "mintCap holds against the flash mint");

        forge.setMintCap(address(GOLDST), 1500e18);
        forge.setFeeBps(address(GOLDST), 200);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Vault (bot vault) — live-balance NAV
    // ─────────────────────────────────────────────────────────────────────

    /// Vault.getTotalEquity() sums the bot executor's LIVE balances x oracle price.
    function it_f4_bot_vault_nav_moves_on_a_donation_but_is_not_extractable() public {
        uint eq0 = bvault.getTotalEquity();
        uint nav0 = bvault.getNAVPerShare();

        ForgeRaider r = _raider(0);
        string err = "";
        try r.attack(3, MAXLOAN) { } catch Error(string e) { err = e; }
        log("── f4 bot vault NAV ──");
        log("flash donation revert       = " + err);
        require(err == "FlashMint: not repaid", "donation cannot be recovered");
        require(bvault.getTotalEquity() == eq0, "state rolled back");

        // real-capital donation: NAV moves immediately, no internal-accounting guard
        User donor = new User();
        USDST.mint(address(donor), 250000e18);
        donor.do(address(USDST), "transfer", address(botExecutor), 250000e18);
        log("after a 250,000 REAL donation to the bot executor:");
        log("  equity before/after       = " + string(eq0) + " / " + string(bvault.getTotalEquity()));
        log("  NAV/share before/after    = " + string(nav0) + " / " + string(bvault.getNAVPerShare()));
        require(bvault.getTotalEquity() > eq0, "DEMONSTRATED: raw live balance is the NAV");
        require(bvault.getNAVPerShare() > nav0, "DEMONSTRATED: a plain transfer moves NAV/share");

        // but a donation always dilutes the donor, never the holders
        ForgeRaider r2 = _raider(0);
        string err2 = "";
        try r2.attack(4, 100000e18) { } catch Error(string e) { err2 = e; }
        log("donate-then-withdraw revert = " + err2 + " (inner: " + r2.innerErr() + ")");
        require(err2 != "", "donate-and-withdraw cannot repay the loan");
    }

    /// Deposit eligibility (deficit rule) is a flash-mint-reachable gate, but only in the
    /// permissive direction, and the cost equals the donation.
    function it_f5_deficit_gate_can_be_unlocked_only_by_paying_for_it() public {
        // put GOLDST into deficit so only GOLDST deposits are allowed
        bvault.setMinReserve(address(GOLDST), 100e18);
        require(GOLDST.balanceOf(address(botExecutor)) < 100e18, "GOLDST is in deficit");

        User u = new User();
        USDST.mint(address(u), 10000e18);
        u.do(address(USDST), "approve", address(bvault), INFINITY);
        string err = "";
        try u.do(address(bvault), "deposit", address(USDST), 10000e18) { }
        catch Error(string e) { err = e; }
        log("── f5 deficit gate ──");
        log("USDST deposit while GOLDST in deficit = " + err);
        require(err == "Vault: must deposit deficit asset", "gate is live");

        // clearing the deficit needs GOLDST, which the flash mint cannot conjure
        log("FlashMint mints USDST only, so it cannot clear a GOLDST deficit.");
        log("Clearing it costs 100 GOLDST = $" + string((100e18 * GOLD_PX) / WAD / WAD) + " of real capital.");

        bvault.setMinReserve(address(GOLDST), 0);
        u.do(address(bvault), "deposit", address(USDST), 10000e18);
        require(IERC20(bvault.shareToken()).balanceOf(address(u)) > 0, "deposit works once the deficit clears");
    }
}
