library l {

}contract u {

    using l for uint256;

    function __getContractName__() view public returns (string) {
        return "u";
    }
    function __getSource__() view public returns (string) {
        return "library l {}\n\ncontract u {\n  using l for uint256;\n}\n";  
    
    }
}