abstract contract OwnedAsset is Asset{
    string public ownerOrganization;
    string public ownerCommonName;

    constructor() Asset() 
    {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        ownerOrganization = Certificate(account(address(c), "main")).organization();
        ownerCommonName = Certificate(account(address(c), "main")).commonName();
    }

    modifier requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + ownerCommonName
                   + " from "
                   + ownerOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == ownerCommonName, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == ownerCommonName, err);
        _;
    }
}

