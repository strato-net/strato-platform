import "../A.sol";

contract C is A {
    string storedC;

    function C(string caC, string caA, string caB) A(caA, caB) {
        storedC = caC;
    }
}
