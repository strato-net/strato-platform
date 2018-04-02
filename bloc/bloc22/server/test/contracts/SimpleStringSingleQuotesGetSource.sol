contract SimpleStringSingleQuotes {

    string storedData;
    function __getSource__() constant returns (string) {
        return "contract SimpleStringSingleQuotes {\n  string storedData = \'Vitalik FtWWWWW\';\n  function set(string x) {\n    storedData = x;\n  }\n  function get() returns (string retVal) {\n    return storedData;\n  }\n}\n";  
    }
    function get() returns (string retVal) {
        return storedData;
  
    }
    function set(string x) {
        storedData = x;
  
    }
}