pragma es6;
pragma strict;

contract Utils { 
    function getCommonName(address addr) internal returns (string) {
        string commonName = getUserCert(addr)["commonName"];
        if (commonName == ""){
            commonName = "Contract " + string(addr);
        }
        return commonName;
    }
}