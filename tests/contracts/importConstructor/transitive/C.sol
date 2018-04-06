import "B.sol";


contract C is A {
    string storedC;

    function C(string caC, string caA) A(caA) {
        storedC = caC;
    }
}
