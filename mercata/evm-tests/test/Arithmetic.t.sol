// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Describe_ArithmeticMinimal} from "mercata/contracts/tests/Semantics/ArithmeticMinimal.test.sol";

contract SharedSemanticsHarness {
    function test_shared_arithmetic_minimal() public {
        Describe_ArithmeticMinimal c = new Describe_ArithmeticMinimal();
        c.it_adds_uints();
        // On EVM 0.8.x, unsigned underflow reverts before reaching the require in the shared test.
        try c.it_uint_underflow_wraps() {
            revert("Expected revert due to 0.8.x checked arithmetic");
        } catch {
            // pass
        }
        // Try/catch revert rollback semantics using external callee: outer +1 persists, callee hits rolled back
        uint beforeVal = c.counter();
        c.it_try_catch_external_revert_rolls_back_callee_and_keeps_caller();
        uint afterVal = c.counter();
        require(afterVal == beforeVal + 1, "Callee change not rolled back or caller outer change lost");

        // Overflow/underflow small-width: expect revert on 0.8.x
        try c.it_uint8_add_overflow_wraps() {
            revert("Expected revert on uint8 add overflow");
        } catch {}
        try c.it_uint8_mul_overflow_wraps() {
            revert("Expected revert on uint8 mul overflow");
        } catch {}
        try c.it_int8_add_overflow_wraps() {
            revert("Expected revert on int8 add overflow");
        } catch {}
    }

    // EVM-only delegatecall semantics: storage context, msg.sender, and address(this)
    function test_delegatecall_semantics() public {
        DCImpl impl = new DCImpl();
        DCProxy proxy = new DCProxy();
        proxy.execDelegate(address(impl), 3);

        // Storage should be written in proxy (caller) context, not impl
        require(proxy.x() == 3, "proxy.x not updated by delegatecall");
        require(impl.x() == 0, "impl.x should remain 0");

        // msg.sender (inside impl during delegatecall) should be this harness (original caller)
        require(proxy.lastSender() == address(this), "msg.sender not preserved through delegatecall");

        // address(this) seen inside impl during delegatecall should be proxy
        require(proxy.self() == address(proxy), "address(this) context not proxy during delegatecall");
    }
}

contract DCImpl {
    uint public x;
    address public lastSender;
    address public self;
    function bump(uint d) external {
        x += d;
        lastSender = msg.sender;
        self = address(this);
    }
}

contract DCProxy {
    uint public x;
    address public lastSender;
    address public self;
    function execDelegate(address impl, uint d) external returns (bool, bytes memory) {
        (bool ok, bytes memory data) = impl.delegatecall(abi.encodeWithSignature("bump(uint256)", d));
        require(ok, "delegatecall failed");
        return (ok, data);
    }

    // Allow impl code (executed via delegatecall) to write into our storage
    function setX(uint v) external { x = v; }
    function setLastSender(address a) external { lastSender = a; }
    function setSelf(address a) external { self = a; }
}


