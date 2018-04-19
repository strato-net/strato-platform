contract SimpleString {

    string storedData = "Vitalik FtWWWWW";
    function __getSource__() constant returns (string) {
        return "contract SimpleString {\n  string storedData = \"Vitalik FtWWWWW\";\n  function set(string x) {\n    storedData = x;\n  }\n  function get() returns (string retVal) {\n    return storedData;\n  }\n}\n";  
    }
    function get() public returns (string retVal) {
        return storedData;
  
    }
    function set(string x) public {
        storedData = x;
  
    }
}