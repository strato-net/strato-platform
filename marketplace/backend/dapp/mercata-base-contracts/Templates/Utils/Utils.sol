pragma es6;
pragma strict;

import <509>;

contract Utils { 
    function getCommonName(address addr) internal returns (string) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(addr);
        string commonName = "";
        try {
            commonName = c.commonName();
        } catch {
            commonName = "Contract " + string(addr);
        }
        return commonName;
    }
}