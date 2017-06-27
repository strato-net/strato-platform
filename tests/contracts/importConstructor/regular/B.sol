import "A.sol";

contract B is A("A") {
    string bValue;

    function B(string set) {
        bValue = set;
    }
}
