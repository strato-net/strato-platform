abstract contract SimpleSale is Sale{

    enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }
    SaleState state;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _purchasePrice
    ) Sale(_purchasersOrganization, _purchasersCommonName, _assetToBeSold, _purchasePrice){
        state = SaleState.Created;
    }

    function requirePurchaser(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + purchasersCommonName
                   + " from "
                   + purchasersOrganization
                   + " can "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == purchasersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == purchasersCommonName, err);
    }

    function requirePurchaserOrSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + purchasersCommonName
                   + " from "
                   + purchasersOrganization
                   + " or "
                   + sellersCommonName
                   + " from "
                   + sellersOrganization
                   + " can "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        string commonName = Certificate(account(address(c), "main")).commonName();
        bool condition = (org == purchasersOrganization && commonName == purchasersCommonName)
                      || (org == sellersOrganization && commonName == sellersCommonName);
        require(condition, err);
    }

    function closeBillOfSale(
    ) {
        requirePurchaserOrSeller("close the bill of sale");
        state = SaleState.Closed;
    }
}