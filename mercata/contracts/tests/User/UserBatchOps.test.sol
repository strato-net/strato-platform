import "../../concrete/User/UserRegistry.sol";

contract Counter {
    uint public count;

    constructor() {
        count = 0;
    }

    function increment() public {
        count++;
    }

    function add(uint x) public {
        count += x;
    }

    function failAlways() public {
        revert("always fails");
    }
}

contract Describe_UserBatchOps {
    UserRegistry registry;
    string constant counterSrc = "contract Counter { uint public count; constructor() { count = 0; } function increment() public { count++; } function add(uint x) public { count += x; } function failAlways() public { revert(\"always fails\"); } }";

    constructor() {
    }

    function beforeAll() public {
        registry = new UserRegistry(address(0), address(this));
    }

    function beforeEach() public {
    }

    function it_can_create_user_and_check_nonce() public {
        address userAddr = registry.createUser("testuser1");
        require(userAddr != address(0), "User address should not be 0");

        User user = User(userAddr);
        require(user.counter() == 0, "Initial nonce should be 0");
    }

    function it_can_execute_single_call_operation() public {
        address userAddr = registry.createUser("testuser2");
        User user = User(userAddr);

        // Deploy a counter contract first
        Counter counter = new Counter();
        require(counter.count() == 0, "Counter should start at 0");

        // Transfer counter ownership isn't needed since increment is public
        // Execute a single call operation via executeUserOperation
        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        user.executeUserOperation(op);

        require(counter.count() == 1, "Counter should be 1 after increment");
        require(user.counter() == 1, "Nonce should be 1 after operation");
    }

    function it_can_execute_multiple_operations() public {
        address userAddr = registry.createUser("testuser3");
        User user = User(userAddr);

        Counter counter = new Counter();

        UserOperation memory op1 = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation memory op2 = UserOperation({
            counter: 1,
            to: address(counter),
            failable: false,
            callData: variadic("add", 5)
        });

        user.executeUserOperation(op1);
        user.executeUserOperation(op2);

        require(counter.count() == 6, "Counter should be 6 (1 + 5)");
        require(user.counter() == 2, "Nonce should be 2 after two operations");
    }

    function it_rejects_wrong_counter() public {
        address userAddr = registry.createUser("testuser4");
        User user = User(userAddr);

        Counter counter = new Counter();

        // Try to execute with wrong counter (1 instead of 0)
        UserOperation memory op = UserOperation({
            counter: 1,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });

        try user.executeUserOperation(op)
        {
            revert("Should have failed with wrong counter");
        } catch {
        }

        require(user.counter() == 0, "Nonce should still be 0");
    }

    function it_handles_failable_operations() public {
        address userAddr = registry.createUser("testuser5");
        User user = User(userAddr);

        Counter counter = new Counter();

        // First op: increment (should succeed)
        UserOperation memory op1 = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });

        // Second op: failAlways (failable = true, should not revert the batch)
        UserOperation memory op2 = UserOperation({
            counter: 1,
            to: address(counter),
            failable: true,
            callData: variadic("failAlways")
        });

        // Third op: increment again
        UserOperation memory op3 = UserOperation({
            counter: 2,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });

        user.executeUserOperation(op1);
        user.executeUserOperation(op2);
        user.executeUserOperation(op3);

        require(counter.count() == 2, "Counter should be 2 (failed op was failable)");
        require(user.counter() == 3, "Nonce should be 3");
    }

    function it_reverts_on_non_failable_failure() public {
        address userAddr = registry.createUser("testuser6");
        User user = User(userAddr);

        Counter counter = new Counter();

        // Non-failable op that will fail
        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("failAlways")
        });

        try user.executeUserOperation(op)
        {
            revert("Should have reverted on non-failable failure");
        } catch {
        }

        require(user.counter() == 0, "Nonce should still be 0 after revert");
    }

    function it_can_create_contract_via_operation() public {
        address userAddr = registry.createUser("testuser7");
        User user = User(userAddr);

        // Create operation: to = address(0), callData = [contractName, contractSrc, ...args]
        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(0),
            failable: false,
            callData: variadic("Counter", counterSrc)
        });

        user.executeUserOperation(op);
        require(user.counter() == 1, "Nonce should be 1 after create");
    }
}
