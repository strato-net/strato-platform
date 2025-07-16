contract record SimpleStorage {
    string storedData;

    function SimpleStorage(string _storedData) {
            storedData = _storedData;
    }

    function set(string x) {
            storedData = x;
    }
    function get() returns (string retVal) {
            return (storedData);
    }
}