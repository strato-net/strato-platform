import <509>;

abstract contract Asset {
    string public ownerOrganization;
    string public ownerCommonName;
    string public assetID;
    Sale public sale;

    constructor(string _assetID) 
    {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        ownerOrganization = Certificate(account(address(c), "main")).organization();
        ownerCommonName = Certificate(account(address(c), "main")).commonName();
        assetID = _assetID;
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

    function createBaseSale( string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) returns(Sale){
        Sale b = new Sale(
            _purchaserOrganization,
            _purchaserCommonName,
            address(this),
            _purchasePrice
            );
        return b;
    }

    function createSale( string _purchaserOrganization, string _purchaserCommonName, string _purchasePrice) public requireOwner("Create sale") {
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale( _purchaserOrganization, _purchaserCommonName, _purchasePrice);
    }

    function transferOwnership( string _newOwnerOrganization, string _newOwnerCommonName ) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerOrganization = _newOwnerOrganization;
        ownerCommonName = _newOwnerCommonName;
        sale = Sale(address(0));
    }
}

