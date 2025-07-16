contract record DataTypeBool {
    bool storedData;

    bool[] storedDatum;

    struct StoredStruct {
    bool value;
    bool[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (bool => bool) valueMapping;

    function DataTypeBool(bool _storedData) {
        storedData = _storedData;
    }

    function set(bool value) {
        storedData = value;
    }

    function get() returns (bool retVal) {
        return storedData;
    }

    function setArray(bool[] values) {
        for (uint i = 0; i < values.length; i++) {
            storedDatum.push(values[i]);
        }
    }

    function getArray() returns (bool[] retVal) {
        return storedDatum;
    }

    function getTuple(bool v1, bool v2, bool v3) returns (bool, bool, bool) {
        return (v1, v2, v3);
    }

    // structs can not be returned in solidity
    // this tests returning tuple(bool, bool[]) instead
    function setStruct(bool value, bool[] values) returns (bool, bool[]) {
        storedStruct = StoredStruct(value, values);
        return (storedStruct.value, storedStruct.values);
    }

    function setStructArray(bool value, bool[] values) {
        StoredStruct memory storedStruct = StoredStruct(value, values);
        storedStructs.push(storedStruct);
        storedStructs.push(storedStruct);
        storedStructs.push(storedStruct);
    }

    function setMapping(bool value, bool key) returns (bool) {
        valueMapping[key] = value;
        return valueMapping[key];
    }
}
