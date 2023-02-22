const SimpleStorage = `
contract SimpleStorage {
  uint storedData;
  constructor() {
    storedData = 1;
  }
  function set(uint x) {
    storedData = x;
  }
  function get() constant returns (uint) {
    return storedData;
  }
}`

const SimpleStorageV2 = `
contract SimpleStorageV2 {
  uint storedDataAlt;
  uint storedData;
  constructor() {
    storedData = 5;
    storedDataAlt = 2;
  }
  function setStoredData(uint y) {
    storedData = y;
  }
  function setStoredDataAlt(uint z) {
    storedDataAlt = z;
  }
  function getStoredData() constant returns (uint) {
    return storedData;
  }
  function getStoredDataAlt() constant returns (uint) {
    return storedDataAlt;
  }
}
`

export default {
    SimpleStorage,
    SimpleStorageV2
  }