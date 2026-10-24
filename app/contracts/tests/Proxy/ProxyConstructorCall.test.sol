import "../../concrete/Proxy/Proxy.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Logic {
    constructor() {}

    function marker() public returns (uint) {
        return 1;
    }
}

contract EvilLogic {
    constructor() {}

    function marker() public returns (uint) {
        return 2;
    }
}

contract Describe_ProxyConstructorCall {
    constructor() {}

    Proxy proxy;
    address originalLogic;
    User attacker;

    function beforeEach() {
        originalLogic = address(new Logic());
        proxy = new Proxy(originalLogic, address(this));
        attacker = new User();
    }

    function it_rejects_calling_the_constructor_of_a_deployed_proxy() {
        address evilLogic = address(new EvilLogic());
        bool rejected = false;
        try attacker.do(address(proxy), "<constructor>", evilLogic, address(attacker)) {
        } catch {
            rejected = true;
        }
        require(rejected, "constructor call on deployed proxy should revert");
        require(Logic(address(proxy)).marker() == 1, "logicContract changed");
    }
}
