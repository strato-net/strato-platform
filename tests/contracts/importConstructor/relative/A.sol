import "./dir/B.sol";


contract A is B("B") {
    string aValue;

    function A(string set) {
        aValue = set;
    }
}
