import "./dir/B.sol";

contract A is B{
    string storedA;

    function A(string caA, string caB) B(caB) {
        storedA = caA;
    }
}
