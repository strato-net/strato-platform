import "../concrete/BaseCodeCollection.sol";
import "main.groth16.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
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
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18, block.timestamp);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        // uint l2 = Pool(p2).addLiquidity(4000e18, 10000000e18);
        // require(l2 > 0, "Failed to add liquidity to pool 2");
        require(u1.do(t1, "approve", p1, 1e18), "Approval failed for u1");
        uint o1 = u1.do(p1, "swap", true, 1e18, 2000e18, block.timestamp);
        require(o1 > 2490e18, "Swap 1 returned less money than expected: " + string(o1));
        require(u1.do(t2, "approve", p1, o1), "Approval failed for u1");
        uint o2 = u1.do(p1, "swap", false, o1, 990e15, block.timestamp);
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
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18, block.timestamp);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        require(u1.do(t1, "approve", p1, u1t1Amt), "Approval failed for u1");
        uint o1 = u1.do(p1, "swap", true, u1t1Amt, 2000e18, block.timestamp);
        require(o1 > 0, "Swap 1 returned less money than expected: " + string(o1));
    }

    function it_can_hash_last_piecewise_transaction_data() {
        uint ver = 2;
        uint nonce = 1620;
        uint gasLimit = 150000;
        address to = address(0x000000000000000000000000000000000000100e);
        string funcName = "mint";
        string[] args = ["0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7","10000000000000000000"];
        string network = "mercata";
        uint v = 0x1c;
        uint r = 0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9;
        uint s = 0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19;

        string h = keccak256(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);
        string u = keccak256(ver, nonce, gasLimit, to, funcName, args, network);
        address from = ecrecover(u, v, r, s);
        require(from == address(0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce), "Signed tx hash: " + h + ", unsigned tx hash: " + u + ", Signer: 0x" + string(from) + " didn't match 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce");
    }

    struct Transaction {
        uint aversion;
        uint bnonce;
        uint cgasLimit;
        address dto;
        string efuncName;
        string[] fargs;
        string gnetwork;
        uint hv;
        uint ir;
        uint js;
    }

    function it_can_hash_transaction_data() {
        uint ver = 2;
        uint nonce = 1620;
        uint gasLimit = 150000;
        address to = address(0x000000000000000000000000000000000000100e);
        string funcName = "mint";
        string[] args = ["0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7","10000000000000000000"];
        string network = "mercata";
        uint v = 0x1c;
        uint r = 0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9;
        uint s = 0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19;
        Transaction t = Transaction(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);

        string h = keccak256(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);
        string h2 = keccak256(t);
        require(h == h2, "Hashes don't match");
    }

    function it_can_add_from_an_uninitialized_map() {
        mapping (string => uint) nums;
        mapping (string => string) strs;
        require(3 + nums["hello"] == 3, "Mapping should return 0, instead got " + string(nums["hello"]));
        require(strs["hello"] + "yo" + strs["goodbye"] == "yo", "Mapping should return empty string, instead got " + strs["hello"]);
    }

    function it_can_verify_a_groth16_proof() {
        Verifier v = new Verifier();
        uint[2] a = [1,2];
        uint[2][2] b = [[3,4],[5,6]];
        uint[2] c = [7,8];
        uint[2] input = [9,10];
        bool success = v.verifyProof(a, b, c, input);
        require(success, "Groth16 proof failed!");
    }
}
