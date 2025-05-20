contract record A {
    string storedA;

    function A(string caA) {
        storedA = caA;
    }

    function test() returns (string) {
        return storedA;
    }
}
