contract SimpleTuple {
    uint storedData1;
    uint storedData2;
    function set(uint argVal1, uint argVal2) {
        storedData1 = argVal1;
        storedData2 = argVal2;
    }
    function get() returns (uint retVal1, uint retVal2) {
        return (storedData1, storedData2);
    }
}
