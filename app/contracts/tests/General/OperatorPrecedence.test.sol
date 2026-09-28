// ============================================================================
//  SolidVM operator precedence (regression for the operator-precedence fork).
//
//  Before the fork the expression parser ranked assignment above && and ||,
//  so `a = b || c` parsed as `(a = b) || c` and only ever stored `b`. The
//  ternary was ranked above && and || as well, equality above the relational
//  operators, and ** and assignment associated to the left.
//
//  Run:  cd app/contracts/tests/General && solid-vm-cli test OperatorPrecedence.test.sol
// ============================================================================
contract Describe_OperatorPrecedence {
    bool sflag;

    function it_assignment_is_looser_than_or() {
        bool a = false;
        a = a || true;
        require(a, "a = a || true must store true");
        bool b = false;
        b = false || true;
        require(b, "b = false || true must store true");
    }

    function it_assignment_is_looser_than_and() {
        bool a = true;
        a = a && false;
        require(!a, "a = a && false must store false");
    }

    function it_storage_flag_accumulates_with_or() {
        sflag = false;
        uint[] types = [uint(1), uint(2)];
        for (uint i = 0; i < types.length; i++) {
            sflag = sflag || (types[i] == 2);
        }
        require(sflag, "flag = flag || cond must set the flag");
    }

    function it_ternary_is_looser_than_or_and_and() {
        bool f = false;
        bool t = true;
        uint r1 = f || t ? 1 : 2;
        require(r1 == 1, "(f || t) ? 1 : 2 must be 1");
        uint r2 = t && f ? 1 : 2;
        require(r2 == 2, "(t && f) ? 1 : 2 must be 2");
    }

    function it_and_binds_tighter_than_or() {
        bool r = true || false && false;
        require(r, "true || (false && false)");
    }

    function it_relational_binds_tighter_than_equality() {
        bool r = 1 < 2 == true;
        require(r, "(1 < 2) == true");
    }

    function it_exponent_is_right_associative() {
        require(2 ** 3 ** 2 == 512, "2 ** (3 ** 2)");
    }

    function it_assignment_is_right_associative() {
        uint a = 0;
        uint b = 0;
        a = b = 5;
        require(a == 5 && b == 5, "a = (b = 5)");
    }
}
