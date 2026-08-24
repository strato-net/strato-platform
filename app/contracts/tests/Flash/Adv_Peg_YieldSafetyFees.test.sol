// SPDX-License-Identifier: MIT
//
// ADVERSARIAL: FlashMint x SafetyModule, FlashMint x YieldVault, and FlashMint fee routing.
//
// Q4: do these price shares or rewards off a live balance / totalSupply that a 2,000,000e18
//     flash mint can move inside the callback window?
// Q5: is the mint-the-fee-to-FeeCollector routing supply neutral and non-divertible?

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/YieldVault/YieldVault.sol";
import "../../concrete/Lending/SafetyModule.sol";
import "../../concrete/Pools/DirectMintPSM.sol";
import "../../concrete/Flash/FlashMint.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Scripted flash-mint borrower for the yield/safety/fee surface.
contract YsRaider {
    FlashMint public lender;
    YieldVault public yv;
    SafetyModule public sm;
    DirectMintPSM public psm;
    address public usdst;
    address public usdc;

    uint public mode;
    uint public sharesGot;
    uint public assetsBack;
    uint public paidIn;
    uint public baseBefore;
    uint public baseInside;
    uint public rateInside;
    uint public freeIdleInside;
    string public innerErr;

    function init(address _lender, address _yv, address _sm, address _psm, address _usdst, address _usdc) public {
        lender = FlashMint(_lender);
        yv = YieldVault(_yv);
        sm = SafetyModule(_sm);
        psm = DirectMintPSM(_psm);
        usdst = _usdst;
        usdc = _usdc;
    }

    function attack(uint _mode, uint amount) public {
        mode = _mode;
        sharesGot = 0;
        assetsBack = 0;
        paidIn = 0;
        innerErr = "";
        lender.flashLoan(address(this), amount, "raid");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "raider: bad lender");

        if (mode == 1) {
            // YieldVault deposit -> redeem, one transaction
            baseBefore = yv.accrualBaseAssets();
            IERC20(usdst).approve(address(yv), amount);
            paidIn = amount;
            sharesGot = yv.deposit(amount, address(this));
            baseInside = yv.accrualBaseAssets();
            rateInside = yv.exchangeRate();
            freeIdleInside = yv.freeIdleForInstantWithdrawals();
            uint b0 = IERC20(usdst).balanceOf(address(this));
            yv.redeem(sharesGot, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 2) {
            // YieldVault: donate, snapshot the live-balance NAV, then try to walk
            baseBefore = yv.accrualBaseAssets();
            IERC20(usdst).transfer(address(yv), amount);
            rateInside = yv.exchangeRate();
            baseInside = yv.accrualBaseAssets();
            freeIdleInside = yv.freeIdleForInstantWithdrawals();
        } else if (mode == 3) {
            // YieldVault: donate then force a checkpoint with a dust deposit, then try to
            // take the donation back out -- does accrualBaseAssets stay inflated?
            baseBefore = yv.accrualBaseAssets();
            IERC20(usdst).transfer(address(yv), amount - 1000e18);
            IERC20(usdst).approve(address(yv), 1000e18);
            sharesGot = yv.deposit(1000e18, address(this));
            baseInside = yv.accrualBaseAssets();
            uint b0 = IERC20(usdst).balanceOf(address(this));
            yv.redeem(sharesGot, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 4) {
            // SafetyModule: stake then try to redeem in the same transaction
            IERC20(usdst).approve(address(sm), amount);
            paidIn = amount;
            sharesGot = sm.stake(amount, 0);
            rateInside = sm.exchangeRate();
            try sm.redeem(sharesGot, 0) { } catch Error(string e) { innerErr = e; }
        } else if (mode == 5) {
            // SafetyModule: stake, start cooldown, redeem immediately
            IERC20(usdst).approve(address(sm), amount);
            sharesGot = sm.stake(amount, 0);
            sm.startCooldown();
            try sm.redeem(sharesGot, 0) { } catch Error(string e) { innerErr = e; }
        } else if (mode == 6) {
            // SafetyModule: donate and read exchangeRate from inside the callback
            rateInside = sm.exchangeRate();
            IERC20(usdst).transfer(address(sm), amount);
            baseInside = sm.totalAssets();
        } else if (mode == 7) {
            // Fee routing: repay out of own float, having done a supply-neutral PSM round trip
            uint avail = psm.availableRedemptionLiquidity(usdc);
            IERC20(usdst).approve(address(psm), avail);
            psm.redeem(avail, usdc);
            IERC20(usdc).approve(address(psm), avail);
            psm.mint(avail, usdc);
        } else if (mode == 8) {
            // Fee routing: do nothing at all, pay the fee from own float
        }

        return "FlashMint.onFlashMint";
    }

    function ysStake(uint amount) public {
        IERC20(usdst).approve(address(sm), amount);
        sharesGot = sm.stake(amount, 0);
    }

    function yvDeposit(uint amount) public {
        IERC20(usdst).approve(address(yv), amount);
        sharesGot = yv.deposit(amount, address(this));
    }

    function yvRequestRedeem(uint shares) public {
        yv.requestRedeem(shares, address(this), address(this));
    }
}

contract Describe_Adv_Peg_YieldSafetyFees is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;
    uint public MAXLOAN = 2000000e18;
    uint public MAX_RATE = 1000000021979553151239153027;

    Mercata m;
    FlashMint fm;
    YieldVault yv;
    SafetyModule sm;
    DirectMintPSM psm;
    AdminRegistry areg;
    Token USDST;
    Token sUSDST;
    Token USDC;

    User lp;
    User staker;
    User distributor;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        areg = m.adminRegistry();

        USDST = Token(m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18));
        USDST.setStatus(2);
        USDC = Token(m.tokenFactory().createToken("USDC","Strato USDC",[],[],[],"USDC",0,18));
        USDC.setStatus(2);
        sUSDST = Token(m.tokenFactory().createToken("sUSDST","Staked USDST",[],[],[],"sUSDST",0,18));
        sUSDST.setStatus(2);

        // ── SafetyModule
        sm = new SafetyModule(address(this));
        sm.initialize(address(m.lendingRegistry()), address(m.tokenFactory()));
        m.poolConfigurator().setBorrowableAsset(address(USDST));
        m.poolConfigurator().setMToken(address(sUSDST));
        sm.syncFromRegistry();
        sm.setTokens(address(sUSDST), address(USDST));
        areg.addWhitelist(address(sUSDST), "mint", address(sm));
        areg.addWhitelist(address(sUSDST), "burn", address(sm));

        staker = new User();
        USDST.mint(address(staker), 500000e18);
        staker.do(address(USDST), "approve", address(sm), INFINITY);
        staker.do(address(sm), "stake", 500000e18, 0);

        // ── YieldVault
        yv = new YieldVault(address(this));
        yv.initialize(address(USDST), "Yield USDST", "yUSDST");
        yv.initializeAccrual();
        distributor = new User();
        USDST.mint(address(distributor), 50000e18);
        distributor.do(address(USDST), "approve", address(yv), INFINITY);
        yv.setRewardDistributor(address(distributor));
        yv.setPerSecondSavingsRate(1000000001500000000000000000);

        lp = new User();
        USDST.mint(address(lp), 1000000e18);
        lp.do(address(USDST), "approve", address(yv), INFINITY);
        lp.do(address(yv), "deposit(uint256,address)", 1000000e18, address(lp));

        // ── PSM, to give a callback something supply-moving to do
        psm = new DirectMintPSM(address(this));
        areg.addWhitelist(address(USDST), "mint", address(psm));
        areg.addWhitelist(address(USDST), "burn", address(psm));
        psm.initialize(address(USDST), address(m.feeCollector()), [address(USDC)]);
        User whale = new User();
        USDC.mint(address(whale), 101347e18);
        whale.do(address(USDC), "approve", address(psm), INFINITY);
        whale.do(address(psm), "mint", 101347e18, address(USDC));

        // ── FlashMint
        fm = m.flashMint();
        areg.addWhitelist(address(USDST), "mint", address(fm));
        areg.addWhitelist(address(USDST), "burn", address(fm));
        fm.initialize(address(USDST), address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);

        log("── fixture ──");
        log("USDST totalSupply    = " + string(USDST.totalSupply() / WAD));
        log("SM managedAssets     = " + string(sm.totalAssets() / WAD) + "  shares " + string(sm.totalShares() / WAD));
        log("SM cooldown seconds  = " + string(sm.COOLDOWN_SECONDS()));
        log("YV totalAssets       = " + string(yv.totalAssets() / WAD) + "  shares " + string(yv.totalSupply() / WAD));
        log("YV accrualBaseAssets = " + string(yv.accrualBaseAssets() / WAD));
        log("PSM USDC reserve     = " + string(USDC.balanceOf(address(psm)) / WAD));
        log("maxLoan              = " + string(fm.maxLoan() / WAD));
    }

    function beforeEach() public { }

    function _raider(uint bankroll) internal returns (YsRaider r) {
        r = new YsRaider();
        r.init(address(fm), address(yv), address(sm), address(psm), address(USDST), address(USDC));
        if (bankroll > 0) USDST.mint(address(r), bankroll);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q4a  SAFETY MODULE
    // ─────────────────────────────────────────────────────────────────────

    /// The cooldown makes every atomic flash-mint round trip impossible.
    function it_y1_safetymodule_cooldown_blocks_atomic_round_trips() public {
        YsRaider r = _raider(1e18);
        uint ta0 = sm.totalAssets();
        uint ts0 = sm.totalShares();
        uint rate0 = sm.exchangeRate();

        string err = "";
        try r.attack(4, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── y1 SM stake+redeem in one tx ──");
        log("outer revert           = " + err);
        log("inner redeem revert    = " + r.innerErr());
        log("SM totalAssets after   = " + string(sm.totalAssets()));
        log("SM totalShares after   = " + string(sm.totalShares()));
        log("SM rate before/after   = " + string(rate0) + " / " + string(sm.exchangeRate()));
        require(err == "FlashMint: not repaid", "outer tx must unwind");
        require(sm.totalAssets() == ta0 && sm.totalShares() == ts0, "SM state must be intact");

        YsRaider r2 = _raider(1e18);
        string err2 = "";
        try r2.attack(5, MAXLOAN) { } catch Error(string e) { err2 = e; }
        log("with startCooldown():");
        log("  outer revert         = " + err2);
        log("  inner redeem revert  = " + r2.innerErr());
        require(err2 == "FlashMint: not repaid", "outer tx must unwind");
        require(sm.totalAssets() == ta0 && sm.totalShares() == ts0, "SM state must be intact");
    }

    /// SM prices off internal _managedAssets, so no live-balance read exists to move.
    function it_y2_safetymodule_price_is_donation_immune() public {
        uint ta0 = sm.totalAssets();
        uint rate0 = sm.exchangeRate();
        uint live0 = USDST.balanceOf(address(sm));

        // (a) flash-minted donation: unrecoverable, whole tx unwinds
        YsRaider r = _raider(0);
        string err = "";
        try r.attack(6, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── y2 SM donation ──");
        log("flash-donation revert  = " + err);
        require(err == "FlashMint: not repaid", "flash donation cannot be recovered");

        // (b) real-capital donation that survives: internal accounting must ignore it entirely
        User donor = new User();
        USDST.mint(address(donor), MAXLOAN);
        donor.do(address(USDST), "transfer", address(sm), MAXLOAN);
        log("after 2,000,000 REAL donation:");
        log("  SM live before/after = " + string(live0) + " / " + string(USDST.balanceOf(address(sm))));
        log("  SM totalAssets       = " + string(sm.totalAssets()) + " (was " + string(ta0) + ")");
        log("  SM rate              = " + string(sm.exchangeRate()) + " (was " + string(rate0) + ")");
        log("  previewStake(1e18)   = " + string(sm.previewStake(1e18)));
        require(sm.totalAssets() == ta0, "internal _managedAssets ignores strays");
        require(sm.exchangeRate() == rate0, "rate unchanged by a 2,000,000 donation");
        require(sm.previewStake(1e18) == 1e18, "stake price unmoved");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q4b  YIELD VAULT
    // ─────────────────────────────────────────────────────────────────────

    /// YieldVault.totalAssets() = LIVE idle balance + deployedAssets. Unlike SaveUSDSTVault
    /// (min(managed, live)) and SafetyModule (internal _managedAssets), there is no guard at all.
    function it_y3_yieldvault_nav_is_a_raw_live_balance() public {
        uint ta0 = yv.totalAssets();
        uint rate0 = yv.exchangeRate();
        uint base0 = yv.accrualBaseAssets();

        // (a) flash-minted donation cannot be recovered, so the whole tx unwinds
        YsRaider r = _raider(0);
        string err = "";
        try r.attack(2, MAXLOAN) { } catch Error(string e) { err = e; }
        log("── y3 YV live-balance NAV ──");
        log("flash-donation revert      = " + err);
        require(err == "FlashMint: not repaid", "flash donation cannot be recovered");
        require(yv.totalAssets() == ta0, "state rolled back");
        require(yv.accrualBaseAssets() == base0, "accrual base rolled back");

        // (b) a donation that survives moves the price INSTANTLY, with no min()/internal guard.
        //     Same donation into SaveUSDSTVault or SafetyModule is ignored (see s4 / y2).
        User donor = new User();
        uint donation = 500000e18;
        USDST.mint(address(donor), donation);
        uint lpValue0 = yv.convertToAssets(IERC20(address(yv)).balanceOf(address(lp)));
        donor.do(address(USDST), "transfer", address(yv), donation);

        log("after a 500,000 REAL donation (plain ERC20 transfer, no deposit):");
        log("  YV totalAssets           = " + string(yv.totalAssets()) + " (was " + string(ta0) + ")");
        log("  YV exchangeRate          = " + string(yv.exchangeRate()) + " (was " + string(rate0) + ")");
        log("  YV accrualBaseAssets     = " + string(yv.accrualBaseAssets()) + " (stale until a checkpoint)");
        log("  LP redeemable before     = " + string(lpValue0));
        log("  LP redeemable after      = " + string(yv.convertToAssets(IERC20(address(yv)).balanceOf(address(lp)))));
        log("  previewDeposit(1e18)     = " + string(yv.previewDeposit(1e18)) + " (< 1e18: new depositors pay the donated NAV)");
        require(yv.totalAssets() == ta0 + donation, "DEMONSTRATED: raw live balance enters NAV with no guard");
        require(yv.exchangeRate() > rate0, "DEMONSTRATED: a plain transfer moves the YieldVault share price");
        require(yv.previewDeposit(1e18) < 1e18, "later depositors are priced against the donation");

        // and the stale accrual base gets picked up by the next checkpointing call
        uint baseStale = yv.accrualBaseAssets();
        User poke = new User();
        USDST.mint(address(poke), 1e18);
        poke.do(address(USDST), "approve", address(yv), INFINITY);
        poke.do(address(yv), "deposit(uint256,address)", 1e18, address(poke));
        log("  accrualBase after a 1e18 deposit checkpoint = " + string(yv.accrualBaseAssets()));
        require(yv.accrualBaseAssets() > baseStale + donation - 1e18, "the donation permanently enters the accrual base");
    }

    /// Can that live-balance NAV be turned into extraction? Deposit+redeem round trip.
    function it_y4_yieldvault_round_trip_extracts_nothing() public {
        YsRaider r = _raider(1e18);
        uint rate0 = yv.exchangeRate();
        uint base0 = yv.accrualBaseAssets();
        uint lpValue0 = yv.convertToAssets(IERC20(address(yv)).balanceOf(address(lp)));

        r.attack(1, MAXLOAN);

        log("── y4 YV deposit->redeem ──");
        log("deposited (wei)            = " + string(r.paidIn()));
        log("shares minted              = " + string(r.sharesGot()));
        log("assets returned (wei)      = " + string(r.assetsBack()));
        log("raider net (wei)           = -" + string(r.paidIn() - r.assetsBack()));
        log("accrualBase before/inside  = " + string(base0) + " / " + string(r.baseInside()));
        log("accrualBase after          = " + string(yv.accrualBaseAssets()));
        log("rate before/inside/after   = " + string(rate0) + " / " + string(r.rateInside()) + " / " + string(yv.exchangeRate()));
        log("LP value before/after      = " + string(lpValue0) + " / " + string(yv.convertToAssets(IERC20(address(yv)).balanceOf(address(lp)))));

        require(r.assetsBack() <= r.paidIn(), "BROKEN: YV round trip minted value");
        require(r.baseInside() > base0, "the deposit does inflate accrualBaseAssets mid-tx");
        require(yv.accrualBaseAssets() <= base0 + 2, "but the exit checkpoint puts it back (wei rounding aside)");
        require(yv.convertToAssets(IERC20(address(yv)).balanceOf(address(lp))) >= lpValue0, "BROKEN: LP lost value");
    }

    /// Can accrualBaseAssets be left inflated (sweep/revenue-window inflation)?
    function it_y5_accrual_base_cannot_be_left_inflated() public {
        uint base0 = yv.accrualBaseAssets();
        YsRaider r = _raider(1e18);
        string err = "";
        try r.attack(3, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── y5 accrualBase inflation attempt ──");
        log("revert                     = " + err);
        log("base before                = " + string(base0));
        log("base inside cb (donate+dep)= " + string(r.baseInside()));
        log("base after                 = " + string(yv.accrualBaseAssets()));
        require(err == "FlashMint: not repaid", "the donation half cannot be recovered");
        require(yv.accrualBaseAssets() == base0, "base rolled back with the transaction");

        // and prove the accrual target is computed off the PRE-deposit base, not the inflated one
        fastForward(86400);
        (uint target, uint funded) = yv.pendingAccrual();
        uint mgd0 = yv.totalAssets();
        YsRaider r2 = _raider(1e18);
        r2.attack(1, MAXLOAN);
        log("target owed for 1 day      = " + string(target));
        log("base used by _accrue       = " + string(base0) + " (pre-deposit)");
        log("credited                   = " + string(yv.totalAssets() - mgd0));
        require(yv.totalAssets() - mgd0 <= target + 1, "accrual cannot exceed the pre-deposit target");

        // Real-capital control: a donation that STAYS does permanently inflate the accrual base,
        // so the reward distributor pays yield on capital that owns no shares.
        fastForward(86400);
        uint baseA = yv.accrualBaseAssets();
        (uint tA, uint fA) = yv.pendingAccrual();
        User donor = new User();
        USDST.mint(address(donor), MAXLOAN);
        donor.do(address(USDST), "transfer", address(yv), MAXLOAN);
        User poke = new User();
        USDST.mint(address(poke), 1e18);
        poke.do(address(USDST), "approve", address(yv), INFINITY);
        poke.do(address(yv), "deposit(uint256,address)", 1e18, address(poke));   // forces a checkpoint
        fastForward(86400);
        (uint tB, uint fB) = yv.pendingAccrual();
        log("accrualBase before donation = " + string(baseA));
        log("accrualBase after donation  = " + string(yv.accrualBaseAssets()));
        log("daily target before/after   = " + string(tA) + " / " + string(tB));
        log("distributor balance         = " + string(USDST.balanceOf(address(distributor))));
        require(yv.accrualBaseAssets() > baseA + MAXLOAN - 1e18, "donation enters the accrual base");
        require(tB > tA * 2, "the distributor now pays yield on donated, share-less capital");
    }

    /// Queue DoS: one wei of shares freezes instant withdrawals and capital deployment.
    function it_y6_one_wei_queue_request_freezes_the_whole_vault() public {
        uint freeIdle0 = yv.freeIdleForInstantWithdrawals();
        uint maxDeploy0 = yv.maxDeploy();
        uint lpMax0 = yv.maxWithdraw(address(lp));

        YsRaider g = _raider(1e18);
        g.yvDeposit(1e18);
        g.yvRequestRedeem(1);          // ONE WEI of shares is enough

        log("── y6 queue-head DoS ──");
        log("griefer shares queued      = 1 wei (of " + string(IERC20(address(yv)).balanceOf(address(g))) + " held)");
        log("freeIdleForInstant before  = " + string(freeIdle0));
        log("freeIdleForInstant after   = " + string(yv.freeIdleForInstantWithdrawals()));
        log("maxDeploy before/after     = " + string(maxDeploy0) + " / " + string(yv.maxDeploy()));
        log("LP maxWithdraw before      = " + string(lpMax0));
        log("LP maxWithdraw after       = " + string(yv.maxWithdraw(address(lp))));

        string err = "";
        try lp.do(address(yv), "withdraw(uint256,address,address)", 1e18, address(lp), address(lp)) { }
        catch Error(string e) { err = e; }
        log("LP withdraw(1e18) revert   = " + err);

        require(yv.freeIdleForInstantWithdrawals() == 0, "DEMONSTRATED: 1 wei of queued shares zeroes instant liquidity");
        require(yv.maxWithdraw(address(lp)) == 0, "DEMONSTRATED: every LP is frozen out of the instant path");
        require(yv.maxDeploy() == 0, "DEMONSTRATED: capital deployment is frozen too");
        require(err != "", "LP withdraw must revert while a request sits at the head");

        // owner has to spend a transaction to clear it
        yv.processQueue(10, INFINITY);
        log("after owner processQueue: freeIdle = " + string(yv.freeIdleForInstantWithdrawals()));
        require(yv.freeIdleForInstantWithdrawals() > 0, "owner intervention restores it");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Q5  FEE ROUTING
    // ─────────────────────────────────────────────────────────────────────

    /// Fee is minted to the collector after burning amount+fee. Check neutrality under a
    /// callback that itself moves supply, and check feesAccrued bookkeeping.
    function it_y7_fee_routing_is_supply_neutral_and_accounted() public {
        fm.setFeeBps(100);   // 1%
        require(fm.feeBps() == 100, "fee set");

        YsRaider r = _raider(50000e18);
        uint expectFee = (MAXLOAN * 100) / 10000;   // 20,000e18

        uint supply0 = USDST.totalSupply();
        uint coll0 = USDST.balanceOf(address(m.feeCollector()));
        uint acc0 = fm.feesAccrued();
        uint own0 = USDST.balanceOf(address(r));

        // callback does a PSM round trip: mints and burns USDST, net zero of its own
        r.attack(7, MAXLOAN);

        log("── y7 fee routing, feeBps 100 ──");
        log("expected fee               = " + string(expectFee));
        log("feeCollector delta         = " + string(USDST.balanceOf(address(m.feeCollector())) - coll0));
        log("feesAccrued delta          = " + string(fm.feesAccrued() - acc0));
        log("borrower float before/after= " + string(own0) + " / " + string(USDST.balanceOf(address(r))));
        log("USDST supply delta         = " + string(USDST.totalSupply() - supply0));
        require(USDST.balanceOf(address(m.feeCollector())) - coll0 == expectFee, "fee routed exactly once");
        require(fm.feesAccrued() - acc0 == expectFee, "feesAccrued matches, no double count");
        require(own0 - USDST.balanceOf(address(r)) == expectFee, "the borrower's own float paid it");
        require(USDST.totalSupply() == supply0, "+amount -(amount+fee) +fee = 0 holds under a supply-moving callback");

        // three back-to-back loans in one test: telemetry must stay consistent
        uint coll1 = USDST.balanceOf(address(m.feeCollector()));
        uint acc1 = fm.feesAccrued();
        YsRaider r2 = _raider(50000e18);
        r2.attack(8, 100000e18);
        r2.attack(8, 100000e18);
        r2.attack(8, 100000e18);
        uint fee3 = 3 * ((100000e18 * 100) / 10000);
        log("3x100,000 loans: collector delta = " + string(USDST.balanceOf(address(m.feeCollector())) - coll1) + " expected " + string(fee3));
        log("feesAccrued delta                = " + string(fm.feesAccrued() - acc1));
        require(USDST.balanceOf(address(m.feeCollector())) - coll1 == fee3, "sequential loans each pay once");
        require(fm.feesAccrued() - acc1 == fee3, "feesAccrued exact");

        fm.setFeeBps(0);
    }

    /// Fee rounding and the redirect surface.
    function it_y8_fee_rounding_and_redirect_surface() public {
        fm.setFeeBps(100);
        log("── y8 fee rounding / redirect ──");
        log("largest fee-free loan      = 99 wei; loans to evade $1 of fee = " + string((1e18) / 99));

        // a fee-free dust loan really does execute: (99 * 100) / 10000 floors to 0
        YsRaider r = _raider(0);
        uint coll0 = USDST.balanceOf(address(m.feeCollector()));
        r.attack(8, 99);
        log("after 99-wei loan: collector delta = " + string(USDST.balanceOf(address(m.feeCollector())) - coll0));
        require(USDST.balanceOf(address(m.feeCollector())) == coll0, "no fee collected on a 99 wei loan");

        // the collector cannot be redirected by a non-owner
        User outsider = new User();
        string err = "";
        try outsider.do(address(fm), "setFeeCollector", address(outsider)) { }
        catch Error(string e) { err = e; }
        log("non-owner setFeeCollector  = " + err);
        require(fm.feeCollector() == address(m.feeCollector()), "collector unchanged");

        fm.setFeeBps(0);
    }

    /// FeeCollector holds the fee as a plain balance: only the owner can move it.
    function it_y9_collected_fee_is_only_owner_withdrawable() public {
        fm.setFeeBps(100);
        YsRaider r = _raider(50000e18);
        r.attack(8, 1000000e18);
        uint held = USDST.balanceOf(address(m.feeCollector()));
        log("── y9 FeeCollector custody ──");
        log("collector USDST balance    = " + string(held));

        User outsider = new User();
        string err = "";
        try outsider.do(address(m.feeCollector()), "withdrawToken", address(USDST), address(outsider), held) { }
        catch Error(string e) { err = e; }
        log("non-owner withdraw revert  = " + err);
        require(USDST.balanceOf(address(outsider)) == 0, "outsider got nothing");
        require(USDST.balanceOf(address(m.feeCollector())) == held, "collector balance intact");
        fm.setFeeBps(0);
    }
}
