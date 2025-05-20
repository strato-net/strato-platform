contract record DataTypeBytes {
    bytes32 storedData;

    bytes32[] storedDatum;

    struct StoredStruct {
    bytes32 value;
    bytes32[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (bytes32 => bytes32) valueMapping;

    function DataTypeBytes(bytes32 _storedData) {
        storedData = _storedData;
    }

    function set(bytes32 value) {
        storedData = value;
    }

    function get() returns (bytes32 retVal) {
        return storedData;
    }

    /* Array of bytes32s as a function argument is not supported by solidity
     * Using count instead
     */
    function setArray(bytes32 value, uint count) {
        for(uint i = 0;i < count; i++) {
            storedDatum.push(value);
        }
    }


    /* Array of bytes32s as a function return is not supported by solidity
     * Using index instead
     */
    function getArray(uint index) returns (bytes32 retVal) {
        return storedDatum[index];
    }


    function getTuple(bytes32 v1, bytes32 v2, bytes32 v3) returns (bytes32, bytes32, bytes32) {
        return (v1, v2, v3);
    }

    /* Array of bytes32s as a function argument is not supported by solidity
     * Using index instead
     */
    function setStruct(bytes32 value, bytes32 arrayValue, uint count) returns (bytes32, uint) {
        storedStruct.value = value;
        for(uint i = 0;i < count; i++) {
            storedStruct.values.push(arrayValue);
        }
        return (storedStruct.value, storedStruct.values.length);
    }

    /* Array of bytes32s as a function argument is not supported by solidity
     * Using storedStruct instead
     */
    function setStructArray(bytes32 value, bytes32 arrayValue, uint count) {
        for(uint i = 0; i < count; i++) {
            bytes32[] memory strArray;
            for(uint j = 0; j < count; j++) {
                strArray[j] = arrayValue;
            }
            StoredStruct memory storedStruct = StoredStruct(value,strArray);
            storedStructs.push(storedStruct);
        }
    }

    function setMapping(bytes32 value, bytes32 key) returns (bytes32) {
        valueMapping[key] = value;
        return valueMapping[key];
    }
}
