abstract contract Sale{

    string sellersOrganization;
    string sellersCommonName;
    string purchasersOrganization;
    string purchasersCommonName;
    Asset assetToBeSold;
    string price;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _price
    ) {
        assetToBeSold = Asset(_assetToBeSold);
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        sellersOrganization = Certificate(account(address(c), "main")).organization();
        sellersCommonName = Certificate(account(address(c), "main")).commonName();
        string currentOwnerOrg = assetToBeSold.ownerOrganization();
        string currentOwnerName = assetToBeSold.ownerCommonName();
        require(sellersOrganization == currentOwnerOrg, "Only the owner of the asset can open a bill of sale");
        require(sellersCommonName == currentOwnerName, "Only the owner of the asset can open a bill of sale");
        purchasersOrganization = _purchasersOrganization;
        purchasersCommonName = _purchasersCommonName;
        price = _price;
    }

    function requireSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + sellersCommonName
                   + " from "
                   + sellersOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == sellersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == sellersCommonName, err);
    }
}