abstract contract Asset {
    string public originalOwnersOrganization;
    string public originalOwnersCommonName;
    string public currentOwnersOrganization;
    string public currentOwnersCommonName;
    string public assetID;
    string public name;
    string public description;

    Sale public currentBillOfSale;

    constructor(
        string _assetID,
        string _name,
        string _description
    ) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        originalOwnersOrganization = Certificate(account(address(c), "main")).organization();
        originalOwnersCommonName = Certificate(account(address(c), "main")).commonName();
        currentOwnersOrganization = originalOwnersOrganization;
        currentOwnersCommonName = originalOwnersCommonName;
        assetID = _assetID;
        name = _name;
        description = _description;
    }

    function requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + currentOwnersCommonName
                   + " from "
                   + currentOwnersOrganization
                   + " can perform "
                   + action
                   + ".";
        string org = Certificate(account(address(c), "main")).organization();
        require(org == currentOwnersOrganization, err);
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == currentOwnersCommonName, err);
    }

    function openSale(string _purchasersOrganization, string _purchasersCommonName, address _assetToBeSold, string _purchasePrice){
        Sale b = new Sale(
                _purchasersOrganization,
                _purchasersCommonName,
                _assetToBeSold,
                _purchasePrice
            );
            currentBillOfSale = b;
    }

    function createBillOfSale(
        string _purchasersOrganization,
        string _purchasersCommonName,
        string _purchasePrice
    ) {
        requireOwner("create a bill of sale");
        require(address(currentBillOfSale) == address(0), "An open bill of sale already exists for this asset");
        Sale b = new Sale(
            _purchasersOrganization,
            _purchasersCommonName,
            address(this),
            _purchasePrice
            );
        currentBillOfSale = b;
    }

    function transferOwnership(
        string _newOwnersOrganization,
        string _newOwnersCommonName
    ) {
        require(msg.sender == address(currentBillOfSale), "Ownership transfer must originate from the active bill of sale");
        currentOwnersOrganization = _newOwnersOrganization;
        currentOwnersCommonName = _newOwnersCommonName;
        currentBillOfSale = Sale(address(0));
    }

    function closeBillOfSale(
    ) {
        require(msg.sender == address(currentBillOfSale), "Bill of sale can only be closed by the active bill of sale");
        currentBillOfSale = Sale(address(0));
    }
}