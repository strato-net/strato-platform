// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title What a caught failure leaves behind
/// @notice Code run by a try statement, in either form, must leave nothing
///         behind when it fails: no storage writes, no completed calls, and
///         no change to msg.sender. What it did is kept only if it finishes.

contract Box {
    uint public v;
    function set(uint x) public { v = x; }
    function setFail(uint x) public { v = x; require(false, "f"); }
}

contract Thrower {
    function boom() public { require(false, "boom"); }
}

contract Leaf {
    address public seen;
    address public origin;
    function note() public returns (address) { seen = msg.sender; origin = tx.origin; return msg.sender; }
    function fail() public { seen = msg.sender; require(false, "x"); }
}

contract Mid {
    Leaf public leaf;
    address public seenBefore;
    address public seenAfter;

    constructor() { leaf = new Leaf(); }

    function who() public returns (address) { return msg.sender; }
    function relayFail() public { leaf.fail(); }
    function deepFail(Thrower t) public { leaf.note(); t.boom(); }

    function relay() public returns (address) {
        seenBefore = msg.sender;
        address l = leaf.note();
        seenAfter = msg.sender;
        return l;
    }

    function callBack(address d) public returns (address) {
        address inCallback = Describe_TryCatchSender(d).cb();
        require(msg.sender == d, "sender after callback");
        return inCallback;
    }
}

contract Doomed {
    uint public x;
    function set(uint v) public { x = v; }
    function destroyAndFail(address to) public { selfdestruct(to); require(false, "after destroy"); }
}

contract Creator {
    address public creator;
    constructor() { creator = msg.sender; }
}

contract Describe_TryCatchState {
    struct S { uint a; uint b; }

    Box box;
    Doomed doomed;
    uint x;
    S s;
    mapping(uint => uint) m;

    function beforeAll() public {
        doomed = new Doomed();
    }

    function beforeEach() public {
        box = new Box();
        x = 0;
        s.a = 0;
    }

    function bump() internal returns (uint) { x = 5; return 1; }

    function early() internal returns (uint) {
        try { x = 6; return 42; } catch { }
        return 0;
    }

    function it_undoes_writes_made_in_a_block_that_fails() public {
        try { x = 7; s.a = 3; m[1] = 9; require(false, "b"); } catch { }
        require(x == 0, "x");
        require(s.a == 0, "s");
        require(m[1] == 0, "m");
    }

    function it_keeps_writes_made_in_a_block_that_finishes() public {
        try { x = 7; s.a = 3; m[2] = 9; } catch { }
        require(x == 7, "x");
        require(s.a == 3, "s");
        require(m[2] == 9, "m");
    }

    function it_undoes_a_completed_call_when_the_block_later_fails() public {
        try { box.set(5); require(false, "b"); } catch { }
        require(box.v() == 0, "box");
    }

    function it_reads_its_own_writes_inside_the_block() public {
        uint seen;
        try { x = 7; seen = x; box.set(4); require(box.v() == 4, "inner read"); } catch { seen = 99; }
        require(seen == 7, "seen");
        require(box.v() == 4, "box");
    }

    function it_keeps_writes_made_before_the_try() public {
        x = 3;
        try { x = 7; require(false, "b"); } catch { }
        require(x == 3, "x");
    }

    function it_keeps_writes_made_in_the_catch_block() public {
        try { require(false, "b"); } catch { x = 11; }
        require(x == 11, "x");
    }

    function it_undoes_only_the_inner_block_when_the_inner_one_fails() public {
        try { x = 1; try { x = 2; require(false, "i"); } catch { } s.a = x; } catch { }
        require(x == 1, "x");
        require(s.a == 1, "s");
    }

    function it_undoes_a_finished_inner_block_when_the_outer_one_fails() public {
        try { try { x = 2; } catch { } require(false, "o"); } catch { }
        require(x == 0, "x");
    }

    function it_undoes_what_the_arguments_of_a_failed_call_did() public {
        try box.setFail(bump()) { } catch { }
        require(x == 0, "x");
        require(box.v() == 0, "box");
    }

    function it_runs_the_success_block() public {
        uint r;
        try box.set(8) { r = box.v(); x = 4; } catch { r = 1; }
        require(r == 8, "r");
        require(x == 4, "x");
    }

    function it_returns_from_inside_a_block() public {
        require(early() == 42, "returned");
        require(x == 6, "x");
    }

    function it_breaks_and_continues_from_inside_a_block() public {
        uint n = 0;
        for (uint i = 0; i < 5; i++) {
            try { if (i == 1) { continue; } if (i == 3) { break; } n++; } catch { }
        }
        require(n == 2, "n");
    }

    function it_keeps_a_contract_whose_destruction_was_caught() public {
        doomed.set(8);
        try doomed.destroyAndFail(address(this)) { } catch { }
        require(doomed.x() == 8, "x");
    }

    function it_keeps_earlier_writes_of_a_contract_whose_destruction_was_caught() public {
        try doomed.destroyAndFail(address(this)) { } catch { }
        require(doomed.x() == 8, "x");
    }

    function it_undoes_every_failed_block_in_a_loop() public {
        uint n = 0;
        for (uint i = 0; i < 50; i++) {
            try { x = i; require(false, "b"); } catch { n++; }
        }
        require(n == 50, "n");
        require(x == 0, "x");
    }
}

contract Describe_TryCatchSender {
    Mid mid;
    Thrower thrower;
    address me;

    modifier keepsSender() {
        address before = msg.sender;
        _;
        require(msg.sender == before, "sender changed");
    }

    function beforeAll() public {
        mid = new Mid();
        thrower = new Thrower();
        me = address(this);
    }

    function cb() public returns (address) { return msg.sender; }
    function internalWho() internal returns (address) { return msg.sender; }

    function it_shows_the_caller_to_the_callee() public {
        require(mid.who() == me, "callee");
    }

    function it_keeps_the_sender_after_a_call() public {
        address before = msg.sender;
        mid.who();
        require(msg.sender == before, "after call");
    }

    function it_keeps_each_sender_through_nested_calls() public {
        require(mid.relay() == address(mid), "leaf saw mid");
        require(mid.seenBefore() == me, "mid before");
        require(mid.seenAfter() == me, "mid after");
        require(mid.leaf().origin() == tx.origin, "origin");
    }

    function it_keeps_the_sender_after_a_caught_call() public {
        address before = msg.sender;
        try mid.relayFail() { } catch { }
        require(msg.sender == before, "after catch");
    }

    function it_keeps_the_sender_after_a_caught_block() public {
        address before = msg.sender;
        try { mid.relayFail(); } catch { }
        require(msg.sender == before, "after catch");
    }

    function it_keeps_the_sender_after_a_failure_two_calls_down() public {
        address before = msg.sender;
        try mid.deepFail(thrower) { } catch { }
        require(msg.sender == before, "after catch");
        require(mid.who() == me, "callee after catch");
    }

    function it_keeps_the_sender_inside_the_catch_block() public {
        address before = msg.sender;
        address inCatch;
        try mid.relayFail() { } catch { inCatch = msg.sender; }
        require(inCatch == before, "in catch");
    }

    function it_keeps_the_sender_inside_the_success_block() public {
        address before = msg.sender;
        address inSuccess;
        try mid.who() returns (address w) { inSuccess = msg.sender; require(w == me, "w"); } catch { }
        require(inSuccess == before, "in success");
    }

    function it_keeps_the_sender_after_nested_catches() public {
        address before = msg.sender;
        try { try mid.relayFail() { } catch { } mid.deepFail(thrower); } catch { }
        require(msg.sender == before, "after catches");
    }

    function it_keeps_the_sender_across_a_modifier() public keepsSender {
        mid.who();
        try mid.relayFail() { } catch { }
    }

    function it_shows_the_caller_to_a_callback() public {
        require(mid.callBack(address(this)) == address(mid), "callback");
    }

    function it_keeps_the_sender_in_an_internal_call() public {
        require(internalWho() == msg.sender, "internal");
    }

    function it_shows_the_creator_to_a_constructor() public {
        Creator c = new Creator();
        require(c.creator() == me, "constructor");
    }
}
