contract ConstructionCalls {
    function attempt(address target, uint mode) public returns (bool) {
        try {
            if (mode == 0) target.call("touch");
            if (mode == 1) ConstructionTarget(target).touch();
            if (mode == 2) target.staticcall("read");
            if (mode == 3) target.delegatecall("touch");
            if (mode == 4) ConstructionTarget(target).value();
            if (mode == 5) target.call("missing");
        } catch MissingCodeCollection {
            return true;
        }
        return false;
    }
}

contract ConstructionTarget is ConstructionCalls {
    uint public value;
    bool public blocked;

    constructor(address helper, uint mode) {
        initialize(7);
        if (helper == address(0)) blocked = attempt(address(this), mode);
        else blocked = ConstructionCalls(helper).attempt(address(this), mode);
    }

    function initialize(uint initialValue) internal { value = initialValue; }
    function touch() public { value = 99; }
    function read() public returns (uint) { return value; }
    fallback() external { value = 99; }
}

contract ConstructionBase is ConstructionCalls {
    bool public baseBlocked;
    constructor() { baseBlocked = attempt(address(this), 0); }
    function touch() public {}
}

contract ConstructionDerived is ConstructionBase {
    uint public derivedValue;
    constructor() { derivedValue = 11; }
}

contract ConstructionChild {
    bool public blocked;
    constructor(address parent, address helper) {
        blocked = ConstructionCalls(helper).attempt(parent, 0);
    }
}

contract ConstructionParent {
    ConstructionChild public child;
    bool public blocked;
    constructor(address helper) {
        child = new ConstructionChild(address(this), helper);
        require(child.blocked(), "child called unfinished parent");
        blocked = ConstructionCalls(helper).attempt(address(this), 0);
    }
    function touch() public {}
}

contract ConstructionFailure {
    uint public value;
    event FailedConstruction();
    constructor() {
        value = 99;
        emit FailedConstruction();
        revert("constructor failed");
    }
}

contract ConstructionFactory {
    function fail() public { new ConstructionFailure(); }
}

contract ConstructionWitness {
    uint public calls;
    function observe() public { calls++; }
}

contract ConstructionFailureWithEffects {
    uint public value;
    constructor(ConstructionWitness witness) {
        value = 99;
        witness.observe();
        revert("constructor failed after callback");
    }
}

contract ConstructionRetry {
    uint public value;
    constructor(ConstructionWitness witness) {
        require(witness.calls() > 0, "not ready");
        value = 23;
    }
}

contract ConstructionRecovery is ConstructionCalls {
    bool public blocked;
    ConstructionTarget public child;
    constructor() {
        try { new ConstructionFailure(); } catch {}
        child = new ConstructionTarget(address(0), 0);
        blocked = attempt(address(this), 0);
    }
    function touch() public {}
}

contract ConstructionDestroyed {
    constructor() { selfdestruct(payable(address(0xdeadbeef))); }
    function touch() public {}
}

contract ConstructionMetadata {
    address public derived;
    constructor() {
        derived = address(this).derive("metadata", "ConstructionMetadata");
    }
}

contract ConstructionDestructionVictim {
    uint public value = 17;
    function destroy() public { selfdestruct(payable(address(0xdeadbeef))); }
}

contract ConstructionFailureAfterDestruction {
    constructor(address victim) {
        ConstructionDestructionVictim(victim).destroy();
        revert("constructor failed after destruction");
    }
}

contract ConstructionCollisionFactory {
    bool public entered;
    function deploy() public returns (ConstructionCollision) {
        return new ConstructionCollision{salt: "reserved"}(address(this));
    }
    function duplicate() public {
        if (!entered) {
            entered = true;
            new ConstructionCollision{salt: "reserved"}(address(this));
        }
    }
}

contract ConstructionCollision {
    bool public blocked;
    constructor(address factory) {
        try { ConstructionCollisionFactory(factory).duplicate(); }
        catch DuplicateContract { blocked = true; }
    }
}

contract ConstructionLogic {
    uint public value;
    function initialize(uint initialValue) public { value = initialValue; }
}

contract ConstructionProxy {
    uint public value;
    constructor(address logic) { logic.delegatecall("initialize", 23); }
}

contract ConstructionInitializer is ConstructionCalls {
    bool public blocked = attempt(address(this), 0);
    function touch() public {}
}

contract Describe_ConstructorReentrancy {
    ConstructionDestructionVictim victim;

    function beforeAll() public { victim = new ConstructionDestructionVictim(); }

    function check(address helper, uint mode) internal {
        ConstructionTarget target = new ConstructionTarget(helper, mode);
        require(target.blocked(), "runtime callable during construction");
        require(target.value() == 7, "constructor state changed by callback");
        target.touch();
        require(target.value() == 99, "runtime unavailable after construction");
    }

    function it_blocks_raw_self_calls() public { check(address(0), 0); }
    function it_blocks_typed_self_calls() public { check(address(0), 1); }
    function it_blocks_static_self_calls() public { check(address(0), 2); }
    function it_blocks_delegate_self_calls() public { check(address(0), 3); }
    function it_blocks_getters_during_construction() public { check(address(0), 4); }
    function it_blocks_fallback_during_construction() public { check(address(0), 5); }

    function it_blocks_indirect_callbacks() public {
        ConstructionCalls helper = new ConstructionCalls();
        for (uint mode = 0; mode < 6; mode++) { check(address(helper), mode); }
    }

    function it_blocks_callbacks_in_base_constructors() public {
        ConstructionDerived target = new ConstructionDerived();
        require(target.baseBlocked(), "base constructor exposed runtime");
        require(target.derivedValue() == 11, "derived constructor did not finish");
        target.touch();
    }

    function it_keeps_parents_blocked_through_nested_creation() public {
        ConstructionCalls helper = new ConstructionCalls();
        ConstructionParent parent = new ConstructionParent(address(helper));
        require(parent.blocked(), "parent guard cleared after child creation");
        require(parent.child().blocked(), "child callback was not blocked");
        parent.touch();
    }

    function it_allows_delegate_initialization_from_existing_logic() public {
        ConstructionLogic logic = new ConstructionLogic();
        ConstructionProxy proxy = new ConstructionProxy(address(logic));
        require(proxy.value() == 23, "delegate initialization failed");
        require(logic.value() == 0, "logic storage changed");
    }

    function it_blocks_callbacks_from_storage_initializers() public {
        ConstructionInitializer target = new ConstructionInitializer();
        require(target.blocked(), "storage initializer exposed runtime");
        target.touch();
    }

    function it_allows_creation_after_a_caught_constructor_failure() public {
        ConstructionFactory factory = new ConstructionFactory();
        bool caught = false;
        try { factory.fail(); } catch { caught = true; }
        require(caught, "failing constructor succeeded");
        check(address(0), 0);
    }

    function it_keeps_a_failed_constructor_unpublished() public {
        address failed = address(this).derive("failed-construction", "ConstructionFailure");
        bool caught = false;
        try { new ConstructionFailure{salt: "failed-construction"}(); } catch { caught = true; }
        require(caught, "failing constructor succeeded");
        bool callable = false;
        try { failed.call("value"); callable = true; } catch {}
        require(!callable, "failed constructor published runtime code");
    }

    function it_rolls_back_external_effects_of_failed_construction() public {
        ConstructionWitness witness = new ConstructionWitness();
        witness.observe();
        bool caught = false;
        try { new ConstructionFailureWithEffects(witness); } catch { caught = true; }
        require(caught, "failing constructor succeeded");
        require(witness.calls() == 1, "failed constructor callback persisted");
    }

    function it_recovers_from_a_failed_child_inside_a_constructor() public {
        ConstructionRecovery target = new ConstructionRecovery();
        require(target.blocked(), "parent guard cleared after child failure");
        require(target.child().blocked(), "successful child bypassed guard");
        target.touch();
    }

    function it_does_not_reinstall_selfdestructed_constructor_code() public {
        ConstructionDestroyed target = new ConstructionDestroyed();
        bool callable = false;
        try { target.touch(); callable = true; } catch {}
        require(!callable, "destroyed contract code was reinstalled");
    }

    function it_preserves_constructor_code_metadata() public {
        ConstructionMetadata target = new ConstructionMetadata();
        require(target.derived() == address(target).derive("metadata", "ConstructionMetadata"), "constructor derived with incorrect code metadata");
    }

    function it_releases_a_failed_salted_creation_for_retry() public {
        ConstructionWitness witness = new ConstructionWitness();
        address expected = address(this).derive("retry", "ConstructionRetry", witness);
        bool caught = false;
        try { new ConstructionRetry{salt: "retry"}(witness); } catch { caught = true; }
        require(caught, "unready constructor succeeded");
        witness.observe();
        ConstructionRetry target = new ConstructionRetry{salt: "retry"}(witness);
        require(address(target) == expected && target.value() == 23, "failed creation left address reserved");
    }

    function it_restores_cached_storage_after_constructor_destruction() public {
        require(victim.value() == 17, "victim not initialized");
        bool caught = false;
        try { new ConstructionFailureAfterDestruction(address(victim)); } catch { caught = true; }
        require(caught, "failing constructor succeeded");
        require(victim.value() == 17, "failed constructor purged cached storage");
    }

    function it_reserves_addresses_until_construction_finishes() public {
        ConstructionCollisionFactory factory = new ConstructionCollisionFactory();
        ConstructionCollision target = factory.deploy();
        require(target.blocked(), "nested create2 republished a reserved address");
    }

    function it_blocks_callbacks_through_raw_create() public {
        address target = create("RawConstruction", "contract RawConstruction { bool public blocked; constructor() { try { address(this).call(\"touch\"); } catch MissingCodeCollection { blocked = true; } } function touch() public {} }");
        bool blocked = target.call("blocked");
        require(blocked, "raw create exposed runtime");
        target.call("touch");
    }

    function it_blocks_callbacks_through_create2() public {
        address target = create2("constructor-guard", "SaltedConstruction", "contract SaltedConstruction { bool public blocked; constructor() { try { address(this).call(\"touch\"); } catch MissingCodeCollection { blocked = true; } } function touch() public {} }");
        bool blocked = target.call("blocked");
        require(blocked, "create2 exposed runtime");
        target.call("touch");
    }
}
