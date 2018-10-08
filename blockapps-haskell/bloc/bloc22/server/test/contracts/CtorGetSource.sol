contract Ctor {

    constructor() public {
        
    }
    function __getContractName__() view public returns (string) {
        return "Ctor";
    }
    function __getSource__() view public returns (string) {
        return "contract Ctor {\n  constructor() {\n  }\n}\n";
    }
}
