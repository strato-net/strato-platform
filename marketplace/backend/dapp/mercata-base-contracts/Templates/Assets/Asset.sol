import <509>;

pragma es6;
pragma strict;

abstract contract Asset is PaymentType, SaleState, RestStatus{
    // address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public price;
    uint public createdDate;

    // Sale public sale;
    mapping(address => bool) public whitelistedSales;
    SaleFactory salefactory;

    constructor(string _name, string _description, string[] _images, uint _price, uint _createdDate, SaleState _state, PaymentType _payment) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        // owner  = c.userAddress();
        ownerCommonName = c.commonName();
        name = _name;
        description =_description;
        images =_images;
        price = _price;
        createdDate = _createdDate;
        createSale(_state, _payment);
    }

    modifier requireOwner(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        string err = "Only "
                   + ownerCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = c.commonName();
        require(commonName == ownerCommonName, err);
        _;
    }

    function createBaseSale(SaleState _state, PaymentType _payment) internal returns (Sale) {
        return new SimpleSale(address(this), _state, _payment);
    }

    function createSale(SaleState _state, PaymentType _payment) public requireOwner("Create sale") returns (uint) {// can be overridden
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = createBaseSale(_state, _payment);
        whitelistSale(sale);
        return RestStatus.OK;
    }

    function whitelistSale(address saleContract) requireOwner("whitelistSale") {
        whitelistedSales[saleContract] = true;
    }

    function dewhitelistSale(address saleContract) public requireOwner("dewhitelistSale") {
        whitelistedSales[saleContract] = false;
    }

    function disableAllSales() requireOwner("disableAllSales") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i]) {
                Sale(whitelistedSales[i]).changeSaleState(2);
                dewhitelistSale(whitelistedSales[i]);
            }
        }
    }

    function changeSaleState(SaleState _state) public requireOwner("Change Sale State") returns (uint) {
        require(address(sale)!=address(0));
        sale.changeSaleState(_state);
        return RestStatus.OK;
    }

    function changePrice(uint _price) public requireOwner("Change Asset Price") returns (uint) {
        price = _price;
        return RestStatus.OK;
    }

    function changePaymentType(PaymentType _payment) public requireOwner("Change Payment Type") returns (uint) {
        require(address(sale)!=address(0));
        sale.changePaymentType(_payment);
        return RestStatus.OK;
    }

    function transferOwnership(string _newOwner) public requireOwner("Ownership transfer") {
        require(whitelistedSales[msg.sender], "Sale contract not whitelisted");
        ownerCommonName = _newOwner;
        disableAllSales();
    }
}