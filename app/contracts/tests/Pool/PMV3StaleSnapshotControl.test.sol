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

contract Describe_PMV3StaleSnapshotControl {

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

    // CONTROL (passes today): same token with a negative snapshot, but the range is never
    // emptied, so the pool's snapshot stays non-zero and the manager's write is not dropped.
    function it_control_no_phantom_credit_while_pool_snapshot_is_nonzero() {
        attacker.do(address(manager), "mint",
            poolAddress, -600, -540, 0, 1e18, 0, 0, address(attacker), _deadline());
        _swap(true, 20000e18);
        _swap(false, 20000e18);
        uint trapId = manager.nextTokenId() + 0;
        attacker.do(address(manager), "mint",
            poolAddress, -1200, -600, 0, 5000e18, 0, 0, address(attacker), _deadline());
        (int in0, int in1) = pool.getPositionFeeGrowthInside(address(manager), -1200, -600);
        require(in0 < 0 && in1 < 0, "setup: fee growth inside should be negative");
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        attacker.do(address(manager), "collect", trapId, address(attacker), 0, 0);
        (uint owed0, uint owed1) = _owed(trapId);
        require(owed0 == 0 && owed1 == 0, "unexpected credit: " + string(owed0) + " " + string(owed1));
    }

    // CONTROL (passes today): a token minted fresh on a fresh range (snapshot 0, pool snapshot 0).
    function it_control_fresh_token_no_credit() {
        uint id = manager.nextTokenId() + 0;
        attacker.do(address(manager), "mint",
            poolAddress, -1200, -600, 0, 5000e18, 0, 0, address(attacker), _deadline());
        attacker.do(address(manager), "collect", id, address(attacker), 0, 0);
        (uint owed0, uint owed1) = _owed(id);
        require(owed0 == 0 && owed1 == 0, "unexpected credit: " + string(owed0) + " " + string(owed1));
    }
}
