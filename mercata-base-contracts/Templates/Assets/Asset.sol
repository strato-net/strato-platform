import <509>;

pragma es6;
pragma strict;

abstract contract Asset {
    address public owner;
    string ownerCommonName;
    string name;
    string description;
    string[] images;
    uint price;

    Sale public sale;

    constructor(string _name, string _description, string[] _images, uint _price, SaleState _state, PaymentType _payment) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        owner  = Certificate(account(address(c), "main")).userAddress();
        ownerCommonName = Certificate(account(address(c), "main")).commonName();
        name = _name;
        description =_description;
        images =_images;
        price = _price;
        createSale(_state, _payment);
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

    function createBaseSale(address _purchaser, SaleState _state, PaymentType _payment) internal returns (Sale) {
        Sale b = new Sale(
            _purchaser,
            address(this),
            _state,
            _payment,
        );
        return b;
    }

    function createSale(SaleState _state, PaymentType _payment) public requireOwner("Create sale") {// can be overridden
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_state, _payment);
    }

    function changeSaleState(SaleState _state) public requireOwner("Change Sale State"){
        require(Sale!=address(0));
        sale.changeSaleState(_state);
    }

    function changePrice(uint _price) public requireOwner("Change Asset Price"){
       price = _price;
    }

    function changePaymentType(PaymentType _payment) public requireOwner("Change Payment Type"){
        require(Sale!=address(0));
        sale.changePaymentType(_payment);
    }

    function transferOwnership(string _newOwner) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerCommonName = _newOwner;
        sale = Sale(address(0));
    }
}

