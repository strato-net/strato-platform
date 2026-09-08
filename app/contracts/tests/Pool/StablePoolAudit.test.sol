// ============================================================================
//  StablePool.sol - regression suite for the 2026-09-08 security audit.
//
//  Each test pins the *fixed* behaviour of one finding. They were originally
//  written to pass against the vulnerable contract (asserting the defect), then
//  inverted once the fixes landed, so every one of them fails again if the
//  corresponding fix is reverted.
//
//  Run:  cd app/contracts/tests/Pool && solid-vm-cli test StablePoolAudit.test.sol
// ============================================================================

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

/// @dev Minimal actor so we can make calls with a msg.sender other than the test contract.
contract Actor {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_StablePool_Audit is Authorizable {

    Mercata m;
    string[] emptyArray;

    address tA;
    address tB;
    StablePool pool;
    Token lp;

    uint constant FEE_DENOMINATOR = 1e10;
    uint constant A_PRECISION = 100;
    uint constant PRECISION = 1e18;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
    }

    // ---------------------------------------------------------------- helpers

    function newToken(string name, string sym) internal returns (address) {
        address t = m.tokenFactory().createToken(
            name, "audit token", emptyArray, emptyArray, emptyArray, sym, 100000000000e18, 18
        );
        Token(t).setStatus(2); // ACTIVE
        Token(t).mint(address(this), 10000000000e18);
        return t;
    }

    function grantLpRights(StablePool p) internal {
        Token t = p.lpToken();
        AdminRegistry ar = m.adminRegistry();
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(t), "mint", address(p));
        ar.castVoteOnIssue(address(ar), "addWhitelist", address(t), "burn", address(p));
    }

    /// @dev Fresh 2-coin pool, tokens approved, nothing deposited yet.
    function freshPool() internal {
        tA = newToken("Audit A", "AUDA");
        tB = newToken("Audit B", "AUDB");
        fastForward(100);
        pool = StablePool(m.poolFactory().createStablePool(tA, tB));
        lp = pool.lpToken();
        grantLpRights(pool);
        ERC20(tA).approve(address(pool), 10000000000e18);
        ERC20(tB).approve(address(pool), 10000000000e18);
    }

    /// @dev Ten round-trip swaps, purely to let adminBalances accrue.
    function accrueProtocolFees() internal {
        for (uint k = 0; k < 5; k++) {
            pool.exchange(0, 1, 1000e18, 1, address(0));
            pool.exchange(1, 0, 1000e18, 1, address(0));
        }
    }

    // =========================================================================
    // F1 (was Critical) - removeliquidityOneCoin() burns the caller's LP.
    //   StablePool.sol  lpToken.burn(msg.sender, _burnAmount)
    // =========================================================================
    function it_f1_one_coin_withdrawal_burns_the_caller_not_the_receiver() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        Actor victim = new Actor();
        uint victimLp = ERC20(address(lp)).totalSupply() / 2;
        ERC20(address(lp)).transfer(address(victim), victimLp);

        // (a) An attacker holding no LP cannot touch the victim's position.
        Actor attacker = new Actor();
        require(ERC20(address(lp)).balanceOf(address(attacker)) == 0, "F1: attacker holds no LP");
        bool attacked = false;
        try attacker.do(address(pool), "removeliquidityOneCoin",
                        victimLp, uint(0), uint(1), address(victim)) {
            attacked = true;
        } catch { attacked = false; }
        require(!attacked, "F1: a third party must not be able to close the victim's position");
        require(ERC20(address(lp)).balanceOf(address(victim)) == victimLp, "F1: victim untouched");
        require(ERC20(tA).balanceOf(address(victim)) == 0, "F1: victim not force-exited");

        // (b) _receiver still routes the proceeds, and costs the *caller* their LP.
        uint myLpBefore = ERC20(address(lp)).balanceOf(address(this));
        Actor payee = new Actor();
        uint got = pool.removeliquidityOneCoin(myLpBefore / 2, 0, 1, address(payee));
        require(ERC20(address(lp)).balanceOf(address(this)) == myLpBefore - myLpBefore / 2,
            "F1: the caller's own LP is what gets burned");
        require(ERC20(address(lp)).balanceOf(address(victim)) == victimLp, "F1: victim still untouched");
        require(ERC20(tA).balanceOf(address(payee)) == got && got > 0, "F1: proceeds go to _receiver");
    }

    // =========================================================================
    // F2 (was High) - withdrawals pro-rate over _balances(), so the protocol fee
    // balance stays with the fee collector.
    // =========================================================================
    function it_f2_exiting_lps_are_not_paid_the_protocol_fees() {
        freshPool();
        uint myLp = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        accrueProtocolFees();

        uint adminA = pool.adminBalances(tA);
        uint adminB = pool.adminBalances(tB);
        require(adminA > 0 && adminB > 0, "F2: protocol fees should have accrued");

        // pro-rata over the whole supply, which includes the locked MINIMUM_LIQUIDITY
        uint burn = myLp / 2;
        uint total = ERC20(address(lp)).totalSupply();
        uint fairA = (pool.tokenBalances(tA) - adminA) * burn / total;
        uint fairB = (pool.tokenBalances(tB) - adminB) * burn / total;

        uint[] got = pool.removeLiquidityGeneral(burn, [uint(0), uint(0)], address(this), false);

        require(got[0] == fairA, "F2: coin0 payout must be the _balances() share exactly");
        require(got[1] == fairB, "F2: coin1 payout must be the _balances() share exactly");
        require(pool.adminBalances(tA) == adminA, "F2: fee ledger untouched when not claiming");
        require(pool.tokenBalances(tA) >= pool.adminBalances(tA),
            "F2: pool still holds enough to cover the fee collector");
    }

    // =========================================================================
    // F2b (was High) - the last LP can exit a pool that has accrued fees.
    // =========================================================================
    function it_f2b_last_lp_can_exit_with_fees_outstanding() {
        freshPool();
        uint myLp = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        accrueProtocolFees();
        require(pool.adminBalances(tA) > 0, "F2b: fees accrued");

        Actor lastLp = new Actor();
        ERC20(address(lp)).transfer(address(lastLp), myLp / 100);   // 1% of supply
        pool.removeLiquidityGeneral(myLp - myLp / 100, [uint(0), uint(0)], address(this), false);

        uint stranded = ERC20(address(lp)).balanceOf(address(lastLp));
        require(stranded > 0, "F2b: last LP holds a position");

        bool exited = false;
        try lastLp.do(address(pool), "removeLiquidityGeneral",
                      stranded, [uint(0), uint(0)], address(lastLp), false) {
            exited = true;
        } catch { exited = false; }

        require(exited, "F2b: the last LP must be able to withdraw");
        require(ERC20(address(lp)).balanceOf(address(lastLp)) == 0, "F2b: position closed");
        require(ERC20(tA).balanceOf(address(lastLp)) > 0, "F2b: coins actually received");
        require(ERC20(address(lp)).totalSupply() == 1000, "F2b: pool fully wound down (only MINIMUM_LIQUIDITY remains)");
    }

    // =========================================================================
    // F2c (was High) - removeLiquidity() sweeps the fees before sizing the
    // payout, so a full exit works and the collector is actually paid.
    // =========================================================================
    function it_f2c_two_token_removeLiquidity_pays_the_collector_then_exits() {
        freshPool();
        uint funded = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        accrueProtocolFees();

        uint adminA = pool.adminBalances(tA);
        require(adminA > 0, "F2c: fees accrued");
        address collector = m.poolFactory().feeCollector();
        require(collector != address(0), "F2c: a fee collector is configured");
        uint collectorBefore = ERC20(tA).balanceOf(collector);

        (uint gotB, uint gotA) = pool.removeLiquidity(funded, 1, 1, block.timestamp + 1);

        require(gotA > 0 && gotB > 0, "F2c: full exit paid out");
        require(ERC20(address(lp)).totalSupply() == 1000, "F2c: supply fully burned (only MINIMUM_LIQUIDITY remains)");
        require(ERC20(tA).balanceOf(collector) == collectorBefore + adminA,
            "F2c: the fee collector received exactly the accrued fee");
        require(pool.adminBalances(tA) == 0, "F2c: fee ledger cleared");
    }

    // =========================================================================
    // F3 (was High) - _getP returns coins.length - 1 entries starting at coin 1,
    // so the published prices track the pool.
    // =========================================================================
    function it_f3_price_oracle_tracks_the_pool() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        require(pool.getP(0) == 1e18, "F3: at peg the coin1 price is 1.0");

        pool.exchange(0, 1, 60000e18, 1, address(0));
        fastForward(3600);
        pool.exchange(0, 1, 20000e18, 1, address(0));
        fastForward(3600);

        uint balA = pool.tokenBalances(tA) - pool.adminBalances(tA);
        uint balB = pool.tokenBalances(tB) - pool.adminBalances(tB);
        require(balA > balB * 5, "F3: pool is heavily imbalanced");

        uint spot = pool.getP(0);
        require(spot > 1050000000000000000, "F3: getP(0) is now the real coin1 price");
        require(pool.lastPrice(0) > 1050000000000000000, "F3: lastPrice(0) recorded the real price");
        require(pool.emaPrice(0) > 1e18, "F3: the EMA moved off its seed");
        require(pool.priceOracle(0) > 1e18, "F3: priceOracle(0) reports the real price");

        // index 1 no longer exists on a 2-coin pool
        bool oob = false;
        try pool.getP(1) { oob = false; } catch { oob = true; }
        require(oob, "F3: getP is bounded by coins.length - 1");

        // the Cirrus-indexed ratios must survive the re-index
        require(pool.bToARatio() > 1.0, "F3: bToARatio still tracks the pool");
        require(pool.aToBRatio() < 1.0 && pool.aToBRatio() > 0.0, "F3: aToBRatio still tracks the pool");
    }

    // =========================================================================
    // F4 (was Medium) - _getP divides D by n**n.
    // =========================================================================
    function refGetP(uint[] xp, uint d, uint amp, uint drDivisor, uint j) internal pure returns (uint) {
        uint n = xp.length;
        uint ann = amp * n;
        uint dr = d / drDivisor;
        for (uint i = 0; i < n; i++) {
            dr = (dr * d) / xp[i];
        }
        uint xp0A = (ann * xp[0]) / A_PRECISION;
        return 1e18 * (xp0A + (dr * xp[0] / xp[j])) / (xp0A + dr);
    }

    function it_f4_getP_uses_n_to_the_n() {
        address t0 = newToken("Audit C0", "AUDC0");
        address t1 = newToken("Audit C1", "AUDC1");
        address t2 = newToken("Audit C2", "AUDC2");
        fastForward(100);
        StablePool p3 = StablePool(m.poolFactory().createMultiTokenStablePool(
            [t0, t1, t2],
            [uint(1e18), uint(1e18), uint(1e18)],
            [uint(1), uint(1), uint(1)],
            [address(0), address(0), address(0)]
        ));
        grantLpRights(p3);
        ERC20(t0).approve(address(p3), 10000000000e18);
        ERC20(t1).approve(address(p3), 10000000000e18);
        ERC20(t2).approve(address(p3), 10000000000e18);

        p3.addLiquidityGeneral([uint(100000e18), uint(100000e18), uint(100000e18)], 1, address(0));
        p3.exchange(0, 1, 50000e18, 1, address(0));

        uint[] xp = [
            p3.tokenBalances(t0) - p3.adminBalances(t0),
            p3.tokenBalances(t1) - p3.adminBalances(t1),
            p3.tokenBalances(t2) - p3.adminBalances(t2)
        ];
        uint d   = p3.computeInvariant();
        uint amp = p3.initialA();              // not ramping, so _A() == initialA

        uint nSquared = refGetP(xp, d, amp, 3 * 3,  1);
        uint nToTheN  = refGetP(xp, d, amp, 3*3*3,  1);
        require(nSquared != nToTheN, "F4: the two divisors must actually differ here");

        // getP(0) is coin 1, getP(1) is coin 2 - the array is now n-1 long.
        require(p3.getP(0) == nToTheN,  "F4: contract must match the n**n variant");
        require(p3.getP(0) != nSquared, "F4: ...and must no longer match n*n");
        require(p3.getP(1) == refGetP(xp, d, amp, 3*3*3, 2), "F4: coin 2 priced correctly");

        // slot 0 now carries a real price rather than the coin0/coin0 constant
        require(p3.lastPrice(0) != 1e18, "F4: slot 0 is no longer the constant");
        bool oob = false;
        try p3.getP(2) { oob = false; } catch { oob = true; }
        require(oob, "F4: only n-1 prices exist");
    }

    // =========================================================================
    // F5 (was Medium) - the dynamic-fee argument is the rate-scaled sum, so the
    // off-peg multiplier is inert on an at-peg deposit.
    // =========================================================================
    function it_f5_offpeg_multiplier_is_inert_at_peg() {
        freshPool();
        pool.setNewFee(30000000, 10000000000);      // multiplier = FEE_DENOMINATOR
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        uint mintedFlat = pool.addLiquidityGeneral([uint(10000e18), uint(0)], 1, address(0));

        freshPool();
        pool.setNewFee(30000000, 20000000000);      // multiplier = 2x
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        uint mintedOffpeg = pool.addLiquidityGeneral([uint(10000e18), uint(0)], 1, address(0));

        uint diff = mintedFlat > mintedOffpeg ? mintedFlat - mintedOffpeg : mintedOffpeg - mintedFlat;
        require(diff * 1000000 / mintedFlat < 100,
            "F5: an at-peg deposit must be within 0.01% regardless of the offpeg multiplier");
    }

    // =========================================================================
    // F6 (was Medium) - the factory hands pools an EMA window, not a timestamp.
    // =========================================================================
    function it_f6_ma_window_is_a_duration() {
        fastForward(1757000000);        // a realistic unix time
        freshPool();
        require(pool.maExpTime() == 866, "F6: maExpTime is the 866s StableSwap default");
        require(pool.maExpTime() < block.timestamp / 1000, "F6: it is a window, not a clock reading");
    }

    // =========================================================================
    // F7 (was Medium) - the deposit wrappers enforce a slippage floor, and
    // maxTokenAAmount behaves as the cap its name promises.
    // =========================================================================
    function it_f7_deposit_wrappers_bound_slippage() {
        // honest execution still goes through
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        uint honest = pool.addLiquiditySingleToken(true, 10000e18, block.timestamp + 1);
        require(honest > 0, "F7: an unmolested deposit still succeeds");

        // the same call, front-run by a large swap, is now rejected
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        pool.exchange(0, 1, 80000e18, 1, address(0));
        bool sandwiched = false;
        try pool.addLiquiditySingleToken(true, 10000e18, block.timestamp + 1) {
            sandwiched = true;
        } catch { sandwiched = false; }
        require(!sandwiched, "F7: a sandwiched deposit must revert, not mint silently");

        // ...and a caller who wants that trade anyway can still opt in explicitly
        uint forced = pool.addLiquiditySingleTokenWithMin(true, 10000e18, 1, block.timestamp + 1);
        require(forced > 0, "F7: the explicit-minimum variant honours the caller's own bound");
    }

    function it_f7_max_token_a_amount_is_a_cap() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        uint aBefore = ERC20(tA).balanceOf(address(this));
        pool.addLiquidity(1000e18, 1000000e18, block.timestamp + 1);   // generous cap
        uint spent = aBefore - ERC20(tA).balanceOf(address(this));
        require(spent <= 1001e18 && spent >= 999e18,
            "F7: only the ratio-implied tokenA is pulled, not the whole cap");

        bool tooTight = false;
        try pool.addLiquidity(1000e18, 1e18, block.timestamp + 1) { tooTight = true; } catch { tooTight = false; }
        require(!tooTight, "F7: a cap below the required tokenA must revert");
    }

    // =========================================================================
    // F8 (was Medium) - migrateAllTokens() records the drain and locks the pool.
    // Lives in StablePoolMigration.test.sol: driving it needs a stand-in factory
    // that answers feeCollector(), and SolidVM resolves that name across the
    // whole code collection, so a harness here would hijack the fee sweep in
    // every other test in this file.
    // =========================================================================

    // =========================================================================
    // Hardening from the audit's Observations section.
    // =========================================================================
    function it_obs_initialize_cannot_be_replayed() {
        freshPool();
        uint coinsBefore = pool.getNumCoins();
        bool reinit = false;
        try pool.initialize(50, 1000, 1e10, 866, [tA, tB],
                            [uint(1e18), uint(1e18)], [uint(1), uint(1)],
                            [address(0), address(0)], address(lp)) {
            reinit = true;
        } catch { reinit = false; }
        require(!reinit, "OBS: initialize() is guarded");
        require(pool.getNumCoins() == coinsBefore, "OBS: coin set unchanged");
    }

    function it_obs_malformed_array_arguments_are_rejected() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        bool shortAdd = false;
        try pool.addLiquidityGeneral([uint(1000e18)], 1, address(0)) { shortAdd = true; } catch { shortAdd = false; }
        require(!shortAdd, "OBS: _amounts length is validated on deposit");

        bool shortRemove = false;
        try pool.removeLiquidityImbalance([uint(1000e18)], 1e30, address(this)) { shortRemove = true; }
        catch { shortRemove = false; }
        require(!shortRemove, "OBS: _amounts length is validated on imbalanced removal");

        // an over-sized imbalanced withdrawal reverts cleanly instead of aborting
        bool overdraw = false;
        try pool.removeLiquidityImbalance([uint(500000e18), uint(0)], 1e30, address(this)) { overdraw = true; }
        catch { overdraw = false; }
        require(!overdraw, "OBS: withdrawing more than the pool holds is rejected");

        // and the pool is still fully functional afterwards
        require(pool.exchange(0, 1, 100e18, 1, address(0)) > 0, "OBS: pool still healthy");
    }
}
