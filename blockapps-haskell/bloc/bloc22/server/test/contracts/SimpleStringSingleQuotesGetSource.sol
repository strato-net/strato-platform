contract SimpleStringSingleQuotes {

    string storedData = 'Vitalik FtWWWWW';
    function __getContractName__() view returns (string) {
        return "SimpleStringSingleQuotes";
    }
    function __getSource__() view public returns (string) {
        return "contract SimpleStringSingleQuotes {\n  string storedData = 'Vitalik FtWWWWW';\n  function set(string x) {\n    storedData = x;\n  }\n  function get() returns (string retVal) {\n    return storedData;\n  }\n}\n";
    }
    function get() public returns (string retVal) {
        return storedData;
  
    }
    function set(string x) public {
        storedData = x;
  
    }
}
