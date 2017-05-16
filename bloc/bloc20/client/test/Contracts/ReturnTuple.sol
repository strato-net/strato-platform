contract ReturnTuple {
  bytes32 hash;
  string contents;

  function ReturnTuple (bytes32 _hash, string _contents) {
    hash = _hash;
    contents = _contents;
  }

  function getBlobData() returns (bytes32, string) {
    return (hash, contents);
  }

}
