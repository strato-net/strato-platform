contract SimpleStorage{
  uint storedData;

  function SimpleStorage() {
    storedData = 1;
  }

  function __getSource__() constant returns (string) {
    return "contract SimpleStorage { uint storedData; function SimpleStorage() { storedData = 1; } function set(uint x) { storedData = x; } function get() constant returns (uint) { return storedData; } }";
  }

  function set(uint x) {
    storedData = x;
  }

  function get() constant returns (uint) {
    return storedData;
  }
}
