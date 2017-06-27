contract A {
    string value;

    function A(string set) {
        value = set;
    }

    function test() returns (string retVal) {
        return value;
    }
}
