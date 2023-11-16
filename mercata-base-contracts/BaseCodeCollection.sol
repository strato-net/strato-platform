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
    }
}

contract OrderStatus{
    enum OrderStatus{
        NULL,
        AWAITING_FULFILLMENT,
        AWAITING_SHIPMENT,
        CLOSED,
        CANCELED,
        MAX
    }
}

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
    uint public createdDate;

    Sale public sale;

    constructor(string _name, string _description, string[] _images, uint _price, uint _createdDate) {
        CertificateRegistry r = CertificateRegistry(account(0x509, "main"));
        Certificate c = CertificateRegistry(account(address(r), "main")).getUserCert(msg.sender);
        owner  = c.userAddress();
        ownerCommonName = c.commonName();
        name = _name;
        description =_description;
        images =_images;
        price = _price;
        createdDate = _createdDate;
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

    function changeSaleState(SaleState _state) public requireOwner("Change Sale State") returns (uint) {
        require(address(sale)!=address(0));
        sale.changeSaleState(_state);
        return RestStatus.OK;
    }

    function changePrice(uint _price) public requireOwner("Change Asset Price") returns (uint) {
        price = _price;

        if (address(sale)!=address(0)) {
            sale.changePrice(price);
        }
        
        return RestStatus.OK;
    }

    function changePaymentType(PaymentType _payment) public requireOwner("Change Payment Type") returns (uint) {
        require(address(sale)!=address(0));
        sale.changePaymentType(_payment);
        return RestStatus.OK;
    }

    function transferOwnership(string _newOwnerName, address _newOwnerAddress) public requireOwner("Ownership transfer") {
        require(msg.sender == address(sale), "Ownership transfer must originate from the active bill of sale");
        ownerCommonName = _newOwnerName;
        owner = _newOwnerAddress;
        sale = Sale(address(0));
    }
}

abstract contract Sale is PaymentType, SaleState, RestStatus{ 
    string public sellersCommonName;
    string public purchasersCommonName;
    Asset public assetToBeSold;
    uint public price;
    uint public saleOrderID;
    SaleState public state;
    PaymentType public payment;


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
        saleOrderID = 0;
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

    function changePrice(uint _price) public requireSeller("Change Price"){
        price=_price;
    }

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }

    function transferOwnership(string _purchasersCommonName, address _purchasersAddress, uint _orderId) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(purchasersCommonName, _purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }
}

abstract contract Order is RestStatus, OrderStatus {
    uint public orderId;
    address[] public saleAddresses;
    string public sellerCommonName;
    string public purchasersCommonName;
    address public purchasersAddress;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    address public shippingAddress;
    uint public fulfillmentDate;
    string public paymentSessionId;
    string public comments;

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        string _sellerCommonName, 
        string _purchasersCommonName, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress,
        string _paymentSessionId
    ) external{
        orderId = _orderId;
        saleAddresses = _saleAddresses;
        sellerCommonName = _sellerCommonName;
        purchasersCommonName = _purchasersCommonName;
        purchasersAddress = _purchasersAddress;
        createdDate = _createdDate;
        totalPrice = _totalPrice;
        status = OrderStatus.AWAITING_FULFILLMENT;
        shippingAddress = _shippingAddress;
        paymentSessionId = _paymentSessionId;
        comments = "";
    }

    function cancelOrder(string _comments) external returns (uint) {
        require(tx.origin == purchasersAddress, "Only the purchaser can cancel the order");
        status = OrderStatus.CANCELED;
        comments = _comments;
        return RestStatus.OK; 
    }
    
    function transferOwnership(uint _fulfillmentDate, string _comments) external returns (uint) {
        fulfillmentDate = _fulfillmentDate;
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale sale = Sale(saleAddresses[i]);
            // Perform the ownership transfer
            sale.transferOwnership(purchasersCommonName, purchasersAddress, orderId);
        }
        comments = _comments;
        status = OrderStatus.CLOSED;
        return RestStatus.OK;
    }
}