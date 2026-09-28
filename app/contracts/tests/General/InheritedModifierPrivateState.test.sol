// ============================================================================
//  A modifier declared in a base contract may reference the base's private
//  state; a child that uses (or merely inherits) that modifier must still
//  typecheck. The typechecker used to check the child's merged copy of the
//  modifier against the child's storage, where the parent's private variables
//  had been filtered out, and reported "Unknown variable".
//
//  Run:  cd app/contracts/tests/General && solid-vm-cli test InheritedModifierPrivateState.test.sol
// ============================================================================
contract Base {
    uint private secret = 7;
    bool private locked;
    modifier guard() {
        require(!locked, "locked");
        locked = true;
        _;
        locked = false;
    }
    function peek() internal view returns (uint) { return secret; }
}
contract Child is Base {
    function go() public guard returns (uint) { return peek(); }
}
contract Grandchild is Child {
    // guard is non-reentrant, so this must not call the guarded go()
    function goAgain() public guard returns (uint) { return peek() + 1; }
}
contract Describe_InheritedModifierPrivateState {
    function it_child_using_a_private_state_modifier_compiles_and_runs() {
        Child c = new Child();
        require(c.go() == 7, "modifier and private base state");
    }
    function it_grandchild_too() {
        Grandchild g = new Grandchild();
        require(g.goAgain() == 8, "two levels down");
    }
}
