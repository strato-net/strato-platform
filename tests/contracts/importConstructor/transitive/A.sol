contract A {
    string value = "A";

    function A(string set) {
        value = set;
    }

    function test() returns (string retVal) {
        return value;
    }
}
