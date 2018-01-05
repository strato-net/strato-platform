contract SimpleStorage {
  uint storedData;

  function SimpleStorage() {
    storedData = 1;
  }

  function __getSource__() constant returns (string) {
    return "contract SimpleStorage {\n  uint storedData;\n\n  function SimpleStorage() {\n    storedData = 1;\n  }\n\n  function set(uint x) {\n    storedData = x;\n  }\n\n  function get() constant returns (uint) {\n    return storedData;\n  }\n}\n";  }

  function set(uint x) {
    storedData = x;
  }

  function get() constant returns (uint) {
    return storedData;
  }
}
