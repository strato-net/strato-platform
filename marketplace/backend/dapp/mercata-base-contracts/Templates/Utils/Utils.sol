pragma es6;
pragma strict;

contract Utils { 
    function getCommonName(address addr) internal returns (string) {
        return getUserCert(addr)["commonName"];
}