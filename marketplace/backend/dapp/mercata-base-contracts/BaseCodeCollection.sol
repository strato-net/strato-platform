import <509>;

pragma es6;
pragma strict;

contract Mercata{}

contract ItemStatus{
  enum ItemStatus{
    NULL,
    PUBLISHED,
    UNPUBLISHED,
    REMOVED,
    SOLD,
    MAX
  }
}

contract PaymentType {
enum PaymentType{
        NONE,
        CARD,
        STRAT
    }
}

contract SaleState{
 enum SaleState {
        NONE,
        Created,
        Closed,
        Canceled,
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

abstract contract Asset is PaymentType, SaleState, RestStatus, ItemStatus {
    address public owner;
    string public ownerCommonName;
    string public ownerOrganization;
    string public name;
    string public description;
    string[] public images;
    uint public createdDate;
    ItemStatus public status;

    address[] public whitelistedSales = [];

    constructor(string _name, string _description, string[] _images, uint _createdDate) {
        name = _name;
        description =_description;
        images =_images;
        createdDate = _createdDate;
    }

    modifier requireOwner(string action) {
        mapping(string => string) user = getUserCert(tx.origin);
        string err = "Only "
                   + ownerCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = user["commonName"];
        require(commonName == ownerCommonName, err);
        _;
    }

    // Updated function to add a sale to the whitelist
    function whitelistSale(address saleContract) public requireOwner("whitelist a Sale") {
        require(!isSaleWhitelisted(saleContract), "Sale is already whitelisted.");
        whitelistedSales.push(saleContract);
    }

    function changePrice(uint _price) public requireOwner("change price") returns (uint) {
        if (whitelistedSales.length > 0) {
            for (uint i = 0; i < whitelistedSales.length; i++) {
                Sale(whitelistedSales[i]).changePrice(_price);
            }
        }
        return RestStatus.OK;
    }

    // Helper function to check if a sale is already whitelisted
    function isSaleWhitelisted(address saleContract) public returns (bool) {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] == saleContract) {
                return true;
            }
        }
        return false;
    }

    // Updated function to remove a sale from the whitelist
    function dewhitelistSale(address saleContract) public requireOwner("dewhitelist a Sale") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        address[] newArray = [];
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] != saleContract) {
                newArray.push(whitelistedSales[i]);
            }
        }
        whitelistedSales = newArray;
    }

    // Updated function to disable all sales
    function disableAllSales() public requireOwner("disable all Sales") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            Sale(whitelistedSales[i]).changeSaleState(SaleState.Closed);
        }
        whitelistedSales=[];
    }
    
    function transferOwnership(address saleContract, address _newOwner) public requireOwner("ownership transfer") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        disableAllSales();
        status = ItemStatus.UNPUBLISHED;
        owner = _newOwner;
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
   }

   function updateAsset(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        uint _price
    ) public requireOwner("update asset") returns (uint) {
        name = _name;
        description = _description;
        images = _images;
        if (_status == ItemStatus.UNPUBLISHED) {
            disableAllSales();
            status = _status;
            return RestStatus.OK;
        }
        uint price = Sale(whitelistedSales[0]).price();
        if (_price != price) {
            changePrice(_price);
        }
        return RestStatus.OK;
    }
}

abstract contract Sale is PaymentType, SaleState, RestStatus{ 
    address public sellersAddress;
    string public sellersCommonName;
    Asset public assetToBeSold;
    uint public price;
    uint public saleOrderID;
    SaleState public state;
    PaymentType public payment;


    constructor(
        address _assetToBeSold,
        uint _price,
        PaymentType _payment
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        sellersCommonName = assetToBeSold.ownerCommonName();
        sellersAddress = assetToBeSold.owner();
        price = _price;
        state = SaleState.Created;
        payment = _payment;
        saleOrderID = 0;
    }

    modifier requireSeller(string action) {
        mapping(string => string) user = getUserCert(tx.origin);
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = user["commonName"];
        require(commonName == sellersCommonName, err);
    }

    function changePrice(uint _price) public requireSeller("change price"){
        price=_price;
    }

    function changeSaleState(SaleState _state) public requireSeller("change sale state"){
        state=_state;
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public requireSeller("transfer ownership of Asset") virtual returns (uint) {
        saleOrderID = _orderId;
        assetToBeSold.transferOwnership(address(this), _purchasersAddress);
        return RestStatus.OK;
    }
}

abstract contract Order is RestStatus, OrderStatus {
    uint public orderId;
    address[] public saleAddresses;
    string public sellersCommonName;
    address public sellersAddress;
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
        string _sellersCommonName, 
        address _sellersAddress,
        string _purchasersCommonName, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress,
        string _paymentSessionId
    ) external{
        orderId = _orderId;
        saleAddresses = _saleAddresses;
        sellersCommonName = _sellersCommonName;
        sellersAddress = _sellersAddress;
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
        require(tx.origin == sellersAddress, "Only the seller can fulfill the order and transfer ownership");
        fulfillmentDate = _fulfillmentDate;
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale sale = Sale(saleAddresses[i]);
            // Perform the ownership transfer
            sale.transferOwnership(purchasersAddress, orderId);
        }
        comments = _comments;
        status = OrderStatus.CLOSED;
        return RestStatus.OK;
    }
}