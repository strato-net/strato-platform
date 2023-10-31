import <509>;

abstract contract Asset {
    address public owner;
    string name;
    string description;

    Sale public sale;

    constructor(string _name, string _description) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        owner = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
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

    function createBaseSale(address _purchaser, string _purchasePrice) internal returns (Sale) {
        Sale b = new Sale(
            _purchaser,
            address(this),
            _purchasePrice
        );
        return b;
    }

    function createSale(address _purchaser, string _purchasePrice) public requireOwner("Create sale") {
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_purchaser, _purchasePrice);
    }

    function transferOwnership(string _newOwner) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        owner = _newOwner;
        sale = Sale(address(0));
    }
}

