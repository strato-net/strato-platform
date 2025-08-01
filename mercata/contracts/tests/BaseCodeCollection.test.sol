pragma solidvm 12.0;

import "../concrete/BaseCodeCollection.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
    
    function callApprove(address a, address to, uint amount) public returns (bool) {
        return ERC20(a).approve(to, amount);
    }
    
    function callSwap(address a, bool isAToB, uint amountIn, uint minAmountOut) public returns (uint) {
        return Pool(a).swap(isAToB, amountIn, minAmountOut);
    }
}

contract Describe_Mercata {
    constructor() {
    }

    Mercata m;
    function beforeAll() {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() {
    }

    function it_can_deploy_Mercata() {
        require(address(m) != address(0), "address is 0");
    }

    function it_checks_that_lending_pool_is_set() {
        require(address(m.collateralVault().registry().lendingPool()) != address(0), "CollateralVault's LendingPool address is 0");
        require(address(m.liquidityPool().registry().lendingPool()) != address(0), "LiquidityPool's LendingPool address is 0");
    }

    function it_can_create_tokens() {
        address t = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(t != address(0), "Failed to create Token");
    }

    function it_can_create_pools() {
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);
        User u1 = new User();
        User u2 = new User();
        Token(t1).mint(address(this), 8000e18);
        Token(t2).mint(address(this), 20000000e18);
        Token(t1).mint(address(u1), 4e18);
        Token(t2).mint(address(u1), 10000e18);
        Token(t1).mint(address(u1), 4e18);
        Token(t2).mint(address(u2), 10000e18);
        address p1 = m.poolFactory().createPool(t1,t2);
        require(p1 != address(0), "Failed to create pool 1");
        // address p2 = m.poolFactory().createPool(t2,t1);
        // require(p2 != address(0), "Failed to create pool 2");
        require(ERC20(t1).approve(address(p1), 4000e18), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), 10000000e18), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        // uint l2 = Pool(p2).addLiquidity(4000e18, 10000000e18);
        // require(l2 > 0, "Failed to add liquidity to pool 2");
        require(u1.callApprove(t1, p1, 1e18), "Approval failed for u1");
        uint o1 = u1.callSwap(p1, true, 1e18, 2000e18);
        require(o1 > 2490e18, "Swap 1 returned less money than expected: " + string(o1));
        require(u1.callApprove(t2, p1, o1), "Approval failed for u1");
        uint o2 = u1.callSwap(p1, false, o1, 990e15);
        require(o2 > 994e15, "Swap returned less money than expected: " + string(o2));
    }

    function it_cannot_bankrupt_a_pool() {
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);
        User u1 = new User();
        User u2 = new User();
        Token(t1).mint(address(this), 8000e18);
        Token(t2).mint(address(this), 20000000e18);
        uint u1t1Amt = 16000000000000000e18;
        Token(t1).mint(address(u1), u1t1Amt);
        Token(t2).mint(address(u1), 20000000e18);
        address p1 = m.poolFactory().createPool(t1,t2);
        require(p1 != address(0), "Failed to create pool 1");
        require(ERC20(t1).approve(address(p1), 4000e18), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), 10000000e18), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        require(u1.callApprove(t1, p1, u1t1Amt), "Approval failed for u1");
        uint o1 = u1.callSwap(p1, true, u1t1Amt, 2000e18);
        require(o1 == 0, "Swap 1 returned less money than expected: " + string(o1));
    }
}