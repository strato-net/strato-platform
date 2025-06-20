contract record DataTypeAddress {
    address storedData;

    address[] storedDatum;

    struct StoredStruct {
    address value;
    address[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (address => address) valueMapping;

    function DataTypeAddress(address _storedData) {
        storedData = _storedData;
    }

    function set(address value) {
        storedData = value;
    }

    function get() returns (address retVal) {
        return storedData;
    }

    function setArray(address[] values) {
        for (uint i = 0; i < values.length; i++) {
            storedDatum.push(values[i]);
        }
    }

    function getArray() returns (address[] retVal) {
        return storedDatum;
    }

    function getTuple(address v1, address v2, address v3) returns (address, address, address) {
        return (v1, v2, v3);
    }

    // structs can not be returned in solidity
    // this tests returning tuple(address, address[]) instead
    function setStruct(address value, address[] values) returns (address, address[]) {
        storedStruct = StoredStruct(value, values);
        return (storedStruct.value, storedStruct.values);
    }

    function setStructArray(address value, address[] values) {
        StoredStruct memory storedStruct = StoredStruct(value, values);
        storedStructs.push(storedStruct);
        storedStructs.push(storedStruct);
        storedStructs.push(storedStruct);
    }

    function setMapping(address value, address key) returns (address) {
        valueMapping[key] = value;
        return valueMapping[key];
    }
}
