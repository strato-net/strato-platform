// ============================================================================
//  StablePool.sol - regression suite for the second security audit
//  (2026-09-08, follow-up to StablePoolAudit.test.sol).
//
//  Each test pins the *fixed* behaviour of one finding. They were originally
//  written to pass against the vulnerable contract (asserting the defect), then
//  inverted once the fixes landed, so every one of them fails again if the
//  corresponding fix is reverted. The write-up with the original numbers is
//  StablePoolAudit2.md next to this file.
//
//  Run:  cd app/contracts/tests/Pool && solid-vm-cli test StablePoolAudit2.test.sol
// ============================================================================

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

/// @dev Minimal actor so we can make calls with a msg.sender other than the test contract.
contract Actor {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_StablePool_Audit2 is Authorizable {

    Mercata m;
    string[] emptyArray;

    address tA;
    address tB;
    StablePool pool;
    Token lp;

    uint constant FEE_DENOMINATOR = 1e10;
    uint constant PRECISION = 1e18;
    uint constant MINIMUM_LIQUIDITY = 1000;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
    }

    // ---------------------------------------------------------------- helpers

    function newTokenDec(string name, string sym, uint8 dec) internal returns (address) {
        address t = m.tokenFactory().createToken(
            name, "audit token", emptyArray, emptyArray, emptyArray, sym, 100000000000e18, dec
        );
        Token(t).setStatus(2); // ACTIVE
        Token(t).mint(address(this), 10000000000e18);
        return t;
    }

    function newToken(string name, string sym) internal returns (address) {
        return newTokenDec(name, sym, 18);
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

    /// @dev Fresh 2-coin pool whose coins are flagged as rebasing (assetType 2),
    ///      so the pool reads its reserves from ERC20.balanceOf instead of its
    ///      own ledger.
    function freshRebasingPool() internal {
        tA = newToken("Rebase A", "RBA");
        tB = newToken("Rebase B", "RBB");
        fastForward(100);
        pool = StablePool(m.poolFactory().createMultiTokenStablePool(
            [tA, tB],
            [uint(1e18), uint(1e18)],
            [uint(2), uint(2)],
            [address(0), address(0)]
        ));
        lp = pool.lpToken();
        grantLpRights(pool);
        ERC20(tA).approve(address(pool), 10000000000e18);
        ERC20(tB).approve(address(pool), 10000000000e18);
    }

    function supply() internal returns (uint) {
        return ERC20(address(lp)).totalSupply();
    }

    function within(uint actual, uint expected, uint bps) internal returns (bool) {
        uint diff = actual > expected ? actual - expected : expected - actual;
        return diff * 10000 <= expected * bps;
    }

    // =========================================================================
    // G1 (was High) - removeliquidityOneCoin() sizes its fee on the imbalance
    // the withdrawal creates (Curve's `xp_j * D1 / D0 - new_y`), not on the
    // whole reserve. Before the fix a 1% withdrawal returned 1707 of 2000 and
    // anything under 0.15% of the pool aborted.
    // =========================================================================
    function it_g1_one_coin_withdrawal_charges_only_the_imbalance_fee() {
        freshPool();
        uint minted = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        // Balanced pool at peg: D == supply (incl. the locked minimum), 1 LP ~ 1 coin.
        require(pool.computeInvariant() == minted + MINIMUM_LIQUIDITY, "G1: balanced pool, D == LP supply");

        uint burn = minted / 100;                       // 1 % of the pool = 2000 LP
        uint adminBefore = pool.adminBalances(tA);
        uint dy = pool.removeliquidityOneCoin(burn, 0, 1, address(0));
        uint feeCharged = (pool.adminBalances(tA) - adminBefore) * 2; // admin keeps 50 % of it

        require(dy >= burn * 998 / 1000, "G1: a 1% one-coin withdrawal returns >= 99.8% of its share");
        require(feeCharged <= burn * 3 / 1000, "G1: the fee is a fraction of a percent of the withdrawal");

        // and it is consistent with the proportional path
        uint[] got = pool.removeLiquidityGeneral(burn, [uint(0), uint(0)], address(this), false);
        require(got[0] + got[1] >= burn * 99 / 100, "G1: proportional exit of the same LP pays ~100%");
    }

    function it_g1_small_one_coin_withdrawals_execute() {
        freshPool();
        uint minted = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        Actor holder = new Actor();
        uint burn = minted / 1000;                      // 0.1 % of the pool
        ERC20(address(lp)).transfer(address(holder), burn);

        bool ok = false;
        try holder.do(address(pool), "removeliquidityOneCoin", burn, uint(0), uint(1), address(holder)) {
            ok = true;
        } catch { ok = false; }
        require(ok, "G1: a 0.1% one-coin withdrawal executes");
        require(ERC20(address(lp)).balanceOf(address(holder)) == 0, "G1: the LP was burned");
        require(ERC20(tA).balanceOf(address(holder)) >= burn * 998 / 1000, "G1: ...and paid out at >= 99.8%");
    }

    // =========================================================================
    // G2 (was Medium) - addCoin() mints by the change in the invariant, like
    // every other deposit path, and rejects an initial amount that would lower
    // D. Before the fix a 1000-coin seed minted 1000 LP while D fell 6.7%, and
    // the new coin could immediately be dumped at 13.9x.
    // =========================================================================
    function it_g2_add_coin_mints_by_invariant_change() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        uint supply0 = supply();
        uint d0 = pool.computeInvariant();

        address tC = newToken("Audit C", "AUDC");
        ERC20(tC).approve(address(pool), 10000000000e18);

        // (a) a seed too small to raise D is refused outright
        bool tiny = false;
        try m.poolFactory().addCoinToStablePool(address(pool), tC, 1e18, 1, address(0), 1000e18, address(this)) {
            tiny = true;
        } catch { tiny = false; }
        require(!tiny, "G2: a value-destroying seed reverts");
        require(pool.getNumCoins() == 2, "G2: ...and leaves the pool untouched");

        // (b) a balanced seed mints exactly its share and moves no value
        uint minted = m.poolFactory().addCoinToStablePool(
            address(pool), tC, 1e18, 1, address(0), 100000e18, address(this)
        );
        uint d1 = pool.computeInvariant();
        require(pool.getNumCoins() == 3, "G2: coin added");
        require(within(minted, 100000e18, 1), "G2: 100000 balanced coins mint ~100000 LP");
        require(within(d1, d0 * 3 / 2, 1), "G2: D grew by exactly the seed");
        require(d1 * PRECISION / supply() >= d0 * PRECISION / supply0 - 1,
            "G2: existing LPs' virtual price did not fall");

        // (c) the new coin is priced at par and its oracle slot was seeded at spot
        require(within(pool.getP(1), 1e18, 1), "G2: new coin quoted at ~1.0");
        require(pool.lastPrice(1) == pool.getP(1), "G2: oracle slot seeded from the live price");
        uint out = pool.exchange(2, 0, 1000e18, 1, address(0));
        require(out < 1000e18 && out > 990e18, "G2: 1000 of the new coin sells for ~1000 minus fee");
    }

    // =========================================================================
    // G3 (was Medium) - rebasing support (assetType 2) is live. The flag is now
    // set with an `if`, because SolidVM evaluates the assignment statement
    // `flag = flag || (...)` as `(flag = flag) || (...)`.
    // =========================================================================

    /// @dev Canary for the VM behaviour the fix works around. If this test ever
    ///      fails, SolidVM has fixed its parser; the `if` in the contract stays
    ///      correct either way.
    function it_g3_solidvm_or_assignment_only_stores_the_left_operand() {
        bool a = false;
        a = a || (1 == 1);
        require(!a, "G3: `a = a || true` leaves a false");
        a = (a || (1 == 1));
        require(a, "G3: ...while `a = (a || true)` sets it");
        bool b = true;
        b = b && (1 == 2);
        require(b, "G3: `b = b && false` leaves b true");
    }

    function it_g3_rebasing_pool_reads_live_balances() {
        freshRebasingPool();
        require(pool.getAssetType(0) == 2 && pool.getAssetType(1) == 2, "G3: both coins declared rebasing");
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        // a positive rebase of 1% on coin 0 is seen by the pool...
        ERC20(tA).transfer(address(pool), 1000e18);
        require(pool.computeInvariant() > 200900e18, "G3: the rebase is visible in D");

        // ...and cannot be swept: exchangeReceived reverts on a rebasing pool
        Actor sweeper = new Actor();
        bool blocked = false;
        try sweeper.do(address(pool), "exchangeReceived", uint(0), uint(1), uint(1), uint(0), address(sweeper)) {
            blocked = false;
        } catch { blocked = true; }
        require(blocked, "G3: exchangeReceived is blocked on a rebasing pool");
        require(ERC20(tB).balanceOf(address(sweeper)) == 0, "G3: nothing left the pool");
    }

    // =========================================================================
    // G4 (was Low) - _addLiquidityGeneral calls upkeepOracles (as Curve does),
    // so the spot/EMA/D oracles follow deposits, not only swaps.
    // =========================================================================
    function it_g4_deposits_update_the_price_oracle() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        require(pool.lastPrice(0) == 1e18, "G4: seeded at peg");

        // a deposit nine times the pool, entirely in coin 0
        pool.addLiquidityGeneral([uint(900000e18), uint(0)], 1, address(0));
        uint spot = pool.getP(0);
        require(spot > 110e16, "G4: the live price of coin 1 moved >10% off peg");
        require(within(pool.lastPrice(0), spot, 50), "G4: lastPrice recorded the deposit (fee-adjusted state, within 0.5%)");

        fastForward(3600);
        require(pool.priceOracle(0) > 110e16, "G4: the EMA followed it within the hour");
    }

    // =========================================================================
    // G5 (was Low) - pausing stops the curve-priced withdrawals too. The
    // proportional exit stays open so LPs can always leave.
    // =========================================================================
    function it_g5_paused_pool_blocks_curve_priced_exits() {
        freshPool();
        uint minted = pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));
        pool.setPaused(true);
        require(pool.isPaused(), "G5: paused");

        bool oneCoin = false;
        try pool.removeliquidityOneCoin(minted / 10, 0, 1, address(0)) { oneCoin = true; } catch { oneCoin = false; }
        require(!oneCoin, "G5: one-coin withdrawal blocked while paused");

        bool imbalance = false;
        try pool.removeLiquidityImbalance([uint(5000e18), uint(0)], 1e30, address(this)) { imbalance = true; }
        catch { imbalance = false; }
        require(!imbalance, "G5: imbalanced withdrawal blocked while paused");

        uint[] got = pool.removeLiquidityGeneral(minted / 10, [uint(0), uint(0)], address(this), false);
        require(got[0] > 0 && got[1] > 0, "G5: proportional exit still works while paused");
    }

    // =========================================================================
    // G6 (was Low) - PoolFactory.createStablePool derives each coin's rate
    // multiplier from its decimals (10**(36 - decimals)), so a 6-decimal coin
    // trades at par with an 18-decimal one.
    // =========================================================================
    function it_g6_factory_pool_prices_mixed_decimals_at_par() {
        address t6 = newTokenDec("Six Dec", "SIX", 6);
        address t18 = newToken("Eighteen Dec", "EIGHTEEN");
        fastForward(100);
        StablePool p = StablePool(m.poolFactory().createStablePool(t6, t18));
        grantLpRights(p);
        require(p.rateMultipliers(t6) == 1e30 && p.rateMultipliers(t18) == 1e18, "G6: multipliers follow decimals");
        ERC20(t6).approve(address(p), 10000000000e18);
        ERC20(t18).approve(address(p), 10000000000e18);

        // 1000 of each, in each coin's own units: a balanced pool in real terms
        uint minted = p.addLiquidityGeneral([uint(1000e6), uint(1000e18)], 1, address(0));
        require(within(minted + MINIMUM_LIQUIDITY, 2000e18, 1), "G6: the seed is valued at 2000");

        uint out6 = p.exchange(1, 0, 1e18, 1, address(0));      // sell 1 of the 18-dec coin
        require(out6 <= 1000000 && out6 >= 996000, "G6: 1 coin buys ~1 (6-dec units) minus fee");
        uint out18 = p.exchange(0, 1, 1e6, 1, address(0));      // sell 1 of the 6-dec coin
        require(out18 <= 1e18 && out18 >= 996e15, "G6: ...and back again");
    }

    // =========================================================================
    // G7 (Informational, by design) - exchangeReceived() treats any surplus that
    // reached the pool as swap input for whoever calls it. Documented in NatSpec;
    // this test pins the behaviour clients must design around.
    // =========================================================================
    function it_g7_stray_transfer_is_swept_by_the_next_caller_by_design() {
        freshPool();
        pool.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        ERC20(tA).transfer(address(pool), 1000e18);

        Actor sweeper = new Actor();
        sweeper.do(address(pool), "exchangeReceived", uint(0), uint(1), uint(1), uint(0), address(sweeper));
        require(ERC20(tB).balanceOf(address(sweeper)) > 990e18,
            "G7: exchangeReceived must only ever be used atomically with the transfer");
    }

    // =========================================================================
    // L1 (was Low, latent behind G3) - the first deposit locks MINIMUM_LIQUIDITY
    // at address(0xdead), so inflating the LP price on a rebasing pool costs the
    // attacker 1000x what a victim could lose to rounding.
    // =========================================================================
    function it_l1_first_depositor_cannot_inflate_a_rebasing_pool() {
        freshRebasingPool();

        // a dust seed is refused
        bool dust = false;
        try pool.addLiquidityGeneral([uint(1), uint(1)], 1, address(0)) { dust = true; } catch { dust = false; }
        require(!dust, "L1: a seed below MINIMUM_LIQUIDITY reverts");

        // the smallest viable seed: 1000 wei each -> 1000 LP to the attacker, 1000 locked
        uint attackerLp = pool.addLiquidityGeneral([uint(1000), uint(1000)], 1, address(0));
        require(attackerLp == 1000, "L1: attacker holds 1000 LP");
        require(ERC20(address(lp)).balanceOf(address(0xdead)) == MINIMUM_LIQUIDITY, "L1: minimum locked");
        ERC20(tA).transfer(address(pool), 1e24);
        ERC20(tB).transfer(address(pool), 1e24);

        Actor victim = new Actor();
        ERC20(tA).transfer(address(victim), 14e23);
        ERC20(tB).transfer(address(victim), 14e23);
        victim.do(tA, "approve", address(pool), uint(14e23));
        victim.do(tB, "approve", address(pool), uint(14e23));
        victim.do(address(pool), "addLiquidity", uint(14e23), uint(14e23), block.timestamp + 1);

        // the attacker's exit returns about half of the donation: a loss of ~1e24
        uint aBefore = ERC20(tA).balanceOf(address(this));
        uint bBefore = ERC20(tB).balanceOf(address(this));
        pool.removeLiquidityGeneral(attackerLp, [uint(0), uint(0)], address(this), false);
        uint attackerOut = (ERC20(tA).balanceOf(address(this)) - aBefore)
                         + (ERC20(tB).balanceOf(address(this)) - bBefore);
        require(attackerOut < 101e22, "L1: attacker put in 2e24 and gets back ~1e24");

        // the victim is whole to within 0.1%
        victim.do(address(pool), "removeLiquidityGeneral",
                  ERC20(address(lp)).balanceOf(address(victim)), [uint(0), uint(0)], address(victim), false);
        uint victimOut = ERC20(tA).balanceOf(address(victim)) + ERC20(tB).balanceOf(address(victim));
        require(victimOut >= 28e23 * 999 / 1000, "L1: victim recovers >= 99.9% of the 2.8e24 deposited");
    }
}
