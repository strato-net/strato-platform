import "B.sol";


contract record C is A {
    string storedC;

    function C(string caC, string caA) A(caA) {
        storedC = caC;
    }
}
