const SimpleStorage = `
contract SimpleStorage {
<<<<<<< HEAD
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
=======
    //Storage. Persists in between transactions
    uint x;
    //Allows the unsigned integer stored to be changed
    function set(uint newValue) {
        x = newValue;
    }
    //Returns the currently stored unsigned integer
    function get() returns (uint) {
        return x;
    }
}
`
export default {
    SimpleStorage
}
>>>>>>> 553c86e2fe3c9fafa7e975e2bcef1328f1acf274
