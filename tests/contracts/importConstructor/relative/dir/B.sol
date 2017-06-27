contract B {
    string value;

    function B(string set) {
        value = set;
    }

    function test() returns (string retVal) {
        return value;
    }
}
