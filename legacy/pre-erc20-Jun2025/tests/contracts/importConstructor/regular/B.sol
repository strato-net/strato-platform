import "A.sol";

contract record B is A {
    string storedB;

    function B(string caA, string caB) A(caA){
        storedB = caB;
    }
}
