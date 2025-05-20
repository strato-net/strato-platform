import "ErrorCodes.sol";

contract record DataTypeEnum is ErrorCodes {
    ErrorCodes storedData;

    ErrorCodes[] storedDatum;

    struct StoredStruct {
      ErrorCodes value;
      ErrorCodes[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (uint => ErrorCodes) valueMapping;

    function DataTypeEnum(ErrorCodes _storedData) {
        storedData = _storedData;
    }

    function set(ErrorCodes value) {
        storedData = value;
    }

    function get() returns (ErrorCodes retVal) {
        return storedData;
    }

    function setArray(ErrorCodes[] values) {
      for (uint i = 0; i < values.length; i++) {
        storedDatum.push(values[i]);
      }
    }

    function getArray() returns (ErrorCodes[] retVal) {
        return storedDatum;
    }

    function getTuple(ErrorCodes v1, ErrorCodes v2, ErrorCodes v3) returns (ErrorCodes, ErrorCodes, ErrorCodes) {
      return (v1, v2, v3);
    }

    // structs can not be returned in solidity
    // this tests returning tuple(ErrorCodes, ErrorCodes[]) instead
    function setStruct(ErrorCodes value, ErrorCodes[] values) returns (ErrorCodes, ErrorCodes[]) {
      storedStruct = StoredStruct(value, values);
      return (storedStruct.value, storedStruct.values);
    }

    function setStructArray(ErrorCodes value, ErrorCodes[] values, uint count) {
      for(uint i = 0; i < count; i++) {
        StoredStruct memory storedStruct = StoredStruct(value, values);
        storedStructs.push(storedStruct);
      }
    }

    function setMapping(uint key, ErrorCodes value) returns (ErrorCodes) {
      valueMapping[key] = value;
      return valueMapping[key];
    }
}
