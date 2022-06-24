contract SimpleString {
  string storedData = "Vitalik FtWWWWW";
  function set(string x) {
    storedData = x;
  }
  function get() returns (string retVal) {
    return storedData;
  }
}
