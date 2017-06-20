contract SimpleUIntStorage {
    uint storedData;

    uint[] storedDatum;

    function SimpleStorage(uint _storedData) {
        storedData = _storedData;
    }

    function set(uint value) {
        storedData = value;
    }

    function get() returns (uint retVal) {
        return storedData;
    }

    function set(uint ind, uint value) {
        storedDatum[ind] = value;
    }

    function get(uint ind) returns (uint retVal){
        return storedDatum[ind];
    }

    function getFirst2() returns (uint retVal1, uint retVal2){
        return (storedDatum[0], storedDatum[1]);
    }

    function getDatum() returns (uint[] retVal) {
        uint[] memory rtn = new uint[](storedDatum.length);
        for (uint i = 0; i < storedDatum.length; i++) {
            rtn[i] = storedDatum[i];
        }
        return rtn;
    }

    function getDatumHalves() returns (uint[] retVal1, uint[] retVal2) {
        uint[] memory rtn1 = new uint[](storedDatum.length/2);
        uint[] memory rtn2 = new uint[](storedDatum.length-storedDatum.length/2);
        uint i = 0;
        for (i = 0; i < storedDatum.length/2; i++) {
            rtn1[i] = storedDatum[i];
        }

        uint j = 0;
        for(; i < storedDatum.length; i++) {
            rtn2[j++] = storedDatum[i];
        }

        return (rtn1, rtn2);
    }
}

contract Simple$DATA_TYPE$Storage {
    $DATA_TYPE$ storedData;

    $DATA_TYPE$[] storedDatum;

    function SimpleStorage($DATA_TYPE$ _storedData) {
        storedData = _storedData;
    }

    function set($DATA_TYPE$ x) {
        storedData = x;
    }

    function get() returns ($DATA_TYPE$ retVal) {
        return storedData;
    }

    function set(uint ind, $DATA_TYPE$ value) {
        storedDatum[ind] = value;
    }

    function get(uint ind) returns ($DATA_TYPE$ retVal){
        return storedDatum[ind];
    }

    function getFirst2() returns ($DATA_TYPE$ retVal1, $DATA_TYPE$ retVal2){
        return (storedDatum[0], storedDatum[1]);
    }

    function getDatum() returns ($DATA_TYPE$[] retVal) {
        $DATA_TYPE$[] memory rtn = new $DATA_TYPE$[](storedDatum.length);
        for (uint i = 0; i < storedDatum.length; i++) {
            rtn[i] = storedDatum[i];
        }
        return rtn;
    }

    function getDatumHalves() returns ($DATA_TYPE$[] retVal, $DATA_TYPE$[] retVal1) {
        $DATA_TYPE$[] memory rtn = new $DATA_TYPE$[](storedDatum.length/2);
        $DATA_TYPE$[] memory rtn1 = new $DATA_TYPE$[](storedDatum.length-storedDatum.length/2);
        uint i = 0;
        for (i = 0; i < storedDatum.length/2; i++) {
            rtn[i] = storedDatum[i];
        }

        uint j = 0;
        for(; i < storedDatum.length; i++) {
            rtn1[j++] = storedDatum[i];
        }

        return (rtn, rtn1);
    }
}