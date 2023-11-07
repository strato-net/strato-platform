import <509>;

pragma es6;
pragma strict;

contract Mercata{}

contract PaymentType {
enum PaymentType{
        NONE,
        CASH,
        STRAT,
        MAX
    }
}

contract SaleState{
 enum SaleState {
        NONE,
        Created,
        Closed,
        MAX
    }}

contract RestStatus {
  uint constant OK = 200;
  uint constant CREATED = 201;
  uint constant ACCEPTED = 202;

  uint constant BAD_REQUEST = 400;
  uint constant UNAUTHORIZED = 401;
  uint constant FORBIDDEN = 403;
  uint constant NOT_FOUND = 404;
  uint constant CONFLICT = 409;

  uint constant INTERNAL_SERVER_ERROR = 500;
  uint constant NOT_IMPLEMENTED = 501;
  uint constant BAD_GATEWAY = 502;
  uint constant GATEWAY_TIMEOUT = 504;
}

abstract contract Asset is PaymentType, SaleState, RestStatus{
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public price;

    Sale public sale;

    constructor(string _name, string _description, string[] _images, uint _price, SaleState _state, PaymentType _payment) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        owner  = c.userAddress();
        ownerCommonName = c.commonName();
        name = _name;
        description =_description;
        images =_images;
        price = _price;
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
        return RestStatus.OK;
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
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerCommonName = _newOwner;
        sale = Sale(address(0));
    }
}

abstract contract Sale is PaymentType, SaleState, RestStatus{ 
    string sellersCommonName;
    string purchasersCommonName;
    Asset assetToBeSold;
    uint price;

    SaleState state;
    PaymentType payment;


    constructor(
        address _assetToBeSold,
        SaleState _state,
        PaymentType _payment
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        sellersCommonName = assetToBeSold.ownerCommonName();
        purchasersCommonName = sellersCommonName;
        price = assetToBeSold.price();
        state = _state;
        payment = _payment;
    }

    modifier requireSeller(string action) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(tx.origin);
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = c.commonName();
        require(commonName == sellersCommonName, err);
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }

    function transferOwnership(string _purchasersCommonName) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(purchasersCommonName);
        state = SaleState.Closed;
        return RestStatus.OK;
    }
}

contract SimpleSale is Sale{
    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment) Sale(_assetToBeSold, _state, _payment){
    }
}
