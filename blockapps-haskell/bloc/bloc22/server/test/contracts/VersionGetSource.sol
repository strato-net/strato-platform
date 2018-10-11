contract Version {

    uint version;
    function __getContractName__() view returns (string) {
        return "Version";
    }
    function __getSource__() view public returns (string) {
        return "contract Version {\n  uint version;\n}";
    }
}
