contract StaticCallChild {}

contract StaticCallTarget {
    uint public value = 7;
    event Changed(uint value);

    function read() public returns (uint) {
        uint localValue = value;
        localValue++;
        return localValue;
    }

    function write() public {
        value = 9;
    }

    function destroy() public {
        selfdestruct(payable(address(0xdeadbeef)));
    }

    function rawCreate() public returns (address) {
        return create("Child", "contract Child {}");
    }

    function rawCreate2() public returns (address) {
        return create2("salt", "Child", "contract Child {}");
    }

    function newContract() public {
        new StaticCallChild();
    }

    function logEvent() public {
        emit Changed(value);
    }

    function forward(address target, string operation) public {
        target.call(operation);
    }
}

contract Describe_StaticCall {
    StaticCallTarget target;

    function beforeEach() public {
        target = new StaticCallTarget();
    }

    function expectInvalidWrite(string operation) internal {
        bool caught = false;
        try {
            address(target).staticcall(operation);
        } catch InvalidWrite {
            caught = true;
        }
        require(caught, "staticcall did not reject " + operation);
        require(target.value() == 7, "staticcall changed target state");
    }

    function it_allows_reads_and_local_mutations() public {
        uint result = address(target).staticcall("read");
        require(result == 8, "incorrect read result");
        require(target.value() == 7, "local mutation changed storage");
        target.write();
        require(target.value() == 9, "write access was not restored after success");
    }

    function it_rejects_storage_writes() public {
        expectInvalidWrite("write");
    }

    function it_rejects_selfdestruct() public {
        expectInvalidWrite("destroy");
    }

    function it_rejects_raw_create() public {
        expectInvalidWrite("rawCreate");
    }

    function it_rejects_raw_create2() public {
        expectInvalidWrite("rawCreate2");
    }

    function it_rejects_new_contract() public {
        expectInvalidWrite("newContract");
    }

    function it_rejects_event_emission() public {
        expectInvalidWrite("logEvent");
    }

    function it_propagates_read_only_to_nested_calls() public {
        StaticCallTarget relay = new StaticCallTarget();
        bool caught = false;
        try {
            address(relay).staticcall("forward", address(target), "rawCreate");
        } catch InvalidWrite {
            caught = true;
        }
        require(caught, "nested call escaped read-only restriction");
    }

    function it_restores_write_access_after_failure() public {
        expectInvalidWrite("rawCreate");
        target.write();
        require(target.value() == 9, "write access was not restored");
    }

    function it_allows_mutations_in_ordinary_calls() public {
        address child = target.rawCreate();
        address saltedChild = target.rawCreate2();
        require(child != address(0), "create failed");
        require(saltedChild != address(0), "create2 failed");
        target.logEvent();
        target.destroy();
    }
}
