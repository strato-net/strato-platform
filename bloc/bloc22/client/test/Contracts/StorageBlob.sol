contract StorageBlob {

  function set(bytes32 a, bytes32[] b, string c) returns(string) {
      return c;
  }
}

contract StorageDepolyer {

  function deployBlob() returns(address) {
    StorageBlob bytesContract = new StorageBlob();
    return bytesContract;
  }
}
