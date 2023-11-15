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

abstract contract Asset is RestStatus{
    address public owner;
    string public ownerCommonName;
    string public name;
    string public description;
    string[] public images;
    uint public price;
    uint public createdDate;

    // Sale public sale;
    address[] public whitelistedSales;
    SaleFactory salefactory;

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

    // Updated function to add a sale to the whitelist
    function whitelistSale(address saleContract) public requireOwner("whitelistSale") {
        require(!isSaleWhitelisted(saleContract), "Sale already whitelisted");
        whitelistedSales.push(saleContract);
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
    function dewhitelistSale(address saleContract) public requireOwner("dewhitelistSale") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        for (uint i = 0; i < whitelistedSales.length; i++) {
            if (whitelistedSales[i] == saleContract) {
                delete whitelistedSales[i];
                // Shift elements left to fill the gap left by delete
                for (uint j = i; j < whitelistedSales.length - 1; j++) {
                    whitelistedSales[j] = whitelistedSales[j + 1];
                }
                // whitelistedSales.pop(); // Remove the last element
                break;
            }
        }
    }


    // Updated function to disable all sales
    function disableAllSales() public requireOwner("disableAllSales") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            Sale(whitelistedSales[i]).changeSaleState(SaleState.Closed);
            dewhitelistSale(whitelistedSales[i]);
        }
    }

    function changePrice(uint _price) public requireOwner("Change Asset Price") returns (uint) {
        price = _price;
        return RestStatus.OK;
    }
    
    function transferOwnership(address saleContract, string _newOwnerCommonName, address _newOwner) public requireOwner("Ownership transfer") {
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        ownerCommonName = _newOwnerCommonName;
        owner = _newOwner;
        disableAllSales();
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

    function changeSaleState(SaleState _state) public requireSeller("Change Payment Type"){
        state=_state;
    }

    function changePaymentType(PaymentType _payment) public requireSeller("Change Payment Type"){
        payment=_payment;
    }

    function transferOwnership(string _purchasersCommonName, address _purchasersAddress, uint _orderId) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = _purchasersCommonName;
        assetToBeSold.transferOwnership(address(this), purchasersCommonName, _purchasersAddress);
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

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        string _sellerCommonName, 
        string _purchasersCommonName, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress
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
    }
    
    function transferOwnership() external returns (uint) {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale sale = Sale(saleAddresses[i]);
            // Perform the ownership transfer
            sale.transferOwnership(purchasersCommonName, purchasersAddress, orderId);
        }
        status = OrderStatus.CLOSED;
        return RestStatus.OK;
    }
}