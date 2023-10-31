import <509>;

abstract contract Asset {
    address public owner;
    string ownerCommonName;
    string name;
    string description;

    Sale public sale;

    constructor(string _name, string _description) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        owner = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        ownerCommonName = Certificate(account(address(owner), "main")).commonName();
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

    function createBaseSale(address _purchaser, string _purchasePrice, SaleState _state, PaymentType _payment) internal returns (Sale) {
        Sale b = new Sale(
            _purchaser,
            address(this),
            _purchasePrice,
            _state,
            _payment,
        );
        return b;
    }

    function createSale(address _purchaser, string _purchasePrice, SaleState _state, PaymentType _payment) public requireOwner("Create sale") {// can be overridden
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_purchaser, _purchasePrice, _state, _payment);
    }

    function changeSaleState(SaleState _state){
        requireOwner("Change Sale State");
        require(Sale!=address(0));
        sale.changeSaleState(_state);
    }

    function changePaymentType(PaymentType _payment){
        requireOwner("Change Payment Type");
        require(Sale!=address(0));
        sale.changePaymentType(_payment);
    }

    function transferOwnership(string _newOwner) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerCommonName = _newOwner;
        sale = Sale(address(0));
    }
}

