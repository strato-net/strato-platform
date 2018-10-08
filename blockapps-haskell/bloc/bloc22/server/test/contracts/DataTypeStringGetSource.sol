contract DataTypeString {

    string[4] storedDatum;
    struct StoredStruct {
      string[3] values;
    }
    function __getContractName__() view returns (string) {
        return "DataTypeString";
    }
    function __getSource__() view public returns (string) {
        return "contract DataTypeString {\n    string[4] storedDatum;\n    struct StoredStruct {\n      string[3] values;\n    }\n}\n";
    }
}
