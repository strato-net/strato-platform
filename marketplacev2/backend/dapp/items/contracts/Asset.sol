import <509>;

abstract contract Asset {
    string public ownerCommonName;
    string name;
    string description;

    Sale public sale;

    constructor(string _name, string _description) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);

        ownerCommonName = Certificate(account(address(c), "main")).commonName();
        name = _name;
        description =_description;
    }

    modifier requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        string err = "Only "
                   + ownerCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = Certificate(account(address(c), "main")).commonName();
        require(commonName == ownerCommonName, err);
        _;
    }

    function createBaseSale(string _purchaserOrganization, string _purchaserOrganizationalUnit, string _purchaserCommonName, string _purchasePrice) internal returns (Sale) {
        Sale b = new Sale(
            _purchaserCommonName,
            address(this),
            _purchasePrice
        );
        return b;
    }

    function createSale(string _purchaserOrganization, string _purchaserOrganizationalUnit, string _purchaserCommonName, string _purchasePrice) public requireOwner("Create sale") {
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_purchaserCommonName, _purchasePrice);
    }

    function transferOwnership(string _newOwnerOrganization, string _newOwnerOrganizationalUnit, string _newOwnerCommonName) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerCommonName = _newOwnerCommonName;
        sale = Sale(address(0));
    }
}

