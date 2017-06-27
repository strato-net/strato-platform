import "../A.sol";


contract C is A("A") {
    string cValue;

    function C(string set) {
        cValue = set;
    }
}
