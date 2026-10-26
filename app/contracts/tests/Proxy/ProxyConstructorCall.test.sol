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

contract Target {
    uint public x;

    constructor(uint _x) {
        x = _x;
    }

    function selfCall(uint v) public {
        address(this).call("<constructor>", v);
    }

    function delegateTo(address logic, uint v) public {
        logic.delegatecall("<constructor>", v);
    }
}

contract Base {
    uint public baseVal;

    constructor(uint v) {
        baseVal = v;
    }
}

contract Child is Base {
    uint public childVal;

    constructor(uint v) Base(v + 1) {
        childVal = v;
    }
}

contract SelfDuringCreation {
    uint public x;

    constructor() {
        x = 1;
        address(this).call("<constructor>");
        x = 2;
    }
}

contract AttackHelper {
    constructor(address p, address evil) {
        address(p).call("<constructor>", evil, address(this));
    }
}

contract Factory {
    function makeSelfDuringCreation() public returns (address) {
        return address(new SelfDuringCreation());
    }

    function makeAttackHelper(address p, address evil) public returns (address) {
        return address(new AttackHelper(p, evil));
    }
}

contract StatefulAttacker {
    uint public n;

    function go(address p, address evil) public {
        n = 1;
        address(p).call("<constructor>", evil, address(this));
        n = 2;
    }
}

contract Describe_ProxyConstructorCall {
    constructor() {}

    Proxy proxy;
    address originalLogic;
    address evilLogic;
    User attacker;
    User owner;

    function beforeEach() {
        originalLogic = address(new Logic());
        evilLogic = address(new EvilLogic());
        owner = new User();
        proxy = new Proxy(originalLogic, address(owner));
        attacker = new User();
    }

    function rejected(User u, address t, string f, variadic args) internal returns (bool) {
        try u.do(t, f, args) {
            return false;
        } catch {
            return true;
        }
    }

    function logicUnchanged() internal returns (bool) {
        return Logic(address(proxy)).marker() == 1;
    }

    // Existing contracts
    function it_rejects_calling_the_constructor_of_a_deployed_proxy() {
        require(rejected(attacker, address(proxy), "<constructor>", evilLogic, address(attacker)), "constructor call should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    function it_rejects_the_proxy_owner_too() {
        require(rejected(owner, address(proxy), "<constructor>", evilLogic, address(owner)), "owner constructor call should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    function it_rejects_constructor_calls_on_a_plain_contract() {
        Target t = new Target(7);
        require(rejected(attacker, address(t), "<constructor>", 99), "constructor call should revert");
        require(t.x() == 7, "target storage changed");
    }

    // Nested calls
    function it_rejects_a_self_call_to_the_constructor() {
        Target t = new Target(7);
        require(rejected(attacker, address(t), "selfCall", 99), "self constructor call should revert");
        require(t.x() == 7, "target storage changed");
    }

    function it_rejects_a_delegatecall_to_a_constructor() {
        Target t = new Target(7);
        Target other = new Target(8);
        require(rejected(attacker, address(t), "delegateTo", address(other), 99), "delegatecall to constructor should revert");
        require(t.x() == 7, "caller storage changed");
        require(other.x() == 8, "logic storage changed");
    }

    function it_rejects_dynamic_string_dispatch_through_a_contract() {
        StatefulAttacker a = new StatefulAttacker();
        require(rejected(attacker, address(a), "go", address(proxy), evilLogic), "nested constructor call should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    // Constructor chaining / creation context
    function it_runs_base_constructors_during_creation() {
        Child c = new Child(5);
        require(c.childVal() == 5, "child constructor did not run");
        require(c.baseVal() == 6, "base constructor did not run");
    }

    function it_runs_the_constructor_on_creation() {
        Target t = new Target(7);
        require(t.x() == 7, "constructor did not run on creation");
    }

    function it_rejects_constructor_redispatch_during_creation() {
        Factory f = new Factory();
        require(rejected(attacker, address(f), "makeSelfDuringCreation"), "constructor redispatch during creation should revert");
    }

    function it_does_not_let_a_helper_constructor_call_another_constructor() {
        Factory f = new Factory();
        require(rejected(attacker, address(f), "makeAttackHelper", address(proxy), evilLogic), "helper constructor attack should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    // Dispatch resolution
    function it_rejects_the_signature_form() {
        require(rejected(attacker, address(proxy), "<constructor>(address,address)", evilLogic, address(attacker)), "signature form should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    function it_rejects_the_padded_signature_form() {
        require(rejected(attacker, address(proxy), " <constructor> (address,address)", evilLogic, address(attacker)), "padded form should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    function it_does_not_resolve_constructor_aliases() {
        require(rejected(attacker, address(proxy), "constructor", evilLogic, address(attacker)), "constructor alias should revert");
        require(rejected(attacker, address(proxy), "Proxy", evilLogic, address(attacker)), "contract-name alias should revert");
        require(logicUnchanged(), "logicContract changed");
    }

    // Failure behavior
    function it_rolls_back_state_written_before_the_rejected_call() {
        StatefulAttacker a = new StatefulAttacker();
        rejected(attacker, address(a), "go", address(proxy), evilLogic);
        require(a.n() == 0, "attacker state survived the failed call");
        require(logicUnchanged(), "logicContract changed");
    }

    function it_still_allows_the_owner_upgrade_path() {
        require(!rejected(owner, address(proxy), "setLogicContract", evilLogic), "owner upgrade should succeed");
        require(Logic(address(proxy)).marker() == 2, "upgrade did not apply");
    }
}
