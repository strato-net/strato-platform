abstract contract Sale{

    enum Persona {
        NONE,
        Purchaser,
        Seller,
        MAX
    }

    enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }

    string sellersOrganization;
    string sellersCommonName;
    string purchasersOrganization;
    string purchasersCommonName;
    Asset assetToBeSold;
    string purchasePrice;
    SaleState state;

    constructor(
        string _purchasersOrganization,
        string _purchasersCommonName,
        address _assetToBeSold,
        string _purchasePrice
    ) {
        assetToBeSold = Asset(_assetToBeSold);
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        sellersOrganization = Certificate(account(address(c), "main")).organization();
        sellersCommonName = Certificate(account(address(c), "main")).commonName();
        string currentOwnerOrg = assetToBeSold.currentOwnersOrganization();
        string currentOwnerName = assetToBeSold.currentOwnersCommonName();
        require(sellersOrganization == currentOwnerOrg, "Only the owner of the asset can open a bill of sale");
        require(sellersCommonName == currentOwnerName, "Only the owner of the asset can open a bill of sale");
        purchasersOrganization = _purchasersOrganization;
        purchasersCommonName = _purchasersCommonName;
        purchasePrice = _purchasePrice;
        state = SaleState.Created;
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
        assetToBeSold.closeBillOfSale();
    }
}