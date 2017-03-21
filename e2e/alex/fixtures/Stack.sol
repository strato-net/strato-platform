contract Stack {
    uint[] data;
    function increment(uint index) {
        data.push(index);
    }
    function get() returns (uint[]) {
        return data;
    }
}
